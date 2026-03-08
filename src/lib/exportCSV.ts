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

export interface ListingData {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string;
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  condition: string;
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
