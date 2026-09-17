import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { basisFromSource, sourceReliabilityFromSource } from "./index.ts";

// Regression coverage for the 2026-09-16 sold-vs-active mislabeling fix
// (Problem 3, Phase 3.1 of the pricing-reliability plan). ebay-pricing's
// `source` field ("browse_api" | "jina") was already computed correctly, but
// nothing derived what that source actually IS -- every caller
// (priceRecommender.ts, PricingCard.tsx) unconditionally labeled results as
// "sold" regardless of source, which is simply wrong for browse_api (this app
// has no Marketplace Insights access; Browse API is always active
// asking-price listings, never sold data).

Deno.test("basisFromSource: browse_api is active-listing data, not sold", () => {
  assertEquals(basisFromSource("browse_api"), "active");
});

Deno.test("basisFromSource: jina scrapes eBay's LH_Sold=1 sold-search results", () => {
  assertEquals(basisFromSource("jina"), "sold");
});

// Regression coverage for Phase 3.3(b) of the pricing-reliability plan:
// label Jina-sourced comps as lower-confidence, distinctly from whether the
// data is "sold" or "active" (basisFromSource above) -- a scrape can produce
// a "sold" number that's still noisier than a structured API response.
Deno.test("sourceReliabilityFromSource: browse_api is a structured API call", () => {
  assertEquals(sourceReliabilityFromSource("browse_api"), "structured");
});

Deno.test("sourceReliabilityFromSource: jina is an HTML scrape, not a structured API", () => {
  assertEquals(sourceReliabilityFromSource("jina"), "scraped");
});
