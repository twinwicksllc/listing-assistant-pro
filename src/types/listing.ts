export interface ItemSpecifics {
  Type?: string;
  Year?: string;
  Denomination?: string;
  Grade?: string;
  "Circulated/Uncirculated"?: string;
  "Coin/Bullion Type"?: string;
  "Mint Location"?: string;
  "Country/Region of Manufacture"?: string;
  Composition?: string;
  Certification?: string;
  "Strike Type"?: string;
  Brand?: string;
  Material?: string;
  [key: string]: string | undefined;
}

/**
 * eBay June 2026 structured coin condition requirement.
 * Required for all coins in Coins: US (253), Coins: World (256),
 * Coins: Canada (3377), Coins: Ancient (4733), Coins: Medieval (18466),
 * and every leaf category beneath them.
 */
export type CoinConditionDetail =
  | {
      type: "graded";
      gradingCompany: "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "ICCS" | "PMG" | "Legacy Currency Grading";
      /** Full grade string as on slab label, e.g. "MS 65", "PR 70 DCAM" */
      grade: string;
      /** Cert number — include when visible */
      certificationNumber?: string;
    }
  | {
      type: "raw";
      /** eBay standardized condition tier for ungraded coins */
      rawCondition:
        | "Uncirculated"
        | "Extremely Fine to About Uncirculated"
        | "Fine to Very Fine"
        | "Below Fine";
    };

export type ListingFormat = "FIXED_PRICE" | "AUCTION";

// Auction duration options for eBay listings
// eBay Inventory API requires one of these exact values for AUCTION format
export type AuctionDuration = "Days_1" | "Days_3" | "Days_5" | "Days_7" | "Days_10";

// Draft publish lifecycle status
export type PublishStatus = "draft" | "publishing" | "published" | "failed";

// ----------------------------------------------------------------
// eBay condition mapping
// USED_* is the correct family for coins/paper money and general used items.
// PRE_OWNED_* was briefly used but proved ambiguous (same names as unrelated grades).
// We use USED_* internally; all dropdowns expose USED_* directly.
// Reference: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
// ----------------------------------------------------------------
export const EBAY_CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,                   // Like New / Open Box
  VERY_GOOD: 3000,                  // Trading cards / media
  GOOD: 4000,
  ACCEPTABLE: 5000,
  NEW_OTHER: 1500,                  // New Other (without tags)
  NEW_WITH_DEFECTS: 1750,           // New with defects
  CERTIFIED_REFURBISHED: 2000,
  EXCELLENT_REFURBISHED: 2010,
  VERY_GOOD_REFURBISHED: 2020,
  GOOD_REFURBISHED: 2030,
  SELLER_REFURBISHED: 2500,
  USED_EXCELLENT: 3000,             // AU-50 to XF-45 (lightly circulated)
  USED_VERY_GOOD: 4000,             // VF-20 to VF-35 (moderately circulated)
  USED_GOOD: 5000,                  // F-12 to VG-10 (heavily circulated)
  USED_ACCEPTABLE: 6000,            // G-4 to G-6 (heavily worn)
  FOR_PARTS_OR_NOT_WORKING: 7000,
  PRE_OWNED_GOOD: 3000,
  PRE_OWNED_FAIR: 5000,
  PRE_OWNED_POOR: 6000,
};

export const SPECIAL_CONDITION_VALUES = [
  "DIGITAL_GOOD",
  "CERTIFIED_PRE_OWNED",
  "REMANUFACTURED",
  "RETREAD",
  "DAMAGED",
] as const;

export const SUPPORTED_CONDITION_VALUES = [
  ...Object.keys(EBAY_CONDITION_ID_MAP),
  ...SPECIAL_CONDITION_VALUES,
] as const;

