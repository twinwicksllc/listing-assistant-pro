import { describe, expect, test } from "vitest";
import { normalizeEbayConditionDescription } from "../types/listing";

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
  // Metadata API returns "Pre-owned - Good" / "Pre-owned - Fair" as the
  // conditionDescription for some categories (e.g. Jewelry & Watches >
  // Pocket Watches, category 3937). Before this fix, these strings had no
  // entry in the alias table, so they fell through to the mangle fallback
  // and produced "PRE_OWNED_GOOD" / "PRE_OWNED_FAIR" — NOT valid eBay
  // ConditionEnum values, which eBay's Inventory API rejects with errorId
  // 2004 ("Could not serialize field [condition]") on publish.
  test.each([
    ["Pre-owned - Good", "USED_EXCELLENT"],
    ["Pre-owned Good", "USED_EXCELLENT"],
    ["pre-owned good", "USED_EXCELLENT"],
    ["Pre-owned - Fair", "USED_GOOD"],
    ["Pre-owned - Poor", "USED_ACCEPTABLE"],
  ])("maps %s -> %s (never a fake PRE_OWNED_* enum)", (input, expected) => {
    const result = normalizeEbayConditionDescription(input);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/^PRE_OWNED_/);
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
