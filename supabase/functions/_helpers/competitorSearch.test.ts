import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CompSearchAttemptResult,
  evaluateCompQuality,
  groupPlanIntoTiers,
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

Deno.test("runAttemptsSequential: stops at the first non-empty result", async () => {
  const calls: string[] = [];
  const attempts = [attempt("a", "s1"), attempt("b", "s2"), attempt("c", "s3")];
  const { result, chosen } = await runAttemptsSequential(attempts, (a) => {
    calls.push(a.query);
    return Promise.resolve(fakeResult(a.query === "b" ? [10, 20] : []));
  });
  assertEquals(calls, ["a", "b"]);
  assertEquals(result.prices, [10, 20]);
  assertEquals(chosen?.query, "b");
});

Deno.test("runAttemptsSequential: all-empty attempts yields a null chosen attempt", async () => {
  const attempts = [attempt("a", "s1"), attempt("b", "s2")];
  const { result, chosen } = await runAttemptsSequential(attempts, () => Promise.resolve(fakeResult([])));
  assertEquals(result.prices, []);
  assertEquals(chosen, null);
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
