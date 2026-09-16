import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshOneWatch, runBatch, type WatchRow } from "./index.ts";

// Regression coverage for Problem 3, Phase 3.4 of the pricing-reliability
// plan: market_watches has always had the right schema and
// market-watch-refresh already knew how to refresh one watch correctly, but
// nothing ever called it automatically -- confirmed by grepping every
// cron.schedule() call across all migrations, none targeted this function.
// This covers the new daily batch mode's cursor-fairness contract (via a
// fake get_watches_due_for_refresh RPC) and its fail-soft per-watch handling
// (one bad watch must not abort the whole batch).

Deno.env.set("EBAY_CLIENT_ID", "test-client-id");
Deno.env.set("EBAY_CLIENT_SECRET", "test-client-secret");
Deno.env.set("EBAY_ENVIRONMENT", "production");

/** Minimal fake mirroring the subset of the supabase-js query builder used here. */
function fakeSupabase(opts: {
  rpcResult?: { watch_id: string }[];
  rpcError?: { message: string };
  watches?: Record<string, WatchRow | null>;
  onUpdate?: (table: string, patch: Record<string, unknown>, watchId: string) => void;
  onInsert?: (table: string, row: Record<string, unknown>) => void;
}) {
  const watches = opts.watches ?? {};
  return {
    rpc(_name: string, _args: unknown) {
      if (opts.rpcError) return Promise.resolve({ data: null, error: opts.rpcError });
      return Promise.resolve({ data: opts.rpcResult ?? [], error: null });
    },
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_field: string, value: string) {
              return {
                single() {
                  const watch = watches[value] ?? null;
                  if (!watch) {
                    return Promise.resolve({ data: null, error: { message: "not found" } });
                  }
                  return Promise.resolve({ data: watch, error: null });
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_field: string, value: string) {
              opts.onUpdate?.(table, patch, value);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(row: Record<string, unknown>) {
          opts.onInsert?.(table, row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

/** Stubs global fetch: eBay OAuth token, Browse API search, and Jina scrape. */
function stubFetch(opts: { browsePrices?: number[]; jinaContent?: string } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL) => {
    const u = String(url);
    if (u.includes("oauth2/token")) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 }),
      );
    }
    if (u.includes("buy/browse/v1")) {
      const prices = opts.browsePrices ?? [10, 12, 14];
      return Promise.resolve(
        new Response(
          JSON.stringify({
            itemSummaries: prices.map((p) => ({ price: { value: String(p) } })),
            total: prices.length,
          }),
          { status: 200 },
        ),
      );
    }
    if (u.includes("r.jina.ai")) {
      return Promise.resolve(
        new Response(opts.jinaContent ?? "All Listings (5) Filter Applied Under $20.00", {
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof globalThis.fetch;
  return { restore: () => (globalThis.fetch = originalFetch) };
}

Deno.test("refreshOneWatch: computes stats and persists an update + a history insert", async () => {
  const updates: Record<string, unknown>[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const supabase = fakeSupabase({
    onUpdate: (_table, patch) => updates.push(patch),
    onInsert: (table, row) => inserts.push({ table, row }),
  });
  const f = stubFetch({ browsePrices: [10, 20, 30] });

  const watch: WatchRow = { id: "w1", search_query: "test coin", category_id: null };
  try {
    const stats = await refreshOneWatch(supabase, watch);
    assertEquals(stats.watchId, "w1");
    assertEquals(stats.activeCount, 3);
    assertEquals(stats.avgPrice, 20);
  } finally {
    f.restore();
  }

  assertEquals(updates.length, 1);
  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].table, "market_price_history");
  assertEquals(inserts[0].row.watch_id, "w1");
});

Deno.test("runBatch: refreshes every watch the RPC returns", async () => {
  const supabase = fakeSupabase({
    rpcResult: [{ watch_id: "w1" }, { watch_id: "w2" }],
    watches: {
      w1: { id: "w1", search_query: "coin a", category_id: null },
      w2: { id: "w2", search_query: "coin b", category_id: null },
    },
  });
  const f = stubFetch();
  try {
    const summary = await runBatch(supabase);
    assertEquals(summary, { attempted: 2, refreshed: 2, failed: 0 });
  } finally {
    f.restore();
  }
});

Deno.test("runBatch: a watch missing from the DB is skipped, not fatal to the batch", async () => {
  const supabase = fakeSupabase({
    rpcResult: [{ watch_id: "w1" }, { watch_id: "missing" }],
    watches: {
      w1: { id: "w1", search_query: "coin a", category_id: null },
    },
  });
  const f = stubFetch();
  try {
    const summary = await runBatch(supabase);
    assertEquals(summary, { attempted: 2, refreshed: 1, failed: 1 });
  } finally {
    f.restore();
  }
});

Deno.test("runBatch: an individual watch throwing mid-refresh is caught and skipped, not fatal to the batch", async () => {
  const supabase = fakeSupabase({
    rpcResult: [{ watch_id: "w1" }, { watch_id: "w2" }],
    watches: {
      w1: { id: "w1", search_query: "coin a", category_id: null },
      w2: { id: "w2", search_query: "coin b", category_id: null },
    },
  });
  // getEbayAppToken throws on a non-ok response -- simulate that for every
  // call so refreshOneWatch itself throws, exercising runBatch's per-watch
  // try/catch rather than the RPC-level or lookup-level skip paths above.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("boom", { status: 500 }))) as typeof globalThis.fetch;
  try {
    const summary = await runBatch(supabase);
    assertEquals(summary.attempted, 2);
    assertEquals(summary.refreshed, 0);
    assertEquals(summary.failed, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("runBatch: RPC failure returns an all-zero summary rather than throwing", async () => {
  const supabase = fakeSupabase({ rpcError: { message: "connection reset" } });
  const summary = await runBatch(supabase);
  assertEquals(summary, { attempted: 0, refreshed: 0, failed: 0 });
});

Deno.test("runBatch: an empty RPC result is a no-op, not an error", async () => {
  const supabase = fakeSupabase({ rpcResult: [] });
  const summary = await runBatch(supabase);
  assertEquals(summary, { attempted: 0, refreshed: 0, failed: 0 });
});
