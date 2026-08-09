import {
  CheckCircle2,
  XCircle,
  Activity,
  CreditCard,
  Zap,
  Cpu,
} from "lucide-react";
import { formatTokensInMillions } from "./types";
import type { SystemData } from "./types";

interface SystemStatusChecklistProps {
  data: SystemData;
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="w-5 h-5 text-accent" />
  ) : (
    <XCircle className="w-5 h-5 text-destructive" />
  );
}

export function SystemStatusChecklist({ data }: SystemStatusChecklistProps) {
  return (
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
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                data.stripe.mode === "live"
                  ? "bg-accent/15 text-accent"
                  : "bg-yellow-500/15 text-yellow-600"
              }`}
            >
              {data.stripe.mode === "live"
                ? "LIVE"
                : data.stripe.mode === "test"
                  ? "TEST"
                  : "?"}
            </span>
            <StatusIcon
              ok={!data.stripe.error && data.stripe.mode !== "unknown"}
            />
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

        {/* Gemini */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Cpu className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Gemini AI</p>
              <p className="text-xs text-muted-foreground">
                {data.gemini.totalCalls} calls ·{" "}
                {formatTokensInMillions(data.gemini.totalTokens ?? 0)} tokens ·
                ${(data.gemini.estimatedCost ?? 0).toFixed(4)} (30d)
              </p>
            </div>
          </div>
          <StatusIcon ok={true} />
        </div>

        {/* OpenAI */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">
                OpenAI (GPT-4o)
              </p>
              <p className="text-xs text-muted-foreground">
                {data.openai?.totalCalls ?? 0} calls ·{" "}
                {formatTokensInMillions(data.openai?.totalTokens ?? 0)} tokens ·
                ${(data.openai?.estimatedCost ?? 0).toFixed(4)} (30d)
              </p>
            </div>
          </div>
          <StatusIcon ok={true} />
        </div>
      </div>
    </div>
  );
}
