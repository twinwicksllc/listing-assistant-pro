// ─── Price strategy options ───────────────────────────────────────────────────

export type PriceStrategy =
  | "undercut"      // List below market avg to sell fast
  | "match"         // List at market average
  | "premium"       // List above market avg for higher profit
  | "floor";        // List at melt/cost floor (precious metals)

// ─── Confidence level based on number of comps found ─────────────────────────

export type PriceConfidence = "high" | "medium" | "low";

// ─── A single price suggestion with strategy context ─────────────────────────

export interface PriceSuggestion {
  strategy: PriceStrategy;
  price: number;
  label: string;           // e.g. "Undercut Market"
  description: string;     // e.g. "5% below average — sell faster"
  badge: string;           // e.g. "Fast Sale"
  badgeColor: string;      // Tailwind color class e.g. "text-green-600"
  badgeBg: string;         // e.g. "bg-green-50"
}

// ─── Full recommendation result ───────────────────────────────────────────────

export interface PriceRecommendation {
  suggestions: PriceSuggestion[];
  recommended: PriceSuggestion;   // The top pick
  confidence: PriceConfidence;
  confidenceReason: string;       // e.g. "Based on 12 comparable sold listings"

  // Market stats
  marketAvg: number;
  marketLow: number;
  marketHigh: number;
  marketMedian: number;
  compsCount: number;

  // Condition adjustment
  conditionMultiplier: number;    // e.g. 0.85 for PRE_OWNED_FAIR vs NEW
  conditionNote: string;          // e.g. "Pre-Owned Fair items sell 15% below market avg"

  // Optional melt floor
  meltFloor?: number;

  // Raw comps for display
  soldItems: SoldComp[];
}

export interface SoldComp {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemUrl: string | null;
  imageUrl: string | null;
}

// ─── Props for the price recommender component ────────────────────────────────

export interface PriceRecommenderProps {
  title: string;                  // Item title used as search query
  condition?: string;             // eBay condition enum string
  priceMin?: number;              // AI-suggested min (fallback)
  priceMax?: number;              // AI-suggested max (fallback)
  metalType?: string;
  metalWeightOz?: number;
  meltValue?: number | null;
  onApplyPrice?: (price: number) => void;  // Callback when user clicks "Apply"
  compact?: boolean;              // Compact mode for draft cards
}