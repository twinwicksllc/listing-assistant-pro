import { useState, useRef } from "react";
import { Upload, X, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface CsvCogsImporterProps {
  userId: string;
  onSuccess?: () => void;
}

interface ColumnMapping {
  skuCol?: string;
  listingIdCol?: string;
  cogsCol?: string;
}

interface PendingRow {
  sku?: string;
  listingId?: string;
  cogs?: number;
  source: string;
}

export function CsvCogsImporter({ userId, onSuccess }: CsvCogsImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [previewRows, setPreviewRows] = useState<PendingRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [importing, setImporting] = useState(false);
  const [showMapping, setShowMapping] = useState(false);

  // Parse CSV text into headers + rows
  function parseCSV(text: string) {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const headerLine = lines[0];
    const cols = headerLine.split(",").map((h) => h.trim().replace(/['"]/g, ""));

    const rows = lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/['"]/g, ""));
      const row: Record<string, string> = {};
      cols.forEach((col, i) => {
        row[col] = values[i] || "";
      });
      return row;
    });

    return { headers: cols, rows };
  }

  // Handle file selection
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setCsvText(text);
      const { headers: parsedHeaders, rows } = parseCSV(text);
      setHeaders(parsedHeaders);

      // Auto-detect common column names
      const autoMapping: ColumnMapping = {};
      parsedHeaders.forEach((h) => {
        const lower = h.toLowerCase();
        if (lower.includes("sku")) autoMapping.skuCol = h;
        if (lower.includes("listing") || lower.includes("item")) autoMapping.listingIdCol = h;
        if (lower.includes("cost") || lower.includes("cogs") || lower.includes("price")) autoMapping.cogsCol = h;
      });
      setMapping(autoMapping);

      // Show preview (first 5 rows only for display)
      const preview = rows.slice(0, 5).map((row) => ({
        sku: autoMapping.skuCol ? row[autoMapping.skuCol] : undefined,
        listingId: autoMapping.listingIdCol ? row[autoMapping.listingIdCol] : undefined,
        cogs: autoMapping.cogsCol ? parseFloat(row[autoMapping.cogsCol]) : undefined,
        source: file.name,
      }));
      setPreviewRows(preview);
      setTotalRows(rows.length);
      setShowMapping(true);
    } catch (e) {
      toast.error(`Failed to read file: ${e.message}`);
    }
  }

  // Import all rows
  async function handleImport() {
    if (!mapping.cogsCol && !mapping.skuCol && !mapping.listingIdCol) {
      toast.error("Please map at least one column");
      return;
    }

    setImporting(true);
    try {
      const { headers: _h, rows } = parseCSV(csvText);
      const toInsert: Array<{
        user_id: string;
        ebay_sku?: string | null;
        ebay_listing_id?: string | null;
        cogs: number;
        cogs_source: string;
        acquired_at: string;
      }> = [];

      for (const row of rows) {
        const sku = mapping.skuCol ? row[mapping.skuCol]?.trim() : "";
        const listingId = mapping.listingIdCol ? row[mapping.listingIdCol]?.trim() : "";
        const cogsStr = mapping.cogsCol ? row[mapping.cogsCol]?.trim() : "";

        // Skip rows without COGS
        if (!cogsStr) continue;

        const cogs = parseFloat(cogsStr);
        if (isNaN(cogs) || cogs < 0) {
          console.warn(`Invalid COGS value in row: ${cogsStr}`);
          continue;
        }

        // Need at least SKU or ListingID
        if (!sku && !listingId) continue;

        toInsert.push({
          user_id: userId,
          ebay_sku: sku || null,
          ebay_listing_id: listingId || null,
          cogs,
          cogs_source: "csv_import",
          acquired_at: new Date().toISOString(),
        });
      }

      if (toInsert.length === 0) {
        toast.error("No valid rows to import");
        setImporting(false);
        return;
      }

      // Process in chunks of 50 to avoid request size limits
      const CHUNK_SIZE = 50;
      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + CHUNK_SIZE);

        for (const row of chunk) {
          if (row.ebay_listing_id) {
            // Try to update existing row by listing ID first
            const { data: existing } = await supabase
              .from("listing_cogs")
              .select("id")
              .eq("user_id", userId)
              .eq("ebay_listing_id", row.ebay_listing_id)
              .maybeSingle();

            if (existing) {
              const { error } = await supabase
                .from("listing_cogs")
                .update({ cogs: row.cogs, cogs_source: row.cogs_source, acquired_at: row.acquired_at })
                .eq("id", existing.id);
              if (error) throw error;
            } else {
              const { error } = await supabase.from("listing_cogs").insert(row);
              if (error) throw error;
            }
          } else if (row.ebay_sku) {
            // Fall back to SKU matching
            const { data: existing } = await supabase
              .from("listing_cogs")
              .select("id")
              .eq("user_id", userId)
              .eq("ebay_sku", row.ebay_sku)
              .maybeSingle();

            if (existing) {
              const { error } = await supabase
                .from("listing_cogs")
                .update({ cogs: row.cogs, cogs_source: row.cogs_source, acquired_at: row.acquired_at })
                .eq("id", existing.id);
              if (error) throw error;
            } else {
              const { error } = await supabase.from("listing_cogs").insert(row);
              if (error) throw error;
            }
          } else {
            // No identifier — skip
            console.warn("Skipping row with no SKU or listing ID");
          }
        }
      }

      toast.success(`Imported COGS for ${toInsert.length} items`);
      setCsvText("");
      setHeaders([]);
      setMapping({});
      setPreviewRows([]);
      setShowMapping(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess?.();
    } catch (e) {
      toast.error(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      {!showMapping && (
        <div className="border-2 border-dashed border-border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex flex-col items-center gap-2 text-center"
          >
            <Upload className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">Drop CSV file here or click to upload</p>
              <p className="text-xs text-muted-foreground">Excel files: Save as CSV format first</p>
            </div>
          </button>
        </div>
      )}

      {/* Column Mapping */}
      {showMapping && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Map CSV Columns</h3>
            <button
              onClick={() => {
                setShowMapping(false);
                setCsvText("");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Column Selection */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">SKU Column</label>
              <select
                value={mapping.skuCol || ""}
                onChange={(e) => setMapping({ ...mapping, skuCol: e.target.value || undefined })}
                className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Skip —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Listing ID Column</label>
              <select
                value={mapping.listingIdCol || ""}
                onChange={(e) => setMapping({ ...mapping, listingIdCol: e.target.value || undefined })}
                className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Skip —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">COGS Column *</label>
              <select
                value={mapping.cogsCol || ""}
                onChange={(e) => setMapping({ ...mapping, cogsCol: e.target.value || undefined })}
                className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Required —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview */}
          {previewRows.length > 0 && (
            <div className="border border-border rounded-lg p-3 bg-secondary/30">
              <h4 className="text-xs font-semibold text-foreground mb-2">Preview (first 5 of {totalRows.toLocaleString()} rows)</h4>
              <div className="space-y-1 text-xs">
                {previewRows.map((row, i) => (
                  <div key={i} className="flex gap-2 p-1.5 bg-card rounded border border-border/50">
                    {row.sku && <span className="flex-1 font-mono text-muted-foreground">SKU: {row.sku}</span>}
                    {row.listingId && <span className="flex-1 font-mono text-muted-foreground">ID: {row.listingId}</span>}
                    {row.cogs != null && (
                      <span className="flex-1 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        ${row.cogs.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Box */}
          <div className="flex gap-2 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200/50 dark:border-blue-800/50 text-xs text-blue-900 dark:text-blue-400">
            <Clock className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              All {totalRows.toLocaleString()} rows will be imported. Matches by Listing ID first, then SKU. Existing COGS values <strong>will be overwritten</strong> with the values from your CSV.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowMapping(false)}
              disabled={importing}
              className="px-4 py-2 text-sm font-medium text-muted-foreground border border-border rounded-lg hover:bg-secondary disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !mapping.cogsCol}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Import {totalRows.toLocaleString()} Rows
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
