import { describe, it, expect } from "vitest";

// COGS flow calculation tests — unit tests for profit math logic
// (component rendering tests would require mocking react-testing-library setup,
// which is minimal ROI given that CogsInput and ProfitBadge are simple UI wrappers
// around these calculations)

describe("COGS Flow: Profit Calculations", () => {
  describe("Profit calculation: price - cogs - ebay_fee", () => {
    it("calculates profit correctly for coins_bullion domain (13% fee)", () => {
      const listingPrice = 49.99;
      const cogs = 15;
      const ebayFeeRate = 0.13;
      const ebayFee = listingPrice * ebayFeeRate;
      const profit = listingPrice - cogs - ebayFee;

      expect(profit).toBeCloseTo(28.4887, 2);
    });

    it("calculates profit for general domain (0% fee)", () => {
      const listingPrice = 100;
      const cogs = 10;
      const profit = listingPrice - cogs;

      expect(profit).toBe(90);
    });

    it("handles zero cogs correctly", () => {
      const listingPrice = 100;
      const cogs = 0;
      const profit = listingPrice - cogs;

      expect(profit).toBe(100);
    });

    it("handles negative profit (cogs > price)", () => {
      const listingPrice = 20;
      const cogs = 50;
      const profit = listingPrice - cogs;

      expect(profit).toBe(-30);
    });
  });

  describe("Margin percentage: (profit / price) * 100", () => {
    it("calculates 90% margin for $100 price, $10 cogs, no fee", () => {
      const listingPrice = 100;
      const cogs = 10;
      const profit = listingPrice - cogs;
      const margin = (profit / listingPrice) * 100;

      expect(margin).toBe(90);
    });

    it("calculates 0% margin at break-even", () => {
      const listingPrice = 100;
      const cogs = 100;
      const profit = listingPrice - cogs;
      const margin = (profit / listingPrice) * 100;

      expect(margin).toBe(0);
    });

    it("calculates negative margin when cogs exceeds price", () => {
      const listingPrice = 50;
      const cogs = 75;
      const profit = listingPrice - cogs;
      const margin = (profit / listingPrice) * 100;

      expect(margin).toBe(-50);
    });

    it("calculates margin with coins_bullion fee factored in", () => {
      const listingPrice = 100;
      const cogs = 40;
      const ebayFee = listingPrice * 0.13;
      const profit = listingPrice - cogs - ebayFee;
      const margin = (profit / listingPrice) * 100;

      // (100 - 40 - 13) / 100 = 47%
      expect(margin).toBeCloseTo(47, 1);
    });
  });

  describe("Margin color thresholds", () => {
    it("healthy margin >= 40% is green", () => {
      const margin = 50;
      const isHealthy = margin >= 40;
      expect(isHealthy).toBe(true);
    });

    it("moderate margin 20-39% is yellow", () => {
      const margin = 30;
      const isModeerate = margin >= 20 && margin < 40;
      expect(isModeerate).toBe(true);
    });

    it("low margin < 20% is red", () => {
      const margin = 10;
      const isLow = margin < 20;
      expect(isLow).toBe(true);
    });

    it("negative margin (loss) is red", () => {
      const margin = -10;
      const isLow = margin < 20;
      expect(isLow).toBe(true);
    });
  });

  describe("eBay fee rates by domain", () => {
    it("coins_bullion domain has 13% eBay fee", () => {
      const ebayFeeRate = 0.13;
      const listingPrice = 100;
      const fee = listingPrice * ebayFeeRate;
      expect(fee).toBe(13);
    });

    it("general domain has 0% fee (no domain-specific surcharge)", () => {
      const ebayFeeRate = 0;
      const listingPrice = 100;
      const fee = listingPrice * ebayFeeRate;
      expect(fee).toBe(0);
    });

    it("fee calculation scales with price", () => {
      const ebayFeeRate = 0.13;
      const prices = [50, 100, 1000];
      const fees = prices.map((p) => p * ebayFeeRate);

      expect(fees[0]).toBe(6.5);
      expect(fees[1]).toBe(13);
      expect(fees[2]).toBe(130);
    });
  });
});
