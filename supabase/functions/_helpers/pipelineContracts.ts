// Canonical 12-domain type — kept in sync with agent-system/pipelineContracts.ts
// and _helpers/pass1Identification.ts. Single source of truth for domain routing.
export type Domain =
  | "coins_bullion"
  | "trading_cards"
  | "jewelry"
  | "electronics"
  | "vintage_clothing"
  | "auto_parts"
  | "sneakers"
  | "luxury_handbags"
  | "musical_instruments"
  | "toys_collectibles"
  | "home_garden_tools"
  | "general";

/** eBay June 2026 structured coin condition requirement */
export type CoinConditionDetail =
  | {
    type: "graded";
    gradingCompany: "PCGS" | "NGC" | "ANACS" | "ICG" | "CAC" | "ICCS";
    grade: string; // e.g. "MS 65", "PR 70 DCAM"
    certificationNumber?: string;
  }
  | {
    type: "raw";
    rawCondition:
      | "Uncirculated"
      | "Extremely Fine to About Uncirculated"
      | "Fine to Very Fine"
      | "Below Fine";
  };

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
  /** eBay June 2026 structured coin condition — required for all US/World/Canada/Ancient/Medieval coins */
  coinConditionDetail?: CoinConditionDetail | null;
}
