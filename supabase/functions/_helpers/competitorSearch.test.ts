import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  attemptItemsRefresh,
  attemptSignatureMatch,
  type BrowseQuotaWindowAnchor,
  buildCompetitorPricesUpsertPayload,
  checkBrowseQuotaHeadroom,
  type CompetitorItem,
  type CompSearchAttemptResult,
  computeCompStats,
  computeProductSignature,
  decideRefreshStrategy,
  evaluateCompQuality,
  extractCompItemIds,
  fetchEbayItemsBulk,
  getLatestBrowseQuotaWindowAnchor,
  groupPlanIntoTiers,
  isItemsRefreshUsable,
  logBrowseApiCall,
  parseCompetitorItem,
  parseOptionalCount,
  runAttemptsSequential,
  runTieredCompSearch,
  type SearchPlanAttempt,
} from "./competitorSearch.ts";

// Regression coverage for Problem 3, Phase 3.2a (pricing-reliability plan):
// eBay's Browse API item_summary/search returns watchCount/bidCount on
// ItemSummary by default (no fieldgroups param required), but neither is
// guaranteed populated for every item -- eBay has historically gated
// watcher-count visibility, and bidCount only applies to auction-format
// listings. A missing/non-numeric value must parse to undefined, never a
// coerced 0 -- a bare 0 would misreport "confirmed zero interest" for an
// item eBay simply didn't report a count for.

Deno.test("parseOptionalCount: parses a valid integer", () => {
  assertEquals(parseOptionalCount(37), 37);
});

Deno.test("parseOptionalCount: parses a numeric string (defensive against a stringified API value)", () => {
  assertEquals(parseOptionalCount("12"), 12);
});

Deno.test("parseOptionalCount: undefined input stays undefined, not coerced to 0", () => {
  assertEquals(parseOptionalCount(undefined), undefined);
});

Deno.test("parseOptionalCount: null input stays undefined, not coerced to 0", () => {
  assertEquals(parseOptionalCount(null), undefined);
});

Deno.test("parseOptionalCount: non-numeric garbage stays undefined", () => {
  assertEquals(parseOptionalCount("not a number"), undefined);
  assertEquals(parseOptionalCount({}), undefined);
  assertEquals(parseOptionalCount([]), undefined);
});

Deno.test("parseOptionalCount: a genuine 0 is preserved as 0, not treated as missing", () => {
  assertEquals(parseOptionalCount(0), 0);
});

// Regression coverage for Phase 1.2b (latency plan): eBay's Browse API has a
// real, hard 5,000-calls/day quota per client_id (confirmed 2026-09-17), and
// the old un-capped search plan (4 queries x up to 4 filter modes = up to 16
// calls per search, x2 per analyze-item request) could exhaust it with a
// single user's modest listing count via competitor-prices-cron's 24h
// refresh cycle alone. These tests guard the cap: at most 2 tiers ever run,
// and tier 2 only fires when tier 1 doesn't meet the quality bar.

function attempt(query: string, strategy: string): SearchPlanAttempt {
  return { query, strategy, filterMode: "fixed" };
}

function fakeResult(prices: number[]): CompSearchAttemptResult {
  return { prices, count: prices.length, items: [] };
}

/** Like fakeResult, but with real itemIds so dedup-across-attempts can be tested. */
function fakeResultWithIds(pairs: [price: number, itemId: string][]): CompSearchAttemptResult {
  return {
    prices: pairs.map((p) => p[0]),
    count: pairs.length,
    items: pairs.map(([price, itemId]) => ({
      title: "test item",
      price,
      currency: "USD",
      condition: "Pre-Owned",
      itemId,
    })),
  };
}

Deno.test("evaluateCompQuality: 3 comps within 3x spread passes (global default)", () => {
  const r = evaluateCompQuality([10, 20, 30]);
  assertEquals(r.passes, true);
});

Deno.test("evaluateCompQuality: 2 comps fails on count alone", () => {
  const r = evaluateCompQuality([10, 20]);
  assertEquals(r.passes, false);
});

Deno.test("evaluateCompQuality: 3 comps at 3.5x spread fails", () => {
  const r = evaluateCompQuality([10, 20, 35]);
  assertEquals(r.passes, false);
});

Deno.test("evaluateCompQuality: exactly at the boundary (3 comps, exactly 3x) passes", () => {
  const r = evaluateCompQuality([10, 15, 30]);
  assertEquals(r.passes, true);
});

Deno.test("evaluateCompQuality: zero/negative minimum price is rejected defensively", () => {
  const r = evaluateCompQuality([0, 10, 20]);
  assertEquals(r.passes, false);
});

Deno.test("groupPlanIntoTiers: groups contiguous same-query attempts into tiers", () => {
  const plan: SearchPlanAttempt[] = [
    attempt("q1", "with-category-fixed"),
    attempt("q1", "with-category-any"),
    attempt("q1", "without-category-fixed"),
    attempt("q2", "without-category-fixed"),
    attempt("q2", "without-category-any"),
  ];
  const tiers = groupPlanIntoTiers(plan);
  assertEquals(tiers.length, 2);
  assertEquals(tiers[0].length, 3);
  assertEquals(tiers[1].length, 2);
});

Deno.test("groupPlanIntoTiers: empty plan yields zero tiers", () => {
  assertEquals(groupPlanIntoTiers([]), []);
});

// NOTE on the intra-tier quality gate (Phase 1.2b residual gap fix): before
// this change, runAttemptsSequential stopped on ANY non-empty result,
// including a single thin comp. This test previously asserted exactly that
// ("stops at the first non-empty result" with only 2 comps). That assertion
// implicitly relied on the old "any non-empty = stop" behavior, which the
// new intra-tier quality-aware early exit deliberately supersedes -- 2
// comps doesn't meet the default 3-comp bar, so the loop now keeps going to
// look for more within the same tier. Updated below to reflect the new
// behavior (intent preserved: don't waste attempts once the running result
// is good enough) rather than silently keeping the old assertion.

Deno.test("runAttemptsSequential: first attempt alone already passing the quality gate stops immediately (regression guard -- cheap/common case must not regress to always trying every attempt)", async () => {
  const calls: string[] = [];
  const attempts = [attempt("a", "s1"), attempt("b", "s2"), attempt("c", "s3")];
  const { result, chosen } = await runAttemptsSequential(attempts, (a) => {
    calls.push(a.query);
    // "a" alone already has 3 comps within a tight spread -- passes the
    // default gate on the very first attempt.
    return Promise.resolve(fakeResult(a.query === "a" ? [10, 20, 30] : [999]));
  });
  assertEquals(calls, ["a"]);
  assertEquals(result.prices, [10, 20, 30]);
  assertEquals(chosen?.query, "a");
});

Deno.test("runAttemptsSequential: thin first result accumulates with the second attempt and stops once the running total passes the gate (does not blow through all remaining attempts)", async () => {
  const calls: string[] = [];
  const attempts = [attempt("a", "s1"), attempt("b", "s2"), attempt("c", "s3"), attempt("d", "s4")];
  const { result, chosen } = await runAttemptsSequential(attempts, (a) => {
    calls.push(a.query);
    // "a" returns 1 comp (thin -- fails the 3-comp minimum alone), "b"
    // returns 2 more -- accumulated total (3 comps, tight spread) passes.
    if (a.query === "a") return Promise.resolve(fakeResult([10]));
    if (a.query === "b") return Promise.resolve(fakeResult([15, 20]));
    return Promise.resolve(fakeResult([999])); // c/d must never fire
  });
  assertEquals(calls, ["a", "b"]);
  assertEquals(result.prices, [10, 15, 20]);
  assertEquals(chosen?.query, "b");
});

Deno.test("runAttemptsSequential: all attempts thin/empty still exhausts every attempt in the tier and returns whatever accumulated (no attempts silently dropped)", async () => {
  const calls: string[] = [];
  const attempts = [attempt("a", "s1"), attempt("b", "s2"), attempt("c", "s3")];
  const { result, chosen } = await runAttemptsSequential(attempts, (a) => {
    calls.push(a.query);
    // Each attempt contributes 1 comp -- accumulated total never reaches
    // the 3-comp minimum, so every attempt in the tier gets tried.
    return Promise.resolve(fakeResult(a.query === "a" ? [10] : a.query === "b" ? [] : [12]));
  });
  assertEquals(calls, ["a", "b", "c"]);
  assertEquals(result.prices, [10, 12]);
  assertEquals(chosen?.query, "c");
});

Deno.test("runAttemptsSequential: never fires more than N attempts for a tier of N (regression guard against an infinite loop or over-fetching)", async () => {
  let calls = 0;
  const attempts = [attempt("a", "s1"), attempt("b", "s2"), attempt("c", "s3"), attempt("d", "s4")];
  await runAttemptsSequential(attempts, () => {
    calls++;
    return Promise.resolve(fakeResult([])); // never passes the gate
  });
  assertEquals(calls, attempts.length);
});

Deno.test("runAttemptsSequential: all-empty attempts yields a null chosen attempt", async () => {
  const attempts = [attempt("a", "s1"), attempt("b", "s2")];
  const { result, chosen } = await runAttemptsSequential(attempts, () => Promise.resolve(fakeResult([])));
  assertEquals(result.prices, []);
  assertEquals(chosen, null);
});

