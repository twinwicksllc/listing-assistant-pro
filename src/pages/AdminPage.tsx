import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Users, CreditCard, Cpu, Zap, ArrowLeft, Activity, DollarSign, Bell, TrendingUp, Code
} from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const ADMIN_EMAIL = "twinwicksllc@gmail.com";

interface SystemData {
  stripe: { mode: string; activeSubscriptions: number; error: string };
  ebay: { ok: boolean; error: string };
  totalUsers: number;
  gemini: {
    totalTokens: number;
    totalCalls: number;
    estimatedCost: number;
    inputTokens: number;
    outputTokens: number;
    last30Days: { date: string; calls: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
    last30DaysCost: { date: string; calls: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
    byFunction: Record<string, { calls: number; cost: number; inputTokens: number; outputTokens: number }>;
  };
  featureUsage: { ai_analysis: number; ebay_publish: number; optimize: number; export: number };
  lastCostAlert: { sent_at: string; total_cost: number; total_requests: number } | null;
}

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.email !== ADMIN_EMAIL) {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const fetchStatus = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: fnErr } = await supabase.functions.invoke("system-status");
      if (fnErr) throw new Error(fnErr.message);
      if (result?.error) throw new Error(result.error);
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.email === ADMIN_EMAIL) fetchStatus();
  }, [user]);

  if (user?.email !== ADMIN_EMAIL) return null;

  const StatusIcon = ({ ok }: { ok: boolean }) =>
    ok ? <CheckCircle2 className="w-5 h-5 text-accent" /> : <XCircle className="w-5 h-5 text-destructive" />;

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/home")} className="p-2 rounded-lg hover:bg-secondary text-muted-foreground">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              <div>
                <h1 className="text-lg font-bold text-foreground">Admin Control Center</h1>
                <p className="text-xs text-muted-foreground">System status & metrics</p>
              </div>
            </div>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="px-5 md:px-8 lg:px-12 max-w-3xl mx-auto space-y-5">
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {loading && !data ? (
          <div className="text-center py-20">
            <RefreshCw className="w-6 h-6 text-muted-foreground animate-spin mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Loading system status...</p>
          </div>
        ) : data ? (
          <>
            {/* Cost Alert Banner */}
            {data.gemini.estimatedCost >= 50 && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    ⚠️ Monthly AI Cost Alert: ${data.gemini.estimatedCost.toFixed(2)}
                  </p>
                  <p className="text-xs text-destructive/80 mt-0.5">
                    Gemini API costs have exceeded the $50.00 monthly threshold. Review usage patterns or consider rate limiting.
                  </p>
                </div>
              </div>
            )}

            {/* Last Cost Alert Sent */}
            <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Last Cost Alert Sent</p>
                  {data.lastCostAlert ? (
                    <p className="text-xs text-muted-foreground">
                      {new Date(data.lastCostAlert.sent_at).toLocaleString()} — ${Number(data.lastCostAlert.total_cost).toFixed(2)} across {data.lastCostAlert.total_requests} requests
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No alerts sent yet</p>
                  )}
                </div>
              </div>
              {data.lastCostAlert && <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />}
            </div>

            {/* System Checklist */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  System Status Checklist
                </h2>
              </div>

              <div className="divide-y divide-border">
                {/* Stripe */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Stripe</p>
                      <p className="text-xs text-muted-foreground">
                        {data.stripe.error || `Mode: ${data.stripe.mode.toUpperCase()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      data.stripe.mode === "live"
                        ? "bg-accent/15 text-accent"
                        : "bg-yellow-500/15 text-yellow-600"
                    }`}>
                      {data.stripe.mode === "live" ? "LIVE" : data.stripe.mode === "test" ? "TEST" : "?"}
                    </span>
                    <StatusIcon ok={!data.stripe.error && data.stripe.mode !== "unknown"} />
                  </div>
                </div>

                {/* eBay */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">eBay API</p>
                      <p className="text-xs text-muted-foreground">
                        {data.ebay.ok ? "Reachable" : data.ebay.error || "Unreachable"}
                      </p>
                    </div>
                  </div>
                  <StatusIcon ok={data.ebay.ok} />
                </div>

                {/* Gemini / AI */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Cpu className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Gemini AI</p>
                      <p className="text-xs text-muted-foreground">
                        {data.gemini.totalCalls} calls · {data.gemini.totalTokens.toLocaleString()} tokens (30d)
                      </p>
                    </div>
                  </div>
                  <StatusIcon ok={true} />
                </div>
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Total Users</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{data.totalUsers}</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Active Subs</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{data.stripe.activeSubscriptions}</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">AI Calls (30d)</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{data.gemini.totalCalls}</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Est. AI Cost</span>
                </div>
                <p className="text-2xl font-bold text-foreground">${data.gemini.estimatedCost.toFixed(4)}</p>
                <p className="text-[10px] text-muted-foreground">{data.gemini.totalTokens.toLocaleString()} tokens</p>
              </div>
            </div>

            {/* Feature Usage */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Feature Usage (30 Days)</h2>
              </div>
              <div className="divide-y divide-border">
                {[
                  { label: "Analyze (AI)", count: data.featureUsage.ai_analysis, icon: "🔍" },
                  { label: "Optimize", count: data.featureUsage.optimize, icon: "✨" },
                  { label: "Publish", count: data.featureUsage.ebay_publish, icon: "📤" },
                  { label: "Export", count: data.featureUsage.export, icon: "💾" },
                ].map((item) => (
                  <div key={item.label} className="px-4 py-3 flex items-center justify-between">
                    <span className="text-sm text-foreground flex items-center gap-2">
                      <span>{item.icon}</span>
                      {item.label}
                    </span>
                    <span className="text-sm font-bold text-foreground">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Gemini Usage Chart */}
            {data.gemini?.last30Days && Array.isArray(data.gemini.last30Days) && data.gemini.last30Days.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold text-foreground">AI Calls (Last 30 Days)</h2>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.gemini.last30Days}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="API Calls" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Daily Cost Trend Chart */}
            {data.gemini?.last30DaysCost && Array.isArray(data.gemini.last30DaysCost) && data.gemini.last30DaysCost.length > 0 && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Daily Cost Trend (Last 30 Days)
                </h2>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.gemini.last30DaysCost}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value: any) => `$${parseFloat(value).toFixed(4)}`}
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

            {/* Token Breakdown */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Code className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Input Tokens</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{data.gemini.inputTokens.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">${(data.gemini.inputTokens * 0.00000125).toFixed(4)}</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Code className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Output Tokens</span>
                </div>
                <p className="text-2xl font-bold text-foreground">{data.gemini.outputTokens.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">${(data.gemini.outputTokens * 0.000005).toFixed(4)}</p>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Total Cost</span>
                </div>
                <p className="text-2xl font-bold text-foreground">${data.gemini.estimatedCost.toFixed(4)}</p>
                <p className="text-[10px] text-muted-foreground">30-day total</p>
              </div>
            </div>

            {/* Cost by Function */}
            {data.gemini?.byFunction && Object.keys(data.gemini.byFunction).length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-primary" />
                    Cost by Function
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-secondary/50">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-foreground">Function</th>
                        <th className="px-4 py-2 text-right font-semibold text-foreground">Calls</th>
                        <th className="px-4 py-2 text-right font-semibold text-foreground">Input Tokens</th>
                        <th className="px-4 py-2 text-right font-semibold text-foreground">Output Tokens</th>
                        <th className="px-4 py-2 text-right font-semibold text-foreground">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {Object.entries(data.gemini.byFunction)
                        .sort((a, b) => b[1].cost - a[1].cost)
                        .map(([funcName, stats]) => (
                          <tr key={funcName} className="hover:bg-secondary/50 transition-colors">
                            <td className="px-4 py-2 text-foreground font-medium">{funcName}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{stats.calls}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{stats.inputTokens.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right text-muted-foreground">{stats.outputTokens.toLocaleString()}</td>
                            <td className="px-4 py-2 text-right font-semibold text-foreground">
                              ${stats.cost.toFixed(4)}
                              <div className="text-[10px] text-muted-foreground">
                                {((stats.cost / data.gemini.estimatedCost) * 100).toFixed(1)}%
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
