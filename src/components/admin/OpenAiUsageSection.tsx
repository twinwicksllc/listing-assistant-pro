import { TrendingUp, Zap, Code, DollarSign, Users } from "lucide-react";
import {
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

interface OpenAiUsageSectionProps {
  openai: AiProviderStats;
}

export function OpenAiUsageSection({ openai }: OpenAiUsageSectionProps) {
  return (
    <>
      <div className="mt-2 mb-1 flex items-center gap-2">
        <Zap className="w-4 h-4 text-green-500" />
        <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">
          OpenAI Usage
        </h2>
        <span className="text-xs text-muted-foreground">
          (GPT-4o · GPT-4o-mini)
        </span>
      </div>

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
            {formatTokensInMillions(openai.inputTokens ?? 0)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            ${((openai.inputTokens ?? 0) * 0.0000025).toFixed(4)}
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
            {formatTokensInMillions(openai.outputTokens ?? 0)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            ${((openai.outputTokens ?? 0) * 0.00001).toFixed(4)}
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              GPT Cost
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${(openai.estimatedCost ?? 0).toFixed(4)}
          </p>
          <p className="text-[10px] text-muted-foreground">30-day total</p>
        </div>
      </div>

      {/* Daily Cost Line Chart */}
      {openai.last30DaysCost && openai.last30DaysCost.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            OpenAI Daily Cost (Last 30 Days)
          </h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={openai.last30DaysCost}>
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
                  formatter={(value: unknown) =>
                    `$${parseFloat(String(value)).toFixed(6)}`
                  }
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="hsl(142, 71%, 45%)"
                  dot={false}
                  name="Daily Cost"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Cost by Function Table */}
      {openai.byFunction && Object.keys(openai.byFunction).length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-green-500" />
              OpenAI Cost by Function
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
                {Object.entries(openai.byFunction)
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
                        ${stats.cost.toFixed(6)}
                        {openai.estimatedCost > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            {(
                              (stats.cost / openai.estimatedCost) *
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

      {/* Top Users by Spend */}
      {openai.byUser && openai.byUser.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-green-500" />
              OpenAI Top Users by Spend (30d)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold text-foreground">
                    User ID
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Calls
                  </th>
                  <th className="px-4 py-2 text-right font-semibold text-foreground">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {openai.byUser.map((u) => (
                  <tr
                    key={u.userId}
                    className="hover:bg-secondary/50 transition-colors"
                  >
                    <td className="px-4 py-2 text-foreground font-mono text-xs">
                      {u.userId}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {u.calls}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-foreground">
                      ${u.cost.toFixed(6)}
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
