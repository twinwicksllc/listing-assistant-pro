import type { PriceStrategy } from "@/types/price-recommender";

interface PriceStrategyBadgeProps {
  strategy: PriceStrategy;
  badge: string;
  badgeColor: string;
  badgeBg: string;
  selected?: boolean;
  onClick?: () => void;
}

export default function PriceStrategyBadge({
  strategy,
  badge,
  badgeColor,
  badgeBg,
  selected = false,
  onClick,
}: PriceStrategyBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all border ${
        selected
          ? `${badgeBg} ${badgeColor} border-current ring-2 ring-current/30 scale-105`
          : `bg-muted/50 text-muted-foreground border-border hover:${badgeBg} hover:${badgeColor}`
      }`}
    >
      {strategy === "undercut" && <span>⚡</span>}
      {strategy === "match" && <span>⚖️</span>}
      {strategy === "premium" && <span>💎</span>}
      {strategy === "floor" && <span>🛡️</span>}
      {badge}
    </button>
  );
}
