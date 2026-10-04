import { describe, expect, test } from "vitest";
import { normalizeEbayConditionDescription } from "../types/listing";
import { conditionIdFromCategoryPolicy } from "../lib/ebayConditionPolicy";

// Regression coverage for the 2026-09-16 ring-publish bug: eBay's Metadata
// API returns human-readable conditionDescription strings, not Inventory API
// ConditionEnum values — using one unconverted as a condition dropdown value
// or publish payload field gets rejected by eBay's own publish endpoint.

describe("normalizeEbayConditionDescription", () => {
  test.each([
    ["New with tags", "NEW"],
    ["New without tags", "NEW_OTHER"],
    ["New with defects", "NEW_WITH_DEFECTS"],
    ["Pre-owned", "USED_EXCELLENT"],
    ["New", "NEW"],
    ["Used", "USED_EXCELLENT"],
  ])("maps %s -> %s", (input, expected) => {
    expect(normalizeEbayConditionDescription(input)).toBe(expected);
  });

  test("is case-insensitive", () => {
    expect(normalizeEbayConditionDescription("NEW WITH TAGS")).toBe("NEW");
    expect(normalizeEbayConditionDescription("pre-owned")).toBe(
      "USED_EXCELLENT",
    );
  });

  test("returns empty string for empty/undefined/null input", () => {
    expect(normalizeEbayConditionDescription("")).toBe("");
    expect(normalizeEbayConditionDescription(undefined)).toBe("");
    expect(normalizeEbayConditionDescription(null)).toBe("");
  });

  test("falls back to a mangled token for an unmapped description", () => {
    // Not a real eBay condition description — exercises the fallback path
    // rather than asserting a specific eBay condition ever produces this.
    expect(normalizeEbayConditionDescription("Some New Thing")).toBe(
      "SOME_NEW_THING",
    );
  });

  // Regression coverage for a live production incident (2026-09-20): eBay's
  // Metadata API returns "Pre-owned - Good" as the conditionDescription for
  // some categories. "Pre-owned - Good" has no eBay enum of its own — its
  // conditionId 3000 maps to USED_EXCELLENT — and there is no "Pre-owned -
  // Poor" grade, so both must be corrected. But "Pre-owned - Excellent"
  // (2990) and "Pre-owned - Fair" (3010) ARE real ConditionEnum values for
  // apparel/jewelry categories and must be preserved — correcting them was
  // the root cause of Fine Jewelry > Rings (261994) publish rejections.
  test.each([
    ["Pre-owned - Good", "USED_EXCELLENT"],
    ["Pre-owned Good", "USED_EXCELLENT"],
    ["pre-owned good", "USED_EXCELLENT"],
    ["Pre-owned - Poor", "USED_ACCEPTABLE"],
    ["PRE_OWNED_GOOD", "USED_EXCELLENT"],
    ["PRE_OWNED_POOR", "USED_ACCEPTABLE"],
  ])("maps fake token %s -> %s", (input, expected) => {
    expect(normalizeEbayConditionDescription(input)).toBe(expected);
  });

  test.each([
    ["PRE_OWNED_EXCELLENT", "PRE_OWNED_EXCELLENT"],
    ["Pre-owned Excellent", "PRE_OWNED_EXCELLENT"],
    ["Pre-owned - Excellent", "PRE_OWNED_EXCELLENT"],
    ["Pre-owned - Fair", "PRE_OWNED_FAIR"],
    ["Pre-owned Fair", "PRE_OWNED_FAIR"],
    ["PRE_OWNED_FAIR", "PRE_OWNED_FAIR"],
  ])("preserves real apparel/jewelry enum %s -> %s", (input, expected) => {
    expect(normalizeEbayConditionDescription(input)).toBe(expected);
  });

  test("CSV export resolves real pre-owned IDs against the category policy", () => {
    const ringPolicy = [
      { conditionId: 2990, conditionDescription: "Pre-owned - Excellent" },
      { conditionId: 3000, conditionDescription: "Pre-owned - Good" },
      { conditionId: 3010, conditionDescription: "Pre-owned - Fair" },
    ];
    expect(
      conditionIdFromCategoryPolicy("PRE_OWNED_EXCELLENT", ringPolicy),
    ).toBe("2990");
    expect(conditionIdFromCategoryPolicy("PRE_OWNED_FAIR", ringPolicy)).toBe(
      "3010",
    );
    expect(
      conditionIdFromCategoryPolicy("PRE_OWNED_FAIR", [
        { conditionId: 4000, conditionDescription: "Ungraded" },
      ]),
    ).toBe("4000");
  });

  // Regression coverage for a live production incident (2026-09-26): eBay's
  // official condition-id-values docs list "New/Factory Sealed" (conditionId
  // 1000) and "Open Box/Used" (conditionId 3000) as alternate display names.
  // These raw description strings leaked straight into the Analyze page's
  // condition dropdown as both label AND value (analyze-item's
  // ebayMetadata.allowedConditions was built without any normalization),
  // so selecting them and publishing sent an invalid, non-enum condition
  // string to eBay, which rejected it with errorId 2004 ("Could not
  // serialize field [condition]").
  test.each([
    ["New Factory Sealed", "NEW"],
    ["New/Factory Sealed", "NEW"],
    ["New - Factory Sealed", "NEW"],
    ["Open Box Used", "USED_EXCELLENT"],
    ["Open Box/Used", "USED_EXCELLENT"],
    ["Open Box - Used", "USED_EXCELLENT"],
  ])(
    "maps %s -> %s (not a raw eBay conditionDescription)",
    (input, expected) => {
      expect(normalizeEbayConditionDescription(input)).toBe(expected);
    },
  );
});
