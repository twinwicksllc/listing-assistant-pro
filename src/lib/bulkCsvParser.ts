import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ColumnMapping, BulkFieldName } from "@/types/bulk-listing";

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  fileName: string;
  fileType: "csv" | "excel";
}

// ─── CSV Parser ────────────────────────────────────────────────────────────────

export function parseCsvFile(file: File): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        resolve({
          headers: (results.meta.fields || []).map((f) => f.trim()),
          rows: results.data as Record<string, string>[],
          rowCount: results.data.length,
          fileName: file.name,
          fileType: "csv",
        });
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}

// ─── Excel Parser ──────────────────────────────────────────────────────────────

export async function parseExcelFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const raw: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, {
    defval: "",
    raw: false,
  });

  if (raw.length === 0) {
    return { headers: [], rows: [], rowCount: 0, fileName: file.name, fileType: "excel" };
  }

  const headers = Object.keys(raw[0]).map((h) => h.trim());
  const rows = raw.map((r) => {
    const clean: Record<string, string> = {};
    for (const k of Object.keys(r)) clean[k.trim()] = String(r[k] ?? "").trim();
    return clean;
  });

  return { headers, rows, rowCount: rows.length, fileName: file.name, fileType: "excel" };
}

// ─── Unified entry point ───────────────────────────────────────────────────────

export async function parseListingFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return parseCsvFile(file);
  if (ext === "xlsx" || ext === "xls") return parseExcelFile(file);
  throw new Error(`Unsupported file type: .${ext}. Please upload a .csv or .xlsx file.`);
}

// ─── Auto-column detection ─────────────────────────────────────────────────────

/**
 * Maps of known CSV header aliases → our internal BulkFieldName.
 * Case-insensitive, stripped of spaces/underscores.
 */
const ALIAS_MAP: Record<string, BulkFieldName> = {
  title: "title",
  name: "title",
  itemtitle: "title",
  listingtitle: "title",
  description: "description",
  desc: "description",
  itemdescription: "description",
  condition: "condition",
  itemcondition: "condition",
  price: "price",
  listingprice: "price",
  butitnowprice: "buyItNowPrice",
  binprice: "buyItNowPrice",
  auctionprice: "auctionStartPrice",
  startingbid: "auctionStartPrice",
  startprice: "auctionStartPrice",
  quantity: "quantity",
  qty: "quantity",
  stock: "quantity",
  categoryid: "categoryId",
  category: "categoryId",
  ebaycat: "categoryId",
  ebaycategoryid: "categoryId",
  format: "format",
  listingformat: "format",
  listingtype: "format",
  imageurl: "imageUrl1",
  imageurl1: "imageUrl1",
  photo: "imageUrl1",
  photo1: "imageUrl1",
  image1: "imageUrl1",
  imageurl2: "imageUrl2",
  photo2: "imageUrl2",
  image2: "imageUrl2",
  imageurl3: "imageUrl3",
  photo3: "imageUrl3",
  image3: "imageUrl3",
  imageurl4: "imageUrl4",
  imageurl5: "imageUrl5",
  imageurl6: "imageUrl6",
  imageurl7: "imageUrl7",
  imageurl8: "imageUrl8",
  fulfillmentpolicyid: "fulfillmentPolicyId",
  shippingpolicy: "fulfillmentPolicyId",
  paymentpolicyid: "paymentPolicyId",
  paymentpolicy: "paymentPolicyId",
  returnpolicyid: "returnPolicyId",
  returnpolicy: "returnPolicyId",
  cogs: "cogs",
  cost: "cogs",
  acquisitioncost: "cogs",
  purchaseprice: "cogs",
  consignor: "consignor",
  owner: "consignor",
  seller: "consignor",
};

function normalizeKey(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]/g, "");
}

export function autoDetectMappings(headers: string[]): ColumnMapping[] {
  return headers.map((h) => {
    const key = normalizeKey(h);

    // Direct alias match
    if (ALIAS_MAP[key]) {
      return { csvHeader: h, mappedTo: ALIAS_MAP[key] };
    }

    // Item_Specific_ prefix
    const itemSpecificMatch = h.match(/^item[_\s-]?specific[_\s-]?(.+)$/i);
    if (itemSpecificMatch) {
      return {
        csvHeader: h,
        mappedTo: "itemSpecific",
        itemSpecificKey: itemSpecificMatch[1].trim(),
      };
    }

    return { csvHeader: h, mappedTo: null };
  });
}

// ─── Apply mappings to raw rows ────────────────────────────────────────────────

export function applyMappings(
  rows: Record<string, string>[],
  mappings: ColumnMapping[]
): Array<Record<string, string> & { _itemSpecifics: Record<string, string> }> {
  return rows.map((raw, idx) => {
    const out: Record<string, string> = { _rowIndex: String(idx) };
    const _itemSpecifics: Record<string, string> = {};

    for (const mapping of mappings) {
      if (!mapping.mappedTo || mapping.mappedTo === "skip") continue;
      const val = (raw[mapping.csvHeader] ?? "").trim();
      if (!val) continue;

      if (mapping.mappedTo === "itemSpecific" && mapping.itemSpecificKey) {
        _itemSpecifics[mapping.itemSpecificKey] = val;
      } else {
        out[mapping.mappedTo] = val;
      }
    }

    return { ...out, _itemSpecifics };
  });
}