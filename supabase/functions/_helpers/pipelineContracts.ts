export type Domain =
  | "coins_bullion"
  | "trading_cards"
  | "jewelry"
  | "electronics"
  | "vintage_clothing"
  | "general";

export interface IdentificationResult {
  domain: Domain;
  itemName: string;
  keywords: string[];
  isMetal: boolean;
  metalType: "gold" | "silver" | "platinum" | "none";
  confidence?: number;
  needsReview?: boolean;
}

export interface CategoryResolutionResult {
  categoryId: string | null;
  categoryName?: string | null;
  breadcrumb?: string | null;
  confidence?: number;
  source?: "user" | "grounded" | "deterministic" | "ai" | "fallback";
  alternatives?: Array<{
    categoryId: string;
    categoryName?: string;
    breadcrumb?: string;
    score?: number;
  }>;
  needsReview?: boolean;
  fallbackReason?: string;
}

export interface CategoryRequirementsResult {
  categoryId: string;
  requiredAspects: string[];
  suggestedAspects: string[];
  allowedConditions: string[];
}

export interface SpecificsResult {
  itemSpecifics: Record<string, string | string[]>;
  missingRequiredAspects?: string[];
  inferredAspects?: string[];
}

export interface CopyResult {
  title: string;
  description: string;
  titleOptions?: string[];
  seoNotes?: string[];
}

export interface PricingResult {
  priceMin: number;
  priceMax: number;
  competitorCount?: number;
  competitorMedian?: number;
  meltValue?: number | null;
  source?: "pre-ai" | "post-ai" | "fallback";
}

export interface ListingAssemblyResult {
  domain: Domain;
  categoryId: string;
  title: string;
  description: string;
  condition: string;
  itemSpecifics: Record<string, unknown>;
  priceMin: number;
  priceMax: number;
}
