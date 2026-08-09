import type {
  BulkRow,
  BulkRowState,
  BulkValidationIssue,
} from "@/types/bulk-listing";
import { SUPPORTED_CONDITION_VALUES } from "@/types/listing";

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_CONDITIONS = [...SUPPORTED_CONDITION_VALUES];

const VALID_FORMATS = ["FIXED_PRICE", "AUCTION"];

// ─── Single row validation ─────────────────────────────────────────────────────

export function validateRow(row: BulkRow): BulkRowState {
  const errors: BulkValidationIssue[] = [];
  const warnings: BulkValidationIssue[] = [];

  // Title
  if (!row.title || row.title.trim().length === 0) {
    errors.push({
      field: "title",
      message: "Title is required",
      severity: "error",
    });
  } else if (row.title.trim().length > 80) {
    errors.push({
      field: "title",
      message: `Title too long (${row.title.trim().length}/80 chars)`,
      severity: "error",
    });
  } else if (row.title.trim().length < 5) {
    warnings.push({
      field: "title",
      message:
        "Title is very short — add more detail for better search visibility",
      severity: "warning",
    });
  }

  // Price
  if (row.format === "FIXED_PRICE" || !row.format) {
    if (!row.price || row.price <= 0) {
      errors.push({
        field: "price",
        message: "Price must be greater than $0",
        severity: "error",
      });
    } else if (row.price < 0.99) {
      warnings.push({
        field: "price",
        message: "eBay minimum price is $0.99",
        severity: "warning",
      });
    }
  }

  // Auction start price
  if (row.format === "AUCTION") {
    if (!row.auctionStartPrice || row.auctionStartPrice <= 0) {
      errors.push({
        field: "auctionStartPrice",
        message: "Auction starting bid must be greater than $0",
        severity: "error",
      });
    }
  }

  // Category ID
  if (!row.categoryId || row.categoryId.trim().length === 0) {
    errors.push({
      field: "categoryId",
      message: "eBay Category ID is required",
      severity: "error",
    });
  } else if (!/^\d+$/.test(row.categoryId.trim())) {
    errors.push({
      field: "categoryId",
      message: "Category ID must be a number (e.g. 39464)",
      severity: "error",
    });
  }

  // Condition
  if (!row.condition || row.condition.trim().length === 0) {
    errors.push({
      field: "condition",
      message: "Condition is required",
      severity: "error",
    });
  } else if (!VALID_CONDITIONS.includes(row.condition.trim().toUpperCase())) {
    errors.push({
      field: "condition",
      message: `Invalid condition "${row.condition}". Use a supported eBay condition such as NEW, USED_EXCELLENT, CERTIFIED_REFURBISHED, DIGITAL_GOOD, REMANUFACTURED, or DAMAGED.`,
      severity: "error",
    });
  }

  // Format
  if (row.format && !VALID_FORMATS.includes(row.format.trim().toUpperCase())) {
    errors.push({
      field: "format",
      message: `Invalid format "${row.format}". Use FIXED_PRICE or AUCTION`,
      severity: "error",
    });
  }

  // Quantity
  if (row.quantity !== undefined && (isNaN(row.quantity) || row.quantity < 1)) {
    errors.push({
      field: "quantity",
      message: "Quantity must be at least 1",
      severity: "error",
    });
  }

  // Image URLs (warnings only — images are optional for draft creation)
  if (!row.imageUrls || row.imageUrls.length === 0) {
    warnings.push({
      field: "imageUrls",
      message: "No image URLs — listings without photos get fewer views",
      severity: "warning",
    });
  } else {
    for (const url of row.imageUrls) {
      if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        warnings.push({
          field: "imageUrls",
          message: `Image URL "${url.slice(0, 40)}..." doesn't start with http/https`,
          severity: "warning",
        });
        break;
      }
    }
    if (row.imageUrls.length > 8) {
      warnings.push({
        field: "imageUrls",
        message: "eBay allows max 8 images — only first 8 will be used",
        severity: "warning",
      });
    }
  }

  // COGS sanity check
  if (row.cogs !== undefined && row.cogs < 0) {
    errors.push({
      field: "cogs",
      message: "COGS cannot be negative",
      severity: "error",
    });
  }

  // Price vs COGS warning
  if (row.cogs !== undefined && row.price > 0 && row.cogs > row.price) {
    warnings.push({
      field: "cogs",
      message: `COGS ($${row.cogs.toFixed(2)}) exceeds listing price ($${row.price.toFixed(2)}) — this would be a loss`,
      severity: "warning",
    });
  }

  const hasErrors = errors.length > 0;

  return {
    rowIndex: row.rowIndex,
    status: hasErrors ? "error" : "valid",
    errors,
    warnings,
  };
}

