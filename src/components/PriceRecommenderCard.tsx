import { useState, useEffect } from "react";
import {
  TrendingUp, DollarSign, Loader2, ExternalLink, Shield,
  ChevronDown, ChevronUp, CheckCircle2, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import PriceStrategyBadge from "@/components/PriceStrategyBadge";
import PriceHistogram from "@/components/PriceHistogram";
import { buildPriceRecommendation, confidenceColor, confidenceBg, confidenceLabel } from "@/lib/priceRecommender";
import type { PriceRecommendation, PriceSuggestion } from "@/types/price-recommender";
import type { PriceRecommenderProps } from "@/types/price-recommender";

export default function PriceRecommenderCard({
  title,
  condition = "PRE_OWNED_GOOD",
  priceMin = 0,
  priceMax = 0,
  metalType = "none",
  metalWeightOz = 0,
  meltValue = null,
  onApplyPrice,
  compact = false,
}: PriceRecommenderProps) {
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<PriceRecommendation | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<PriceSuggestion | null>(null);
  const [appliedPrice, setAppliedPrice] = useState<number | null>(null);
  const [showComps, setShowComps] = useState(false);
  const [histogram, setHistogram] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(title);

  const fetchPricing = async (searchQuery: string) => {
    if (!searchQuery?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("ebay-pricing", {
        body: { query: searchQuery },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      const rec = buildPriceRecommendation(
        data.soldItems || [],
        condition,
        priceMin,
        priceMax,
        meltValue ?? undefined
      );
      setRecommendation(rec);
      setSelectedSuggestion(rec.recommended);
      setHistogram(data.histogram || []);
    } catch (err: any) {
      console.error("PriceRecommender fetch error:", err);
      // Fallback: build recommendation from AI estimates
      const fallback = buildPriceRecommendation([], condition, priceMin, priceMax, meltValue ?? undefined);
      setRecommendation(fallback);
      setSelectedSuggestion(fallback.recommended);
      setError("eBay lookup failed — showing AI-based estimates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (title) {
      setQuery(title);
      fetchPricing(title);
    }
  }, [title, condition]);

  const handleApply = () => {
    if (!selectedSuggestion || !onApplyPrice) return;
    onApplyPrice(selectedSuggestion.price);
    setAppliedPrice(selectedSuggestion.price);
  };

  const handleRefresh = () => {
    setAppliedPrice(null);
    fetchPricing(query);
  };

  // ─── Compact mode (for draft cards) ─────────────────────────────────────────
  if (compact) {
    return (
      <div className="bg-card border border-border rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">Price Advisor</span>
          </div>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        {recommendation && !loading && (
          <div className="space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {recommendation.suggestions.map((s) => (
                <PriceStrategyBadge
                  key={s.strategy}
                  strategy={s.strategy}
                  badge={s.badge}
                  badgeColor={s.badgeColor}
                  badgeBg={s.badgeBg}
                  selected={selectedSuggestion?.strategy === s.strategy}
                  onClick={() => setSelectedSuggestion(s)}
                />
              ))}
            </div>

            {selectedSuggestion && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-foreground">
                    ${selectedSuggestion.price.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {selectedSuggestion.description}
                  </p>
                </div>
                {onApplyPrice && (
                  <button
                    onClick={handleApply}
                    disabled={appliedPrice === selectedSuggestion.price}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      appliedPrice === selectedSuggestion.price
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                        : "bg-primary text-primary-foreground hover:opacity-90"
                    }`}
                  >
                    {appliedPrice === selectedSuggestion.price ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Applied
                      </>
                    ) : (
                      "Apply"
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!recommendation && !loading && (
          <p className="text-xs text-muted-foreground">Enter a title to get price suggestions</p>
        )}
      </div>
    );
  }

  // ─── Full mode ───────────────────────────────────────────────────────────────
  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm text-foreground">Smart Price Recommender</h3>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Searching eBay comparable listings..."
              : recommendation
              ? recommendation.confidenceReason
              : "AI-powered pricing strategy"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {!loading && recommendation && (
            <button
              onClick={handleRefresh}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh pricing data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          ⚠️ {error}
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-muted rounded-lg" />
          <div className="h-16 bg-muted rounded-lg" />
          <div className="h-12 bg-muted rounded-lg" />
        </div>
      )}

      {recommendation && !loading && (
        <>
          {/* Confidence badge */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${confidenceBg(recommendation.confidence)}`}>
            <span className={confidenceColor(recommendation.confidence)}>
              {recommendation.confidence === "high" ? "✓" : recommendation.confidence === "medium" ? "~" : "!"}
            </span>
            <span className={confidenceColor(recommendation.confidence)}>
              {confidenceLabel(recommendation.confidence)}
            </span>
            <span className="text-muted-foreground ml-1">
              {recommendation.confidenceReason}
            </span>
          </div>

          {/* Market stats row */}
          <div className="grid grid-cols-3 gap-2 bg-secondary/50 rounded-lg p-3">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Low</p>
              <p className="text-base font-bold text-foreground">${recommendation.marketLow.toFixed(2)}</p>
            </div>
            <div className="text-center border-x border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Median</p>
              <p className="text-base font-bold text-primary">${recommendation.marketMedian.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">High</p>
              <p className="text-base font-bold text-foreground">${recommendation.marketHigh.toFixed(2)}</p>
            </div>
          </div>

          {/* Price histogram */}
          {histogram.length > 0 && (
            <PriceHistogram
              histogram={histogram}
              selectedPrice={selectedSuggestion?.price}
            />
          )}

          {/* Condition note */}
          {recommendation.conditionMultiplier < 1.0 && (
            <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Condition Adjustment: </span>
              {recommendation.conditionNote}
            </div>
          )}

          {/* Melt floor warning */}
          {recommendation.meltFloor && recommendation.meltFloor > 0 && (
            <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              <Shield className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <span className="font-medium">Melt floor: ${recommendation.meltFloor.toFixed(2)}</span>
                {" "}— Don't list below this to avoid selling at a loss
              </p>
            </div>
          )}

          {/* Strategy selector */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Choose Your Strategy
            </p>
            <div className="grid grid-cols-1 gap-2">
              {recommendation.suggestions.map((s) => {
                const isSelected = selectedSuggestion?.strategy === s.strategy;
                return (
                  <button
                    key={s.strategy}
                    onClick={() => setSelectedSuggestion(s)}
                    className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 border transition-all text-left ${
                      isSelected
                        ? `${s.badgeBg} border-current`
                        : "bg-background border-border hover:bg-muted/50"
                    }`}
                  >
                    {/* Strategy icon */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? s.badgeBg : "bg-muted"}`}>
                      <span className="text-sm">
                        {s.strategy === "undercut" ? "⚡" :
                         s.strategy === "match" ? "⚖️" :
                         s.strategy === "premium" ? "💎" : "🛡️"}
                      </span>
                    </div>

                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${isSelected ? s.badgeColor : "text-foreground"}`}>
                          {s.label}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.badgeBg} ${s.badgeColor}`}>
                          {s.badge}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                    </div>

                    {/* Price */}
                    <div className="text-right flex-shrink-0">
                      <p className={`text-lg font-bold ${isSelected ? s.badgeColor : "text-foreground"}`}>
                        ${s.price.toFixed(2)}
                      </p>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${s.badgeColor}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Apply button */}
          {onApplyPrice && selectedSuggestion && (
            <button
              onClick={handleApply}
              disabled={appliedPrice === selectedSuggestion.price}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all ${
                appliedPrice === selectedSuggestion.price
                  ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                  : "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]"
              }`}
            >
              {appliedPrice === selectedSuggestion.price ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Applied ${selectedSuggestion.price.toFixed(2)} to listing
                </>
              ) : (
                <>
                  <DollarSign className="w-4 h-4" />
                  Apply ${selectedSuggestion.price.toFixed(2)} to Listing
                </>
              )}
            </button>
          )}

          {/* Comparable sold listings (collapsible) */}
          {recommendation.soldItems.length > 0 && (
            <div className="space-y-1">
              <button
                onClick={() => setShowComps(!showComps)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                {showComps ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {showComps ? "Hide" : "Show"} {recommendation.soldItems.length} comparable listing{recommendation.soldItems.length !== 1 ? "s" : ""}
              </button>

              {showComps && (
                <div className="space-y-1.5 pt-1">
                  {recommendation.soldItems.slice(0, 8).map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 py-1.5 border-b border-border last:border-0"
                    >
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-8 h-8 rounded object-cover flex-shrink-0 border border-border"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground">{item.condition}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-sm font-semibold text-foreground">
                          ${item.price.toFixed(2)}
                        </span>
                        {item.itemUrl && (
                          <a
                            href={item.itemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}