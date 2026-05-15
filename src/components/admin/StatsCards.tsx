import { Users, CreditCard, Cpu, Zap } from "lucide-react";
import type { SystemData } from "./types";

interface StatsCardsProps {
  data: SystemData;
}

export function StatsCards({ data }: StatsCardsProps) {
  return (
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
        <p className="text-2xl font-bold text-foreground">
          {(data.gemini.totalCalls ?? 0) + (data.openai?.totalCalls ?? 0)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Gemini: {data.gemini.totalCalls ?? 0} · GPT: {data.openai?.totalCalls ?? 0}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Zap className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium uppercase tracking-wide">Total AI Cost</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          ${((data.gemini.estimatedCost ?? 0) + (data.openai?.estimatedCost ?? 0)).toFixed(4)}
        </p>
        <p className="text-[10px] text-muted-foreground">
          Gemini: ${(data.gemini.estimatedCost ?? 0).toFixed(4)} · GPT: ${(data.openai?.estimatedCost ?? 0).toFixed(4)}
        </p>
      </div>
    </div>
  );
}