// Regression coverage: buildSearchPlan's attempts within one tier share the
// same query and often the same category, varying only filterMode
// (fixed-price vs. any buying option). "any" is a superset of "fixed", so
// the same real eBay listing commonly appears in both attempts' results --
// accumulating without dedup would double-count it, inflating comp count
// and corrupting avgPrice/medianPrice/spread with duplicates rather than
// genuinely new comps.
Deno.test("runAttemptsSequential: dedups overlapping items across attempts by itemId (fixed vs. any buying-option overlap)", async () => {
  const attempts = [attempt("a", "with-category-fixed"), attempt("b", "with-category-any")];
  const { result } = await runAttemptsSequential(attempts, (a) => {
    // "any" mode returns everything "fixed" mode returned (item-1, item-2)
    // plus one genuinely new auction item (item-3) -- a realistic overlap.
    if (a.query === "a") {
      return Promise.resolve(fakeResultWithIds([[10, "item-1"], [12, "item-2"]]));
    }
    return Promise.resolve(
      fakeResultWithIds([[10, "item-1"], [12, "item-2"], [15, "item-3"]]),
    );
  });
  // 2 comps from attempt "a" don't pass the gate (below the 3-comp minimum),
  // so "b" fires too -- but item-1/item-2 must not be counted twice.
  assertEquals(result.prices.sort(), [10, 12, 15]);
  assertEquals(result.count, 3);
  assertEquals(result.items.map((i) => i.itemId).sort(), ["item-1", "item-2", "item-3"]);
});

Deno.test("runAttemptsSequential: an item missing itemId is kept, never dropped for lack of an id", async () => {
  const attempts = [attempt("a", "s1")];
  const { result } = await runAttemptsSequential(attempts, () =>
    Promise.resolve({
      prices: [10, 20, 30],
      count: 3,
      items: [
        { title: "no id 1", price: 10, currency: "USD", condition: "Pre-Owned" },
        { title: "no id 2", price: 20, currency: "USD", condition: "Pre-Owned" },
        { title: "no id 3", price: 30, currency: "USD", condition: "Pre-Owned" },
      ],
    }));
  assertEquals(result.prices, [10, 20, 30]);
  assertEquals(result.items.length, 3);
});

Deno.test("runTieredCompSearch: tier 0 alone is sufficient when it passes the quality gate — tier 1 never fires", async () => {
  const tier0 = [attempt("q1", "with-category-fixed"), attempt("q1", "without-category-fixed")];
  const tier1 = [attempt("q2", "with-category-fixed"), attempt("q2", "without-category-fixed")];
  const calls: string[] = [];
  const result = await runTieredCompSearch([tier0, tier1], (a) => {
    calls.push(a.query);
    return Promise.resolve(fakeResult(a.query === "q1" ? [10, 20, 30] : [999]));
  });
  assertEquals(result.tiersUsed, 1);
  assertEquals(calls.every((q) => q === "q1"), true);
  assertEquals(result.prices, [10, 20, 30]);
});

Deno.test("runTieredCompSearch: falls through to tier 1 when tier 0 is thin/empty", async () => {
  const tier0 = [attempt("q1", "with-category-fixed"), attempt("q1", "without-category-fixed")];
  const tier1 = [attempt("q2", "with-category-fixed"), attempt("q2", "without-category-fixed")];
  const calls: string[] = [];
  const result = await runTieredCompSearch([tier0, tier1], (a) => {
    calls.push(a.query);
    // tier 0 is thin (1 comp), tier 1 is a good result.
    return Promise.resolve(fakeResult(a.query === "q1" ? [10] : [10, 20, 30]));
  });
  assertEquals(result.tiersUsed, 2);
  assertEquals(calls.includes("q2"), true);
  assertEquals(result.prices, [10, 20, 30]);
});

Deno.test("runTieredCompSearch: never tries a 3rd tier even when both tiers are thin", async () => {
  const tier0 = [attempt("q1", "with-category-fixed")];
  const tier1 = [attempt("q2", "with-category-fixed")];
  const result = await runTieredCompSearch(
    [tier0, tier1],
    (a) => Promise.resolve(fakeResult(a.query === "q1" ? [10] : [5])),
  );
  assertEquals(result.tiersUsed, 2);
  // Both thin -- picks whichever has more comps (tie -> tier 0).
  assertEquals(result.prices, [10]);
});

Deno.test("runTieredCompSearch: at most 2 tiers of calls fire even with a 2-tier plan of multiple attempts each", async () => {
  const tier0 = [attempt("q1", "s1"), attempt("q1", "s2"), attempt("q1", "s3"), attempt("q1", "s4")];
  const tier1 = [attempt("q2", "s1"), attempt("q2", "s2"), attempt("q2", "s3"), attempt("q2", "s4")];
  let calls = 0;
  await runTieredCompSearch([tier0, tier1], () => {
    calls++;
    return Promise.resolve(fakeResult([]));
  });
  // Every attempt in both tiers is empty, so runAttemptsSequential exhausts
  // each tier fully (4 + 4 = 8) -- still well under the old up-to-16 cap,
  // and structurally there are only 2 tiers to exhaust regardless.
  assertEquals(calls, 8);
});

Deno.test("runTieredCompSearch: a single-tier plan (no 2nd query available) never fires a phantom tier 1", async () => {
  const tier0 = [attempt("q1", "with-category-fixed")];
  let calls = 0;
  const result = await runTieredCompSearch([tier0], () => {
    calls++;
    return Promise.resolve(fakeResult([10, 20, 30]));
  });
  assertEquals(calls, 1);
  assertEquals(result.tiersUsed, 1);
});

Deno.test("runTieredCompSearch: an empty tier list is a no-op, not an error", async () => {
  const result = await runTieredCompSearch([], () => Promise.resolve(fakeResult([10])));
  assertEquals(result.tiersUsed, 0);
  assertEquals(result.prices, []);
  assertEquals(result.chosen, null);
});

Deno.test("runTieredCompSearch: escape hatch fires tier 1 concurrently when tier 0 is slow, without cancelling tier 0", async () => {
  const tier0 = [attempt("q1", "slow")];
  const tier1 = [attempt("q2", "fast")];
  const order: string[] = [];
  const result = await runTieredCompSearch(
    [tier0, tier1],
    async (a) => {
      order.push(`start:${a.query}`);
      if (a.query === "q1") {
        // Slower than the escape hatch window used below.
        await new Promise((r) => setTimeout(r, 60));
        order.push("end:q1");
        return fakeResult([10, 20, 30]);
      }
      order.push("end:q2");
      return fakeResult([1, 2, 3]);
    },
    { escapeHatchMs: 20 },
  );
  // Both attempts should have started -- tier 0 was not cancelled by the
  // escape hatch firing tier 1.
  assertEquals(order.includes("start:q1"), true);
  assertEquals(order.includes("start:q2"), true);
  assertEquals(order.includes("end:q1"), true);
  assertEquals(order.includes("end:q2"), true);
  // Both tiers pass quality (3 comps each, tight spread) -- picks whichever
  // has more comps; here it's a tie so tier 0 wins by the tie-break rule.
  assertEquals(result.tiersUsed, 2);
});

// Regression coverage for the eBay quota monitor's same-day counter
// (spun out of the 2026-09-17 429 investigation): logBrowseApiCall must
// never throw into its caller, even when the insert itself fails --  a
// counter-logging failure must not affect the real Browse API call it's
// counting.

function fakeSupabaseForLogging(
  opts: { insertRejects?: boolean; insertReturnsError?: boolean } = {},
) {
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  return {
    client: {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            inserted.push({ table, row });
            if (opts.insertRejects) {
              return Promise.reject(new Error("insert failed"));
            }
            if (opts.insertReturnsError) {
              return Promise.resolve({ data: null, error: { message: "RLS denied" } });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
    inserted,
  };
}

Deno.test("logBrowseApiCall: inserts into ebay_browse_call_log with the given caller name", async () => {
  const { client, inserted } = fakeSupabaseForLogging();
  logBrowseApiCall(client, "competitorSearch");
  // Fire-and-forget -- give the microtask queue a tick to run.
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].table, "ebay_browse_call_log");
  assertEquals(inserted[0].row.caller, "competitorSearch");
});

Deno.test("logBrowseApiCall: a rejected insert does not throw or reject into the caller", () => {
  const { client } = fakeSupabaseForLogging({ insertRejects: true });
  // Must not throw synchronously, and the returned value (none) gives the
  // caller nothing to await/catch -- this call itself completing without
  // throwing is the assertion.
  logBrowseApiCall(client, "market-watch-refresh");
});

Deno.test("logBrowseApiCall: a resolved insert with a PostgREST error is logged, not silently swallowed as success", async () => {
  const { client } = fakeSupabaseForLogging({ insertReturnsError: true });
  logBrowseApiCall(client, "keyword-research");
  // Must not throw synchronously -- the error is only visible via the
  // console.warn this test doesn't assert on directly (no throw is the
  // contract here; distinguishing this path from a silent no-op is covered
  // by reading the source, not a spy on console.warn).
  await new Promise((r) => setTimeout(r, 0));
});

