import type { ColumnMapping, BulkFieldName } from "@/types/bulk-listing";
import { CheckCircle, AlertCircle } from "lucide-react";

// Human-readable labels for all internal field names
const FIELD_LABELS: Record<BulkFieldName | "skip", string> = {
  title: "Title",
  description: "Description",
  condition: "Condition",
  price: "Price",
  quantity: "Quantity",
  categoryId: "Category ID",
  format: "Format (FIXED_PRICE / AUCTION)",
  auctionStartPrice: "Auction Start Price",
  buyItNowPrice: "Buy It Now Price",
  imageUrl1: "Image URL 1",
  imageUrl2: "Image URL 2",
  imageUrl3: "Image URL 3",
  imageUrl4: "Image URL 4",
  imageUrl5: "Image URL 5",
  imageUrl6: "Image URL 6",
  imageUrl7: "Image URL 7",
  imageUrl8: "Image URL 8",
  fulfillmentPolicyId: "Fulfillment Policy ID",
  paymentPolicyId: "Payment Policy ID",
  returnPolicyId: "Return Policy ID",
  cogs: "COGS (Cost of Goods)",
  consignor: "Consignor",
  itemSpecific: "Item Specific (custom key)",
  skip: "— Skip this column —",
};

const REQUIRED_FIELDS: BulkFieldName[] = [
  "title",
  "condition",
  "price",
  "categoryId",
];

interface BulkColumnMapperProps {
  headers: string[];
  previewRows: Record<string, string>[];
  mappings: ColumnMapping[];
  onMappingsChange: (mappings: ColumnMapping[]) => void;
}

export default function BulkColumnMapper({
  headers,
  previewRows,
  mappings,
  onMappingsChange,
}: BulkColumnMapperProps) {
  const updateMapping = (
    index: number,
    mappedTo: BulkFieldName | "skip" | null,
    itemSpecificKey?: string,
  ) => {
    const next = mappings.map((m, i) =>
      i === index
        ? {
            ...m,
            mappedTo,
            itemSpecificKey:
              mappedTo === "itemSpecific"
                ? (itemSpecificKey ?? m.itemSpecificKey)
                : undefined,
          }
        : m,
    );
    onMappingsChange(next);
  };

  const updateItemSpecificKey = (index: number, key: string) => {
    const next = mappings.map((m, i) =>
      i === index ? { ...m, itemSpecificKey: key } : m,
    );
    onMappingsChange(next);
  };

  // Check which required fields are mapped
  const mappedFields = new Set(mappings.map((m) => m.mappedTo).filter(Boolean));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
  const allRequiredMapped = missingRequired.length === 0;

  const allOptions: (BulkFieldName | "skip")[] = [
    "skip",
    "title",
    "description",
    "condition",
    "price",
    "quantity",
    "categoryId",
    "format",
    "auctionStartPrice",
    "buyItNowPrice",
    "imageUrl1",
    "imageUrl2",
    "imageUrl3",
    "imageUrl4",
    "imageUrl5",
    "imageUrl6",
    "imageUrl7",
    "imageUrl8",
    "fulfillmentPolicyId",
    "paymentPolicyId",
    "returnPolicyId",
    "cogs",
    "consignor",
    "itemSpecific",
  ];

  return (
    <div className="space-y-4">
      {/* Required fields checklist */}
      <div className="flex flex-wrap gap-2">
        {REQUIRED_FIELDS.map((f) => {
          const mapped = mappedFields.has(f);
          return (
            <div
              key={f}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                mapped
                  ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300"
                  : "bg-red-50 border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300"
              }`}
            >
              {mapped ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <AlertCircle className="w-3 h-3" />
              )}
              {FIELD_LABELS[f]}
            </div>
          );
        })}
      </div>

      {!allRequiredMapped && (
        <p className="text-xs text-red-600 dark:text-red-400">
          ⚠️ Please map all required fields before continuing. Missing:{" "}
          {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")}
        </p>
      )}

      {/* Mapping table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-secondary/50 border-b border-border">
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-1/4">
                Your CSV Column
              </th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-1/3">
                Maps To
              </th>
              <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">
                Preview (first row)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {mappings.map((mapping, idx) => {
              const preview = previewRows[0]?.[mapping.csvHeader] ?? "";
              const isRequired = REQUIRED_FIELDS.includes(
                mapping.mappedTo as BulkFieldName,
              );
              const isMissing =
                isRequired &&
                (!mapping.mappedTo || mapping.mappedTo === "skip");

              return (
                <tr
                  key={mapping.csvHeader}
                  className={`${isMissing ? "bg-red-50/30 dark:bg-red-950/20" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {mapping.csvHeader}
                  </td>
                  <td className="px-3 py-2 space-y-1">
                    <select
                      value={mapping.mappedTo ?? "skip"}
                      onChange={(e) =>
                        updateMapping(
                          idx,
                          e.target.value as BulkFieldName | "skip",
                        )
                      }
                      className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {allOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {FIELD_LABELS[opt]}
                        </option>
                      ))}
                    </select>
                    {mapping.mappedTo === "itemSpecific" && (
                      <input
                        type="text"
                        placeholder="Specific key name (e.g. Brand)"
                        value={mapping.itemSpecificKey ?? ""}
                        onChange={(e) =>
                          updateItemSpecificKey(idx, e.target.value)
                        }
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">
                    {preview || (
                      <span className="italic opacity-40">empty</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: Columns set to "Skip" will be ignored. Item Specific columns let
        you map your own custom attributes.
      </p>
    </div>
  );
}
