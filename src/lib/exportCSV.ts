import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import {
  EBAY_CONDITION_ID_MAP,
  normalizeEbayConditionDescription,
  type ItemSpecifics,
} from "@/types/listing";

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

const EBAY_CONDITION_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(EBAY_CONDITION_ID_MAP).map(([condition, conditionId]) => [
    condition,
    String(conditionId),
  ]),
);

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

export function conditionIdFromCategoryPolicy(
  condition: string,
  conditions: Array<{
    conditionId?: number | string;
    conditionDescription?: string;
  }>,
): string | undefined {
  const conditionEnum = normalizeEbayConditionDescription(condition);
  const match = conditions.find(
    (candidate) =>
      normalizeEbayConditionDescription(candidate.conditionDescription) ===
      conditionEnum,
  );
  if (match?.conditionId) return String(match.conditionId);

  if (
    conditionEnum === "PRE_OWNED_EXCELLENT" ||
    conditionEnum === "PRE_OWNED_FAIR"
  ) {
    const fallback =
      conditions.find(
        (candidate) =>
          normalizeEbayConditionDescription(candidate.conditionDescription) ===
          "USED_EXCELLENT",
      ) ?? conditions[0];
    return fallback?.conditionId ? String(fallback.conditionId) : undefined;
  }

  return undefined;
}

async function resolveEbayConditionId(listing: ListingData): Promise<string> {
  const conditionEnum =
    normalizeEbayConditionDescription(listing.condition) || listing.condition;
  const staticConditionId = EBAY_CONDITION_MAP[conditionEnum];
  const needsCategoryPolicy =
    conditionEnum === "PRE_OWNED_EXCELLENT" ||
    conditionEnum === "PRE_OWNED_FAIR";
  if (staticConditionId && (!needsCategoryPolicy || !listing.ebayCategoryId)) {
    return staticConditionId;
  }

  if (!listing.ebayCategoryId) return "3000";

  try {
    const { data, error } = await supabase.functions.invoke("category-lookup", {
      body: { action: "conditions", categoryId: listing.ebayCategoryId },
    });
    if (error || !Array.isArray(data?.conditions)) {
      return needsCategoryPolicy ? "3000" : (staticConditionId ?? "3000");
    }

    return (
      conditionIdFromCategoryPolicy(conditionEnum, data.conditions) ?? "3000"
    );
  } catch {
    return needsCategoryPolicy ? "3000" : (staticConditionId ?? "3000");
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
