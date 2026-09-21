import { findDuplicateTitles } from "./duplicateDetection";

export const PRICING_FLAG_THRESHOLD_PCT = 0.15;
export const STALE_DAYS_THRESHOLD = 60;

export interface InsightFlag {
  type: "overpriced" | "underpriced" | "stale" | "duplicate";
  message: string;
}

export function getPricingFlag(
  priceDelta: number | null,
  avgPrice: number | null,
  competitorCount: number,
): InsightFlag | null {
  if (
    !avgPrice ||
    avgPrice <= 0 ||
    competitorCount === 0 ||
    priceDelta == null
  ) {
    return null;
  }

  const deltaPct = Math.abs(priceDelta) / avgPrice;
  if (deltaPct <= PRICING_FLAG_THRESHOLD_PCT) return null;

  if (priceDelta > 0) {
    return {
      type: "overpriced",
      message: `Priced ${(deltaPct * 100).toFixed(0)}% above the competitor average`,
    };
  }

  return {
    type: "underpriced",
    message: `Priced ${(deltaPct * 100).toFixed(0)}% below the competitor average`,
  };
}

export function getStalenessFlag(firstSeenAt: string): InsightFlag | null {
  const firstSeenMs = new Date(firstSeenAt).getTime();
  if (Number.isNaN(firstSeenMs)) return null;

  const ageDays = (Date.now() - firstSeenMs) / (1000 * 60 * 60 * 24);
  if (ageDays < STALE_DAYS_THRESHOLD) return null;

  return {
    type: "stale",
    message: `Listed for ${Math.floor(ageDays)} days without a sale`,
  };
}

export interface InsightListing {
  id: string;
  title: string;
  priceDelta?: number | null;
  avgPrice?: number | null;
  competitorCount?: number;
  firstSeenAt?: string | null;
}

export function computeListingFlags(
  listing: InsightListing,
  allListings: InsightListing[],
  duplicateMap?: Map<string, string[]>,
): InsightFlag[] {
  const flags: InsightFlag[] = [];

  const pricingFlag = getPricingFlag(
    listing.priceDelta ?? null,
    listing.avgPrice ?? null,
    listing.competitorCount ?? 0,
  );
  if (pricingFlag) flags.push(pricingFlag);

  if (listing.firstSeenAt) {
    const stalenessFlag = getStalenessFlag(listing.firstSeenAt);
    if (stalenessFlag) flags.push(stalenessFlag);
  }

  const duplicates =
    duplicateMap ??
    findDuplicateTitles(allListings.map((l) => ({ id: l.id, title: l.title })));
  if ((duplicates.get(listing.id) ?? []).length > 0) {
    flags.push({
      type: "duplicate",
      message: "Title is very similar to another active listing",
    });
  }

  return flags;
}
