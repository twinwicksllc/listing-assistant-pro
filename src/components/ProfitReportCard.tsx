import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ProfitReportCardProps {
  period: "7d" | "30d" | "90d";
  grossRevenue: number;
  totalCogs: number;
  ebayFees: number;
  shippingNet: number;       // shippingCollected - shippingLabels
  otherDeductions: number;   // refunds + nonSaleCharges + disputes - credits
  netProfit: number;
  trueMarginPct: number | null;  // null when no revenue
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
}

const PERIOD_LABELS: Record<string, string> = {
  "7d":  "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
};

export default function ProfitReportCard({
  period,
  grossRevenue,
  totalCogs,
  ebayFees,
  shippingNet,
  otherDeductions,
  netProfit,
  trueMarginPct,
}: ProfitReportCardProps) {
  const profitPositive = netProfit >= 0;
  const profitColor = profitPositive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500 dark:text-red-400";
  const profitBg = profitPositive ? "bg-emerald-500/10" : "bg-red-500/10";

  const TrendIcon =
    trueMarginPct == null
      ? Minus
      : trueMarginPct >= 20
      ? TrendingUp
      : trueMarginPct >= 0
      ? Minus
      : TrendingDown;

  const marginColor =
    trueMarginPct == null
      ? "text-muted-foreground"
      : trueMarginPct >= 40
      ? "text-emerald-600 dark:text-emerald-400"
      : trueMarginPct >= 20
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-500 dark:text-red-400";

  const rows: { label: string; value: number; sign: "+" | "−" | "=" }[] = [
    { label: "Gross Revenue",    value: grossRevenue,    sign: "+" },
    { label: "Item Costs (COGS)", value: totalCogs,       sign: "−" },
    { label: "eBay Fees",         value: ebayFees,        sign: "−" },
    { label: "Shipping Net",      value: shippingNet,     sign: shippingNet >= 0 ? "+" : "−" },
    { label: "Refunds & Other",   value: otherDeductions, sign: "−" },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {PERIOD_LABELS[period]}
        </h3>
        {trueMarginPct != null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${marginColor}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span>{trueMarginPct.toFixed(1)}% margin</span>
          </div>
        )}
      </div>

      {/* Waterfall rows */}
      <div className="space-y-1.5">
        {rows.map(({ label, value, sign }) => {
          if (value === 0) return null;
          const isNeg = sign === "−";
          return (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className={isNeg ? "text-red-500 dark:text-red-400" : "text-foreground"}>
                {isNeg ? "−" : "+"}{fmtMoney(value)}
              </span>
            </div>
          );
        })}

        {/* Divider */}
        <div className="border-t border-border pt-1.5 mt-1">
          <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 ${profitBg}`}>
            <span className={`text-xs font-bold ${profitColor}`}>True Net Profit</span>
            <span className={`text-sm font-bold ${profitColor}`}>
              {profitPositive ? "+" : "−"}{fmtMoney(netProfit)}
            </span>
          </div>
        </div>
      </div>

      {/* No revenue empty state */}
      {grossRevenue === 0 && (
        <p className="text-[11px] text-muted-foreground text-center pt-1">
          No sales in this period
        </p>
      )}
    </div>
  );
}