import { describe, expect, test } from "vitest";
import { getConditionsForCategory } from "../types/listing";

// Regression guard for the 2026-09-16 ring-publish bug: getConditionsForCategory's
// jewelry-detection regex required a "Clothing, Shoes & Accessories >" prefix that
// real jewelry breadcrumbs never have — Jewelry & Watches (and Sporting Goods) are
// their own top-level eBay trees, e.g. "Jewelry & Watches > Fine Jewelry > Rings".
// The old regex silently fell through to the generic condition set for every real
// ring/jewelry listing, which includes "For Parts or Not Working" and other options
// eBay does not accept on that leaf.

const RING_VALUES = new Set([
  "NEW",
  "NEW_OTHER",
  "NEW_WITH_DEFECTS",
  "USED_EXCELLENT",
  "PRE_OWNED_GOOD",
  "PRE_OWNED_FAIR",
  "CERTIFIED_REFURBISHED",
  "EXCELLENT_REFURBISHED",
  "VERY_GOOD_REFURBISHED",
  "GOOD_REFURBISHED",
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
});
