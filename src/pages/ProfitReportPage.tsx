import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Receipt,
  RefreshCw,
  Loader2,
  AlertCircle,
  Download,
  ArrowLeft,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import BottomNav from "@/components/BottomNav";
import ProfitReportCard from "@/components/ProfitReportCard";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReportItem {
  orderId: string;
  title: string;
  ebayListingId: string | null;
  ebaySku: string | null;
  salePrice: number;
  shippingCollected: number;
  shippingLabelCost: number;
  ebayFees: number;
  cogs: number | null;
  netProfit: number;
  margin: number | null;
  soldAt: string;
}

interface ReportSummary {
  totalRevenue: number;
  totalCogs: number;
  totalFees: number;
  totalShippingCollected: number;
  totalShippingLabels: number;
  totalShippingNet: number;
  netProfit: number;
  avgMargin: number | null;
  itemsWithCogs: number;
  itemsWithoutCogs: number;
}

type PeriodKey = "7d" | "30d" | "90d" | "custom";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function periodToDates(period: PeriodKey): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  if (period === "7d") start.setDate(end.getDate() - 7);
  if (period === "30d") start.setDate(end.getDate() - 30);
  if (period === "90d") start.setDate(end.getDate() - 90);
  return { start, end };
}

function downloadCsv(items: ReportItem[]) {
  const headers = [
    "Sold Date",
    "Title",
    "eBay Listing ID",
    "SKU",
    "Sale Price",
    "Shipping Collected",
    "Shipping Label Cost",
    "eBay Fees",
    "Item Cost (COGS)",
    "Net Profit",
    "Margin %",
  ];
  const rows = items.map((r) => [
    fmtDate(r.soldAt),
    `"${r.title.replace(/"/g, '""')}"`,
    r.ebayListingId ?? "",
    r.ebaySku ?? "",
    r.salePrice.toFixed(2),
    r.shippingCollected.toFixed(2),
    r.shippingLabelCost.toFixed(2),
    r.ebayFees.toFixed(2),
    r.cogs != null ? r.cogs.toFixed(2) : "",
    r.netProfit.toFixed(2),
    r.margin != null ? r.margin.toFixed(1) : "",
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `profit-report-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProfitReportPage() {
  const { user, planFeatures, isPro, isShop } = useAuth();
  const navigate = useNavigate();
  const canAccess = planFeatures.hasCogsTracking;

  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [items, setItems] = useState<ReportItem[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Summary cards for 7d / 30d / 90d (always fetched as 90d, sliced client-side)
  const [allItems, setAllItems] = useState<ReportItem[]>([]);

  const fetchReport = useCallback(async () => {
    if (!user?.id || !canAccess) return;

    setLoading(true);
    setError(null);

    try {
      // Always fetch 90d; we slice for the card comparisons
      const { start, end } = periodToDates("90d");

      // Get stored eBay token — try ebay-publish, fall back to localStorage
      let ebayToken: string | null = null;
      try {
        const { data: tokenData } = await supabase.functions.invoke(
          "ebay-publish",
          {
            body: { action: "get_stored_token", userId: user.id },
          },
        );
        if (tokenData?.token) {
          ebayToken = tokenData.token;
          localStorage.setItem("ebay-user-token", ebayToken!);
        } else if (tokenData?.isExpired) {
          localStorage.removeItem("ebay-user-token");
        }
      } catch {
        /* fall through */
      }
      if (!ebayToken) ebayToken = localStorage.getItem("ebay-user-token");
      if (!ebayToken) {
        setError("No eBay account connected. Please connect eBay in Settings.");
        setLoading(false);
        return;
      }

      const { data, error: fnErr } = await supabase.functions.invoke(
        "cogs-report",
        {
          body: {
            userToken: ebayToken,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
          },
        },
      );

      if (fnErr || data?.error) {
        throw new Error(data?.error ?? fnErr?.message ?? "Unknown error");
      }

      setAllItems(data.items ?? []);

      // Filter to selected period for table
      const { start: periodStart } = periodToDates(
        period === "custom" ? "90d" : period,
      );
      const filtered = (data.items ?? []).filter(
        (i: ReportItem) => new Date(i.soldAt) >= periodStart,
      );
      setItems(filtered);
      setSummary(data.summary ?? null);
    } catch (err: unknown) {
      console.error("cogs-report fetch error:", err);
      const msg =
        err instanceof Error ? err.message : "Failed to load profit report";
      setError(msg);
      toast.error("Failed to load profit report");
    } finally {
      setLoading(false);
    }
  }, [user?.id, canAccess]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Re-filter table when period changes without re-fetching
  useEffect(() => {
    if (allItems.length === 0) return;
    const { start } = periodToDates(period === "custom" ? "90d" : period);
    setItems(allItems.filter((i) => new Date(i.soldAt) >= start));
  }, [period, allItems]);

  // Build summary card props for 7d / 30d / 90d from allItems
  function buildCardProps(p: "7d" | "30d" | "90d") {
    const { start } = periodToDates(p);
    const subset = allItems.filter((i) => new Date(i.soldAt) >= start);
    const rev = subset.reduce((s, i) => s + i.salePrice, 0);
    const cogs = subset.reduce((s, i) => s + (i.cogs ?? 0), 0);
    const fees = subset.reduce((s, i) => s + i.ebayFees, 0);
    const shipIn = subset.reduce((s, i) => s + i.shippingCollected, 0);
    const shipOut = subset.reduce((s, i) => s + i.shippingLabelCost, 0);
    const shippingNet = shipIn - shipOut;
    const net = rev + shippingNet - fees - cogs;
    const margin = rev > 0 ? (net / rev) * 100 : null;
    return {
      grossRevenue: rev,
      totalCogs: cogs,
      ebayFees: fees,
      shippingNet,
      otherDeductions: 0,
      netProfit: net,
      trueMarginPct: margin != null ? parseFloat(margin.toFixed(1)) : null,
    };
  }

  // ─── Locked state for non-Pro/Shop ─────────────────────────────────────────
  if (!canAccess) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="max-w-lg mx-auto px-4 pt-8 flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Profit Report</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The Profit Report shows a per-item P&L breakdown of every sold
            listing, including COGS, eBay fees, and true net profit. Available
            on <span className="font-semibold text-primary">Pro</span> and{" "}
            <span className="font-semibold text-primary">Shop</span> plans.
          </p>
          <button
            onClick={() => navigate("/billing")}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            Upgrade to Pro
          </button>
          <button
            onClick={() => navigate(-1)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Go back
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  const periodTabs: { key: PeriodKey; label: string }[] = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
  ];

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Receipt className="w-5 h-5 text-primary" />
            <h1 className="text-base font-semibold text-foreground">
              Profit Report
            </h1>
          </div>
          <button
            onClick={fetchReport}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-4 space-y-5">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Missing COGS notice */}
        {!loading && summary && summary.itemsWithoutCogs > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{summary.itemsWithoutCogs}</strong> sold item
              {summary.itemsWithoutCogs !== 1 ? "s" : ""} have no cost recorded
              — their profit is calculated without COGS. Enter item costs when
              creating or editing a draft to see true margins.
            </span>
          </div>
        )}

        {/* Summary cards — 7d / 30d / 90d */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : allItems.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["7d", "30d", "90d"] as const).map((p) => (
              <ProfitReportCard key={p} period={p} {...buildCardProps(p)} />
            ))}
          </div>
        ) : null}

        {/* Period filter + Export */}
        {!loading && allItems.length > 0 && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1.5">
              {periodTabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setPeriod(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    period === t.key
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => downloadCsv(items)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        )}

        {/* Per-item table */}
        {!loading && items.length > 0 && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2 bg-muted/40 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              <span>Item</span>
              <span className="text-right">Sale</span>
              <span className="text-right">COGS</span>
              <span className="text-right">Fees</span>
              <span className="text-right">Ship</span>
              <span className="text-right">Profit</span>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border">
              {items.map((item, idx) => {
                const profitPos = item.netProfit >= 0;
                const profitColor = profitPos
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-500 dark:text-red-400";

                return (
                  <div
                    key={`${item.orderId}-${idx}`}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-3 items-center hover:bg-muted/20 transition-colors"
                  >
                    {/* Title + date */}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-1">
                        {item.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fmtDate(item.soldAt)}
                      </p>
                      {item.margin != null && (
                        <span
                          className={`inline-block text-[10px] font-medium mt-0.5 ${
                            item.margin >= 40
                              ? "text-emerald-600 dark:text-emerald-400"
                              : item.margin >= 20
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-red-500 dark:text-red-400"
                          }`}
                        >
                          {item.margin.toFixed(1)}% margin
                        </span>
                      )}
                    </div>

                    {/* Sale price */}
                    <span className="text-xs text-foreground text-right whitespace-nowrap">
                      {fmtMoney(item.salePrice)}
                    </span>

                    {/* COGS */}
                    <span
                      className={`text-xs text-right whitespace-nowrap ${item.cogs != null ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
                    >
                      {item.cogs != null ? `−${fmtMoney(item.cogs)}` : "—"}
                    </span>

                    {/* eBay Fees */}
                    <span className="text-xs text-red-500 dark:text-red-400 text-right whitespace-nowrap">
                      −{fmtMoney(item.ebayFees)}
                    </span>

                    {/* Shipping net (collected − label cost) */}
                    {(() => {
                      const shipNet =
                        item.shippingCollected - item.shippingLabelCost;
                      return (
                        <span
                          title={`Collected: ${fmtMoney(item.shippingCollected)} − Label: ${fmtMoney(item.shippingLabelCost)}`}
                          className={`text-xs text-right whitespace-nowrap ${Math.abs(shipNet) < 0.01 ? "text-muted-foreground" : shipNet >= 0 ? "text-foreground" : "text-red-500"}`}
                        >
                          {Math.abs(shipNet) < 0.01
                            ? "≈$0"
                            : `${shipNet >= 0 ? "+" : "−"}${fmtMoney(Math.abs(shipNet))}`}
                        </span>
                      );
                    })()}

                    {/* Net profit */}
                    <span
                      className={`text-xs font-semibold text-right whitespace-nowrap ${profitColor}`}
                    >
                      {profitPos ? "+" : "−"}
                      {fmtMoney(Math.abs(item.netProfit))}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Table footer totals */}
            {items.length > 1 &&
              (() => {
                const totRev = items.reduce((s, i) => s + i.salePrice, 0);
                const totCogs = items.reduce((s, i) => s + (i.cogs ?? 0), 0);
                const totFees = items.reduce((s, i) => s + i.ebayFees, 0);
                const totShipIn = items.reduce(
                  (s, i) => s + i.shippingCollected,
                  0,
                );
                const totShipOut = items.reduce(
                  (s, i) => s + i.shippingLabelCost,
                  0,
                );
                const totShipNet = totShipIn - totShipOut;
                const totProfit = items.reduce((s, i) => s + i.netProfit, 0);
                const profitPos = totProfit >= 0;
                return (
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2.5 bg-muted/40 border-t border-border text-[10px] font-bold text-foreground">
                    <span>{items.length} items</span>
                    <span className="text-right">{fmtMoney(totRev)}</span>
                    <span className="text-right text-orange-600 dark:text-orange-400">
                      {totCogs > 0 ? `−${fmtMoney(totCogs)}` : "—"}
                    </span>
                    <span className="text-right text-red-500 dark:text-red-400">
                      −{fmtMoney(totFees)}
                    </span>
                    <span
                      title={`Collected: ${fmtMoney(totShipIn)} − Labels: ${fmtMoney(totShipOut)}`}
                      className="text-right text-muted-foreground"
                    >
                      {Math.abs(totShipNet) < 0.01
                        ? "≈$0"
                        : `${totShipNet >= 0 ? "+" : "−"}${fmtMoney(Math.abs(totShipNet))}`}
                    </span>
                    <span
                      className={`text-right ${profitPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}
                    >
                      {profitPos ? "+" : "−"}
                      {fmtMoney(Math.abs(totProfit))}
                    </span>
                  </div>
                );
              })()}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Receipt className="w-10 h-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              No sales in this period
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Sold orders will appear here once eBay Fulfillment data is
              available. Make sure your eBay account is connected in Settings.
            </p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