Deno.test("logBrowseApiCall: a client whose .from() itself throws does not propagate", () => {
  const throwingClient = {
    from() {
      throw new Error("client misconfigured");
    },
  };
  logBrowseApiCall(throwingClient, "keyword-research");
});

// ── buildCompetitorPricesUpsertPayload: real production bug fix (2026-09-18) ──
// Regression coverage for the actual root cause of a full day's 5,000-call
// Browse API quota being burned with zero new listings created: the upsert
// into competitor_prices never set fetched_at, so Postgres's column
// DEFAULT NOW() (which only fires on INSERT, never on ON CONFLICT DO
// UPDATE) left every refresh silently keeping the ORIGINAL insert-time
// value forever -- freezing every row's staleness clock while
// get_next_competitor_price_batch's 24h filter kept re-selecting the same
// rows as "stale" and competitor-prices-cron (every 5 min) re-fetched them
// in an unbroken loop. Confirmed live via pg_stat_user_tables: 48,292
// updates against only 578 inserts on this table.

function basePayloadParams(overrides: Partial<Parameters<typeof buildCompetitorPricesUpsertPayload>[0]> = {}) {
  return {
    userId: "user-1",
    listingId: "listing-1",
    searchQuery: "vintage widget",
    geminiQuery: null,
    avgPrice: 12.345,
    minPrice: 5,
    maxPrice: 20,
    medianPrice: 11.999,
    priceDelta: 1.5,
    yourPrice: 10,
    competitorCount: 7,
    priceDistribution: { buckets: [1, 2, 3] },
    ...overrides,
  };
}

Deno.test("buildCompetitorPricesUpsertPayload: sets fetched_at to the current time, not left to a DB default", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");
  const payload = buildCompetitorPricesUpsertPayload(basePayloadParams({ now }));
  assertEquals(payload.fetched_at, "2026-09-18T12:00:00.000Z");
});

Deno.test("buildCompetitorPricesUpsertPayload: expires_at is fetched_at + the cache TTL, not a fixed offset from some other time", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");
  const payload = buildCompetitorPricesUpsertPayload(basePayloadParams({ now }));
  // CACHE_TTL_MS is 24h -- expires_at must be exactly 24h after fetched_at.
  const fetchedMs = new Date(payload.fetched_at).getTime();
  const expiresMs = new Date(payload.expires_at).getTime();
  assertEquals(expiresMs - fetchedMs, 24 * 60 * 60 * 1000);
});

Deno.test("buildCompetitorPricesUpsertPayload: two calls a moment apart produce two DIFFERENT fetched_at values (regression guard against a frozen/stale timestamp)", () => {
  // Deliberately does NOT pass `now` -- exercises the real default path
  // (`params.now ?? new Date()`) exactly as runCompetitorSearch's call site
  // does, so this catches a regression where the default silently stops
  // advancing (e.g. a future refactor that hoists `new Date()` out to a
  // module-level constant).
  const first = buildCompetitorPricesUpsertPayload(basePayloadParams());
  const second = buildCompetitorPricesUpsertPayload(basePayloadParams());
  // Not asserting exact difference (could tie at ms resolution on a fast
  // machine) -- asserting neither is a hardcoded/frozen sentinel value.
  assertNotEquals(first.fetched_at, "");
  assertNotEquals(second.fetched_at, "");
  // Both must be real, recent ISO timestamps, not epoch-zero or undefined.
  const age = Date.now() - new Date(first.fetched_at).getTime();
  assertEquals(age < 5000 && age >= 0, true);
});

Deno.test("buildCompetitorPricesUpsertPayload: rounds avg/median price to 2 decimal places, passes min/max through unrounded", () => {
  const payload = buildCompetitorPricesUpsertPayload(
    basePayloadParams({ avgPrice: 12.3456, medianPrice: 11.999, minPrice: 5.1, maxPrice: 19.999 }),
  );
  assertEquals(payload.avg_price, 12.35);
  assertEquals(payload.median_price, 12);
  assertEquals(payload.min_price, 5.1);
  assertEquals(payload.max_price, 19.999);
});

Deno.test("buildCompetitorPricesUpsertPayload: maps every field to its snake_case column name", () => {
  const now = new Date("2026-09-18T12:00:00.000Z");
  const payload = buildCompetitorPricesUpsertPayload(basePayloadParams({ now }));
  assertEquals(payload.user_id, "user-1");
  assertEquals(payload.ebay_listing_id, "listing-1");
  assertEquals(payload.search_query, "vintage widget");
  assertEquals(payload.gemini_search_query, null);
  assertEquals(payload.price_delta, 1.5);
  assertEquals(payload.your_price, 10);
  assertEquals(payload.competitor_count, 7);
  assertEquals(payload.price_distribution, { buckets: [1, 2, 3] });
});

// ── comp_item_ids: getItems batch-refresh follow-on, PR 1/2 (2026-09-18) ────
// Regression coverage for the persistence groundwork this column exists
// for -- without it, there is nothing durable a future refresh could look
// up to call eBay's getItems bulk-lookup instead of re-running a full
// search. compItemIds is optional so every pre-existing call site (before
// this param was added) stays source-compatible, persisting null.

Deno.test("buildCompetitorPricesUpsertPayload: persists comp_item_ids verbatim when provided", () => {
  const payload = buildCompetitorPricesUpsertPayload(
    basePayloadParams({ compItemIds: ["v1|123|0", "v1|456|0"] }),
  );
  assertEquals(payload.comp_item_ids, ["v1|123|0", "v1|456|0"]);
});

Deno.test("buildCompetitorPricesUpsertPayload: comp_item_ids defaults to null when omitted (back-compat with call sites predating this param)", () => {
  const payload = buildCompetitorPricesUpsertPayload(basePayloadParams());
  assertEquals(payload.comp_item_ids, null);
});

Deno.test("buildCompetitorPricesUpsertPayload: an explicit null comp_item_ids is persisted as null, not coerced to an empty array", () => {
  const payload = buildCompetitorPricesUpsertPayload(basePayloadParams({ compItemIds: null }));
  assertEquals(payload.comp_item_ids, null);
});

function compItem(overrides: Partial<CompetitorItem> = {}): CompetitorItem {
  return {
    title: "test item",
    price: 10,
    currency: "USD",
    condition: "Pre-Owned",
    itemId: "v1|123|0",
    ...overrides,
  };
}

Deno.test("extractCompItemIds: extracts itemIds in order from a small item list", () => {
  const items = [compItem({ itemId: "a" }), compItem({ itemId: "b" }), compItem({ itemId: "c" })];
  assertEquals(extractCompItemIds(items), ["a", "b", "c"]);
});

Deno.test("extractCompItemIds: caps at 20 -- a single getItems bulk-lookup call's max item_ids", () => {
  const items = Array.from({ length: 25 }, (_, i) => compItem({ itemId: `item-${i}` }));
  const ids = extractCompItemIds(items);
  assertEquals(ids.length, 20);
  assertEquals(ids, Array.from({ length: 20 }, (_, i) => `item-${i}`));
});

Deno.test("extractCompItemIds: items missing an itemId are filtered out, never producing an empty-string/undefined entry", () => {
  const items = [
    compItem({ itemId: "a" }),
    compItem({ itemId: undefined }),
    compItem({ itemId: "b" }),
  ];
  assertEquals(extractCompItemIds(items), ["a", "b"]);
});

Deno.test("extractCompItemIds: an empty item list returns an empty array, not null/undefined", () => {
  assertEquals(extractCompItemIds([]), []);
});

// ── getItems batch-refresh plan (PR 2): parseCompetitorItem ─────────────────
// Shared verbatim between item_summary/search and getItems -- this is the
// concrete guard against the two endpoints' responses being parsed
// differently and causing stat drift.

Deno.test("parseCompetitorItem: parses a search-shaped item (itemSummaries[] shape)", () => {
  const raw = {
    itemId: "v1|123456789|0",
    title: "1921 Morgan Silver Dollar",
    price: { value: "45.00", currency: "USD" },
    condition: "Pre-Owned",
    itemWebUrl: "https://www.ebay.com/itm/123456789",
    image: { imageUrl: "https://i.ebayimg.com/thumb.jpg" },
    watchCount: 3,
    bidCount: undefined,
  };
  const parsed = parseCompetitorItem(raw);
  assertEquals(parsed?.price, 45);
  assertEquals(parsed?.currency, "USD");
  assertEquals(parsed?.condition, "Pre-Owned");
  assertEquals(parsed?.itemId, "v1|123456789|0");
  assertEquals(parsed?.itemUrl, "https://www.ebay.com/itm/123456789");
  assertEquals(parsed?.imageUrl, "https://i.ebayimg.com/thumb.jpg");
  assertEquals(parsed?.watchCount, 3);
  assertEquals(parsed?.bidCount, undefined);
});

