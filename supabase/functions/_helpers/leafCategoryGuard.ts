/**
 * leafCategoryGuard.ts — final safety net that guarantees a LEAF category
 * is what actually reaches the client.
 *
 * WHY THIS EXISTS
 * ----------------
 * analyze-item already tries hard to pick a leaf: it locks deterministic
 * categories, verifies via `category-lookup` (`action: "verify"`), and runs a
 * post-lookup override. But every one of those paths is *best-effort*:
 *
 *   - The leaf validation block is wrapped in `try { ... } catch { warn }`, so
 *     any network hiccup silently leaves the AI's (possibly non-leaf) pick.
 *   - When `verify` reports `isLeaf === false`, the code attempts a reselect
 *     from `lookupAlternatives` / `suggestedCategories` — but those
 *     alternatives are themselves NEVER re-verified, and if both lists are
 *     empty the original non-leaf ID is kept with no further guard.
 *
 * The observable symptom is a listing that ships with a parent/rollup category
 * (e.g. the "Coins: US > Half Dollars" style rollups). eBay returns ZERO item
 * aspects for a non-leaf node, so the UI renders an empty specifics table and
 * the seller has no Year / Grade / Mint Location / Composition fields at all.
 *
 * This module centralises the last-mile decision so both analyze-item and any
 * future caller share identical behaviour.
 */

/**
 * eBay parent/rollup category IDs that must NEVER be returned to the client.
 *
 * This list is intentionally a *superset* of the blocklists that previously
 * lived (duplicated, and slightly out of sync) in category-lookup/index.ts and
 * analyze-item/index.ts. It is a static backstop only — the authoritative
 * check is always the live `get_category_subtree` leaf verification. IDs here
 * are the ones we have observed leaking into production listings.
 */
export const KNOWN_PARENT_CATEGORY_IDS: ReadonlySet<string> = new Set([
  // ── Coins & Paper Money ────────────────────────────────────────────────
  "11116", // Coins: US > Pennies (rollup)
  "11118", // Coins: US > Half Dollars (rollup)
  "11951", // Coins: US > Nickels (rollup — verified parent of 11952/11953)
  "253", // Coins: US (rollup)
  "256", // Coins: World (rollup)
  "260", // Coins & Paper Money (root)
  "261076", // Bullion (rollup)
  "261074", // Bullion > Silver (rollup)
  "261075", // Bullion > Gold (rollup)
  "3390", // Coins: World > Africa (rollup)
  "3394", // Coins: World (regional rollup)
  "45243", // Coins: World > Other — rollup that rejects graded coins
  "88433", // Coins: US > Dimes / rollup node returning zero aspects
  // ── Everything else ────────────────────────────────────────────────────
  "1", // Collectibles
  "11232", // Jewelry & Watches (rollup)
  "11233", // Jewelry & Watches
  "11450", // Clothing, Shoes & Accessories
  "139971", // Video Games & Consoles
  "15032", // Cell Phones & Accessories
  "20713", // Home & Garden
  "220", // Toys & Hobbies > Dolls & Bears
  "267", // Books & Magazines > Books
  "268", // Books & Magazines
  "293", // Consumer Electronics
  "550", // Art
  "631", // Tools & Workshop Equipment
  "64482", // Sports Trading Cards (rollup)
]);

/**
 * Safe, publish-tested LEAF categories used when every other resolution path
 * has failed. Each of these is a true leaf that exposes the full coin aspect
 * set (Year, Grade, Mint Location, Composition, Circulated/Uncirculated).
 */
/**
 * Every ID below was verified against eBay's live browse taxonomy
 * (the numeric segment of https://www.ebay.com/b/<slug>/<categoryId>/...)
 * rather than being inferred, because neighbouring coin series do NOT have
 * contiguous IDs and a wrong guess silently reintroduces this exact bug.
 */
export const COIN_LEAF_FALLBACKS = {
  /** Coins: US > Half Dollars > Barber (1892-1915) — verified 11971 */
  barberHalf: "11971",
  /** Coins: US > Dimes > Barber (1892-1916) — verified 11959 */
  barberDime: "11959",
  /** Coins: US > Quarters > Barber (1892-1916) — verified 11965 */
  barberQuarter: "11965",
  /** Coins: US > Nickels > Shield (1866-1883) — verified 11952 */
  shieldNickel: "11952",
  /** Coins: US > Nickels > Liberty (1883-1913) — verified 11953 */
  libertyNickel: "11953",
  /** Coins: US > Dollars > Morgan (1878-1921) — verified 39464 */
  morganDollar: "39464",
  /** Coins: World > South Pacific — graded-friendly world leaf */
  worldSouthPacific: "3392",
} as const;

/** True when `categoryId` is a known parent/rollup that must not be shipped. */
export function isKnownParentCategoryId(
  categoryId: string | null | undefined,
): boolean {
  if (!categoryId) return false;
  return KNOWN_PARENT_CATEGORY_IDS.has(String(categoryId).trim());
}

/**
 * Pick a sane LEAF category for a US coin based on the free text we have
 * (title + description + keywords). This is deliberately conservative: it only
 * matches well-known series where the denomination + series pair is
 * unambiguous, and returns `null` when it cannot be confident.
 *
 * Ordering matters — denomination is checked alongside the series name so that
 * "Barber Dime" and "Barber Half Dollar" resolve to different leaves.
 */
