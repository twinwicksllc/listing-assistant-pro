import { assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchEbayRateLimits, findBrowseRate, pruneOldCallLogRows, shouldPruneThisTick, shouldWarn } from "./index.ts";

// Regression coverage for the eBay Browse API quota monitor (spun out of the
// 2026-09-17 429 investigation, follow-on to PR #580's call-fan-out cap).
// eBay's real limit is 5,000 calls/day per client_id, confirmed at 73.8%
// used on this account's real keyset before this monitor existed. This
// covers the two pure functions that decide whether to warn and how to
// parse eBay's nested rate-limit response shape, without a live HTTP call.

Deno.test("findBrowseRate: finds the buy.browse resource among multiple contexts", () => {
  const rateLimits = [
    {
      apiContext: "sell",
      resources: [{ name: "inventory", rates: [{ limit: 1000, remaining: 500, reset: "2026-09-18T00:00:00Z" }] }],
    },
    {
      apiContext: "buy",
      resources: [
        {
          name: "buy.browse",
          rates: [{ limit: 5000, remaining: 4200, reset: "2026-09-18T14:15:00Z", timeWindow: 86400 }],
        },
      ],
    },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.resource.name, "buy.browse");
  assertEquals(found?.rate.limit, 5000);
  assertEquals(found?.rate.remaining, 4200);
});

Deno.test("findBrowseRate: returns null when no browse resource is present", () => {
  const rateLimits = [
    { apiContext: "sell", resources: [{ name: "inventory", rates: [{ limit: 1000, remaining: 500, reset: "x" }] }] },
  ];
  assertEquals(findBrowseRate(rateLimits), null);
});

Deno.test("findBrowseRate: returns null on an empty rateLimits array", () => {
  assertEquals(findBrowseRate([]), null);
});

Deno.test("findBrowseRate: returns null when a resource has an empty rates array", () => {
  const rateLimits = [
    { apiContext: "buy", resources: [{ name: "buy.browse", rates: [] }] },
  ];
  assertEquals(findBrowseRate(rateLimits), null);
});

Deno.test("findBrowseRate: matches buy.browse exactly, not buy.browse.item.bulk, even when the latter appears first", () => {
  // Regression for a real finding on this account's actual getRateLimits
  // response, which includes BOTH resources -- a substring match on
  // "browse" could pick up the wrong one depending on response ordering
  // (Copilot review, PR #581).
  const rateLimits = [
    {
      apiContext: "buy",
      resources: [
        { name: "buy.browse.item.bulk", rates: [{ limit: 5000, remaining: 5000, reset: "x" }] },
        { name: "buy.browse", rates: [{ limit: 5000, remaining: 1310, reset: "y" }] },
      ],
    },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.resource.name, "buy.browse");
  assertEquals(found?.rate.remaining, 1310);
});

Deno.test("findBrowseRate: case-insensitive match still requires the exact resource name", () => {
  const rateLimits = [
    { apiContext: "buy", resources: [{ name: "Buy.Browse", rates: [{ limit: 5000, remaining: 4000, reset: "z" }] }] },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.rate.remaining, 4000);
});

Deno.test("shouldWarn: below both thresholds does not warn", () => {
  const r = shouldWarn(5000, 4500, 100);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: eBay's own poll at exactly 90% used warns", () => {
  // 500 remaining of 5000 == 90% used == exactly at the threshold.
  const r = shouldWarn(5000, 500, 0);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("eBay's own poll"), true);
});

Deno.test("shouldWarn: eBay's own poll just under 90% used does not warn", () => {
  // 501 remaining of 5000 == 89.98% used.
  const r = shouldWarn(5000, 501, 0);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: same-day counter at exactly 90% of limit warns even if the poll looks fine", () => {
  const r = shouldWarn(5000, 5000, 4500);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("same-day counter"), true);
});

Deno.test("shouldWarn: same-day counter just under 90% does not warn", () => {
  const r = shouldWarn(5000, 5000, 4499);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: a non-positive limit never warns (defensive against a malformed poll)", () => {
  const r = shouldWarn(0, 0, 100);
  assertEquals(r.warn, false);
  assertEquals(r.reason, "no known limit");
});

Deno.test("shouldWarn: both signals crossing the threshold still reports a single warn, prioritising the eBay poll's reason", () => {
  const r = shouldWarn(5000, 100, 4600);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("eBay's own poll"), true);
});

// Retention/pruning: ebay_browse_call_log is append-only and only ever read
// via a same-day query, so rows older than the retention window are pure
// dead weight. This cron runs hourly; the prune should fire on exactly one
// of those 24 ticks/day, not all of them.
Deno.test("shouldPruneThisTick: fires at the designated UTC hour (00)", () => {
  assertEquals(shouldPruneThisTick(0), true);
});

Deno.test("shouldPruneThisTick: does not fire on other UTC hours", () => {
  for (const hour of [1, 5, 12, 23]) {
    assertEquals(shouldPruneThisTick(hour), false);
  }
});

