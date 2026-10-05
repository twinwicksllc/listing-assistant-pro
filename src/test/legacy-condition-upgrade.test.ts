import { describe, expect, test } from "vitest";
import { upgradeLegacyCondition } from "@/types/listing";

// Drafts saved before the condition enum came from eBay's ID table can hold
// the bare names eBay rejected with errorId 2004. Reopening one must show a
// selected option and must not re-save the obsolete value.
describe("upgradeLegacyCondition", () => {
  test("converts the three bare names eBay does not list", () => {
    expect(upgradeLegacyCondition("VERY_GOOD")).toBe("USED_VERY_GOOD");
    expect(upgradeLegacyCondition("GOOD")).toBe("USED_GOOD");
    expect(upgradeLegacyCondition("ACCEPTABLE")).toBe("USED_ACCEPTABLE");
  });

  test("ignores case and surrounding whitespace on the legacy names", () => {
    expect(upgradeLegacyCondition(" good ")).toBe("USED_GOOD");
    expect(upgradeLegacyCondition("very_good")).toBe("USED_VERY_GOOD");
  });

  test("returns every other value unchanged, including numeric IDs", () => {
    for (const value of [
      "NEW",
      "LIKE_NEW",
      "USED_EXCELLENT",
      "USED_GOOD",
      "PRE_OWNED_EXCELLENT",
      "FOR_PARTS_OR_NOT_WORKING",
      "3000",
      "Some unknown label",
    ]) {
      expect(upgradeLegacyCondition(value)).toBe(value);
    }
  });

  test("passes through empty and missing values", () => {
    expect(upgradeLegacyCondition("")).toBe("");
    expect(upgradeLegacyCondition(null)).toBeNull();
    expect(upgradeLegacyCondition(undefined)).toBeUndefined();
  });
});
