import { describe, expect, it } from "vitest";
import { buildPriceRecommendation } from "@/lib/priceRecommender";
import type { SoldComp } from "@/types/price-recommender";

/**
 * Regression coverage for the 2026-09-16 sold-vs-active mislabeling fix
 * (Problem 3, Phase 3.1). Before this fix, `confidenceReason` unconditionally
 * said "comparable sold listings" regardless of where the comps actually came
 * from -- this app's primary comps source (eBay Browse API, no Marketplace
 * Insights access) is always active asking-price data, never confirmed sold
 * transactions. Only the ebay-pricing function's Jina-scraped fallback path
 * is genuinely sold data.
 */

function comp(price: number): SoldComp {
  return {
    title: "test item",
    price,
    currency: "USD",
    condition: "Used",
    itemUrl: null,
    imageUrl: null,
  };
}

const EIGHT_COMPS = Array.from({ length: 8 }, (_, i) => comp(10 + i));
const THREE_COMPS = [comp(10), comp(12), comp(14)];
const ONE_COMP = [comp(10)];

describe("buildPriceRecommendation — basis-aware confidenceReason", () => {
  it("defaults to 'active' basis when no basis argument is passed", () => {
    const rec = buildPriceRecommendation(
      EIGHT_COMPS,
      "USED_EXCELLENT",
      0,
      0,
      undefined,
    );
    expect(rec.basis).toBe("active");
    expect(rec.confidenceReason).toContain("active listings");
    expect(rec.confidenceReason).not.toContain("sold");
  });

  it("labels comps as 'sold listings' when basis='sold' is explicitly passed", () => {
    const rec = buildPriceRecommendation(
      EIGHT_COMPS,
      "USED_EXCELLENT",
      0,
      0,
      undefined,
      "sold",
    );
    expect(rec.basis).toBe("sold");
    expect(rec.confidenceReason).toContain("sold listings");
  });

  it("labels comps as 'active listings' when basis='active' is explicitly passed", () => {
    const rec = buildPriceRecommendation(
      EIGHT_COMPS,
      "USED_EXCELLENT",
      0,
      0,
      undefined,
      "active",
    );
    expect(rec.basis).toBe("active");
    expect(rec.confidenceReason).toContain("active listings");
  });

  it("uses the basis-aware noun at medium confidence (3-7 comps)", () => {
    const rec = buildPriceRecommendation(
      THREE_COMPS,
      "USED_EXCELLENT",
      0,
      0,
      undefined,
      "sold",
    );
    expect(rec.confidence).toBe("medium");
    expect(rec.confidenceReason).toContain("sold listings");
  });

  it("uses the basis-aware, singularized noun at low confidence with exactly 1 comp", () => {
    const rec = buildPriceRecommendation(
      ONE_COMP,
      "USED_EXCELLENT",
      0,
      0,
      undefined,
      "sold",
    );
    expect(rec.confidence).toBe("low");
    // Singular: "1 comparable sold listing found", not "1 comparable sold listings found"
    expect(rec.confidenceReason).toContain("sold listing found");
    expect(rec.confidenceReason).not.toContain("sold listings found");
  });

  it("reports basis='unknown' when there are zero comps, regardless of the basis argument passed", () => {
    const rec = buildPriceRecommendation(
      [],
      "USED_EXCELLENT",
      10,
      20,
      undefined,
      "sold",
    );
    expect(rec.compsCount).toBe(0);
    expect(rec.basis).toBe("unknown");
    expect(rec.confidenceReason).toBe(
      "No eBay comps found — using AI estimate",
    );
  });
});
