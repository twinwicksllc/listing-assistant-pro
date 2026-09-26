import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useAnalyzeConditionOptions } from "@/hooks/useAnalyzeConditionOptions";

// Regression coverage for a live production incident (2026-09-26): the
// Analyze page's condition dropdown was populated directly from
// ebayMetadata.allowedConditions without any normalization, so eBay's own
// raw conditionDescription strings ("New Factory Sealed", "Open Box Used" --
// alternate display names for conditionId 1000/NEW and 3000/USED_EXCELLENT
// per eBay's condition-id-values docs) ended up as the <option value>.
// Selecting one and publishing sent an invalid, non-enum condition string to
// eBay's Inventory API, which rejected it with errorId 2004 ("Could not
// serialize field [condition]"). The backend (analyze-item) has been fixed
// to send only normalized enum values, but this hook must also defensively
// re-normalize every value it receives, matching the belt-and-suspenders
// pattern already used here for the graded/ungraded coin-label case.

describe("useAnalyzeConditionOptions", () => {
  test("normalizes raw eBay conditionDescription strings that leak into allowedConditions", () => {
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: {
          allowedConditions: ["New Factory Sealed", "Open Box Used"],
          isCoinCategory: false,
        },
        ebayCategoryId: "12345",
        domain: "general",
        setCondition: vi.fn(),
      }),
    );

    const values = result.current.conditionOptions.map((o) => o.value);
    expect(values).toEqual(["NEW", "USED_EXCELLENT"]);
    // Never pass the raw eBay description straight through as a value.
    expect(values).not.toContain("New Factory Sealed");
    expect(values).not.toContain("Open Box Used");
  });

  test("passes already-normalized enum values through unchanged", () => {
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: {
          allowedConditions: ["NEW", "USED_EXCELLENT"],
          isCoinCategory: false,
        },
        ebayCategoryId: "12345",
        domain: "general",
        setCondition: vi.fn(),
      }),
    );

    const values = result.current.conditionOptions.map((o) => o.value);
    expect(values).toEqual(["NEW", "USED_EXCELLENT"]);
  });

  test("coin category always uses coin-specific tiers regardless of allowedConditions", () => {
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: {
          allowedConditions: ["New Factory Sealed"],
          isCoinCategory: true,
        },
        ebayCategoryId: "3377",
        domain: "coins_bullion",
        setCondition: vi.fn(),
      }),
    );

    const values = result.current.conditionOptions.map((o) => o.value);
    expect(values).toContain("NEW");
    expect(values).toContain("USED_EXCELLENT");
    expect(values).not.toContain("New Factory Sealed");
  });
});
