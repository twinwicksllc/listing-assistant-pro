import { TrendingUp, TrendingDown, Minus, RefreshCw, Users, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { CompetitorDetailsModal } from "@/components/CompetitorDetailsModal";

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

interface CompetitorPriceCardProps {
  listingId: string;
  title: string;
  categoryId?: string;
  yourPrice: number;
  ebayUrl?: string | null;
  competitor: CompetitorPriceSnapshot | null | undefined;
  onRefreshed: (snapshot: CompetitorPriceSnapshot) => void;
}

export function CompetitorPriceCard({
  listingId,
  title,
  categoryId,
  yourPrice,
  ebayUrl,
  competitor,
  onRefreshed,
}: CompetitorPriceCardProps) {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleRefresh = async () => {
    if (!user?.id || refreshing) return;
    setRefreshing(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "ebay-competitor-search",
        {
          body: {
            userId: user.id,
            listingId,
            title,
            categoryId,
            yourPrice,
          },
        }
      );

      if (error || data?.error) {
        toast.error("Could not fetch competitor prices");
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

  // No data yet — show a prompt to fetch
  if (!competitor) {
    return (
      <div className="mt-2 pt-2 border-t border-border/50">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Searching eBay..." : "Check competitor prices"}
        </button>
      </div>
    );
  }

  const { avgPrice, minPrice, maxPrice, priceDelta, competitorCount, fetchedAt } = competitor;

  // Compute position label and icon
  const deltaPct =
    avgPrice && avgPrice > 0
      ? Math.round(((yourPrice - avgPrice) / avgPrice) * 100)
      : null;

  const positionLabel =
    deltaPct === null
      ? null
      : deltaPct < -5
      ? "Below market"
      : deltaPct > 5
      ? "Above market"
      : "At market";

  const PositionIcon =
    deltaPct === null
      ? Minus
      : deltaPct < -5
      ? TrendingDown
      : deltaPct > 5
      ? TrendingUp
      : Minus;

  const positionColor =
    deltaPct === null
      ? "text-muted-foreground"
      : deltaPct < -5
      ? "text-blue-500"
      : deltaPct > 5
      ? "text-amber-500"
      : "text-green-500";

  const formattedAge = (() => {
    const diffMs = Date.now() - new Date(fetchedAt).getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  })();

  return (
    <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="w-3 h-3" />
          <span>
            {competitorCount} similar listing{competitorCount !== 1 ? "s" : ""}
          </span>
          {avgPrice != null && (
            <span>
              · avg{" "}
              <span className="font-medium text-foreground">
                ${avgPrice.toFixed(2)}
              </span>
            </span>
          )}
          {minPrice != null && maxPrice != null && (
            <span className="text-[10px]">
              (${minPrice.toFixed(0)}–${maxPrice.toFixed(0)})
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title={`Last updated ${formattedAge}`}
          className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {positionLabel && (
        <div className={`flex items-center gap-1 text-xs font-medium ${positionColor}`}>
          <PositionIcon className="w-3 h-3" />
          <span>{positionLabel}</span>
          {deltaPct !== null && (
            <span className="font-normal text-muted-foreground">
              ({deltaPct > 0 ? "+" : ""}
              {deltaPct}% vs avg)
            </span>
          )}
          <span className="text-muted-foreground text-[10px] font-normal ml-auto">
            {formattedAge}
          </span>
        </div>
      )}

      {/* Mini price distribution bar */}
      {competitor.priceDistribution.length > 1 && (
        <PriceDistributionBar
          distribution={competitor.priceDistribution}
          yourPrice={yourPrice}
        />
      )}

      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-0.5 text-xs text-primary hover:underline mt-0.5"
      >
        View details <ChevronRight className="w-3 h-3" />
      </button>

      {showModal && (
        <CompetitorDetailsModal
          listingId={listingId}
          title={title}
          categoryId={categoryId}
          yourPrice={yourPrice}
          ebayUrl={ebayUrl}
          competitor={competitor}
          onClose={() => setShowModal(false)}
          onRefreshed={(snapshot) => {
            onRefreshed(snapshot);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Tiny inline distribution bar — shows relative price bucket heights
// and highlights which bucket your price falls into.
// ----------------------------------------------------------------
function PriceDistributionBar({
  distribution,
  yourPrice,
}: {
  distribution: { min: number; max: number; count: number }[];
  yourPrice: number;
}) {
  const maxCount = Math.max(...distribution.map((b) => b.count), 1);

  return (
    <div className="flex items-end gap-0.5 h-5 mt-1">
      {distribution.map((bucket, i) => {
        const heightPct = Math.round((bucket.count / maxCount) * 100);
        const isYours =
          yourPrice >= bucket.min && yourPrice <= bucket.max;
        return (
          <div
            key={i}
            title={`$${bucket.min.toFixed(0)}–$${bucket.max.toFixed(0)}: ${bucket.count} listing${bucket.count !== 1 ? "s" : ""}`}
            className={`flex-1 rounded-sm transition-all ${
              isYours
                ? "bg-primary"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            style={{ height: `${Math.max(heightPct, 10)}%` }}
          />
        );
      })}
    </div>
  );
}
