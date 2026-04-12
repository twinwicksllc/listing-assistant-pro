import { useState, useEffect } from "react";
import { X, RefreshCw, TrendingUp, TrendingDown, Minus, ExternalLink, Users, DollarSign, BarChart2, Lock, Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

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

interface ComparableListing {
  itemId: string;
  title: string;
  price: number;
  sellerInfo: {
    name: string;
    rating: number;
    ratingCount: number;
  };
  condition: string;
  shipping: {
    cost: number;
    free: boolean;
  };
  url: string;
  comparabilityScore: number;
  reason: string;
}

interface CompetitorDetailsModalProps {
  listingId: string;
  title: string;
  categoryId?: string;
  yourPrice: number;
  ebayUrl?: string | null;
  competitor: CompetitorPriceSnapshot;
  onClose: () => void;
  onRefreshed: (snapshot: CompetitorPriceSnapshot) => void;
}

export function CompetitorDetailsModal({
  listingId,
  title,
  categoryId,
  yourPrice,
  ebayUrl,
  competitor,
  onClose,
  onRefreshed,
}: CompetitorDetailsModalProps) {
  const { user, isPro, isShop } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [loadingComparable, setLoadingComparable] = useState(false);
  const [comparable, setComparable] = useState<ComparableListing[]>([]);
  const [activeTab, setActiveTab] = useState<"prices" | "comparable">("prices");

  const canSeeComparable = isPro || isShop;

  // Load comparable listings when modal opens (for Pro/Shop users)
  useEffect(() => {
    if (canSeeComparable && comparable.length === 0 && !loadingComparable) {
      loadComparableListings();
    }
  }, [canSeeComparable]);

  const handleRefresh = async () => {
    if (!user?.id || refreshing) return;
    setRefreshing(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "ebay-competitor-search",
        {
          body: { userId: user.id, listingId, title, categoryId, yourPrice },
        }
      );

      if (error || data?.error) {
        toast.error("Could not refresh competitor prices");
        return;
      }
      if (data?.noData) {
        toast.info("No comparable listings found on eBay");
        return;
      }

      onRefreshed({
        avgPrice: data.avgPrice,
        minPrice: data.minPrice,
        maxPrice: data.maxPrice,
        medianPrice: data.medianPrice,
        priceDelta: data.priceDelta,
        competitorCount: data.competitorCount,
        priceDistribution: data.priceDistribution ?? [],
        fetchedAt: new Date().toISOString(),
      });

      toast.success("Competitor prices updated");

      // Also load comparable listings for paid users
      if (canSeeComparable) {
        await loadComparableListings();
      }
    } catch {
      toast.error("Failed to refresh competitor prices");
    } finally {
      setRefreshing(false);
    }
  };

  const loadComparableListings = async () => {
    if (!user?.id || !canSeeComparable) return;
    setLoadingComparable(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "filter-comparable-listings",
        {
          body: { userId: user.id, title, categoryId },
        }
      );

      if (error || data?.error) {
        console.warn("Could not load comparable listings:", data?.error);
        setComparable([]);
        return;
      }

      setComparable(data.comparable || []);
    } catch (err) {
      console.error("Failed to load comparable listings:", err);
      setComparable([]);
    } finally {
      setLoadingComparable(false);
    }
  };

  const { avgPrice, minPrice, maxPrice, medianPrice, priceDelta, competitorCount, priceDistribution, fetchedAt } = competitor;

  const deltaPct =
    avgPrice && avgPrice > 0
      ? Math.round(((yourPrice - avgPrice) / avgPrice) * 100)
      : null;

  const isBelow = deltaPct !== null && deltaPct < -5;
  const isAbove = deltaPct !== null && deltaPct > 5;

  const positionLabel = isBelow ? "Below market" : isAbove ? "Above market" : "At market";
  const positionColor = isBelow ? "text-blue-500" : isAbove ? "text-amber-500" : "text-green-500";
  const positionBg = isBelow ? "bg-blue-500/10" : isAbove ? "bg-amber-500/10" : "bg-green-500/10";
  const PositionIcon = isBelow ? TrendingDown : isAbove ? TrendingUp : Minus;

  // Actionable recommendation
  const recommendation = (() => {
    if (!avgPrice || deltaPct === null) return null;
    if (isBelow) {
      const potentialGain = avgPrice - yourPrice;
      return `Consider raising your price by $${potentialGain.toFixed(2)} to match the market average.`;
    }
    if (isAbove) {
      const discount = yourPrice - avgPrice;
      return `Lowering by $${discount.toFixed(2)} would bring you to the market average and may improve visibility.`;
    }
    return "Your price aligns well with the market. No change needed.";
  })();

  const formattedAge = (() => {
    const diffMs = Date.now() - new Date(fetchedAt).getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  })();

  const maxCount = Math.max(...(priceDistribution.map((b) => b.count) ?? [1]), 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="flex-1 min-w-0 pr-3">
            <h2 className="text-sm font-semibold text-foreground line-clamp-2">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Competitor price analysis</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs (for Pro/Shop users) */}
        {canSeeComparable && (
          <div className="flex border-b border-border bg-secondary/30">
            <button
              onClick={() => setActiveTab("prices")}
              className={`flex-1 py-3 px-4 text-xs font-medium transition-colors ${
                activeTab === "prices"
                  ? "text-primary border-b-2 border-primary bg-secondary/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <BarChart2 className="w-3.5 h-3.5" />
                Price Stats
              </div>
            </button>
            <button
              onClick={() => setActiveTab("comparable")}
              className={`flex-1 py-3 px-4 text-xs font-medium transition-colors ${
                activeTab === "comparable"
                  ? "text-primary border-b-2 border-primary bg-secondary/50"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="flex items-center justify-center gap-1">
                <Users className="w-3.5 h-3.5" />
                Comparable ({comparable.length})
              </div>
            </button>
          </div>
        )}

        <div className="p-5 space-y-5 max-h-[calc(90vh-180px)] overflow-y-auto">{activeTab === "prices" && (
          <>
          {/* Your price vs market */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/50 rounded-xl p-3 space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Your Price</p>
              <p className="text-xl font-bold text-foreground">${yourPrice.toFixed(2)}</p>
            </div>
            <div className={`${positionBg} rounded-xl p-3 space-y-0.5`}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Market Average</p>
              <p className="text-xl font-bold text-foreground">
                {avgPrice != null ? `$${avgPrice.toFixed(2)}` : "—"}
              </p>
            </div>
          </div>

          {/* Position badge */}
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${positionBg}`}>
            <PositionIcon className={`w-4 h-4 flex-shrink-0 ${positionColor}`} />
            <div className="flex-1 min-w-0">
              <span className={`text-sm font-semibold ${positionColor}`}>{positionLabel}</span>
              {deltaPct !== null && (
                <span className="text-xs text-muted-foreground ml-2">
                  {deltaPct > 0 ? "+" : ""}{deltaPct}% vs avg
                  {priceDelta !== null && (
                    <> · ${Math.abs(priceDelta).toFixed(2)} {priceDelta >= 0 ? "over" : "under"}</>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Recommendation */}
          {recommendation && (
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground leading-relaxed">{recommendation}</p>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Min", value: minPrice },
              { label: "Median", value: medianPrice },
              { label: "Max", value: maxPrice },
            ].map(({ label, value }) => (
              <div key={label} className="bg-secondary/40 rounded-lg py-2 px-1">
                <p className="text-[10px] text-muted-foreground uppercase font-medium">{label}</p>
                <p className="text-sm font-bold text-foreground mt-0.5">
                  {value != null ? `$${value.toFixed(2)}` : "—"}
                </p>
              </div>
            ))}
          </div>

          {/* Price distribution chart */}
          {priceDistribution.length > 1 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <BarChart2 className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Price Distribution
                </p>
              </div>
              <div className="flex items-end gap-1 h-20">
                {priceDistribution.map((bucket, i) => {
                  const heightPct = Math.round((bucket.count / maxCount) * 100);
                  const isYours = yourPrice >= bucket.min && yourPrice <= bucket.max;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-t transition-all ${
                          isYours ? "bg-primary" : "bg-muted-foreground/25"
                        }`}
                        style={{ height: `${Math.max(heightPct, 6)}%` }}
                        title={`$${bucket.min.toFixed(0)}–$${bucket.max.toFixed(0)}: ${bucket.count} listing${bucket.count !== 1 ? "s" : ""}`}
                      />
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels */}
              <div className="flex items-start gap-1 mt-1">
                {priceDistribution.map((bucket, i) => (
                  <div key={i} className="flex-1 text-center">
                    {(i === 0 || i === priceDistribution.length - 1) && (
                      <p className="text-[9px] text-muted-foreground">
                        ${i === 0 ? bucket.min.toFixed(0) : bucket.max.toFixed(0)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {/* Your price indicator */}
              <p className="text-[10px] text-center text-muted-foreground mt-1">
                <span className="inline-block w-2 h-2 rounded-sm bg-primary mr-1 align-middle" />
                Your price position
              </p>
            </div>
          )}

          {/* Footer: count + data age + actions */}
          <div className="flex items-center justify-between pt-1 border-t border-border">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              <span>{competitorCount} comparable listing{competitorCount !== 1 ? "s" : ""} found</span>
            </div>
            <div className="flex items-center gap-2">
              {ebayUrl && (
                <a
                  href={ebayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  eBay
                </a>
              )}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : `Updated ${formattedAge}`}
              </button>
            </div>
          </div>
          </>
        )}

        {activeTab === "comparable" && (
          <div className="space-y-3">
            {/* Pro/Shop only badge */}
            {!canSeeComparable && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Lock className="w-3.5 h-3.5 text-primary" />
                  <p className="text-xs font-medium text-primary">Pro & Shop only</p>
                </div>
                <p className="text-[10px] text-primary/70">
                  Upgrade to see AI-filtered comparable listings that are truly comparable for pricing
                </p>
              </div>
            )}

            {canSeeComparable && (
              <>
                {loadingComparable ? (
                  <div className="text-center py-8">
                    <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Analyzing comparable listings with AI...</p>
                  </div>
                ) : comparable.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="w-5 h-5 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-xs text-muted-foreground">No truly comparable listings found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      AI-Filtered Comparable Listings
                    </p>
                    {comparable.map((listing) => (
                      <a
                        key={listing.itemId}
                        href={listing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-secondary/50 hover:bg-secondary border border-border hover:border-primary rounded-lg p-3 transition-colors group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                              {listing.title}
                            </h3>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Seller: {listing.sellerInfo.name}
                            </p>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        </div>

                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-bold text-primary">${listing.price.toFixed(2)}</p>
                          {listing.shipping.free && (
                            <span className="text-[10px] bg-green-500/20 text-green-700 px-2 py-1 rounded">
                              Free shipping
                            </span>
                          )}
                        </div>

                        {/* Comparability score */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                            <span className="text-[10px] text-muted-foreground">
                              {listing.comparabilityScore}% match
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              {listing.sellerInfo.rating.toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              ({listing.sellerInfo.ratingCount})
                            </span>
                          </div>
                        </div>

                        <p className="text-[9px] text-muted-foreground italic mt-1.5">
                          {listing.reason}
                        </p>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        
        </div>
      </div>
    </div>
  );
}
