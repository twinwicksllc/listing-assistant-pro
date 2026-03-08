import { TrendingUp, DollarSign, Loader2, ExternalLink, Shield } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SoldItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemUrl: string | null;
}

interface SpotPrices {
  gold: number;
  silver: number;
  platinum: number;
}

interface PricingCardProps {
  priceMin: number;
  priceMax: number;
  searchQuery: string;
  metalType?: string;
  metalWeightOz?: number;
}

export default function PricingCard({ priceMin, priceMax, searchQuery, metalType = "none", metalWeightOz = 0 }: PricingCardProps) {
  const [loading, setLoading] = useState(false);
  const [soldItems, setSoldItems] = useState<SoldItem[]>([]);
  const [ebayAvg, setEbayAvg] = useState<number | null>(null);
  const [ebayLow, setEbayLow] = useState<number | null>(null);
  const [ebayHigh, setEbayHigh] = useState<number | null>(null);
  const [totalFound, setTotalFound] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [spotPrices, setSpotPrices] = useState<SpotPrices | null>(null);
  const [meltValue, setMeltValue] = useState<number | null>(null);
  const [spotLoading, setSpotLoading] = useState(false);

  // Fetch eBay pricing
  useEffect(() => {
    if (!searchQuery) return;

    const fetchPricing = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("ebay-pricing", {
          body: { query: searchQuery },
        });

        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        setSoldItems(data.soldItems || []);
        setEbayAvg(data.averagePrice || null);
        setEbayLow(data.lowPrice || null);
        setEbayHigh(data.highPrice || null);
        setTotalFound(data.totalFound || 0);
      } catch (err: any) {
        console.error("Pricing fetch error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPricing();
  }, [searchQuery]);

  // Fetch spot prices when metal info is present
  useEffect(() => {
    if (metalType === "none" || !metalWeightOz || metalWeightOz <= 0) {
      setMeltValue(null);
      setSpotPrices(null);
      return;
    }

    const fetchSpot = async () => {
      setSpotLoading(true);
      try {
        const { data, error: fnError } = await supabase.functions.invoke("spot-prices", {
          body: { metalType, weightOz: metalWeightOz },
        });

        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        setSpotPrices(data.spotPrices || null);
        setMeltValue(data.meltValue || null);
      } catch (err: any) {
        console.error("Spot price fetch error:", err);
      } finally {
        setSpotLoading(false);
      }
    };

    fetchSpot();
  }, [metalType, metalWeightOz]);

  const displayLow = ebayLow ?? priceMin;
  const displayHigh = ebayHigh ?? priceMax;
  const displayAvg = ebayAvg ?? parseFloat(((priceMin + priceMax) / 2).toFixed(2));
  const hasEbayData = soldItems.length > 0;
  const hasMetal = metalType !== "none" && meltValue !== null && meltValue > 0;

  const currentSpotPrice =
    spotPrices && metalType === "gold" ? spotPrices.gold :
    spotPrices && metalType === "silver" ? spotPrices.silver :
    spotPrices && metalType === "platinum" ? spotPrices.platinum : null;

  const isBelowMelt = hasMetal && meltValue !== null && displayAvg < meltValue;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-success" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm text-foreground">Pricing Research</h3>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Searching eBay sold listings..."
              : hasEbayData
              ? `Based on ${totalFound} eBay result${totalFound !== 1 ? "s" : ""}`
              : "AI-estimated pricing"}
          </p>
        </div>
        {(loading || spotLoading) && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <p className="text-xs text-warning bg-warning/10 rounded-lg px-3 py-2">
          eBay lookup failed — showing AI estimates. {error}
        </p>
      )}

      {/* Melt Value Banner */}
      {hasMetal && (
        <div className={`rounded-lg p-3 space-y-1 ${isBelowMelt ? "bg-destructive/10 border border-destructive/30" : "bg-primary/10 border border-primary/20"}`}>
          <div className="flex items-center gap-2">
            <Shield className={`w-4 h-4 ${isBelowMelt ? "text-destructive" : "text-primary"}`} />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
              Melt Value Protection
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                {metalType?.charAt(0).toUpperCase()}{metalType?.slice(1)} spot: ${currentSpotPrice?.toFixed(2)}/oz
              </p>
              <p className="text-xs text-muted-foreground">
                {metalWeightOz} oz × ${currentSpotPrice?.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Melt Value</p>
              <p className={`text-lg font-bold ${isBelowMelt ? "text-destructive" : "text-primary"}`}>
                ${meltValue?.toFixed(2)}
              </p>
            </div>
          </div>
          {isBelowMelt && (
            <p className="text-xs font-medium text-destructive">
              ⚠ Market avg (${displayAvg.toFixed(2)}) is below melt value — do not list below ${meltValue?.toFixed(2)}
            </p>
          )}
        </div>
      )}

      {/* Price Range */}
      <div className="flex items-center justify-between bg-secondary rounded-lg p-3">
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">Low</p>
          <p className="text-lg font-bold text-foreground">${displayLow.toFixed(2)}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">Average</p>
          <p className="text-lg font-bold text-primary">${displayAvg.toFixed(2)}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="text-center flex-1">
          <p className="text-xs text-muted-foreground">High</p>
          <p className="text-lg font-bold text-foreground">${displayHigh.toFixed(2)}</p>
        </div>
      </div>

      {/* Sold Listings */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {hasEbayData ? "eBay Sold Listings" : "Estimated Comps"}
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : soldItems.length > 0 ? (
          soldItems.slice(0, 5).map((item, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <DollarSign className="w-3.5 h-3.5 text-success flex-shrink-0" />
                <span className="text-sm font-medium text-foreground">${item.price.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground truncate">{item.condition}</span>
              </div>
              {item.itemUrl && (
                <a
                  href={item.itemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors ml-2"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))
        ) : (
          [priceMin, (priceMin + priceMax) / 2, priceMax].map((price, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-success" />
                <span className="text-sm font-medium text-foreground">${price.toFixed(2)}</span>
              </div>
              <span className="text-xs text-muted-foreground">AI est.</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
