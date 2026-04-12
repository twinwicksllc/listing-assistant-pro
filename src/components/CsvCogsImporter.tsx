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

  // Convert scientific notation (e.g. "1.37161E+11") to full integer string.
  // Excel silently converts long eBay listing IDs to sci notation when saving CSV.
  function normalizeSciNotation(val: string): string {
    if (!val) return val;
    if (/^-?\d+\.?\d*[eE][+\-]?\d+$/.test(val.trim())) {
      try {
        return BigInt(Math.round(parseFloat(val))).toString();
      } catch {
        return val;
      }
    }
    return val;
  }

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

      // Auto-detect common column names.
      // Use exact matches first, then fallbacks — to avoid mapping "price" to cogsCol
      // when the CSV also has a separate "cogs" column (as our own export does).
      const autoMapping: ColumnMapping = {};
      // Pass 1: exact matches (case-insensitive)
      parsedHeaders.forEach((h) => {
        const lower = h.toLowerCase().trim();
        if (lower === "sku")                                                               autoMapping.skuCol      = h;
        if (lower === "ebay_listing_id" || lower === "listing_id" || lower === "item_id") autoMapping.listingIdCol = h;
        if (lower === "cogs" || lower === "cost" || lower === "item_cost")                autoMapping.cogsCol     = h;
      });
      // Pass 2: partial matches only for fields not yet mapped
      parsedHeaders.forEach((h) => {
        const lower = h.toLowerCase().trim();
        if (!autoMapping.skuCol      && lower.includes("sku"))                                       autoMapping.skuCol      = h;
        if (!autoMapping.listingIdCol && (lower.includes("listing") || lower.includes("item_id")))   autoMapping.listingIdCol = h;
        // Only fall back to partial match for cogs — never map "price" to cogs
        if (!autoMapping.cogsCol     && (lower.includes("cogs") || lower.includes("cost")))          autoMapping.cogsCol     = h;
      });
      setMapping(autoMapping);

      // Show preview (first 5 rows only for display)
      const preview = rows.slice(0, 5).map((row) => ({
        sku: autoMapping.skuCol ? row[autoMapping.skuCol] : undefined,
        listingId: autoMapping.listingIdCol ? normalizeSciNotation(row[autoMapping.listingIdCol]) : undefined,
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
    console.log("========== CSV IMPORT STARTED ==========");
    console.log("Mapping:", mapping);
    console.log("CSV text length:", csvText.length);

    if (!mapping.cogsCol && !mapping.skuCol && !mapping.listingIdCol) {
      toast.error("Please map at least one column");
      return;
    }

    setImporting(true);
    try {
      const { headers: _h, rows } = parseCSV(csvText);
      const now = new Date().toISOString();
      console.log("========== AFTER PARSE ==========");
      console.log("Parsed rows count:", rows.length);
      console.log("Headers:", _h);
      console.log("Sample raw rows (first 3):", rows.slice(0, 3));

      // Build the list of valid rows from CSV
      interface CsvRow {
        user_id: string;
        ebay_sku: string | null;
        ebay_listing_id: string | null;
        cogs: number;
        cogs_source: string;
        acquired_at: string;
      }
      const csvRows: CsvRow[] = [];

      for (const row of rows) {
        const sku = mapping.skuCol ? row[mapping.skuCol]?.trim() : "";
        const listingId = mapping.listingIdCol ? normalizeSciNotation(row[mapping.listingIdCol]?.trim()) : "";
        const cogsStr = mapping.cogsCol ? row[mapping.cogsCol]?.trim() : "";

        if (!cogsStr) continue;
        const cogs = parseFloat(cogsStr);
        if (isNaN(cogs) || cogs < 0) continue;
        if (!sku && !listingId) continue;

        csvRows.push({
          user_id: userId,
          ebay_sku: sku || null,
          ebay_listing_id: listingId || null,
          cogs,
          cogs_source: "csv_import",
          acquired_at: now,
        });
      }

      if (csvRows.length === 0) {
        toast.error("No valid rows to import");
        setImporting(false);
        return;
      }

      // === DEBUG LOGGING ===
      console.log("=== CSV IMPORT DEBUG ===");
      console.log("Total CSV rows parsed:", csvRows.length);
      console.log("Sample CSV rows (first 3):", csvRows.slice(0, 3));
      // === END DEBUG ===

      // Step 1: Fetch ALL existing listing_cogs rows for this user in one query.
      // Build lookup maps by listing_id and by sku so we can match in memory
      // without N+1 queries. This also avoids any duplicate-key conflicts since
      // we always UPDATE existing rows and only INSERT truly new ones.
      const { data: existingRows, error: fetchError } = await supabase
        .from("listing_cogs")
        .select("id, ebay_listing_id, ebay_sku")
        .eq("user_id", userId);
      if (fetchError) throw fetchError;

      const byListingId = new Map<string, string>(); // listing_id -> row id
      const bySku = new Map<string, string>();        // sku -> row id
      for (const r of existingRows ?? []) {
        if (r.ebay_listing_id) byListingId.set(r.ebay_listing_id, r.id);
        if (r.ebay_sku) bySku.set(r.ebay_sku, r.id);
      }
      console.log("Existing DB rows:", existingRows?.length);
      console.log("byListingId map size:", byListingId.size);
      console.log("bySku map size:", bySku.size);
      console.log("Sample byListingId keys (first 5):", Array.from(byListingId.keys()).slice(0, 5));
      console.log("Sample bySku keys (first 5):", Array.from(bySku.keys()).slice(0, 5));

      // Step 2: Deduplicate CSV rows themselves before categorizing.
      // The CSV may contain the same listing multiple times (e.g. active + sold).
      // Keep the last occurrence of each listing_id / sku (last row wins).
      const deduped = new Map<string, CsvRow>();
      for (const row of csvRows) {
        // Use listing_id as primary key, sku as fallback key for dedup
        const key = row.ebay_listing_id
          ? `lid:${row.ebay_listing_id}`
          : `sku:${row.ebay_sku}`;
        deduped.set(key, row); // last row with this key wins
      }
      const dedupedRows = Array.from(deduped.values());

      // Step 3: Categorize each CSV row as update or insert.
      // Priority: listing_id match > sku match > new insert.
      // Also track listing_ids and skus already scheduled for insert to prevent
      // duplicate inserts within the same batch.
      const updates: Array<{ id: string; cogs: number; cogs_source: string; acquired_at: string }> = [];
      const inserts: CsvRow[] = [];
      const updatedIds = new Set<string>();         // prevent double-updating same DB row
      const insertedListingIds = new Set<string>(); // prevent duplicate inserts by listing_id
      const insertedSkus = new Set<string>();       // prevent duplicate inserts by sku

      for (const row of dedupedRows) {
        const updatePayload = { cogs: row.cogs, cogs_source: row.cogs_source, acquired_at: row.acquired_at };

        // 1. Match by listing ID (most reliable)
        if (row.ebay_listing_id && byListingId.has(row.ebay_listing_id)) {
          const id = byListingId.get(row.ebay_listing_id)!;
          if (!updatedIds.has(id)) {
            updates.push({ id, ...updatePayload });
            updatedIds.add(id);
          }
          continue;
        }

        // 2. Match by SKU
        if (row.ebay_sku && bySku.has(row.ebay_sku)) {
          const id = bySku.get(row.ebay_sku)!;
          if (!updatedIds.has(id)) {
            updates.push({ id, ...updatePayload });
            updatedIds.add(id);
          }
          continue;
        }

        // 3. Truly new row — check we haven't already queued an insert for
        //    this listing_id or sku (handles duplicates across dedup keys)
        if (row.ebay_listing_id && insertedListingIds.has(row.ebay_listing_id)) continue;
        if (row.ebay_sku && insertedSkus.has(row.ebay_sku)) continue;

        inserts.push(row);
        if (row.ebay_listing_id) insertedListingIds.add(row.ebay_listing_id);
        if (row.ebay_sku) insertedSkus.add(row.ebay_sku);
      }

      console.log("=== CATEGORIZATION RESULTS ===");
      console.log("Deduped CSV rows:", dedupedRows.length);
      console.log("Updates queued:", updates.length);
      console.log("Inserts queued:", inserts.length);
      console.log("Sample updates (first 3):", updates.slice(0, 3));
      console.log("Sample inserts (first 3):", inserts.slice(0, 3));

      // Step 3: Execute updates in chunks of 50
      const CHUNK = 50;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        for (const u of chunk) {
          const { error } = await supabase
            .from("listing_cogs")
            .update({ cogs: u.cogs, cogs_source: u.cogs_source, acquired_at: u.acquired_at })
            .eq("id", u.id);
          if (error) throw error;
        }
      }

      // Step 4: Execute inserts in chunks of 50
      for (let i = 0; i < inserts.length; i += CHUNK) {
        const chunk = inserts.slice(i, i + CHUNK);
        const { error } = await supabase.from("listing_cogs").insert(chunk);
        if (error) throw error;
      }

      toast.success(`Imported COGS for ${dedupedRows.length} items (${updates.length} updated, ${inserts.length} new)`);
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
