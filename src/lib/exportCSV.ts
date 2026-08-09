import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
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
  downloadBlob(
    filename,
    new Blob([content], { type: "text/csv;charset=utf-8;" }),
  );
}

const EBAY_CONDITION_MAP: Record<string, string> = {
  NEW: "1000",
  LIKE_NEW: "2750", // Like New / Open Box
  VERY_GOOD: "3000",
  GOOD: "4000",
  ACCEPTABLE: "5000",
  NEW_OTHER: "1500", // New Other (without tags)
  NEW_WITH_DEFECTS: "1750", // New with defects
  CERTIFIED_REFURBISHED: "2000",
  EXCELLENT_REFURBISHED: "2010",
  VERY_GOOD_REFURBISHED: "2020",
  GOOD_REFURBISHED: "2030",
  SELLER_REFURBISHED: "2500",
  PRE_OWNED_GOOD: "3000", // replaces USED_EXCELLENT / USED_VERY_GOOD
  PRE_OWNED_FAIR: "5000", // replaces USED_GOOD
  PRE_OWNED_POOR: "6000", // replaces USED_ACCEPTABLE
  USED_EXCELLENT: "3000",
  USED_VERY_GOOD: "4000",
  USED_GOOD: "5000",
  USED_ACCEPTABLE: "6000",
  FOR_PARTS_OR_NOT_WORKING: "7000",
};

const FB_CONDITION_MAP: Record<string, string> = {
  NEW: "new",
  LIKE_NEW: "used_like_new",
  VERY_GOOD: "used_good",
  GOOD: "used_fair",
  ACCEPTABLE: "used_fair",
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
  USED_EXCELLENT: "used_good",
  USED_VERY_GOOD: "used_good",
  USED_GOOD: "used_fair",
  USED_ACCEPTABLE: "used_fair",
  FOR_PARTS_OR_NOT_WORKING: "used_poor",
  DIGITAL_GOOD: "new",
  CERTIFIED_PRE_OWNED: "used_like_new",
  REMANUFACTURED: "used_good",
  RETREAD: "used_good",
  DAMAGED: "used_poor",
};

export interface ListingData {
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  // Prefer multiple images; keep imageUrl for single-image compatibility
  imageUrl?: string;
  imageUrls?: string[];
  ebayCategoryId: string;
  itemSpecifics: ItemSpecifics;
  condition: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
}

function normalizeConditionDescriptorToEnum(
  value: string | undefined | null,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  const aliases: Record<string, string> = {
    "brand new": "NEW",
    new: "NEW",
    "new other (see details)": "NEW_OTHER",
    "new-open box": "NEW_OTHER",
    "new open box": "NEW_OTHER",
    "open box": "LIKE_NEW",
    "like new": "LIKE_NEW",
    used: "USED_EXCELLENT",
    "very good": "USED_VERY_GOOD",
    good: "USED_GOOD",
    acceptable: "USED_ACCEPTABLE",
    "for parts or not working": "FOR_PARTS_OR_NOT_WORKING",
    "certified refurbished": "CERTIFIED_REFURBISHED",
    "excellent refurbished": "EXCELLENT_REFURBISHED",
    "very good refurbished": "VERY_GOOD_REFURBISHED",
    "good refurbished": "GOOD_REFURBISHED",
    "seller refurbished": "SELLER_REFURBISHED",
    "pre-owned good": "PRE_OWNED_GOOD",
    "pre-owned fair": "PRE_OWNED_FAIR",
    "pre-owned poor": "PRE_OWNED_POOR",
    "digital good": "DIGITAL_GOOD",
    "certified pre-owned": "CERTIFIED_PRE_OWNED",
    remanufactured: "REMANUFACTURED",
    retread: "RETREAD",
    damaged: "DAMAGED",
  };

  return (
    aliases[lowered] ??
    raw
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  );
}

async function resolveEbayConditionId(listing: ListingData): Promise<string> {
  const staticConditionId = EBAY_CONDITION_MAP[listing.condition];
  if (staticConditionId) return staticConditionId;

  if (!listing.ebayCategoryId) return "3000";

  try {
    const { data, error } = await supabase.functions.invoke("category-lookup", {
      body: { action: "conditions", categoryId: listing.ebayCategoryId },
    });
    if (error || !Array.isArray(data?.conditions)) {
      return "3000";
    }

    const match = data.conditions.find(
      (condition: {
        conditionId?: number | string;
        conditionDescription?: string;
      }) =>
        normalizeConditionDescriptorToEnum(condition.conditionDescription) ===
        listing.condition,
    );

    return match?.conditionId ? String(match.conditionId) : "3000";
  } catch {
    return "3000";
  }
}

