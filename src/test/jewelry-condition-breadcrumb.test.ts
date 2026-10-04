import { describe, expect, test } from "vitest";
import { getConditionsForCategory } from "../types/listing";

// Regression guard for the 2026-09-16 ring-publish bug: getConditionsForCategory's
// jewelry-detection regex required a "Clothing, Shoes & Accessories >" prefix that
// real jewelry breadcrumbs never have — Jewelry & Watches (and Sporting Goods) are
// their own top-level eBay trees, e.g. "Jewelry & Watches > Fine Jewelry > Rings".
// The old regex silently fell through to the generic condition set for every real
// ring/jewelry listing, which includes "For Parts or Not Working" and other options
// eBay does not accept on that leaf.
//
// The fallback list mirrors the six condition values returned by eBay's
// Metadata API for category 261994 (Fine Jewelry > Rings).

const RING_VALUES = new Set([
  "NEW",
  "NEW_OTHER",
  "NEW_WITH_DEFECTS",
  "PRE_OWNED_EXCELLENT",
  "USED_EXCELLENT",
  "PRE_OWNED_FAIR",
]);

describe("getConditionsForCategory jewelry breadcrumbs", () => {
  test("real Fine Jewelry > Rings breadcrumb gets jewelry conditions, not the generic set", () => {
    const options = getConditionsForCategory(
      "67742",
      undefined,
      "Jewelry & Watches > Fine Jewelry > Rings",
    );
    const values = options.map((o) => o.value);
    expect(new Set(values)).toEqual(RING_VALUES);
    expect(options.find((o) => o.value === "PRE_OWNED_FAIR")?.label).toBe(
      "Pre-owned - Fair",
    );
    expect(values).not.toContain("FOR_PARTS_OR_NOT_WORKING");
  });

  test("Fashion Jewelry > Rings also matches", () => {
    const options = getConditionsForCategory(
      "10978",
      undefined,
      "Jewelry & Watches > Fashion Jewelry > Rings",
    );
    expect(new Set(options.map((o) => o.value))).toEqual(RING_VALUES);
  });

  test("top-level Sporting Goods breadcrumb also matches (no Clothing prefix required)", () => {
    const options = getConditionsForCategory(
      "888",
      undefined,
      "Sporting Goods > Team Sports > Baseball & Softball",
    );
    expect(new Set(options.map((o) => o.value))).toEqual(RING_VALUES);
  });

  test("legacy Clothing, Shoes & Accessories > Jewelry & Watches breadcrumb still matches", () => {
    const options = getConditionsForCategory(
      "11450",
      undefined,
      "Clothing, Shoes & Accessories > Jewelry & Watches",
    );
    expect(new Set(options.map((o) => o.value))).toEqual(RING_VALUES);
  });

  test("unrelated breadcrumb (Books) is unaffected", () => {
    const options = getConditionsForCategory(
      "171228",
      undefined,
      "Books & Magazines > Fiction & Literature",
    );
    const values = options.map((o) => o.value);
    expect(values).not.toEqual([...RING_VALUES]);
  });

  test("clothing and shoe static fallbacks use the real Excellent/Fair enums", () => {
    for (const breadcrumb of [
      "Clothing, Shoes & Accessories > Clothing > Dresses",
      "Clothing, Shoes & Accessories > Shoes > Women's Shoes",
    ]) {
      const options = getConditionsForCategory("12345", undefined, breadcrumb);
      expect(options.map((option) => option.value)).toContain(
        "PRE_OWNED_EXCELLENT",
      );
      expect(options.map((option) => option.value)).toContain("PRE_OWNED_FAIR");
      expect(
        options.find((option) => option.label === "Pre-owned - Good")?.value,
      ).toBe("USED_EXCELLENT");
    }
  });
});
