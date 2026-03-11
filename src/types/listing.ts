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
// As of 2024, eBay deprecated USED_EXCELLENT/USED_VERY_GOOD/USED_GOOD/USED_ACCEPTABLE.
// Current valid ConditionEnum values for pre-owned items:
//   PRE_OWNED_GOOD  -> replaces USED_EXCELLENT and USED_VERY_GOOD
//   PRE_OWNED_FAIR  -> replaces USED_GOOD
//   PRE_OWNED_POOR  -> replaces USED_ACCEPTABLE
// We store the current enum strings internally and map to numeric conditionId at publish time.
// Reference: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum
// ----------------------------------------------------------------
export const EBAY_CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,                   // Like New / Open Box
  NEW_OTHER: 1500,                  // New Other (without tags)
  NEW_WITH_DEFECTS: 1750,           // New with defects
  CERTIFIED_REFURBISHED: 2000,
  EXCELLENT_REFURBISHED: 2010,
  VERY_GOOD_REFURBISHED: 2020,
  GOOD_REFURBISHED: 2030,
  SELLER_REFURBISHED: 2500,
  PRE_OWNED_GOOD: 3000,             // replaces USED_EXCELLENT / USED_VERY_GOOD
  PRE_OWNED_FAIR: 5000,             // replaces USED_GOOD
  PRE_OWNED_POOR: 6000,             // replaces USED_ACCEPTABLE
  FOR_PARTS_OR_NOT_WORKING: 7000,
};

// Human-readable labels for condition values
export const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  LIKE_NEW: "Like New",
  NEW_OTHER: "New Other (without tags)",
  NEW_WITH_DEFECTS: "New with Defects",
  CERTIFIED_REFURBISHED: "Certified Refurbished",
  EXCELLENT_REFURBISHED: "Excellent – Refurbished",
  VERY_GOOD_REFURBISHED: "Very Good – Refurbished",
  GOOD_REFURBISHED: "Good – Refurbished",
  SELLER_REFURBISHED: "Seller Refurbished",
  PRE_OWNED_GOOD: "Pre-Owned – Good",
  PRE_OWNED_FAIR: "Pre-Owned – Fair",
  PRE_OWNED_POOR: "Pre-Owned – Poor",
  FOR_PARTS_OR_NOT_WORKING: "For Parts or Not Working",
};

export interface ListingDraft {
  id: string;
  imageUrl: string;
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  listingPrice?: number;           // User-chosen listing price
  listingFormat?: ListingFormat;   // FIXED_PRICE (BIN) or AUCTION
  createdAt: Date;
  ebayCategoryId?: string;
  ebayCategoryBreadcrumb?: string; // e.g. "Coins > US > Dollars > Morgan"
  itemSpecifics?: ItemSpecifics;
  condition?: string;              // Internal enum: NEW, PRE_OWNED_GOOD, PRE_OWNED_FAIR, etc.
  consignor?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  auctionDuration?: AuctionDuration; // Only for AUCTION format

  // eBay publish lifecycle tracking
  publishStatus?: PublishStatus;
  publishedAt?: Date;
  ebaySku?: string;
  ebayOfferId?: string;
  ebayListingId?: string;
  lastPublishError?: string;
}
