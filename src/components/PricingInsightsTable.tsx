import { useState, useMemo, useRef, useCallback } from "react";
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, Eye, ExternalLink,
  ChevronUp, ChevronDown, Zap, Loader2, Check, Clock, AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ListingWithCompetitor {
  listingId: string | null;
  offerId: string | null;
  sku: string;
  title: string;
  price: number;
  currency: string;
  ebayUrl?: string | null;
  competitor?: {
    avgPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    medianPrice?: number | null;
    competitorCount: number;
    fetchedAt: string;
    cacheExpiresAt?: string | null;
  } | null;
  imageUrl?: string | null;
}

type SortField = "title" | "price" | "marketAvg" | "suggested" | "delta" | "competitors" | "condition";
type SortDir   = "asc" | "desc";

// How recently-refreshed data must be before we grey-out the per-row button (30 min)
const PER_ITEM_COOLDOWN_MS = 30 * 60 * 1000;

interface PricingInsightsTableProps {
  listings: ListingWithCompetitor[];
  onRefreshCompetitor: (listingId: string) => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onPriceChange: (listingId: string | null, newPrice: number) => void;
  onApplyPrice: (listingId: string, offerId: string | null, sku: string, newPrice: number, currency: string) => Promise<void>;
  userToken: string;
  userId: string;
  isLoading?: boolean;
  /** ISO timestamp of last bulk refresh — used to compute / show the next-allowed time */
  lastBulkRefreshAt?: string | null;
  /** ISO timestamp of when the next bulk refresh will be allowed */
  bulkRefreshCooldownUntil?: string | null;
}

