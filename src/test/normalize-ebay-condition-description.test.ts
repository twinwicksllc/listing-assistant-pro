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
});
