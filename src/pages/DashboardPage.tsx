import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Eye, DollarSign, Package, RefreshCw, ExternalLink,
  AlertCircle, Loader2, X, LogOut, AlertTriangle, ChevronDown, ChevronUp,
  Search, SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, Pencil,
  Check, CheckSquare, Square, Tag, Clock, Hash, Heart,
  BarChart2, MousePointerClick, ShoppingCart, MessageSquare, Flame, TrendingDown, Minus,
  TrendingUp, Receipt, Truck, CircleDollarSign,
} from "lucide-react";
import { CompetitorPriceCard } from "@/components/CompetitorPriceCard";
import { useAuth } from "@/contexts/AuthContext";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigate } from "react-router-dom";
import BottomNav from "@/components/BottomNav";
import { supabase } from "@/integrations/supabase/client";
import teckstartLogo from "@/assets/teckstart-logo.png";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompetitorPriceSnapshot {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  priceDelta: number | null;
  competitorCount: number;
  priceDistribution: { min: number; max: number; count: number }[];
  fetchedAt: string;
}

interface EbayListing {
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  // Primary (30d) analytics — kept for backward compat / filters
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
  // Multi-window breakdowns
  views7d: number;
  views30d: number;
  views90d: number;
  impressions7d: number;
  impressions30d: number;
  impressions90d: number;
  transactions7d: number;
  transactions30d: number;
  transactions90d: number;
  // Trading API stats
  watchCount: number;
  questionCount: number;
  // Listing metadata
  listingId: string | null;
  ebayUrl: string | null;
  categoryId?: string;
  quantity?: number;
  format?: string;
  condition?: string;
  listingDate?: string | null;
  competitor?: CompetitorPriceSnapshot | null;
}

type SortField =
  | "title"
  | "price"
  | "views"
  | "impressions"
  | "watchCount"
  | "transactions"
  | "clickThroughRate"
  | "trend"
  | "listingDate"
  | "status";
type SortDir = "asc" | "desc";

// ─── Constants ────────────────────────────────────────────────────────────────

const EBAY_TOKEN_KEY = "ebay-user-token";

// ─── Trend score ──────────────────────────────────────────────────────────────
// Compare daily pace across windows:
//   pace7  = views7d / 7
//   pace30 = views30d / 30
//   pace90 = views90d / 90
// If pace7 > pace30 > pace90 → accelerating 🔥
// If pace7 < pace30 → decelerating 📉
// Otherwise → stable
function trendScore(l: EbayListing): number {
  const p7 = l.views7d / 7;
  const p30 = l.views30d / 30;
  const p90 = l.views90d / 90;
  // Weighted score: recent pace matters most
  return p7 * 3 + p30 * 2 + p90;
}

type TrendLabel = "hot" | "stable" | "stale" | "new";

function getTrend(l: EbayListing): TrendLabel {
  const p7 = l.views7d / 7;
  const p30 = l.views30d / 30;
  const p90 = l.views90d / 90;

  // Not enough data yet (very new listing or no analytics)
  if (l.views90d === 0 && l.views30d === 0 && l.views7d === 0) return "new";

  // Hot: 7d daily pace is at least 40% higher than 30d pace
  if (p30 > 0 && p7 >= p30 * 1.4) return "hot";

  // Stale: 7d daily pace is at least 40% lower than 30d pace
  if (p30 > 0 && p7 <= p30 * 0.6) return "stale";

  // Also stale if 30d pace dropped significantly from 90d pace
  if (p90 > 0 && p30 <= p90 * 0.6 && p7 <= p90 * 0.4) return "stale";

  return "stable";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const diff = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff}d ago`;
}

function statusLabel(status: string): string {
  if (status === "PUBLISHED" || status === "Active") return "Active";
  if (status === "UNPUBLISHED") return "Draft";
  return status;
}

function statusColor(status: string): string {
  const s = statusLabel(status);
  if (s === "Active") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (s === "Draft") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function fmtPct(val: number): string {
  if (!val) return "0%";
  return `${(val * 100).toFixed(1)}%`;
}

function fmtMoney(val: number): string {
  if (val === 0) return "$0.00";
  return `${val < 0 ? "-" : ""}$${Math.abs(val).toFixed(2)}`;
}

function fmtMoneyShort(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Trend Badge ──────────────────────────────────────────────────────────────

function TrendBadge({ listing }: { listing: EbayListing }) {
  const trend = getTrend(listing);
  if (trend === "new") return null;

  const configs = {
    hot: {
      icon: Flame,
      label: "Hot",
      cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    },
    stable: {
      icon: Minus,
      label: "Stable",
      cls: "bg-secondary text-muted-foreground",
    },
    stale: {
      icon: TrendingDown,
      label: "Stale",
      cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
  };

  const { icon: Icon, label, cls } = configs[trend];
  return (
    <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${cls}`}>
      <Icon className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ─── Views Trend Row ──────────────────────────────────────────────────────────

