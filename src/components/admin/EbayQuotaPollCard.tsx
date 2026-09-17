import { Gauge, CheckCircle2, AlertTriangle } from "lucide-react";
import { EBAY_QUOTA_WARN_THRESHOLD_RATIO } from "./types";
import type { SystemData } from "./types";

interface EbayQuotaPollCardProps {
  poll: SystemData["lastEbayQuotaPoll"];
}

/**
 * Surfaces ebay-quota-monitor's (PR #581/#582) most recent poll of eBay's
 * own getRateLimits, so the admin can see current buy.browse quota status
 * without waiting for a 90%-threshold alert email. Read-only display --
 * no polling or alerting logic lives here.
 */
export function EbayQuotaPollCard({ poll }: EbayQuotaPollCardProps) {
  if (!poll) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
        <Gauge className="w-4 h-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">
            eBay Browse API Quota
          </p>
          <p className="text-xs text-muted-foreground">No poll data yet</p>
        </div>
      </div>
    );
  }

  const usedRatio = poll.call_limit > 0 ? poll.call_count / poll.call_limit : 0;
  const isWarn = usedRatio >= EBAY_QUOTA_WARN_THRESHOLD_RATIO;

  return (
    <div
      className={`bg-card border rounded-xl p-4 flex items-center justify-between ${
        isWarn ? "border-destructive/30" : "border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <Gauge
          className={`w-4 h-4 ${isWarn ? "text-destructive" : "text-muted-foreground"}`}
        />
        <div>
          <p className="text-sm font-medium text-foreground">
            eBay Browse API Quota
          </p>
          <p
            className={`text-xs ${isWarn ? "text-destructive" : "text-muted-foreground"}`}
          >
            {poll.call_remaining} / {poll.call_limit} remaining (
            {(usedRatio * 100).toFixed(1)}% used)
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Polled {new Date(poll.polled_at).toLocaleString()} · Resets{" "}
            {new Date(poll.reset_at).toLocaleString()}
            {poll.alert_sent ? " · Alert sent today" : ""}
          </p>
        </div>
      </div>
      {isWarn ? (
        <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
      )}
    </div>
  );
}
