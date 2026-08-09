import type {
  PriceRecommendation,
  PriceSuggestion,
  PriceConfidence,
  SoldComp,
} from "@/types/price-recommender";

// ─── Condition adjustment multipliers ────────────────────────────────────────
// Based on eBay market research: how much each condition sells relative to NEW

const CONDITION_MULTIPLIERS: Record<string, number> = {
  NEW: 1.0,
  LIKE_NEW: 0.95,
  NEW_OTHER: 0.9,
  NEW_WITH_DEFECTS: 0.85,
  CERTIFIED_REFURBISHED: 0.88,
  EXCELLENT_REFURBISHED: 0.82,
  VERY_GOOD_REFURBISHED: 0.75,
  GOOD_REFURBISHED: 0.68,
  SELLER_REFURBISHED: 0.72,
  PRE_OWNED_GOOD: 0.8,
  PRE_OWNED_FAIR: 0.65,
  PRE_OWNED_POOR: 0.5,
  FOR_PARTS_OR_NOT_WORKING: 0.3,
};

const CONDITION_NOTES: Record<string, string> = {
  NEW: "New items command full market price",
  LIKE_NEW: "Like New items sell ~5% below market average",
  NEW_OTHER: "New Other items sell ~10% below market average",
  NEW_WITH_DEFECTS: "New with Defects items sell ~15% below market average",
  CERTIFIED_REFURBISHED:
    "Certified Refurbished items sell ~12% below market average",
  EXCELLENT_REFURBISHED:
    "Excellent Refurbished items sell ~18% below market average",
  VERY_GOOD_REFURBISHED:
    "Very Good Refurbished items sell ~25% below market average",
  GOOD_REFURBISHED: "Good Refurbished items sell ~32% below market average",
  SELLER_REFURBISHED: "Seller Refurbished items sell ~28% below market average",
  PRE_OWNED_GOOD: "Pre-Owned Good items sell ~20% below market average",
  PRE_OWNED_FAIR: "Pre-Owned Fair items sell ~35% below market average",
  PRE_OWNED_POOR: "Pre-Owned Poor items sell ~50% below market average",
  FOR_PARTS_OR_NOT_WORKING: "For Parts items sell ~70% below market average",
};

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

function getConfidence(compsCount: number): {
  confidence: PriceConfidence;
  reason: string;
} {
  if (compsCount >= 8) {
    return {
      confidence: "high",
      reason: `Based on ${compsCount} comparable sold listings`,
    };
  } else if (compsCount >= 3) {
    return {
      confidence: "medium",
      reason: `Based on ${compsCount} comparable listings — moderate confidence`,
    };
  } else if (compsCount > 0) {
    return {
      confidence: "low",
      reason: `Only ${compsCount} comparable listing${compsCount === 1 ? "" : "s"} found — low confidence`,
    };
  }
  return {
    confidence: "low",
    reason: "No eBay comps found — using AI estimate",
  };
}

// ─── Build price suggestions ──────────────────────────────────────────────────

