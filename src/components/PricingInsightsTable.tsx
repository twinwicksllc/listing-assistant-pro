import { useState, useMemo, useRef } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Eye, ExternalLink, ChevronUp, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ListingWithCompetitor {
  listingId: string | null;
  sku: string;
  title: string;
  price: number;
  ebayUrl?: string | null;
  competitor?: {
    avgPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    competitorCount: number;
    fetchedAt: string;
  } | null;
  imageUrl?: string | null;
}

type SortField = "title" | "price" | "marketAvg" | "delta" | "competitors" | "condition";
type SortDir = "asc" | "desc";

interface PricingInsightsTableProps {
  listings: ListingWithCompetitor[];
  onRefreshCompetitor: (listingId: string) => Promise<void>;
  onPriceChange: (listingId: string | null, newPrice: number) => void;
  userToken: string;
  userId: string;
  isLoading?: boolean;
}

export function PricingInsightsTable({
  listings,
  onRefreshCompetitor,
  onPriceChange,
  userToken,
  userId,
  isLoading = false,
}: PricingInsightsTableProps) {
  const THROTTLE_DELAY = 500; // milliseconds - minimum time between refresh attempts
  const lastRefreshRef = useRef<Record<string, number>>({}); // track last refresh time per listing

  const [sortField, setSortField] = useState<SortField>("delta");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  // Helper functions (must be defined before useMemo that uses them)
  const getDelta = (listing: ListingWithCompetitor): number => {
    if (!listing.competitor?.avgPrice) return 0;
    return ((listing.price - listing.competitor.avgPrice) / listing.competitor.avgPrice) * 100;
  };

  const getPositioning = (delta: number): { label: string; color: string; icon: React.ElementType } => {
    if (delta > 10) return { label: "Over", color: "text-red-500 bg-red-500/10", icon: TrendingUp };
    if (delta > 5) return { label: "High", color: "text-amber-500 bg-amber-500/10", icon: TrendingUp };
    if (delta < -10) return { label: "Under", color: "text-blue-500 bg-blue-500/10", icon: TrendingDown };
    if (delta < -5) return { label: "Low", color: "text-sky-500 bg-sky-500/10", icon: TrendingDown };
    return { label: "Market", color: "text-green-500 bg-green-500/10", icon: Minus };
  };

  // Filter listings
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return listings.filter((l) =>
      l.title.toLowerCase().includes(q) || l.sku.toLowerCase().includes(q)
    );
  }, [listings, searchQuery]);

  // Sort listings
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      
      if (sortField === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (sortField === "price") {
        cmp = a.price - b.price;
      } else if (sortField === "marketAvg") {
        const aAvg = a.competitor?.avgPrice ?? 0;
        const bAvg = b.competitor?.avgPrice ?? 0;
        cmp = aAvg - bAvg;
      } else if (sortField === "delta") {
        const aDelta = getDelta(a);
        const bDelta = getDelta(b);
        cmp = aDelta - bDelta;
      } else if (sortField === "competitors") {
        cmp = (a.competitor?.competitorCount ?? 0) - (b.competitor?.competitorCount ?? 0);
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group"
    >
      {label}
      {sortField === field && (
        sortDir === "asc" ? 
          <ChevronUp className="w-3 h-3 text-primary" /> : 
          <ChevronDown className="w-3 h-3 text-primary" />
      )}
    </button>
  );

  const isDataStale = (fetchedAt?: string) => {
    if (!fetchedAt) return true;
    const hours = (Date.now() - new Date(fetchedAt).getTime()) / 3600000;
    return hours > 24;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
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
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-secondary text-foreground rounded-lg hover:bg-secondary/80 transition-colors"
          title="Refresh all competitor data"
          disabled={isLoading}
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>{filtered.length} listings</span>
        <span>·</span>
        <span>
          Overpriced: {filtered.filter((l) => getDelta(l) > 10).length}
        </span>
        <span>·</span>
        <span>
          Underpriced: {filtered.filter((l) => getDelta(l) < -10).length}
        </span>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-3 py-2 text-left">
                <SortHeader field="title" label="Title / SKU" />
              </th>
              <th className="px-3 py-2 text-right">
                <SortHeader field="price" label="Your Price" />
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
              const delta = getDelta(listing);
              const positioning = getPositioning(delta);
              const PositionIcon = positioning.icon;
              const hasCompetitorData = listing.competitor && listing.competitor.avgPrice;
              const isStale = isDataStale(listing.competitor?.fetchedAt);
              const isRefreshing = refreshing.has(listing.listingId || listing.sku);

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

                  {/* Market Avg */}
                  <td className="px-3 py-3 text-right">
                    {hasCompetitorData ? (
                      <p className="font-medium text-foreground">
                        ${listing.competitor.avgPrice!.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Min - Max */}
                  <td className="px-3 py-3 text-right">
                    {hasCompetitorData ? (
                      <p className="text-xs text-muted-foreground">
                        ${listing.competitor.minPrice!.toFixed(2)} - ${listing.competitor.maxPrice!.toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Position */}
                  <td className="px-3 py-3 text-right">
                    {hasCompetitorData ? (
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${positioning.color}`}>
                        <PositionIcon className="w-3 h-3" />
                        {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground/60">—</p>
                    )}
                  </td>

                  {/* Competitor Count */}
                  <td className="px-3 py-3 text-right">
                    {hasCompetitorData ? (
                      <div>
                        <p className="font-medium text-foreground">{listing.competitor.competitorCount}</p>
                        <p className={`text-[10px] ${isStale ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                          {isStale ? "Stale" : "Fresh"}
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
                        onClick={() => {
                          if (listing.listingId) {
                            // Check throttle - prevent rapid clicks on same listing
                            const now = Date.now();
                            const lastRefresh = lastRefreshRef.current[listing.listingId] || 0;
                            const timeSinceLastRefresh = now - lastRefresh;

                            if (timeSinceLastRefresh < THROTTLE_DELAY) {
                              const remainingMs = THROTTLE_DELAY - timeSinceLastRefresh;
                              console.log(`Refresh throttled (${remainingMs}ms remaining)`);
                              return; // silently ignore too-rapid clicks
                            }

                            // Update last refresh time
                            lastRefreshRef.current[listing.listingId] = now;

                            setRefreshing((prev) => new Set([...prev, listing.listingId!]));
                            onRefreshCompetitor(listing.listingId).finally(() => {
                              setRefreshing((prev) => {
                                const next = new Set(prev);
                                next.delete(listing.listingId!);
                                return next;
                              });
                            });
                          }
                        }}
                        disabled={isRefreshing}
                        className="p-1.5 rounded hover:bg-secondary transition-colors disabled:opacity-50"
                        title="Refresh competitor data"
                      >
                        <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? "animate-spin" : ""}`} />
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
