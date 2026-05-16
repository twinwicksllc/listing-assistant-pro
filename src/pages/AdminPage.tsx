import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  DollarSign,
  Bell,
  CheckCircle2,
} from "lucide-react";

import { ADMIN_EMAIL } from "@/components/admin/types";
import type { SystemData } from "@/components/admin/types";
import { SystemStatusChecklist } from "@/components/admin/SystemStatusChecklist";
import { StatsCards } from "@/components/admin/StatsCards";
import { FeatureUsageCard } from "@/components/admin/FeatureUsageCard";
import { GeminiUsageSection } from "@/components/admin/GeminiUsageSection";
import { OpenAiUsageSection } from "@/components/admin/OpenAiUsageSection";

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
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.email === ADMIN_EMAIL) fetchStatus();
  }, [user]);

  if (user?.email !== ADMIN_EMAIL) return null;

  return (
    <div className="min-h-screen bg-background pb-12">
      <header className="px-5 pt-12 pb-4 md:px-8 lg:px-12">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/home")}
              className="p-2 rounded-lg hover:bg-secondary text-muted-foreground"
            >
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

            {/* Last Cost Alert */}
            <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Last Cost Alert Sent</p>
                  {data.lastCostAlert ? (
                    <p className="text-xs text-muted-foreground">
                      {new Date(data.lastCostAlert.sent_at).toLocaleString()} — $
                      {Number(data.lastCostAlert.total_cost).toFixed(2)} across{" "}
                      {data.lastCostAlert.total_requests} requests
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No alerts sent yet</p>
                  )}
                </div>
              </div>
              {data.lastCostAlert && <CheckCircle2 className="w-4 h-4 text-accent flex-shrink-0" />}
            </div>

            <SystemStatusChecklist data={data} />

            <StatsCards data={data} />

            <FeatureUsageCard featureUsage={data.featureUsage} />

            <GeminiUsageSection gemini={data.gemini} />

            {data.openai && (data.openai.totalCalls > 0 || true) && (
              <OpenAiUsageSection openai={data.openai} />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