// Human-readable labels for condition values
export const CONDITION_LABELS: Record<string, string> = {
  NEW: "New / Uncirculated",
  LIKE_NEW: "Like New",
  VERY_GOOD: "Very Good",
  GOOD: "Good",
  ACCEPTABLE: "Acceptable",
  NEW_OTHER: "New Other (without tags)",
  NEW_WITH_DEFECTS: "New with Defects",
  CERTIFIED_REFURBISHED: "Certified Refurbished",
  SELLER_REFURBISHED: "Seller Refurbished",
  USED_EXCELLENT: "Used – Excellent (lightly used/circulated)",
  USED_VERY_GOOD: "Used – Very Good (moderate wear)",
  USED_GOOD: "Used – Good (heavy wear)",
  USED_ACCEPTABLE: "Used – Acceptable (significant wear)",
  FOR_PARTS_OR_NOT_WORKING: "For Parts or Not Working",
  // Legacy value labels — kept so old DB records still display correctly
  PRE_OWNED_GOOD: "Used – Excellent (lightly used/circulated)",
  PRE_OWNED_FAIR: "Used – Acceptable (significant wear)",
  PRE_OWNED_POOR: "For Parts or Not Working",
  EXCELLENT_REFURBISHED: "Used – Excellent (lightly used/circulated)",
  VERY_GOOD_REFURBISHED: "Used – Very Good (moderate wear)",
  GOOD_REFURBISHED: "Used – Good (heavy wear)",
  DIGITAL_GOOD: "Digital Good",
  CERTIFIED_PRE_OWNED: "Certified pre-owned",
  REMANUFACTURED: "Remanufactured",
  RETREAD: "Retread",
  DAMAGED: "Damaged",
};

export type ConditionOption = { value: string; label: string };

// Category ID sets matching the publish function's detection logic.
// NOTE: Only LEAF category IDs are included here (no parent IDs like 253, 256, 3377, 4733, 18466).
// Parent categories are detected dynamically via breadcrumb patterns (e.g., "Coins: US", "Coins: World").
// This ensures the category detection works with actual eBay leaf categories that can be published.
const COIN_CATEGORY_IDS = new Set([
  // Original set
  "11981","39464","39456","11980","11949","11971","11956","41099","41102","11973","41103","39455","41084",
  "11950","41111","166679","41109","526","45243","39471","39472","39473","39474","39475",
  // US Coins — Dimes (40149-40167 range includes Mercury dimes = 40151)
  "40149","40150","40151","40152","40153","40154","40155","40156","40157",
  "40158","40159","40160","40161","40162","40163","40164","40165","40166","40167",
  // US Coins — parent/generic
  "253","11116","11118","164743",
  // eBay mandate coin parent categories (253=US, 256=World, 3377=Canada, 4733=Ancient, 18466=Medieval)
  "256","3377","4733","18466",
  // World / Ancient / Medieval / Exonumia / Bullion overlap
  "532","173685","3360","3361","3411","45244",
  "177652","177653","178906","166680","166681",
  // World Coins additional
  "261064","261068","261069","261070","261071","261072","261073",
  "261074","261075","261076",
  // Error coins / Proof sets / Rolls
  "19167","19168","19169","11063",
  // US Coins — additional subtypes
  "40196","40197","40198","40199","40200","40201","40202",
  // 2026+ America the Beautiful Quarters
  "171526", // America the Beautiful Quarters (2026)
  // US Quarters — early & classic type leaves (verified against live eBay browse nodes 2026-07).
  // These were missing, so the Raw/Graded coin-condition selector did not appear for them.
  "11962", // Quarters (US parent)
  "173587", // Draped Bust Quarters (1796-1807)
  "11963", // Capped Bust Quarters (1815-1838)
  "11964", // Seated Liberty Quarters (1838-1891)
  "11965", // Barber Quarters (1892-1916)
  "11966", // Standing Liberty Quarters (1916-1930)
  "39461", // Washington Quarters (1932-1998)
  // World coin leaves that support Grade (graded-friendly, NOT bullion):
  "3392",  // Coins: World > South Pacific (Cook Islands, Fiji, Niue, Palau, Tuvalu, etc.)
  "546",   // World Commemorative Coins
]);
// Bullion leaves that DO NOT support the Grade item specific on eBay.
// A graded/slabbed coin must NEVER be listed in one of these — it belongs in a
// numismatic coin category (US or World) that exposes Grade.
// Verified against live eBay browse nodes (2026-07):
//   39482 Bullion (parent) · 39489 Silver Bars & Rounds · 39487 Silver Bullion (lots)
//   178906 Gold Bars & Rounds · 39488 Platinum Bullion · 3361 Silver: Other
//   261068/261069 Bullion>Silver>Coins/Bars · 261071/178906 Gold · 166679 Other
const BULLION_CATEGORY_IDS = new Set([
  "39482","39489","39487","178906","39488","3361",
  "261068","261069","261070","261071","261072","261073","166679","166680","166681",
]);

