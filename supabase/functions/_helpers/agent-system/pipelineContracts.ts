/**
 * pipelineContracts.ts
 * Shared interfaces and types for the modular agent architecture.
 */

import type { RequestDeadline } from "../fetchWithTimeout.ts";

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

export interface Identification {
  domain: Domain;
  itemName: string;
  keywords: string[];
  isMetal: boolean;
  metalType: "gold" | "silver" | "platinum" | "palladium" | "none";
}

export interface VisualInspectionResult {
  zoomRegionsExamined: string[];
  keyFindings: string;
  confidenceBoost: number;
  identificationCorrection?: string;
  capturedAttributes?: Record<string, string>;
}

export interface MarketDataReport {
  marketAnalysis: string | null;
  groundedCategoryId: string | null;
}

export interface ComplianceResult {
  valid: boolean;
  issues: string[];
}

export interface AgentContext {
  invocationId: string;
  userId: string;
  imageList: string[];
  voiceNote?: string;
  identification?: Identification;
  /** Pre-computed item embedding — generated once in controller and shared by sub-agents to avoid duplicate API calls. */
  queryEmbedding?: number[];
  /**
   * Request-scoped wall clock from the invoking handler. Sub-agents clamp their
   * own budgets to whatever time is left, so the accuracy-critical visual stage
   * is not handed its full 110s when only 30s remains before the gateway kill.
   * Optional: absent means "use the static budget", which is the prior behavior.
   */
  deadline?: RequestDeadline | null;
}
