import * as XLSX from "xlsx";
import type { ItemSpecifics } from "@/types/listing";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCSV(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/csv;charset=utf-8;" }));
}

const EBAY_CONDITION_MAP: Record<string, string> = {
  NEW: "1000",
  LIKE_NEW: "2750",                   // Like New / Open Box
  NEW_OTHER: "1500",                  // New Other (without tags)
  NEW_WITH_DEFECTS: "1750",           // New with defects
  CERTIFIED_REFURBISHED: "2000",
  EXCELLENT_REFURBISHED: "2010",
  VERY_GOOD_REFURBISHED: "2020",
  GOOD_REFURBISHED: "2030",
  SELLER_REFURBISHED: "2500",
  PRE_OWNED_GOOD: "3000",             // replaces USED_EXCELLENT / USED_VERY_GOOD
  PRE_OWNED_FAIR: "5000",             // replaces USED_GOOD
  PRE_OWNED_POOR: "6000",             // replaces USED_ACCEPTABLE
  FOR_PARTS_OR_NOT_WORKING: "7000",
};

const FB_CONDITION_MAP: Record<string, string> = {
  NEW: "new",
  LIKE_NEW: "used_like_new",
  NEW_OTHER: "new_other",
  NEW_WITH_DEFECTS: "new_other",
  CERTIFIED_REFURBISHED: "used_like_new",
  EXCELLENT_REFURBISHED: "used_like_new",
  VERY_GOOD_REFURBISHED: "used_good",
  GOOD_REFURBISHED: "used_good",
  SELLER_REFURBISHED: "used_good",
  PRE_OWNED_GOOD: "used_good",
  PRE_OWNED_FAIR: "used_fair",
  PRE_OWNED_POOR: "used_fair",
  FOR_PARTS_OR_NOT_WORKING: "used_poor",
};

export interface ListingData {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string;
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  condition: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
}

// --- Row builders (shared between CSV and Excel/Sheets) ---

function buildEbayRows(listing: ListingData): { headers: string[]; values: (string | number)[] } {
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

  const specificEntries = Object.entries(listing.itemSpecifics).filter(([, v]) => v && v.trim() !== "");
  specificEntries.forEach(([key]) => headers.push(`C:${key}`));

  // Include selected business policy IDs as supplemental columns
  if (listing.fulfillmentPolicyId) headers.push("FulfillmentPolicyID");
  if (listing.paymentPolicyId) headers.push("PaymentPolicyID");
  if (listing.returnPolicyId) headers.push("ReturnPolicyID");

  const values: (string | number)[] = [
    "Add",
    listing.ebayCategoryId || "",
    listing.title,
    listing.description,
    EBAY_CONDITION_MAP[listing.condition] || "3000",
    "FixedPrice",
    listing.priceMin,
    listing.imageUrl,
  ];
  specificEntries.forEach(([, value]) => values.push(value || ""));

  if (listing.fulfillmentPolicyId) values.push(listing.fulfillmentPolicyId);
  if (listing.paymentPolicyId) values.push(listing.paymentPolicyId);
  if (listing.returnPolicyId) values.push(listing.returnPolicyId);

  return { headers, values };
}

function buildFacebookRows(listing: ListingData): { headers: string[]; values: (string | number)[] } {
  const headers = ["title", "description", "availability", "condition", "price", "currency", "image_link", "brand"];
  const values: (string | number)[] = [
    listing.title,
    listing.description,
    "in stock",
    FB_CONDITION_MAP[listing.condition] || "used_good",
    listing.priceMin,
    "USD",
    listing.imageUrl,
    listing.itemSpecifics.Brand || listing.itemSpecifics["Coin/Bullion Type"] || "",
  ];
  return { headers, values };
}

// --- CSV exports ---

export function exportEbayFileExchange(listing: ListingData) {
  const { headers, values } = buildEbayRows(listing);
  const csv = headers.map(escapeCSV).join(",") + "\n" + values.map((v) => escapeCSV(String(v))).join(",") + "\n";
  downloadCSV(`ebay-listing-${Date.now()}.csv`, csv);
}

export function exportFacebookMarketplace(listing: ListingData) {
  const { headers, values } = buildFacebookRows(listing);
  const csv = headers.map(escapeCSV).join(",") + "\n" + values.map((v) => escapeCSV(String(v))).join(",") + "\n";
  downloadCSV(`facebook-listing-${Date.now()}.csv`, csv);
}

// --- Excel export (.xlsx) ---

function buildWorkbook(listing: ListingData, platform: ExportPlatform): XLSX.WorkBook {
  const { headers, values } = platform === "ebay_file_exchange" ? buildEbayRows(listing) : buildFacebookRows(listing);
  const ws = XLSX.utils.aoa_to_sheet([headers, values]);

  // Auto-size columns
  ws["!cols"] = headers.map((h, i) => ({
    wch: Math.max(h.length, String(values[i] ?? "").length, 12),
  }));

  const wb = XLSX.utils.book_new();
  const sheetName = platform === "ebay_file_exchange" ? "eBay Listing" : "FB Listing";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

export function exportExcel(listing: ListingData, platform: ExportPlatform) {
  const wb = buildWorkbook(listing, platform);
  const prefix = platform === "ebay_file_exchange" ? "ebay" : "facebook";
  XLSX.writeFile(wb, `${prefix}-listing-${Date.now()}.xlsx`);
}

// --- Google Sheets export (downloads as .xlsx that Google Sheets can open directly) ---

export function exportGoogleSheets(listing: ListingData, platform: ExportPlatform) {
  const wb = buildWorkbook(listing, platform);
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  // Build a Google Sheets import URL via the upload redirect trick
  // The most reliable cross-browser approach: download the .xlsx, user opens in Google Sheets
  // We create a download and then open Google Sheets with a hint
  const prefix = platform === "ebay_file_exchange" ? "ebay" : "facebook";
  const filename = `${prefix}-listing-${Date.now()}.xlsx`;
  downloadBlob(filename, blob);

  // Open Google Sheets in a new tab so user can import
  window.open("https://sheets.google.com/create", "_blank");
}

// --- Unified export ---

export type ExportPlatform = "ebay_file_exchange" | "facebook_marketplace";
export type ExportFormat = "csv" | "excel" | "google_sheets";

export function exportListing(platform: ExportPlatform, format: ExportFormat, listing: ListingData) {
  switch (format) {
    case "csv":
      if (platform === "ebay_file_exchange") exportEbayFileExchange(listing);
      else exportFacebookMarketplace(listing);
      break;
    case "excel":
      exportExcel(listing, platform);
      break;
    case "google_sheets":
      exportGoogleSheets(listing, platform);
      break;
  }
}