/**
 * True when the category is a Bullion leaf that has no Grade item specific.
 * Used to warn the user when they try to place a graded/slabbed coin in bullion.
 */
export function isBullionCategory(
  categoryId: string | undefined,
  breadcrumb?: string | undefined,
): boolean {
  if (categoryId && BULLION_CATEGORY_IDS.has(categoryId)) return true;
  if (breadcrumb && /\bbullion\b|gold bar|silver bar|ingot/i.test(breadcrumb)) return true;
  return false;
}
const TRADING_CARD_CATEGORY_IDS = new Set(["261328","183454","2536","19107","64482","213"]);

const GENERAL_MARKETPLACE_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified - Refurbished" },
  { value: "EXCELLENT_REFURBISHED", label: "Excellent - Refurbished" },
  { value: "VERY_GOOD_REFURBISHED", label: "Very Good - Refurbished" },
  { value: "GOOD_REFURBISHED", label: "Good - Refurbished" },
];

const BOOK_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "Brand new" },
  { value: "LIKE_NEW", label: "Like new" },
  { value: "USED_VERY_GOOD", label: "Very good" },
  { value: "USED_GOOD", label: "Good" },
  { value: "USED_ACCEPTABLE", label: "Acceptable" },
];

const BUSINESS_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "NEW_OTHER", label: "New - open box" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified refurbished" },
  { value: "SELLER_REFURBISHED", label: "Seller refurbished" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" },
];

const ELECTRONICS_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "LIKE_NEW", label: "Open box" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified - Refurbished" },
  { value: "EXCELLENT_REFURBISHED", label: "Excellent - Refurbished" },
  { value: "VERY_GOOD_REFURBISHED", label: "Very Good - Refurbished" },
  { value: "GOOD_REFURBISHED", label: "Good - Refurbished" },
  { value: "SELLER_REFURBISHED", label: "Seller refurbished" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" },
];

const CLOTHING_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New with tags" },
  { value: "NEW_OTHER", label: "New without tags" },
  { value: "NEW_WITH_DEFECTS", label: "New with imperfections" },
  { value: "USED_EXCELLENT", label: "Pre-owned - Excellent" },
  { value: "PRE_OWNED_GOOD", label: "Pre-owned - Good" },
  { value: "PRE_OWNED_FAIR", label: "Pre-owned - Fair" },
];

const SHOES_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New with box" },
  { value: "NEW_OTHER", label: "New without box" },
  { value: "NEW_WITH_DEFECTS", label: "New with defects" },
  { value: "USED_EXCELLENT", label: "Pre-owned - Excellent" },
  { value: "PRE_OWNED_GOOD", label: "Pre-owned - Good" },
  { value: "PRE_OWNED_FAIR", label: "Pre-owned - Fair" },
];

