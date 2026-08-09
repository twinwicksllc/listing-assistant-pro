import { useState, useCallback } from "react";
import {
  Trash2,
  Copy,
  Plus,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type {
  BulkRow,
  BulkRowState,
  BulkRowStatus,
} from "@/types/bulk-listing";
import { CONDITION_LABELS } from "@/types/listing";

interface BulkDataTableProps {
  rows: BulkRow[];
  rowStates: BulkRowState[];
  onRowsChange: (rows: BulkRow[]) => void;
  disabled?: boolean;
}

const STATUS_ICON: Record<BulkRowStatus, JSX.Element> = {
  pending: <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />,
  valid: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
  generating: (
    <div className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  ),
  ready: <CheckCircle className="w-3.5 h-3.5 text-primary" />,
  publishing: (
    <div className="w-3.5 h-3.5 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
  ),
  published: <CheckCircle className="w-3.5 h-3.5 text-green-600" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-destructive" />,
};

const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export default function BulkDataTable({
  rows,
  rowStates,
  onRowsChange,
  disabled = false,
}: BulkDataTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    rowIdx: number;
    field: string;
  } | null>(null);

  const getState = useCallback(
    (rowIndex: number): BulkRowState | undefined =>
      rowStates.find((s) => s.rowIndex === rowIndex),
    [rowStates],
  );

  const updateRow = useCallback(
    (rowIndex: number, updates: Partial<BulkRow>) => {
      onRowsChange(
        rows.map((r) => (r.rowIndex === rowIndex ? { ...r, ...updates } : r)),
      );
    },
    [rows, onRowsChange],
  );

  const deleteRow = (rowIndex: number) => {
    onRowsChange(rows.filter((r) => r.rowIndex !== rowIndex));
  };

  const duplicateRow = (rowIndex: number) => {
    const src = rows.find((r) => r.rowIndex === rowIndex);
    if (!src) return;
    const newIndex = Math.max(...rows.map((r) => r.rowIndex)) + 1;
    const newRow: BulkRow = { ...src, rowIndex: newIndex };
    const srcIdx = rows.findIndex((r) => r.rowIndex === rowIndex);
    const next = [...rows];
    next.splice(srcIdx + 1, 0, newRow);
    onRowsChange(next);
  };

  const addRow = () => {
    const newIndex =
      rows.length > 0 ? Math.max(...rows.map((r) => r.rowIndex)) + 1 : 0;
    onRowsChange([
      ...rows,
      {
        rowIndex: newIndex,
        title: "",
        condition: "PRE_OWNED_GOOD",
        price: 0,
        quantity: 1,
        categoryId: "",
        format: "FIXED_PRICE",
        imageUrls: [],
      },
    ]);
  };

  const toggleExpand = (rowIndex: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };

  const isEditing = (rowIdx: number, field: string) =>
    editingCell?.rowIdx === rowIdx && editingCell?.field === field;

  const startEdit = (rowIdx: number, field: string) => {
    if (!disabled) setEditingCell({ rowIdx, field });
  };

  const stopEdit = () => setEditingCell(null);

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="hidden sm:grid grid-cols-[24px_1fr_90px_70px_80px_72px_60px] gap-2 px-3 py-2 bg-secondary/50 rounded-lg text-xs font-medium text-muted-foreground">
        <span />
        <span>Title</span>
        <span>Condition</span>
        <span>Price</span>
        <span>Category</span>
        <span>Qty</span>
        <span />
      </div>

      {/* Data rows */}
      <div className="space-y-1">
        {rows.map((row) => {
          const state = getState(row.rowIndex);
          const hasErrors = (state?.errors.length ?? 0) > 0;
          const hasWarnings = (state?.warnings.length ?? 0) > 0;
          const isExpanded = expandedRows.has(row.rowIndex);
          const status = state?.status ?? "pending";

          return (
            <div
              key={row.rowIndex}
              className={`rounded-xl border transition-colors ${
                hasErrors
                  ? "border-red-300 bg-red-50/30 dark:border-red-800 dark:bg-red-950/20"
                  : hasWarnings
                    ? "border-yellow-300 bg-yellow-50/20 dark:border-yellow-800 dark:bg-yellow-950/10"
                    : status === "published"
                      ? "border-green-300 bg-green-50/20 dark:border-green-800 dark:bg-green-950/10"
                      : "border-border bg-card"
              }`}
            >
              {/* Main row */}
              <div className="grid grid-cols-[24px_1fr_auto] sm:grid-cols-[24px_1fr_90px_70px_80px_72px_60px] gap-2 items-center px-3 py-2.5">
                {/* Status icon */}
                <div className="flex items-center justify-center">
                  {STATUS_ICON[status]}
                </div>

                {/* Title */}
                <div className="min-w-0">
                  {isEditing(row.rowIndex, "title") ? (
                    <input
                      autoFocus
                      value={row.title}
                      maxLength={80}
                      onChange={(e) =>
                        updateRow(row.rowIndex, { title: e.target.value })
                      }
                      onBlur={stopEdit}
                      onKeyDown={(e) => e.key === "Enter" && stopEdit()}
                      className="w-full bg-background border border-primary rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(row.rowIndex, "title")}
                      disabled={disabled}
                      className="w-full text-left truncate text-xs text-foreground hover:text-primary transition-colors disabled:cursor-default"
                    >
                      {row.title || (
                        <span className="text-muted-foreground italic">
                          Click to add title...
                        </span>
                      )}
                    </button>
                  )}
                  {/* Mobile: show key fields inline */}
                  <div className="sm:hidden flex gap-2 mt-1 text-xs text-muted-foreground">
                    <span>${row.price.toFixed(2)}</span>
                    <span>·</span>
                    <span>{row.categoryId || "no cat"}</span>
                  </div>
                </div>

                {/* Condition — hidden on mobile in row (shown in expanded) */}
                <div className="hidden sm:block">
                  <select
                    value={row.condition}
                    onChange={(e) =>
                      updateRow(row.rowIndex, { condition: e.target.value })
                    }
                    disabled={disabled}
                    className="w-full bg-transparent border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  >
                    {CONDITION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Price */}
                <div className="hidden sm:block">
                  {isEditing(row.rowIndex, "price") ? (
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.price || ""}
                      onChange={(e) =>
                        updateRow(row.rowIndex, {
                          price: parseFloat(e.target.value) || 0,
                        })
                      }
                      onBlur={stopEdit}
                      onKeyDown={(e) => e.key === "Enter" && stopEdit()}
                      className="w-full bg-background border border-primary rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(row.rowIndex, "price")}
                      disabled={disabled}
                      className="w-full text-left text-xs text-foreground hover:text-primary transition-colors disabled:cursor-default"
                    >
                      $
                      {row.price > 0 ? (
                        row.price.toFixed(2)
                      ) : (
                        <span className="text-muted-foreground">0.00</span>
                      )}
                    </button>
                  )}
                </div>

                {/* Category ID */}
                <div className="hidden sm:block">
                  {isEditing(row.rowIndex, "categoryId") ? (
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      value={row.categoryId}
                      onChange={(e) =>
                        updateRow(row.rowIndex, {
                          categoryId: e.target.value.replace(/\D/g, ""),
                        })
                      }
                      onBlur={stopEdit}
                      onKeyDown={(e) => e.key === "Enter" && stopEdit()}
                      className="w-full bg-background border border-primary rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(row.rowIndex, "categoryId")}
                      disabled={disabled}
                      className="w-full text-left text-xs text-foreground hover:text-primary transition-colors disabled:cursor-default"
                    >
                      {row.categoryId || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </button>
                  )}
                </div>

                {/* Quantity */}
                <div className="hidden sm:block">
                  {isEditing(row.rowIndex, "quantity") ? (
                    <input
                      autoFocus
                      type="number"
                      min="1"
                      value={row.quantity}
                      onChange={(e) =>
                        updateRow(row.rowIndex, {
                          quantity: parseInt(e.target.value) || 1,
                        })
                      }
                      onBlur={stopEdit}
                      onKeyDown={(e) => e.key === "Enter" && stopEdit()}
                      className="w-full bg-background border border-primary rounded px-2 py-1 text-xs text-foreground focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(row.rowIndex, "quantity")}
                      disabled={disabled}
                      className="w-full text-left text-xs text-foreground hover:text-primary transition-colors disabled:cursor-default"
                    >
                      {row.quantity}
                    </button>
                  )}
                </div>

                {/* Row actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleExpand(row.rowIndex)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                    title={isExpanded ? "Collapse" : "Expand details"}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => !disabled && duplicateRow(row.rowIndex)}
                    disabled={disabled}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title="Duplicate row"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => !disabled && deleteRow(row.rowIndex)}
                    disabled={disabled}
                    className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                    title="Delete row"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Description */}
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={row.description ?? ""}
                        onChange={(e) =>
                          updateRow(row.rowIndex, {
                            description: e.target.value,
                          })
                        }
                        disabled={disabled}
                        placeholder="Leave blank to generate with AI..."
                        className="w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-60"
                      />
                    </div>

                    {/* Condition (mobile) */}
                    <div className="sm:hidden space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Condition
                      </label>
                      <select
                        value={row.condition}
                        onChange={(e) =>
                          updateRow(row.rowIndex, { condition: e.target.value })
                        }
                        disabled={disabled}
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none"
                      >
                        {CONDITION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Price (mobile) */}
                    <div className="sm:hidden space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Price ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.price || ""}
                        onChange={(e) =>
                          updateRow(row.rowIndex, {
                            price: parseFloat(e.target.value) || 0,
                          })
                        }
                        disabled={disabled}
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>

                    {/* Category ID (mobile) */}
                    <div className="sm:hidden space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Category ID
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.categoryId}
                        onChange={(e) =>
                          updateRow(row.rowIndex, {
                            categoryId: e.target.value.replace(/\D/g, ""),
                          })
                        }
                        disabled={disabled}
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>

                    {/* Images */}
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Image URLs ({row.imageUrls.length}/8)
                      </label>
                      {(row.imageUrls.length > 0 ? row.imageUrls : [""]).map(
                        (url, imgIdx) => (
                          <div key={imgIdx} className="flex gap-1">
                            <input
                              type="url"
                              value={url}
                              placeholder={`Image URL ${imgIdx + 1}`}
                              onChange={(e) => {
                                const next = [...row.imageUrls];
                                next[imgIdx] = e.target.value;
                                updateRow(row.rowIndex, {
                                  imageUrls: next.filter(
                                    (u, i) => u || i < next.length - 1,
                                  ),
                                });
                              }}
                              disabled={disabled}
                              className="flex-1 bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            />
                          </div>
                        ),
                      )}
                      {row.imageUrls.length < 8 && (
                        <button
                          onClick={() =>
                            updateRow(row.rowIndex, {
                              imageUrls: [...row.imageUrls, ""],
                            })
                          }
                          disabled={disabled}
                          className="text-xs text-primary hover:underline disabled:opacity-50"
                        >
                          + Add image URL
                        </button>
                      )}
                    </div>

                    {/* COGS */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        COGS ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.cogs ?? ""}
                        placeholder="0.00"
                        onChange={(e) =>
                          updateRow(row.rowIndex, {
                            cogs: parseFloat(e.target.value) || undefined,
                          })
                        }
                        disabled={disabled}
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>

                    {/* Consignor */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase">
                        Consignor
                      </label>
                      <input
                        type="text"
                        value={row.consignor ?? ""}
                        placeholder="Optional"
                        onChange={(e) =>
                          updateRow(row.rowIndex, { consignor: e.target.value })
                        }
                        disabled={disabled}
                        className="w-full bg-card border border-border rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Validation issues */}
                  {state &&
                    (state.errors.length > 0 || state.warnings.length > 0) && (
                      <div className="space-y-1 pt-1 border-t border-border/50">
                        {state.errors.map((e, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
                          >
                            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              <strong>{e.field}:</strong> {e.message}
                            </span>
                          </div>
                        ))}
                        {state.warnings.map((w, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-yellow-600 dark:text-yellow-400"
                          >
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>
                              <strong>{w.field}:</strong> {w.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                  {/* Published link */}
                  {state?.status === "published" && state.ebayUrl && (
                    <a
                      href={state.ebayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View on eBay →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add row button */}
      {!disabled && (
        <button
          onClick={addRow}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add row
        </button>
      )}
    </div>
  );
}
