import type { ListingFormat } from "./listing";

// ─── Core row shape ────────────────────────────────────────────────────────────

export interface BulkRow {
  rowIndex: number;
  title: string;
  description?: string;
  condition: string;
  price: number;
  quantity: number;
  categoryId: string;
  format: ListingFormat;
  auctionStartPrice?: number;
  buyItNowPrice?: number;
  imageUrls: string[];
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  itemSpecifics?: Record<string, string>;
  cogs?: number;
  consignor?: string;
}

// ─── Validation ────────────────────────────────────────────────────────────────

export type BulkRowStatus =
  | "pending"       // not yet validated
  | "valid"         // passed validation, ready to generate/publish
  | "generating"    // AI description in progress
  | "ready"         // description generated, ready to publish
  | "publishing"    // being sent to eBay right now
  | "published"     // successfully live on eBay
  | "error";        // failed with an error

export interface BulkValidationIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface BulkRowState {
  rowIndex: number;
  status: BulkRowStatus;
  errors: BulkValidationIssue[];
  warnings: BulkValidationIssue[];
  listingId?: string;
  offerId?: string;
  ebayUrl?: string;
  errorMessage?: string;
}

// ─── Column mapping ────────────────────────────────────────────────────────────

/** Internal canonical field names */
export type BulkFieldName =
  | "title"
  | "description"
  | "condition"
  | "price"
  | "quantity"
  | "categoryId"
  | "format"
  | "auctionStartPrice"
  | "buyItNowPrice"
  | "imageUrl1"
  | "imageUrl2"
  | "imageUrl3"
  | "imageUrl4"
  | "imageUrl5"
  | "imageUrl6"
  | "imageUrl7"
  | "imageUrl8"
  | "fulfillmentPolicyId"
  | "paymentPolicyId"
  | "returnPolicyId"
  | "cogs"
  | "consignor"
  | "itemSpecific";   // special: prefix "Item_Specific_X" maps to itemSpecifics[X]

export interface ColumnMapping {
  csvHeader: string;        // original column name from the uploaded file
  mappedTo: BulkFieldName | "skip" | null;
  itemSpecificKey?: string; // set when mappedTo === "itemSpecific"
}

// ─── Templates ─────────────────────────────────────────────────────────────────

export type BulkTemplateId = "coins" | "electronics" | "clothing" | "books" | "generic";

export interface BulkTemplate {
  id: BulkTemplateId;
  label: string;
  icon: string;
  description: string;
  defaultCategoryId: string;
  defaultCondition: string;
  columns: BulkFieldName[];
  itemSpecificKeys: string[];
  sampleRows: Partial<Record<string, string>>[];
}

// ─── Publish result ────────────────────────────────────────────────────────────

export interface BulkPublishResult {
  rowIndex: number;
  success: boolean;
  listingId?: string;
  offerId?: string;
  ebayUrl?: string;
  error?: string;
}

export interface BulkPublishSummary {
  total: number;
  published: number;
  failed: number;
  results: BulkPublishResult[];
}