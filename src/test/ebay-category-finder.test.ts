/**
 * ebay-category-finder.test.ts
 *
 * Regression coverage for the eBay category resolver.
 *
 * HISTORY: this file used to replicate a score-based winner-selection
 * algorithm (computeEffectiveScore / SOURCE_WEIGHTS / DETERMINISTIC_LOCK_THRESHOLD)
 * because the Deno edge function couldn't be imported from Vitest. As of the
 * Category Resolver v2 "filter-then-rank" rewrite
 * (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md \u00a72), that scoring model has
 * been deleted from production code entirely (supabase/functions/category-lookup/index.ts)
 * in favour of a pure-precedence model with no arithmetic.
 *
 * The precedence/agreement logic now lives in a dependency-free module,
 * supabase/functions/category-lookup/resolverCore.ts, which has NO Deno-only
 * APIs (no `Deno.*`, no network/Supabase calls) \u2014 so it can be imported
 * directly here and tested against the SAME production code that
 * `deno test` exercises in supabase/functions/category-lookup/resolverCore.test.ts.
 * This avoids the old duplication problem where the test suite could pass
 * while asserting on logic that no longer existed anywhere in the app.
 *
 * The gate functions themselves (leaf/active cache lookup, condition-policy
 * fetch, aspect-satisfiability check) DO perform network/Supabase I/O and
 * live in index.ts \u2014 they are covered by the Deno-side corpus replay
 * (scripts/replay-corpus.mjs) and manual/integration verification instead,
 * per the plan's phasing.
 */

import { describe, expect, it } from "vitest";
import {
  type GatedCandidate,
  selectWinner,
} from "../../supabase/functions/category-lookup/resolverCore.ts";

function candidate(overrides: Partial<GatedCandidate> = {}): GatedCandidate {
  return {
    categoryId: "12345",
    categoryName: "Test Category",
    breadcrumb: "Domain > Sub > Test Category",
    source: "ebay_api",
    rank: 1,
    survived: true,
    dropReason: null,
    gate4Warnings: [],
    reason: "test candidate",
    ...overrides,
  };
}

describe("selectWinner \u2014 user corrections take precedence over eBay", () => {
  it("REGRESSION: a user-verified mapping must win even when eBay's rank #1 also survives", () => {
    // This is the original bug this file was written to catch: a
    // db_exact_user_verified mapping (human correction) being outscored by
    // an eBay rank-#1 suggestion. The new model has no scores to tie, so
    // this is now a precedence guarantee instead of an arithmetic one.
    const userVerified = candidate({
      categoryId: "3392",
      source: "user_verified",
      rank: 1,
    });
    const ebayTop = candidate({
      categoryId: "45243",
      source: "ebay_api",
      rank: 1,
    });

    const result = selectWinner([userVerified, ebayTop]);

    expect(result.winner?.categoryId).toBe("3392");
    expect(result.winner?.source).toBe("user_verified");
    expect(result.needsConfirmation).toBe(false);
  });

  it("a non-surviving (non-leaf) user-verified mapping does not win", () => {
    const staleUserVerified = candidate({
      categoryId: "256",
      source: "user_verified",
      rank: 1,
      survived: false,
      dropReason: "not a leaf",
    });
    const ebayTop = candidate({
      categoryId: "11952",
      source: "ebay_api",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US",
    });
    const dbAgree = candidate({
      categoryId: "11952",
      source: "db_exact",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US",
    });

    const result = selectWinner([staleUserVerified, ebayTop, dbAgree]);

    expect(result.winner?.categoryId).toBe("11952");
    expect(result.winner?.source).toBe("ebay_api");
  });
});