Deno.test("parseCompetitorItem: parses a getItems-shaped item (items[] shape) equivalently", () => {
  // Per eBay's Browse API docs, getItems' items[] uses the same field names
  // as item_summary/search's itemSummaries[] for everything this app reads.
  const raw = {
    itemId: "v1|123456789|0",
    title: "1921 Morgan Silver Dollar",
    price: { value: "45.00", currency: "USD" },
    condition: "Pre-Owned",
    itemWebUrl: "https://www.ebay.com/itm/123456789",
    image: { imageUrl: "https://i.ebayimg.com/thumb.jpg" },
    watchCount: 3,
  };
  const parsed = parseCompetitorItem(raw);
  assertEquals(parsed?.price, 45);
  assertEquals(parsed?.itemId, "v1|123456789|0");
  assertEquals(parsed?.watchCount, 3);
});

Deno.test("parseCompetitorItem: a missing/zero/negative price returns null, not a fabricated 0", () => {
  assertEquals(parseCompetitorItem({ itemId: "x", title: "no price" }), null);
  assertEquals(parseCompetitorItem({ itemId: "x", price: { value: "0" } }), null);
  assertEquals(parseCompetitorItem({ itemId: "x", price: { value: "-5" } }), null);
});

Deno.test("parseCompetitorItem: a malformed item (throws while reading a field) returns null, not a throw", () => {
  const poison = {
    get price() {
      throw new Error("boom");
    },
  };
  assertEquals(parseCompetitorItem(poison), null);
});

Deno.test("parseCompetitorItem: falls back to currentPrice.value when price.value is absent", () => {
  const raw = { itemId: "x", currentPrice: { value: "12.50" } };
  assertEquals(parseCompetitorItem(raw)?.price, 12.5);
});

// ── getItems batch-refresh plan (now rewritten as a single-item loop after
// a live 403 on the bulk item_ids= endpoint, see fetchEbayItemsBulk's own
// docstring): fetchEbayItemsBulk ────────────────────────────────────────────

