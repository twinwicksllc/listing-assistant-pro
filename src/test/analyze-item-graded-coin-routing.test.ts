import { describe, expect, it } from "vitest";

/**
 * Regression tests for the analyze-item graded-world-coin category routing fix.
 *
 * Root cause (deep-dive following PRs #414-#418): the analyze-item AI pipeline
 * had THREE places that funneled coins into eBay category 45243 ("Coins: World")
 * with zero awareness of whether the coin was graded/certified:
 *   1. The Gemini tool-schema prompt explicitly instructed "always default to
 *      45243" for certified/graded coins.
 *   2. resolveDomainFallbackCategory()'s metal-unknown fallback hardcoded 45243.
 *   3. The "DOMAIN-MISMATCH SAFETY" block force-set 45243 with no graded check.
 *
 * 45243 is a rollup/parent category that REJECTS the Graded condition
 * (LIKE_NEW / conditionId 2750) at publish time (confirmed in PR #417). So any
 * graded/certified world coin routed there is guaranteed to fail publish.
 *
 * This test suite mirrors (standalone copies of) the new helper functions
 * added to supabase/functions/analyze-item/index.ts:
 *   - isLikelyGradedCoin()
 *   - resolveGradedFriendlyWorldCoinCategory()
 *   - the updated resolveDomainFallbackCategory() (graded-aware)
 *
 * Deno edge functions cannot be imported directly into the Vitest/Node runner,
 * so — consistent with the existing analyze-item-category-fallback.test.ts
 * pattern in this repo — the logic is mirrored here for fast, deterministic
 * unit coverage. Any behavioral change to the real implementation should be
 * mirrored here too.
 */

interface Identification {
  domain: string | null;
  itemName: string;
  keywords: string[];
  isMetal?: boolean;
  metalType?: string;
}

interface SlabOcrLike {
  isSlabbed?: boolean | null;
  grader?: string | null;
}

const SOUTH_PACIFIC_COUNTRIES = new Set([
  "cook islands",
  "fiji",
  "niue",
  "palau",
  "tuvalu",
  "tokelau",
  "samoa",
  "solomon islands",
  "kiribati",
  "nauru",
  "vanuatu",
  "tonga",
]);

function isLikelyGradedCoin(
  identification: Identification,
  slabOcrResult?: SlabOcrLike | null,
): boolean {
  if (slabOcrResult?.isSlabbed) return true;

  const combined = `${identification.itemName ?? ""} ${(identification.keywords ?? []).join(" ")}`
    .toLowerCase();
  return /\b(pcgs|ngc|anacs|icg|cac|iccs|graded|certified|slab(?:bed)?)\b/.test(
    combined,
  );
}

function resolveGradedFriendlyWorldCoinCategory(
  countryText?: string | null,
): { categoryId: string; categoryName: string; breadcrumb: string } {
  const country = (countryText ?? "").trim().toLowerCase();
  if (SOUTH_PACIFIC_COUNTRIES.has(country)) {
    return {
      categoryId: "3392",
      categoryName: "Coins: World > South Pacific",
      breadcrumb: "Coins & Paper Money > Coins: World > South Pacific",
    };
  }
  return {
    categoryId: "256",
    categoryName: "World Coins (graded-friendly)",
    breadcrumb: "Coins & Paper Money > Coins: World",
  };
}

