import type { ItemSpecifics } from "@/types/listing";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const EBAY_CONDITION_MAP: Record<string, string> = {
  NEW: "1000",
  LIKE_NEW: "1500",
  USED_EXCELLENT: "2750",
  USED_VERY_GOOD: "3000",
  USED_GOOD: "4000",
  USED_ACCEPTABLE: "5000",
};

const FB_CONDITION_MAP: Record<string, string> = {
  NEW: "new",
  LIKE_NEW: "used_like_new",
  USED_EXCELLENT: "used_good",
  USED_VERY_GOOD: "used_good",
  USED_GOOD: "used_fair",
  USED_ACCEPTABLE: "used_fair",
};

interface ListingData {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string;
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  condition: string;
}

export function exportEbayFileExchange(listing: ListingData) {
  const headers = [
    "*Action(SiteID=US|Country=US|Currency=USD|Version=1193)",
    "*Category",
    "*Title",
    "*Description",
    "*ConditionID",
    "*Format",
    "*StartPrice",
    "PicURL",
  ];

  // Add item specifics as C: columns
  const specificEntries = Object.entries(listing.itemSpecifics).filter(([, v]) => v && v.trim() !== "");
  specificEntries.forEach(([key]) => {
    headers.push(`C:${key}`);
  });

  const values = [
    "Add",
    listing.ebayCategoryId || "",
    listing.title,
    listing.description,
    EBAY_CONDITION_MAP[listing.condition] || "3000",
    "FixedPrice",
    listing.priceMin.toFixed(2),
    listing.imageUrl,
  ];

  specificEntries.forEach(([, value]) => {
    values.push(value || "");
  });

  const csv = headers.map(escapeCSV).join(",") + "\n" + values.map(escapeCSV).join(",") + "\n";
  downloadCSV(`ebay-listing-${Date.now()}.csv`, csv);
}

export function exportFacebookMarketplace(listing: ListingData) {
  const headers = [
    "title",
    "description",
    "availability",
    "condition",
    "price",
    "currency",
    "image_link",
    "brand",
  ];

  const values = [
    listing.title,
    listing.description,
    "in stock",
    FB_CONDITION_MAP[listing.condition] || "used_good",
    listing.priceMin.toFixed(2),
    "USD",
    listing.imageUrl,
    listing.itemSpecifics.Brand || listing.itemSpecifics["Coin/Bullion Type"] || "",
  ];

  const csv = headers.map(escapeCSV).join(",") + "\n" + values.map(escapeCSV).join(",") + "\n";
  downloadCSV(`facebook-listing-${Date.now()}.csv`, csv);
}

export type ExportPlatform = "ebay_file_exchange" | "facebook_marketplace";

export function exportListing(platform: ExportPlatform, listing: ListingData) {
  if (platform === "ebay_file_exchange") {
    exportEbayFileExchange(listing);
  } else {
    exportFacebookMarketplace(listing);
  }
}
