// ================================================================
// Feature #5: Market Research Tools — Types
// ================================================================

export interface MarketWatch {
  id: string;
  userId: string;
  orgId?: string | null;
  searchQuery: string;
  categoryId?: string | null;
  label?: string | null;
  lastCheckedAt?: string | null;
  avgPrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  medianPrice?: number | null;
  activeCount: number;
  soldCount: number;
  sellThroughRate?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketPriceHistory {
  id: string;
  watchId: string;
  sampledAt: string;
  avgPrice?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  medianPrice?: number | null;
  activeCount: number;
  soldCount: number;
  sellThroughRate?: number | null;
}

export interface TopItem {
  title: string;
  price: number;
  imageUrl: string | null;
  itemUrl: string | null;
  condition: string;
}

export interface KeywordResearchResult {
  query: string;
  categoryId?: string | null;
  // Sold stats
  soldCount: number;
  avgSoldPrice: number | null;
  medianSoldPrice: number | null;
  minSoldPrice: number | null;
  maxSoldPrice: number | null;
  p25SoldPrice: number | null;
  p75SoldPrice: number | null;
  // Active stats
  activeCount: number;
  avgActivePrice: number | null;
  minActivePrice: number | null;
  maxActivePrice: number | null;
  // Market signals
  sellThroughRate: number;
  competitionLevel: "low" | "medium" | "high";
  demandSignal: "weak" | "moderate" | "strong";
  // Top items
  topCompetitors: TopItem[];
  topSold: TopItem[];
  // Meta
  noData: boolean;
  fromCache: boolean;
}

export type CompetitionLevel = "low" | "medium" | "high";
export type DemandSignal = "weak" | "moderate" | "strong";