function buildSuggestions(
  adjustedAvg: number,
  adjustedLow: number,
  adjustedHigh: number,
  meltFloor?: number,
): PriceSuggestion[] {
  const suggestions: PriceSuggestion[] = [];

  // Undercut: 5-10% below adjusted average
  const undercutPrice = round2(Math.max(adjustedLow, adjustedAvg * 0.93));
  suggestions.push({
    strategy: "undercut",
    price: undercutPrice,
    label: "Undercut Market",
    description: "~7% below average — attracts buyers quickly",
    badge: "Fast Sale",
    badgeColor: "text-green-700 dark:text-green-400",
    badgeBg: "bg-green-50 dark:bg-green-950/40",
  });

  // Match: at adjusted average
  const matchPrice = round2(adjustedAvg);
  suggestions.push({
    strategy: "match",
    price: matchPrice,
    label: "Match Market",
    description: "At market average — balanced speed & profit",
    badge: "Balanced",
    badgeColor: "text-blue-700 dark:text-blue-400",
    badgeBg: "bg-blue-50 dark:bg-blue-950/40",
  });

  // Premium: 10-15% above adjusted average (capped at high)
  const premiumPrice = round2(Math.min(adjustedHigh, adjustedAvg * 1.12));
  if (premiumPrice > matchPrice) {
    suggestions.push({
      strategy: "premium",
      price: premiumPrice,
      label: "Premium Price",
      description: "~12% above average — maximize profit",
      badge: "Max Profit",
      badgeColor: "text-purple-700 dark:text-purple-400",
      badgeBg: "bg-purple-50 dark:bg-purple-950/40",
    });
  }

  // Melt floor: only for precious metals
  if (meltFloor && meltFloor > 0) {
    const floorPrice = round2(meltFloor * 1.25); // 25% above melt to cover eBay fees + margin
    suggestions.push({
      strategy: "floor",
      price: floorPrice,
      label: "Melt Floor",
      description: "25% above melt value — covers eBay fees & protects profit",
      badge: "Metal Floor",
      badgeColor: "text-amber-700 dark:text-amber-400",
      badgeBg: "bg-amber-50 dark:bg-amber-950/40",
    });
  }

  return suggestions;
}

// ─── Main recommendation function ────────────────────────────────────────────

export function buildPriceRecommendation(
  soldItems: SoldComp[],
  condition: string = "USED_EXCELLENT",
  priceMin: number = 0,
  priceMax: number = 0,
  meltFloor?: number,
): PriceRecommendation {
  const multiplier = CONDITION_MULTIPLIERS[condition] ?? 0.8;
  const conditionNote =
    CONDITION_NOTES[condition] ?? "Condition adjustment applied";

  let marketAvg: number;
  let marketLow: number;
  let marketHigh: number;
  let marketMedian: number;
  let compsCount: number;

  if (soldItems.length > 0) {
    const prices = soldItems.map((i) => i.price).sort((a, b) => a - b);
    compsCount = prices.length;
    marketLow = prices[0];
    marketHigh = prices[prices.length - 1];
    marketAvg = round2(prices.reduce((a, b) => a + b, 0) / prices.length);
    marketMedian = round2(median(prices));
  } else {
    // Fallback to AI estimates
    compsCount = 0;
    marketLow = priceMin;
    marketHigh = priceMax;
    marketAvg = round2((priceMin + priceMax) / 2);
    marketMedian = marketAvg;
  }

  // Apply condition multiplier to get condition-adjusted prices
  const adjustedAvg = round2(marketMedian * multiplier);
  const adjustedLow = round2(marketLow * multiplier);
  const adjustedHigh = round2(marketHigh * multiplier);

  const { confidence, reason } = getConfidence(compsCount);

  const suggestions = buildSuggestions(
    adjustedAvg,
    adjustedLow,
    adjustedHigh,
    meltFloor,
  );

  // Default recommended: "match" strategy, or "floor" if melt is above market
  let recommended =
    suggestions.find((s) => s.strategy === "match") ?? suggestions[0];

  // If melt floor strategy price is above the match price, recommend floor instead
  const floorSuggestion = suggestions.find((s) => s.strategy === "floor");
  if (floorSuggestion && recommended.price < floorSuggestion.price) {
    recommended = floorSuggestion;
  }

  return {
    suggestions,
    recommended,
    confidence,
    confidenceReason: reason,
    marketAvg,
    marketLow,
    marketHigh,
    marketMedian,
    compsCount,
    conditionMultiplier: multiplier,
    conditionNote,
    meltFloor,
    soldItems,
  };
}

// ─── Confidence badge helpers ─────────────────────────────────────────────────

export function confidenceColor(c: PriceConfidence): string {
  if (c === "high") return "text-green-700 dark:text-green-400";
  if (c === "medium") return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

export function confidenceBg(c: PriceConfidence): string {
  if (c === "high")
    return "bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800";
  if (c === "medium")
    return "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800";
  return "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800";
}

export function confidenceLabel(c: PriceConfidence): string {
  if (c === "high") return "High Confidence";
  if (c === "medium") return "Medium Confidence";
  return "Low Confidence";
}
