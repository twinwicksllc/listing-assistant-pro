/**
 * DashboardPage2 — V2 Styled Dashboard
 *
 * Full feature parity with original DashboardPage:
 *   - Correct eBay token flow (ebay-publish → get_stored_token → ebay-listings)
 *   - Competitor prices loaded from supabase competitor_prices table
 *   - OptimizationQueueWidget above listings
 *   - Cards / Pricing view toggle
 *   - PricingInsightsTable with per-listing + bulk refresh
 *   - RepriceManagerPanel in pricing mode
 *   - CompetitorPriceCard on each listing card
 *   - Search + filters + sort
 *   - All wrapped in v2 AppShell with gradient bg and card styling
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Eye, DollarSign, RefreshCw, ExternalLink,
  AlertCircle, Loader2, X, Search,
  SlidersHorizontal, Heart, ShoppingCart,
  Flame, TrendingDown, Minus, Package,
  Hash, Tag, Clock, LayoutDashboard,
  CheckSquare, Square, MousePointerClick,
  TrendingUp, Receipt, Truck, RotateCcw,
  Store, ShieldAlert, BadgeCheck, CircleDollarSign,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AppShell from "@/v2/components/AppShell";
import { COLORS, cardStyle, inputStyle } from "@/v2/theme";
import { CompetitorPriceCard } from "@/components/CompetitorPriceCard";
import ProfitBadge from "@/components/ProfitBadge";
import { PricingInsightsTable } from "@/components/PricingInsightsTable";
import { RepriceManagerPanel } from "@/components/RepriceManagerPanel";
import ListingDetailModal, { ListingDetailData } from "@/v2/components/ListingDetailModal";

// ─── Constants ────────────────────────────────────────────────────────

const EBAY_TOKEN_KEY = "ebay-user-token";
const BULK_REFRESH_COOLDOWN_KEY = "competitor_bulk_refresh_until";
const BULK_REFRESH_COOLDOWN_MS = 8 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────

interface CompetitorPriceSnapshot {
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  priceDelta: number | null;
  competitorCount: number;
  priceDistribution: { min: number; max: number; count: number }[];
  fetchedAt: string;
  cacheExpiresAt?: string | null;
  searchQuery?: string | null;
}

interface EbayListing {
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  price: number;
  currency: string;
  status: string;
  views: number;
  impressions: number;
  clickThroughRate: number;
  salesConversionRate: number;
  transactions: number;
  views7d: number;
  views30d: number;
  views90d: number;
  impressions7d: number;
  impressions30d: number;
  impressions90d: number;
  transactions7d: number;
  transactions30d: number;
  transactions90d: number;
  watchCount: number;
  questionCount: number;
  listingId: string | null;
  ebayUrl: string | null;
  categoryId?: string;
  quantity?: number;
  format?: string;
  condition?: string;
  listingDate?: string | null;
  competitor?: CompetitorPriceSnapshot | null;
}

type SortField = "title" | "price" | "views" | "impressions" | "watchCount" | "transactions" | "trend" | "listingDate" | "status";
type SortDir = "asc" | "desc";
type TrendLabel = "hot" | "stable" | "stale" | "new";
type ViewMode = "cards" | "pricing";
type ProfitWindow = "7d" | "30d" | "90d";

interface FinancialWindow {
  orders: number;
  revenue: number;
  shippingCollected: number;
  ebayFees: number;
  shippingLabels: number;
  refunds: number;
  nonSaleCharges: number;
  disputes: number;
  credits: number;
  cogsTotal: number;
  netProfit: number;
}

const emptyFin = (): FinancialWindow => ({
  orders: 0, revenue: 0, shippingCollected: 0, ebayFees: 0,
  shippingLabels: 0, refunds: 0, nonSaleCharges: 0, disputes: 0,
  credits: 0, cogsTotal: 0, netProfit: 0,
});

// ─── Helpers ──────────────────────────────────────────────────────────

function trendScore(l: EbayListing): number {
  return (l.views7d / 7) * 3 + (l.views30d / 30) * 2 + l.views90d / 90;
}

function getTrend(l: EbayListing): TrendLabel {
  const p7 = l.views7d / 7, p30 = l.views30d / 30, p90 = l.views90d / 90;
  if (l.views90d === 0 && l.views30d === 0 && l.views7d === 0) return "new";
  if (p30 > 0 && p7 >= p30 * 1.4) return "hot";
  if (p30 > 0 && p7 <= p30 * 0.6) return "stale";
  if (p90 > 0 && p30 <= p90 * 0.6 && p7 <= p90 * 0.4) return "stale";
  return "stable";
}

function daysAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";
  const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1 day ago";
  return `${diff}d ago`;
}

function statusLabel(s: string): string {
  if (s === "PUBLISHED" || s === "Active") return "Active";
  if (s === "UNPUBLISHED") return "Draft";
  return s;
}

function fmtPct(val: number): string {
  return `${(val * 100).toFixed(1)}%`;
}

function listingKey(l: EbayListing) {
  return l.listingId ?? l.offerId ?? l.sku;
}

// ─── Styles ──────────────────────────────────────────────────────────

const BRAND = COLORS.brand;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: COLORS.pageBg,
  backgroundAttachment: "fixed",
  fontFamily: FONT,
};

const contentStyle: React.CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
  padding: "2rem 2rem 4rem",
};

const sectionCard: React.CSSProperties = {
  ...cardStyle,
  marginBottom: "1.25rem",
  overflow: "hidden",
};

const cardHeader: React.CSSProperties = {
  padding: "0.875rem 1.25rem",
  borderBottom: "1px solid #E8EEF5",
  background: "linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const cardBody: React.CSSProperties = {
  padding: "1.25rem",
};

const statGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "1rem",
  marginBottom: "1.25rem",
};

const statCard: React.CSSProperties = {
  ...cardStyle,
  padding: "1.25rem",
};

const statLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.6875rem",
  fontWeight: 700,
  color: "#6E7580",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.5rem",
};

const statValue: React.CSSProperties = {
  fontSize: "1.75rem",
  fontWeight: 800,
  color: "#141820",
  margin: "0.25rem 0",
  letterSpacing: "-0.03em",
};

const statSub: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#6E7580",
};

// Toggle button pair
const toggleGroup: React.CSSProperties = {
  display: "flex",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  overflow: "hidden",
};

const toggleBtn = (active: boolean): React.CSSProperties => ({
  padding: "0.375rem 0.75rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  border: "none",
  cursor: "pointer",
  background: active ? BRAND : "transparent",
  color: active ? "#fff" : "#6E7580",
  transition: "all 0.15s",
});

// Listing card
const listingCardStyle = (selected: boolean): React.CSSProperties => ({
  background: selected ? "rgba(0,118,182,0.04)" : "#ffffff",
  border: `1px solid ${selected ? BRAND : "#E8EEF5"}`,
  borderRadius: 12,
  padding: "1rem",
  display: "flex",
  gap: "0.875rem",
  marginBottom: "0.75rem",
  transition: "all 0.15s",
});

const trendBadgeStyle = (trend: TrendLabel): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.2rem",
  padding: "0.2rem 0.5rem",
  borderRadius: 6,
  fontSize: "0.6875rem",
  fontWeight: 700,
  background: trend === "hot"    ? "rgba(249,115,22,0.1)"
             : trend === "stale"  ? "rgba(0,118,182,0.1)"
             : "rgba(110,117,128,0.1)",
  color:  trend === "hot"    ? "#ea580c"
        : trend === "stale"  ? BRAND
        : "#6E7580",
});

const statusBadge = (status: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "0.15rem 0.5rem",
  borderRadius: 6,
  fontSize: "0.6875rem",
  fontWeight: 700,
  background: status === "Active" ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)",
  color: status === "Active" ? "#16a34a" : "#d97706",
});

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.2rem 0.5rem",
  borderRadius: 6,
  fontSize: "0.6875rem",
  fontWeight: 600,
  background: "rgba(0,118,182,0.06)",
  color: BRAND,
};

const searchInput: React.CSSProperties = {
  ...inputStyle,
  width: "100%",
  padding: "0.5rem 0.75rem 0.5rem 2rem",
  fontSize: "0.875rem",
};

const iconBtn = (active?: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.5rem",
  borderRadius: 8,
  border: `1px solid ${active ? BRAND : COLORS.border}`,
  background: active ? "rgba(0,118,182,0.06)" : "#ffffff",
  color: active ? BRAND : "#6E7580",
  cursor: "pointer",
  transition: "all 0.15s",
});

// ─── Trend Badge ──────────────────────────────────────────────────────

function TrendBadge({ listing }: { listing: EbayListing }) {
  const trend = getTrend(listing);
  if (trend === "new") return null;
  return (
    <span style={trendBadgeStyle(trend)}>
      {trend === "hot"    && <Flame size={10} />}
      {trend === "stale"  && <TrendingDown size={10} />}
      {trend === "stable" && <Minus size={10} />}
      {trend === "hot" ? "Hot" : trend === "stale" ? "Stale" : "Stable"}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export default function DashboardPage2() {
  const { user, currentPlan, planFeatures } = useAuth();
  const navigate = useNavigate();
  const { drafts } = useDrafts();

  const [listings,    setListings]    = useState<EbayListing[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [ebayAccount, setEbayAccount] = useState<any>(null);
  const [ebayToken,   setEbayToken]   = useState<string | null>(null);
  const [needsAuth,   setNeedsAuth]   = useState(false);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [viewMode,    setViewMode]    = useState<ViewMode>("cards");

  // Financial / P&L state
  const [fin7,  setFin7]  = useState<FinancialWindow>(emptyFin());
  const [fin30, setFin30] = useState<FinancialWindow>(emptyFin());
  const [fin90, setFin90] = useState<FinancialWindow>(emptyFin());
  const [profitWindow, setProfitWindow] = useState<ProfitWindow>("30d");
  const [orderCount7d,  setOrderCount7d]  = useState(0);
  const [orderCount30d, setOrderCount30d] = useState(0);
  const [orderCount90d, setOrderCount90d] = useState(0);

  // Search & filters
  const [searchQuery,  setSearchQuery]  = useState("");
  const [showFilters,  setShowFilters]  = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [filterMin,    setFilterMin]    = useState("");
  const [filterMax,    setFilterMax]    = useState("");
  const [sortField,    setSortField]    = useState<SortField>("listingDate");
  const [sortDir,      setSortDir]      = useState<SortDir>("desc");

  // Detail modal
  const [detailListing, setDetailListing] = useState<ListingDetailData | null>(null);

  // Bulk select
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());

  // Bulk refresh cooldown
  const [bulkRefreshCooldownUntil, setBulkRefreshCooldownUntil] = useState<string | null>(() => {
    try {
      const s = localStorage.getItem(BULK_REFRESH_COOLDOWN_KEY);
      if (s && new Date(s) > new Date()) return s;
    } catch { /* ignore */ }
    return null;
  });
  const [lastBulkRefreshAt, setLastBulkRefreshAt] = useState<string | null>(null);

  // ─── Fetch listings ───────────────────────────────────────────────

  const fetchListings = useCallback(async () => {
    // Step 1: retrieve stored eBay token
    let token: string | null = null;
    if (user?.id) {
      try {
        const { data: td } = await supabase.functions.invoke("ebay-publish", {
          body: { action: "get_stored_token", userId: user.id },
        });
        if (td?.token) {
          token = td.token;
          localStorage.setItem(EBAY_TOKEN_KEY, token!);
          setEbayToken(token!);
        }
        if (td?.isExpired) {
          localStorage.removeItem(EBAY_TOKEN_KEY);
          setNeedsAuth(true); setEbayAccount(null); setListings([]);
          toast.error("eBay session expired. Please reconnect in Settings.");
          return;
        }
      } catch { /* fall through */ }
    }
    if (!token) token = localStorage.getItem(EBAY_TOKEN_KEY);
    if (token) setEbayToken(token);
    if (!token) { setNeedsAuth(true); setEbayAccount(null); setListings([]); setLoading(false); return; }

    setLoading(true);
    try {
      // Step 2: fetch listings + account in parallel
      const [listRes, userRes] = await Promise.all([
        supabase.functions.invoke("ebay-listings", { body: { userToken: token } }),
        supabase.functions.invoke("ebay-user",     { body: { userToken: token } }),
      ]);

      if (listRes.error || listRes.data?.needsAuth) {
        localStorage.removeItem(EBAY_TOKEN_KEY);
        setNeedsAuth(true); setListings([]); setEbayAccount(null);
        toast.error("eBay connection expired. Please reconnect in Settings.");
        return;
      }
      if (listRes.data?.error) {
        toast.error(`eBay error: ${listRes.data.error}`);
        return;
      }

      const rawListings: EbayListing[] = listRes.data?.listings ?? [];

      // Step 3: capture order counts + financial data from Fulfillment API
      if (typeof listRes.data?.orderCount30d === "number") setOrderCount30d(listRes.data.orderCount30d);
      if (typeof listRes.data?.orderCount7d  === "number") setOrderCount7d(listRes.data.orderCount7d);
      if (typeof listRes.data?.orderCount90d === "number") setOrderCount90d(listRes.data.orderCount90d);
      if (listRes.data?.financial?.w7)  setFin7(listRes.data.financial.w7);
      if (listRes.data?.financial?.w30) setFin30(listRes.data.financial.w30);
      if (listRes.data?.financial?.w90) setFin90(listRes.data.financial.w90);

      // Step 4: match COGS from DB to sold orders and apply to financial windows
      if (user?.id && listRes.data?.financial) {
        try {
          const soldOrders: Array<{ sku: string | null; listingId: string | null; soldAt: string }> =
            listRes.data.financial.soldOrders ?? [];
          if (soldOrders.length > 0) {
            const skus       = soldOrders.map(o => o.sku).filter(Boolean) as string[];
            const listingIds = soldOrders.map(o => o.listingId).filter(Boolean) as string[];
            const orParts: string[] = [];
            if (skus.length > 0)       orParts.push(`ebay_sku.in.(${skus.join(",")})`);
            if (listingIds.length > 0) orParts.push(`ebay_listing_id.in.(${listingIds.join(",")})`);
            const { data: cogsRows } = await supabase
              .from("listing_cogs")
              .select("ebay_sku, ebay_listing_id, cogs")
              .eq("user_id", user.id)
              .or(orParts.join(","));
            const cogsMap: Record<string, number> = {};
            for (const row of cogsRows ?? []) {
              if (row.ebay_sku)        cogsMap[row.ebay_sku]        = Number(row.cogs);
              if (row.ebay_listing_id) cogsMap[row.ebay_listing_id] = Number(row.cogs);
            }
            const now = Date.now();
            const ms7 = 7*86400000, ms30 = 30*86400000, ms90 = 90*86400000;
            let cogs7 = 0, cogs30 = 0, cogs90 = 0;
            for (const order of soldOrders) {
              const cv = (order.sku ? cogsMap[order.sku] : 0) || (order.listingId ? cogsMap[order.listingId] : 0) || 0;
              if (cv === 0) continue;
              const age = now - new Date(order.soldAt).getTime();
              if (age <= ms90) cogs90 += cv;
              if (age <= ms30) cogs30 += cv;
              if (age <= ms7)  cogs7  += cv;
            }
            setFin7(prev  => ({ ...prev, cogsTotal: cogs7,  netProfit: prev.netProfit - cogs7  }));
            setFin30(prev => ({ ...prev, cogsTotal: cogs30, netProfit: prev.netProfit - cogs30 }));
            setFin90(prev => ({ ...prev, cogsTotal: cogs90, netProfit: prev.netProfit - cogs90 }));
          }
        } catch (cogsErr) { console.warn("COGS lookup non-fatal:", cogsErr); }
      }

      // Step 5: fetch competitor prices from DB
      const competitorMap: Record<string, CompetitorPriceSnapshot> = {};
      if (user?.id && rawListings.length > 0) {
        try {
          const ids = rawListings.map(l => l.listingId).filter(Boolean) as string[];
          if (ids.length > 0) {
            const { data: cpData } = await supabase
              .from("competitor_prices")
              .select("ebay_listing_id, avg_price, min_price, max_price, median_price, price_delta, competitor_count, price_distribution, fetched_at, expires_at, gemini_search_query, search_query")
              .eq("user_id", user.id)
              .in("ebay_listing_id", ids)
              .order("fetched_at", { ascending: false });
            for (const row of cpData ?? []) {
              if (!competitorMap[row.ebay_listing_id]) {
                competitorMap[row.ebay_listing_id] = {
                  avgPrice:          row.avg_price,
                  minPrice:          row.min_price,
                  maxPrice:          row.max_price,
                  medianPrice:       row.median_price,
                  priceDelta:        row.price_delta,
                  competitorCount:   row.competitor_count,
                  priceDistribution: row.price_distribution ?? [],
                  fetchedAt:         row.fetched_at,
                  cacheExpiresAt:    row.expires_at ?? null,
                  searchQuery:       row.gemini_search_query ?? row.search_query ?? null,
                };
              }
            }
          }
        } catch (cpErr) { console.warn("Competitor prices non-fatal:", cpErr); }
      }

      const enriched = rawListings.map(l => ({
        ...l,
        competitor: l.listingId ? (competitorMap[l.listingId] ?? null) : null,
      }));

      setListings(enriched);
      setNeedsAuth(false);
      if (userRes.data?.username) {
        setEbayAccount({ username: userRes.data.username, businessName: userRes.data.businessName || "" });
      }
      toast.success(`Refreshed! ${enriched.length} listings loaded`);
    } catch (e: any) {
      toast.error("Failed to load listings.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // ─── Filter + sort ────────────────────────────────────────────────

  const filteredListings = useMemo(() => {
    let r = listings;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      r = r.filter(l => l.title.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q) || l.listingId?.toLowerCase().includes(q));
    }
    if (filterStatus !== "all") {
      r = r.filter(l => filterStatus === "active" ? statusLabel(l.status) === "Active" : statusLabel(l.status) === "Draft");
    }
    if (filterMin) r = r.filter(l => l.price >= parseFloat(filterMin));
    if (filterMax) r = r.filter(l => l.price <= parseFloat(filterMax));
    r = [...r].sort((a, b) => {
      let aVal: any = sortField === "trend" ? trendScore(a) : (a as any)[sortField];
      let bVal: any = sortField === "trend" ? trendScore(b) : (b as any)[sortField];
      if (aVal == null) aVal = -Infinity;
      if (bVal == null) bVal = -Infinity;
      const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal) : aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [listings, searchQuery, filterStatus, filterMin, filterMax, sortField, sortDir]);

  // ─── Metrics ─────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const active = listings.filter(l => statusLabel(l.status) === "Active");
    return {
      total:      listings.length,
      active:     active.length,
      liveValue:  active.reduce((s, l) => s + l.price * (l.quantity || 1), 0),
      draftValue: drafts.reduce((s, d) => s + (d.price || 0), 0),
      views7d:    active.reduce((s, l) => s + (l.views7d  || 0), 0),
      views30d:   active.reduce((s, l) => s + (l.views30d || 0), 0),
      views90d:   active.reduce((s, l) => s + (l.views90d || 0), 0),
      watchers:   active.reduce((s, l) => s + (l.watchCount || 0), 0),
      sales:      active.reduce((s, l) => s + (l.transactions || 0), 0),
    };
  }, [listings, drafts]);

  // ─── Competitor refresh helpers ───────────────────────────────────

  const handleRefreshCompetitor = async (listingId: string) => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.functions.invoke("ebay-competitor-search", {
        body: {
          userId:     user.id,
          listingId,
          title:      listings.find(l => l.listingId === listingId)?.title,
          categoryId: listings.find(l => l.listingId === listingId)?.categoryId,
          yourPrice:  listings.find(l => l.listingId === listingId)?.price,
        },
      });
      if (error || data?.error) { toast.error("Could not retrieve competitor prices. Please try again."); return; }
      if (data?.stale && data?.warning) toast.info(data.warning, { duration: 6000 });
      setListings(prev => prev.map(l => l.listingId !== listingId ? l : {
        ...l,
        competitor: {
          avgPrice: data.avgPrice, minPrice: data.minPrice, maxPrice: data.maxPrice,
          medianPrice: data.medianPrice, competitorCount: data.competitorCount,
          priceDelta: data.priceDelta, priceDistribution: data.priceDistribution ?? [],
          fetchedAt: new Date().toISOString(), cacheExpiresAt: data.cacheExpiresAt ?? null,
          searchQuery: data.geminiSearchQuery ?? data.searchQuery ?? null,
        },
      }));
      if (!data?.fromCache) toast.success("Competitor prices updated");
    } catch { toast.error("Failed to refresh competitor prices"); }
  };

  const handleRefreshAll = async () => {
    if (!user?.id) return;
    if (bulkRefreshCooldownUntil && new Date(bulkRefreshCooldownUntil) > new Date()) {
      const diff = new Date(bulkRefreshCooldownUntil).getTime() - Date.now();
      const h = Math.floor(diff / 3600000);
      const m = Math.ceil((diff % 3600000) / 60000);
      toast.info(`Bulk refresh available in ${h > 0 ? `${h}h ` : ""}${m}m`, { duration: 4000 });
      return;
    }
    const stale = listings.filter(l => {
      if (!l.listingId) return false;
      if (!l.competitor?.fetchedAt) return true;
      return Date.now() - new Date(l.competitor.fetchedAt).getTime() >= 30 * 60 * 1000;
    });
    if (stale.length === 0) { toast.info("All listings have fresh data — nothing to refresh."); return; }
    const until = new Date(Date.now() + BULK_REFRESH_COOLDOWN_MS).toISOString();
    setBulkRefreshCooldownUntil(until);
    setLastBulkRefreshAt(new Date().toISOString());
    try { localStorage.setItem(BULK_REFRESH_COOLDOWN_KEY, until); } catch { /* ignore */ }
    toast.info(`Refreshing ${stale.length} listing${stale.length !== 1 ? "s" : ""}…`, { duration: 3000 });
    let updated = 0, failed = 0;
    for (const listing of stale) {
      if (!listing.listingId) continue;
      try {
        const { data, error } = await supabase.functions.invoke("ebay-competitor-search", {
          body: { userId: user.id, listingId: listing.listingId, title: listing.title, categoryId: listing.categoryId, yourPrice: listing.price },
        });
        if (!error && data && !data.error) {
          setListings(prev => prev.map(l => l.listingId !== listing.listingId ? l : {
            ...l,
            competitor: {
              avgPrice: data.avgPrice, minPrice: data.minPrice, maxPrice: data.maxPrice,
              medianPrice: data.medianPrice, competitorCount: data.competitorCount,
              priceDelta: data.priceDelta, priceDistribution: data.priceDistribution ?? [],
              fetchedAt: new Date().toISOString(), cacheExpiresAt: data.cacheExpiresAt ?? null,
              searchQuery: data.geminiSearchQuery ?? data.searchQuery ?? null,
            },
          }));
          updated++;
        } else { failed++; }
      } catch { failed++; }
      await new Promise(r => setTimeout(r, 400));
    }
    if (failed === 0) toast.success(`All ${updated} listing${updated !== 1 ? "s" : ""} updated!`);
    else toast.warning(`Updated ${updated}, failed ${failed}.`);
  };

  const handleApplyPrice = async (listingId: string, offerId: string | null, sku: string, newPrice: number, currency: string) => {
    if (!ebayToken || !user?.id) { toast.error("Not connected to eBay"); return; }
    const { data, error } = await supabase.functions.invoke("ebay-reprice", {
      body: { action: "single_update", userToken: ebayToken, userId: user.id, offerId, sku, listingId, newPrice, currency },
    });
    if (error || !data?.success) {
      toast.error(`Could not apply price: ${data?.error || error?.message || "Unknown error"}`);
      throw new Error(data?.error || error?.message || "reprice failed");
    }
    setListings(prev => prev.map(l => l.listingId === listingId ? { ...l, price: newPrice } : l));
    toast.success(`Price updated to $${newPrice.toFixed(2)} on eBay`);
  };

  // ─── Select helpers ───────────────────────────────────────────────

  const toggleSelect = (l: EbayListing) => {
    const k = listingKey(l);
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(k)) { n.delete(k); } else { n.add(k); }
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredListings.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredListings.map(listingKey)));
    }
  };

  const hasActiveFilters = filterStatus !== "all" || !!filterMin || !!filterMax || !!searchQuery;

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <AppShell>
      <div style={pageStyle}>
        <div style={contentStyle}>

          {/* ── Page Header ─────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem" }}>
            <div>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 800, color: "#141820", margin: 0, letterSpacing: "-0.03em" }}>
                Dashboard
              </h1>
              <p style={{ fontSize: "0.9375rem", color: "#6E7580", marginTop: "0.25rem" }}>
                {ebayAccount
                  ? `Connected as ${ebayAccount.businessName || ebayAccount.username}`
                  : "eBay performance overview"}
              </p>
            </div>
            <button
              onClick={fetchListings}
              disabled={loading}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.5rem",
                padding: "0.625rem 1.125rem",
                background: "#ffffff", border: `1px solid ${COLORS.border}`,
                borderRadius: 10, fontSize: "0.875rem", fontWeight: 600,
                color: "#141820", cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                transition: "all 0.15s",
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>

          {/* ── eBay not connected ───────────────────────────────────── */}
          {needsAuth && !setupDismissed && (
            <div style={{ ...sectionCard, background: "rgba(251,146,60,0.04)", borderTop: "3px solid #fb923c", display: "flex", gap: "1rem", padding: "1rem 1.25rem" }}>
              <AlertCircle size={20} style={{ color: "#f97316", flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820" }}>eBay not connected</div>
                <div style={{ fontSize: "0.8125rem", color: "#6E7580", marginTop: "0.25rem" }}>
                  Connect your eBay account in Settings to see listings.{" "}
                  <button onClick={() => navigate("/settings?tab=integrations")} style={{ color: BRAND, fontWeight: 600, cursor: "pointer", border: "none", background: "none" }}>
                    Go to Integrations →
                  </button>
                </div>
              </div>
              <button onClick={() => setSetupDismissed(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6E7580", flexShrink: 0 }}>
                <X size={16} />
              </button>
            </div>
          )}

          {/* ── Summary Stats ─────────────────────────────────────────── */}
          <div style={statGrid}>
            <div style={statCard}>
              <div style={statLabel}><DollarSign size={12} /> Total Inventory</div>
              <div style={statValue}>${(metrics.liveValue + metrics.draftValue).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              <div style={statSub}>Live: ${metrics.liveValue.toFixed(0)} • Drafts: ${metrics.draftValue.toFixed(0)}</div>
            </div>

            {planFeatures.hasListingAnalytics ? (
              <div style={statCard}>
                <div style={statLabel} title="Total View Item page clicks across all active listings (not impressions)"><Eye size={12} /> Views (30d)</div>
                <div style={statValue}>{metrics.views30d.toLocaleString()}</div>
                <div style={statSub}>7d: {metrics.views7d.toLocaleString()} • 90d: {metrics.views90d.toLocaleString()}</div>
                <div style={{ fontSize: "0.65rem", color: "#9BA3AD", marginTop: "0.25rem" }}>Sum across all active listings</div>
              </div>
            ) : (
              <div style={statCard}>
                <div style={statLabel}><Eye size={12} /> Views</div>
                <div style={{ fontSize: "0.875rem", color: "#6E7580", marginTop: "0.75rem" }}>Upgrade to Pro for analytics</div>
              </div>
            )}

            {planFeatures.hasListingAnalytics ? (
              <div style={statCard}>
                <div style={statLabel}><Heart size={12} /> Total Watchers</div>
                <div style={statValue}>{metrics.watchers.toLocaleString()}</div>
                <div style={statSub}>Across all listings</div>
              </div>
            ) : (
              <div style={statCard}>
                <div style={statLabel}><Heart size={12} /> Watchers</div>
                <div style={{ fontSize: "0.875rem", color: "#6E7580", marginTop: "0.75rem" }}>Upgrade to Pro</div>
              </div>
            )}

            <div style={statCard}>
              <div style={statLabel}><ShoppingCart size={12} /> Sales (30d)</div>
              <div style={statValue}>{orderCount30d}</div>
              <div style={statSub}>7d: {orderCount7d} · 90d: {orderCount90d}</div>
            </div>

            <div style={statCard}>
              <div style={statLabel}><LayoutDashboard size={12} /> Active Listings</div>
              <div style={statValue}>{metrics.active}</div>
              <div style={statSub}>Of {metrics.total} total</div>
            </div>
          </div>

          {/* ── P&L / Sales & Profit ───────────────────────────────────────── */}
          {(() => {
            const finMap: Record<string, typeof fin30> = { "7d": fin7, "30d": fin30, "90d": fin90 };
            const fin = finMap[profitWindow];
            const profitColor = fin.netProfit >= 0 ? "#16a34a" : "#dc2626";
            const profitBg    = fin.netProfit >= 0 ? "rgba(34,197,94,0.08)" : "rgba(220,38,38,0.06)";
            const usd = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const fmt    = (v: number) => (!isFinite(v) || isNaN(v)) ? "—" : v === 0 ? "—" : `${v < 0 ? "-" : ""}$${usd(Math.abs(v))}`;
            const fmtPos = (v: number) => (!isFinite(v) || isNaN(v)) ? "—" : v === 0 ? "—" : `$${usd(v)}`;
            const fmtNeg = (v: number) => (!isFinite(v) || isNaN(v)) ? "—" : v === 0 ? "—" : `-$${usd(Math.abs(v))}`;
            const row = (
              icon: React.ReactNode,
              label: string,
              value: string,
              color = "#374151",
              bold = false,
              topBorder = false,
            ) => (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.5rem 0",
                borderTop: topBorder ? "1px solid #E8EEF5" : undefined,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#6E7580", fontSize: "0.8125rem", fontWeight: bold ? 700 : 400 }}>
                  {icon}
                  {label}
                </div>
                <span style={{ fontSize: bold ? "0.9375rem" : "0.8125rem", fontWeight: bold ? 700 : 500, color }}>{value}</span>
              </div>
            );
            return (
              <div style={{ ...sectionCard, marginBottom: "1.25rem" }}>
                {/* Card header */}
                <div style={cardHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                    <CircleDollarSign size={16} style={{ color: BRAND }} />
                    <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>Sales & Profit</span>
                  </div>
                  {/* Window toggle */}
                  <div style={toggleGroup}>
                    {(["7d","30d","90d"] as ProfitWindow[]).map(w => (
                      <button key={w} style={toggleBtn(profitWindow === w)} onClick={() => setProfitWindow(w)}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={cardBody}>
                  {/* Big net profit number */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "1.5rem",
                    background: profitBg,
                    borderRadius: 10,
                    padding: "1rem 1.25rem",
                    marginBottom: "1rem",
                  }}>
                    <div>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6E7580", marginBottom: "0.25rem" }}>
                        Net Profit ({profitWindow})
                      </div>
                      <div style={{ fontSize: "2rem", fontWeight: 800, color: profitColor, letterSpacing: "-0.04em", lineHeight: 1 }}>
                        {fmt(fin.netProfit)}
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#6E7580", marginBottom: "0.25rem" }}>
                        Orders
                      </div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#141820", letterSpacing: "-0.03em" }}>
                        {fin.orders || (profitWindow === "7d" ? orderCount7d : profitWindow === "30d" ? orderCount30d : orderCount90d)}
                      </div>
                    </div>
                  </div>

                  {/* Breakdown rows */}
                  <div style={{ padding: "0 0.25rem" }}>
                    {row(<TrendingUp size={14} />,    "Revenue",              fmtPos(fin.revenue),          "#16a34a")}
                    {row(<Truck size={14} />,          "Shipping Collected",   fmtPos(fin.shippingCollected), "#374151")}
                    {row(<Receipt size={14} />,        "eBay Fees",            fmtNeg(fin.ebayFees),          "#dc2626")}
                    {row(<Truck size={14} />,          "Shipping Labels",      fmtNeg(fin.shippingLabels),    "#dc2626")}
                    {row(<RotateCcw size={14} />,      "Refunds",              fmtNeg(fin.refunds),           "#dc2626")}
                    {fin.nonSaleCharges !== 0 && row(<Store size={14} />,      "Store / Non-sale Fees",  fmtNeg(fin.nonSaleCharges),   "#dc2626")}
                    {fin.disputes !== 0 && row(<ShieldAlert size={14} />,      "Disputes",                fmtNeg(fin.disputes),         "#dc2626")}
                    {fin.credits   !== 0 && row(<BadgeCheck size={14} />,      "Credits",                 fmtPos(fin.credits),          "#16a34a")}
                    {row(<Package size={14} />,        "COGS",                 fmtNeg(fin.cogsTotal),         fin.cogsTotal > 0 ? "#dc2626" : "#9BA3AD")}
                    {/* Summary divider row */}
                    {row(
                      <CircleDollarSign size={14} style={{ color: profitColor }} />,
                      "Net Profit",
                      fmt(fin.netProfit),
                      profitColor,
                      true,
                      true,
                    )}
                  </div>

                  {fin.revenue === 0 && fin.orders === 0 && orderCount30d === 0 && (
                    <p style={{ fontSize: "0.8125rem", color: "#9BA3AD", textAlign: "center", marginTop: "0.75rem" }}>
                      No financial data available yet for this window. Data populates from your eBay Seller Hub via the Fulfillment API.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Listings Section ─────────────────────────────────────── */}
          {loading && listings.length === 0 ? (
            <div style={{ ...sectionCard, padding: "3rem", textAlign: "center", color: "#6E7580" }}>
              <Loader2 size={28} style={{ margin: "0 auto 0.75rem", display: "block", animation: "spin 1s linear infinite" }} />
              Loading listings…
            </div>
          ) : listings.length > 0 ? (
            <div style={sectionCard}>
              {/* Header */}
              <div style={cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#141820" }}>
                    eBay Listings
                  </span>
                  <span style={{
                    fontSize: "0.75rem", fontWeight: 600,
                    padding: "0.2rem 0.5rem", borderRadius: 12,
                    background: "rgba(0,118,182,0.08)", color: BRAND,
                  }}>
                    {filteredListings.length}{filteredListings.length !== listings.length ? ` / ${listings.length}` : ""}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
                  {/* Cards / Pricing toggle */}
                  <div style={toggleGroup}>
                    <button style={toggleBtn(viewMode === "cards")} onClick={() => setViewMode("cards")}>Cards</button>
                    <button style={toggleBtn(viewMode === "pricing")} onClick={() => setViewMode("pricing")}>Pricing</button>
                  </div>
                  {/* Filter toggle */}
                  <button style={iconBtn(showFilters || hasActiveFilters)} onClick={() => setShowFilters(v => !v)}>
                    <SlidersHorizontal size={15} />
                    {hasActiveFilters && (
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRAND, marginLeft: 2 }} />
                    )}
                  </button>
                </div>
              </div>

              <div style={cardBody}>
                {/* Search */}
                <div style={{ position: "relative", marginBottom: "0.75rem" }}>
                  <Search size={14} style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#9BA3AD" }} />
                  <input
                    type="text"
                    placeholder="Search title, SKU, listing ID…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={searchInput}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ position: "absolute", right: "0.625rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9BA3AD" }}>
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Filter panel */}
                {showFilters && (
                  <div style={{ background: "rgba(0,118,182,0.03)", border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "0.875rem 1rem", marginBottom: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
                    {/* Status */}
                    <div>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6E7580", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>Status</div>
                      <div style={toggleGroup}>
                        {(["all","active","inactive"] as const).map(s => (
                          <button key={s} style={toggleBtn(filterStatus === s)} onClick={() => setFilterStatus(s)}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Price range */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "0.375rem" }}>
                      <div>
                        <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6E7580", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>Min $</div>
                        <input type="number" min="0" placeholder="0" value={filterMin} onChange={e => setFilterMin(e.target.value)} style={{ ...inputStyle, width: 70, padding: "0.375rem 0.5rem" }} />
                      </div>
                      <span style={{ color: "#9BA3AD", paddingBottom: "0.375rem" }}>–</span>
                      <div>
                        <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6E7580", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>Max $</div>
                        <input type="number" min="0" placeholder="∞" value={filterMax} onChange={e => setFilterMax(e.target.value)} style={{ ...inputStyle, width: 70, padding: "0.375rem 0.5rem" }} />
                      </div>
                    </div>
                    {/* Sort */}
                    <div>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 700, color: "#6E7580", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>Sort by</div>
                      <select
                        value={`${sortField}:${sortDir}`}
                        onChange={e => {
                          const [f, d] = e.target.value.split(":");
                          setSortField(f as SortField);
                          setSortDir(d as SortDir);
                        }}
                        style={{ ...inputStyle, padding: "0.375rem 0.625rem" }}
                      >
                        <option value="listingDate:desc">Newest first</option>
                        <option value="listingDate:asc">Oldest first</option>
                        <option value="price:desc">Price: high → low</option>
                        <option value="price:asc">Price: low → high</option>
                        <option value="views:desc">Most views</option>
                        <option value="trend:desc">Hot trend first</option>
                        <option value="watchCount:desc">Most watchers</option>
                        <option value="title:asc">Title A–Z</option>
                      </select>
                    </div>
                    {hasActiveFilters && (
                      <button onClick={() => { setSearchQuery(""); setFilterStatus("all"); setFilterMin(""); setFilterMax(""); }} style={{ fontSize: "0.8125rem", color: "#6E7580", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                        Clear all
                      </button>
                    )}
                  </div>
                )}

                {/* PRICING TABLE VIEW */}
                {viewMode === "pricing" && (
                  <>
                    <PricingInsightsTable
                      listings={listings.map(l => ({
                        listingId:  l.listingId,
                        offerId:    l.offerId,
                        sku:        l.sku,
                        title:      l.title,
                        price:      l.price,
                        currency:   l.currency,
                        ebayUrl:    l.ebayUrl,
                        competitor: l.competitor,
                        imageUrl:   l.imageUrl,
                      }))}
                      onRefreshCompetitor={handleRefreshCompetitor}
                      onRefreshAll={handleRefreshAll}
                      onPriceChange={(listingId, newPrice) =>
                        setListings(prev => prev.map(l => l.listingId === listingId ? { ...l, price: newPrice } : l))
                      }
                      onApplyPrice={handleApplyPrice}
                      userToken={ebayToken}
                      userId={user?.id || ""}
                      isLoading={loading}
                      lastBulkRefreshAt={lastBulkRefreshAt}
                      bulkRefreshCooldownUntil={bulkRefreshCooldownUntil}
                    />
                    {user?.id && <RepriceManagerPanel userId={user.id} />}
                  </>
                )}

                {/* CARDS VIEW */}
                {viewMode === "cards" && (
                  <>
                    {/* Select all */}
                    {filteredListings.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                        <button onClick={toggleSelectAll} style={{ display: "flex", alignItems: "center", gap: "0.375rem", background: "none", border: "none", cursor: "pointer", fontSize: "0.8125rem", color: "#6E7580" }}>
                          {selectedIds.size === filteredListings.length && filteredListings.length > 0
                            ? <CheckSquare size={15} style={{ color: BRAND }} />
                            : <Square size={15} />}
                          {selectedIds.size === filteredListings.length && filteredListings.length > 0 ? "Deselect all" : `Select all (${filteredListings.length})`}
                        </button>
                        {selectedIds.size > 0 && (
                          <span style={{ fontSize: "0.8125rem", color: "#9BA3AD" }}>· {selectedIds.size} selected</span>
                        )}
                      </div>
                    )}

                    {/* Listing cards */}
                    {filteredListings.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "2.5rem", color: "#6E7580" }}>
                        <Package size={32} style={{ margin: "0 auto 0.75rem", opacity: 0.3, display: "block" }} />
                        {hasActiveFilters ? "No listings match your filters." : "No listings found on eBay yet."}
                      </div>
                    ) : (
                      filteredListings.map(listing => {
                        const k = listingKey(listing);
                        const selected = selectedIds.has(k);
                        const trend = getTrend(listing);
                        const slabel = statusLabel(listing.status);
                        return (
                          <div key={k} style={listingCardStyle(selected)}>
                            {/* Checkbox */}
                            <button onClick={() => toggleSelect(listing)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: selected ? BRAND : "#9BA3AD", alignSelf: "flex-start", marginTop: 2 }}>
                              {selected ? <CheckSquare size={15} style={{ color: BRAND }} /> : <Square size={15} />}
                            </button>

                            {/* Image — click to open detail modal */}
                            <button
                              onClick={() => setDetailListing({
                                offerId: listing.offerId,
                                sku: listing.sku,
                                title: listing.title,
                                imageUrl: listing.imageUrl,
                                price: listing.price,
                                currency: listing.currency,
                                status: listing.status,
                                quantity: listing.quantity,
                                format: listing.format,
                                condition: listing.condition,
                                listingId: listing.listingId,
                                ebayUrl: listing.ebayUrl,
                                listingDate: listing.listingDate,
                                views7d: listing.views7d,
                                views30d: listing.views30d,
                                views90d: listing.views90d,
                                impressions7d: listing.impressions7d,
                                impressions30d: listing.impressions30d,
                                impressions90d: listing.impressions90d,
                                clickThroughRate: listing.clickThroughRate,
                                salesConversionRate: listing.salesConversionRate,
                                watchCount: listing.watchCount,
                                transactions7d: listing.transactions7d,
                                transactions30d: listing.transactions30d,
                                transactions90d: listing.transactions90d,
                                questionCount: listing.questionCount,
                              })}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
                              title="View listing details & COGS"
                            >
                              {listing.imageUrl ? (
                                <img src={listing.imageUrl} alt={listing.title} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", display: "block", transition: "opacity 0.15s" }} />
                              ) : (
                                <div style={{ width: 72, height: 72, borderRadius: 10, background: "#EFF2F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <Package size={24} style={{ color: "#9BA3AD" }} />
                                </div>
                              )}
                            </button>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {/* Title row */}
                              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.375rem" }}>
                                <button
                                  onClick={() => setDetailListing({
                                    offerId: listing.offerId,
                                    sku: listing.sku,
                                    title: listing.title,
                                    imageUrl: listing.imageUrl,
                                    price: listing.price,
                                    currency: listing.currency,
                                    status: listing.status,
                                    quantity: listing.quantity,
                                    format: listing.format,
                                    condition: listing.condition,
                                    listingId: listing.listingId,
                                    ebayUrl: listing.ebayUrl,
                                    listingDate: listing.listingDate,
                                    views7d: listing.views7d,
                                    views30d: listing.views30d,
                                    views90d: listing.views90d,
                                    impressions7d: listing.impressions7d,
                                    impressions30d: listing.impressions30d,
                                    impressions90d: listing.impressions90d,
                                    clickThroughRate: listing.clickThroughRate,
                                    salesConversionRate: listing.salesConversionRate,
                                    watchCount: listing.watchCount,
                                    transactions7d: listing.transactions7d,
                                    transactions30d: listing.transactions30d,
                                    transactions90d: listing.transactions90d,
                                    questionCount: listing.questionCount,
                                  })}
                                  style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                                  title="View listing details & COGS"
                                >
                                  {listing.title}
                                </button>
                                <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexShrink: 0, marginLeft: "auto" }}>
                                  {planFeatures.hasListingAnalytics && <TrendBadge listing={listing} />}
                                  <span style={statusBadge(slabel)}>{slabel}</span>
                                </div>
                              </div>

                              {/* Price + eBay link */}
                              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.375rem" }}>
                                <span style={{ fontSize: "1rem", fontWeight: 800, color: BRAND }}>
                                  ${listing.price.toFixed(2)}
                                </span>
                                {listing.ebayUrl && (
                                  <a href={listing.ebayUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "0.2rem", fontSize: "0.8125rem", color: BRAND, textDecoration: "none" }}>
                                    <ExternalLink size={12} /> View on eBay
                                  </a>
                                )}
                              </div>

                              {/* Analytics pills */}
                              {planFeatures.hasListingAnalytics && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.375rem" }}>
                                  {listing.views30d > 0 && (
                                    <span style={pillStyle}>
                                      <Eye size={10} /> {listing.views30d} views (30d)
                                    </span>
                                  )}
                                  {listing.watchCount > 0 && (
                                    <span style={pillStyle}>
                                      <Heart size={10} /> {listing.watchCount} watchers
                                    </span>
                                  )}
                                  {listing.transactions30d > 0 && (
                                    <span style={pillStyle}>
                                      <ShoppingCart size={10} /> {listing.transactions7d}/{listing.transactions30d}/{listing.transactions90d} sales
                                    </span>
                                  )}
                                  {listing.clickThroughRate > 0 && (
                                    <span style={pillStyle}>
                                      <MousePointerClick size={10} /> {fmtPct(listing.clickThroughRate)} CTR
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Meta row */}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.75rem", color: "#9BA3AD", marginBottom: "0.5rem" }}>
                                {listing.sku && listing.sku !== listing.listingId && (
                                  <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                    <Hash size={10} /> {listing.sku}
                                  </span>
                                )}
                                {listing.format && (
                                  <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                    <Tag size={10} /> {listing.format === "FIXED_PRICE" ? "BIN" : listing.format === "AUCTION" ? "Auction" : listing.format}
                                  </span>
                                )}
                                {listing.condition && <span>{listing.condition}</span>}
                                {listing.listingDate && (
                                  <span style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                    <Clock size={10} /> {daysAgo(listing.listingDate)}
                                  </span>
                                )}
                              </div>

                              {/* ── Competitor Price Card ── */}
                              {listing.listingId && (
                                <CompetitorPriceCard
                                  listingId={listing.listingId}
                                  title={listing.title}
                                  yourPrice={listing.price}
                                  ebayUrl={listing.ebayUrl}
                                  competitor={listing.competitor}
                                  onRefreshed={snapshot =>
                                    setListings(prev => prev.map(l => l.listingId === listing.listingId ? { ...l, competitor: snapshot } : l))
                                  }
                                />
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </div>
            </div>
          ) : !needsAuth ? (
            <div style={{ ...sectionCard, padding: "3rem", textAlign: "center", color: "#6E7580" }}>
              <Package size={40} style={{ margin: "0 auto 1rem", display: "block", opacity: 0.25 }} />
              <p style={{ fontSize: "0.9375rem", fontWeight: 600, color: "#141820", marginBottom: "0.25rem" }}>No listings found</p>
              <p style={{ fontSize: "0.8125rem" }}>Your eBay listings will appear here once connected.</p>
            </div>
          ) : null}

        </div>
      </div>

      {/* Listing Detail Modal — opened by clicking card image or title */}
      {detailListing && (
        <ListingDetailModal
          listing={detailListing}
          onClose={() => setDetailListing(null)}
        />
      )}
    </AppShell>
  );
}