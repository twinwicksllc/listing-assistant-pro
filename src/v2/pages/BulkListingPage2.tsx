import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Layers,
  Sparkles,
  Send,
  Download,
  CheckCircle,
  AlertCircle,
  Crown,
  Loader2,
  RefreshCw,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BulkUploadZone from "@/components/BulkUploadZone";
import BulkTemplateCard from "@/components/BulkTemplateCard";
import BulkColumnMapper from "@/components/BulkColumnMapper";
import BulkDataTable from "@/components/BulkDataTable";
import BulkProgressBar from "@/components/BulkProgressBar";
import { EbayPolicySelector } from "@/components/EbayPolicySelector";
import type { SelectedPolicies } from "@/types/ebay-policies";
import type {
  BulkRow,
  BulkRowState,
  BulkPublishResult,
  ColumnMapping,
} from "@/types/bulk-listing";
import type { ParsedFile } from "@/lib/bulkCsvParser";
import { autoDetectMappings, applyMappings } from "@/lib/bulkCsvParser";
import { BULK_TEMPLATES, downloadTemplateCsv } from "@/lib/bulkTemplates";
import {
  rawToBulkRow,
  validateAllRows,
  countValidRows,
  countErrorRows,
  getValidRows,
} from "@/lib/bulkValidation";
import type { BulkTemplate } from "@/types/bulk-listing";
import AppShell from "@/v2/components/AppShell";
import {
  COLORS,
  SHADOWS,
  FONT,
  cardStyle,
  cardHeaderStyle,
  cardTitleStyle,
  cardInnerStyle,
  btnPrimaryStyle,
  btnOutlineStyle,
} from "@/v2/theme";

const STEPS = [
  "Upload",
  "Map Columns",
  "Review & Generate",
  "Publish",
] as const;
type Step = 0 | 1 | 2 | 3;

const S = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(145deg, #e8f4fb 0%, #f0f6ff 40%, #eaf1f8 100%)",
    backgroundAttachment: "fixed" as const,
    fontFamily: FONT,
    paddingBottom: "2rem",
  } as React.CSSProperties,

  stickyHeader: {
    position: "sticky" as const,
    top: 0,
    zIndex: 40,
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottom: `1px solid ${COLORS.border}`,
    padding: "0.875rem 1rem",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  } as React.CSSProperties,

  inner: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "1.5rem 1rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1.25rem",
  } as React.CSSProperties,

  // Step indicator
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: "0.5rem",
  } as React.CSSProperties,

  stepDot: (state: "done" | "active" | "pending"): React.CSSProperties => ({
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6875rem",
    fontWeight: 700,
    flexShrink: 0,
    background:
      state === "done"
        ? "#16a34a"
        : state === "active"
          ? COLORS.brand
          : "#e8eef5",
    color: state === "pending" ? COLORS.textMuted : "#fff",
    transition: "background 0.2s",
  }),

  stepLine: (done: boolean): React.CSSProperties => ({
    flex: 1,
    height: 2,
    background: done ? "#16a34a" : COLORS.border,
    transition: "background 0.2s",
  }),

  // Section card
  section: { ...cardStyle } as React.CSSProperties,
  sectionHeader: {
    ...cardHeaderStyle,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,
  sectionBody: {
    padding: "1.25rem 1.5rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  } as React.CSSProperties,

  // Stat box
  statBox: (color: "green" | "red" | "blue"): React.CSSProperties => ({
    textAlign: "center",
    padding: "0.875rem",
    borderRadius: 10,
    background:
      color === "green"
        ? "#f0fdf4"
        : color === "red"
          ? "#fff5f5"
          : "rgba(0,118,182,0.06)",
    border: `1px solid ${color === "green" ? "#bbf7d0" : color === "red" ? "#fca5a5" : "rgba(0,118,182,0.18)"}`,
  }),

  statNum: (color: "green" | "red" | "blue"): React.CSSProperties => ({
    fontSize: "1.75rem",
    fontWeight: 800,
    color:
      color === "green"
        ? "#16a34a"
        : color === "red"
          ? "#dc2626"
          : COLORS.brand,
    lineHeight: 1,
    margin: "0 0 4px",
  }),

  // Warning info box
  warningBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "0.75rem 0.875rem",
    background: "rgba(245,158,11,0.06)",
    border: "1px solid rgba(245,158,11,0.25)",
    borderLeft: "3px solid #d97706",
    borderRadius: 8,
    fontSize: "0.8125rem",
    color: "#92400e",
  } as React.CSSProperties,

  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "0.75rem 0.875rem",
    background: "#fff5f5",
    border: "1px solid #fca5a5",
    borderLeft: "3px solid #dc2626",
    borderRadius: 8,
    fontSize: "0.8125rem",
    color: "#991b1b",
  } as React.CSSProperties,

  infoBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "0.75rem 0.875rem",
    background: "rgba(0,118,182,0.06)",
    border: "1px solid rgba(0,118,182,0.18)",
    borderLeft: `3px solid ${COLORS.brand}`,
    borderRadius: 8,
    fontSize: "0.8125rem",
    color: "#0c4a6e",
  } as React.CSSProperties,

  // Buttons
  btnPrimary: {
    ...btnPrimaryStyle,
    width: "100%",
    padding: "0.875rem",
    fontSize: "0.9375rem",
  } as React.CSSProperties,
  btnOutline: {
    ...btnOutlineStyle,
    width: "100%",
    padding: "0.75rem",
  } as React.CSSProperties,

  btnRow: { display: "flex", gap: 8 } as React.CSSProperties,
  btnFlex: (primary: boolean): React.CSSProperties => ({
    ...(primary ? btnPrimaryStyle : btnOutlineStyle),
    flex: 1,
    justifyContent: "center",
    padding: "0.75rem",
    fontSize: "0.875rem",
  }),

  // AI generate strip
  aiStrip: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.875rem 1rem",
    background: "rgba(0,118,182,0.05)",
    border: "1px solid rgba(0,118,182,0.18)",
    borderLeft: `3px solid ${COLORS.brand}`,
    borderRadius: 10,
  } as React.CSSProperties,
};