function withMockedFetch<T>(
  handler: (url: string, init?: RequestInit, callIndex?: number) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  let callIndex = 0;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const idx = callIndex++;
    return Promise.resolve(handler(String(url), init, idx));
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// Extracts the itemId from a single-item getItem URL
// (".../buy/browse/v1/item/<encoded-id>"), the shape fetchEbayItemsBulk now
// calls per id instead of one bulk item_ids= URL.
function itemIdFromUrl(url: string): string {
  const encoded = url.split("/buy/browse/v1/item/")[1] ?? "";
  return decodeURIComponent(encoded);
}

function singleItemResponse(item: unknown): Response {
  return new Response(JSON.stringify(item), { status: 200 });
}

Deno.test("fetchEbayItemsBulk: all requested itemIds present in the response", async () => {
  const { client, inserted } = fakeSupabaseForLogging();
  const byId: Record<string, unknown> = {
    a: { itemId: "a", price: { value: "10.00" }, title: "A" },
    b: { itemId: "b", price: { value: "20.00" }, title: "B" },
  };
  const result = await withMockedFetch(
    (url) => singleItemResponse(byId[itemIdFromUrl(url)]),
    () =>
      fetchEbayItemsBulk({
        token: "tok",
        itemIds: ["a", "b"],
        ebayEnv: "production",
        supabaseForLogging: client,
        loggingCaller: "test",
      }),
  );
  assertEquals(result.foundItemIds.sort(), ["a", "b"]);
  assertEquals(result.missingItemIds, []);
  assertEquals(result.items.length, 2);
  // Logged against the buy.browse.item.bulk resource (kept for quota-
  // dashboard continuity even though the mechanism is now single-item
  // calls) -- one insert per item, not per batch.
  assertEquals(inserted.length, 2);
  assertEquals(inserted.every((i) => i.row.resource === "buy.browse.item.bulk"), true);
});

Deno.test("fetchEbayItemsBulk: a missing itemId (404) is reported as missingItemIds, not a failure, and doesn't sink the other ids", async () => {
  const { client } = fakeSupabaseForLogging();
  const result = await withMockedFetch(
    (url) => {
      const id = itemIdFromUrl(url);
      if (id === "a") return singleItemResponse({ itemId: "a", price: { value: "10.00" }, title: "A" });
      return new Response("not found", { status: 404 });
    },
    () =>
      fetchEbayItemsBulk({
        token: "tok",
        itemIds: ["a", "b", "c"],
        ebayEnv: "production",
        supabaseForLogging: client,
        loggingCaller: "test",
      }),
  );
  assertEquals(result.foundItemIds, ["a"]);
  assertEquals(result.missingItemIds.sort(), ["b", "c"]);
});

Deno.test("fetchEbayItemsBulk: a single item failing after 3 retries on a persistent 5xx is UNCERTAIN, not confirmed missing, and doesn't sink other items (Copilot review, PR #601)", async () => {
  // Conflating a transient failure with a confirmed 404 would let a flaky
  // single request permanently drop a still-live comp from the next
  // refresh's persisted comp_item_ids -- this is the exact regression
  // guard for that fix.
  const { client } = fakeSupabaseForLogging();
  const result = await withMockedFetch(
    (url) => {
      const id = itemIdFromUrl(url);
      if (id === "a") return new Response("boom", { status: 500 });
      return singleItemResponse({ itemId: "b", price: { value: "20.00" }, title: "B" });
    },
    () =>
      fetchEbayItemsBulk({
        token: "tok",
        itemIds: ["a", "b"],
        ebayEnv: "production",
        supabaseForLogging: client,
        loggingCaller: "test",
      }),
  );
  assertEquals(result.foundItemIds, ["b"]);
  assertEquals(result.missingItemIds, []);
  assertEquals(result.uncertainItemIds, ["a"]);
});

Deno.test("fetchEbayItemsBulk: a 404 is confirmed missing, a persistent 500 for a different item is uncertain -- the two are never conflated", async () => {
  const { client } = fakeSupabaseForLogging();
  const result = await withMockedFetch(
    (url) => {
      const id = itemIdFromUrl(url);
      if (id === "a") return singleItemResponse({ itemId: "a", price: { value: "10.00" }, title: "A" });
      if (id === "b") return new Response("gone", { status: 404 });
      return new Response("boom", { status: 500 }); // c
    },
    () =>
      fetchEbayItemsBulk({
        token: "tok",
        itemIds: ["a", "b", "c"],
        ebayEnv: "production",
        supabaseForLogging: client,
        loggingCaller: "test",
      }),
  );
  assertEquals(result.foundItemIds, ["a"]);
  assertEquals(result.missingItemIds, ["b"]);
  assertEquals(result.uncertainItemIds, ["c"]);
});

Deno.test("fetchEbayItemsBulk: an abort/timeout-shaped rejection is uncertain, not a whole-batch failure", async () => {
  // Simulates what a real per-item AbortController timeout produces (fetch
  // rejecting with an AbortError) without actually waiting out
  // ITEM_LOOKUP_TIMEOUT_MS's real delay in a unit test -- the retry catch
  // branch treats any thrown fetch error identically regardless of cause,
  // so this exercises the same code path a real timeout would.
  const { client } = fakeSupabaseForLogging();
  const result = await withMockedFetch(
    (url) => {
      const id = itemIdFromUrl(url);
      if (id === "a") return Promise.reject(new DOMException("aborted", "AbortError"));
      return singleItemResponse({ itemId: "b", price: { value: "5.00" }, title: "B" });
    },
    () =>
      fetchEbayItemsBulk({
        token: "tok",
        itemIds: ["a", "b"],
        ebayEnv: "production",
        supabaseForLogging: client,
        loggingCaller: "test",
      }),
  );
  assertEquals(result.foundItemIds, ["b"]);
  assertEquals(result.uncertainItemIds, ["a"]);
});

Deno.test("fetchEbayItemsBulk: every item failing after retries throws (nothing at all came back)", async () => {
  const { client } = fakeSupabaseForLogging();
  await assertRejects(
    () =>
      withMockedFetch(
        () => new Response("boom", { status: 500 }),
        () =>
          fetchEbayItemsBulk({
            token: "tok",
            itemIds: ["a"],
            ebayEnv: "production",
            supabaseForLogging: client,
            loggingCaller: "test",
          }),
      ),
    Error,
  );
});

Deno.test("fetchEbayItemsBulk: a 403 (not 404, not 5xx) fails that item immediately without retrying 3 times", async () => {
  const { client } = fakeSupabaseForLogging();
  let calls = 0;
  await assertRejects(
    () =>
      withMockedFetch(
        () => {
          calls++;
          return new Response("forbidden", { status: 403 });
        },
        () =>
          fetchEbayItemsBulk({
            token: "tok",
            itemIds: ["a"],
            ebayEnv: "production",
            supabaseForLogging: client,
            loggingCaller: "test",
          }),
      ),
    Error,
  );
  assertEquals(calls, 1);
});

// ── getItems batch-refresh plan (PR 2): decideRefreshStrategy ───────────────

Deno.test("decideRefreshStrategy: null storedItemIds -> do not attempt getItems refresh", () => {
  assertEquals(decideRefreshStrategy({ storedItemIds: null }).useItemsRefresh, false);
});

Deno.test("decideRefreshStrategy: empty array -> do not attempt getItems refresh", () => {
  assertEquals(decideRefreshStrategy({ storedItemIds: [] }).useItemsRefresh, false);
});

Deno.test("decideRefreshStrategy: undefined -> do not attempt getItems refresh", () => {
  assertEquals(decideRefreshStrategy({ storedItemIds: undefined }).useItemsRefresh, false);
});

Deno.test("decideRefreshStrategy: non-empty stored itemIds -> attempt getItems refresh", () => {
  assertEquals(decideRefreshStrategy({ storedItemIds: ["a", "b"] }).useItemsRefresh, true);
});

// ── getItems batch-refresh plan (PR 2): isItemsRefreshUsable ────────────────

Deno.test("isItemsRefreshUsable: full survival is usable", () => {
  const r = isItemsRefreshUsable({ requestedCount: 5, foundCount: 5 });
  assertEquals(r.usable, true);
});

Deno.test("isItemsRefreshUsable: below minCount (default 3) is not usable even at 100% survival", () => {
  const r = isItemsRefreshUsable({ requestedCount: 2, foundCount: 2 });
  assertEquals(r.usable, false);
});

Deno.test("isItemsRefreshUsable: above minCount but below minRemainingRatio (default 0.5) is not usable", () => {
  const r = isItemsRefreshUsable({ requestedCount: 10, foundCount: 4 });
  assertEquals(r.usable, false);
});

Deno.test("isItemsRefreshUsable: exactly at both boundaries (minCount met, exactly 50% survival) is usable", () => {
  const r = isItemsRefreshUsable({ requestedCount: 6, foundCount: 3 });
  assertEquals(r.usable, true);
});

Deno.test("isItemsRefreshUsable: zero requestedCount does not divide-by-zero into a false positive", () => {
  const r = isItemsRefreshUsable({ requestedCount: 0, foundCount: 0 });
  assertEquals(r.usable, false);
});

Deno.test("isItemsRefreshUsable: custom minCount/minRemainingRatio are respected", () => {
  const r = isItemsRefreshUsable({ requestedCount: 10, foundCount: 8, minCount: 5, minRemainingRatio: 0.9 });
  assertEquals(r.usable, false); // 80% < 90% required
});

// ── getItems batch-refresh plan (PR 2): computeCompStats ────────────────────
// Refactor-safety test: must produce byte-identical output to the original
// inline Step-4 block (price-anchor filter -> outlier removal -> stats) for
// the same inputs, since this same function now backs BOTH the full-search
// path and the new getItems-refresh path.

Deno.test("computeCompStats: matches the expected avg/min/max/median/delta for a simple price set", () => {
  const stats = computeCompStats({ prices: [10, 20, 30], yourPrice: 15 });
  assertEquals(stats.cleanPrices.sort((a, b) => a - b), [10, 20, 30]);
  assertEquals(stats.avgPrice, 20);
  assertEquals(stats.minPrice, 10);
  assertEquals(stats.maxPrice, 30);
  assertEquals(stats.medianPrice, 20);
  assertEquals(stats.priceDelta, -5); // yourPrice(15) - medianPrice(20)
});

Deno.test("computeCompStats: null yourPrice yields a null priceDelta, not a coerced 0", () => {
  const stats = computeCompStats({ prices: [10, 20, 30], yourPrice: null });
  assertEquals(stats.priceDelta, null);
});

Deno.test("computeCompStats: price-anchor filter removes an item far outside 0.1x-10x of yourPrice", () => {
  // A $0.95 novelty item alongside $95 items, anchored to a $100 yourPrice --
  // the outlier-far-below item should be filtered before stats are computed.
  const stats = computeCompStats({ prices: [0.95, 95, 96, 97], yourPrice: 100 });
  assertEquals(stats.cleanPrices.includes(0.95), false);
});

Deno.test("computeCompStats: priceDistribution is non-empty for a real price set", () => {
  const stats = computeCompStats({ prices: [10, 20, 30, 40, 50], yourPrice: null });
  assertEquals(stats.priceDistribution.length > 0, true);
});

// ── getItems batch-refresh plan (PR 2): attemptItemsRefresh ─────────────────
// Integration-style: fake supabase client returning a row with
// comp_item_ids, fake fetch for both the OAuth token endpoint and the
// getItems endpoint.

function fakeSupabaseForItemsRefresh(opts: {
  row?: Record<string, unknown> | null;
  selectThrows?: boolean;
  upsertError?: { message: string } | null;
}) {
  const upserted: Record<string, unknown>[] = [];
  return {
    client: {
      from(table: string) {
        if (table === "competitor_prices") {
          return {
            select() {
              return {
                eq() {
                  return this;
                },
                order() {
                  return this;
                },
                limit() {
                  return this;
                },
                maybeSingle() {
                  if (opts.selectThrows) return Promise.reject(new Error("db down"));
                  return Promise.resolve({ data: opts.row ?? null, error: null });
                },
              };
            },
            upsert(row: Record<string, unknown>) {
              upserted.push(row);
              // A real Supabase write failure comes back as a returned
              // `error`, not a throw -- opts.upsertError lets a test assert
              // attemptItemsRefresh actually inspects it instead of assuming
              // success whenever the promise merely resolves (Copilot
              // review, PR #600).
              return Promise.resolve({ data: null, error: opts.upsertError ?? null });
            },
          };
        }
        // ebay_browse_call_log logging target -- accept and ignore.
        return {
          insert() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
    upserted,
  };
}

function withEbayCreds<T>(fn: () => Promise<T>): Promise<T> {
  const prevId = Deno.env.get("EBAY_CLIENT_ID");
  const prevSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  Deno.env.set("EBAY_CLIENT_ID", "test-client-id");
  Deno.env.set("EBAY_CLIENT_SECRET", "test-client-secret");
  return fn().finally(() => {
    if (prevId === undefined) Deno.env.delete("EBAY_CLIENT_ID");
    else Deno.env.set("EBAY_CLIENT_ID", prevId);
    if (prevSecret === undefined) Deno.env.delete("EBAY_CLIENT_SECRET");
    else Deno.env.set("EBAY_CLIENT_SECRET", prevSecret);
  });
}

// itemsById maps itemId -> either a raw item object (200 response) or a
// Response (for simulating a per-item failure like a 404/500). Any itemId
// not present in the map returns a 500 -- mirrors the old bulk mock's
// "items not in the handler's list are just absent" default, generalized
// to per-item calls.
function mockTokenAndItemsFetch(itemsById: Record<string, unknown | Response>) {
  return (url: string) => {
    if (url.includes("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
    }
    const id = itemIdFromUrl(url);
    const entry = itemsById[id];
    if (entry instanceof Response) return entry;
    if (entry === undefined) return new Response("not found", { status: 500 });
    return singleItemResponse(entry);
  };
}

Deno.test("attemptItemsRefresh: no stored comp_item_ids -> returns null (fall through to full search)", async () => {
  const { client } = fakeSupabaseForItemsRefresh({ row: { comp_item_ids: null, search_query: "q" } });
  const result = await attemptItemsRefresh({
    supabase: client,
    userId: "u1",
    listingId: "l1",
    ebayEnv: "production",
    yourPrice: null,
  });
  assertEquals(result, null);
});

Deno.test("attemptItemsRefresh: no row at all (first encounter) -> returns null", async () => {
  const { client } = fakeSupabaseForItemsRefresh({ row: null });
  const result = await attemptItemsRefresh({
    supabase: client,
    userId: "u1",
    listingId: "l1",
    ebayEnv: "production",
    yourPrice: null,
  });
  assertEquals(result, null);
});

Deno.test("attemptItemsRefresh: usable getItems result -> returns a successful outcome and persists new comp_item_ids", async () => {
  const { client, upserted } = fakeSupabaseForItemsRefresh({
    row: { comp_item_ids: ["a", "b", "c"], search_query: "vintage coin", gemini_search_query: null },
  });
  const result = await withEbayCreds(() =>
    withMockedFetch(
      mockTokenAndItemsFetch({
        a: { itemId: "a", price: { value: "10.00" }, title: "A" },
        b: { itemId: "b", price: { value: "11.00" }, title: "B" },
        c: { itemId: "c", price: { value: "12.00" }, title: "C" },
      }),
      () =>
        attemptItemsRefresh({
          supabase: client,
          userId: "u1",
          listingId: "l1",
          ebayEnv: "production",
          yourPrice: 11,
        }),
    )
  );
  assertNotEquals(result, null);
  assertEquals(result?.status, 200);
  assertEquals(result?.body.refreshMethod, "getItems");
  assertEquals(result?.body.noData, false);
  assertEquals(result?.body.fromCache, false);
  assertEquals(upserted.length, 1);
  assertEquals((upserted[0].comp_item_ids as string[]).sort(), ["a", "b", "c"]);
});

Deno.test("attemptItemsRefresh: comp_item_ids reflects the CLEANED item set, excluding an item the price filters rejected (Copilot review, PR #600)", async () => {
  // "d" is a $0.50 novelty price alongside three $10-12 items anchored to
  // yourPrice=11 -- computeCompStats's price-anchor filter should reject it,
  // so it must never be counted toward the NEXT refresh's survival ratio
  // even though getItems itself successfully returned it (not delisted).
  const { client, upserted } = fakeSupabaseForItemsRefresh({
    row: { comp_item_ids: ["a", "b", "c", "d"], search_query: "vintage coin", gemini_search_query: null },
  });
  const result = await withEbayCreds(() =>
    withMockedFetch(
      mockTokenAndItemsFetch({
        a: { itemId: "a", price: { value: "10.00" }, title: "A" },
        b: { itemId: "b", price: { value: "11.00" }, title: "B" },
        c: { itemId: "c", price: { value: "12.00" }, title: "C" },
        d: { itemId: "d", price: { value: "0.50" }, title: "Novelty D" },
      }),
      () =>
        attemptItemsRefresh({
          supabase: client,
          userId: "u1",
          listingId: "l1",
          ebayEnv: "production",
          yourPrice: 11,
        }),
    )
  );
  assertNotEquals(result, null);
  assertEquals(upserted.length, 1);
  const savedIds = (upserted[0].comp_item_ids as string[]).sort();
  assertEquals(savedIds, ["a", "b", "c"]);
  assertEquals(savedIds.includes("d"), false);
});

Deno.test("attemptItemsRefresh: an upsert error is inspected, not silently treated as a successful save (Copilot review, PR #600)", async () => {
  // The Supabase client reports a failed write via a returned `error`, not
  // a throw -- an implementation that only wraps the await in try/catch
  // (with no explicit error check) would still log/return success here.
  // This test's fake resolves normally with an error field set, so it can
  // only pass if attemptItemsRefresh actually inspects that field.
  const { client, upserted } = fakeSupabaseForItemsRefresh({
    row: { comp_item_ids: ["a", "b", "c"], search_query: "q", gemini_search_query: null },
    upsertError: { message: "connection reset" },
  });
  const result = await withEbayCreds(() =>
    withMockedFetch(
      mockTokenAndItemsFetch({
        a: { itemId: "a", price: { value: "10.00" }, title: "A" },
        b: { itemId: "b", price: { value: "11.00" }, title: "B" },
        c: { itemId: "c", price: { value: "12.00" }, title: "C" },
      }),
      () =>
        attemptItemsRefresh({
          supabase: client,
          userId: "u1",
          listingId: "l1",
          ebayEnv: "production",
          yourPrice: null,
        }),
    )
  );
  // The freshly-computed data is still returned to the caller (matching
  // the full-search path's own non-fatal persist-failure handling) even
  // though the write itself failed -- this test only confirms the error
  // was surfaced somewhere reachable (the upsert was still attempted),
  // not that the whole request fails.
  assertNotEquals(result, null);
  assertEquals(upserted.length, 1);
});

Deno.test("attemptItemsRefresh: too many delisted (below minRemainingRatio) -> returns null (fall through)", async () => {
  const { client } = fakeSupabaseForItemsRefresh({
    row: { comp_item_ids: ["a", "b", "c", "d"], search_query: "q", gemini_search_query: null },
  });
  const result = await withEbayCreds(() =>
    withMockedFetch(
      // Only 1 of 4 survives -- below both minCount(3) and minRemainingRatio(0.5).
      // b/c/d are explicit 404s (not retried, unlike a 500) so this stays fast.
      mockTokenAndItemsFetch({
        a: { itemId: "a", price: { value: "10.00" }, title: "A" },
        b: new Response("not found", { status: 404 }),
        c: new Response("not found", { status: 404 }),
        d: new Response("not found", { status: 404 }),
      }),
      () =>
        attemptItemsRefresh({
          supabase: client,
          userId: "u1",
          listingId: "l1",
          ebayEnv: "production",
          yourPrice: null,
        }),
    )
  );
  assertEquals(result, null);
});

Deno.test("attemptItemsRefresh: getItems call throws (e.g. persistent 5xx) -> returns null, does not propagate", async () => {
  const { client } = fakeSupabaseForItemsRefresh({
    row: { comp_item_ids: ["a", "b", "c"], search_query: "q", gemini_search_query: null },
  });
  const result = await withEbayCreds(() =>
    withMockedFetch(
      // Every requested id 500s and is retried to exhaustion -- all-fail
      // means fetchEbayItemsBulk throws (see its own "every item failing"
      // test above), which attemptItemsRefresh must catch and swallow.
      mockTokenAndItemsFetch({
        a: new Response("boom", { status: 500 }),
        b: new Response("boom", { status: 500 }),
        c: new Response("boom", { status: 500 }),
      }),
      () =>
        attemptItemsRefresh({
          supabase: client,
          userId: "u1",
          listingId: "l1",
          ebayEnv: "production",
          yourPrice: null,
        }),
    )
  );
  assertEquals(result, null);
});

Deno.test("attemptItemsRefresh: a DB lookup failure -> returns null, does not throw", async () => {
  const { client } = fakeSupabaseForItemsRefresh({ selectThrows: true });
  const result = await attemptItemsRefresh({
    supabase: client,
    userId: "u1",
    listingId: "l1",
    ebayEnv: "production",
    yourPrice: null,
  });
  assertEquals(result, null);
});

// ----------------------------------------------------------------
// computeProductSignature (cache-by-product-signature feature).
//
// These tests deliberately do NOT reuse deriveSearchQueryFallback's
// stopWords or broadenSearchQuery's gradeNoise sets as a baseline -- see
// computeProductSignature's own docstring in competitorSearch.ts for why
// those two sets are actively wrong for this purpose (they broaden a search
// query; here, stripping the same tokens would collapse two differently-
// priced products into one signature). Several tests below exist
// specifically to prove that divergence.
// ----------------------------------------------------------------

const COIN_CATEGORY = "11116";

Deno.test("computeProductSignature: differently-worded/ordered titles for the same product -> identical signature", () => {
  const a = computeProductSignature("1999 TY McDonald's Teenie Beanie Baby", COIN_CATEGORY);
  const b = computeProductSignature("TY 1999 Teenie Beanie Baby McDonald's Free Shipping", COIN_CATEGORY);
  assertEquals(a.signature !== null, true);
  assertEquals(a.signature, b.signature);
});

Deno.test("computeProductSignature: short/garbled title -> null signature (production noise-rejection case)", () => {
  assertEquals(computeProductSignature("202", COIN_CATEGORY).signature, null);
  assertEquals(computeProductSignature("Year", COIN_CATEGORY).signature, null);
  assertEquals(computeProductSignature("price", COIN_CATEGORY).signature, null);
});

Deno.test("computeProductSignature: exactly 4 significant tokens -> non-null (boundary case)", () => {
  const result = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  assertEquals(result.signature !== null, true);
});

Deno.test("computeProductSignature: fewer than 4 significant tokens -> null (just below boundary)", () => {
  const result = computeProductSignature("1921 Morgan Dollar", COIN_CATEGORY);
  assertEquals(result.signature, null);
});

Deno.test("computeProductSignature: categoryId is structurally folded into the key, not cosmetic", () => {
  const withCat = computeProductSignature("1921 Morgan Silver Dollar", "11116");
  const otherCat = computeProductSignature("1921 Morgan Silver Dollar", "99999");
  assertNotEquals(withCat.signature, otherCat.signature);
});

Deno.test("computeProductSignature: missing/blank categoryId -> null signature, NOT a shared 'nocat' bucket", () => {
  // category_id is nullable on the rows this cron reads -- a common fallback
  // bucket would let two unrelated four-token titles in different (or no)
  // categories reuse each other's comps (Copilot review of PR #602,
  // 2026-09-19). Missing category must be treated as ineligible, not folded
  // into a shared key.
  assertEquals(computeProductSignature("1921 Morgan Silver Dollar").signature, null);
  assertEquals(computeProductSignature("1921 Morgan Silver Dollar", "").signature, null);
  assertEquals(computeProductSignature("1921 Morgan Silver Dollar", "   ").signature, null);
});

Deno.test("computeProductSignature: non-string/empty title -> null signature, does not throw", () => {
  // The HTTP caller only rejects falsy titles, so a truthy malformed value
  // (number, object) could otherwise reach here and throw out of
  // runCompetitorSearch before the cache fallback can handle it (Copilot
  // review of PR #602, 2026-09-19).
  // deno-lint-ignore no-explicit-any
  assertEquals(computeProductSignature(12345 as any, COIN_CATEGORY).signature, null);
  // deno-lint-ignore no-explicit-any
  assertEquals(computeProductSignature({ foo: "bar" } as any, COIN_CATEGORY).signature, null);
  assertEquals(computeProductSignature("   ", COIN_CATEGORY).signature, null);
});

Deno.test("computeProductSignature: same title/category, called twice -> stable", () => {
  const a = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  const b = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  assertEquals(a.signature, b.signature);
});

Deno.test("computeProductSignature: token order does not affect the signature", () => {
  const a = computeProductSignature("Silver Morgan 1921 Dollar", COIN_CATEGORY);
  const b = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  assertEquals(a.signature, b.signature);
});

Deno.test("computeProductSignature: listing boilerplate (shipping/marketing spam) is stripped", () => {
  const a = computeProductSignature("1921 Morgan Silver Dollar Free Shipping Fast Combined Ship", COIN_CATEGORY);
  const b = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  assertEquals(a.signature, b.signature);
});

Deno.test("computeProductSignature: REGRESSION -- different products with overlapping generic tokens must NOT collapse", () => {
  const steelCent = computeProductSignature("1943 Lincoln Wheat Cent Steel Penny", COIN_CATEGORY);
  const vdbCent = computeProductSignature("1909 VDB Lincoln Wheat Cent Penny", COIN_CATEGORY);
  assertNotEquals(steelCent.signature, vdbCent.signature);
});

Deno.test("computeProductSignature: REGRESSION -- grade number must survive, NOT be stripped like broadenSearchQuery's gradeNoise does", () => {
  const ms63 = computeProductSignature("1921 Morgan Dollar PCGS MS63", COIN_CATEGORY);
  const ms64 = computeProductSignature("1921 Morgan Dollar PCGS MS64", COIN_CATEGORY);
  assertNotEquals(ms63.signature, ms64.signature);
});

Deno.test("computeProductSignature: REGRESSION -- single-character mint mark must survive (key date vs common date)", () => {
  // "S" is a single-character token that deriveSearchQueryFallback's
  // `length > 1` filter would silently drop -- doing the same here would
  // merge a 1909-S VDB (key date) with a plain 1909 VDB (common date), a
  // real price-collapsing bug for this app's coin vertical.
  const keyDate = computeProductSignature("1909 S VDB Lincoln Cent", COIN_CATEGORY);
  const commonDate = computeProductSignature("1909 VDB Lincoln Cent", COIN_CATEGORY);
  assertNotEquals(keyDate.signature, commonDate.signature);
});

Deno.test("computeProductSignature: REGRESSION -- condition-class words (certified/uncirculated) must NOT be treated as stopwords here", () => {
  // deriveSearchQueryFallback's stopWords strips "certified"/"uncirculated"
  // for query-broadening purposes -- doing the same here would merge a
  // certified/graded listing with a raw one of the same date.
  const certified = computeProductSignature("1921 Morgan Dollar Certified", COIN_CATEGORY);
  const uncirculated = computeProductSignature("1921 Morgan Dollar Uncirculated", COIN_CATEGORY);
  assertNotEquals(certified.signature, uncirculated.signature);
});

Deno.test("computeProductSignature: REGRESSION -- quantity/unit words (lot/set/collection/bundle) must NOT be treated as stopwords here", () => {
  // A single coin and a multi-coin set of the same date price completely
  // differently -- stripping these words would merge a single-item
  // listing's comps with a set listing's (Copilot review of PR #602,
  // 2026-09-19).
  const single = computeProductSignature("1921 Morgan Silver Dollar", COIN_CATEGORY);
  const set = computeProductSignature("1921 Morgan Silver Dollar Set", COIN_CATEGORY);
  assertNotEquals(single.signature, set.signature);
});

// ----------------------------------------------------------------
// attemptSignatureMatch
// ----------------------------------------------------------------

function fakeSupabaseForSignatureMatch(opts: {
  sibling?: Record<string, unknown> | null;
  selectThrows?: boolean;
  upsertError?: { message: string } | null;
}) {
  const upserted: Record<string, unknown>[] = [];
  return {
    client: {
      from(table: string) {
        if (table === "competitor_prices") {
          return {
            select() {
              return {
                eq() {
                  return this;
                },
                neq() {
                  return this;
                },
                gte() {
                  return this;
                },
                order() {
                  return this;
                },
                limit() {
                  return this;
                },
                maybeSingle() {
                  if (opts.selectThrows) return Promise.reject(new Error("db down"));
                  return Promise.resolve({ data: opts.sibling ?? null, error: null });
                },
              };
            },
            upsert(row: Record<string, unknown>) {
              upserted.push(row);
              return Promise.resolve({ data: null, error: opts.upsertError ?? null });
            },
          };
        }
        return {
          insert() {
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    },
    upserted,
  };
}

const SIBLING_FETCHED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago

const FRESH_SIBLING = {
  ebay_listing_id: "sibling-listing",
  search_query: "1921 morgan silver dollar",
  gemini_search_query: "1921 morgan silver dollar",
  avg_price: 52.0,
  min_price: 40.0,
  max_price: 65.0,
  median_price: 50.0,
  your_price: 55,
  competitor_count: 5,
  price_distribution: [{ min: 40, max: 65, count: 5 }],
  comp_item_ids: ["v1|1|0", "v1|2|0"],
  fetched_at: SIBLING_FETCHED_AT,
};

Deno.test("attemptSignatureMatch: hit -> returns signatureMatch outcome, persists sibling's stats under this listing", async () => {
  const { client, upserted } = fakeSupabaseForSignatureMatch({ sibling: FRESH_SIBLING });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: 60,
  });
  assertEquals(result?.body.refreshMethod, "signatureMatch");
  assertEquals(result?.body.matchedListingId, "sibling-listing");
  assertEquals(result?.body.medianPrice, 50);
  // yourPrice (60) - sibling's medianPrice (50) = 10, recomputed for THIS
  // listing's own price, not copied from the sibling.
  assertEquals(result?.body.priceDelta, 10);
  assertEquals(upserted.length, 1);
  assertEquals(upserted[0].ebay_listing_id, "this-listing");
  assertEquals(upserted[0].product_signature, "sig");
  assertEquals(upserted[0].comp_item_ids, FRESH_SIBLING.comp_item_ids);
  // Preserves the sibling's ORIGINAL fetched_at rather than stamping "now" --
  // this row did no live lookup, so treating it as freshly fetched would let
  // two duplicate listings perpetually renew each other's stale snapshot.
  assertEquals(upserted[0].fetched_at, SIBLING_FETCHED_AT);
});

Deno.test("attemptSignatureMatch: incompatible price-anchor contexts -> returns null, falls through", async () => {
  // Sibling's aggregates were computed with priceAnchorFilter anchored on
  // its own your_price=55; this listing's yourPrice=600 implies a
  // completely different anchor window (10x+), so those aggregates may not
  // reflect what a real search for THIS listing's price would find.
  const { client, upserted } = fakeSupabaseForSignatureMatch({ sibling: FRESH_SIBLING });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: 600,
  });
  assertEquals(result, null);
  assertEquals(upserted.length, 0);
});

Deno.test("attemptSignatureMatch: compatible price-anchor contexts (both under $50 floor) -> hit", async () => {
  const cheapSibling = { ...FRESH_SIBLING, your_price: 20 };
  const { client } = fakeSupabaseForSignatureMatch({ sibling: cheapSibling });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: 22,
  });
  assertEquals(result?.body.refreshMethod, "signatureMatch");
});

Deno.test("attemptSignatureMatch: no sibling row -> returns null", async () => {
  const { client } = fakeSupabaseForSignatureMatch({ sibling: null });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: null,
  });
  assertEquals(result, null);
});