const JEWELRY_SPORTING_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New with tags" },
  { value: "NEW_OTHER", label: "New without tags" },
  { value: "NEW_WITH_DEFECTS", label: "New with defects" },
  { value: "USED_EXCELLENT", label: "Pre-owned - Excellent" },
  { value: "PRE_OWNED_GOOD", label: "Pre-owned - Good" },
  { value: "PRE_OWNED_FAIR", label: "Pre-owned - Fair" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified - Refurbished" },
  { value: "EXCELLENT_REFURBISHED", label: "Excellent - Refurbished" },
  { value: "VERY_GOOD_REFURBISHED", label: "Very Good - Refurbished" },
  { value: "GOOD_REFURBISHED", label: "Good - Refurbished" },
];

const UNDERWEAR_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New with tags" },
  { value: "NEW_OTHER", label: "New without tags" },
  { value: "NEW_WITH_DEFECTS", label: "New with defects" },
];

const MEDIA_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "Brand new" },
  { value: "LIKE_NEW", label: "Like new" },
  { value: "VERY_GOOD", label: "Very good" },
  { value: "GOOD", label: "Good" },
  { value: "ACCEPTABLE", label: "Acceptable" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified - Refurbished" },
  { value: "EXCELLENT_REFURBISHED", label: "Excellent - Refurbished" },
  { value: "VERY_GOOD_REFURBISHED", label: "Very Good - Refurbished" },
  { value: "GOOD_REFURBISHED", label: "Good - Refurbished" },
];

const HEALTH_BEAUTY_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "LIKE_NEW", label: "Open box" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" },
  { value: "CERTIFIED_REFURBISHED", label: "Certified - Refurbished" },
  { value: "EXCELLENT_REFURBISHED", label: "Excellent - Refurbished" },
  { value: "VERY_GOOD_REFURBISHED", label: "Very Good - Refurbished" },
  { value: "GOOD_REFURBISHED", label: "Good - Refurbished" },
];

const MOTOR_VEHICLE_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "CERTIFIED_PRE_OWNED", label: "Certified pre-owned" },
  { value: "USED_EXCELLENT", label: "Used" },
];

const MOTOR_PARTS_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "NEW_OTHER", label: "New other (see details)" },
  { value: "REMANUFACTURED", label: "Remanufactured" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" },
];

const TIRE_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "NEW", label: "New" },
  { value: "RETREAD", label: "Retread" },
  { value: "USED_EXCELLENT", label: "Used" },
  { value: "DAMAGED", label: "Damaged" },
];

const NFT_CONDITION_OPTIONS: ConditionOption[] = [
  { value: "DIGITAL_GOOD", label: "Digital Good" },
];

