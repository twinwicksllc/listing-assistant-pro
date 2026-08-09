import { useState, useEffect, useCallback, useRef } from "react";
import {
  DollarSign,
  Save,
  RefreshCw,
  Loader2,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Lock,
  ShoppingCart,
  Calendar,
  ArrowRight,
  Filter,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import BottomNav from "@/components/BottomNav";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────

interface SoldOrder {
  orderId: string;
  lineItemId: string;
  title: string;
  sku: string | null;
  listingId: string | null;
  salePrice: number;
  shippingCollected: number;
  ebayFees: number;
  cogs: number | undefined;
  savedCogs: number | undefined;
  saving: boolean;
  dirty: boolean;
  soldAt: string;
  window: "7d" | "30d" | "90d" | "older";
}

type SortField = "title" | "soldAt" | "salePrice" | "cogs" | "margin";
type SortDir = "asc" | "desc";
type FilterMode = "all" | "missing" | "withCogs";

// ── Helpers ────────────────────────────────────────────────────────────────

function gross(salePrice: number, shipping: number): number {
  return salePrice + shipping;
}

function netProfit(
  salePrice: number,
  shipping: number,
  fees: number,
  cogs: number | undefined,
): number | null {
  if (cogs == null) return null;
  return gross(salePrice, shipping) - fees - cogs;
}

function margin(
  salePrice: number,
  shipping: number,
  fees: number,
  cogs: number | undefined,
): number | null {
  if (cogs == null) return null;
  const prof = netProfit(salePrice, shipping, fees, cogs);
  const gro = gross(salePrice, shipping);
  if (prof == null || gro <= 0) return null;
  return (prof / gro) * 100;
}

function windowLabel(window: string): string {
  return window === "7d"
    ? "Last 7 days"
    : window === "30d"
      ? "Last 30 days"
      : window === "90d"
        ? "Last 90 days"
        : "Older";
}

function windowColor(window: string): string {
  switch (window) {
    case "7d":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "30d":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "90d":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function MarginBadge({
  salePrice,
  shipping,
  fees,
  cogs,
}: {
  salePrice: number;
  shipping: number;
  fees: number;
  cogs: number | undefined;
}) {
  const m = margin(salePrice, shipping, fees, cogs);
  if (m == null)
    return <span className="text-xs text-muted-foreground">—</span>;
  const color =
    m >= 40
      ? "text-emerald-600 dark:text-emerald-400"
      : m >= 20
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-500 dark:text-red-400";
  const Icon = m >= 40 ? TrendingUp : m >= 0 ? Minus : TrendingDown;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {m.toFixed(1)}%
    </span>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function HistoricalCogsPage() {
  const { user, planFeatures, isOwner } = useAuth();
  const [orders, setOrders] = useState<SoldOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("soldAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterMode, setFilterMode] = useState<FilterMode>("missing");
  const [savedCount, setSavedCount] = useState(0);
  const [windowFilter, setWindowFilter] = useState<
    "all" | "7d" | "30d" | "90d" | "older"
  >("all");
  const [noToken, setNoToken] = useState(false);

  // ── Fetch sold orders + COGS ─────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setNoToken(false);

    // Resolve eBay token: try ebay-publish first, fall back to localStorage
    let ebayToken: string | null = null;
    try {
      const { data: td } = await supabase.functions.invoke("ebay-publish", {
        body: { action: "get_stored_token", userId: user.id },
      });
      if (td?.token) {
        ebayToken = td.token;
        localStorage.setItem("ebay-user-token", ebayToken!);
      } else if (td?.isExpired) {
        localStorage.removeItem("ebay-user-token");
      }
    } catch {
      /* fall through */
    }
    if (!ebayToken) ebayToken = localStorage.getItem("ebay-user-token");
    if (!ebayToken) {
      setNoToken(true);
      setLoading(false);
      return;
    }

    try {
      // 1. Pull sold orders from the existing cogs-report edge function
      const reportRes = await supabase.functions.invoke("cogs-report", {
        body: { userToken: ebayToken },
      });

      const items: any[] = reportRes.data?.items ?? [];

      if (items.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }

      // 2. Build SoldOrder rows
      const now = Date.now();
      const ms7 = 7 * 24 * 60 * 60 * 1000;
      const ms30 = 30 * 24 * 60 * 60 * 1000;
      const ms90 = 90 * 24 * 60 * 60 * 1000;

      const rows: SoldOrder[] = items.map((item, idx) => {
        const soldAt = item.soldAt ?? new Date().toISOString();
        const age = now - new Date(soldAt).getTime();
        let window: "7d" | "30d" | "90d" | "older" = "older";
        if (age <= ms7) window = "7d";
        else if (age <= ms30) window = "30d";
        else if (age <= ms90) window = "90d";

        return {
          orderId: item.orderId ?? `order-${idx}`,
          lineItemId: item.orderId ?? `line-${idx}`,
          title: item.title ?? "Untitled",
          sku: item.ebaySku ?? null,
          listingId: item.ebayListingId ?? null,
          salePrice: Number(item.salePrice ?? 0),
          shippingCollected: Number(item.shippingCollected ?? 0),
          ebayFees: Number(item.ebayFees ?? 0),
          cogs: item.cogs ?? undefined,
          savedCogs: item.cogs ?? undefined,
          saving: false,
          dirty: false,
          soldAt,
          window,
        };
      });

      setOrders(rows);
    } catch (err) {
      console.error("HistoricalCogs load error:", err);
      toast.error("Failed to load sold orders");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Per-row COGS change ──────────────────────────────────────────────────

  const updateCogs = useCallback((lineItemId: string, value: string) => {
    const parsed = value === "" ? undefined : parseFloat(value);
    setOrders((prev) =>
      prev.map((r) =>
        r.lineItemId === lineItemId
          ? {
              ...r,
              cogs: isNaN(parsed as number) ? undefined : parsed,
              dirty: true,
            }
          : r,
      ),
    );
  }, []);

  // ── Save a single row ────────────────────────────────────────────────────

  const saveRow = useCallback(
    async (row: SoldOrder) => {
      if (!user) return;
      if (!row.dirty && row.cogs === row.savedCogs) return;

      setOrders((prev) =>
        prev.map((r) =>
          r.lineItemId === row.lineItemId ? { ...r, saving: true } : r,
        ),
      );

      try {
        if (row.cogs == null) {
          // Delete the COGS record if user cleared the field.
          // Build OR filter only for non-null identifiers to avoid matching NULLs.
          const orParts: string[] = [];
          if (row.listingId)
            orParts.push(`ebay_listing_id.eq.${row.listingId}`);
          if (row.sku) orParts.push(`ebay_sku.eq.${row.sku}`);
          if (orParts.length > 0) {
            const { error } = await supabase
              .from("listing_cogs")
              .delete()
              .eq("user_id", user.id)
              .or(orParts.join(","));
            if (error) throw error;
          }
        } else {
          // Use select-then-update-or-insert to avoid partial unique index issues.
          // ON CONFLICT doesn't work with partial indexes (WHERE ... IS NOT NULL).
          let existingId: string | null = null;

          if (row.listingId) {
            const { data: byListingId } = await supabase
              .from("listing_cogs")
              .select("id")
              .eq("user_id", user.id)
              .eq("ebay_listing_id", row.listingId)
              .maybeSingle();
            if (byListingId) existingId = byListingId.id;
          }

          if (!existingId && row.sku) {
            const { data: bySku } = await supabase
              .from("listing_cogs")
              .select("id")
              .eq("user_id", user.id)
              .eq("ebay_sku", row.sku)
              .maybeSingle();
            if (bySku) existingId = bySku.id;
          }

          const payload = {
            user_id: user.id,
            ebay_listing_id: row.listingId || null,
            ebay_sku: row.sku || null,
            title: row.title,
            cogs: row.cogs,
            cogs_source: "backfill",
            acquired_at: row.soldAt, // approximate acquisition date = sale date for historical items
            updated_at: new Date().toISOString(),
          };

          if (existingId) {
            const { error } = await supabase
              .from("listing_cogs")
              .update(payload)
              .eq("id", existingId);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from("listing_cogs")
              .insert(payload);
            if (error) throw error;
          }
        }

        setOrders((prev) =>
          prev.map((r) =>
            r.lineItemId === row.lineItemId
              ? { ...r, savedCogs: r.cogs, dirty: false, saving: false }
              : r,
          ),
        );
        setSavedCount((c) => c + 1);
        toast.success(`Saved COGS for "${row.title}"`);
      } catch (err) {
        console.error("Save COGS error:", err);
        toast.error(`Failed to save COGS for "${row.title}"`);
        setOrders((prev) =>
          prev.map((r) =>
            r.lineItemId === row.lineItemId ? { ...r, saving: false } : r,
          ),
        );
      }
    },
    [user],
  );

  // ── Save ALL dirty rows ──────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    const dirty = orders.filter((r) => r.dirty);
    if (dirty.length === 0) {
      toast.info("No changes to save");
      return;
    }
    setSaving(true);
    for (const row of dirty) await saveRow(row);
    setSaving(false);
    toast.success(
      `Backfilled COGS for ${dirty.length} sale${dirty.length > 1 ? "s" : ""}`,
    );
  }, [orders, saveRow]);

  // ── Sort & filter ────────────────────────────────────────────────────────

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = orders
    .filter((r) => {
      if (
        search &&
        !r.title.toLowerCase().includes(search.toLowerCase()) &&
        !r.sku?.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (filterMode === "missing" && r.savedCogs != null) return false;
      if (filterMode === "withCogs" && r.savedCogs == null) return false;
      if (windowFilter !== "all" && r.window !== windowFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "title") cmp = a.title.localeCompare(b.title);
      if (sortField === "soldAt")
        cmp = new Date(a.soldAt).getTime() - new Date(b.soldAt).getTime();
      if (sortField === "salePrice") cmp = a.salePrice - b.salePrice;
      if (sortField === "cogs") cmp = (a.cogs ?? -1) - (b.cogs ?? -1);
      if (sortField === "margin") {
        const ma =
          margin(a.salePrice, a.shippingCollected, a.ebayFees, a.cogs) ?? -999;
        const mb =
          margin(b.salePrice, b.shippingCollected, b.ebayFees, b.cogs) ?? -999;
        cmp = ma - mb;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  const dirtyCount = orders.filter((r) => r.dirty).length;
  const missingCount = orders.filter((r) => r.savedCogs == null).length;
  const withCogsCount = orders.filter((r) => r.savedCogs != null).length;

  // ── SortHeader helper ────────────────────────────────────────────────────

  function SortHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`flex items-center gap-0.5 text-xs font-medium uppercase tracking-wide select-none ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : (
          <ChevronUp className="w-3 h-3 opacity-30" />
        )}
      </button>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!planFeatures.hasCogsTracking) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col items-center gap-4 text-center">
          <Lock className="w-10 h-10 text-muted-foreground" />
          <h1 className="text-xl font-bold">COGS Tracking — Pro & Shop Only</h1>
          <p className="text-muted-foreground text-sm">
            Upgrade to Pro or Shop to enter item costs and see true profit on
            past sales.
          </p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <ShoppingCart className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">
              Historical COGS Backfill
            </h1>
            <p className="text-xs text-muted-foreground">
              Add item costs to past sales for accurate profit tracking
            </p>
          </div>

          {dirtyCount > 0 && (
            <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
              {dirtyCount} unsaved
            </span>
          )}

          <button
            onClick={saveAll}
            disabled={saving || dirtyCount === 0}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 transition-opacity"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save All
          </button>

          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh sold orders"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sold items…"
              className="w-full bg-card border border-border rounded-lg pl-8 pr-8 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All sales</option>
            <option value="missing">Missing COGS</option>
            <option value="withCogs">Has COGS</option>
          </select>

          <select
            value={windowFilter}
            onChange={(e) => setWindowFilter(e.target.value as any)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="older">Older</option>
          </select>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && orders.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground border-b border-border/50">
          <span>{orders.length} total sales</span>
          <span>{missingCount} missing COGS</span>
          <span>{withCogsCount} with COGS</span>
          <span className="ml-auto text-right">
            Est. revenue without COGS: $
            {orders
              .filter((r) => r.savedCogs == null)
              .reduce(
                (sum, r) =>
                  sum + gross(r.salePrice, r.shippingCollected) - r.ebayFees,
                0,
              )
              .toFixed(2)}
          </span>
          {savedCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              {savedCount} backfilled
            </span>
          )}
        </div>
      )}

      {/* Table header */}
      {!loading && filtered.length > 0 && (
        <div className="max-w-6xl mx-auto px-4 pt-3">
          <div className="grid grid-cols-[auto_120px_1fr_100px_100px_100px_80px_36px] gap-2 items-center px-2 pb-1 border-b border-border/50">
            <div className="w-8" />
            <SortHeader field="soldAt" label="Date" />
            <SortHeader field="title" label="Item" />
            <SortHeader field="salePrice" label="Gross" />
            <SortHeader field="cogs" label="Item Cost" />
            <SortHeader field="margin" label="Margin" />
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Net
            </div>
            <div />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="max-w-6xl mx-auto px-4 pt-1 space-y-0.5">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Loading your sold orders…</p>
          </div>
        ) : noToken ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-medium">eBay account not connected</p>
            <p className="text-xs text-muted-foreground">
              Connect your eBay account in Settings to backfill COGS.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <ShoppingCart className="w-8 h-8 opacity-40" />
            <p className="text-sm">
              {search
                ? "No sales match your search"
                : filterMode === "missing"
                  ? "All sales have COGS!"
                  : "No sales found"}
            </p>
          </div>
        ) : (
          filtered.map((row) => (
            <SoldOrderRowItem
              key={row.lineItemId}
              row={row}
              onChange={updateCogs}
              onBlur={saveRow}
            />
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}

// ── Row Component ──────────────────────────────────────────────────────────

function SoldOrderRowItem({
  row,
  onChange,
  onBlur,
}: {
  row: SoldOrder;
  onChange: (id: string, val: string) => void;
  onBlur: (row: SoldOrder) => void;
}) {
  const grossVal = gross(row.salePrice, row.shippingCollected);
  const netVal = netProfit(
    row.salePrice,
    row.shippingCollected,
    row.ebayFees,
    row.cogs,
  );

  return (
    <div
      className={`grid grid-cols-[auto_120px_1fr_100px_100px_100px_80px_36px] gap-2 items-center py-2 px-2 rounded-lg transition-colors ${
        row.dirty ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-muted/40"
      }`}
    >
      {/* Window badge */}
      <div className="w-8 flex justify-center">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${windowColor(row.window)}`}
        >
          {row.window === "7d"
            ? "7d"
            : row.window === "30d"
              ? "30d"
              : row.window === "90d"
                ? "90d"
                : ""}
        </span>
      </div>

      {/* Sale date */}
      <div className="text-xs text-muted-foreground">
        {new Date(row.soldAt).toLocaleDateString()}
      </div>

      {/* Title + SKU */}
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground line-clamp-1">
          {row.title}
        </p>
        {row.sku && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            SKU: {row.sku}
          </p>
        )}
      </div>

      {/* Gross revenue */}
      <div className="text-xs font-medium text-foreground text-right">
        ${grossVal.toFixed(2)}
      </div>

      {/* COGS input */}
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
          $
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={row.cogs ?? ""}
          onChange={(e) => onChange(row.lineItemId, e.target.value)}
          onBlur={() => onBlur(row)}
          placeholder="0.00"
          className="w-full bg-card border border-border rounded pl-5 pr-1 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Margin */}
      <div className="flex items-center justify-end">
        <MarginBadge
          salePrice={row.salePrice}
          shipping={row.shippingCollected}
          fees={row.ebayFees}
          cogs={row.cogs}
        />
      </div>

      {/* Net profit */}
      <div
        className={`text-xs font-medium text-right ${
          netVal == null
            ? "text-muted-foreground"
            : netVal >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-500 dark:text-red-400"
        }`}
      >
        {netVal == null
          ? "—"
          : `${netVal >= 0 ? "+" : ""}$${netVal.toFixed(2)}`}
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-center">
        {row.saving ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
        ) : row.dirty ? (
          <span className="w-2 h-2 rounded-full bg-amber-500" title="Unsaved" />
        ) : row.savedCogs != null ? (
          <CheckCircle2
            className="w-3.5 h-3.5 text-emerald-500"
            title="Backfilled"
          />
        ) : (
          <span
            className="w-2 h-2 rounded-full bg-muted-foreground/30"
            title="No COGS"
          />
        )}
      </div>
    </div>
  );
}
