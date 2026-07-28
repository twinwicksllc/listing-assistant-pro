import { describe, it, expect } from "vitest";
import {
  deriveDomainFromCategory,
  isBullionCategory,
  isCoinConditionDetailRequired,
} from "@/types/listing";

/**
 * Regression tests for the "graded world commemorative coin" category bug.
 *
 * Repro item: 2023 Cook Islands $5 Barn Owl, NGC PF 70, colorized, 1oz .999 silver.
 * It is a GRADED WORLD COMMEMORATIVE COIN and must land in a coin category that
 * supports the Grade item specific — NOT a bullion category.
 */
describe("graded world commemorative coin categories", () => {
  it("routes South Pacific (3392) and World Commemorative (546) to the coin domain", () => {
    expect(deriveDomainFromCategory("3392", undefined)).toBe("coins_bullion");
    expect(deriveDomainFromCategory("546", undefined)).toBe("coins_bullion");
  });

  it("treats South Pacific / World Commemorative as coin categories requiring condition detail", () => {
    // These leaves support Grade, so the coin-condition panel must show for them.
    expect(isCoinConditionDetailRequired("3392", undefined, undefined)).toBe(true);
    expect(isCoinConditionDetailRequired("546", undefined, undefined)).toBe(true);
  });

  it("flags true bullion leaves as bullion (no Grade field)", () => {
    expect(isBullionCategory("39489")).toBe(true); // Silver Bars & Rounds
    expect(isBullionCategory("39487")).toBe(true); // Silver Bullion lots (was mislabeled gold)
    expect(isBullionCategory("178906")).toBe(true); // Gold Bars & Rounds
    expect(isBullionCategory(undefined, "Coins & Paper Money > Bullion > Silver")).toBe(true);
  });

  it("does NOT flag world/ancient/medieval coin categories as bullion", () => {
    expect(isBullionCategory("3392")).toBe(false); // South Pacific coins
    expect(isBullionCategory("546")).toBe(false); // World Commemorative
    expect(isBullionCategory("45243")).toBe(false); // Other World Coins
    expect(isBullionCategory("532")).toBe(false); // Ancient (previously mislabeled bullion)
    expect(isBullionCategory("173685")).toBe(false); // Medieval (previously mislabeled bullion)
  });
});
