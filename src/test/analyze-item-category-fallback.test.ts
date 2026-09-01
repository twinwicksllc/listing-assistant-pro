import { describe, it, expect } from "vitest";

/**
 * Test suite for domain-based category fallback resolver in analyze-item.
 *
 * This tests the new feature that ensures Pass 2 always receives the correct
 * eBay category before generating itemSpecifics, eliminating cascading errors
 * when the lookup pipeline fails or is suppressed.
 */

// Mock of the Identification type from Pass 1
interface Identification {
  domain: string | null;
  itemName: string;
  keywords: string[];
  isMetal?: boolean;
  metalType?: string;
}

/**
 * Domain-based category fallback resolver.
 * Returns a category deterministically from domain + metalType + itemName.
 * This ensures Pass 2 always has the correct eBay aspects schema.
 */
function resolveDomainFallbackCategory(
  identification: Identification,
): { categoryId: string; categoryName: string; breadcrumb: string } | null {
  if (identification.domain !== "coins_bullion") return null;

  const combined =
    `${identification.itemName ?? ""} ${(identification.keywords ?? []).join(" ")}`.toLowerCase();
  let metal = identification.metalType ?? "none";

  if (metal === "none" || !metal) {
    if (/\bamerican\s+silver\s+eagles?\b|\base\b|\bsilver\b/.test(combined)) {
      metal = "silver";
    } else if (
      /\bamerican\s+gold\s+eagles?\b|\bgold\b|\bbuffalo\b/.test(combined)
    ) {
      metal = "gold";
    } else if (/\bplatinum\b/.test(combined)) {
      metal = "platinum";
    } else if (/\bpalladium\b/.test(combined)) {
      metal = "palladium";
    }
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

  // 261070 corrected 2026-09-01: was a live leaf in the WRONG domain (Toys &
  // Hobbies > Action Figures & Accessories > Action Figures Accessories), the
  // same bug fixed in analyze-item/index.ts's real resolveDomainFallbackCategory.
  // This test file duplicates that function's logic locally rather than
  // importing it (analyze-item/index.ts is a Deno edge function, not a
  // Node-importable module), so its expectations must be corrected in step
  // with the real implementation or they silently assert stale values forever.
  if (metal === "platinum") {
    return {
      categoryId: "34942",
      categoryName: "Other Platinum Bullion",
      breadcrumb:
        "Coins & Paper Money > Bullion > Platinum > Other Platinum Bullion",
    };
  }

  if (metal === "palladium") {
    return {
      categoryId: "34943",
      categoryName: "Palladium",
      breadcrumb: "Coins & Paper Money > Bullion > Palladium",
    };
  }

  if (metal === "silver") {
    // American Silver Eagle is a named US bullion coin. 41111 (removed
    // 2026-09-01) was dead — route to the same generic silver-bullion leaf
    // as the default case below, matching the real implementation.
    if (/\bamerican\s+silver\s+eagles?\b|\base\b/.test(combined)) {
      return {
        categoryId: "177653",
        categoryName: "Silver Bullion Coins",
        breadcrumb: "Coins & Paper Money > Bullion > Silver > Coins",
      };
    }
    if (/\bbar\b|\bingot\b|\bround\b/.test(combined)) {
      return {
        categoryId: "39489",
        categoryName: "Silver Bars & Rounds",
        breadcrumb: "Coins & Paper Money > Bullion > Silver > Bars & Rounds",
      };
    }
    if (
      /morgan|peace|walking liberty|franklin|kennedy|barber|seated|bust/.test(
        combined,
      )
    ) {
      // 39465 corrected 2026-09-01: was dead (absent from the live tree).
      return {
        categoryId: "176965",
        categoryName: "US Dollars (mixed/unspecified type)",
        breadcrumb: "Coins & Paper Money > Coins: US > Dollars > Mixed Lots",
      };
    }
    return {
      categoryId: "177653",
      categoryName: "Silver Bullion Coins",
      breadcrumb: "Coins & Paper Money > Bullion > Silver > Coins",
    };
  }

  // Domain is coins_bullion but metal unknown — safest general coin fallback.
  // 45243 corrected 2026-09-01: was already dead as of the 2026-08-24 Finding-B
  // fix elsewhere in the codebase; this duplicate had never been updated.
  return {
    categoryId: "257",
    categoryName: "Other Coins of the World",
    breadcrumb: "Coins & Paper Money > Coins: World > Other Coins of the World",
  };
}

describe("resolveDomainFallbackCategory", () => {
  describe("Non-coin domains", () => {
    it("should return null for non-coins_bullion domains", () => {
      const result = resolveDomainFallbackCategory({
        domain: "general",
        itemName: "silver bar",
        keywords: ["precious", "metal"],
        metalType: "silver",
      });
      expect(result).toBeNull();
    });

    it("should return null for null domain", () => {
      const result = resolveDomainFallbackCategory({
        domain: null,
        itemName: "silver bar",
        keywords: [],
        metalType: "silver",
      });
      expect(result).toBeNull();
    });
  });

  describe("Silver coins and bullion", () => {
    it("should resolve American Silver Eagle to 177653 (41111 is dead)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "american silver eagle",
        keywords: ["bullion", "1 oz"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("177653");
      expect(result?.categoryName).toBe("Silver Bullion Coins");
    });

    it("should resolve silver bar to 39489", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "silver bar",
        keywords: ["10 oz", "bullion"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("39489");
      expect(result?.categoryName).toBe("Silver Bars & Rounds");
    });

    it("should resolve silver round to 39489", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "silver round",
        keywords: ["1 oz", "bullion"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("39489");
    });

    it("should resolve Morgan dollar to 176965 (39465 is dead)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "morgan dollar",
        keywords: ["1921", "silver"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("176965");
      expect(result?.categoryName).toBe("US Dollars (mixed/unspecified type)");
    });

    it("should resolve Peace dollar to 176965 (39465 is dead)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "peace dollar",
        keywords: ["1935"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("176965");
    });

    it("should resolve generic silver to 177653", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "silver coin",
        keywords: ["vintage"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("177653");
      expect(result?.categoryName).toBe("Silver Bullion Coins");
    });

    it("should resolve American Silver Eagle even when metalType is missing", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "2010 american silver eagle 1 oz",
        keywords: ["usa", "bullion"],
      });
      expect(result?.categoryId).toBe("177653");
      expect(result?.categoryName).toBe("Silver Bullion Coins");
    });
  });

  describe("Gold coins and bullion", () => {
    it("should resolve gold bar to 178906", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "gold bar",
        keywords: ["1 oz", "bullion"],
        metalType: "gold",
      });
      expect(result?.categoryId).toBe("178906");
      expect(result?.categoryName).toBe("Gold Bars & Rounds");
    });

    it("should resolve gold ingot to 178906", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "gold ingot",
        keywords: ["10g"],
        metalType: "gold",
      });
      expect(result?.categoryId).toBe("178906");
    });

    it("should resolve generic gold to 177652", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "gold coin",
        keywords: ["sovereign"],
        metalType: "gold",
      });
      expect(result?.categoryId).toBe("177652");
      expect(result?.categoryName).toBe("Gold Bullion Coins");
    });
  });

  describe("Platinum and palladium", () => {
    it("should resolve platinum to 34942 (261070 was wrong domain)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "platinum coin",
        keywords: ["1 oz"],
        metalType: "platinum",
      });
      expect(result?.categoryId).toBe("34942");
    });

    it("should resolve palladium to 34943 (261070 was wrong domain)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "palladium round",
        keywords: ["bullion"],
        metalType: "palladium",
      });
      expect(result?.categoryId).toBe("34943");
    });
  });

  describe("Unknown metal or generic coins_bullion", () => {
    it("should resolve unknown metal to World Coins catch-all (257, 45243 is dead)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "coin",
        keywords: ["collectible"],
        metalType: "none",
      });
      expect(result?.categoryId).toBe("257");
      expect(result?.categoryName).toBe("Other Coins of the World");
    });

    it("should resolve missing metalType to World Coins catch-all", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "antique coin",
        keywords: ["old"],
      });
      expect(result?.categoryId).toBe("257");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty keywords array", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "silver bar",
        keywords: [],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("39489");
    });

    it("should be case-insensitive", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "AMERICAN SILVER EAGLE",
        keywords: ["BULLION"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("177653");
    });

    it("should handle null itemName gracefully", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "",
        keywords: [],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("177653");
    });
  });
});