export function PricingInsightsTable({
  listings,
  onRefreshCompetitor,
  onRefreshAll,
  onPriceChange,
  onApplyPrice,
  userToken,
  userId,
  isLoading = false,
  lastBulkRefreshAt,
  bulkRefreshCooldownUntil,
}: PricingInsightsTableProps) {
  const THROTTLE_DELAY = 500;
  const lastRefreshRef = useRef<Record<string, number>>({});

  const [sortField, setSortField]     = useState<SortField>("delta");
  const [sortDir,   setSortDir]       = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing,  setRefreshing]  = useState<Set<string>>(new Set());
  const [applying,    setApplying]    = useState<Set<string>>(new Set());
  const [applied,     setApplied]     = useState<Set<string>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);

  // ---- Bulk cooldown helpers ----
  const bulkCooldownActive = bulkRefreshCooldownUntil
    ? new Date(bulkRefreshCooldownUntil) > new Date()
    : false;

  const bulkCooldownLabel = (): string => {
    if (!bulkRefreshCooldownUntil) return "";
    const diff = new Date(bulkRefreshCooldownUntil).getTime() - Date.now();
    if (diff <= 0) return "";
    const h = Math.floor(diff / 3600000);
    const m = Math.ceil((diff % 3600000) / 60000);
    if (h > 0) return `Next refresh in ${h}h ${m}m`;
    return `Next refresh in ${m}m`;
  };

  // ---- Per-item helpers ----
  const getDelta = (listing: ListingWithCompetitor): number => {
    if (!listing.competitor?.avgPrice) return 0;
    return ((listing.price - listing.competitor.avgPrice) / listing.competitor.avgPrice) * 100;
  };

  const getPositioning = (delta: number): { label: string; color: string; icon: React.ElementType } => {
    if (delta > 10)  return { label: "Over",   color: "text-red-500 bg-red-500/10",   icon: TrendingUp };
    if (delta > 5)   return { label: "High",   color: "text-amber-500 bg-amber-500/10", icon: TrendingUp };
    if (delta < -10) return { label: "Under",  color: "text-blue-500 bg-blue-500/10", icon: TrendingDown };
    if (delta < -5)  return { label: "Low",    color: "text-sky-500 bg-sky-500/10",   icon: TrendingDown };
    return             { label: "Market", color: "text-green-500 bg-green-500/10", icon: Minus };
  };

  const getSuggestedPrice = (listing: ListingWithCompetitor): number | null => {
    const avg = listing.competitor?.avgPrice;
    const min = listing.competitor?.minPrice;
    if (!avg) return null;
    const target  = avg * 0.97;
    const clamped = min != null ? Math.max(target, min + 0.01) : target;
    const rounded = Math.floor(clamped) + 0.99;
    const suggested = rounded > clamped ? rounded - 1 : rounded;
    if (Math.abs(suggested - listing.price) < 0.02) return null;
    return Math.round(suggested * 100) / 100;
  };

  // Returns true if the listing's cache is still within PER_ITEM_COOLDOWN_MS
  const isItemCoolingDown = useCallback((listing: ListingWithCompetitor): boolean => {
    if (!listing.competitor?.fetchedAt) return false;
    const age = Date.now() - new Date(listing.competitor.fetchedAt).getTime();
    return age < PER_ITEM_COOLDOWN_MS;
  }, []);

  const itemCooldownLabel = (listing: ListingWithCompetitor): string => {
    const fetchedAt = listing.competitor?.fetchedAt;
    if (!fetchedAt) return "No data yet";
    const ageMs = Date.now() - new Date(fetchedAt).getTime();
    if (ageMs < 60000) return "Just refreshed";
    const ageMin = Math.floor(ageMs / 60000);
    if (ageMin < 60) return `Refreshed ${ageMin}m ago`;
    const ageH = Math.floor(ageMin / 60);
    return `Refreshed ${ageH}h ago`;
  };

  // ---- Filters / sort ----
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return listings.filter(
      (l) => l.title.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q)
    );
  }, [listings, searchQuery]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortField === "title")       cmp = a.title.localeCompare(b.title);
      else if (sortField === "price")  cmp = a.price - b.price;
      else if (sortField === "marketAvg") {
        cmp = (a.competitor?.avgPrice ?? 0) - (b.competitor?.avgPrice ?? 0);
      } else if (sortField === "suggested") {
        cmp = (getSuggestedPrice(a) ?? a.price) - (getSuggestedPrice(b) ?? b.price);
      } else if (sortField === "delta") {
        cmp = getDelta(a) - getDelta(b);
      } else if (sortField === "competitors") {
        cmp = (a.competitor?.competitorCount ?? 0) - (b.competitor?.competitorCount ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      {sortField === field && (
        sortDir === "asc"
          ? <ChevronUp className="w-3 h-3 text-primary" />
          : <ChevronDown className="w-3 h-3 text-primary" />
      )}
    </button>
  );

  // Data freshness relative to 8-hour cache window
  const getCacheFreshness = (listing: ListingWithCompetitor): "fresh" | "aging" | "stale" | "none" => {
    if (!listing.competitor?.fetchedAt) return "none";
    const ageMs = Date.now() - new Date(listing.competitor.fetchedAt).getTime();
    if (ageMs < 4 * 3600000)  return "fresh";  // < 4h
    if (ageMs < 8 * 3600000)  return "aging";  // 4–8h
    return "stale";                              // > 8h
  };

  const freshnessConfig = {
    fresh:  { label: "Fresh",  className: "text-green-600 dark:text-green-400" },
    aging:  { label: "Aging",  className: "text-amber-500 dark:text-amber-400" },
    stale:  { label: "Stale",  className: "text-red-500 dark:text-red-400" },
    none:   { label: "—",      className: "text-muted-foreground/60" },
  };

  // ---- Handlers ----
  const handleRefreshAll = async () => {
    if (refreshingAll || bulkCooldownActive || isLoading) return;
    setRefreshingAll(true);
    try {
      await onRefreshAll();
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleRefreshItem = (listing: ListingWithCompetitor) => {
    if (!listing.listingId) return;
    if (isItemCoolingDown(listing)) {
      toast.info("Data refreshed recently — please wait 30 minutes before refreshing again.", {
        duration: 3000,
      });
      return;
    }

    const now = Date.now();
    const lastRefresh = lastRefreshRef.current[listing.listingId] || 0;
    if (now - lastRefresh < THROTTLE_DELAY) return;
    lastRefreshRef.current[listing.listingId] = now;

    setRefreshing((prev) => new Set([...prev, listing.listingId!]));
    onRefreshCompetitor(listing.listingId).finally(() => {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(listing.listingId!);
        return next;
      });
    });
  };

  return (
    <div className="space-y-4 overflow-visible">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search by title or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Refresh All button */}
        <div className="flex flex-col items-end gap-0.5">
          <button
            onClick={handleRefreshAll}
            disabled={refreshingAll || bulkCooldownActive || isLoading}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-secondary text-foreground rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              bulkCooldownActive
                ? bulkCooldownLabel()
                : "Refresh all competitor data (available every 8 hours)"
            }
          >
            {refreshingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : bulkCooldownActive ? (
              <Clock className="w-4 h-4" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {bulkCooldownActive ? "Cooling down" : "Refresh All"}
          </button>
          {bulkCooldownActive && (
            <span className="text-[10px] text-muted-foreground">{bulkCooldownLabel()}</span>
          )}
          {lastBulkRefreshAt && !bulkCooldownActive && (
            <span className="text-[10px] text-muted-foreground">
              Last bulk: {new Date(lastBulkRefreshAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{filtered.length} listings</span>
        <span>·</span>
        <span>Overpriced: {filtered.filter((l) => getDelta(l) > 10).length}</span>
        <span>·</span>
        <span>Underpriced: {filtered.filter((l) => getDelta(l) < -10).length}</span>
        <span>·</span>
        <span>
          Stale data: {filtered.filter((l) => getCacheFreshness(l) === "stale" || getCacheFreshness(l) === "none").length}
        </span>
      </div>

      {/* Table — overflow-x-auto for horizontal scroll; no vertical clipping so all rows are visible */}
      <div className="border border-border rounded-lg overflow-x-auto overflow-y-visible">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-3 py-2 text-left">
                <SortHeader field="title" label="Title / SKU" />
              </th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="price" label="Your Price" />
              </th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="suggested" label="Suggested" />
              </th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="marketAvg" label="Market Avg" />
              </th>
              <th className="px-3 py-2 text-right">Min - Max</th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="delta" label="Position" />
              </th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="competitors" label="Comps" />
              </th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((listing) => {
              const delta        = getDelta(listing);
              const positioning  = getPositioning(delta);
              const PositionIcon = positioning.icon;
              const hasData      = !!(listing.competitor?.avgPrice);
              const freshness    = getCacheFreshness(listing);
              const freshnessInfo = freshnessConfig[freshness];
              const isRefreshing  = refreshing.has(listing.listingId || listing.sku);
              const coolingDown   = isItemCoolingDown(listing);

              return (
                <tr key={listing.listingId || listing.sku} className="hover:bg-secondary/20 transition-colors">
                  {/* Title & SKU */}
                  <td className="px-3 py-3 text-left">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground line-clamp-1">{listing.title}</p>
                      <p className="text-xs text-muted-foreground">{listing.sku}</p>
                    </div>
                  </td>

                  {/* Your Price */}
                  <td className="px-3 py-3 text-right">
                    <p className="font-semibold text-foreground">${listing.price.toFixed(2)}</p>
                  </td>

                  {/* Suggested Price */}
                  {(() => {
                    const suggested  = getSuggestedPrice(listing);
                    const rowKey     = listing.listingId || listing.sku;
                    const isApplying = applying.has(rowKey);
                    const wasApplied = applied.has(rowKey);
                    const isCheaper  = suggested != null && suggested < listing.price;
                    const isHigher   = suggested != null && suggested > listing.price;
                    return (
                      <td className="px-3 py-3 text-right">
                        {suggested != null ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={`text-sm font-semibold ${
                              wasApplied ? "text-emerald-600 dark:text-emerald-400" :
                              isCheaper  ? "text-amber-600 dark:text-amber-400" :
                              isHigher   ? "text-sky-600 dark:text-sky-400" :
                              "text-foreground"
                            }`}>
                              ${suggested.toFixed(2)}
                            </span>
                            <button
                              onClick={async () => {
                                if (!listing.listingId || isApplying || wasApplied) return;
                                setApplying((prev) => new Set([...prev, rowKey]));
                                try {
                                  await onApplyPrice(listing.listingId, listing.offerId, listing.sku, suggested, listing.currency);
                                  setApplied((prev) => new Set([...prev, rowKey]));
                                  setTimeout(() => setApplied((prev) => { const n = new Set(prev); n.delete(rowKey); return n; }), 3000);
                                } finally {
                                  setApplying((prev) => { const n = new Set(prev); n.delete(rowKey); return n; });
                                }
                              }}
                              disabled={isApplying || wasApplied || !listing.listingId}
                              className={`p-1 rounded transition-colors ${
                                wasApplied
                                  ? "text-emerald-600 dark:text-emerald-400 cursor-default"
                                  : "text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40"
                              }`}
                              title={wasApplied ? "Applied!" : `Apply $${suggested.toFixed(2)} to eBay`}
                            >
                              {isApplying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                               wasApplied ? <Check className="w-3.5 h-3.5" /> :
                               <Zap className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground/60">—</p>
                        )}
                      </td>
                    );
                  })()}

                  {/* Market Avg */}
                  <td className="px-3 py-3 text-right">
                    {hasData ? (
                      <p className="font-medium text-foreground">
                        ${listing.competitor!.avgPrice!.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Min - Max */}
                  <td className="px-3 py-3 text-right">
                    {hasData ? (
                      <p className="text-xs text-muted-foreground">
                        ${listing.competitor!.minPrice!.toFixed(2)} – ${listing.competitor!.maxPrice!.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Position */}
                  <td className="px-3 py-3 text-right">
                    {hasData ? (
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${positioning.color}`}>
                        <PositionIcon className="w-3 h-3" />
                        {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Competitor Count + Freshness */}
                  <td className="px-3 py-3 text-right">
                    {hasData ? (
                      <div>
                        <p className="font-medium text-foreground">{listing.competitor!.competitorCount}</p>
                        <p className={`text-[10px] ${freshnessInfo.className}`} title={itemCooldownLabel(listing)}>
                          {freshnessInfo.label}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {listing.ebayUrl && (
                        <a
                          href={listing.ebayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded hover:bg-secondary transition-colors"
                          title="View on eBay"
                        >
                          <ExternalLink className="w-4 h-4 text-primary" />
                        </a>
                      )}
                      <button
                        onClick={() => handleRefreshItem(listing)}
                        disabled={isRefreshing}
                        className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
                          coolingDown
                            ? "text-muted-foreground/40 cursor-not-allowed"
                            : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                        }`}
                        title={coolingDown ? itemCooldownLabel(listing) + " — wait 30min to refresh" : "Refresh competitor data"}
                      >
                        {isRefreshing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : coolingDown ? (
                          <Clock className="w-4 h-4" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="text-center py-8">
          <Eye className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "No listings match your search" : "No listings found"}
          </p>
        </div>
      )}
    </div>
  );
}