import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  COIN_LEAF_FALLBACKS,
  enforceLeafCategory,
  inferUsCoinLeafFromText,
  isKnownParentCategoryId,
  KNOWN_PARENT_CATEGORY_IDS,
} from "./leafCategoryGuard.ts";

// Regression coverage for the 1893 Columbian Half Dollar mis-routing incident
// (2026-08-24, CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md Finding B/root-cause).
//
// Category 99 is not a real eBay leaf ("Everything Else" rollup id) and was
// previously absent from KNOWN_PARENT_CATEGORY_IDS, so the dangerous
// `winner = allCandidates[0]` fallback in category-lookup/index.ts could ship
// it straight to the client with zero item aspects. This suite locks in that
// 99 is now blocked and that the guard behaves correctly around it.

Deno.test("isKnownParentCategoryId: 99 is blocked (Columbian Half Dollar incident)", () => {
  assertEquals(isKnownParentCategoryId("99"), true);
  assertEquals(KNOWN_PARENT_CATEGORY_IDS.has("99"), true);
});

Deno.test("isKnownParentCategoryId: known World Coins rollups (256, 45243) are blocked", () => {
  assertEquals(isKnownParentCategoryId("256"), true);
  assertEquals(isKnownParentCategoryId("45243"), true);
});

Deno.test("isKnownParentCategoryId: confirmed-live leaf 257 is NOT blocked", () => {
  assertEquals(isKnownParentCategoryId("257"), false);
});

Deno.test("isKnownParentCategoryId: confirmed-live US Commemorative leaf 179531 is NOT blocked", () => {
  assertEquals(isKnownParentCategoryId("179531"), false);
});

Deno.test("isKnownParentCategoryId: null/undefined/empty are never blocked", () => {
  assertEquals(isKnownParentCategoryId(null), false);
  assertEquals(isKnownParentCategoryId(undefined), false);
  assertEquals(isKnownParentCategoryId(""), false);
});

Deno.test("isKnownParentCategoryId: trims whitespace before checking", () => {
  assertEquals(isKnownParentCategoryId("  99  "), true);
});

Deno.test("enforceLeafCategory: category 99 with no candidates and non-coin domain requires confirmation", () => {
  const result = enforceLeafCategory({
    categoryId: "99",
    domain: "general",
    text: "Some random item",
  });
  assertEquals(result.categoryId, "99");
  assertEquals(result.changed, false);
  assertEquals(result.needsUserConfirmation, true);
});

Deno.test("enforceLeafCategory: category 99 replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "99",
    domain: "coins_bullion",
    candidates: [{ categoryId: "256" }, { categoryId: "257" }],
  });
  assertEquals(result.categoryId, "257");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 99 for a coin falls back to inferred coin leaf from text", () => {
  const result = enforceLeafCategory({
    categoryId: "99",
    domain: "coins_bullion",
    text: "1921 Morgan Silver Dollar VF",
  });
  assertEquals(result.categoryId, COIN_LEAF_FALLBACKS.morganDollar);
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: a verified leaf that is not a known parent is kept as-is", () => {
  const result = enforceLeafCategory({
    categoryId: "179531",
    verifiedLeaf: true,
    domain: "coins_bullion",
  });
  assertEquals(result.categoryId, "179531");
  assertEquals(result.changed, false);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: failed live verification without candidates or coin match needs confirmation", () => {
  const result = enforceLeafCategory({
    categoryId: "12345",
    verifiedLeaf: false,
    domain: "general",
  });
  assertEquals(result.categoryId, "12345");
  assertEquals(result.changed, false);
  assertEquals(result.needsUserConfirmation, true);
});

Deno.test("inferUsCoinLeafFromText: Morgan Dollar resolves to verified leaf", () => {
  assertEquals(
    inferUsCoinLeafFromText("1921 Morgan Silver Dollar"),
    COIN_LEAF_FALLBACKS.morganDollar,
  );
});

Deno.test("inferUsCoinLeafFromText: Barber Half Dollar resolves to the half-dollar leaf, not dime/quarter", () => {
  assertEquals(
    inferUsCoinLeafFromText("1901 Barber Half Dollar"),
    COIN_LEAF_FALLBACKS.barberHalf,
  );
});

Deno.test("inferUsCoinLeafFromText: Barber Dime and Barber Quarter resolve to distinct leaves", () => {
  assertEquals(
    inferUsCoinLeafFromText("1905 Barber Dime"),
    COIN_LEAF_FALLBACKS.barberDime,
  );
  assertEquals(
    inferUsCoinLeafFromText("1905 Barber Quarter"),
    COIN_LEAF_FALLBACKS.barberQuarter,
  );
});

Deno.test("inferUsCoinLeafFromText: unrecognized coin text returns null", () => {
  assertEquals(inferUsCoinLeafFromText("1893 Columbian Commemorative Half Dollar"), null);
});

Deno.test("inferUsCoinLeafFromText: null/empty input returns null", () => {
  assertEquals(inferUsCoinLeafFromText(null), null);
  assertEquals(inferUsCoinLeafFromText(undefined), null);
  assertEquals(inferUsCoinLeafFromText(""), null);
});
