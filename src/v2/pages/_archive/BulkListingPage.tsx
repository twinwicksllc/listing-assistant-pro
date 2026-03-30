import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Layers, Sparkles, Send, Download,
  CheckCircle, AlertCircle, Crown, Loader2, RefreshCw, Info,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import BulkUploadZone from "@/components/BulkUploadZone";
import BulkTemplateCard from "@/components/BulkTemplateCard";
import BulkColumnMapper from "@/components/BulkColumnMapper";
import BulkDataTable from "@/components/BulkDataTable";
import BulkProgressBar from "@/components/BulkProgressBar";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import type { SelectedPolicies } from "@/types/ebay-policies";
import type { BulkRow, BulkRowState, BulkPublishResult, ColumnMapping } from "@/types/bulk-listing";
import type { ParsedFile } from "@/lib/bulkCsvParser";
import { autoDetectMappings, applyMappings } from "@/lib/bulkCsvParser";
import { BULK_TEMPLATES, downloadTemplateCsv } from "@/lib/bulkTemplates";
import { rawToBulkRow, validateAllRows, countValidRows, countErrorRows, getValidRows } from "@/lib/bulkValidation";
import type { BulkTemplate } from "@/types/bulk-listing";

// ─── Step labels ───────────────────────────────────────────────────────────────

const STEPS = ["Upload", "Map Columns", "Review & Generate", "Publish"] as const;
type Step = 0 | 1 | 2 | 3;

// ─── Main component ────────────────────────────────────────────────────────────

