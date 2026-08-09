import { useState } from "react";
import {
  Search,
  ExternalLink,
  TrendingUp,
  Users,
  ShoppingBag,
  BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import SellThroughMeter from "./SellThroughMeter";
import type { KeywordResearchResult, TopItem } from "@/types/market-research";

interface KeywordResearchPanelProps {
  onSaveWatch?: (query: string, label?: string) => void;
  initialQuery?: string;
}

function CompetitionBadge({ level }: { level: "low" | "medium" | "high" }) {
  const map = {
    low: "bg-green-500/10 text-green-600 border-green-500/30",
    medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    high: "bg-red-500/10 text-red-500 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[level]}`}>
      {level.charAt(0).toUpperCase() + level.slice(1)} Competition
    </Badge>
  );
}

function DemandBadge({ signal }: { signal: "weak" | "moderate" | "strong" }) {
  const map = {
    weak: "bg-red-500/10 text-red-500 border-red-500/30",
    moderate: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
    strong: "bg-green-500/10 text-green-600 border-green-500/30",
  };
  const icon = {
    weak: "📉",
    moderate: "📊",
    strong: "🔥",
  };
  return (
    <Badge variant="outline" className={`text-xs ${map[signal]}`}>
      {icon[signal]} {signal.charAt(0).toUpperCase() + signal.slice(1)} Demand
    </Badge>
  );
}

function TopItemRow({ item }: { item: TopItem }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border last:border-0">
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt={item.title}
          className="w-10 h-10 object-cover rounded shrink-0 bg-muted"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-10 h-10 rounded bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs truncate font-medium">{item.title}</p>
        <p className="text-[10px] text-muted-foreground">{item.condition}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold">${item.price.toFixed(2)}</p>
        {item.itemUrl && (
          <a
            href={item.itemUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5"
          >
            View <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function KeywordResearchPanel({
  onSaveWatch,
  initialQuery = "",
}: KeywordResearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KeywordResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"competitors" | "sold">(
    "competitors",
  );

  const runResearch = async (q: string = query) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "keyword-research",
        {
          body: { query: q.trim() },
        },
      );

      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);

      setResult(data as KeywordResearchResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") runResearch();
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="e.g. iPhone 13 Pro, vintage Rolex, Pokemon cards..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9"
          />
        </div>
        <Button
          onClick={() => runResearch()}
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching…" : "Research"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && !result.noData && (
        <div className="space-y-4">
          {/* Market overview stats */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">"{result.query}"</p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <CompetitionBadge level={result.competitionLevel} />
                  <DemandBadge signal={result.demandSignal} />
                  {result.fromCache && (
                    <Badge variant="secondary" className="text-[10px]">
                      Cached
                    </Badge>
                  )}
                </div>
              </div>
              <SellThroughMeter rate={result.sellThroughRate} size="md" />
            </div>

            {/* Key metrics grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Sold stats */}
              <div className="bg-muted/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Sold
                </div>
                <p className="text-2xl font-bold">{result.soldCount}</p>
                {result.avgSoldPrice != null && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      Avg:{" "}
                      <span className="text-foreground font-medium">
                        ${result.avgSoldPrice.toFixed(2)}
                      </span>
                    </p>
                    {result.medianSoldPrice != null && (
                      <p className="text-xs text-muted-foreground">
                        Median:{" "}
                        <span className="text-foreground font-medium">
                          ${result.medianSoldPrice.toFixed(2)}
                        </span>
                      </p>
                    )}
                    {result.p25SoldPrice != null &&
                      result.p75SoldPrice != null && (
                        <p className="text-xs text-muted-foreground">
                          IQR:{" "}
                          <span className="text-foreground font-medium">
                            ${result.p25SoldPrice.toFixed(2)} – $
                            {result.p75SoldPrice.toFixed(2)}
                          </span>
                        </p>
                      )}
                  </div>
                )}
              </div>

              {/* Active stats */}
              <div className="bg-muted/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <Users className="w-3.5 h-3.5" />
                  Active
                </div>
                <p className="text-2xl font-bold">{result.activeCount}</p>
                {result.avgActivePrice != null && (
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">
                      Avg:{" "}
                      <span className="text-foreground font-medium">
                        ${result.avgActivePrice.toFixed(2)}
                      </span>
                    </p>
                    {result.minActivePrice != null &&
                      result.maxActivePrice != null && (
                        <p className="text-xs text-muted-foreground">
                          Range:{" "}
                          <span className="text-foreground font-medium">
                            ${result.minActivePrice.toFixed(2)} – $
                            {result.maxActivePrice.toFixed(2)}
                          </span>
                        </p>
                      )}
                  </div>
                )}
              </div>
            </div>

            {/* Sell-through rate bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <BarChart2 className="w-3.5 h-3.5" /> Sell-Through Rate
                </span>
                <span className="font-semibold">
                  {result.sellThroughRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    result.sellThroughRate >= 60
                      ? "bg-green-500"
                      : result.sellThroughRate >= 30
                        ? "bg-yellow-500"
                        : "bg-red-400"
                  }`}
                  style={{ width: `${Math.min(result.sellThroughRate, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {result.soldCount} sold /{" "}
                {result.soldCount + result.activeCount} total listings
              </p>
            </div>

            {/* Save watch button */}
            {onSaveWatch && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => onSaveWatch(result.query)}
              >
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                Save as Watch
              </Button>
            )}
          </div>

          {/* Top listings tabs */}
          {(result.topCompetitors.length > 0 || result.topSold.length > 0) && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b border-border">
                <button
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    activeTab === "competitors"
                      ? "bg-primary/5 text-primary border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("competitors")}
                >
                  Active Listings ({result.topCompetitors.length})
                </button>
                <button
                  className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                    activeTab === "sold"
                      ? "bg-primary/5 text-primary border-b-2 border-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab("sold")}
                >
                  Recently Sold ({result.topSold.length})
                </button>
              </div>

              <div className="p-3">
                {activeTab === "competitors" &&
                  result.topCompetitors.length > 0 && (
                    <div>
                      {result.topCompetitors.map((item, i) => (
                        <TopItemRow key={i} item={item} />
                      ))}
                    </div>
                  )}
                {activeTab === "sold" && result.topSold.length > 0 && (
                  <div>
                    {result.topSold.map((item, i) => (
                      <TopItemRow key={i} item={item} />
                    ))}
                  </div>
                )}
                {activeTab === "competitors" &&
                  result.topCompetitors.length === 0 && (
                    <p className="text-xs text-muted-foreground py-2 text-center">
                      No active listings found.
                    </p>
                  )}
                {activeTab === "sold" && result.topSold.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    No sold listings found.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {result?.noData && (
        <div className="rounded-lg bg-muted/40 border border-border px-4 py-6 text-center space-y-1">
          <p className="text-sm font-medium">No results found</p>
          <p className="text-xs text-muted-foreground">
            Try a different search term or broaden your query.
          </p>
        </div>
      )}
    </div>
  );
}
