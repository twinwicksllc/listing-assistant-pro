import { useState, useEffect } from "react";
import { RefreshCw, Trash2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow, parseISO } from "date-fns";
import SellThroughMeter from "./SellThroughMeter";
import PriceTrendChart from "./PriceTrendChart";
import type { MarketWatch, MarketPriceHistory } from "@/types/market-research";

interface MarketWatchCardProps {
  watch: MarketWatch;
  isRefreshing: boolean;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onFetchHistory: (id: string) => Promise<MarketPriceHistory[]>;
}

function TrendArrow({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <Minus className="w-3 h-3 text-muted-foreground" />;
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (diff > 0) return <TrendingUp className="w-3 h-3 text-green-500" />;
  return <TrendingDown className="w-3 h-3 text-red-400" />;
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "Never";
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

export default function MarketWatchCard({
  watch,
  isRefreshing,
  onRefresh,
  onDelete,
  onFetchHistory,
}: MarketWatchCardProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MarketPriceHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (showHistory && history.length === 0) {
      setLoadingHistory(true);
      onFetchHistory(watch.id).then((h) => {
        setHistory(h);
        setLoadingHistory(false);
      });
    }
  }, [showHistory, watch.id, history.length, onFetchHistory]);

  // Get previous snapshot for trend arrow
  const prevAvg = history.length >= 2 ? history[history.length - 2]?.avgPrice ?? null : null;

  const str = watch.sellThroughRate ?? 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{watch.label || watch.searchQuery}</p>
          {watch.label && watch.label !== watch.searchQuery && (
            <p className="text-xs text-muted-foreground truncate">"{watch.searchQuery}"</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            Updated {formatAge(watch.lastCheckedAt)}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onRefresh(watch.id)}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(watch.id)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Price stats row */}
      <div className="flex items-center gap-3">
        {/* Sell-through meter */}
        <SellThroughMeter rate={str} size="sm" showLabel={false} />

        {/* Price stats */}
        <div className="flex-1 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg</p>
            <div className="flex items-center justify-center gap-0.5">
              <p className="text-sm font-semibold">
                {watch.avgPrice != null ? `$${watch.avgPrice.toFixed(2)}` : "—"}
              </p>
              <TrendArrow current={watch.avgPrice ?? null} previous={prevAvg} />
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Min</p>
            <p className="text-sm font-semibold">
              {watch.minPrice != null ? `$${watch.minPrice.toFixed(2)}` : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Max</p>
            <p className="text-sm font-semibold">
              {watch.maxPrice != null ? `$${watch.maxPrice.toFixed(2)}` : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {watch.activeCount} active
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {watch.soldCount} sold
        </Badge>
        {str > 0 && (
          <Badge
            variant="secondary"
            className={`text-[10px] ${str >= 60 ? "bg-green-500/10 text-green-600" : str >= 30 ? "bg-yellow-500/10 text-yellow-600" : "bg-red-500/10 text-red-500"}`}
          >
            {str.toFixed(0)}% STR
          </Badge>
        )}
        {watch.lastCheckedAt == null && (
          <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-600">
            Not yet fetched
          </Badge>
        )}
      </div>

      {/* History toggle */}
      <button
        className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
        onClick={() => setShowHistory((v) => !v)}
      >
        {showHistory ? (
          <>
            <ChevronUp className="w-3 h-3" /> Hide price history
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" /> Show price history
          </>
        )}
      </button>

      {showHistory && (
        <div>
          {loadingHistory ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-xs">
              Loading history…
            </div>
          ) : (
            <PriceTrendChart history={history} />
          )}
        </div>
      )}
    </div>
  );
}