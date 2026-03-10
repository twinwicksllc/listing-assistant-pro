export interface ItemSpecifics {
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
// The Inventory API accepts ConditionEnum strings (NEW, USED_EXCELLENT, etc.)
// BUT many categories require the numeric conditionId in the offer.
// We store the string internally and map to numeric at publish time.
// Reference: https://developer.ebay.com/devzone/finding/callref/Enums/conditionIdList.html
// ----------------------------------------------------------------
export const EBAY_CONDITION_ID_MAP: Record<string, number> = {
  NEW: 1000,
  LIKE_NEW: 2750,        // Like New / Open Box
  USED_EXCELLENT: 3000,  // Used - Excellent
  USED_VERY_GOOD: 4000,  // Used - Very Good
  USED_GOOD: 5000,       // Used - Good
  USED_ACCEPTABLE: 6000, // Used - Acceptable
};

// Human-readable labels for condition values
export const CONDITION_LABELS: Record<string, string> = {
  NEW: "New",
  LIKE_NEW: "Like New",
  USED_EXCELLENT: "Used – Excellent",
  USED_VERY_GOOD: "Used – Very Good",
  USED_GOOD: "Used – Good",
  USED_ACCEPTABLE: "Used – Acceptable",
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
  condition?: string;              // Internal enum: NEW, USED_EXCELLENT, etc.
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