function ViewsTrendRow({ listing }: { listing: EbayListing }) {
  const p7 = listing.views7d / 7;
  const p30 = listing.views30d / 30;

  // Arrow indicator between 7d and 30d pace
  const paceArrow = p30 === 0
    ? null
    : p7 >= p30 * 1.2
    ? <ArrowUp className="w-2.5 h-2.5 text-emerald-500 flex-shrink-0" />
    : p7 <= p30 * 0.8
    ? <ArrowDown className="w-2.5 h-2.5 text-blue-400 flex-shrink-0" />
    : <Minus className="w-2.5 h-2.5 text-muted-foreground/50 flex-shrink-0" />;

  return (
    <div className="flex items-center gap-2 mt-1.5 text-[10px]">
      <span className="text-muted-foreground font-medium shrink-0">Views</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <span className="opacity-60">7d</span>
          <span className="font-semibold text-foreground ml-0.5">{listing.views7d.toLocaleString()}</span>
        </span>
        {paceArrow}
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <span className="opacity-60">30d</span>
          <span className="font-semibold text-foreground ml-0.5">{listing.views30d.toLocaleString()}</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <span className="opacity-60">90d</span>
          <span className="font-semibold text-foreground ml-0.5">{listing.views90d.toLocaleString()}</span>
        </span>
        {listing.impressions30d > 0 && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <BarChart2 className="w-2.5 h-2.5 opacity-60" />
              <span className="opacity-60">impr</span>
              <span className="font-semibold text-foreground ml-0.5">
                {listing.impressions30d > 999
                  ? `${(listing.impressions30d / 1000).toFixed(1)}k`
                  : listing.impressions30d}
              </span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline Price Editor ───────────────────────────────────────────────────────

interface PriceEditorProps {
  listing: EbayListing;
  onSaved: (offerId: string | null, listingId: string | null, newPrice: number) => void;
  userToken: string;
  userId: string;
}

function InlinePriceEditor({ listing, onSaved, userToken, userId }: PriceEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(listing.price.toFixed(2));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const newPrice = parseFloat(value);
    if (isNaN(newPrice) || newPrice <= 0) {
      toast.error("Enter a valid price greater than 0");
      return;
    }
    if (newPrice === listing.price) { setEditing(false); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-reprice", {
        body: {
          action: "single_update", userToken, userId,
          offerId: listing.offerId, sku: listing.sku,
          listingId: listing.listingId, newPrice, currency: listing.currency,
        },
      });
      if (error || !data?.success) {
        toast.error(`Price update failed: ${data?.error || error?.message || "Unknown error"}`);
      } else {
        toast.success(`Price updated to $${newPrice.toFixed(2)}`);
        onSaved(listing.offerId, listing.listingId, newPrice);
        setEditing(false);
      }
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(listing.price.toFixed(2)); setEditing(true); }}
        className="group flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
        title="Click to edit price"
      >
        ${listing.price.toFixed(2)}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-sm text-muted-foreground">$</span>
      <input
        type="number" step="0.01" min="0.01" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
        className="w-20 text-sm font-semibold border border-primary/50 rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
      {saving ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
        <>
          <button onClick={handleSave} className="text-emerald-600 hover:text-emerald-500 transition-colors"><Check className="w-4 h-4" /></button>
          <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
        </>
      )}
    </div>
  );
}

// ─── Bulk Price Modal ──────────────────────────────────────────────────────────

interface BulkPriceModalProps {
  selected: EbayListing[];
  onClose: () => void;
  onSuccess: (updates: Array<{ offerId: string | null; listingId: string | null; newPrice: number }>) => void;
  userToken: string;
  userId: string;
}

