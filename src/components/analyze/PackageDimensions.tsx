import { Package } from "lucide-react";

interface PackageDimensionsProps {
  weightLb: number;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  onWeightLbChange: (v: number) => void;
  onWeightOzChange: (v: number) => void;
  onLengthInChange: (v: number) => void;
  onWidthInChange: (v: number) => void;
  onHeightInChange: (v: number) => void;
}

/** Numeric input helper — returns 0 for empty/invalid, positive number otherwise */
function parsePositiveFloat(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const inputCls =
  "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary";

export function PackageDimensions({
  weightLb,
  weightOz,
  lengthIn,
  widthIn,
  heightIn,
  onWeightLbChange,
  onWeightOzChange,
  onLengthInChange,
  onWidthInChange,
  onHeightInChange,
}: PackageDimensionsProps) {
  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5 text-primary" />
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Package Weight &amp; Dimensions
        </label>
      </div>

      {/* Weight row */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Shipping weight (used for calculated-rate shipping)
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="sr-only">Pounds</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="1"
                value={weightLb > 0 ? weightLb : ""}
                onChange={(e) =>
                  onWeightLbChange(parsePositiveFloat(e.target.value))
                }
                placeholder="0"
                className={inputCls}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                lb
              </span>
            </div>
          </div>
          <div className="flex-1">
            <label className="sr-only">Ounces</label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="15.99"
                step="0.1"
                value={weightOz > 0 ? weightOz : ""}
                onChange={(e) =>
                  onWeightOzChange(parsePositiveFloat(e.target.value))
                }
                placeholder="0"
                className={inputCls}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                oz
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Dimensions row */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Package dimensions (optional, inches)
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.1"
                value={lengthIn > 0 ? lengthIn : ""}
                onChange={(e) =>
                  onLengthInChange(parsePositiveFloat(e.target.value))
                }
                placeholder="L"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.1"
                value={widthIn > 0 ? widthIn : ""}
                onChange={(e) =>
                  onWidthInChange(parsePositiveFloat(e.target.value))
                }
                placeholder="W"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.1"
                value={heightIn > 0 ? heightIn : ""}
                onChange={(e) =>
                  onHeightInChange(parsePositiveFloat(e.target.value))
                }
                placeholder="H"
                className={inputCls}
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground text-right">
          L &times; W &times; H in inches
        </p>
      </div>
    </div>
  );
}