function resolveDomainFallbackCategory(
  identification: Identification,
  slabOcrResult?: SlabOcrLike | null,
): { categoryId: string; categoryName: string; breadcrumb: string } | null {
  if (identification.domain !== "coins_bullion") return null;

  const combined = `${identification.itemName ?? ""} ${(identification.keywords ?? []).join(" ")}`.toLowerCase();
  let metal = identification.metalType ?? "none";

  if (metal === "none" || !metal) {
    if (/\bamerican\s+silver\s+eagles?\b|\bae\b|\bsilver\b/.test(combined)) {
      metal = "silver";
    } else if (/\bamerican\s+gold\s+eagles?\b|\bgold\b|\bbuffalo\b/.test(combined)) {
      metal = "gold";
    } else if (/\bplatinum\b/.test(combined)) {
      metal = "platinum";
    } else if (/\bpalladium\b/.test(combined)) {
      metal = "palladium";
    }
  }

  // Named US numismatic coins (American Silver/Gold Eagle, Morgan/Peace/etc
  // silver dollars) already support the Grade item specific, so graded
  // examples of these are fine to route normally below. Anything else that's
  // graded must NOT fall into a generic Bullion bucket (which also lacks the
  // Grade item specific) or the 45243 rollup — escape to a graded-friendly
  // World Coin leaf instead.
  const isGraded = isLikelyGradedCoin(identification, slabOcrResult);
  const isNamedUsBullionCoin = /\bamerican\s+silver\s+eagles?\b|\bae\b|\bamerican\s+gold\s+eagles?\b/
    .test(combined);
  const isNamedUsSilverDollar = /morgan|peace|walking liberty|franklin|kennedy|barber|seated|bust/
    .test(combined);
  const detectedCountry =
    [...SOUTH_PACIFIC_COUNTRIES].find((c) => combined.includes(c)) ?? null;

  if (isGraded && !isNamedUsBullionCoin && !isNamedUsSilverDollar) {
    return resolveGradedFriendlyWorldCoinCategory(detectedCountry);
  }

  if (metal === "gold") {
    if (/\bbar\b|\bingot\b|\bround\b/.test(combined)) {
      return {
        categoryId: "178906",
        categoryName: "Gold Bars & Rounds",
        breadcrumb: "Coins & Paper Money > Bullion > Gold > Bars & Rounds",
      };
    }
    return {
      categoryId: "177652",
      categoryName: "Gold Bullion Coins",
      breadcrumb: "Coins & Paper Money > Bullion > Gold > Coins",
    };
  }

  if (metal === "platinum" || metal === "palladium") {
    return {
      categoryId: "261070",
      categoryName: "Platinum & Palladium",
      breadcrumb: "Coins & Paper Money > Bullion > Platinum & Palladium",
    };
  }

  if (metal === "silver") {
    if (/\bamerican\s+silver\s+eagles?\b|\bae\b/.test(combined)) {
      return {
        categoryId: "41111",
        categoryName: "American Silver Eagles",
        breadcrumb: "Coins & Paper Money > Coins: US > Silver > American Silver Eagles",
      };
    }
    if (/\bbar\b|\bingot\b|\bround\b/.test(combined)) {
      return {
        categoryId: "39489",
        categoryName: "Silver Bars & Rounds",
        breadcrumb: "Coins & Paper Money > Bullion > Silver > Bars & Rounds",
      };
    }
    if (/morgan|peace|walking liberty|franklin|kennedy|barber|seated|bust/.test(combined)) {
      return {
        categoryId: "39465",
        categoryName: "US Silver Dollars",
        breadcrumb: "Coins & Paper Money > Coins: US > Dollars > Silver",
      };
    }
    return {
      categoryId: "177653",
      categoryName: "Silver Bullion Coins",
      breadcrumb: "Coins & Paper Money > Bullion > Silver > Coins",
    };
  }

  // Graded-aware branch (the fix under test): metal unknown, but the coin is
  // graded/certified — must NOT fall back to 45243.
  if (isGraded) {
    return resolveGradedFriendlyWorldCoinCategory(detectedCountry);
  }

  return { categoryId: "45243", categoryName: "World Coins", breadcrumb: "Coins & Paper Money > Coins: World" };
}

describe("isLikelyGradedCoin", () => {
  it("returns true when slabOcrResult.isSlabbed is true", () => {
    expect(
      isLikelyGradedCoin(
        { domain: "coins_bullion", itemName: "coin", keywords: [] },
        { isSlabbed: true, grader: "NGC" },
      ),
    ).toBe(true);
  });

  it("returns false when slabOcrResult.isSlabbed is false and no keyword signal", () => {
    expect(
      isLikelyGradedCoin(
        { domain: "coins_bullion", itemName: "1oz silver round", keywords: [] },
        { isSlabbed: false, grader: null },
      ),
    ).toBe(false);
  });

  it("detects grading keywords in itemName when no OCR result is available", () => {
    expect(
      isLikelyGradedCoin({
        domain: "coins_bullion",
        itemName: "2023 Cook Islands $5 Barn Owl NGC PF 70",
        keywords: [],
      }),
    ).toBe(true);
  });

  it("detects grading keywords in keywords array", () => {
    expect(
      isLikelyGradedCoin({
        domain: "coins_bullion",
        itemName: "Barn Owl coin",
        keywords: ["slabbed", "colorized"],
      }),
    ).toBe(true);
  });

  it("returns false for a plain raw coin with no grading signals", () => {
    expect(
      isLikelyGradedCoin({
        domain: "coins_bullion",
        itemName: "1921 Morgan Silver Dollar",
        keywords: ["circulated"],
      }),
    ).toBe(false);
  });
});

