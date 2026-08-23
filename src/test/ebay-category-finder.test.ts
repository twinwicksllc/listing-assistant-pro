/**
 * ebay-category-finder.test.ts
 *
 * Regression coverage for the eBay category finder work:
 *
 *  1. SCORING BUG — an eBay rank-#1 suggestion scores exactly 92
 *     (rawScore 80 + ebay_api source weight 12), which equalled
 *     DETERMINISTIC_LOCK_THRESHOLD. The lock therefore fired on every lookup
 *     that returned any eBay result, and because it was evaluated BEFORE the
 *     sorted-candidate loop, a `db_exact_user_verified` mapping (up to 100)
 *     could never win. User corrections were silently discarded.
 *
 *  2. LOCK-ON-NULL — the lock guard was `verifiedLeaf !== false`, so a failed
 *     or timed-out leaf verification (`null`) still locked the category.
 *
 *  3. DYNAMIC CONDITION GATE — graded coins must not be published into a
 *     category that rejects conditionId 2750. This is now resolved by asking
 *     eBay (getItemConditionPolicies) instead of a hardcoded blocklist, with
 *     the static list retained as an offline fallback.
 *
 * These tests replicate the edge-function logic rather than importing it,
 * because the Deno edge functions are not loadable from the Vitest
 * (node/browser) environment.
 */

import { describe, expect, it } from "vitest";

// ── Replicated from supabase/functions/category-lookup/index.ts ────────────
const DETERMINISTIC_LOCK_THRESHOLD = 92;
const FUZZY_MIN_TOKEN_OVERLAP = 2;

const SOURCE_WEIGHTS: Record<string, number> = {
  db_exact_user_verified: 15,
  db_exact_ebay_api: 10,
  db_exact: 8,
  ebay_api: 12,
  db_fuzzy: 3,
  gemini: 5,
};

function computeEffectiveScore(
  source: string,
  rawScore: number,
  tokenOverlap: number,
  totalQueryTokens: number,
  isGeneric: boolean,
  daysSinceUpdate: number,
  verifiedLeaf: boolean | null = null,
): number {
  const sourceWeight = SOURCE_WEIGHTS[source] ?? 0;
  const similarityBonus =
    totalQueryTokens > 0 ? (tokenOverlap / totalQueryTokens) * 15 : 0;
  const recencyBonus = source.startsWith("db_")
    ? Math.max(0, 5 - daysSinceUpdate / 30)
    : 0;
  const genericPenalty = isGeneric ? 20 : 0;
  const ambiguityPenalty =
    source === "db_fuzzy" && tokenOverlap < FUZZY_MIN_TOKEN_OVERLAP ? 15 : 0;
  const nonLeafPenalty = verifiedLeaf === false ? 30 : 0;

  return Math.min(
    100,
    Math.max(
      0,
      rawScore +
        sourceWeight +
        similarityBonus +
        recencyBonus -
        genericPenalty -
        ambiguityPenalty -
        nonLeafPenalty,
    ),
  );
}

interface Candidate {
  categoryId: string;
  source: string;
  effectiveScore: number;
  verifiedLeaf: boolean | null;
  rank: number;
}

/** Winner selection AFTER the fix. */
function selectWinner(candidates: Candidate[]): {
  winner: Candidate | null;
  reason: string;
} {
  const sorted = [...candidates].sort(
    (a, b) => b.effectiveScore - a.effectiveScore,
  );

  const userVerified = sorted.find(
    (c) => c.source === "db_exact_user_verified" && c.verifiedLeaf !== false,
  );
  if (userVerified) return { winner: userVerified, reason: "user_verified" };

  const topEbay = sorted.find((c) => c.source === "ebay_api" && c.rank === 1);
  if (
    topEbay &&
    topEbay.effectiveScore >= DETERMINISTIC_LOCK_THRESHOLD &&
    topEbay.verifiedLeaf === true
  ) {
    return { winner: topEbay, reason: "deterministic_lock" };
  }

  for (const c of sorted) {
    if (c.verifiedLeaf === false) continue;
    return { winner: c, reason: "highest_score" };
  }
  return { winner: sorted[0] ?? null, reason: "fallback" };
}

/** Winner selection BEFORE the fix — proves the bug was real. */
function selectWinnerLegacy(candidates: Candidate[]): Candidate | null {
  const sorted = [...candidates].sort(
    (a, b) => b.effectiveScore - a.effectiveScore,
  );
  const topEbay = sorted.find((c) => c.source === "ebay_api" && c.rank === 1);
  if (
    topEbay &&
    topEbay.effectiveScore >= DETERMINISTIC_LOCK_THRESHOLD &&
    topEbay.verifiedLeaf !== false
  ) {
    return topEbay;
  }
  for (const c of sorted) {
    if (c.verifiedLeaf === false) continue;
    return c;
  }
  return sorted[0] ?? null;
}

const ebayRank1 = (
  verifiedLeaf: boolean | null,
  categoryId = "45243",
): Candidate => ({
  categoryId,
  source: "ebay_api",
  effectiveScore: computeEffectiveScore(
    "ebay_api",
    80,
    0,
    5,
    false,
    0,
    verifiedLeaf,
  ),
  verifiedLeaf,
  rank: 1,
});

const userVerifiedCandidate = (categoryId = "3392"): Candidate => ({
  categoryId,
  source: "db_exact_user_verified",
  effectiveScore: computeEffectiveScore(
    "db_exact_user_verified",
    100,
    5,
    5,
    false,
    0,
    null,
  ),
  verifiedLeaf: null,
  rank: 1,
});