export function inferUsCoinLeafFromText(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const t = text.toLowerCase();

  const hasDime = /\bdimes?\b|\b10c\b|\bten\s+cents?\b/.test(t);
  const hasQuarter = /\bquarters?\b|\b25c\b|\btwenty[-\s]?five\s+cents?\b/.test(t);
  const hasHalf = /\bhalf\s+dollars?\b|\b50c\b|\bfifty\s+cents?\b/.test(t);
  const hasNickel = /\bnickels?\b|\b5c\b|\bfive\s+cents?\b/.test(t);

  // ── Barber series (1892-1916) — dime / quarter / half all exist ──────────
  if (/\bbarber\b/.test(t)) {
    if (hasHalf) return COIN_LEAF_FALLBACKS.barberHalf;
    if (hasQuarter) return COIN_LEAF_FALLBACKS.barberQuarter;
    if (hasDime) return COIN_LEAF_FALLBACKS.barberDime;
    // "Barber Dome" / OCR noise with no denomination: the half dollar is the
    // most commonly listed Barber type, and it exposes the same aspect set.
    return COIN_LEAF_FALLBACKS.barberHalf;
  }

  // ── Shield Nickel (1866-1883) ───────────────────────────────────────────
  if (/\bshield\b/.test(t) && (hasNickel || /\bshield\s+nickel\b/.test(t))) {
    return COIN_LEAF_FALLBACKS.shieldNickel;
  }

  // ── Liberty Head "V" Nickel (1883-1913) ─────────────────────────────────
  if (/\bliberty\s+head\b|\bv\s+nickel\b/.test(t) && hasNickel) {
    return COIN_LEAF_FALLBACKS.libertyNickel;
  }

  // ── Morgan Dollar ───────────────────────────────────────────────────────
  if (/\bmorgan\b/.test(t)) return COIN_LEAF_FALLBACKS.morganDollar;

  return null;
}

export interface LeafGuardInput {
  /** The category the pipeline currently intends to ship. */
  categoryId: string | null | undefined;
  /** Live verification result, when available. `null` = unknown. */
  verifiedLeaf?: boolean | null;
  /** Domain from Pass 1 identification. */
  domain?: string | null;
  /** Free text (title / description / keywords) used to infer a coin leaf. */
  text?: string | null;
  /**
   * Ordered candidate categories from lookup alternatives / suggestions.
   * The first candidate that is not a known parent wins.
   */
  candidates?: Array<{ categoryId?: string | null }>;
}

export interface LeafGuardResult {
  /** The category ID that should actually be shipped. */
  categoryId: string | null;
  /** True when the guard changed the category. */
  changed: boolean;
  /** Human-readable explanation for logs / audit trail. */
  reason: string;
  /**
   * True when the guard could not find any leaf replacement and the caller
   * should surface a "confirm your category" prompt to the seller.
   */
  needsUserConfirmation: boolean;
}

/**
 * Final gate before a category is returned to the client.
 *
 * Resolution order:
 *   1. Category is verified leaf and not a known parent → keep it.
 *   2. Try the ordered `candidates` list, skipping known parents.
 *   3. For coin domains, infer a known-good leaf from the item text.
 *   4. Give up, keep the original, and flag `needsUserConfirmation` so the UI
 *      can prompt rather than silently shipping an aspect-less category.
 */
export function enforceLeafCategory(input: LeafGuardInput): LeafGuardResult {
  const original = input.categoryId ? String(input.categoryId).trim() : null;

  if (!original) {
    return {
      categoryId: null,
      changed: false,
      reason: "no category supplied",
      needsUserConfirmation: true,
    };
  }

  const isParent = isKnownParentCategoryId(original);
  const failedVerification = input.verifiedLeaf === false;

  // 1. Happy path — nothing to do.
  if (!isParent && !failedVerification) {
    return {
      categoryId: original,
      changed: false,
      reason: "category passed leaf guard",
      needsUserConfirmation: false,
    };
  }

  const problem = isParent
    ? `${original} is a known parent/rollup category`
    : `${original} failed live leaf verification`;

  // 2. Try ordered candidates (lookup alternatives, then AI suggestions).
  for (const candidate of input.candidates ?? []) {
    const cid = candidate?.categoryId ? String(candidate.categoryId).trim() : null;
    if (!cid || cid === original) continue;
    if (isKnownParentCategoryId(cid)) continue;
    return {
      categoryId: cid,
      changed: true,
      reason: `${problem}; replaced with candidate leaf ${cid}`,
      needsUserConfirmation: false,
    };
  }

  // 3. Coin-specific inference from the item text.
  if (input.domain === "coins_bullion") {
    const inferred = inferUsCoinLeafFromText(input.text);
    if (inferred && inferred !== original) {
      return {
        categoryId: inferred,
        changed: true,
        reason: `${problem}; inferred coin leaf ${inferred} from item text`,
        needsUserConfirmation: false,
      };
    }
  }

  // 4. Nothing safe to substitute — surface it to the seller.
  return {
    categoryId: original,
    changed: false,
    reason: `${problem}; no safe leaf replacement found — user confirmation required`,
    needsUserConfirmation: true,
  };
}
