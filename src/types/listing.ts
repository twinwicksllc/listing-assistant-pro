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

export interface ListingDraft {
  id: string;
  imageUrl: string;
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  createdAt: Date;
  ebayCategoryId?: string;
  itemSpecifics?: ItemSpecifics;
  condition?: string;
}