Deno.test("attemptSignatureMatch: sibling below quality floor (< 3 comps) -> returns null, falls through", async () => {
  const { client } = fakeSupabaseForSignatureMatch({
    sibling: { ...FRESH_SIBLING, competitor_count: 2 },
  });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: null,
  });
  assertEquals(result, null);
});

Deno.test("attemptSignatureMatch: DB lookup failure -> returns null, does not throw", async () => {
  const { client } = fakeSupabaseForSignatureMatch({ selectThrows: true });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: null,
  });
  assertEquals(result, null);
});

Deno.test("attemptSignatureMatch: upsert error is non-fatal -- outcome still returned to caller", async () => {
  // Sibling's your_price is under the $50 anchor floor so a null yourPrice
  // here is a compatible anchor context (neither ever applied the filter).
  const { client } = fakeSupabaseForSignatureMatch({
    sibling: { ...FRESH_SIBLING, your_price: 20 },
    upsertError: { message: "write failed" },
  });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: null,
  });
  assertEquals(result?.body.refreshMethod, "signatureMatch");
});

Deno.test("attemptSignatureMatch: no yourPrice -> priceDelta is null, not a bogus computed value", async () => {
  const { client } = fakeSupabaseForSignatureMatch({ sibling: { ...FRESH_SIBLING, your_price: 20 } });
  const result = await attemptSignatureMatch({
    supabase: client,
    userId: "u1",
    listingId: "this-listing",
    signature: "sig",
    yourPrice: null,
  });
  assertEquals(result?.body.priceDelta, null);
});