describe("category-lookup scoring", () => {
  it("eBay rank #1 hits exactly the lock threshold even with zero token overlap", () => {
    // Root cause: 80 + 12 = 92 === DETERMINISTIC_LOCK_THRESHOLD.
    const score = computeEffectiveScore("ebay_api", 80, 0, 5, false, 0, true);
    expect(score).toBe(92);
    expect(score).toBeGreaterThanOrEqual(DETERMINISTIC_LOCK_THRESHOLD);
  });

  it("a user-verified mapping outscores eBay rank #1", () => {
    expect(userVerifiedCandidate().effectiveScore).toBe(100);
    expect(userVerifiedCandidate().effectiveScore).toBeGreaterThan(
      ebayRank1(true).effectiveScore,
    );
  });

  it("confirmed non-leaf eBay rank #1 drops below the lock threshold", () => {
    const score = computeEffectiveScore("ebay_api", 80, 5, 5, false, 0, false);
    expect(score).toBe(77);
    expect(score).toBeLessThan(DETERMINISTIC_LOCK_THRESHOLD);
  });
});

describe("winner selection — user corrections", () => {
  it("REGRESSION: legacy logic discarded the user-verified mapping", () => {
    const legacy = selectWinnerLegacy([
      userVerifiedCandidate("3392"),
      ebayRank1(true, "45243"),
    ]);
    // Despite scoring 100 vs 92, the human correction lost.
    expect(legacy?.categoryId).toBe("45243");
    expect(legacy?.source).toBe("ebay_api");
  });

  it("user-verified mapping now wins over eBay rank #1", () => {
    const { winner, reason } = selectWinner([
      userVerifiedCandidate("3392"),
      ebayRank1(true, "45243"),
    ]);
    expect(winner?.categoryId).toBe("3392");
    expect(winner?.source).toBe("db_exact_user_verified");
    expect(reason).toBe("user_verified");
  });

  it("a non-leaf user-verified mapping does NOT win", () => {
    const stale = { ...userVerifiedCandidate("256"), verifiedLeaf: false };
    const { winner } = selectWinner([stale, ebayRank1(true, "11952")]);
    expect(winner?.categoryId).toBe("11952");
  });
});

describe("winner selection — lock requires positive leaf confirmation", () => {
  it("REGRESSION: legacy logic locked even when verification returned null", () => {
    const legacy = selectWinnerLegacy([ebayRank1(null, "45243")]);
    expect(legacy?.categoryId).toBe("45243");
  });

  it("does not deterministically lock when leaf verification failed (null)", () => {
    const { reason } = selectWinner([ebayRank1(null, "45243")]);
    expect(reason).not.toBe("deterministic_lock");
  });

  it("locks when the leaf is positively verified", () => {
    const { winner, reason } = selectWinner([ebayRank1(true, "11952")]);
    expect(reason).toBe("deterministic_lock");
    expect(winner?.categoryId).toBe("11952");
  });

  it("never returns a candidate known to be non-leaf when a leaf exists", () => {
    const nonLeaf = ebayRank1(false, "45243");
    const leaf: Candidate = {
      categoryId: "3392",
      source: "ebay_api",
      effectiveScore: computeEffectiveScore(
        "ebay_api",
        76,
        3,
        5,
        false,
        0,
        true,
      ),
      verifiedLeaf: true,
      rank: 2,
    };
    const { winner } = selectWinner([nonLeaf, leaf]);
    expect(winner?.categoryId).toBe("3392");
  });
});

// ── Dynamic condition gate ────────────────────────────────────────────────
const EBAY_CONDITION_ID_GRADED = "2750";
const GRADED_UNFRIENDLY_WORLD_PARENTS = new Set(["45243"]);

/**
 * Mirrors the resolution in publish-create-draft.ts:
 *   false → reroute; true → keep; null → fall back to the static list.
 */
function needsGradedReroute(
  categoryId: string,
  acceptsGraded: boolean | null,
): boolean {
  return (
    acceptsGraded === false ||
    (acceptsGraded === null && GRADED_UNFRIENDLY_WORLD_PARENTS.has(categoryId))
  );
}

/** Mirrors categoryAcceptsCondition() against a policy fixture. */
function categoryAcceptsCondition(
  conditionIds: string[] | null,
  conditionId: string,
): boolean | null {
  if (conditionIds === null || conditionIds.length === 0) return null;
  return conditionIds.includes(conditionId);
}

describe("dynamic graded-condition gate", () => {
  it("reroutes when eBay reports the category rejects 2750", () => {
    // 45243 returns policies without the Graded condition.
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

  it("catches a graded-hostile category that is NOT in the hardcoded list", () => {
    // The whole point of the dynamic gate: 256 is not in the static set,
    // but eBay says it rejects 2750, so we still reroute.
    const accepts = categoryAcceptsCondition(
      ["1000"],
      EBAY_CONDITION_ID_GRADED,
    );
    expect(GRADED_UNFRIENDLY_WORLD_PARENTS.has("256")).toBe(false);
    expect(needsGradedReroute("256", accepts)).toBe(true);
  });

  it("falls back to the static list when the policy lookup is unknown", () => {
    // Empty body / API error / no credentials → null.
    const accepts = categoryAcceptsCondition(null, EBAY_CONDITION_ID_GRADED);
    expect(accepts).toBeNull();
    expect(needsGradedReroute("45243", accepts)).toBe(true); // preserved behaviour
    expect(needsGradedReroute("11952", accepts)).toBe(false); // no false positives
  });

  it("treats an empty policy list as unknown, never as 'rejects everything'", () => {
    // Guards against blocking every publish if eBay returns an empty array.
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
