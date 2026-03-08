import { TrendingUp, DollarSign, Loader2, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SoldItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemUrl: string | null;
}

interface PricingCardProps {
  priceMin: number;
  priceMax: number;
  searchQuery: string;
}

export default function PricingCard({ priceMin, priceMax, searchQuery }: PricingCardProps) {
  const [loading, setLoading] = useState(false);
  const [soldItems, setSoldItems] = useState<SoldItem[]>([]);
  const [ebayAvg, setEbayAvg] = useState<number | null>(null);
  const [ebayLow, setEbayLow] = useState<number | null>(null);
  const [ebayHigh, setEbayHigh] = useState<number | null>(null);
  const [totalFound, setTotalFound] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  // Use eBay data if available, otherwise fall back to AI estimates
  const displayLow = ebayLow ?? priceMin;
  const displayHigh = ebayHigh ?? priceMax;
  const displayAvg = ebayAvg ?? parseFloat(((priceMin + priceMax) / 2).toFixed(2));
  const hasEbayData = soldItems.length > 0;

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
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {error && (
        <p className="text-xs text-warning bg-warning/10 rounded-lg px-3 py-2">
          eBay lookup failed — showing AI estimates. {error}
        </p>
      )}

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
          // Fallback mock display when no eBay data
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
