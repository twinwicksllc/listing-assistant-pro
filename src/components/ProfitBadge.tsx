interface ProfitBadgeProps {
  listingPrice: number;
  cogs: number | undefined;
  size?: "sm" | "md";
}

export default function ProfitBadge({
  listingPrice,
  cogs,
  size = "sm",
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

  const profit = listingPrice - cogs;
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

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${colorClass} ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"
      }`}
      title={`Est. profit $${profit.toFixed(2)} (${margin.toFixed(1)}% margin)`}
    >
      {label}
    </span>
  );
}