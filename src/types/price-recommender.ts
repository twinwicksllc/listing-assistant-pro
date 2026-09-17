// ─── Price strategy options ───────────────────────────────────────────────────

export type PriceStrategy =
  | "undercut" // List below market avg to sell fast
  | "match" // List at market average
  | "premium" // List above market avg for higher profit
  | "floor"; // List at melt/cost floor (precious metals)

// ─── Confidence level based on number of comps found ─────────────────────────

export type PriceConfidence = "high" | "medium" | "low";

// ─── What the comps data actually IS ──────────────────────────────────────────
// "sold" = completed transactions (Jina-scraped eBay sold-search results).
// "active" = current asking prices, never verified to have sold (eBay Browse
// API -- this app has no Marketplace Insights access). "unknown" covers the
// zero-comps/AI-estimate case, where there's no real data to label at all.
export type PriceBasis = "sold" | "active" | "unknown";

// ─── HOW the comps data was obtained, independent of what it IS ──────────────
// "structured" = official eBay Browse API (structured JSON, one call, one
// parse). "scraped" = Jina AI Reader fetching eBay's HTML sold-search page
// and regex-parsing whatever markdown comes back -- it works today, but it's
// the ToS-risk surface flagged in the pricing-reliability plan's Phase 3.3,
// and a strictly noisier extraction than a real API response (its own
// fallback strategy inside ebay-pricing/index.ts literally grabs any
// dollar-looking number in the page when structured parsing fails). Kept
// distinct from PriceBasis: a "sold" figure can still be a "scraped" one --
// this type says how much to trust the number, not what kind of listing it
// describes.
export type PriceSourceReliability = "structured" | "scraped";

// ─── A single price suggestion with strategy context ─────────────────────────

export interface PriceSuggestion {
  strategy: PriceStrategy;
  price: number;
  label: string; // e.g. "Undercut Market"
  description: string; // e.g. "5% below average — sell faster"
  badge: string; // e.g. "Fast Sale"
  badgeColor: string; // Tailwind color class e.g. "text-green-600"
  badgeBg: string; // e.g. "bg-green-50"
}

// ─── Full recommendation result ───────────────────────────────────────────────

export interface PriceRecommendation {
  suggestions: PriceSuggestion[];
  recommended: PriceSuggestion; // The top pick
  confidence: PriceConfidence;
  confidenceReason: string; // e.g. "Based on 12 comparable active listings"
  basis: PriceBasis; // What confidenceReason's comps actually are
  sourceReliability: PriceSourceReliability; // How trustworthy the extraction itself is

  // Market stats
  marketAvg: number;
  marketLow: number;
  marketHigh: number;
  marketMedian: number;
  compsCount: number;

  // Condition adjustment
  conditionMultiplier: number; // e.g. 0.85 for PRE_OWNED_FAIR vs NEW
  conditionNote: string; // e.g. "Pre-Owned Fair items sell 15% below market avg"

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
  title: string; // Item title used as search query
  condition?: string; // eBay condition enum string
  priceMin?: number; // AI-suggested min (fallback)
  priceMax?: number; // AI-suggested max (fallback)
  metalType?: string;
  metalWeightOz?: number;
  meltValue?: number | null;
  spotPrices?: { gold: number; silver: number; platinum: number } | null;
  onApplyPrice?: (price: number) => void; // Callback when user clicks "Apply"
  compact?: boolean; // Compact mode for draft cards
}