// ─── Validate all rows ─────────────────────────────────────────────────────────

export function validateAllRows(rows: BulkRow[]): BulkRowState[] {
  return rows.map((row) => validateRow(row));
}

// ─── Convert raw mapped data to BulkRow ────────────────────────────────────────

export function rawToBulkRow(
  raw: Record<string, string> & { _itemSpecifics: Record<string, string> },
  rowIndex: number,
): BulkRow {
  // Collect image URLs from imageUrl1..imageUrl8
  const imageUrls: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const url = raw[`imageUrl${i}`]?.trim();
    if (url) imageUrls.push(url);
  }

  // Normalize condition to uppercase
  const rawCondition = (raw.condition || "USED_EXCELLENT").trim().toUpperCase();
  const condition = VALID_CONDITIONS.includes(rawCondition)
    ? rawCondition
    : "USED_EXCELLENT";

  // Normalize format
  const rawFormat = (raw.format || "FIXED_PRICE").trim().toUpperCase();
  const format = rawFormat === "AUCTION" ? "AUCTION" : "FIXED_PRICE";

  const price = parseFloat(raw.price || "0") || 0;
  const quantity = parseInt(raw.quantity || "1", 10) || 1;
  const auctionStartPrice = raw.auctionStartPrice
    ? parseFloat(raw.auctionStartPrice)
    : undefined;
  const buyItNowPrice = raw.buyItNowPrice
    ? parseFloat(raw.buyItNowPrice)
    : undefined;
  const cogs = raw.cogs ? parseFloat(raw.cogs) : undefined;

  return {
    rowIndex,
    title: (raw.title || "").trim().slice(0, 80),
    description: raw.description?.trim() || undefined,
    condition,
    price,
    quantity,
    categoryId: (raw.categoryId || "").trim(),
    format,
    auctionStartPrice,
    buyItNowPrice,
    imageUrls,
    fulfillmentPolicyId: raw.fulfillmentPolicyId?.trim() || undefined,
    paymentPolicyId: raw.paymentPolicyId?.trim() || undefined,
    returnPolicyId: raw.returnPolicyId?.trim() || undefined,
    itemSpecifics:
      Object.keys(raw._itemSpecifics).length > 0
        ? raw._itemSpecifics
        : undefined,
    cogs: cogs !== undefined && !isNaN(cogs) ? cogs : undefined,
    consignor: raw.consignor?.trim() || undefined,
  };
}

// ─── Validation summary helpers ────────────────────────────────────────────────

export function countValidRows(states: BulkRowState[]): number {
  return states.filter((s) => s.status === "valid" || s.status === "ready")
    .length;
}

export function countErrorRows(states: BulkRowState[]): number {
  return states.filter((s) => s.status === "error").length;
}

export function countWarningRows(states: BulkRowState[]): number {
  return states.filter((s) => s.warnings.length > 0 && s.status !== "error")
    .length;
}

export function getValidRows(
  rows: BulkRow[],
  states: BulkRowState[],
): BulkRow[] {
  const validIndices = new Set(
    states
      .filter((s) => s.status === "valid" || s.status === "ready")
      .map((s) => s.rowIndex),
  );
  return rows.filter((r) => validIndices.has(r.rowIndex));
}
