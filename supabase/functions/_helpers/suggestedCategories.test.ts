import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { _LEGACY_BOOTSTRAP_BREADCRUMBS, deriveLeafStatus } from "./suggestedCategories.ts";

// Regression coverage for the mislabelled-leaf defect found 2026-08-14.
//
// fetchLiveBreadcrumb used to write `is_leaf: true` unconditionally when caching
// a breadcrumb, so any branch category routed through it was permanently recorded
// as a listable leaf. Five coin branch categories (11116 Coins & Paper Money,
// 11945 Large Cents, 11951 Nickels, 11956 Dimes, 11968 Half Dollars) were found
// mislabelled that way, and sync-ebay-taxonomy could never correct them because it
// only upserts IDs present in eBay's current leaf set.
//
// ebay_taxonomy_cache.is_leaf is NOT NULL DEFAULT true, so "unknown" must be
// distinguishable from "leaf" — otherwise the caller cannot decline to write.

Deno.test("deriveLeafStatus: leafCategoryTreeNode true means leaf", () => {
  assertEquals(deriveLeafStatus({ leafCategoryTreeNode: true }), true);
});

Deno.test("deriveLeafStatus: non-empty children means branch", () => {
  assertEquals(
    deriveLeafStatus({ childCategoryTreeNodes: [{ category: { categoryId: "1" } }] }),
    false,
  );
});

Deno.test("deriveLeafStatus: leaf flag wins over an empty children array", () => {
  assertEquals(
    deriveLeafStatus({ leafCategoryTreeNode: true, childCategoryTreeNodes: [] }),
    true,
  );
});

// An empty array without the leaf flag is genuinely ambiguous: it could be a leaf
// or a truncated response. Callers must not cache in that case.
Deno.test("deriveLeafStatus: empty children without leaf flag is unknown", () => {
  assertEquals(deriveLeafStatus({ childCategoryTreeNodes: [] }), null);
});

Deno.test("deriveLeafStatus: no usable signal is unknown, not a default", () => {
  assertEquals(deriveLeafStatus({ category: { categoryId: "11116" } }), null);
});

Deno.test("deriveLeafStatus: a falsy leaf flag is not treated as leaf", () => {
  assertEquals(deriveLeafStatus({ leafCategoryTreeNode: false }), null);
});

Deno.test("deriveLeafStatus: tolerates null, undefined and non-objects", () => {
  assertEquals(deriveLeafStatus(null), null);
  assertEquals(deriveLeafStatus(undefined), null);
  assertEquals(deriveLeafStatus("11116"), null);
  assertEquals(deriveLeafStatus(42), null);
});

// The shape eBay actually returns for a branch node, as observed for 11116.
Deno.test("deriveLeafStatus: realistic branch node resolves to false", () => {
  const branch = {
    category: { categoryId: "11116", categoryName: "Coins & Paper Money" },
    childCategoryTreeNodes: [
      { category: { categoryId: "11945", categoryName: "Large Cents" } },
      { category: { categoryId: "11951", categoryName: "Nickels" } },
    ],
  };
  assertEquals(deriveLeafStatus(branch), false);
});

// Regression guard for the 2026-09-01 stale-coin-category-ID cleanup (see
// todo.md's "cure the disease in the three flagged follow-ups" entry).
//
// _LEGACY_BOOTSTRAP_BREADCRUMBS is Tier 4 of 4 in buildSuggestedCategories's
// resolution order — reached only when the taxonomy cache, category_mappings,
// AND the live eBay API all miss. A wrong-domain-live entry there confidently
// returns a false breadcrumb for a category that's actually something else
// entirely (e.g. Action Figures, Computer Software) instead of null, which
// the caller would otherwise render as a visibly-a-placeholder "Category #<id>".
Deno.test("_LEGACY_BOOTSTRAP_BREADCRUMBS: previously-dangerous wrong-domain IDs are gone", () => {
  for (
    const id of [
      "40150",
      "40152",
      "261064",
      "261068",
      "261069",
      "261070",
      "261071",
      "166680",
      "166681",
      "182",
      "15709",
      "40",
    ]
  ) {
    assertEquals(
      Object.prototype.hasOwnProperty.call(_LEGACY_BOOTSTRAP_BREADCRUMBS, id),
      false,
      `${id} should have been removed`,
    );
  }
});

// Broader sweep, not just the IDs already known to be wrong: this map spans
// every domain (Coins, Toys, Jewelry, Electronics, Clothing, Books, ...), not
// just coins, so — same reasoning as ebay-category-map-freshness.test.ts —
// compare each entry's OWN claimed top-level category against the live
// taxonomy's top-level category for that ID, rather than assuming one domain.
Deno.test("_LEGACY_BOOTSTRAP_BREADCRUMBS: no entry's stored top-level category disagrees with its live one", () => {
  const url = new URL("../../../corpus/ebay_taxonomy_snapshot.json", import.meta.url);
  const snapshot = JSON.parse(Deno.readTextFileSync(url)) as {
    categories: Array<{ category_id: string; breadcrumb: string; is_leaf: boolean }>;
  };
  const byId = new Map(snapshot.categories.map((c) => [c.category_id, c]));
  const topLevel = (breadcrumb: string) => breadcrumb.split(" > ")[0];

  // Known, pre-existing cosmetic-only mismatch, deliberately not touched in
  // the 2026-09-01 pass: the stored string omits its own top-level segment
  // entirely (it starts at the leaf name, "Cell Phones & Smartphones",
  // rather than "Cell Phones & Accessories > Cell Phones & Smartphones") —
  // an imprecise label, not a wrong domain. This map's own policy is to
  // shrink, not be actively maintained, so cosmetic-only entries are left
  // alone; only confirmed wrong-domain-live entries were removed.
  const KNOWN_COSMETIC_ONLY_MISMATCHES = new Set(["9355"]);

  const mismatched: string[] = [];
  for (const [id, storedBreadcrumb] of Object.entries(_LEGACY_BOOTSTRAP_BREADCRUMBS)) {
    if (KNOWN_COSMETIC_ONLY_MISMATCHES.has(id)) continue;
    const live = byId.get(id);
    if (!live || !live.is_leaf) continue; // absent/non-leaf: harmless, see leafCategoryGuard.ts precedent
    const storedTop = topLevel(storedBreadcrumb);
    const liveTop = topLevel(live.breadcrumb);
    if (storedTop !== liveTop) {
      mismatched.push(`${id} -> stored top-level "${storedTop}" but live is "${liveTop}" (${live.breadcrumb})`);
    }
  }
  assertEquals(mismatched, [], `\n${mismatched.join("\n")}`);
});
