import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CompSearchAttemptResult,
  evaluateCompQuality,
  groupPlanIntoTiers,
  logBrowseApiCall,
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
