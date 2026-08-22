import { describe, expect, test } from "vitest";
import {
  enforceLeafCategory,
  inferUsCoinLeafFromText,
  isKnownParentCategoryId,
} from "../../supabase/functions/_helpers/leafCategoryGuard";

describe("isKnownParentCategoryId", () => {
  test("flags the rollup category seen in the reported coin scans", () => {
    expect(isKnownParentCategoryId("88433")).toBe(true);
  });

  test("flags classic parent nodes", () => {
    expect(isKnownParentCategoryId("253")).toBe(true); // Coins: US
    expect(isKnownParentCategoryId("11118")).toBe(true); // Half Dollars rollup
    expect(isKnownParentCategoryId("45243")).toBe(true); // Coins: World rollup
  });

  test("does not flag real leaves", () => {
    expect(isKnownParentCategoryId("11971")).toBe(false); // Barber Half
    expect(isKnownParentCategoryId("39464")).toBe(false); // Morgan Dollar
  });

  test("handles null/undefined/whitespace safely", () => {
    expect(isKnownParentCategoryId(null)).toBe(false);
    expect(isKnownParentCategoryId(undefined)).toBe(false);
    expect(isKnownParentCategoryId(" 253 ")).toBe(true);
  });
});

describe("inferUsCoinLeafFromText", () => {
  test("routes a Barber half dollar to the Barber Half leaf", () => {
    expect(inferUsCoinLeafFromText("1892 Barber Half Dollar 90% silver")).toBe(
      "11971",
    );
  });

  test("routes a Barber dime to the Barber Dime leaf", () => {
    expect(inferUsCoinLeafFromText("1905 Barber Dime fine condition")).toBe(
      "11959",
    );
  });

  test("routes a Barber quarter to the Barber Quarter leaf", () => {
    expect(inferUsCoinLeafFromText("1899 Barber Quarter VF")).toBe("11965");
  });

  test("falls back to Barber Half when OCR mangles the denomination", () => {
    // Real-world scan text: "Barber Domes" with no denomination present.
    expect(inferUsCoinLeafFromText("Lot of 2 - 1892 Barber Domes 90% Silver")).toBe(
      "11971",
    );
  });

  test("routes a Shield Nickel to the Shield Nickel leaf", () => {
    expect(
      inferUsCoinLeafFromText("1868 US Shield Nickel 5C No Rays Philadelphia"),
    ).toBe("11952");
  });

  test("routes a Morgan dollar", () => {
    expect(inferUsCoinLeafFromText("1921 Morgan Silver Dollar")).toBe("39464");
  });

  test("returns null when it cannot be confident", () => {
    expect(inferUsCoinLeafFromText("some random collectible")).toBeNull();
    expect(inferUsCoinLeafFromText("")).toBeNull();
    expect(inferUsCoinLeafFromText(null)).toBeNull();
  });
});

describe("enforceLeafCategory", () => {
  test("leaves a valid leaf untouched", () => {
    const result = enforceLeafCategory({
      categoryId: "11971",
      verifiedLeaf: true,
      domain: "coins_bullion",
      text: "1892 Barber Half Dollar",
    });
    expect(result.changed).toBe(false);
    expect(result.categoryId).toBe("11971");
    expect(result.needsUserConfirmation).toBe(false);
  });

  test("replaces a known parent with the first non-parent candidate", () => {
    const result = enforceLeafCategory({
      categoryId: "88433",
      domain: "coins_bullion",
      text: "1892 Barber Half Dollar",
      candidates: [{ categoryId: "253" }, { categoryId: "11971" }],
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe("11971");
    expect(result.needsUserConfirmation).toBe(false);
  });

  test("infers a coin leaf when no usable candidates exist (Barber scan)", () => {
    const result = enforceLeafCategory({
      categoryId: "88433",
      domain: "coins_bullion",
      text: "Lot of 2 - 1892 Barber Domes 90% Silver US Coins",
      candidates: [],
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe("11971");
  });

  test("infers a coin leaf for the Shield Nickel scan", () => {
    const result = enforceLeafCategory({
      categoryId: "88433",
      domain: "coins_bullion",
      text: "1868 US Shield Nickel 5C No Rays Philadelphia",
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe("11952");
  });

  test("treats a failed live verification like a parent category", () => {
    const result = enforceLeafCategory({
      categoryId: "999999",
      verifiedLeaf: false,
      domain: "coins_bullion",
      text: "1921 Morgan Silver Dollar",
    });
    expect(result.changed).toBe(true);
    expect(result.categoryId).toBe("39464");
  });

  test("flags for user confirmation when nothing safe can be substituted", () => {
    const result = enforceLeafCategory({
      categoryId: "88433",
      domain: "coins_bullion",
      text: "unidentifiable blob",
      candidates: [{ categoryId: "253" }],
    });
    expect(result.changed).toBe(false);
    expect(result.categoryId).toBe("88433");
    expect(result.needsUserConfirmation).toBe(true);
  });

  test("does not invent a coin leaf for non-coin domains", () => {
    const result = enforceLeafCategory({
      categoryId: "293",
      domain: "electronics",
      text: "Barber shop clippers",
    });
    expect(result.changed).toBe(false);
    expect(result.needsUserConfirmation).toBe(true);
  });

  test("handles a missing category id", () => {
    const result = enforceLeafCategory({ categoryId: null });
    expect(result.categoryId).toBeNull();
    expect(result.needsUserConfirmation).toBe(true);
  });
});