export function getConditionLabel(condition: string): string {
  if (!condition) return "";
  if (CONDITION_LABELS[condition]) return CONDITION_LABELS[condition];

  return condition
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Derives the domain string from a category ID + optional breadcrumb.
 * Used when the user manually overrides the eBay category so that domain-
 * dependent UI (coin condition panel, condition options, item specifics) can
 * be refreshed to match the new category without re-running AI analysis.
 */
export function deriveDomainFromCategory(
  categoryId: string | undefined,
  breadcrumb: string | undefined,
): string {
  if (!categoryId) return "general";
  if (COIN_CATEGORY_IDS.has(categoryId)) return "coins_bullion";
  if (BULLION_CATEGORY_IDS.has(categoryId)) return "coins_bullion";
  if (TRADING_CARD_CATEGORY_IDS.has(categoryId)) return "trading_cards";
  // Breadcrumb-based fallback for IDs not in our hardcoded sets.
  // Covers all 12 domains so that manual category overrides route to the
  // correct domain-dependent UI (condition panel, item specifics, etc.).
  if (breadcrumb) {
    const bc = breadcrumb.toLowerCase();
    if (/coins?|paper money|currency|bullion|numismatic/i.test(bc)) return "coins_bullion";
    if (/trading card|sports card|pokemon|magic.*gathering|yu-?gi/i.test(bc)) return "trading_cards";
    if (/ring|necklace|bracelet|earring|brooch|watch|jewel/i.test(bc)) return "jewelry";
    if (/phone|tablet|laptop|console|camera|headphone|speaker|audio|tv|smart home/i.test(bc)) return "electronics";
    if (/sneaker|athletic shoe|running shoe|jordan|yeezy/i.test(bc)) return "sneakers";
    if (/handbag|tote|wallet|louis vuitton|chanel|herm/i.test(bc)) return "luxury_handbags";
    if (/guitar|bass|keyboard|drum|instrument|pedal|microphone|dj/i.test(bc)) return "musical_instruments";
    if (/action figure|diecast|lego|funko|comic|board game|doll|model kit/i.test(bc)) return "toys_collectibles";
    if (/auto part|car part|truck part|motorcycle|engine|wheel|tire|exhaust|suspension/i.test(bc)) return "auto_parts";
    if (/power tool|hand tool|lawn|garden|appliance|hvac|plumbing/i.test(bc)) return "home_garden_tools";
    if (/vintage clothing|apparel|fashion|clothing|shoe/i.test(bc)) return "vintage_clothing";
  }
  return "general";
}

export function isCoinConditionDetailRequired(
  categoryId: string | undefined,
  domain: string | undefined,
  breadcrumb: string | undefined,
  /** Backend-authoritative flag from _ebayMetadata.isCoinCategory.
   *  When truthy this short-circuits all local heuristics — no hardcoded
   *  category-ID list maintenance needed for new eBay coin subcategories. */
  isCoinCategoryFromBackend?: boolean,
): boolean {
  // 1. Backend said it's a coin — trust it unconditionally.
  if (isCoinCategoryFromBackend) return true;
  // 2. Backend domain signal (set by Pass-1 AI on every analysis).
  if (domain === "coins_bullion") return true;
  // 3. Local COIN_CATEGORY_IDS fallback — handles immediate UI updates when
  //    the user manually changes the category before a new analysis runs.
  if (categoryId && COIN_CATEGORY_IDS.has(categoryId)) return true;
  // 4. Breadcrumb regex fallback — same manual-change use-case.
  if (breadcrumb && /coin|paper money|currency|dollar|quarter|dime|nickel|penny|half eagle|double eagle|sovereign|bullion/i.test(breadcrumb)) return true;
  return false;
}

export function isCoinConditionDetailComplete(
  detail: CoinConditionDetail | null | undefined,
): boolean {
  if (!detail) return false;

  if (detail.type === "graded") {
    return Boolean(detail.gradingCompany && detail.grade.trim());
  }

  return Boolean(detail.rawCondition);
}

/**
 * Returns the condition options that make sense for a given category/domain.
 * Used by condition dropdowns so nonsensical options (e.g. "Certified Refurbished"
 * on a 19th century coin) never appear.
 */
export function getConditionsForCategory(
  categoryId: string | undefined,
  domain: string | undefined,
  breadcrumb: string | undefined,
): ConditionOption[] {
  const normalizedBreadcrumb = breadcrumb?.toLowerCase() ?? "";
  const isCoin = (categoryId && COIN_CATEGORY_IDS.has(categoryId))
    || domain === "coins_bullion"
    || (breadcrumb && /coin|paper money|currency|dollar|quarter|dime|nickel|penny|half eagle|double eagle|sovereign|bullion/i.test(breadcrumb));
  const isBullion = (categoryId && BULLION_CATEGORY_IDS.has(categoryId))
    || (breadcrumb && /bullion|gold bar|silver bar|ingot/i.test(breadcrumb));
  const isTradingCard = (categoryId && TRADING_CARD_CATEGORY_IDS.has(categoryId))
    || domain === "trading_cards"
    || (breadcrumb && /trading card|sports card|pokemon|magic.*gathering/i.test(breadcrumb));

  if (isCoin || isBullion) {
    // Coins & precious metals only — no "refurbished", no "defects", no "for parts"
    return [
      { value: "NEW",           label: "New / Uncirculated (MS-60 to MS-70)" },
      { value: "USED_EXCELLENT",label: "Used – Excellent (AU/XF — light wear)" },
      { value: "USED_VERY_GOOD",label: "Used – Very Good (VF — moderate wear)" },
      { value: "USED_GOOD",     label: "Used – Good (F — heavy wear)" },
      { value: "USED_ACCEPTABLE",label: "Used – Acceptable (G — heavily worn)" },
      { value: "FOR_PARTS_OR_NOT_WORKING", label: "Damaged / Holed / Not Collectible" },
    ];
  }

  if (isTradingCard) {
    return [
      { value: "LIKE_NEW",      label: "Like New (Near Mint)" },
      { value: "VERY_GOOD",     label: "Very Good (light play wear)" },
      { value: "GOOD",          label: "Good (moderate play wear)" },
      { value: "ACCEPTABLE",    label: "Acceptable (heavy wear)" },
    ];
  }

  if (/books|magazines/.test(normalizedBreadcrumb)) {
    return BOOK_CONDITION_OPTIONS;
  }

  if (/business\s*&\s*industrial/.test(normalizedBreadcrumb)) {
    return BUSINESS_CONDITION_OPTIONS;
  }

  if (/cameras|cell phones|computers|electronics|home\s*&\s*garden|musical instruments|headphones|portable audio|video game consoles|smart home/.test(normalizedBreadcrumb)) {
    return ELECTRONICS_CONDITION_OPTIONS;
  }

  if (/clothing, shoes\s*&\s*accessories\s*>\s*clothing/.test(normalizedBreadcrumb)) {
    return CLOTHING_CONDITION_OPTIONS;
  }

  if (/clothing, shoes\s*&\s*accessories\s*>\s*shoes/.test(normalizedBreadcrumb)) {
    return SHOES_CONDITION_OPTIONS;
  }

  if (/clothing, shoes\s*&\s*accessories\s*>\s*(jewelry\s*&\s*watches|sporting goods)/.test(normalizedBreadcrumb)) {
    return JEWELRY_SPORTING_CONDITION_OPTIONS;
  }

  if (/clothing, shoes\s*&\s*accessories\s*>\s*underwear/.test(normalizedBreadcrumb)) {
    return UNDERWEAR_CONDITION_OPTIONS;
  }

  if (/movies|music|video games/.test(normalizedBreadcrumb)) {
    return MEDIA_CONDITION_OPTIONS;
  }

  if (/motors\s*:\s*cars\s*&\s*trucks/.test(normalizedBreadcrumb)) {
    return MOTOR_VEHICLE_CONDITION_OPTIONS;
  }

  if (/motors\s*:\s*parts\s*&\s*accessories/.test(normalizedBreadcrumb)) {
    return MOTOR_PARTS_CONDITION_OPTIONS;
  }

  if (/tires/.test(normalizedBreadcrumb)) {
    return TIRE_CONDITION_OPTIONS;
  }

  if (/non-fungible tokens|nft/.test(normalizedBreadcrumb)) {
    return NFT_CONDITION_OPTIONS;
  }

  if (/health\s*&\s*beauty/.test(normalizedBreadcrumb)) {
    return HEALTH_BEAUTY_CONDITION_OPTIONS;
  }

  if (/baby|collectibles|crafts|dolls\s*&\s*bears|pet supplies|toys\s*&\s*hobbies/.test(normalizedBreadcrumb)) {
    return GENERAL_MARKETPLACE_CONDITION_OPTIONS;
  }

  // General / electronics / clothing / collectibles
  return [
    { value: "NEW",                      label: "New" },
    { value: "LIKE_NEW",                 label: "Like New / Open Box" },
    { value: "NEW_OTHER",                label: "New Other (without tags)" },
    { value: "USED_EXCELLENT",           label: "Used – Excellent" },
    { value: "USED_VERY_GOOD",           label: "Used – Very Good" },
    { value: "USED_GOOD",                label: "Used – Good" },
    { value: "USED_ACCEPTABLE",          label: "Used – Acceptable" },
    { value: "CERTIFIED_REFURBISHED",    label: "Certified Refurbished" },
    { value: "SELLER_REFURBISHED",       label: "Seller Refurbished" },
    { value: "FOR_PARTS_OR_NOT_WORKING", label: "For Parts or Not Working" },
  ];
}

export interface ListingDraft {
  id: string;
  // Prefer storing multiple images; keep `imageUrl` for backward compatibility
  imageUrl: string;
  imageUrls?: string[];
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  listingPrice?: number;           // User-chosen listing price
  listingFormat?: ListingFormat;   // FIXED_PRICE (BIN) or AUCTION
  createdAt: Date;
  ebayCategoryId?: string;
  ebayCategoryBreadcrumb?: string; // e.g. "Coins > US > Dollars > Morgan"
  suggestedCategories?: Array<{ categoryId: string; categoryName: string; reason: string; breadcrumb?: string }>;
  // Item domain classified by Pass-1 AI identification (e.g. "coins_bullion",
  // "sneakers", "electronics"). Persisted so per-domain quality metrics
  // (time-to-sale, net profit) can be computed once a listing sells.
  domain?: string;
  itemSpecifics?: ItemSpecifics;
  condition?: string;              // Internal enum: NEW, PRE_OWNED_GOOD, PRE_OWNED_FAIR, etc.
  consignor?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  auctionDuration?: AuctionDuration; // Only for AUCTION format

  // Best Offer settings (FIXED_PRICE only)
  bestOfferEnabled?: boolean;
  bestOfferAutoAcceptPrice?: number;   // Optional: auto-accept offers >= this price
  bestOfferAutoDeclinePrice?: number;  // Optional: auto-decline offers <= this price

  // Multi-quantity support (FIXED_PRICE only)
  quantity?: number;                 // How many units are available (default 1)
  pricingMode?: 'per_item' | 'total'; // Whether listingPrice is per-item or total for all units

  // eBay video support (FIXED_PRICE only)
  videoUrl?: string;           // Supabase Storage public URL for the raw video file
  ebayVideoId?: string;        // eBay Video API videoId
  ebayVideoStatus?: string;    // PENDING | PROCESSING | LIVE | FAILED

  // Cost of Goods Sold — what the seller paid to acquire this item
  cogs?: number;             // purchase cost in USD
  cogsSource?: string;       // 'manual' | 'import' | 'consignor_split'
  cogsAcquiredAt?: Date;     // date item was acquired (for aged-inventory reporting)

  // Precious metal content (used for melt-value floor alerts)
  metalType?: string;        // "gold" | "silver" | "platinum" | "none"
  metalWeightOz?: number;    // troy oz of precious metal content

  // Package dimensions for eBay shipping (sent as packageWeightAndSize)
  packageWeightLb?: number;  // whole-pound component of shipping weight
  packageWeightOz?: number;  // oz component of shipping weight (0–15.99)
  packageLengthIn?: number;  // package length in inches
  packageWidthIn?: number;   // package width in inches
  packageHeightIn?: number;  // package height in inches

  /**
   * eBay June 2026 structured coin condition requirement.
   * Required for coins in US/World/Canada/Ancient/Medieval categories.
   * Stored in item_specifics under the reserved key "_coinConditionDetail".
   */
  coinConditionDetail?: CoinConditionDetail | null;

  // eBay publish lifecycle tracking
  publishStatus?: PublishStatus;
  publishedAt?: Date;
  ebaySku?: string;
  ebayOfferId?: string;
  ebayListingId?: string;
  lastPublishError?: string;
}