export default function BulkListingPage() {
  const navigate = useNavigate();
  const { user, isOwner, isLister, isPaid, currentPlan, isPro, isShop, isUnlimited } = useAuth();

  // Step state
  const [step, setStep] = useState<Step>(0);

  // Step 1 — Upload
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BulkTemplate | null>(null);

  // Step 2 — Column mapping
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  // Step 3 — Review
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [rowStates, setRowStates] = useState<BulkRowState[]>([]);
  const [generatingDescriptions, setGeneratingDescriptions] = useState(false);
  const [descGenProgress, setDescGenProgress] = useState({ done: 0, total: 0 });
  const [selectedPolicies, setSelectedPolicies] = useState<SelectedPolicies>({
    fulfillmentPolicyId: null,
    paymentPolicyId: null,
    returnPolicyId: null,
  });
  const [ebayToken, setEbayToken] = useState<string | null>(null);

  // Step 4 — Publish
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<BulkPublishResult[]>([]);
  const [publishSummary, setPublishSummary] = useState({ published: 0, failed: 0, total: 0 });
  const [publishDone, setPublishDone] = useState(false);

  // Plan gating
  const canBulkPublish = isPro || isShop || isUnlimited;
  const descGenLimit = isShop || isUnlimited ? 1000 : isPro ? 25 : 5;
  const publishLimit = isShop || isUnlimited ? 1000 : isPro ? 50 : 5;

  // Load eBay token on mount
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (data?.token) setEbayToken(data.token);
        else setEbayToken(localStorage.getItem("ebay-user-token"));
      } catch {
        setEbayToken(localStorage.getItem("ebay-user-token"));
      }
    })();
  }, [user?.id]);

  // ─── Step 1 handlers ──────────────────────────────────────────────────────

  const handleFileParsed = useCallback((result: ParsedFile) => {
    setParsedFile(result);
    setSelectedTemplate(null);
    const detected = autoDetectMappings(result.headers);
    setMappings(detected);
  }, []);

  const handleTemplateSelect = useCallback((template: BulkTemplate) => {
    setSelectedTemplate(template);
    setParsedFile(null);
    // Pre-populate with template sample rows
    const sampleRows: BulkRow[] = template.sampleRows.map((raw, idx) => ({
      rowIndex: idx,
      title: raw["title"] || raw["Title"] || "",
      description: raw["description"] || raw["Description"] || undefined,
      condition: raw["condition"] || raw["Condition"] || template.defaultCondition,
      price: parseFloat(raw["price"] || raw["Price"] || "0") || 0,
      quantity: parseInt(raw["quantity"] || raw["Quantity"] || "1") || 1,
      categoryId: raw["categoryId"] || raw["Category_ID"] || template.defaultCategoryId,
      format: "FIXED_PRICE",
      imageUrls: [raw["imageUrl1"] || raw["Image_URL_1"] || ""].filter(Boolean),
      itemSpecifics: Object.fromEntries(
        Object.entries(raw)
          .filter(([k]) => /^item[_\s-]?specific/i.test(k))
          .map(([k, v]) => [k.replace(/^item[_\s-]?specific[_\s-]?/i, ""), v as string])
      ),
    }));
    setRows(sampleRows);
    setRowStates(validateAllRows(sampleRows));
    setStep(2); // Skip column mapping for templates
  }, []);

  // ─── Step 2 → 3 ───────────────────────────────────────────────────────────

  const applyMappingsAndProceed = useCallback(() => {
    if (!parsedFile) return;
    const requiredMapped = ["title", "condition", "price", "categoryId"].every((f) =>
      mappings.some((m) => m.mappedTo === f)
    );
    if (!requiredMapped) {
      toast.error("Please map all required fields: Title, Condition, Price, Category ID");
      return;
    }
    const mapped = applyMappings(parsedFile.rows, mappings);
    const bulkRows = mapped.map((r, idx) => rawToBulkRow(r, idx));
    setRows(bulkRows);
    setRowStates(validateAllRows(bulkRows));
    setStep(2);
  }, [parsedFile, mappings]);

  // Re-validate whenever rows change
  const handleRowsChange = useCallback((newRows: BulkRow[]) => {
    setRows(newRows);
    setRowStates(validateAllRows(newRows));
  }, []);

  // ─── AI Description Generation ────────────────────────────────────────────

  const generateDescriptions = useCallback(async () => {
    if (generatingDescriptions) return;

    const rowsNeedingDesc = rows.filter((r) => !r.description);
    if (rowsNeedingDesc.length === 0) {
      toast.info("All rows already have descriptions");
      return;
    }

    if (rowsNeedingDesc.length > descGenLimit) {
      toast.error(
        `Your plan allows AI descriptions for up to ${descGenLimit} rows. ${rowsNeedingDesc.length} rows need descriptions.${!isPro ? " Upgrade to Pro for more." : ""}`
      );
      return;
    }

    setGeneratingDescriptions(true);
    setDescGenProgress({ done: 0, total: rowsNeedingDesc.length });

    // Mark rows as "generating"
    setRowStates((prev) =>
      prev.map((s) =>
        rowsNeedingDesc.some((r) => r.rowIndex === s.rowIndex)
          ? { ...s, status: "generating" }
          : s
      )
    );

    try {
      const descRows = rowsNeedingDesc.map((r) => ({
        rowIndex: r.rowIndex,
        title: r.title,
        condition: r.condition,
        categoryId: r.categoryId,
        itemSpecifics: r.itemSpecifics,
        imageUrl: r.imageUrls[0],
      }));

      const { data, error } = await supabase.functions.invoke(
        "bulk-generate-descriptions",
        { body: { rows: descRows } }
      );

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const results = data?.results ?? [];
      const updated = rows.map((r) => {
        const result = results.find((res: any) => res.rowIndex === r.rowIndex);
        if (result && result.description && !result.error) {
          return { ...r, description: result.description };
        }
        return r;
      });

      setRows(updated);
      setRowStates(
        validateAllRows(updated).map((s) => ({
          ...s,
          status: updated.find((r) => r.rowIndex === s.rowIndex)?.description
            ? "ready"
            : s.status,
        }))
      );

      const successCount = results.filter((r: any) => r.description && !r.error).length;
      const failCount = results.filter((r: any) => r.error).length;

      if (failCount > 0) {
        toast.warning(`Generated ${successCount} descriptions · ${failCount} failed`);
      } else {
        toast.success(`Generated ${successCount} AI descriptions! ✨`);
      }
    } catch (err: unknown) {
      toast.error(err.message || "Failed to generate descriptions");
      // Reset generating status
      setRowStates((prev) =>
        prev.map((s) => (s.status === "generating" ? { ...s, status: "valid" } : s))
      );
    } finally {
      setGeneratingDescriptions(false);
      setDescGenProgress({ done: 0, total: 0 });
    }
  }, [rows, generatingDescriptions, descGenLimit, isPro]);

  // ─── Publish ──────────────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!ebayToken) {
      toast.error("No eBay account connected. Go to Settings to connect.");
      navigate("/settings");
      return;
    }

    const validRows = getValidRows(rows, rowStates);
    if (validRows.length === 0) {
      toast.error("No valid rows to publish. Fix errors first.");
      return;
    }

    if (validRows.length > publishLimit) {
      toast.error(`Your plan allows publishing up to ${publishLimit} listings at once.`);
      return;
    }

    // Apply selected policies to all rows (if not already set per-row)
    const rowsWithPolicies = validRows.map((r) => ({
      ...r,
      fulfillmentPolicyId: r.fulfillmentPolicyId || selectedPolicies.fulfillmentPolicyId || undefined,
      paymentPolicyId: r.paymentPolicyId || selectedPolicies.paymentPolicyId || undefined,
      returnPolicyId: r.returnPolicyId || selectedPolicies.returnPolicyId || undefined,
    }));

    setPublishing(true);
    setPublishResults([]);
    setPublishSummary({ published: 0, failed: 0, total: validRows.length });
    setStep(3);

    // Mark all rows as publishing
    setRowStates((prev) =>
      prev.map((s) =>
        validRows.some((r) => r.rowIndex === s.rowIndex)
          ? { ...s, status: "publishing" }
          : s
      )
    );

    try {
      const { data, error } = await supabase.functions.invoke("bulk-publish", {
        body: { userToken: ebayToken, rows: rowsWithPolicies },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      const results: BulkPublishResult[] = data?.results ?? [];
      setPublishResults(results);
      setPublishSummary({
        published: data.published ?? 0,
        failed: data.failed ?? 0,
        total: data.total ?? validRows.length,
      });

      // Update row states based on results
      setRowStates((prev) =>
        prev.map((s) => {
          const result = results.find((r) => r.rowIndex === s.rowIndex);
          if (!result) return s;
          return {
            ...s,
            status: result.success ? "published" : "error",
            listingId: result.listingId,
            offerId: result.offerId,
            ebayUrl: result.listingId
              ? `https://www.ebay.com/itm/${result.listingId}`
              : undefined,
            errorMessage: result.error,
          };
        })
      );

      if (data.failed === 0) {
        toast.success(`All ${data.published} listings published! 🎉`);
      } else {
        toast.warning(`${data.published} published · ${data.failed} failed`);
      }
    } catch (err: unknown) {
      toast.error(err.message || "Bulk publish failed");
      setRowStates((prev) =>
        prev.map((s) =>
          s.status === "publishing" ? { ...s, status: "error", errorMessage: err.message } : s
        )
      );
    } finally {
      setPublishing(false);
      setPublishDone(true);
    }
  }, [rows, rowStates, ebayToken, selectedPolicies, publishLimit, navigate]);

  // ─── Error report download ────────────────────────────────────────────────

  const downloadErrorReport = useCallback(() => {
    const failed = publishResults.filter((r) => !r.success);
    if (failed.length === 0) return;

    const failedRows = rows.filter((r) => failed.some((f) => f.rowIndex === r.rowIndex));
    const lines = [
      '"Row","Title","Price","Category ID","Error"',
      ...failedRows.map((r) => {
        const result = failed.find((f) => f.rowIndex === r.rowIndex);
        return `"${r.rowIndex + 1}","${r.title}","${r.price}","${r.categoryId}","${result?.error ?? "Unknown"}"`;
      }),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_publish_errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [publishResults, rows]);

  // ─── Step nav helpers ──────────────────────────────────────────────────────

  const canGoToStep2 = parsedFile !== null || selectedTemplate !== null;
  const validCount = countValidRows(rowStates);
  const errorCount = countErrorRows(rowStates);
  const readyCount = rowStates.filter((s) => s.status === "ready").length;
  const publishableCount = rowStates.filter(
    (s) => s.status === "valid" || s.status === "ready"
  ).length;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/home")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-foreground">Bulk Listing Generator</h1>
        </div>
        {rows.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{rows.length} rows</span>
        )}
      </header>

      {/* Step indicator */}
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <div className="flex items-center gap-1 mb-6">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-colors ${
                i < step
                  ? "bg-green-500 text-white"
                  : i === step
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}>
                {i < step ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium hidden sm:block ${i === step ? "text-foreground" : "text-muted-foreground"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${i < step ? "bg-green-500" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Upload ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Upload your listing file</h2>
              <p className="text-xs text-muted-foreground">
                Upload a CSV or Excel file, or start from one of our templates.
              </p>
            </div>

            {/* Plan info banner */}
            {!canBulkPublish && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl">
                <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">Free tier: up to {publishLimit} listings</p>
                  <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                    Upgrade to Pro for 50 listings or Shop for unlimited bulk publishing.{" "}
                    <button onClick={() => navigate("/billing")} className="underline font-medium">Upgrade →</button>
                  </p>
                </div>
              </div>
            )}

            {/* Upload zone */}
            <BulkUploadZone onFileParsed={handleFileParsed} />

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or start from a template</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Template cards */}
            <div className="grid grid-cols-2 gap-2">
              {Object.values(BULK_TEMPLATES).map((template) => (
                <BulkTemplateCard
                  key={template.id}
                  template={template}
                  onSelect={handleTemplateSelect}
                />
              ))}
            </div>

            {/* Next button (only if CSV uploaded) */}
            {parsedFile && (
              <button
                onClick={() => setStep(1)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Map Columns
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* ── STEP 1: Column Mapping ─────────────────────────────────────── */}
        {step === 1 && parsedFile && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Map your columns</h2>
              <p className="text-xs text-muted-foreground">
                Tell us which CSV column maps to each listing field.
                <span className="text-primary font-medium"> Bold</span> = required.
              </p>
            </div>

            <BulkColumnMapper
              headers={parsedFile.headers}
              previewRows={parsedFile.rows.slice(0, 3)}
              mappings={mappings}
              onMappingsChange={setMappings}
            />

            <div className="flex gap-2">
              <button
                onClick={() => setStep(0)}
                className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors"
              >
                Back
              </button>
              <button
                onClick={applyMappingsAndProceed}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all"
              >
                Review Rows
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Review & Generate ──────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Review & generate descriptions</h2>
              <div className="flex gap-3 text-xs">
                <span className="text-green-600 dark:text-green-400 font-medium">{validCount} ready</span>
                {errorCount > 0 && (
                  <span className="text-destructive font-medium">{errorCount} errors</span>
                )}
                {readyCount > 0 && (
                  <span className="text-primary font-medium">{readyCount} with AI descriptions</span>
                )}
              </div>
            </div>

            {/* AI Generate button */}
            {rows.some((r) => !r.description) && (
              <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <Sparkles className="w-5 h-5 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    {rows.filter((r) => !r.description).length} rows need descriptions
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    AI will write compelling eBay descriptions for each item
                  </p>
                </div>
                <button
                  onClick={generateDescriptions}
                  disabled={generatingDescriptions}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60"
                >
                  {generatingDescriptions ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {descGenProgress.total > 0
                        ? `${descGenProgress.done}/${descGenProgress.total}`
                        : "Generating..."}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate AI
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Policies section */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  eBay Business Policies (applied to all rows)
                </p>
              </div>
              <EbayPolicySelector
                userToken={ebayToken}
                onPoliciesSelected={setSelectedPolicies}
                disabled={generatingDescriptions}
              />
            </div>

            {/* Data table */}
            <BulkDataTable
              rows={rows}
              rowStates={rowStates}
              onRowsChange={handleRowsChange}
              disabled={generatingDescriptions}
            />

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep(selectedTemplate ? 0 : 1)}
                className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={publishableCount === 0 || generatingDescriptions}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all disabled:opacity-50"
              >
                Publish {publishableCount > 0 ? `(${publishableCount})` : ""}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Publish ────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">Publish to eBay</h2>
              <p className="text-xs text-muted-foreground">
                {publishDone
                  ? "Publishing complete. Review results below."
                  : publishing
                  ? "Publishing your listings to eBay..."
                  : `${publishableCount} listings ready to publish.`}
              </p>
            </div>

            {/* Pre-publish summary */}
            {!publishing && !publishDone && (
              <div className="space-y-3">
                {/* Summary card */}
                <div className="p-4 bg-card border border-border rounded-xl space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="text-center p-2 bg-green-50 dark:bg-green-950 rounded-lg">
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">{publishableCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Ready to publish</p>
                    </div>
                    <div className="text-center p-2 bg-red-50 dark:bg-red-950 rounded-lg">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{errorCount}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Have errors</p>
                    </div>
                  </div>

                  {errorCount > 0 && (
                    <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {errorCount} rows have validation errors and will be skipped.{" "}
                        <button onClick={() => setStep(2)} className="underline font-medium">
                          Go back to fix them
                        </button>
                      </p>
                    </div>
                  )}

                  {publishableCount > publishLimit && (
                    <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950 rounded-lg">
                      <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Your plan allows {publishLimit} at once. Only the first {publishLimit} will be published.{" "}
                        <button onClick={() => navigate("/billing")} className="underline font-medium">Upgrade →</button>
                      </p>
                    </div>
                  )}

                  {!ebayToken && (
                    <div className="flex items-start gap-2 p-2.5 bg-red-50 dark:bg-red-950 rounded-lg">
                      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-700 dark:text-red-300">
                        No eBay account connected.{" "}
                        <button onClick={() => navigate("/settings")} className="underline font-medium">Connect eBay →</button>
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishableCount === 0 || !ebayToken}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    Publish {Math.min(publishableCount, publishLimit)} Listings
                  </button>
                </div>
              </div>
            )}

            {/* Progress tracker */}
            {(publishing || publishDone) && (
              <BulkProgressBar
                total={publishSummary.total}
                published={publishSummary.published}
                failed={publishSummary.failed}
                inProgress={publishing}
                results={publishResults}
                onDownloadErrors={publishSummary.failed > 0 ? downloadErrorReport : undefined}
              />
            )}

            {/* Post-publish actions */}
            {publishDone && (
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => navigate("/dashboard")}
                  className="flex-1 py-3 rounded-xl bg-secondary text-foreground font-semibold text-sm hover:bg-secondary/80 transition-colors"
                >
                  View Dashboard
                </button>
                <button
                  onClick={() => {
                    setStep(0);
                    setRows([]);
                    setRowStates([]);
                    setPublishResults([]);
                    setPublishDone(false);
                    setParsedFile(null);
                    setSelectedTemplate(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  New Bulk Upload
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}