// --- Row builders (shared between CSV and Excel/Sheets) ---

async function buildEbayRows(
  listing: ListingData,
): Promise<{ headers: string[]; values: (string | number)[] }> {
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

  const specificEntries = Object.entries(listing.itemSpecifics).filter(
    ([, v]) => v && v.trim() !== "",
  );
  specificEntries.forEach(([key]) => headers.push(`C:${key}`));

  // Include selected business policy IDs as supplemental columns
  if (listing.fulfillmentPolicyId) headers.push("FulfillmentPolicyID");
  if (listing.paymentPolicyId) headers.push("PaymentPolicyID");
  if (listing.returnPolicyId) headers.push("ReturnPolicyID");

  const conditionId = await resolveEbayConditionId(listing);
  const values: (string | number)[] = [
    "Add",
    listing.ebayCategoryId || "",
    listing.title,
    listing.description,
    conditionId,
    "FixedPrice",
    listing.priceMin,
    // eBay File Exchange supports multiple picture URLs separated by semicolons
    listing.imageUrls && listing.imageUrls.length > 0
      ? listing.imageUrls.join(";")
      : listing.imageUrl || "",
  ];
  specificEntries.forEach(([, value]) => values.push(value || ""));

  if (listing.fulfillmentPolicyId) values.push(listing.fulfillmentPolicyId);
  if (listing.paymentPolicyId) values.push(listing.paymentPolicyId);
  if (listing.returnPolicyId) values.push(listing.returnPolicyId);

  return { headers, values };
}

function buildFacebookRows(listing: ListingData): {
  headers: string[];
  values: (string | number)[];
} {
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
  const values: (string | number)[] = [
    listing.title,
    listing.description,
    "in stock",
    FB_CONDITION_MAP[listing.condition] || "used_good",
    listing.priceMin,
    "USD",
    // Facebook expects a single image link — use the first provided image
    listing.imageUrls && listing.imageUrls.length > 0
      ? listing.imageUrls[0]
      : listing.imageUrl || "",
    listing.itemSpecifics.Brand ||
      listing.itemSpecifics["Coin/Bullion Type"] ||
      "",
  ];
  return { headers, values };
}

// --- CSV exports ---

export async function exportEbayFileExchange(listing: ListingData) {
  const { headers, values } = await buildEbayRows(listing);
  const csv =
    headers.map(escapeCSV).join(",") +
    "\n" +
    values.map((v) => escapeCSV(String(v))).join(",") +
    "\n";
  downloadCSV(`ebay-listing-${Date.now()}.csv`, csv);
}

export function exportFacebookMarketplace(listing: ListingData) {
  const { headers, values } = buildFacebookRows(listing);
  const csv =
    headers.map(escapeCSV).join(",") +
    "\n" +
    values.map((v) => escapeCSV(String(v))).join(",") +
    "\n";
  downloadCSV(`facebook-listing-${Date.now()}.csv`, csv);
}

// --- Excel export (.xlsx) ---

async function buildWorkbook(
  listing: ListingData,
  platform: ExportPlatform,
): Promise<XLSX.WorkBook> {
  const { headers, values } =
    platform === "ebay_file_exchange"
      ? await buildEbayRows(listing)
      : buildFacebookRows(listing);
  const ws = XLSX.utils.aoa_to_sheet([headers, values]);

  // Auto-size columns
  ws["!cols"] = headers.map((h, i) => ({
    wch: Math.max(h.length, String(values[i] ?? "").length, 12),
  }));

  const wb = XLSX.utils.book_new();
  const sheetName =
    platform === "ebay_file_exchange" ? "eBay Listing" : "FB Listing";
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

export async function exportExcel(
  listing: ListingData,
  platform: ExportPlatform,
) {
  const wb = await buildWorkbook(listing, platform);
  const prefix = platform === "ebay_file_exchange" ? "ebay" : "facebook";
  XLSX.writeFile(wb, `${prefix}-listing-${Date.now()}.xlsx`);
}

// --- Google Sheets export (downloads as .xlsx that Google Sheets can open directly) ---

export async function exportGoogleSheets(
  listing: ListingData,
  platform: ExportPlatform,
) {
  const wb = await buildWorkbook(listing, platform);
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

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

export async function exportListing(
  platform: ExportPlatform,
  format: ExportFormat,
  listing: ListingData,
) {
  switch (format) {
    case "csv":
      if (platform === "ebay_file_exchange")
        await exportEbayFileExchange(listing);
      else exportFacebookMarketplace(listing);
      break;
    case "excel":
      await exportExcel(listing, platform);
      break;
    case "google_sheets":
      await exportGoogleSheets(listing, platform);
      break;
  }
}