export default function BulkListingPage2() {
  const navigate = useNavigate();
  const {
    user,
    isOwner,
    isLister,
    isPaid,
    currentPlan,
    isPro,
    isShop,
    isUnlimited,
  } = useAuth();

  const [step, setStep] = useState<Step>(0);
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BulkTemplate | null>(
    null,
  );
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
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
  const [publishing, setPublishing] = useState(false);
  const [publishResults, setPublishResults] = useState<BulkPublishResult[]>([]);
  const [publishSummary, setPublishSummary] = useState({
    published: 0,
    failed: 0,
    total: 0,
  });
  const [publishDone, setPublishDone] = useState(false);

  const canBulkPublish = isPro || isShop || isUnlimited;
  const descGenLimit = isShop || isUnlimited ? 1000 : isPro ? 25 : 5;
  const publishLimit = isShop || isUnlimited ? 1000 : isPro ? 50 : 5;

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        setEbayToken(data?.token ?? localStorage.getItem("ebay-user-token"));
      } catch {
        setEbayToken(localStorage.getItem("ebay-user-token"));
      }
    })();
  }, [user?.id]);

  const handleFileParsed = useCallback((result: ParsedFile) => {
    setParsedFile(result);
    setSelectedTemplate(null);
    setMappings(autoDetectMappings(result.headers));
  }, []);

  const handleTemplateSelect = useCallback((template: BulkTemplate) => {
    setSelectedTemplate(template);
    setParsedFile(null);
    const sampleRows: BulkRow[] = template.sampleRows.map((raw, idx) => ({
      rowIndex: idx,
      title: raw["title"] || raw["Title"] || "",
      description: raw["description"] || raw["Description"] || undefined,
      condition:
        raw["condition"] || raw["Condition"] || template.defaultCondition,
      price: parseFloat(raw["price"] || raw["Price"] || "0") || 0,
      quantity: parseInt(raw["quantity"] || raw["Quantity"] || "1") || 1,
      categoryId:
        raw["categoryId"] || raw["Category_ID"] || template.defaultCategoryId,
      format: "FIXED_PRICE",
      imageUrls: [raw["imageUrl1"] || raw["Image_URL_1"] || ""].filter(Boolean),
      itemSpecifics: Object.fromEntries(
        Object.entries(raw)
          .filter(([k]) => /^item[_\s-]?specific/i.test(k))
          .map(([k, v]) => [
            k.replace(/^item[_\s-]?specific[_\s-]?/i, ""),
            v as string,
          ]),
      ),
    }));
    setRows(sampleRows);
    setRowStates(validateAllRows(sampleRows));
    setStep(2);
  }, []);

  const applyMappingsAndProceed = useCallback(() => {
    if (!parsedFile) return;
    const requiredMapped = ["title", "condition", "price", "categoryId"].every(
      (f) => mappings.some((m) => m.mappedTo === f),
    );
    if (!requiredMapped) {
      toast.error(
        "Please map all required fields: Title, Condition, Price, Category ID",
      );
      return;
    }
    const mapped = applyMappings(parsedFile.rows, mappings);
    const bulkRows = mapped.map((r, idx) => rawToBulkRow(r, idx));
    setRows(bulkRows);
    setRowStates(validateAllRows(bulkRows));
    setStep(2);
  }, [parsedFile, mappings]);

  const handleRowsChange = useCallback((newRows: BulkRow[]) => {
    setRows(newRows);
    setRowStates(validateAllRows(newRows));
  }, []);

  const generateDescriptions = useCallback(async () => {
    if (generatingDescriptions) return;
    const rowsNeedingDesc = rows.filter((r) => !r.description);
    if (!rowsNeedingDesc.length) {
      toast.info("All rows already have descriptions");
      return;
    }
    if (rowsNeedingDesc.length > descGenLimit) {
      toast.error(
        `Your plan allows AI descriptions for up to ${descGenLimit} rows.`,
      );
      return;
    }
    setGeneratingDescriptions(true);
    setDescGenProgress({ done: 0, total: rowsNeedingDesc.length });
    setRowStates((prev) =>
      prev.map((s) =>
        rowsNeedingDesc.some((r) => r.rowIndex === s.rowIndex)
          ? { ...s, status: "generating" }
          : s,
      ),
    );
    try {
      const { data, error } = await supabase.functions.invoke(
        "bulk-generate-descriptions",
        {
          body: {
            rows: rowsNeedingDesc.map((r) => ({
              rowIndex: r.rowIndex,
              title: r.title,
              condition: r.condition,
              categoryId: r.categoryId,
              itemSpecifics: r.itemSpecifics,
              imageUrl: r.imageUrls[0],
            })),
          },
        },
      );
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const results = data?.results ?? [];
      const updated = rows.map((r) => {
        const res = results.find((x: any) => x.rowIndex === r.rowIndex);
        return res?.description && !res.error
          ? { ...r, description: res.description }
          : r;
      });
      setRows(updated);
      setRowStates(
        validateAllRows(updated).map((s) => ({
          ...s,
          status: updated.find((r) => r.rowIndex === s.rowIndex)?.description
            ? "ready"
            : s.status,
        })),
      );
      const ok = results.filter((r: any) => r.description && !r.error).length;
      const fail = results.filter((r: any) => r.error).length;
      if (fail > 0)
        toast.warning(`Generated ${ok} descriptions · ${fail} failed`);
      else toast.success(`Generated ${ok} AI descriptions! ✨`);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Failed to generate descriptions");
      setRowStates((prev) =>
        prev.map((s) =>
          s.status === "generating" ? { ...s, status: "valid" } : s,
        ),
      );
    } finally {
      setGeneratingDescriptions(false);
      setDescGenProgress({ done: 0, total: 0 });
    }
  }, [rows, generatingDescriptions, descGenLimit]);

  const handlePublish = useCallback(async () => {
    if (!ebayToken) {
      toast.error("No eBay account connected. Go to Settings to connect.");
      navigate("/settings");
      return;
    }
    const validRows = getValidRows(rows, rowStates);
    if (!validRows.length) {
      toast.error("No valid rows to publish.");
      return;
    }
    if (validRows.length > publishLimit) {
      toast.error(
        `Your plan allows publishing up to ${publishLimit} listings at once.`,
      );
      return;
    }
    const rowsWithPolicies = validRows.map((r) => ({
      ...r,
      fulfillmentPolicyId:
        r.fulfillmentPolicyId ||
        selectedPolicies.fulfillmentPolicyId ||
        undefined,
      paymentPolicyId:
        r.paymentPolicyId || selectedPolicies.paymentPolicyId || undefined,
      returnPolicyId:
        r.returnPolicyId || selectedPolicies.returnPolicyId || undefined,
    }));
    setPublishing(true);
    setPublishResults([]);
    setPublishSummary({ published: 0, failed: 0, total: validRows.length });
    setStep(3);
    setRowStates((prev) =>
      prev.map((s) =>
        validRows.some((r) => r.rowIndex === s.rowIndex)
          ? { ...s, status: "publishing" }
          : s,
      ),
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
      setRowStates((prev) =>
        prev.map((s) => {
          const res = results.find((r) => r.rowIndex === s.rowIndex);
          if (!res) return s;
          return {
            ...s,
            status: res.success ? "published" : "error",
            listingId: res.listingId,
            offerId: res.offerId,
            ebayUrl: res.listingId
              ? `https://www.ebay.com/itm/${res.listingId}`
              : undefined,
            errorMessage: res.error,
          };
        }),
      );
      if (data.failed === 0)
        toast.success(`All ${data.published} listings published! 🎉`);
      else toast.warning(`${data.published} published · ${data.failed} failed`);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Bulk publish failed");
      setRowStates((prev) =>
        prev.map((s) =>
          s.status === "publishing"
            ? { ...s, status: "error", errorMessage: (err as Error).message }
            : s,
        ),
      );
    } finally {
      setPublishing(false);
      setPublishDone(true);
    }
  }, [rows, rowStates, ebayToken, selectedPolicies, publishLimit, navigate]);

  const downloadErrorReport = useCallback(() => {
    const failed = publishResults.filter((r) => !r.success);
    if (!failed.length) return;
    const failedRows = rows.filter((r) =>
      failed.some((f) => f.rowIndex === r.rowIndex),
    );
    const lines = [
      '"Row","Title","Price","Category ID","Error"',
      ...failedRows.map((r) => {
        const res = failed.find((f) => f.rowIndex === r.rowIndex);
        return `"${r.rowIndex + 1}","${r.title}","${r.price}","${r.categoryId}","${res?.error ?? "Unknown"}"`;
      }),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk_publish_errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [publishResults, rows]);

  const validCount = countValidRows(rowStates);
  const errorCount = countErrorRows(rowStates);
  const readyCount = rowStates.filter((s) => s.status === "ready").length;
  const publishableCount = rowStates.filter(
    (s) => s.status === "valid" || s.status === "ready",
  ).length;

  return (
    <AppShell>
      <div style={S.page}>
        {/* Sticky header */}
        <div style={S.stickyHeader}>
          <button
            onClick={() => navigate("/home")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: COLORS.textMuted,
              display: "flex",
            }}
          >
            <ArrowLeft size={20} />
          </button>
          <Layers size={20} color={COLORS.brand} />
          <span
            style={{
              fontWeight: 700,
              fontSize: "1rem",
              color: COLORS.textPrimary,
              flex: 1,
            }}
          >
            Bulk Listing Generator
          </span>
          {rows.length > 0 && (
            <span style={{ fontSize: "0.75rem", color: COLORS.textMuted }}>
              {rows.length} rows
            </span>
          )}
        </div>

        <div style={S.inner}>
          {/* Step indicator */}
          <div style={S.stepRow}>
            {STEPS.map((label, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flex: i < STEPS.length - 1 ? 1 : "unset",
                }}
              >
                <div
                  style={S.stepDot(
                    i < step ? "done" : i === step ? "active" : "pending",
                  )}
                >
                  {i < step ? <CheckCircle size={13} /> : i + 1}
                </div>
                <span
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    color: i === step ? COLORS.textPrimary : COLORS.textMuted,
                    display: "none",
                  }}
                  className="sm:inline"
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && <div style={S.stepLine(i < step)} />}
              </div>
            ))}
          </div>

          {/* ── STEP 0: Upload ── */}
          {step === 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Layers size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Upload Your Listing File</span>
                </div>
                <div style={S.sectionBody}>
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: COLORS.textMuted,
                      margin: 0,
                    }}
                  >
                    Upload a CSV or Excel file, or start from one of our
                    templates below.
                  </p>
                  {!canBulkPublish && (
                    <div style={S.warningBox}>
                      <Crown
                        size={16}
                        color="#d97706"
                        style={{ flexShrink: 0, marginTop: 1 }}
                      />
                      <div>
                        <p style={{ fontWeight: 700, margin: "0 0 2px" }}>
                          Free tier: up to {publishLimit} listings
                        </p>
                        <p style={{ margin: 0 }}>
                          Upgrade to Pro for 50 listings or Shop for unlimited.{" "}
                          <button
                            onClick={() => navigate("/billing")}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "#d97706",
                              fontWeight: 700,
                              padding: 0,
                              textDecoration: "underline",
                            }}
                          >
                            Upgrade →
                          </button>
                        </p>
                      </div>
                    </div>
                  )}
                  <BulkUploadZone onFileParsed={handleFileParsed} />
                </div>
              </div>

              {/* Divider */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{ flex: 1, height: 1, background: COLORS.border }}
                />
                <span style={{ fontSize: "0.75rem", color: COLORS.textMuted }}>
                  or start from a template
                </span>
                <div
                  style={{ flex: 1, height: 1, background: COLORS.border }}
                />
              </div>

              {/* Template cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {Object.values(BULK_TEMPLATES).map((template) => (
                  <BulkTemplateCard
                    key={template.id}
                    template={template}
                    onSelect={handleTemplateSelect}
                  />
                ))}
              </div>

              {parsedFile && (
                <button
                  onClick={() => setStep(1)}
                  style={S.btnPrimary}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.transform =
                      "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.transform =
                      "translateY(0)";
                  }}
                >
                  Map Columns <ArrowRight size={16} />
                </button>
              )}
            </div>
          )}

          {/* ── STEP 1: Column Mapping ── */}
          {step === 1 && parsedFile && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Info size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Map Your Columns</span>
                </div>
                <div style={S.sectionBody}>
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: COLORS.textMuted,
                      margin: 0,
                    }}
                  >
                    Tell us which CSV column maps to each listing field.{" "}
                    <span style={{ color: COLORS.brand, fontWeight: 600 }}>
                      Bold
                    </span>{" "}
                    = required.
                  </p>
                  <BulkColumnMapper
                    headers={parsedFile.headers}
                    previewRows={parsedFile.rows.slice(0, 3)}
                    mappings={mappings}
                    onMappingsChange={setMappings}
                  />
                </div>
              </div>
              <div style={S.btnRow}>
                <button onClick={() => setStep(0)} style={S.btnFlex(false)}>
                  Back
                </button>
                <button
                  onClick={applyMappingsAndProceed}
                  style={{ ...S.btnFlex(true), gap: 6 }}
                >
                  Review Rows <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Review & Generate ── */}
          {step === 2 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Sparkles size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>
                    Review & Generate Descriptions
                  </span>
                  <div
                    style={{
                      marginLeft: "auto",
                      display: "flex",
                      gap: 8,
                      fontSize: "0.75rem",
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ color: "#16a34a" }}>{validCount} ready</span>
                    {errorCount > 0 && (
                      <span style={{ color: "#dc2626" }}>
                        {errorCount} errors
                      </span>
                    )}
                    {readyCount > 0 && (
                      <span style={{ color: COLORS.brand }}>
                        {readyCount} with AI
                      </span>
                    )}
                  </div>
                </div>
                <div style={S.sectionBody}>
                  {rows.some((r) => !r.description) && (
                    <div style={S.aiStrip}>
                      <Sparkles
                        size={18}
                        color={COLORS.brand}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            fontWeight: 700,
                            fontSize: "0.8125rem",
                            color: COLORS.textPrimary,
                            margin: "0 0 2px",
                          }}
                        >
                          {rows.filter((r) => !r.description).length} rows need
                          descriptions
                        </p>
                        <p
                          style={{
                            fontSize: "0.75rem",
                            color: COLORS.textMuted,
                            margin: 0,
                          }}
                        >
                          AI will write compelling eBay descriptions for each
                          item
                        </p>
                      </div>
                      <button
                        onClick={generateDescriptions}
                        disabled={generatingDescriptions}
                        style={{
                          ...btnPrimaryStyle,
                          padding: "0.5rem 0.875rem",
                          fontSize: "0.8125rem",
                          opacity: generatingDescriptions ? 0.6 : 1,
                        }}
                      >
                        {generatingDescriptions ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />{" "}
                            {descGenProgress.total > 0
                              ? `${descGenProgress.done}/${descGenProgress.total}`
                              : "Generating..."}
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} /> Generate AI
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <p
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: COLORS.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        margin: 0,
                      }}
                    >
                      eBay Business Policies (applied to all rows)
                    </p>
                    <EbayPolicySelector
                      userToken={ebayToken}
                      onPoliciesSelected={setSelectedPolicies}
                      disabled={generatingDescriptions}
                    />
                  </div>

                  <BulkDataTable
                    rows={rows}
                    rowStates={rowStates}
                    onRowsChange={handleRowsChange}
                    disabled={generatingDescriptions}
                  />
                </div>
              </div>

              <div style={S.btnRow}>
                <button
                  onClick={() => setStep(selectedTemplate ? 0 : 1)}
                  style={S.btnFlex(false)}
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={publishableCount === 0 || generatingDescriptions}
                  style={{
                    ...S.btnFlex(true),
                    gap: 6,
                    opacity:
                      publishableCount === 0 || generatingDescriptions
                        ? 0.5
                        : 1,
                  }}
                >
                  Publish {publishableCount > 0 ? `(${publishableCount})` : ""}{" "}
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Publish ── */}
          {step === 3 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <div style={S.section}>
                <div style={S.sectionHeader}>
                  <Send size={16} color={COLORS.brand} />
                  <span style={cardTitleStyle}>Publish to eBay</span>
                </div>
                <div style={S.sectionBody}>
                  <p
                    style={{
                      fontSize: "0.875rem",
                      color: COLORS.textMuted,
                      margin: 0,
                    }}
                  >
                    {publishDone
                      ? "Publishing complete. Review results below."
                      : publishing
                        ? "Publishing your listings to eBay..."
                        : `${publishableCount} listings ready to publish.`}
                  </p>

                  {!publishing && !publishDone && (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                        }}
                      >
                        <div style={S.statBox("green")}>
                          <p style={S.statNum("green")}>{publishableCount}</p>
                          <p
                            style={{
                              fontSize: "0.75rem",
                              color: COLORS.textMuted,
                              margin: 0,
                            }}
                          >
                            Ready to publish
                          </p>
                        </div>
                        <div style={S.statBox("red")}>
                          <p style={S.statNum("red")}>{errorCount}</p>
                          <p
                            style={{
                              fontSize: "0.75rem",
                              color: COLORS.textMuted,
                              margin: 0,
                            }}
                          >
                            Have errors
                          </p>
                        </div>
                      </div>

                      {errorCount > 0 && (
                        <div style={S.warningBox}>
                          <AlertCircle
                            size={16}
                            color="#d97706"
                            style={{ flexShrink: 0, marginTop: 1 }}
                          />
                          <p style={{ margin: 0 }}>
                            {errorCount} rows have errors and will be skipped.{" "}
                            <button
                              onClick={() => setStep(2)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#d97706",
                                fontWeight: 700,
                                padding: 0,
                                textDecoration: "underline",
                              }}
                            >
                              Go back to fix them
                            </button>
                          </p>
                        </div>
                      )}

                      {publishableCount > publishLimit && (
                        <div style={S.warningBox}>
                          <Crown
                            size={16}
                            color="#d97706"
                            style={{ flexShrink: 0, marginTop: 1 }}
                          />
                          <p style={{ margin: 0 }}>
                            Your plan allows {publishLimit} at once. Only the
                            first {publishLimit} will be published.{" "}
                            <button
                              onClick={() => navigate("/billing")}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#d97706",
                                fontWeight: 700,
                                padding: 0,
                                textDecoration: "underline",
                              }}
                            >
                              Upgrade →
                            </button>
                          </p>
                        </div>
                      )}

                      {!ebayToken && (
                        <div style={S.errorBox}>
                          <AlertCircle
                            size={16}
                            color="#dc2626"
                            style={{ flexShrink: 0, marginTop: 1 }}
                          />
                          <p style={{ margin: 0 }}>
                            No eBay account connected.{" "}
                            <button
                              onClick={() => navigate("/settings")}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#dc2626",
                                fontWeight: 700,
                                padding: 0,
                                textDecoration: "underline",
                              }}
                            >
                              Connect eBay →
                            </button>
                          </p>
                        </div>
                      )}

                      <div style={S.btnRow}>
                        <button
                          onClick={() => setStep(2)}
                          style={S.btnFlex(false)}
                        >
                          Back
                        </button>
                        <button
                          onClick={handlePublish}
                          disabled={publishableCount === 0 || !ebayToken}
                          style={{
                            ...S.btnFlex(true),
                            gap: 6,
                            opacity:
                              publishableCount === 0 || !ebayToken ? 0.5 : 1,
                          }}
                        >
                          <Send size={15} /> Publish{" "}
                          {Math.min(publishableCount, publishLimit)} Listings
                        </button>
                      </div>
                    </>
                  )}

                  {(publishing || publishDone) && (
                    <BulkProgressBar
                      total={publishSummary.total}
                      published={publishSummary.published}
                      failed={publishSummary.failed}
                      inProgress={publishing}
                      results={publishResults}
                      onDownloadErrors={
                        publishSummary.failed > 0
                          ? downloadErrorReport
                          : undefined
                      }
                    />
                  )}

                  {publishDone && (
                    <div style={S.btnRow}>
                      <button
                        onClick={() => navigate("/dashboard")}
                        style={S.btnFlex(false)}
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
                        style={{ ...S.btnFlex(true), gap: 6 }}
                      >
                        <RefreshCw size={15} /> New Bulk Upload
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
