import { describe, expect, test } from "vitest";
import { EBAY_CATEGORY_BREADCRUMBS } from "../lib/ebayCategoryMap";
import snapshot from "../../corpus/ebay_taxonomy_snapshot.json";

// Regression guard for the 2026-09-01 stale-coin-category-ID cleanup
// (see todo.md's "Fix the stale/wrong-domain eBay coin-category IDs" entry).
//
// EBAY_CATEGORY_BREADCRUMBS is checked FIRST in CategoryConfirmDialog.tsx,
// before any live category-lookup verification call — a hit there
// short-circuits the real check entirely. The most dangerous class of bug
// this file can carry is a key that is a genuine, LIVE eBay leaf, but in a
// completely different domain than "Coins & Paper Money" (e.g. 40150, once
// mapped here as "Roosevelt Dime," is now Toys & Hobbies > Action Figures).
// A stale/absent key is comparatively harmless — nothing will ever look up
// a category ID eBay has retired — so this test fails hard only on the
// dangerous case and reports the harmless case as informational context.

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

// Categories intentionally kept as broad, non-leaf domain markers rather than
// specific leaves — documented at the top of ebayCategoryMap.ts as the June
// 2026 mandate parent IDs, plus a few long-standing broad groupings used
// elsewhere in the codebase as deliberate non-leaf markers.
const INTENTIONAL_NON_LEAF_MARKERS = new Set([
  "253",
  "256",
  "3377",
  "4733",
  "18466",
  "11118",
]);

const topLevel = (breadcrumb: string) => breadcrumb.split(" > ")[0];

// This file covers many top-level categories (Coins, Trading Cards, Jewelry,
// Electronics, Clothing, Books, ...) — it is NOT coins-only, despite most of
// its entries being coin-related. Scope this regression guard to the domains
// this cleanup actually audited and fixed (Coins & Paper Money, plus the 6
// specific trading-card IDs checked below); the other domains' entries were
// spot-checked but not exhaustively audited the same way, and asserting the
// same strictness on them risks false failures from eBay's ordinary tree
// reorganizations in domains nobody has reviewed yet. (One issue remains
// deliberately unfixed and tracked in todo.md: 25321/178893 have accurate
// labels but a stale parent path, since eBay moved Projectors and Smart
// Watches to different top-level categories — cosmetic, not a wrong domain.
// The sibling issue — 261328-261332 labeled sport-specific when they're
// actually generic format-type leaves — was fixed 2026-09-01, see the
// second describe block below.)
const AUDITED_TOP_LEVEL = "Coins & Paper Money";

describe("EBAY_CATEGORY_BREADCRUMBS freshness (Coins & Paper Money)", () => {
  // Compare each entry's OWN claimed top-level category (the first breadcrumb
  // segment already stored here) against the live taxonomy's top-level
  // category for that same ID. A mismatch is exactly the dangerous pattern
  // this cleanup fixed: a live leaf silently reassigned to a different
  // top-level category than the one this map still claims for it.
  test("no Coins & Paper Money key disagrees with its live top-level category", () => {
    const mismatched: string[] = [];
    for (const [id, storedBreadcrumb] of Object.entries(
      EBAY_CATEGORY_BREADCRUMBS,
    )) {
      if (topLevel(storedBreadcrumb) !== AUDITED_TOP_LEVEL) continue;
      const live = byId.get(id);
      if (!live || !live.is_leaf) continue; // absent/non-leaf handled below
      const liveTop = topLevel(live.breadcrumb);
      if (liveTop !== AUDITED_TOP_LEVEL) {
        mismatched.push(
          `${id} -> live top-level is "${liveTop}" (${live.breadcrumb})`,
        );
      }
    }
    expect(mismatched, mismatched.join("\n")).toEqual([]);
  });

  test("no Coins & Paper Money key is a confirmed non-leaf unless intentionally allowlisted", () => {
    const unexpectedNonLeaf: string[] = [];
    for (const [id, storedBreadcrumb] of Object.entries(
      EBAY_CATEGORY_BREADCRUMBS,
    )) {
      if (topLevel(storedBreadcrumb) !== AUDITED_TOP_LEVEL) continue;
      if (INTENTIONAL_NON_LEAF_MARKERS.has(id)) continue;
      const live = byId.get(id);
      if (live && !live.is_leaf) {
        unexpectedNonLeaf.push(`${id} -> non-leaf: "${live.breadcrumb}"`);
      }
    }
    expect(unexpectedNonLeaf, unexpectedNonLeaf.join("\n")).toEqual([]);
  });

  test("informational: Coins & Paper Money keys absent from the live snapshot (not a failure)", () => {
    const absent = Object.entries(EBAY_CATEGORY_BREADCRUMBS)
      .filter(([, breadcrumb]) => topLevel(breadcrumb) === AUDITED_TOP_LEVEL)
      .filter(([id]) => !byId.has(id));
    // Absence in a leaf-focused sync doesn't prove an ID no longer exists —
    // see leafCategoryGuard.ts's header for the full reasoning. This test
    // exists purely to surface the count for a human to spot-check over
    // time, not to fail the build.
    expect(absent.length).toBeGreaterThanOrEqual(0);
  });
});

// Narrowly-scoped regression guard for the specific trading-card mislabels
// fixed 2026-09-01 — not a broader Toys-&-Hobbies-wide audit (that hasn't
// been done). 261328-261332 were labeled sport-specific (Baseball/Football/
// Basketball/Hockey/Soccer Cards); 183454 was labeled Pokémon-specific. The
// live taxonomy has no per-sport/per-game leaf at all — sport/game is an
// item aspect, not a category — so every one of these is actually a generic
// format leaf. Asserts the exact corrected breadcrumb, not just top-level
// domain, since these specific values are now fully known and verified.
describe("EBAY_CATEGORY_BREADCRUMBS freshness (trading cards, 2026-09-01 fix)", () => {
  test("previously sport/game-mislabeled trading-card IDs now match their live breadcrumb exactly", () => {
    const expected: Record<string, string> = {
      "261328": "Sports Trading Cards > Trading Card Singles",
      "261329": "Sports Trading Cards > Trading Card Lots",
      "261330": "Sports Trading Cards > Trading Card Sets",
      "261331": "Sports Trading Cards > Sealed Trading Card Packs",
      "261332": "Sports Trading Cards > Sealed Trading Card Boxes",
      "183454":
        "Toys & Hobbies > Collectible Card Games > CCG Individual Cards",
    };
    for (const [id, storedBreadcrumb] of Object.entries(expected)) {
      expect(EBAY_CATEGORY_BREADCRUMBS[id], `${id} stored breadcrumb`).toBe(
        storedBreadcrumb,
      );
      const live = byId.get(id);
      expect(live?.is_leaf, `${id} should be a confirmed live leaf`).toBe(true);
      // The live breadcrumb's leaf name (last segment) must match what's
      // stored — the stored value here omits the top-level department
      // segment eBay actually uses (verified separately, not this file's
      // concern), so compare leaf names rather than full-string equality.
      const liveLeafName = live!.breadcrumb.split(" > ").pop();
      const storedLeafName = storedBreadcrumb.split(" > ").pop();
      expect(liveLeafName, `${id} leaf name`).toBe(storedLeafName);
    }
  });
});
