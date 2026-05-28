const EBAY_COINS_FEE_RATE = 0.13;

interface ProfitBadgeProps {
  listingPrice: number;
  cogs: number | undefined;
  size?: "sm" | "md";
  domain?: string; // used to apply category-specific marketplace fees
}

export default function ProfitBadge({
  listingPrice,
  cogs,
  size = "sm",
  domain,
}: ProfitBadgeProps) {
  // No COGS recorded → show neutral dash
  if (cogs == null || listingPrice <= 0) {
    return (
      <span
        className={`inline-flex items-center rounded-full font-medium bg-muted text-muted-foreground ${
          size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
        }`}
        title="No cost recorded"
      >
        —
      </span>
    );
  }

  const ebayFee =
    domain === "coins_bullion" ? listingPrice * EBAY_COINS_FEE_RATE : 0;
  const profit = listingPrice - cogs - ebayFee;
  const margin = (profit / listingPrice) * 100;

  // Color tiers
  let colorClass: string;
  if (margin >= 40) {
    colorClass = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  } else if (margin >= 20) {
    colorClass = "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  } else {
    colorClass = "bg-red-500/15 text-red-700 dark:text-red-400";
  }

  const label =
    margin >= 0
      ? `${margin.toFixed(0)}%`
      : `−${Math.abs(margin).toFixed(0)}%`;

  const feeNote =
    domain === "coins_bullion"
      ? ` after 13% eBay fee (−$${ebayFee.toFixed(2)})`
      : "";

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${colorClass} ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      }`}
      title={`Est. profit $${profit.toFixed(2)}${feeNote} (${margin.toFixed(1)}% margin)`}
    >
      {label}
    </span>
  );
}
