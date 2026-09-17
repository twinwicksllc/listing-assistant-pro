/**
 * domainSignals.ts
 *
 * Phase 2.3 (misclassification fix). Deliberately NOT in registry.ts:
 * registry.ts is "domain identity" — prompts/RAG config that apply once a
 * domain has already been chosen — while this file is a detection concern
 * with a different shape and a different lifecycle (it exists to catch the
 * visual agent flagging that Pass 1's domain guess was wrong, before any
 * domain-specific prompt or RAG logic runs). Keeping it separate also avoids
 * merge friction with Phase 1.3b's already-large domainPrompts.ts/registry.ts
 * touches.
 *
 * The regexes below are hand-built keyword/noun matchers, not derived from
 * registry.ts's `criticalAttributes` — those are attribute *names* (e.g.
 * "Metal Purity") meant for extraction prompts, not item nouns (e.g. "ring")
 * useful for scanning free-text correction strings.
 */

import type { Domain } from "./pipelineContracts.ts";

export const DOMAIN_PROMOTION_SIGNALS: Record<Domain, RegExp> = {
  coins_bullion: /\b(coins?|bullion|numismatic|currency|paper money|banknotes?)\b/i,
  trading_cards: /\b(trading cards?|sports cards?|card packs?|tcg|pok[eé]mon card|graded card|psa \d|topps|panini)\b/i,
  jewelry:
    /\b(rings?|necklaces?|bracelets?|earrings?|pendants?|brooch(?:es)?|bangles?|chains?|anklets?|cufflinks?|jewelry)\b/i,
  electronics:
    /\b(electronics?|laptop|smartphone|tablet|camera|gaming console|circuit board|charger|headphones?|speaker)\b/i,
  vintage_clothing: /\b(vintage clothing|dress|jacket|coat|shirt|jeans|apparel|garment)\b/i,
  auto_parts: /\b(auto parts?|car parts?|engine|transmission|alternator|carburetor|fender|bumper)\b/i,
  sneakers: /\b(sneakers?|jordans?|yeezys?|running shoes?|basketball shoes?)\b/i,
  luxury_handbags: /\b(handbags?|purses?|louis vuitton|chanel bag|gucci bag|designer bag)\b/i,
  musical_instruments: /\b(guitar|violin|piano|drum kit|saxophone|trumpet|musical instrument|amplifier)\b/i,
  toys_collectibles: /\b(toys?|action figures?|funko pop|collectible figure|model kit|plush)\b/i,
  home_garden_tools: /\b(power tool|drill|lawn mower|garden tool|wrench set|hand tool)\b/i,
  general: /(?!)/, // never matches — promotion never targets general (Phase 2.1 handles that direction)
};

export interface DomainPromotionResult {
  promotedDomain: Domain | null; // null = no promotion (no match, or matched === current)
  matchedDomain: Domain | null;
}

/**
 * Scans a free-text correction string (from the visual agent's
 * `identificationCorrection`) for any domain's keyword signal and returns the
 * first match. `promotedDomain` is null both when nothing matched AND when
 * the matched domain is already the current domain (no-op case) — callers
 * only need to check `promotedDomain` to decide whether to act, while
 * `matchedDomain` is retained for logging/diagnostics.
 */
export function resolveDomainPromotion(correctionText: string, currentDomain: Domain): DomainPromotionResult {
  const lower = correctionText.toLowerCase();
  for (const domain of Object.keys(DOMAIN_PROMOTION_SIGNALS) as Domain[]) {
    if (domain === "general") continue;
    if (DOMAIN_PROMOTION_SIGNALS[domain].test(lower)) {
      return { matchedDomain: domain, promotedDomain: domain === currentDomain ? null : domain };
    }
  }
  return { matchedDomain: null, promotedDomain: null };
}
