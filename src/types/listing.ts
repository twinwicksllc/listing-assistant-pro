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
  NEW_OTHER: 1500,                  // New Other (without tags)
  NEW_WITH_DEFECTS: 1750,           // New with defects
  CERTIFIED_REFURBISHED: 2000,
  SELLER_REFURBISHED: 2500,
  USED_EXCELLENT: 3000,             // AU-50 to XF-45 (lightly circulated)
  USED_VERY_GOOD: 4000,             // VF-20 to VF-35 (moderately circulated)
  USED_GOOD: 5000,                  // F-12 to VG-10 (heavily circulated)
  USED_ACCEPTABLE: 6000,            // G-4 to G-6 (heavily worn)
  FOR_PARTS_OR_NOT_WORKING: 7000,
};

// Human-readable labels for condition values
export const CONDITION_LABELS: Record<string, string> = {
  NEW: "New / Uncirculated",
  LIKE_NEW: "Like New",
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
};

export type ConditionOption = { value: string; label: string };

// Category ID sets matching the publish function's detection logic
const COIN_CATEGORY_IDS = new Set(["11981","39464","11980","11971","41099","41102","11973","39455","41084","11950","41111","166679","41109","526","253","45243","39471","39472","39473","39474","39475"]);
const BULLION_CATEGORY_IDS = new Set(["178906","39489","3361","532","173685"]);
const TRADING_CARD_CATEGORY_IDS = new Set(["261328","183454","2536","19107","64482","213"]);

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

  // eBay publish lifecycle tracking
  publishStatus?: PublishStatus;
  publishedAt?: Date;
  ebaySku?: string;
  ebayOfferId?: string;
  ebayListingId?: string;
  lastPublishError?: string;
}
