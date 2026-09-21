import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { SystemData } from "./types";

interface QuotaMonitoringCardProps {
  data: SystemData["quotaMonitoring"];
}

// Daily combined-total warn line -- matches the 90% threshold this app's own
// checkBrowseQuotaHeadroom/ebay-quota-monitor gate on (5,000/day limit),
// per the 2026-09-21 quota-storm fix's monitoring checklist item 1.
const DAILY_COMBINED_WARN_THRESHOLD = 4500;

/**
 * Post-merge health view for the 2026-09-21 Browse API quota-storm fix
 * (PR #610: reset-window gate + ITEMS_REFRESH_PROBE_CAP=5). Covers all 4
 * items from todo.md's "Quota Storm Fix -- Monitoring Checklist":
 * (1) daily combined browse-call volume vs. the ~4,500/day warn line,
 * (2) whether the quota poll is fresh enough for checkBrowseQuotaHeadroom
 * to still be using real reset_at boundaries rather than a UTC-midnight
 * fallback, (3) how often attemptItemsRefresh's isItemsRefreshUsable check
 * rejects the probe-capped getItems result, and (4) is covered by the
 * existing competitor-prices-cron logs, not duplicated here.
 */
export function QuotaMonitoringCard({ data }: QuotaMonitoringCardProps) {
  if (!data) {
    return (
      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
        <Activity className="w-4 h-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Quota Monitoring
          </p>
          <p className="text-xs text-muted-foreground">No data yet</p>
        </div>
      </div>
    );
  }

  const { last7Days, itemsRefreshOutcomes, pollFreshness } = data;

  const chartData = last7Days.map((d) => ({
    date: d.date,
    browseCalls: d.browseCalls,
    itemBulkCalls: d.itemBulkCalls,
    combined: d.browseCalls + d.itemBulkCalls,
  }));

  const todayCombined =
    chartData.length > 0 ? chartData[chartData.length - 1].combined : 0;
  const isVolumeWarn = todayCombined >= DAILY_COMBINED_WARN_THRESHOLD;

  const totalOutcomes =
    itemsRefreshOutcomes.accepted +
    itemsRefreshOutcomes.rejectedUsability +
    itemsRefreshOutcomes.rejectedNoStoredIds +
    itemsRefreshOutcomes.error;
  const rejectionRatio =
    totalOutcomes > 0
      ? itemsRefreshOutcomes.rejectedUsability / totalOutcomes
      : 0;

  return (
    <div className="space-y-3">
      <div
        className={`bg-card border rounded-xl p-4 flex items-center justify-between ${
          isVolumeWarn ? "border-destructive/30" : "border-border"
        }`}
      >
        <div className="flex items-center gap-3">
          <Activity
            className={`w-4 h-4 ${isVolumeWarn ? "text-destructive" : "text-muted-foreground"}`}
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              Quota Monitoring
            </p>
            <p
              className={`text-xs ${isVolumeWarn ? "text-destructive" : "text-muted-foreground"}`}
            >
              Today: {todayCombined} combined Browse API calls
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {pollFreshness.isStale
                ? "Poll stale -- checkBrowseQuotaHeadroom may be using a UTC-midnight fallback boundary"
                : `Poll fresh -- real reset_at boundaries in use (last polled ${
                    pollFreshness.polledAt
                      ? new Date(pollFreshness.polledAt).toLocaleString()
                      : "unknown"
                  })`}
            </p>
          </div>
        </div>
        {isVolumeWarn || pollFreshness.isStale ? (
          <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />
        )}
      </div>

      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            Browse API Calls by Resource (Last 7 Days)
          </h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <Bar
                  dataKey="browseCalls"
                  stackId="calls"
                  fill="hsl(var(--primary))"
                  name="buy.browse"
                />
                <Bar
                  dataKey="itemBulkCalls"
                  stackId="calls"
                  fill="hsl(var(--accent))"
                  radius={[4, 4, 0, 0]}
                  name="buy.browse.item.bulk"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div
        className={`bg-card border rounded-xl p-4 space-y-2 ${
          rejectionRatio > 0.3 ? "border-destructive/30" : "border-border"
        }`}
      >
        <h2 className="text-sm font-semibold text-foreground">
          Items-Refresh Outcomes (Last 7 Days)
        </h2>
        {totalOutcomes === 0 ? (
          <p className="text-xs text-muted-foreground">
            No refresh attempts logged yet
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <p className="text-lg font-bold text-foreground">
                  {itemsRefreshOutcomes.accepted}
                </p>
                <p className="text-[10px] text-muted-foreground">Accepted</p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">
                  {itemsRefreshOutcomes.rejectedUsability}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Rejected (thin)
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">
                  {itemsRefreshOutcomes.rejectedNoStoredIds}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  No stored ids
                </p>
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">
                  {itemsRefreshOutcomes.error}
                </p>
                <p className="text-[10px] text-muted-foreground">Error</p>
              </div>
            </div>
            <p
              className={`text-xs ${rejectionRatio > 0.3 ? "text-destructive" : "text-muted-foreground"}`}
            >
              {(rejectionRatio * 100).toFixed(1)}% of attempts rejected for thin
              survival -- ITEMS_REFRESH_PROBE_CAP may need revisiting if this
              stays high.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
