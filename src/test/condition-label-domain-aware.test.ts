import { describe, expect, it } from "vitest";
import { CONDITION_LABELS, getConditionLabel } from "@/types/listing";

/**
 * Regression coverage for the 2026-09-19 non-coin condition-label fix.
 *
 * CONDITION_LABELS is universally coin-flavored ("New / Uncirculated",
 * "Used – Excellent (lightly used/circulated)"), and getConditionLabel()
 * previously ignored domain entirely — so a diecast car or pencil sharpener
 * showed numismatic wording in the condition dropdown. getConditionLabel()
 * now takes an optional `domain` param: coin domain ("coins_bullion") and
 * undefined (any caller not yet passing domain) must produce byte-for-byte
 * identical output to before this change; every other domain gets generic,
 * non-numismatic labels.
 */
describe("getConditionLabel domain awareness", () => {
  it("matches legacy CONDITION_LABELS exactly for domain 'coins_bullion'", () => {
    for (const key of Object.keys(CONDITION_LABELS)) {
      expect(getConditionLabel(key, "coins_bullion")).toBe(
        CONDITION_LABELS[key],
      );
    }
  });

  it("preserves legacy default behavior when domain is omitted (backward compatibility)", () => {
    for (const key of Object.keys(CONDITION_LABELS)) {
      expect(getConditionLabel(key)).toBe(CONDITION_LABELS[key]);
    }
  });

  it("returns generic, non-numismatic labels for non-coin domains", () => {
    for (const domain of ["diecast_toys", "general", "jewelry", "other"]) {
      expect(getConditionLabel("NEW", domain)).toBe("New");
      expect(getConditionLabel("USED_EXCELLENT", domain)).toBe(
        "Used – Excellent",
      );
    }

    const usedExcellent = getConditionLabel("USED_EXCELLENT", "diecast_toys");
    expect(usedExcellent).not.toMatch(/circulated/i);

    const newLabel = getConditionLabel("NEW", "diecast_toys");
    expect(newLabel).not.toMatch(/uncirculated/i);
  });

  it("falls back to CONDITION_LABELS for keys with no generic override", () => {
    // LIKE_NEW has no coin-specific wording, so it's intentionally omitted
    // from GENERIC_CONDITION_LABELS and should fall back unchanged.
    expect(getConditionLabel("LIKE_NEW", "diecast_toys")).toBe(
      CONDITION_LABELS["LIKE_NEW"],
    );
  });

  it("falls back to title-cased key for an unknown condition regardless of domain", () => {
    expect(getConditionLabel("SOME_UNKNOWN_ENUM", "diecast_toys")).toBe(
      "Some Unknown Enum",
    );
    expect(getConditionLabel("SOME_UNKNOWN_ENUM", "coins_bullion")).toBe(
      "Some Unknown Enum",
    );
  });

  it("returns empty string for empty condition regardless of domain", () => {
    expect(getConditionLabel("", "diecast_toys")).toBe("");
  });
});
