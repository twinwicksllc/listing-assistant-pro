import { TrendingUp, Cpu, Code, DollarSign } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatTokensInMillions } from "./types";
import type { AiProviderStats } from "./types";

interface GeminiUsageSectionProps {
  gemini: AiProviderStats;
}

export function GeminiUsageSection({ gemini }: GeminiUsageSectionProps) {
  return (
    <>
      {/* AI Calls Bar Chart */}
      {gemini?.last30Days &&
        Array.isArray(gemini.last30Days) &&
        gemini.last30Days.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              AI Calls (Last 30 Days)
            </h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gemini.last30Days}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="calls"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    name="API Calls"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      {/* Daily Cost Trend Line Chart */}
      {gemini?.last30DaysCost &&
        Array.isArray(gemini.last30DaysCost) &&
        gemini.last30DaysCost.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Daily Cost Trend (Last 30 Days)
            </h2>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={gemini.last30DaysCost}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    tick={{
                      fontSize: 10,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(value: unknown) =>
                      `$${parseFloat(String(value)).toFixed(4)}`
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="cost"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    name="Daily Cost"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

      {/* Token Breakdown Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Code className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              Input Tokens
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatTokensInMillions(gemini.inputTokens ?? 0)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            ${((gemini.inputTokens ?? 0) * 0.00000125).toFixed(4)}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Code className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              Output Tokens
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatTokensInMillions(gemini.outputTokens ?? 0)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            ${((gemini.outputTokens ?? 0) * 0.000005).toFixed(4)}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              Total Cost
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${gemini.estimatedCost.toFixed(4)}
          </p>
          <p className="text-[10px] text-muted-foreground">30-day total</p>
        </div>
      </div>

      {/* Cost by Function Table */}
      {gemini?.byFunction && Object.keys(gemini.byFunction).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Cpu className="w-4 h-4 text-primary" />
              Gemini Cost by Function
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-foreground">
                    Function
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Calls
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Input
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Output
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.entries(gemini.byFunction)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([funcName, stats]) => (
                    <tr
                      key={funcName}
                      className="hover:bg-secondary/50 transition-colors"
                    >
                      <td className="px-4 py-2 text-foreground font-medium">
                        {funcName}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {stats.calls}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {formatTokensInMillions(stats.inputTokens ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {formatTokensInMillions(stats.outputTokens ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-foreground">
                        ${stats.cost.toFixed(4)}
                        {gemini.estimatedCost > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            {(
                              (stats.cost / gemini.estimatedCost) *
                              100
                            ).toFixed(1)}
                            %
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
