import { AlertTriangle, Copy } from "lucide-react";
import type { InsightFlag } from "@/lib/listingInsights";

interface InsightFlagBadgeProps {
  flags: InsightFlag[];
}

const FLAG_STYLES: Record<
  InsightFlag["type"],
  { icon: typeof AlertTriangle; className: string }
> = {
  overpriced: {
    icon: AlertTriangle,
    className: "text-amber-500 bg-amber-500/10",
  },
  underpriced: {
    icon: AlertTriangle,
    className: "text-blue-500 bg-blue-500/10",
  },
  stale: {
    icon: AlertTriangle,
    className: "text-destructive bg-destructive/10",
  },
  duplicate: { icon: Copy, className: "text-muted-foreground bg-muted" },
};

export function InsightFlagBadge({ flags }: InsightFlagBadgeProps) {
  if (flags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {flags.map((flag, i) => {
        const { icon: Icon, className } = FLAG_STYLES[flag.type];
        return (
          <span
            key={`${flag.type}-${i}`}
            title={flag.message}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}
          >
            <Icon className="w-3 h-3" />
            {flag.type}
          </span>
        );
      })}
    </div>
  );
}