/** Minimal fake mirroring only the .from().delete().lt() shape pruneOldCallLogRows uses. */
function fakeSupabaseForPrune(opts: {
  error?: { message: string };
  onDelete?: (table: string, filterField: string, filterValue: string) => void;
}) {
  return {
    from(table: string) {
      return {
        delete() {
          return {
            lt(field: string, value: string) {
              opts.onDelete?.(table, field, value);
              return Promise.resolve({ error: opts.error ?? null });
            },
          };
        },
      };
    },
  };
}

Deno.test("pruneOldCallLogRows: deletes from ebay_browse_call_log with a cutoff 3 days before `now`", async () => {
  let capturedTable = "";
  let capturedField = "";
  let capturedCutoff = "";
  const svc = fakeSupabaseForPrune({
    onDelete: (table, field, value) => {
      capturedTable = table;
      capturedField = field;
      capturedCutoff = value;
    },
  });
  const now = new Date("2026-09-20T00:31:00.000Z");
  const result = await pruneOldCallLogRows(svc, now);
  assertEquals(result, { pruned: true });
  assertEquals(capturedTable, "ebay_browse_call_log");
  assertEquals(capturedField, "created_at");
  // RETENTION_DAYS = 3, so the cutoff must be exactly 3 days before `now` --
  // rows on the "3 days old, still within retention" side of this boundary
  // must survive, and rows just past it must be deleted.
  assertEquals(capturedCutoff, "2026-09-17T00:31:00.000Z");
});

Deno.test("pruneOldCallLogRows: reports failure on a delete error rather than reporting pruned: true", async () => {
  const svc = fakeSupabaseForPrune({ error: { message: "connection reset" } });
  const result = await pruneOldCallLogRows(svc, new Date());
  assertEquals(result.pruned, false);
  assertEquals(result.error, "connection reset");
});

// ── fetchEbayRateLimits: v1/v1_beta fallback (2026-09-18) ───────────────────
// Regression coverage for the real production gap: v1 started 404ing on
// this account while v1_beta still worked, and the pre-fix version only
// ever tried v1 -- see the function's own comment in index.ts for the full
// incident. Monkey-patches globalThis.fetch for the duration of each test,
// same pattern as tokenCrypto.test.ts/ebayTokenRefresh.test.ts use for
// Deno.env.get, restored in a `finally` so a failure never leaks into a
// later test.

function withMockedFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => Promise.resolve(handler(String(url)))) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("fetchEbayRateLimits: uses the v1 response when v1 succeeds (no fallback needed)", async () => {
  await withMockedFetch(
    (url) => {
      if (url.includes("/v1/rate_limit/")) {
        return new Response(
          JSON.stringify({ rateLimits: [{ apiContext: "buy", resources: [] }] }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected URL in this test: ${url}`);
    },
    async () => {
      const result = await fetchEbayRateLimits("fake-token", "production");
      assertEquals(result, [{ apiContext: "buy", resources: [] }]);
    },
  );
});

Deno.test("fetchEbayRateLimits: falls back to v1_beta when v1 404s", async () => {
  const calledUrls: string[] = [];
  await withMockedFetch(
    (url) => {
      calledUrls.push(url);
      if (url.includes("/v1/rate_limit/")) {
        return new Response("", { status: 404 });
      }
      if (url.includes("/v1_beta/rate_limit/")) {
        return new Response(
          JSON.stringify({ rateLimits: [{ apiContext: "buy", resources: [{ name: "buy.browse", rates: [] }] }] }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected URL in this test: ${url}`);
    },
    async () => {
      const result = await fetchEbayRateLimits("fake-token", "production");
      assertEquals(result[0].resources[0].name, "buy.browse");
    },
  );
  assertEquals(calledUrls.length, 2);
  assertStringIncludes(calledUrls[0], "/v1/rate_limit/");
  assertStringIncludes(calledUrls[1], "/v1_beta/rate_limit/");
});

Deno.test("fetchEbayRateLimits: does NOT fall back on a non-404 failure (auth/scope errors aren't fixed by trying the other path)", async () => {
  const calledUrls: string[] = [];
  const error = await assertRejects(
    () =>
      withMockedFetch(
        (url) => {
          calledUrls.push(url);
          return new Response("invalid_scope", { status: 403 });
        },
        () => fetchEbayRateLimits("fake-token", "production"),
      ),
    Error,
  );
  // Only the first (v1) attempt should have fired -- a 403 means "try again
  // at a different path" won't help, so falling back here would just mask
  // the real error behind a second, identically-doomed request.
  assertEquals(calledUrls.length, 1);
  assertStringIncludes(error.message, "403");
  // The message must say this was a fail-fast, not claim v1_beta was tried
  // when it was deliberately skipped (Copilot review).
  assertStringIncludes(error.message, "failed fast");
  assertStringIncludes(error.message, "no fallback attempted");
});

Deno.test("fetchEbayRateLimits: throws with both attempts' details when both v1 and v1_beta 404", async () => {
  const error = await assertRejects(
    () =>
      withMockedFetch(
        () => new Response("not found", { status: 404 }),
        () => fetchEbayRateLimits("fake-token", "production"),
      ),
    Error,
  );
  // A regression that stopped recording the first (v1) attempt would still
  // pass a test asserting only the v1_beta detail -- assert both paths'
  // status are present in the message (Copilot review).
  assertStringIncludes(error.message, "v1: 404");
  assertStringIncludes(error.message, "v1_beta: 404");
});
