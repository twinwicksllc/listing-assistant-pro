import { describe, expect, test } from "vitest";
import { BULLION_CATEGORY_IDS, COIN_CATEGORY_IDS } from "../types/listing";
import snapshot from "../../corpus/ebay_taxonomy_snapshot.json";

// Regression guard for the 2026-09-01 stale-coin-category-ID cleanup (see
// todo.md's "cure the disease in the three flagged follow-ups" entry).
//
// deriveDomainFromCategory() is called on every manual eBay category
// override, and a false "coins_bullion" classification is not cosmetic here:
// isCoinConditionDetailRequired() short-circuits true for that domain, which
// hard-blocks publish (useAnalyzePublish.ts) until the seller fills in a
// nonsensical Grade/PCGS field for what might be an unrelated item (e.g. an
// Action Figures Accessory wrongly classified via a stale category ID).

const byId = new Map(
  (
    snapshot as {
      categories: Array<{
        category_id: string;
        breadcrumb: string;
        is_leaf: boolean;
      }>;
    }
  ).categories.map((c) => [c.category_id, c]),
);

// The five eBay June-2026-mandate parent IDs are the one deliberate
// exception to "leaf-only" in COIN_CATEGORY_IDS — see that file's header.
const INTENTIONAL_NON_LEAF_MARKERS = new Set([
  "253",
  "256",
  "3377",
  "4733",
  "18466",
]);

describe("COIN_CATEGORY_IDS / BULLION_CATEGORY_IDS freshness", () => {
  test("no COIN_CATEGORY_IDS entry is a confirmed live leaf outside Coins & Paper Money", () => {
    const wrongDomain: string[] = [];
    for (const id of COIN_CATEGORY_IDS) {
      const cat = byId.get(id);
      if (!cat || !cat.is_leaf) continue; // absent/non-leaf handled separately
      if (!/coins & paper money/i.test(cat.breadcrumb)) {
        wrongDomain.push(`${id} -> live: "${cat.breadcrumb}"`);
      }
    }
    expect(wrongDomain, wrongDomain.join("\n")).toEqual([]);
  });

  test("no COIN_CATEGORY_IDS entry is a confirmed non-leaf unless it's an intentional mandate marker", () => {
    const unexpectedNonLeaf: string[] = [];
    for (const id of COIN_CATEGORY_IDS) {
      if (INTENTIONAL_NON_LEAF_MARKERS.has(id)) continue;
      const cat = byId.get(id);
      if (cat && !cat.is_leaf) {
        unexpectedNonLeaf.push(`${id} -> non-leaf: "${cat.breadcrumb}"`);
      }
    }
    expect(unexpectedNonLeaf, unexpectedNonLeaf.join("\n")).toEqual([]);
  });

  test("no BULLION_CATEGORY_IDS entry is a confirmed live leaf outside Bullion", () => {
    const notBullion: string[] = [];
    for (const id of BULLION_CATEGORY_IDS) {
      const cat = byId.get(id);
      if (!cat || !cat.is_leaf) continue;
      if (!/bullion/i.test(cat.breadcrumb)) {
        notBullion.push(`${id} -> live: "${cat.breadcrumb}"`);
      }
    }
    expect(notBullion, notBullion.join("\n")).toEqual([]);
  });

  test("coin and bullion sets don't cross-contaminate beyond the known intentional overlap", () => {
    const overlap = [...COIN_CATEGORY_IDS].filter((id) =>
      BULLION_CATEGORY_IDS.has(id),
    );
    // 166679/3361/178906 are deliberately in both — each resolves via
    // isBullionCategory() first, which is the correct outcome for these
    // specific bullion leaves. Any OTHER overlap means a coin leaf was
    // wrongly re-added to the bullion set (the exact bug already fixed for
    // 532/173685 in the sibling ebay-publish/publish-helpers.ts sets).
    expect(new Set(overlap)).toEqual(new Set(["166679", "3361", "178906"]));
  });

  test("previously-dangerous wrong-domain IDs are gone from both sets", () => {
    for (const id of [
      "40150",
      "40152",
      "261064",
      "261068",
      "261069",
      "261070",
      "261071",
    ]) {
      expect(
        COIN_CATEGORY_IDS.has(id),
        `${id} should not be in COIN_CATEGORY_IDS`,
      ).toBe(false);
      expect(
        BULLION_CATEGORY_IDS.has(id),
        `${id} should not be in BULLION_CATEGORY_IDS`,
      ).toBe(false);
    }
  });
});
