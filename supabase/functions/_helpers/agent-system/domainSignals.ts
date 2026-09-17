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

// Shared with pass1Identification.ts's detectMetalGeneralContradiction (kept
// as a separate literal there rather than imported, to avoid a dependency
// from _helpers/ up into agent-system/ — see that file's comment). Excludes
// compound false-positives a bare noun match would catch (a "metal ring
// light"/"ring binder" is not jewelry; a "chain saw"/"chain link fence" is
// not a chain necklace; a "watch dog"/"watchtower" is not a wristwatch) —
// found via Copilot review on PR #584, confirmed against real compound
// phrases before fixing.
const JEWELRY_SIGNAL_RE =
  /\b(rings?(?!\s*(light|binder|toss))|necklaces?|bracelets?|earrings?|pendants?|brooch(?:es)?|bangles?|chains?(?!\s*(saw|link))|anklets?|cufflinks?|wrist\s*watch(?:es)?|watch(?:es)?(?!\s*dog)|jewelry)\b/i;

export const DOMAIN_PROMOTION_SIGNALS: Record<Domain, RegExp> = {
  coins_bullion: /\b(coins?|bullion|numismatic|currency|paper money|banknotes?)\b/i,
  trading_cards: /\b(trading cards?|sports cards?|card packs?|tcg|pok[eé]mon card|graded card|psa \d|topps|panini)\b/i,
  jewelry: JEWELRY_SIGNAL_RE,
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

// Matches the start of a rejected clause in a correction sentence, e.g.
// "This is an action figure, not a trading card" or "...jewelry, not a
// book" — everything from this point onward names what the item is NOT,
// so it must not be scanned for promotion signals. Without this, a
// correction phrased as "X, not Y" promotes to whichever of X/Y happens to
// be checked first in DOMAIN_PROMOTION_SIGNALS's key order, regardless of
// which one the visual agent actually asserted (Copilot review, PR #584).
const REJECTED_CLAUSE_RE = /,?\s*(?:not\s+(?:an?\s+)?|rather than\s+|instead of\s+)/i;

function stripRejectedClause(text: string): string {
  const cutAt = text.search(REJECTED_CLAUSE_RE);
  return cutAt === -1 ? text : text.slice(0, cutAt);
}

/**
 * Scans a free-text correction string (from the visual agent's
 * `identificationCorrection`) for any domain's keyword signal and returns the
 * first match. Only the asserted clause is scanned — text after "not a"/
 * "rather than"/"instead of" is stripped first, so a rejected alternative
 * named in the same sentence can't be mistaken for the actual correction.
 * `promotedDomain` is null both when nothing matched AND when the matched
 * domain is already the current domain (no-op case) — callers only need to
 * check `promotedDomain` to decide whether to act, while `matchedDomain` is
 * retained for logging/diagnostics.
 */
export function resolveDomainPromotion(correctionText: string, currentDomain: Domain): DomainPromotionResult {
  const lower = stripRejectedClause(correctionText).toLowerCase();
  for (const domain of Object.keys(DOMAIN_PROMOTION_SIGNALS) as Domain[]) {
    if (domain === "general") continue;
    if (DOMAIN_PROMOTION_SIGNALS[domain].test(lower)) {
      return { matchedDomain: domain, promotedDomain: domain === currentDomain ? null : domain };
    }
  }
  return { matchedDomain: null, promotedDomain: null };
}
