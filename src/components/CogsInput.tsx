import { DollarSign, Lock, X, TrendingUp } from "lucide-react";

const EBAY_COINS_FEE_RATE = 0.13;

interface CogsInputProps {
  cogs: number | undefined;
  listingPrice: number;
  onChange: (cogs: number | undefined) => void;
  disabled?: boolean; // true for non-Pro users → show upgrade prompt
  className?: string;
  domain?: string; // used to apply category-specific marketplace fees
}

export default function CogsInput({
  cogs,
  listingPrice,
  onChange,
  disabled = false,
  className = "",
  domain,
}: CogsInputProps) {
  const isCoinsBullion = domain === "coins_bullion";
  const ebayFee =
    isCoinsBullion && listingPrice > 0 ? listingPrice * EBAY_COINS_FEE_RATE : 0;

  const estProfit =
    cogs != null && listingPrice > 0 ? listingPrice - cogs - ebayFee : null;
  const margin =
    estProfit != null && listingPrice > 0
      ? (estProfit / listingPrice) * 100
      : null;

  const profitColor =
    estProfit == null
      ? "text-muted-foreground"
      : estProfit >= 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-500 dark:text-red-400";

  const marginColor =
    margin == null
      ? "text-muted-foreground"
      : margin >= 40
        ? "text-emerald-600 dark:text-emerald-400"
        : margin >= 20
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-500 dark:text-red-400";

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <DollarSign className="w-3.5 h-3.5 text-primary" />
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Item Cost (COGS)
        </label>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          Optional
        </span>
      </div>

      {disabled ? (
        /* Locked state for non-Pro users */
        <div className="w-full bg-muted/40 border border-border rounded-lg px-3 py-2.5 flex items-center gap-2 opacity-70">
          <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">
            COGS tracking available on{" "}
            <span className="font-semibold text-primary">Pro</span> &{" "}
            <span className="font-semibold text-primary">Shop</span> plans
          </span>
        </div>
      ) : (
        <>
          {/* Input row */}
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-muted-foreground pointer-events-none">
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cogs ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "" || raw === undefined) {
                  onChange(undefined);
                } else {
                  const parsed = parseFloat(raw);
                  onChange(isNaN(parsed) ? undefined : parsed);
                }
              }}
              placeholder="0.00"
              className="w-full bg-card border border-border rounded-lg pl-7 pr-8 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {cogs != null && (
              <button
                type="button"
                onClick={() => onChange(undefined)}
                className="absolute right-2.5 text-muted-foreground hover:text-foreground transition-colors"
                title="Clear cost"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Live profit preview */}
          {cogs != null && listingPrice > 0 && (
            <div className="space-y-0.5 px-1">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className={`text-xs font-medium ${profitColor}`}>
                  Est. Profit:{" "}
                  {estProfit != null
                    ? `${estProfit >= 0 ? "+" : ""}$${estProfit.toFixed(2)}`
                    : "—"}
                </span>
                {margin != null && (
                  <span className={`text-xs ${marginColor}`}>
                    ({margin.toFixed(1)}% margin)
                  </span>
                )}
              </div>
              {isCoinsBullion && ebayFee > 0 && (
                <p className="text-[11px] text-muted-foreground/70 pl-5">
                  Includes 13% eBay fee (−${ebayFee.toFixed(2)})
                </p>
              )}
            </div>
          )}

          {/* Warning if cost exceeds listing price after fees */}
          {cogs != null &&
            listingPrice > 0 &&
            estProfit != null &&
            estProfit < 0 &&
            cogs <= listingPrice &&
            isCoinsBullion && (
              <p className="text-[11px] text-red-500 px-1">
                ⚠ Loss after 13% eBay fee — consider raising your price.
              </p>
            )}
          {cogs != null && listingPrice > 0 && cogs > listingPrice && (
            <p className="text-[11px] text-red-500 px-1">
              ⚠ Cost exceeds listing price — you would lose money on this sale.
            </p>
          )}
        </>
      )}
    </div>
  );
}
