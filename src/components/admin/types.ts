export const ADMIN_EMAIL = "twinwicksllc@gmail.com";

// Matches ebay-quota-monitor's WARN_THRESHOLD_RATIO -- kept as a separate
// constant rather than importing across the Deno Edge Function boundary,
// since both live in this repo and change together; duplication is
// disclosed here rather than silent.
export const EBAY_QUOTA_WARN_THRESHOLD_RATIO = 0.9;

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
  last30Days: {
    date: string;
    calls: number;
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  last30DaysCost: {
    date: string;
    calls: number;
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  byFunction: Record<
    string,
    { calls: number; cost: number; inputTokens: number; outputTokens: number }
  >;
  byUser?: { userId: string; calls: number; cost: number }[];
}

export interface SystemData {
  stripe: { mode: string; activeSubscriptions: number; error: string };
  ebay: { ok: boolean; error: string };
  totalUsers: number;
  gemini: AiProviderStats;
  openai: AiProviderStats;
  featureUsage: {
    ai_analysis: number;
    ebay_publish: number;
    optimize: number;
    export: number;
  };
  lastCostAlert: {
    sent_at: string;
    total_cost: number;
    total_requests: number;
  } | null;
  lastEbayQuotaPoll: {
    resource_name: string;
    call_limit: number;
    call_count: number;
    call_remaining: number;
    reset_at: string;
    alert_sent: boolean;
    polled_at: string;
  } | null;
  quotaMonitoring: {
    last7Days: { date: string; browseCalls: number; itemBulkCalls: number }[];
    itemsRefreshOutcomes: {
      accepted: number;
      rejectedUsability: number;
      rejectedNoStoredIds: number;
      error: number;
    };
    pollFreshness: {
      polledAt: string | null;
      isStale: boolean;
    };
  } | null;
}
