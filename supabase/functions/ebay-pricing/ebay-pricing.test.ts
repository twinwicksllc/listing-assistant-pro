import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { basisFromSource, isJinaBlockedContent, sourceReliabilityFromSource } from "./index.ts";

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

// Regression coverage for the 2026-09-20 Issue #4 investigation: eBay
// returns a 403 directly to Jina's scrape request, and Jina still responds
// 200 while relaying eBay's own "SORRY Something went wrong on our end"
// error page as markdown. isJinaBlockedContent distinguishes that relayed
// block page from a genuine zero-sold-comps result, so the caller can (a)
// skip a guaranteed-to-be-blocked redundant retry and (b) tell the UI
// "temporarily unavailable" instead of implying the item has no market.

Deno.test("isJinaBlockedContent: detects the exact eBay 403 error page seen in production logs", () => {
  const content =
    "Title: Error Page | eBay URL Source: https://www.ebay.com/sch/i.html?_nkw=silver%20tone%20skeleton " +
    "Warning: Target URL returned error 403: Forbidden Markdown Content: SORRY Something went wrong on our end " +
    "* * * 0.4434d517.1789921826.4de2e9b * * * Please go back and try again or go to eBay Homepage.";
  assertEquals(isJinaBlockedContent(content), true);
});

Deno.test("isJinaBlockedContent: detects other 4xx relay warnings (not just 403)", () => {
  const content = "Warning: Target URL returned error 429: Too Many Requests\nMarkdown Content: rate limited";
  assertEquals(isJinaBlockedContent(content), true);
});

Deno.test("isJinaBlockedContent: a real sold-listings page with genuine content is not flagged", () => {
  const content = `Title: silver tone skeleton pocket watch for sale | eBay
URL Source: https://www.ebay.com/sch/i.html?_nkw=silver+tone+skeleton
Markdown Content:
## [Silver Tone Skeleton Mechanical Pocket Watch](https://www.ebay.com/itm/123456)
Sold  ·  $45.00
## [Antique Skeleton Pocket Watch with Chain](https://www.ebay.com/itm/789012)
Sold  ·  $62.50`;
  assertEquals(isJinaBlockedContent(content), false);
});

Deno.test("isJinaBlockedContent: empty content is not flagged as blocked (handled separately by the short-content check)", () => {
  assertEquals(isJinaBlockedContent(""), false);
});
