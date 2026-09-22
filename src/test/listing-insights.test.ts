import { describe, it, expect } from "vitest";
import {
  getPricingFlag,
  getStalenessFlag,
  computeListingFlags,
} from "../lib/listingInsights";
import {
  tokenizeTitle,
  jaccardSimilarity,
  findDuplicateTitles,
} from "../lib/duplicateDetection";

describe("getPricingFlag", () => {
  it("flags overpriced when price_delta is more than 15% above avgPrice", () => {
    expect(getPricingFlag(20, 100, 5)).toEqual({
      type: "overpriced",
      message: "Priced 20% above the competitor average",
    });
  });

  it("flags underpriced when price_delta is more than 15% below avgPrice", () => {
    expect(getPricingFlag(-20, 100, 5)).toEqual({
      type: "underpriced",
      message: "Priced 20% below the competitor average",
    });
  });

  it("returns null when within the 15% threshold", () => {
    expect(getPricingFlag(10, 100, 5)).toBeNull();
  });

  it("returns null when avgPrice is null or zero", () => {
    expect(getPricingFlag(50, null, 5)).toBeNull();
    expect(getPricingFlag(50, 0, 5)).toBeNull();
  });

  it("returns null when there are no competitors", () => {
    expect(getPricingFlag(50, 100, 0)).toBeNull();
  });
});

describe("getStalenessFlag", () => {
  it("returns null when the listing is younger than 60 days", () => {
    const recent = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(getStalenessFlag(recent)).toBeNull();
  });

  it("flags stale at exactly 60 days", () => {
    const sixtyDaysAgo = new Date(
      Date.now() - 60 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const flag = getStalenessFlag(sixtyDaysAgo);
    expect(flag?.type).toBe("stale");
  });

  it("flags stale when older than 60 days", () => {
    const ninetyDaysAgo = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const flag = getStalenessFlag(ninetyDaysAgo);
    expect(flag?.type).toBe("stale");
  });
});

describe("tokenizeTitle / jaccardSimilarity", () => {
  it("returns high similarity for near-identical titles", () => {
    const a = tokenizeTitle("2021 Silver Eagle Coin Mint");
    const b = tokenizeTitle("2021 Silver Eagle Coin");
    expect(jaccardSimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  it("returns low similarity for dissimilar titles", () => {
    const a = tokenizeTitle("2021 Silver Eagle Coin Mint");
    const b = tokenizeTitle("Vintage Leather Baseball Glove");
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.6);
  });
});

describe("findDuplicateTitles", () => {
  it("flags two near-identical titles as duplicates of each other", () => {
    const duplicates = findDuplicateTitles([
      { id: "1", title: "2021 Silver Eagle Coin Mint" },
      { id: "2", title: "2021 Silver Eagle Coin" },
      { id: "3", title: "Vintage Leather Baseball Glove" },
    ]);
    expect(duplicates.get("1")).toEqual(["2"]);
    expect(duplicates.get("2")).toEqual(["1"]);
    expect(duplicates.get("3")).toBeUndefined();
  });
});

describe("computeListingFlags", () => {
  it("combines pricing, staleness, and duplicate flags", () => {
    const staleDate = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const listings = [
      {
        id: "1",
        title: "2021 Silver Eagle Coin Mint",
        priceDelta: 30,
        avgPrice: 100,
        competitorCount: 5,
        firstSeenAt: staleDate,
      },
      { id: "2", title: "2021 Silver Eagle Coin Mint" },
    ];

    const flags = computeListingFlags(listings[0], listings);
    const types = flags.map((f) => f.type).sort();
    expect(types).toEqual(["duplicate", "overpriced", "stale"]);
  });

  it("returns no flags for a healthy, unique, non-stale listing", () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const listings = [
      {
        id: "1",
        title: "2021 Silver Eagle Coin Mint",
        priceDelta: 5,
        avgPrice: 100,
        competitorCount: 5,
        firstSeenAt: recent,
      },
      { id: "2", title: "Vintage Leather Baseball Glove" },
    ];

    expect(computeListingFlags(listings[0], listings)).toEqual([]);
  });
});