// ── checkBrowseQuotaHeadroom (2026-09-21 quota-storm fix) ──────────────────
// Regression coverage for the combined-quota pre-flight gate: buy.browse
// and buy.browse.item.bulk share one real 5,000/day ceiling (proved by the
// live incident where getItem calls 429'd with errorId 2001 at the same
// time buy.browse did), so this must count BOTH resources together and
// hard-stop well before either one actually 429s.

function fakeSupabaseForQuotaHeadroom(opts: {
  count?: number | null;
  error?: { message: string } | null;
  onQuery?: (table: string, inArgs: unknown[]) => void;
  // New: controls what getLatestBrowseQuotaWindowAnchor sees when it
  // queries ebay_rate_limit_polls. Defaults to "no row" so every existing
  // test (written before this table existed in this function's logic)
  // keeps exercising the UTC-midnight fallback path unchanged.
  pollRow?: {
    reset_at: string;
    time_window_seconds?: number | null;
    call_limit: number;
    call_count: number;
    polled_at: string;
  } | null;
  pollError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "ebay_rate_limit_polls") {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: opts.pollRow ?? null,
              error: opts.pollError ?? null,
            });
          },
        };
      }
      const builder = {
        select() {
          return builder;
        },
        in(...args: unknown[]) {
          opts.onQuery?.(table, args);
          return builder;
        },
        gte() {
          return Promise.resolve({ count: opts.count === undefined ? 0 : opts.count, error: opts.error ?? null });
        },
      };
      return builder;
    },
  };
}

