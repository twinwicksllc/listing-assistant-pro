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

export interface ListingDraft {
  id: string;
  imageUrl: string;
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  listingPrice?: number;         // User-chosen listing price
  listingFormat?: ListingFormat; // FIXED_PRICE (BIN) or AUCTION
  createdAt: Date;
  ebayCategoryId?: string;
  ebayCategoryBreadcrumb?: string; // e.g. "Coins > US > Dollars > Morgan"
  itemSpecifics?: ItemSpecifics;
  condition?: string;
  consignor?: string;
}
