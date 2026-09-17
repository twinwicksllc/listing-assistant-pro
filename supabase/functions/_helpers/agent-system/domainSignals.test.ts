import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DOMAIN_PROMOTION_SIGNALS, resolveDomainPromotion } from "./domainSignals.ts";

// Phase 2.3 regression coverage — widening identificationCorrection's domain
// promotion beyond the old coins-only regex. See CLAUDE.md's "ring called a
// book" note: the visual agent already writes a free-text correction for any
// domain contradiction it notices, but the pipeline used to only listen for
// coin-related terms. These tests cover the generalized keyword→domain
// matcher that replaced it.

Deno.test("promotes jewelry when correction contradicts a general guess (ring, not book)", () => {
  const result = resolveDomainPromotion("this is clearly a gold ring, not a book", "general");
  assertEquals(result.matchedDomain, "jewelry");
  assertEquals(result.promotedDomain, "jewelry");
});

Deno.test("promotes trading_cards when correction mentions card terms while domain is toys_collectibles", () => {
  const result = resolveDomainPromotion(
    "closer inspection shows this is a graded card, not an action figure",
    "toys_collectibles",
  );
  assertEquals(result.matchedDomain, "trading_cards");
  assertEquals(result.promotedDomain, "trading_cards");
});

Deno.test("promotes sneakers on jordan/sneaker terms", () => {
  const result = resolveDomainPromotion("these are actually a pair of Jordans, not a general item", "general");
  assertEquals(result.matchedDomain, "sneakers");
  assertEquals(result.promotedDomain, "sneakers");
});

Deno.test("no-op when correction agrees with the current domain", () => {
  const result = resolveDomainPromotion("confirmed, this is a coin", "coins_bullion");
  assertEquals(result.matchedDomain, "coins_bullion");
  assertEquals(result.promotedDomain, null);
});

Deno.test("no match on domain-free prose", () => {
  const result = resolveDomainPromotion("the lighting in this photo could be better", "general");
  assertEquals(result.matchedDomain, null);
  assertEquals(result.promotedDomain, null);
});

Deno.test("never promotes to general even on unmatched text", () => {
  const result = resolveDomainPromotion("no idea what this thing is honestly", "jewelry");
  assertEquals(result.matchedDomain, null);
  assertEquals(result.promotedDomain, null);
  assertEquals(DOMAIN_PROMOTION_SIGNALS.general.test("anything at all"), false);
});

Deno.test("coins_bullion still matches the terms the original shipped regex matched (no regression)", () => {
  for (
    const text of [
      "this is a coin, not a token",
      "clearly bullion, not scrap metal",
      "the correction notes this is numismatic material",
      "this is currency, not a novelty item",
      "this is paper money, not a book",
    ]
  ) {
    const result = resolveDomainPromotion(text, "general");
    assertEquals(result.matchedDomain, "coins_bullion", `expected coins_bullion match for: "${text}"`);
    assertEquals(result.promotedDomain, "coins_bullion");
  }
});

Deno.test("jewelry chain and earrings variants are covered", () => {
  const chain = resolveDomainPromotion("this is a gold chain, not a keychain accessory", "general");
  assertEquals(chain.matchedDomain, "jewelry");
  assertEquals(chain.promotedDomain, "jewelry");

  const earrings = resolveDomainPromotion("these are earrings, not electronic components", "electronics");
  assertEquals(earrings.matchedDomain, "jewelry");
  assertEquals(earrings.promotedDomain, "jewelry");
});