describe("resolveGradedFriendlyWorldCoinCategory", () => {
  it("routes Cook Islands to 3392 (South Pacific)", () => {
    expect(resolveGradedFriendlyWorldCoinCategory("Cook Islands").categoryId).toBe("3392");
  });

  it("routes Fiji, Niue, Palau, Tuvalu, Tokelau, Samoa, Solomon Islands, Kiribati, Nauru, Vanuatu, Tonga to 3392", () => {
    const countries = [
      "Fiji",
      "Niue",
      "Palau",
      "Tuvalu",
      "Tokelau",
      "Samoa",
      "Solomon Islands",
      "Kiribati",
      "Nauru",
      "Vanuatu",
      "Tonga",
    ];
    for (const c of countries) {
      expect(resolveGradedFriendlyWorldCoinCategory(c).categoryId).toBe("3392");
    }
  });

  it("routes unknown/other countries to 256 (graded-friendly default)", () => {
    expect(resolveGradedFriendlyWorldCoinCategory("China").categoryId).toBe("256");
    expect(resolveGradedFriendlyWorldCoinCategory(null).categoryId).toBe("256");
    expect(resolveGradedFriendlyWorldCoinCategory(undefined).categoryId).toBe("256");
    expect(resolveGradedFriendlyWorldCoinCategory("").categoryId).toBe("256");
  });

  it("NEVER returns 45243", () => {
    const samples = ["Cook Islands", "China", "Australia", "", null, undefined, "Random Country"];
    for (const s of samples) {
      expect(resolveGradedFriendlyWorldCoinCategory(s).categoryId).not.toBe("45243");
    }
  });
});

describe("resolveDomainFallbackCategory (graded-aware)", () => {
  it("still resolves ungraded/raw unknown-metal coin to 45243 (unchanged behavior)", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "old coin",
      keywords: ["collectible"],
      metalType: "none",
    });
    expect(result?.categoryId).toBe("45243");
  });

  it("routes a graded Cook Islands coin (detected via keywords, no metal) to 3392 instead of 45243", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "2023 Cook Islands $5 Barn Owl NGC PF 70 colorized silver coin",
      keywords: ["graded", "slabbed"],
    });
    expect(result?.categoryId).toBe("3392");
    expect(result?.categoryId).not.toBe("45243");
  });

  it("routes a graded coin with unknown country to 256 instead of 45243", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "PCGS certified world coin",
      keywords: [],
    });
    expect(result?.categoryId).toBe("256");
    expect(result?.categoryId).not.toBe("45243");
  });

  it("routes a graded coin (via slabOcrResult signal) to a graded-friendly leaf even with no keyword hints", () => {
    const result = resolveDomainFallbackCategory(
      {
        domain: "coins_bullion",
        itemName: "coin",
        keywords: [],
      },
      { isSlabbed: true, grader: "NGC" },
    );
    expect(result?.categoryId).toBe("256");
    expect(result?.categoryId).not.toBe("45243");
  });

  it("routes a graded coin that mentions 'silver' but is NOT a named US coin to a graded-friendly leaf, not generic Silver Bullion (177653)", () => {
    // Repro: 2023 Cook Islands $5 Barn Owl NGC PF 70, colorized, 1oz .999 silver.
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "2023 Cook Islands $5 Barn Owl NGC PF 70 colorized silver coin",
      keywords: ["graded", "slabbed"],
      metalType: "silver",
    });
    expect(result?.categoryId).toBe("3392");
    expect(result?.categoryId).not.toBe("45243");
    expect(result?.categoryId).not.toBe("177653");
  });

  it("a graded American Silver Eagle still resolves to the named leaf (41111), not a World Coin leaf", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "NGC MS 70 American Silver Eagle",
      keywords: ["graded"],
      metalType: "silver",
    });
    expect(result?.categoryId).toBe("41111");
  });

  it("a graded Morgan Dollar still resolves to the named US leaf (39465), not a World Coin leaf", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "PCGS MS 65 Morgan Silver Dollar 1921",
      keywords: ["graded"],
      metalType: "silver",
    });
    expect(result?.categoryId).toBe("39465");
  });

  it("does not affect known-metal branches (silver bullion still resolves normally)", () => {
    const result = resolveDomainFallbackCategory({
      domain: "coins_bullion",
      itemName: "silver bar",
      keywords: ["10 oz", "bullion"],
      metalType: "silver",
    });
    expect(result?.categoryId).toBe("39489");
  });

  it("returns null for non-coin domains regardless of grading keywords", () => {
    const result = resolveDomainFallbackCategory({
      domain: "general",
      itemName: "NGC graded coin",
      keywords: [],
    });
    expect(result).toBeNull();
  });
});