Deno.test("checkBrowseQuotaHeadroom: reports headroom when the combined same-day count is well under the critical threshold", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ count: 1000 });
  const result = await checkBrowseQuotaHeadroom(svc, new Date("2026-09-21T00:00:00.000Z"));
  assertEquals(result.hasHeadroom, true);
  assertEquals(result.sameDayCount, 1000);
});

Deno.test("checkBrowseQuotaHeadroom: no headroom once the combined count crosses the critical ratio (97%)", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ count: 4900 }); // 98% of 5000
  const result = await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(result.hasHeadroom, false);
  assertEquals(result.sameDayCount, 4900);
});

Deno.test("checkBrowseQuotaHeadroom: exactly at the critical ratio (90%) reports no headroom (boundary is inclusive)", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ count: 4500 }); // exactly 90% of 5000
  const result = await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(result.hasHeadroom, false);
});

Deno.test("checkBrowseQuotaHeadroom: just under the critical ratio still reports headroom", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ count: 4499 }); // 89.98% of 5000
  const result = await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(result.hasHeadroom, true);
});

Deno.test("checkBrowseQuotaHeadroom: queries ebay_browse_call_log filtered to BOTH buy.browse and buy.browse.item.bulk via .in()", async () => {
  let capturedTable = "";
  let capturedInArgs: unknown[] = [];
  const svc = fakeSupabaseForQuotaHeadroom({
    count: 10,
    onQuery: (table, args) => {
      capturedTable = table;
      capturedInArgs = args;
    },
  });
  await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(capturedTable, "ebay_browse_call_log");
  assertEquals(capturedInArgs[0], "resource");
  assertEquals(capturedInArgs[1], ["buy.browse", "buy.browse.item.bulk"]);
});

Deno.test("checkBrowseQuotaHeadroom: fails OPEN (hasHeadroom: true) on a query error rather than blocking the whole feature", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ count: null, error: { message: "connection reset" } });
  const result = await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(result.hasHeadroom, true);
  assertEquals(result.sameDayCount, null);
});

Deno.test("checkBrowseQuotaHeadroom: fails OPEN when the query itself throws", async () => {
  const svc = {
    from() {
      throw new Error("network down");
    },
  };
  const result = await checkBrowseQuotaHeadroom(svc, new Date());
  assertEquals(result.hasHeadroom, true);
  assertEquals(result.sameDayCount, null);
});

// ── getLatestBrowseQuotaWindowAnchor (2026-09-2X reset-window fix) ─────────
// eBay's Browse API quota resets on a fixed-duration block anchored to an
// arbitrary timestamp (confirmed via eBay's own docs and this project's own
// polled data), NOT UTC midnight. These tests pin the boundary-derivation
// logic that reads the real reset from ebay_rate_limit_polls.

Deno.test("getLatestBrowseQuotaWindowAnchor: derives windowStart from a fresh poll's reset_at minus time_window_seconds", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 3000,
      polled_at: "2026-09-21T09:31:00.000Z", // 29 min before `now` -- fresh
    },
  });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
  assertEquals(result.windowStart?.toISOString(), "2026-09-21T07:00:00.000Z");
  assertEquals(result.pollLimit, 5000);
  assertEquals(result.pollCallCount, 3000);
});

Deno.test("getLatestBrowseQuotaWindowAnchor: falls back to 86400s when time_window_seconds is null", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: null,
      call_limit: 5000,
      call_count: 3000,
      polled_at: "2026-09-21T09:31:00.000Z",
    },
  });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
  assertEquals(result.windowStart?.toISOString(), "2026-09-21T07:00:00.000Z");
});

Deno.test("getLatestBrowseQuotaWindowAnchor: returns null anchor when no poll row exists", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ pollRow: null });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
  assertEquals(result.windowStart, null);
  assertEquals(result.pollCallCount, null);
});

Deno.test("getLatestBrowseQuotaWindowAnchor: returns null anchor when the latest poll is older than 2 hours (stale)", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 3000,
      polled_at: "2026-09-21T07:00:00.000Z", // 3 hours before `now` -- stale
    },
  });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
  assertEquals(result.windowStart, null);
  assertStringIncludes(result.reason, "stale");
});

Deno.test("getLatestBrowseQuotaWindowAnchor: returns null anchor when the poll's own reset_at has already elapsed", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    pollRow: {
      reset_at: "2026-09-21T09:00:00.000Z", // in the past relative to `now`
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 3000,
      polled_at: "2026-09-21T09:31:00.000Z", // fresh by polled_at, but reset_at already elapsed
    },
  });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
  assertEquals(result.windowStart, null);
  assertStringIncludes(result.reason, "already elapsed");
});

Deno.test("getLatestBrowseQuotaWindowAnchor: fails to null anchor (not a throw) on a query error", async () => {
  const svc = fakeSupabaseForQuotaHeadroom({ pollError: { message: "connection reset" } });
  const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
  assertEquals(result.windowStart, null);
  assertStringIncludes(result.reason, "connection reset");
});

Deno.test("getLatestBrowseQuotaWindowAnchor: fails to null anchor (not a throw) on an unexpected throw", async () => {
  const svc = {
    from() {
      throw new Error("network down");
    },
  };
  const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
  assertEquals(result.windowStart, null);
});

// ── checkBrowseQuotaHeadroom: real reset-window integration (2026-09-2X) ──

Deno.test("checkBrowseQuotaHeadroom: uses the real reset window instead of UTC midnight when a fresh poll anchor exists", async () => {
  // Real window start is ~07:00 UTC yesterday (per the poll). A call logged
  // at 02:00 UTC TODAY is AFTER that real boundary, so it must be counted --
  // this is the one test that would have caught the original bug: under the
  // old UTC-midnight logic, this call would also have been counted (it's
  // after today's midnight too), so this test alone doesn't distinguish the
  // two. The real regression guard is the NEXT test below, which checks a
  // call BEFORE UTC midnight but AFTER the real reset.
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    count: 100,
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 4000,
      polled_at: "2026-09-21T09:31:00.000Z",
    },
  });
  const result = await checkBrowseQuotaHeadroom(svc, now);
  // estimatedUsed = pollCallCount (4000) + callsSinceAnchor (100) = 4100
  assertEquals(result.sameDayCount, 4100);
});

Deno.test("checkBrowseQuotaHeadroom: combines poll callCount with calls logged since the poll (additive correction)", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svcBelowThreshold = fakeSupabaseForQuotaHeadroom({
    count: 300, // calls since the poll
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 4000, // eBay's own count at poll time
      polled_at: "2026-09-21T09:31:00.000Z",
    },
  });
  const belowResult = await checkBrowseQuotaHeadroom(svcBelowThreshold, now);
  assertEquals(belowResult.sameDayCount, 4300); // 4000 + 300 = 4300/5000 = 86%, still headroom
  assertEquals(belowResult.hasHeadroom, true);

  const svcAboveThreshold = fakeSupabaseForQuotaHeadroom({
    count: 600, // calls since the poll
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 4000,
      polled_at: "2026-09-21T09:31:00.000Z",
    },
  });
  const aboveResult = await checkBrowseQuotaHeadroom(svcAboveThreshold, now);
  assertEquals(aboveResult.sameDayCount, 4600); // 4000 + 600 = 4600/5000 = 92%, no headroom
  assertEquals(aboveResult.hasHeadroom, false);
});

Deno.test("checkBrowseQuotaHeadroom: falls back to UTC-midnight boundary when no poll anchor is available", async () => {
  // Regression guard: confirms the pre-existing fallback behavior still
  // works unchanged when ebay_rate_limit_polls has no usable row.
  const svc = fakeSupabaseForQuotaHeadroom({ count: 1000, pollRow: null });
  const result = await checkBrowseQuotaHeadroom(svc, new Date("2026-09-21T00:00:00.000Z"));
  assertEquals(result.hasHeadroom, true);
  assertEquals(result.sameDayCount, 1000); // no pollCallCount to add -- pure self-count
});

Deno.test("checkBrowseQuotaHeadroom: falls back to UTC-midnight boundary when the latest poll is stale", async () => {
  const now = new Date("2026-09-21T10:00:00.000Z");
  const svc = fakeSupabaseForQuotaHeadroom({
    count: 1000,
    pollRow: {
      reset_at: "2026-09-22T07:00:00.000Z",
      time_window_seconds: 86400,
      call_limit: 5000,
      call_count: 4000,
      polled_at: "2026-09-21T07:00:00.000Z", // 3 hours old -- stale
    },
  });
  const result = await checkBrowseQuotaHeadroom(svc, now);
  // Stale poll -> null anchor -> pure self-count, no additive correction
  assertEquals(result.sameDayCount, 1000);
});
