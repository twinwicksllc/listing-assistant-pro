// ================================================================
// Feature #6: Auto-Optimization Types
// ================================================================

export interface OptimizationItem {
  listingId: string;
  offerId: string | null;
  sku: string;
  title: string;
  imageUrl: string;
  currentPrice: number;
  suggestedPrice: number | null;
  avgSoldPrice: number | null;
  avgActivePrice: number | null;
  sellThroughRate: number;
  competitionLevel: "low" | "medium" | "high";
  demandSignal: "weak" | "moderate" | "strong";
  daysActive: number;
  opportunityScore: number; // 0-100
  flags: OptimizationFlag[];
  categoryId?: string | null;
  listingDate?: string | null;
  ebayUrl?: string | null;
}

export type OptimizationFlag = "overpriced" | "underpriced" | "stale" | "poor_title";

export interface OptimizationSuggestion {
  type: "price" | "title" | "description";
  currentValue: string;
  suggestedValue: string | null;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  estimatedImpact: string;
}

export interface PriceSuggestion {
  suggestedPrice: number | null;
  reasoning: string;
  direction: "lower" | "raise" | "keep";
  confidence: "low" | "medium" | "high";
  estimatedImpact: string;
}

export interface TitleSuggestion {
  suggestedTitle: string | null;
  reasoning: string;
  issuesFound: string[];
  confidence: "low" | "medium" | "high";
}

export interface OptimizeListingResult {
  listingId: string;
  opportunityScore: number;
  flags: OptimizationFlag[];
  priceSuggestion: PriceSuggestion;
  titleSuggestion: TitleSuggestion;
  market: {
    soldCount: number;
    activeCount: number;
    avgSoldPrice: number | null;
    minSoldPrice: number | null;
    maxSoldPrice: number | null;
    avgActivePrice: number | null;
    minActivePrice: number | null;
    maxActivePrice: number | null;
    sellThroughRate: number;
    competitionLevel: "low" | "medium" | "high";
    demandSignal: "weak" | "moderate" | "strong";
  } | null;
  noData: boolean;
}

// ----------------------------------------------------------------
// Reprice Rules
// ----------------------------------------------------------------
export type RepriceRuleType = "match_lowest" | "beat_lowest" | "match_avg" | "match_sold_avg";

export interface RepriceRule {
  id: string;
  userId: string;
  ruleName: string;
  ruleType: RepriceRuleType;
  adjustmentPct: number;   // e.g. -5 = 5% below, +5 = 5% above
  floorPrice: number | null;
  ceilingPrice: number | null;
  categoryFilter: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepriceRuleInput {
  ruleName: string;
  ruleType: RepriceRuleType;
  adjustmentPct: number;
  floorPrice: number | null;
  ceilingPrice: number | null;
  categoryFilter: string | null;
  isEnabled: boolean;
}

// ----------------------------------------------------------------
// Optimization History
// ----------------------------------------------------------------
export type OptimizationType = "price" | "title" | "description" | "reprice_rule";
export type OptimizationResult = "accepted" | "dismissed" | "pending";
export type AppliedBy = "user" | "auto";

export interface OptimizationHistoryEntry {
  id: string;
  userId: string;
  listingId: string;
  listingTitle: string | null;
  optimizationType: OptimizationType;
  oldValue: string | null;
  newValue: string | null;
  reasoning: string | null;
  appliedAt: string;
  appliedBy: AppliedBy;
  result: OptimizationResult;
  createdAt: string;
}

// ----------------------------------------------------------------
// Auto-Reprice Cron Result
// ----------------------------------------------------------------
export interface RepriceRunResult {
  listingId: string | null;
  title: string;
  oldPrice: number;
  newPrice: number;
  ruleApplied: string;
  ruleType: RepriceRuleType;
  applied: boolean;
  error: string | null;
}

export interface RepriceRunResponse {
  success: boolean;
  dryRun: boolean;
  processed: number;
  results: RepriceRunResult[];
}

// ----------------------------------------------------------------
// Rule type labels and descriptions
// ----------------------------------------------------------------
export const RULE_TYPE_LABELS: Record<RepriceRuleType, string> = {
  match_lowest: "Match Lowest Active Price",
  beat_lowest: "Beat Lowest Active Price",
  match_avg: "Match Avg Active Price",
  match_sold_avg: "Match Avg Sold Price",
};

export const RULE_TYPE_DESCRIPTIONS: Record<RepriceRuleType, string> = {
  match_lowest: "Set your price equal to the current lowest competitor price",
  beat_lowest: "Set your price below the current lowest competitor by the adjustment %",
  match_avg: "Set your price to the average of all active competitor prices",
  match_sold_avg: "Set your price to the average of recently sold prices (recommended)",
};