function BulkPriceModal({ selected, onClose, onSuccess, userToken, userId }: BulkPriceModalProps) {
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of selected) m[l.offerId || l.listingId || l.sku] = l.price.toFixed(2);
    return m;
  });
  const [adjustMode, setAdjustMode] = useState<"fixed" | "pct" | "amount">("fixed");
  const [adjustValue, setAdjustValue] = useState("");
  const [saving, setSaving] = useState(false);
  const key = (l: EbayListing) => l.offerId || l.listingId || l.sku;

  const applyAdjustment = () => {
    const adj = parseFloat(adjustValue);
    if (isNaN(adj)) return;
    const updated: Record<string, string> = {};
    for (const l of selected) {
      const k = key(l);
      const base = parseFloat(prices[k] || l.price.toFixed(2));
      let newVal = adjustMode === "pct" ? base * (1 + adj / 100) : adjustMode === "amount" ? base + adj : adj;
      updated[k] = Math.max(0.01, newVal).toFixed(2);
    }
    setPrices(updated);
  };

  const handleSave = async () => {
    const updates = selected.map((l) => ({
      offerId: l.offerId, sku: l.sku, listingId: l.listingId,
      newPrice: parseFloat(prices[key(l)] || l.price.toFixed(2)),
      currency: l.currency, title: l.title,
    }));
    for (const u of updates) {
      if (!u.newPrice || u.newPrice <= 0) { toast.error(`Invalid price for "${u.title?.substring(0, 30)}..."`); return; }
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("ebay-reprice", {
        body: { action: "bulk_update", userToken, userId, updates },
      });
      if (error) { toast.error(`Bulk update failed: ${error.message}`); return; }
      const { successCount, failCount, results } = data;
      if (successCount > 0) toast.success(`${successCount} listing${successCount !== 1 ? "s" : ""} updated successfully`);
      if (failCount > 0) {
        const failed = results?.filter((r: any) => !r.success) || [];
        toast.error(`${failCount} update${failCount !== 1 ? "s" : ""} failed: ${failed[0]?.error || "Unknown error"}`);
      }
      const successfulUpdates = updates.filter((u, i) => results?.[i]?.success !== false);
      onSuccess(successfulUpdates.map((u) => ({ offerId: u.offerId, listingId: u.listingId, newPrice: u.newPrice })));
      if (failCount === 0) onClose();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Bulk Price Update</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{selected.length} listing{selected.length !== 1 ? "s" : ""} selected</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 border-b border-border bg-secondary/30">
          <p className="text-xs font-medium text-muted-foreground mb-2">Quick adjust all prices</p>
          <div className="flex gap-2">
            <div className="flex border border-border rounded-lg overflow-hidden text-xs">
              {(["fixed", "pct", "amount"] as const).map((m) => (
                <button key={m} onClick={() => setAdjustMode(m)}
                  className={`px-2.5 py-1.5 transition-colors ${adjustMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
                  {m === "fixed" ? "Set $" : m === "pct" ? "% ±" : "$ ±"}
                </button>
              ))}
            </div>
            <input type="number" step="0.01" value={adjustValue} onChange={(e) => setAdjustValue(e.target.value)}
              placeholder={adjustMode === "pct" ? "e.g. 10 or -5" : "e.g. 49.99"}
              className="flex-1 text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            <button onClick={applyAdjustment} className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">Apply</button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {adjustMode === "fixed" && "Set all prices to this exact value"}
            {adjustMode === "pct" && "Raise (+) or lower (-) by percentage. e.g. -10 = 10% off"}
            {adjustMode === "amount" && "Add (+) or subtract (-) a dollar amount from each price"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {selected.map((l) => {
            const k = key(l);
            return (
              <div key={k} className="flex items-center gap-3">
                {l.imageUrl ? <img src={l.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" /> : <div className="w-10 h-10 rounded-lg bg-secondary flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground line-clamp-1">{l.title}</p>
                  <p className="text-[10px] text-muted-foreground">Current: ${l.price.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">$</span>
                  <input type="number" step="0.01" min="0.01" value={prices[k] || ""}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [k]: e.target.value }))}
                    className="w-20 text-sm font-semibold border border-border rounded px-1.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary text-right" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-medium border border-border rounded-xl text-foreground hover:bg-secondary transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Updating..." : `Update ${selected.length} Price${selected.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sort Button Helper ────────────────────────────────────────────────────────

function SortBtn({ field, label, current, dir, onSort }: {
  field: SortField; label: string; current: SortField; dir: SortDir; onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <button onClick={() => onSort(field)}
      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}>
      {label}
      {active ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

// ─── Stat Pill ─────────────────────────────────────────────────────────────────

function StatPill({ icon: Icon, value, label, highlight = false }: {
  icon: React.ElementType; value: string | number; label: string; highlight?: boolean;
}) {
  return (
    <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ${highlight ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"}`} title={label}>
      <Icon className="w-2.5 h-2.5 flex-shrink-0" />
      {value}
    </span>
  );
}

// ─── Main Dashboard Component ─────────────────────────────────────────────────

export default function DashboardPage() {
  const { drafts } = useDrafts();
  const { signOut, user, planFeatures } = useAuth();
  const navigate = useNavigate();

  const [listings, setListings] = useState<EbayListing[]>([]);
  const [orderCount7d, setOrderCount7d] = useState(0);
  const [orderCount30d, setOrderCount30d] = useState(0);
  const [orderCount90d, setOrderCount90d] = useState(0);

  // Financial summaries from Fulfillment API
  interface FinancialWindow {
    orders: number;
    revenue: number;
    shippingCollected: number;
    ebayFees: number;
    shippingLabels: number;
    netProfit: number;
  }
  const emptyFin = (): FinancialWindow => ({ orders: 0, revenue: 0, shippingCollected: 0, ebayFees: 0, shippingLabels: 0, netProfit: 0 });
  const [fin7, setFin7] = useState<FinancialWindow>(emptyFin());
  const [fin30, setFin30] = useState<FinancialWindow>(emptyFin());
  const [fin90, setFin90] = useState<FinancialWindow>(emptyFin());
  const [salesProfitWindow, setSalesProfitWindow] = useState<"7d"|"30d"|"90d">("30d");
  const [loading, setLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState("");
  const [ebayAccount, setEbayAccount] = useState<{ username: string; businessName: string } | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [spotPrices, setSpotPrices] = useState<{ gold: number; silver: number; platinum: number } | null>(null);
  const [meltAlertOpen, setMeltAlertOpen] = useState(true);
  const [ebayToken, setEbayToken] = useState<string>("");

  // Sorting & filtering
  const [sortField, setSortField] = useState<SortField>("listingDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [filterMinPrice, setFilterMinPrice] = useState("");
  const [filterMaxPrice, setFilterMaxPrice] = useState("");
  const [filterMinViews, setFilterMinViews] = useState("");
  const [filterMaxViews, setFilterMaxViews] = useState("");
  const [filterMinWatchers, setFilterMinWatchers] = useState("");
  const [filterMinImpressions, setFilterMinImpressions] = useState("");
  const [filterHasSales, setFilterHasSales] = useState(false);
  const [filterTrend, setFilterTrend] = useState<"all" | "hot" | "stable" | "stale">("all");
  const [showFilters, setShowFilters] = useState(false);

  // Selection & bulk edit
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Fetch spot prices
  useEffect(() => {
    const metalDrafts = drafts.filter((d) => d.ebayListingId && d.metalType && d.metalType !== "none" && (d.metalWeightOz ?? 0) > 0);
    if (metalDrafts.length === 0 || spotPrices) return;
    supabase.functions.invoke("spot-prices", { body: { metalType: "gold", weightOz: 1 } })
      .then(({ data }) => { if (data?.spotPrices) setSpotPrices(data.spotPrices); })
      .catch(() => {});
  }, [drafts, spotPrices]);

  const fetchListings = useCallback(async () => {
    let token: string | null = null;
    if (user?.id) {
      try {
        const { data: tokenData } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (tokenData?.token) {
          token = tokenData.token;
          localStorage.setItem(EBAY_TOKEN_KEY, token!);
          setEbayToken(token!);
        }
        if (tokenData?.isExpired) {
          localStorage.removeItem(EBAY_TOKEN_KEY);
          setNeedsAuth(true); setEbayAccount(null); setListings([]);
          toast.error("eBay session expired. Please reconnect in Settings.");
          return;
        }
      } catch { /* fall through */ }
    }
    if (!token) token = localStorage.getItem(EBAY_TOKEN_KEY);
    if (token) setEbayToken(token);
    if (!token) { setNeedsAuth(true); setEbayAccount(null); setListings([]); return; }

    setLoading(true); setError("");
    const userPromise = supabase.functions.invoke("ebay-user", { body: { userToken: token } });

    try {
      const { data, error: fnError } = await supabase.functions.invoke("ebay-listings", {
        body: { userToken: token },
      });

      if (fnError || data?.needsAuth) {
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true); setListings([]); setEbayAccount(null);
        toast.error("eBay connection expired. Please reconnect in Settings.");
        return;
      }
      if (data?.warning) { setListings([]); setNeedsAuth(false); toast.error(data.warning); return; }
      if (data?.error) {
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true); setListings([]); setEbayAccount(null);
        toast.error(`eBay error: ${data.error}`);
        return;
      }

      const rawListings: EbayListing[] = data.listings || [];
      // Capture real order counts + financial data from Fulfillment API
      if (typeof data.orderCount30d === "number") setOrderCount30d(data.orderCount30d);
      if (typeof data.orderCount7d === "number") setOrderCount7d(data.orderCount7d);
      if (typeof data.orderCount90d === "number") setOrderCount90d(data.orderCount90d);
      if (data.financial?.w7) setFin7(data.financial.w7);
      if (data.financial?.w30) setFin30(data.financial.w30);
      if (data.financial?.w90) setFin90(data.financial.w90);

      // Fetch competitor prices
      let competitorMap: Record<string, CompetitorPriceSnapshot> = {};
      if (user?.id && rawListings.length > 0) {
        try {
          const listingIds = rawListings.map((l) => l.listingId).filter(Boolean) as string[];
          if (listingIds.length > 0) {
            const { data: cpData } = await supabase
              .from("competitor_prices")
              .select("ebay_listing_id, avg_price, min_price, max_price, median_price, price_delta, competitor_count, price_distribution, fetched_at")
              .eq("user_id", user.id)
              .in("ebay_listing_id", listingIds)
              .order("fetched_at", { ascending: false });
            for (const row of cpData ?? []) {
              if (!competitorMap[row.ebay_listing_id]) {
                competitorMap[row.ebay_listing_id] = {
                  avgPrice: row.avg_price, minPrice: row.min_price, maxPrice: row.max_price,
                  medianPrice: row.median_price, priceDelta: row.price_delta,
                  competitorCount: row.competitor_count, priceDistribution: row.price_distribution ?? [],
                  fetchedAt: row.fetched_at,
                };
              }
            }
          }
        } catch (cpErr) { console.warn("Competitor prices non-fatal:", cpErr); }
      }

      const enriched: EbayListing[] = rawListings.map((l) => ({
        ...l,
        competitor: l.listingId ? (competitorMap[l.listingId] ?? null) : null,
      }));

      setListings(enriched);
      setNeedsAuth(false);

      const { data: userData } = await userPromise;
      if (userData?.username) setEbayAccount({ username: userData.username, businessName: userData.businessName || "" });
      toast.success(`Refreshed! ${enriched.length} listings loaded`);
    } catch (err: any) {
      setError(err.message || "Failed to load listings");
      toast.error("Failed to refresh listings");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // ── Sort handler ──────────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  // ── Filtered + sorted listings ────────────────────────────────────────────────
  const clearFilters = () => {
    setSearchQuery(""); setFilterStatus("all");
    setFilterMinPrice(""); setFilterMaxPrice("");
    setFilterMinViews(""); setFilterMaxViews("");
    setFilterMinWatchers(""); setFilterMinImpressions("");
    setFilterHasSales(false); setFilterTrend("all");
  };

  const filteredListings = useMemo(() => {
    let list = [...listings];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((l) => l.title.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || (l.listingId || "").includes(q));
    }
    if (filterStatus === "active") list = list.filter((l) => l.status === "PUBLISHED" || l.status === "Active" || l.status === "ACTIVE");
    else if (filterStatus === "inactive") list = list.filter((l) => l.status !== "PUBLISHED" && l.status !== "Active" && l.status !== "ACTIVE");

    const minP = parseFloat(filterMinPrice); const maxP = parseFloat(filterMaxPrice);
    if (!isNaN(minP)) list = list.filter((l) => l.price >= minP);
    if (!isNaN(maxP)) list = list.filter((l) => l.price <= maxP);

    const minV = parseFloat(filterMinViews); const maxV = parseFloat(filterMaxViews);
    if (!isNaN(minV)) list = list.filter((l) => l.views30d >= minV);
    if (!isNaN(maxV)) list = list.filter((l) => l.views30d <= maxV);

    const minW = parseFloat(filterMinWatchers);
    if (!isNaN(minW)) list = list.filter((l) => l.watchCount >= minW);

    const minI = parseFloat(filterMinImpressions);
    if (!isNaN(minI)) list = list.filter((l) => l.impressions30d >= minI);

    if (filterHasSales) list = list.filter((l) => l.transactions30d > 0);
    if (filterTrend !== "all") list = list.filter((l) => getTrend(l) === filterTrend);

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "price") cmp = a.price - b.price;
      else if (sortField === "views") cmp = a.views30d - b.views30d;
      else if (sortField === "impressions") cmp = a.impressions30d - b.impressions30d;
      else if (sortField === "watchCount") cmp = a.watchCount - b.watchCount;
      else if (sortField === "transactions") cmp = a.transactions30d - b.transactions30d;
      else if (sortField === "clickThroughRate") cmp = a.clickThroughRate - b.clickThroughRate;
      else if (sortField === "trend") cmp = trendScore(a) - trendScore(b);
      else if (sortField === "title") cmp = a.title.localeCompare(b.title);
      else if (sortField === "status") cmp = statusLabel(a.status).localeCompare(statusLabel(b.status));
      else if (sortField === "listingDate") {
        const da = a.listingDate ? new Date(a.listingDate).getTime() : 0;
        const db = b.listingDate ? new Date(b.listingDate).getTime() : 0;
        cmp = da - db;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [listings, searchQuery, filterStatus, filterMinPrice, filterMaxPrice,
      filterMinViews, filterMaxViews, filterMinWatchers, filterMinImpressions,
      filterHasSales, filterTrend, sortField, sortDir]);

  // ── Selection helpers ─────────────────────────────────────────────────────────
  const listingKey = (l: EbayListing) => l.offerId || l.listingId || l.sku;
  const toggleSelect = (l: EbayListing) => {
    const k = listingKey(l);
    setSelectedIds((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredListings.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredListings.map(listingKey)));
  };
  const selectedListings = filteredListings.filter((l) => selectedIds.has(listingKey(l)));

  // ── Price update callbacks ────────────────────────────────────────────────────
  const handlePriceSaved = (offerId: string | null, listingId: string | null, newPrice: number) => {
    setListings((prev) => prev.map((l) => {
      if (offerId && l.offerId === offerId) return { ...l, price: newPrice };
      if (listingId && l.listingId === listingId) return { ...l, price: newPrice };
      return l;
    }));
  };
  const handleBulkSuccess = (updates: Array<{ offerId: string | null; listingId: string | null; newPrice: number }>) => {
    setListings((prev) => prev.map((l) => {
      const match = updates.find((u) => (u.offerId && u.offerId === l.offerId) || (u.listingId && u.listingId === l.listingId));
      return match ? { ...l, price: match.newPrice } : l;
    }));
    setSelectedIds(new Set());
  };

  // ── Aggregate stats ───────────────────────────────────────────────────────────
  const activeListings = listings.filter((l) => l.status === "PUBLISHED" || l.status === "Active" || l.status === "ACTIVE");
  const totalViews30d = listings.reduce((sum, l) => sum + (l.views30d || 0), 0);
  const totalViews7d = listings.reduce((sum, l) => sum + (l.views7d || 0), 0);
  const totalViews90d = listings.reduce((sum, l) => sum + (l.views90d || 0), 0);
  const totalWatches = listings.reduce((sum, l) => sum + (l.watchCount || 0), 0);
  // Use real order counts from Fulfillment API (not the Analytics API per-listing TRANSACTION metric
  // which only counts active listings and misses sold/completed items)
  const totalTransactions30d = orderCount30d;
  const liveValue = listings.reduce((sum, l) => sum + l.price, 0);
  const draftValue = drafts.reduce((sum, d) => sum + (d.priceMin + d.priceMax) / 2, 0);

  // Melt floor alerts
  const atRiskListings = spotPrices
    ? listings.flatMap((listing) => {
        const draft = drafts.find((d) => d.ebayListingId === listing.listingId);
        if (!draft || !draft.metalType || draft.metalType === "none" || !(draft.metalWeightOz ?? 0)) return [];
        const key = draft.metalType.toLowerCase() as keyof typeof spotPrices;
        const meltFloor = spotPrices[key] * (draft.metalWeightOz ?? 0);
        if (!meltFloor || listing.price >= meltFloor) return [];
        return [{ listing, meltFloor, delta: meltFloor - listing.price }];
      })
    : [];

  const hasActiveFilters = searchQuery || filterStatus !== "all" || filterMinPrice || filterMaxPrice
    || filterMinViews || filterMaxViews || filterMinWatchers || filterMinImpressions
    || filterHasSales || filterTrend !== "all";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={teckstartLogo} alt="Teckstart" className="h-12 w-auto" />
            <div>
              <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
              {ebayAccount ? (
                <p className="text-xs text-muted-foreground">
                  Connected as <span className="font-medium text-foreground">{ebayAccount.businessName || ebayAccount.username}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">eBay performance overview</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={fetchListings} disabled={loading}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50" title="Refresh listings">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button onClick={signOut} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-5">
        {/* Setup: Connect eBay */}
        {needsAuth && !setupDismissed && (
          <div className="bg-accent/50 border border-accent rounded-xl p-4 flex items-start justify-between gap-4">
            <div className="flex-1 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Setup: Connect eBay</p>
                <p className="text-xs text-muted-foreground">
                  Step 1 of 1 —{" "}
                  <button onClick={() => navigate("/settings?tab=integrations")} className="text-primary font-medium hover:underline">Go to Settings</button>
                </p>
              </div>
            </div>
            <button onClick={() => setSetupDismissed(true)} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Summary Cards — 2×3 */}
        <div className="grid grid-cols-2 gap-3">
          {/* Inventory value */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Total Inventory</span>
            </div>
            <p className="text-xl font-bold text-foreground">${(liveValue + draftValue).toFixed(2)}</p>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary" />Live ${liveValue.toFixed(2)}</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />Drafts ${draftValue.toFixed(2)}</span>
            </div>
          </div>

          {/* Views — all 3 windows (Pro/Shop only) */}
          {planFeatures.hasListingAnalytics ? (
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Views</span>
            </div>
            <p className="text-xl font-bold text-foreground">{totalViews30d.toLocaleString()}</p>
            <div className="flex gap-2 text-[10px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-0.5"><span className="opacity-60">7d</span> <span className="font-medium text-foreground">{totalViews7d.toLocaleString()}</span></span>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5"><span className="opacity-60">30d</span> <span className="font-medium text-foreground">{totalViews30d.toLocaleString()}</span></span>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5"><span className="opacity-60">90d</span> <span className="font-medium text-foreground">{totalViews90d.toLocaleString()}</span></span>
            </div>
          </div>
          ) : (
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Views</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Upgrade to Pro for listing analytics</p>
          </div>
          )}

          {/* Watchers (Pro/Shop only) */}
          {planFeatures.hasListingAnalytics ? (
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Heart className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Total Watchers</span>
            </div>
            <p className="text-xl font-bold text-foreground">{totalWatches.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Across all listings</p>
          </div>
          ) : (
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Heart className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Watchers</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Upgrade to Pro</p>
          </div>
          )}

          {/* Transactions */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ShoppingCart className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Transactions</span>
            </div>
            <p className="text-xl font-bold text-foreground">{totalTransactions30d.toLocaleString()}</p>
            <div className="flex gap-2 text-[10px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-0.5"><span className="opacity-60">7d</span> <span className="font-medium text-foreground">{orderCount7d.toLocaleString()}</span></span>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5"><span className="opacity-60">90d</span> <span className="font-medium text-foreground">{orderCount90d.toLocaleString()}</span></span>
            </div>
          </div>

          {/* Active listings */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Package className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Active Listings</span>
            </div>
            <p className="text-xl font-bold text-foreground">{activeListings.length}</p>
            <p className="text-[10px] text-muted-foreground">{listings.length} total on eBay</p>
          </div>

          {/* Drafts */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Drafts</span>
            </div>
            <p className="text-xl font-bold text-foreground">{drafts.length}</p>
            <p className="text-[10px] text-muted-foreground">Ready to publish</p>
          </div>
        </div>

        {/* ── Sales & Profit Card ─────────────────────────────────────────── */}
        {(fin30.revenue > 0 || fin90.revenue > 0 || loading) && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Header row */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="text-[10px] font-medium uppercase tracking-wide">Sales & Profit</span>
            </div>
            {/* Window tabs */}
            <div className="flex items-center gap-1 text-[10px]">
              {([
                { label: "7d",  fin: fin7  },
                { label: "30d", fin: fin30 },
                { label: "90d", fin: fin90 },
              ] as const).map(({ label }) => (
                <button
                  key={label}
                  onClick={() => setSalesProfitWindow(label as "7d"|"30d"|"90d")}
                  className={`px-2 py-0.5 rounded-md transition-colors font-medium ${
                    salesProfitWindow === label
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Active window data */}
          {(() => {
            const fin = salesProfitWindow === "7d" ? fin7 : salesProfitWindow === "90d" ? fin90 : fin30;
            const profitColor = fin.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400";
            const profitBg   = fin.netProfit >= 0 ? "bg-emerald-500/10" : "bg-red-500/10";
            return (
              <>
                {/* Big profit number */}
                <div className="px-4 pb-3">
                  <p className={`text-2xl font-bold ${profitColor}`}>{fmtMoney(fin.netProfit)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Net profit ({salesProfitWindow}) · {fin.orders} sale{fin.orders !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Breakdown rows */}
                <div className="border-t border-border divide-y divide-border">
                  {/* Sales Revenue */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CircleDollarSign className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span>Sales revenue</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-foreground">{fmtMoney(fin.revenue)}</span>
                      {fin.shippingCollected > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1.5">
                          +{fmtMoney(fin.shippingCollected)} shipping
                        </span>
                      )}
                    </div>
                  </div>

                  {/* eBay Fees */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Receipt className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span>eBay fees</span>
                    </div>
                    <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {fin.ebayFees > 0 ? `–${fmtMoney(fin.ebayFees)}` : fmtMoney(0)}
                    </span>
                  </div>

                  {/* Shipping Labels */}
                  {fin.shippingLabels > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Truck className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                      <span>Shipping labels</span>
                    </div>
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                      –{fmtMoney(fin.shippingLabels)}
                    </span>
                  </div>
                  )}

                  {/* Net Profit summary row */}
                  <div className={`flex items-center justify-between px-4 py-2.5 ${profitBg}`}>
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <TrendingUp className={`w-3.5 h-3.5 flex-shrink-0 ${profitColor}`} />
                      <span>Net profit</span>
                      <span className="text-[10px] font-normal text-muted-foreground">(excl. COGS)</span>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-bold ${profitColor}`}>{fmtMoney(fin.netProfit)}</span>
                      {(fin.revenue + fin.shippingCollected) > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-1.5">
                          {(fin.netProfit / (fin.revenue + fin.shippingCollected) * 100).toFixed(1)}% margin
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mini sparkline-style 7d/30d/90d comparison */}
                <div className="px-4 py-2.5 bg-secondary/30 flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] text-muted-foreground font-medium shrink-0">Net profit:</span>
                  {[
                    { label: "7d",  val: fin7.netProfit  },
                    { label: "30d", val: fin30.netProfit },
                    { label: "90d", val: fin90.netProfit },
                  ].map(({ label, val }) => (
                    <span key={label} className="flex items-center gap-0.5 text-[10px]">
                      <span className="text-muted-foreground opacity-60">{label}</span>
                      <span className={`font-semibold ml-0.5 ${val >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                        {fmtMoneyShort(val)}
                      </span>
                    </span>
                  ))}
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground italic">excl. cost of goods</span>
                </div>
              </>
            );
          })()}
        </div>
        )}

        {/* Melt Floor Alerts */}
        {atRiskListings.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl overflow-hidden">
            <button onClick={() => setMeltAlertOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                  {atRiskListings.length} listing{atRiskListings.length !== 1 ? "s" : ""} below melt floor
                </span>
              </div>
              {meltAlertOpen ? <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />}
            </button>
            {meltAlertOpen && (
              <div className="px-4 pb-3 space-y-2">
                <p className="text-xs text-amber-700/80 dark:text-amber-300/80">Spot prices have moved — these listings are priced below their precious metal melt value.</p>
                {atRiskListings.map(({ listing, meltFloor, delta }) => (
                  <div key={listing.offerId || listing.listingId} className="flex items-center justify-between gap-2 text-xs bg-amber-500/10 rounded-lg px-3 py-2">
                    <p className="text-foreground font-medium line-clamp-1 flex-1">{listing.title}</p>
                    <div className="flex-shrink-0 text-right space-y-0.5">
                      <p className="text-amber-700 dark:text-amber-300 font-semibold">Listed ${listing.price.toFixed(2)} · Melt ${meltFloor.toFixed(2)}</p>
                      <p className="text-amber-600/80 dark:text-amber-400/80">${delta.toFixed(2)} below floor</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Auth Warning */}
        {needsAuth && (
          <div className="bg-accent/50 border border-accent rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">eBay not connected</p>
              <p className="text-xs text-muted-foreground mt-0.5">Connect your eBay account in Settings to see listings and traffic data.</p>
              <button onClick={() => navigate("/settings?tab=integrations")} className="mt-2 text-xs font-medium text-primary hover:underline">Go to Integrations →</button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* ── Listings Section ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Section header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">eBay Listings</h2>
              {listings.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                  {filteredListings.length}{filteredListings.length !== listings.length ? ` / ${listings.length}` : ""}
                </span>
              )}
              {needsAuth && (
                <button onClick={() => navigate("/settings?tab=integrations")}
                  className="px-2.5 py-0.5 rounded-full bg-destructive/20 text-destructive text-xs font-medium hover:bg-destructive/30 transition-colors flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 bg-destructive rounded-full" />Disconnected
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {selectedIds.size > 0 && (
                <button onClick={() => setShowBulkModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                  <Tag className="w-3.5 h-3.5" />Edit {selectedIds.size} Price{selectedIds.size !== 1 ? "s" : ""}
                </button>
              )}
              <button onClick={() => setShowFilters((v) => !v)}
                className={`flex items-center gap-1 p-1.5 rounded-lg text-xs transition-colors ${showFilters || hasActiveFilters ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                title="Filters & sort">
                <SlidersHorizontal className="w-4 h-4" />
                {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            </div>
          </div>

          {/* Filter / Sort Panel */}
          {showFilters && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input type="text" placeholder="Search title, SKU, listing ID…" value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs bg-secondary border border-transparent rounded-lg focus:outline-none focus:ring-1 focus:ring-primary" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>

              {/* Status + Price */}
              <div className="flex flex-wrap gap-3">
                <div className="flex-1 min-w-[120px]">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 block">Status</label>
                  <div className="flex border border-border rounded-lg overflow-hidden text-xs">
                    {(["all", "active", "inactive"] as const).map((s) => (
                      <button key={s} onClick={() => setFilterStatus(s)}
                        className={`flex-1 py-1.5 capitalize transition-colors ${filterStatus === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>{s}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-end gap-1.5">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 block">Min $</label>
                    <input type="number" min="0" placeholder="0" value={filterMinPrice} onChange={(e) => setFilterMinPrice(e.target.value)}
                      className="w-20 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <span className="text-muted-foreground text-xs pb-1.5">–</span>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 block">Max $</label>
                    <input type="number" min="0" placeholder="∞" value={filterMaxPrice} onChange={(e) => setFilterMaxPrice(e.target.value)}
                      className="w-20 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              </div>

              {/* Engagement filters — Pro/Shop only */}
              {planFeatures.hasListingAnalytics ? (
              <div className="space-y-2">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Engagement filters</p>
                {/* Quick presets */}
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { label: "Zero views", active: filterMaxViews === "0" && filterMinViews === "", action: () => { setFilterMinViews(""); setFilterMaxViews(filterMaxViews === "0" ? "" : "0"); } },
                    { label: "Has views", active: filterMinViews === "1" && filterMaxViews === "", action: () => { setFilterMinViews(filterMinViews === "1" ? "" : "1"); setFilterMaxViews(""); } },
                    { label: "Has watchers", active: filterMinWatchers === "1", action: () => setFilterMinWatchers(filterMinWatchers === "1" ? "" : "1") },
                    { label: "Has sales", active: filterHasSales, action: () => setFilterHasSales(!filterHasSales) },
                  ]).map(({ label, active, action }) => (
                    <button key={label} onClick={action}
                      className={`px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {/* Trend filter */}
                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Trend</label>
                  <div className="flex border border-border rounded-lg overflow-hidden text-xs">
                    {(["all", "hot", "stable", "stale"] as const).map((t) => (
                      <button key={t} onClick={() => setFilterTrend(t)}
                        className={`flex-1 py-1.5 capitalize transition-colors ${filterTrend === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}>
                        {t === "hot" ? "🔥 Hot" : t === "stale" ? "📉 Stale" : t === "stable" ? "— Stable" : "All"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Custom stat ranges */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Min views (30d)</label>
                    <input type="number" min="0" placeholder="0" value={filterMinViews} onChange={(e) => setFilterMinViews(e.target.value)}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Max views (30d)</label>
                    <input type="number" min="0" placeholder="∞" value={filterMaxViews} onChange={(e) => setFilterMaxViews(e.target.value)}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Min watchers</label>
                    <input type="number" min="0" placeholder="0" value={filterMinWatchers} onChange={(e) => setFilterMinWatchers(e.target.value)}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Min impressions (30d)</label>
                    <input type="number" min="0" placeholder="0" value={filterMinImpressions} onChange={(e) => setFilterMinImpressions(e.target.value)}
                      className="w-full text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                  </div>
                </div>
              </div>
              ) : (
              <div className="bg-muted/50 border border-border rounded-lg px-4 py-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Engagement Filters</p>
                <p className="text-xs text-muted-foreground mt-1">Upgrade to Pro ($49/mo) to filter by views, watchers, trends, and more.</p>
              </div>
              )}

              {/* Sort */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Sort by</p>
                <div className="flex flex-wrap gap-1.5">
                  <SortBtn field="listingDate" label="Date" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="price" label="Price" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="trend" label="🔥 Trend" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="views" label="Views" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="impressions" label="Impressions" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="watchCount" label="Watchers" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="transactions" label="Sales" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="clickThroughRate" label="CTR" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="title" label="Title" current={sortField} dir={sortDir} onSort={handleSort} />
                  <SortBtn field="status" label="Status" current={sortField} dir={sortDir} onSort={handleSort} />
                </div>
              </div>

              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">Clear all filters</button>
              )}
            </div>
          )}

          {/* Select all bar */}
          {filteredListings.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {selectedIds.size === filteredListings.length && filteredListings.length > 0
                  ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                {selectedIds.size === filteredListings.length && filteredListings.length > 0 ? "Deselect all" : `Select all (${filteredListings.length})`}
              </button>
              {selectedIds.size > 0 && <span className="text-xs text-muted-foreground">· {selectedIds.size} selected</span>}
            </div>
          )}

          {/* Listing cards */}
          {loading && listings.length === 0 ? (
            <div className="text-center py-12">
              <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Loading listings…</p>
            </div>
          ) : filteredListings.length === 0 && !needsAuth ? (
            <div className="text-center py-12 space-y-2">
              <Package className="w-8 h-8 text-muted-foreground/50 mx-auto" />
              <p className="text-sm text-muted-foreground">{hasActiveFilters ? "No listings match your filters." : "No listings found on eBay yet."}</p>
              {hasActiveFilters && <button onClick={clearFilters} className="text-xs text-primary hover:underline">Clear filters</button>}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredListings.map((listing) => {
                const k = listingKey(listing);
                const isSelected = selectedIds.has(k);
                return (
                  <div key={k} className={`bg-card border rounded-xl p-3 flex gap-3 transition-colors ${isSelected ? "border-primary/50 bg-primary/5" : "border-border"}`}>
                    {/* Checkbox */}
                    <button onClick={() => toggleSelect(listing)} className="flex-shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors">
                      {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                    </button>

                    {/* Image */}
                    {listing.imageUrl ? (
                      <img src={listing.imageUrl} alt={listing.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <Package className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Title + Status + Trend */}
                      <div className="flex items-start gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground line-clamp-1 flex-1">{listing.title}</p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {planFeatures.hasListingAnalytics && <TrendBadge listing={listing} />}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColor(listing.status)}`}>
                            {statusLabel(listing.status)}
                          </span>
                        </div>
                      </div>

                      {/* Price + external link */}
                      <div className="flex items-center gap-3 mt-1.5">
                        <InlinePriceEditor listing={listing} onSaved={handlePriceSaved} userToken={ebayToken} userId={user?.id || ""} />
                        {listing.ebayUrl && (
                          <a href={listing.ebayUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-xs text-primary hover:underline">
                            <ExternalLink className="w-3 h-3" />View
                          </a>
                        )}
                      </div>

                      {/* 3-window views trend row — Pro/Shop only */}
                      {planFeatures.hasListingAnalytics && <ViewsTrendRow listing={listing} />}

                      {/* Other live stats — Pro/Shop only */}
                      {planFeatures.hasListingAnalytics ? (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {listing.watchCount > 0 && (
                          <StatPill icon={Heart} value={listing.watchCount} label="Watchers" highlight />
                        )}
                        {listing.transactions30d > 0 && (
                          <StatPill icon={ShoppingCart} value={`${listing.transactions7d}/${listing.transactions30d}/${listing.transactions90d}`} label="Sales 7d/30d/90d" highlight />
                        )}
                        {listing.clickThroughRate > 0 && (
                          <StatPill icon={MousePointerClick} value={fmtPct(listing.clickThroughRate)} label="Click-through rate (30d)" />
                        )}
                        {listing.questionCount > 0 && (
                          <StatPill icon={MessageSquare} value={listing.questionCount} label="Questions" />
                        )}
                      </div>
                      ) : (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Upgrade to Pro for listing analytics
                      </p>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                        {listing.sku && listing.sku !== listing.listingId && (
                          <span className="flex items-center gap-0.5"><Hash className="w-2.5 h-2.5" />{listing.sku}</span>
                        )}
                        {listing.format && (
                          <span className="flex items-center gap-0.5">
                            <Tag className="w-2.5 h-2.5" />
                            {listing.format === "FIXED_PRICE" ? "BIN" : listing.format === "AUCTION" ? "Auction" : listing.format}
                          </span>
                        )}
                        {listing.condition && <span>{listing.condition}</span>}
                        {listing.listingDate && (
                          <span className="flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{daysAgo(listing.listingDate)}</span>
                        )}
                        {listing.categoryId && <span className="flex items-center gap-0.5 opacity-60">Cat. {listing.categoryId}</span>}
                      </div>

                      {/* Competitor Price Card */}
                      {listing.listingId && (
                        <CompetitorPriceCard
                          listingId={listing.listingId} title={listing.title}
                          yourPrice={listing.price} ebayUrl={listing.ebayUrl}
                          competitor={listing.competitor}
                          onRefreshed={(snapshot) =>
                            setListings((prev) => prev.map((l) => l.listingId === listing.listingId ? { ...l, competitor: snapshot } : l))
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bulk Price Modal */}
      {showBulkModal && (
        <BulkPriceModal selected={selectedListings} onClose={() => setShowBulkModal(false)}
          onSuccess={handleBulkSuccess} userToken={ebayToken} userId={user?.id || ""} />
      )}

      <BottomNav />
    </div>
  );
}