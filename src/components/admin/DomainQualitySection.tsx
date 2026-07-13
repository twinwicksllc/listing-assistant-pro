import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, AlertCircle, RefreshCw } from "lucide-react";

interface DomainMetric {
  domain: string;
  soldCount: number;
  avgNetProfit: number | null;
  avgSalePrice: number | null;
  avgMarginPct: number | null;
  avgTimeToSaleDays: number | null;
  timeToSaleSampleSize: number;
}

interface RefinementCandidate {
  domain: string;
  reason: string;
}

interface DomainQualityReport {
  metrics: DomainMetric[];
  refinementCandidates: RefinementCandidate[];
  sampleInfo: { totalSoldWithKnownDomain: number; note: string };
}

/**
 * Phase 4 quality-assurance feedback loop UI.
 * Shows per-domain sold-listing metrics (count, avg net profit, avg
 * time-to-sale) and flags domains that may need prompt/extraction
 * refinement based on real sales data.
 *
 * Note: rejection-rate and edit-rate are intentionally NOT shown here -
 * there is no instrumentation yet to track listing edits or eBay publish
 * rejections. See COMPREHENSIVE_LISTING_TYPES_ROADMAP.md Phase 4.
 */
export function DomainQualitySection() {
  const [report, setReport] = useState<DomainQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchReport = async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("domain-quality-report");
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(data.error);
      setReport(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Domain Quality (Sold Listings)</h2>
        </div>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-destructive">{error}</div>
      )}

      {loading && !report ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading domain metrics...</div>
      ) : report && report.metrics.length > 0 ? (
        <>
          {report.refinementCandidates.length > 0 && (
            <div className="px-4 py-3 border-b border-border bg-amber-500/5 space-y-2">
              {report.refinementCandidates.map((c) => (
                <div key={c.domain} className="flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">{c.domain}</span>: {c.reason}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Domain</th>
                  <th className="text-right px-4 py-2 font-medium">Sold</th>
                  <th className="text-right px-4 py-2 font-medium">Avg Net Profit</th>
                  <th className="text-right px-4 py-2 font-medium">Avg Margin</th>
                  <th className="text-right px-4 py-2 font-medium">Avg Time-to-Sale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.metrics.map((m) => (
                  <tr key={m.domain}>
                    <td className="px-4 py-2 text-foreground font-medium">{m.domain}</td>
                    <td className="px-4 py-2 text-right text-foreground">{m.soldCount}</td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {m.avgNetProfit != null ? `$${m.avgNetProfit.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {m.avgMarginPct != null ? `${m.avgMarginPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-foreground">
                      {m.avgTimeToSaleDays != null ? `${m.avgTimeToSaleDays.toFixed(1)}d (n=${m.timeToSaleSampleSize})` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground">{report.sampleInfo.note}</p>
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No sold listings with a known domain yet. Metrics will appear here once orders are matched to drafts with domain tracking.
        </div>
      )}
    </div>
  );
}