describe("selectWinner \u2014 lock requires the eBay #1 candidate to have survived the hard gates", () => {
  it("REGRESSION: a non-leaf/inactive eBay #1 must never win, even with no other candidates", () => {
    // Original bug: `verifiedLeaf !== false` treated a failed/timed-out (null)
    // verification as good enough to lock. The new model requires
    // `survived: true`, set only after a positive leaf+active confirmation.
    const nonLeafEbayTop = candidate({
      categoryId: "99",
      source: "ebay_api",
      rank: 1,
      survived: false,
      dropReason: "not a leaf",
    });

    const result = selectWinner([nonLeafEbayTop]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });

  it("locks on eBay #1 when it survived, an independent source agrees, and rank #2 is a separated subtree", () => {
    const ebayTop = candidate({
      categoryId: "222",
      source: "ebay_api",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
    });
    const ebaySecond = candidate({
      categoryId: "999",
      source: "ebay_api",
      rank: 2,
      breadcrumb: "Toys & Hobbies > Action Figures",
    });
    const dbAgree = candidate({
      categoryId: "222",
      source: "db_exact",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
    });

    const result = selectWinner([ebayTop, ebaySecond, dbAgree]);

    expect(result.winner?.categoryId).toBe("222");
    expect(result.needsConfirmation).toBe(false);
    expect(result.agreementChecked).toBe(true);
    expect(result.subtreeSeparated).toBe(true);
  });

  it("never promotes a lower-ranked candidate as a consolation prize when eBay #1 is dropped", () => {
    // Explicitly documented "no consolation prize" behaviour: if eBay's #1
    // pick fails a hard gate, a surviving db_fuzzy/gemini candidate does NOT
    // become the winner \u2014 the response is NEEDS_CONFIRMATION instead.
    const ebayTopDropped = candidate({
      categoryId: "99",
      source: "ebay_api",
      rank: 1,
      survived: false,
      dropReason: "not a leaf",
    });
    const fuzzySurvivor = candidate({
      categoryId: "555",
      source: "db_fuzzy",
      rank: 1,
      survived: true,
    });

    const result = selectWinner([ebayTopDropped, fuzzySurvivor]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });
});

describe("selectWinner \u2014 agreement + subtree-separation routing (Layer 3)", () => {
  it("requires an independent source to agree with eBay #1, not just survive", () => {
    const ebayTop = candidate({
      categoryId: "222",
      source: "ebay_api",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
    });
    const ebaySecond = candidate({
      categoryId: "999",
      source: "ebay_api",
      rank: 2,
      breadcrumb: "Toys & Hobbies > Action Figures",
    });

    const result = selectWinner([ebayTop, ebaySecond]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
    expect(result.agreementSourcesMatched.length).toBe(0);
  });

  it("requires eBay #1 and #2 to be in different top-level subtrees, even when agreement holds", () => {
    const ebayTop = candidate({
      categoryId: "222",
      source: "ebay_api",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
    });
    const ebaySecond = candidate({
      categoryId: "223",
      source: "ebay_api",
      rank: 2,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Gold",
    });
    const dbAgree = candidate({
      categoryId: "222",
      source: "db_exact",
      rank: 1,
      breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
    });

    const result = selectWinner([ebayTop, ebaySecond, dbAgree]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
    expect(result.subtreeSeparated).toBe(false);
  });

  it("treats a missing rank #2 as vacuously subtree-separated", () => {
    const ebayTop = candidate({
      categoryId: "222",
      source: "ebay_api",
      rank: 1,
    });
    const dbAgree = candidate({
      categoryId: "222",
      source: "db_exact",
      rank: 1,
    });

    const result = selectWinner([ebayTop, dbAgree]);

    expect(result.winner?.categoryId).toBe("222");
    expect(result.subtreeSeparated).toBe(true);
  });

  it("Gemini is never an outright winner, even if it is the only surviving candidate", () => {
    // Direct test of plan \u00a75's "Gemini should never be an oracle" rule.
    const geminiOnly = candidate({
      categoryId: "777",
      source: "gemini",
      rank: 1,
      survived: true,
    });

    const result = selectWinner([geminiOnly]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });
});

describe("selectWinner \u2014 empty / all-dropped candidate sets", () => {
  it("returns NEEDS_CONFIRMATION for an empty candidate list", () => {
    const result = selectWinner([]);
    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });

  it("returns NEEDS_CONFIRMATION when every candidate failed a hard gate", () => {
    const dead1 = candidate({
      categoryId: "99",
      source: "ebay_api",
      rank: 1,
      survived: false,
      dropReason: "not a leaf",
    });
    const dead2 = candidate({
      categoryId: "256",
      source: "gemini",
      rank: 1,
      survived: false,
      dropReason: "not active",
    });

    const result = selectWinner([dead1, dead2]);

    expect(result.winner).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });
});

// \u2500\u2500 Dynamic condition gate (ebay-publish's downstream safety net) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// category-lookup's own gate 3 (checkConditionGate in index.ts) is
// payload-optional and performs a live eBay Metadata API call, so it isn't
// unit-testable here without a network mock. What we CAN verify without a
// mock is the pure fallback/reroute decision logic mirrored from
// ebay-publish/publish-helpers.ts, which remains the second line of
// defense at publish time regardless of whether category-lookup's callers
// supply a conditionId.

const EBAY_CONDITION_ID_GRADED = "2750";
const GRADED_UNFRIENDLY_WORLD_PARENTS = new Set(["45243"]);

function needsGradedReroute(
  categoryId: string,
  acceptsGraded: boolean | null,
): boolean {
  return (
    acceptsGraded === false ||
    (acceptsGraded === null && GRADED_UNFRIENDLY_WORLD_PARENTS.has(categoryId))
  );
}

function categoryAcceptsCondition(
  conditionIds: string[] | null,
  conditionId: string,
): boolean | null {
  if (conditionIds === null || conditionIds.length === 0) return null;
  return conditionIds.includes(conditionId);
}

describe("dynamic graded-condition gate (publish-time fallback)", () => {
  it("reroutes when eBay reports the category rejects 2750", () => {
    const accepts = categoryAcceptsCondition(
      ["1000", "3000"],
      EBAY_CONDITION_ID_GRADED,
    );
    expect(accepts).toBe(false);
    expect(needsGradedReroute("45243", accepts)).toBe(true);
  });

  it("does NOT reroute when eBay reports the category accepts 2750", () => {
    const accepts = categoryAcceptsCondition(
      ["1000", "2750", "3000"],
      EBAY_CONDITION_ID_GRADED,
    );
    expect(accepts).toBe(true);
    expect(needsGradedReroute("3392", accepts)).toBe(false);
  });

  it("catches a graded-hostile category that is NOT in the hardcoded fallback list", () => {
    const accepts = categoryAcceptsCondition(
      ["1000"],
      EBAY_CONDITION_ID_GRADED,
    );
    expect(GRADED_UNFRIENDLY_WORLD_PARENTS.has("256")).toBe(false);
    expect(needsGradedReroute("256", accepts)).toBe(true);
  });

  it("falls back to the static list when the policy lookup is unknown", () => {
    const accepts = categoryAcceptsCondition(null, EBAY_CONDITION_ID_GRADED);
    expect(accepts).toBeNull();
    expect(needsGradedReroute("45243", accepts)).toBe(true);
    expect(needsGradedReroute("11952", accepts)).toBe(false);
  });

  it("treats an empty policy list as unknown, never as 'rejects everything'", () => {
    expect(categoryAcceptsCondition([], EBAY_CONDITION_ID_GRADED)).toBeNull();
    expect(
      needsGradedReroute(
        "11952",
        categoryAcceptsCondition([], EBAY_CONDITION_ID_GRADED),
      ),
    ).toBe(false);
  });

  it("does not reroute a graded US coin in a valid leaf", () => {
    const accepts = categoryAcceptsCondition(
      ["1000", "2750"],
      EBAY_CONDITION_ID_GRADED,
    );
    expect(needsGradedReroute("11952", accepts)).toBe(false);
  });
});
