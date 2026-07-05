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

  const combined = `${identification.itemName ?? ""} ${(identification.keywords ?? []).join(" ")}`.toLowerCase();
  let metal = identification.metalType ?? "none";

  if (metal === "none" || !metal) {
    if (/\bamerican\s+silver\s+eagles?\b|\base\b|\bsilver\b/.test(combined)) {
      metal = "silver";
    } else if (/\bamerican\s+gold\s+eagles?\b|\bgold\b|\bbuffalo\b/.test(combined)) {
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

  if (metal === "platinum" || metal === "palladium") {
    return {
      categoryId: "261070",
      categoryName: "Platinum & Palladium",
      breadcrumb: "Coins & Paper Money > Bullion > Platinum & Palladium",
    };
  }

  if (metal === "silver") {
    // American Silver Eagle is a named US bullion coin
    if (/\bamerican\s+silver\s+eagles?\b|\base\b/.test(combined)) {
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

  // Domain is coins_bullion but metal unknown — safest general coin fallback
  return { categoryId: "45243", categoryName: "World Coins", breadcrumb: "Coins & Paper Money > Coins: World" };
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
    it("should resolve American Silver Eagle to 41111", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "american silver eagle",
        keywords: ["bullion", "1 oz"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("41111");
      expect(result?.categoryName).toBe("American Silver Eagles");
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

    it("should resolve Morgan dollar to 39465", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "morgan dollar",
        keywords: ["1921", "silver"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("39465");
      expect(result?.categoryName).toBe("US Silver Dollars");
    });

    it("should resolve Peace dollar to 39465", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "peace dollar",
        keywords: ["1935"],
        metalType: "silver",
      });
      expect(result?.categoryId).toBe("39465");
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
      expect(result?.categoryId).toBe("41111");
      expect(result?.categoryName).toBe("American Silver Eagles");
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
    it("should resolve platinum to 261070", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "platinum coin",
        keywords: ["1 oz"],
        metalType: "platinum",
      });
      expect(result?.categoryId).toBe("261070");
    });

    it("should resolve palladium to 261070", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "palladium round",
        keywords: ["bullion"],
        metalType: "palladium",
      });
      expect(result?.categoryId).toBe("261070");
    });
  });

  describe("Unknown metal or generic coins_bullion", () => {
    it("should resolve unknown metal to World Coins (45243)", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "coin",
        keywords: ["collectible"],
        metalType: "none",
      });
      expect(result?.categoryId).toBe("45243");
      expect(result?.categoryName).toBe("World Coins");
    });

    it("should resolve missing metalType to World Coins", () => {
      const result = resolveDomainFallbackCategory({
        domain: "coins_bullion",
        itemName: "antique coin",
        keywords: ["old"],
      });
      expect(result?.categoryId).toBe("45243");
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
      expect(result?.categoryId).toBe("41111");
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
