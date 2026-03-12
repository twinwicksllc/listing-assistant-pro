import { useState } from "react";
import { X, RefreshCw, TrendingUp, TrendingDown, Minus, ExternalLink, Users, DollarSign, BarChart2 } from "lucide-react";
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
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

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
    } catch {
      toast.error("Failed to refresh competitor prices");
    } finally {
      setRefreshing(false);
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

        <div className="p-5 space-y-5">
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
        </div>
      </div>
    </div>
  );
}
