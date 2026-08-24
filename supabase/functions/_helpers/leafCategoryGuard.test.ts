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

// Regression coverage: the replay harness (scripts/replay-corpus.mjs) caught
// that 40196-40200 (dead Canada/Mexico/UK/Australia/Germany World Coin ids,
// Phase 2 Finding B) had only been removed from the AI prompt allowlist and
// were never added to this static blocklist as defense-in-depth, unlike
// 99/256/45243.
Deno.test("isKnownParentCategoryId: dead World Coin ids 40196-40200 are blocked", () => {
  assertEquals(isKnownParentCategoryId("40196"), true);
  assertEquals(isKnownParentCategoryId("40197"), true);
  assertEquals(isKnownParentCategoryId("40198"), true);
  assertEquals(isKnownParentCategoryId("40199"), true);
  assertEquals(isKnownParentCategoryId("40200"), true);
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

// Regression coverage for the Phase 3 golden-corpus audit (2026-08-24,
// corpus/golden_corpus.json). While building the corpus from
// category_mappings_rows.csv, 5 more category IDs were found to be the same
// non-leaf-rollup bug class as 99/256/45243 above, but OUTSIDE the coins
// domain and despite being marked user_verified/approved:
//   - 19203 (Beanie Babies)      -> live leaf is 1037
//   - 246   (Action Figures)     -> live leaf is 261068
//   - 19209 (Stuffed Animals)    -> live leaf is 230
//   - 10986 (mislabeled Necklaces & Pendants id) -> live leaf is 261993
//   - 41111 (American Silver Eagle, taxonomy drift -- worked once, since
//     retired/merged by eBay) -> live leaf is 177653
// This suite locks in that all 5 are now blocked by the guard.

Deno.test("isKnownParentCategoryId: Phase 3 corpus audit non-coin non-leaf ids (19203, 246, 19209, 10986, 41111) are blocked", () => {
  assertEquals(isKnownParentCategoryId("19203"), true);
  assertEquals(isKnownParentCategoryId("246"), true);
  assertEquals(isKnownParentCategoryId("19209"), true);
  assertEquals(isKnownParentCategoryId("10986"), true);
  assertEquals(isKnownParentCategoryId("41111"), true);
});

Deno.test("enforceLeafCategory: category 19203 (Beanie Babies) replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "19203",
    domain: "toys_hobbies",
    candidates: [{ categoryId: "19203" }, { categoryId: "1037" }],
  });
  assertEquals(result.categoryId, "1037");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 246 (Action Figures) replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "246",
    domain: "toys_hobbies",
    candidates: [{ categoryId: "246" }, { categoryId: "261068" }],
  });
  assertEquals(result.categoryId, "261068");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 19209 (Stuffed Animals) replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "19209",
    domain: "toys_hobbies",
    candidates: [{ categoryId: "19209" }, { categoryId: "230" }],
  });
  assertEquals(result.categoryId, "230");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 10986 (mislabeled Necklaces & Pendants id) replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "10986",
    domain: "jewelry",
    candidates: [{ categoryId: "10986" }, { categoryId: "261993" }],
  });
  assertEquals(result.categoryId, "261993");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 41111 (American Silver Eagle, taxonomy drift) replaced by first non-parent candidate", () => {
  const result = enforceLeafCategory({
    categoryId: "41111",
    domain: "coins_bullion",
    candidates: [{ categoryId: "41111" }, { categoryId: "177653" }],
  });
  assertEquals(result.categoryId, "177653");
  assertEquals(result.changed, true);
  assertEquals(result.needsUserConfirmation, false);
});

Deno.test("enforceLeafCategory: category 19203 with no candidates and no coin-text match requires confirmation", () => {
  const result = enforceLeafCategory({
    categoryId: "19203",
    domain: "toys_hobbies",
    text: "Vintage Beanie Baby plush toy",
  });
  assertEquals(result.categoryId, "19203");
  assertEquals(result.changed, false);
  assertEquals(result.needsUserConfirmation, true);
});
