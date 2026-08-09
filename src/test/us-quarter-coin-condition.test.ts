import { describe, it, expect } from "vitest";
import { isCoinConditionDetailRequired } from "@/types/listing";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";

/**
 * Regression tests for: "my Standing Liberty quarter category isn't asking for
 * raw or graded".
 *
 * Category 11966 (Standing Liberty Quarters 1916-1930) was missing from both
 * COIN_CATEGORY_IDS and the breadcrumb map, so isCoinConditionDetailRequired
 * returned false and the Raw/Graded coin-condition selector never rendered.
 */
describe("US quarter coin-condition selector", () => {
  const QUARTER_LEAVES: Array<[string, string]> = [
    ["11962", "Quarters (parent)"],
    ["173587", "Draped Bust (1796-1807)"],
    ["11963", "Capped Bust (1815-1838)"],
    ["11964", "Seated Liberty (1838-1891)"],
    ["11965", "Barber (1892-1916)"],
    ["11966", "Standing Liberty (1916-1930)"],
    ["39461", "Washington (1932-1998)"],
  ];

  it("requires coin-condition detail for every US quarter leaf by category ID alone", () => {
    for (const [id, label] of QUARTER_LEAVES) {
      expect(
        isCoinConditionDetailRequired(id, undefined, undefined),
        `category ${id} (${label}) should require Raw/Graded selector`,
      ).toBe(true);
    }
  });

  it("has a breadcrumb for every US quarter leaf (so the breadcrumb fallback also works)", () => {
    for (const [id, label] of QUARTER_LEAVES) {
      const bc = getEbayCategoryBreadcrumb(id);
      expect(
        bc,
        `category ${id} (${label}) should have a breadcrumb`,
      ).toBeTruthy();
      expect(bc!.toLowerCase()).toContain("quarter");
    }
  });

  it("still detects a quarter via breadcrumb even if the ID is unknown", () => {
    // Simulates a brand-new quarter leaf not yet in the ID list: the backend
    // breadcrumb fallback must still trigger the selector.
    expect(
      isCoinConditionDetailRequired(
        "9999999",
        undefined,
        "Coins & Paper Money > Coins: US > Quarters > Some New Type",
      ),
    ).toBe(true);
  });
});
