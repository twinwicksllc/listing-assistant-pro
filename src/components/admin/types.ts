export const ADMIN_EMAIL = "twinwicksllc@gmail.com";

export const formatTokensInMillions = (tokens: number): string => {
  const millions = tokens / 1_000_000;
  return millions.toFixed(3) + "M";
};

export interface AiProviderStats {
  totalCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  last30Days: { date: string; calls: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
  last30DaysCost: { date: string; calls: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
  byFunction: Record<string, { calls: number; cost: number; inputTokens: number; outputTokens: number }>;
  byUser?: { userId: string; calls: number; cost: number }[];
}

export interface SystemData {
  stripe: { mode: string; activeSubscriptions: number; error: string };
  ebay: { ok: boolean; error: string };
  totalUsers: number;
  gemini: AiProviderStats;
  openai: AiProviderStats;
  featureUsage: { ai_analysis: number; ebay_publish: number; optimize: number; export: number };
  lastCostAlert: { sent_at: string; total_cost: number; total_requests: number } | null;
}
