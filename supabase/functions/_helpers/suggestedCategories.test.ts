import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { deriveLeafStatus } from "./suggestedCategories.ts";

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
