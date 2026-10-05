import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { buildConditionPolicy } from "../../supabase/functions/_helpers/conditionPolicy";
import { useAnalyzeConditionOptions } from "@/hooks/useAnalyzeConditionOptions";

const conditionPolicy = buildConditionPolicy("12345", {
  categoryId: "12345",
  itemConditionRequired: true,
  itemConditions: [
    { conditionId: "1000", conditionDescription: "New Factory Sealed" },
    { conditionId: "1500", conditionDescription: "Open box" },
  ],
});

describe("useAnalyzeConditionOptions", () => {
  test("uses policy IDs and exact policy labels, ignoring legacy allowed conditions", () => {
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: {
          allowedConditions: ["USED_EXCELLENT"],
          conditionPolicy,
        },
        ebayCategoryId: "12345",
        condition: "1000",
        setCondition: vi.fn(),
      }),
    );

    expect(result.current.conditionOptions).toEqual([
      { value: "1000", label: "New Factory Sealed" },
      { value: "1500", label: "Open box" },
    ]);
  });

  test("converts a uniquely resolvable legacy enum to its policy ID", async () => {
    const setCondition = vi.fn();
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: { conditionPolicy },
        ebayCategoryId: "12345",
        condition: "NEW",
        setCondition,
      }),
    );

    expect(result.current.resolvedCondition?.conditionId).toBe("1000");
    expect(setCondition).toHaveBeenCalledWith("1000");
  });

  test("does not invent options or replace invalid legacy selections", () => {
    const setCondition = vi.fn();
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: { allowedConditions: ["USED_EXCELLENT"] },
        ebayCategoryId: "12345",
        condition: "UNSUPPORTED_LEGACY_VALUE",
        setCondition,
      }),
    );

    expect(result.current.conditionOptions).toEqual([]);
    expect(result.current.conditionValidation.valid).toBe(false);
    expect(result.current.resolvedCondition).toBeUndefined();
    expect(setCondition).not.toHaveBeenCalled();
  });

  test("keeps selection invalid when a legacy enum maps ambiguously", () => {
    const ambiguousPolicy = buildConditionPolicy("12345", {
      categoryId: "12345",
      itemConditionRequired: true,
      itemConditions: [
        { conditionId: "1000", conditionDescription: "USED_EXCELLENT" },
        { conditionId: "3000", conditionDescription: "Used excellent" },
      ],
    });
    const setCondition = vi.fn();
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: { conditionPolicy: ambiguousPolicy },
        ebayCategoryId: "12345",
        condition: "USED_EXCELLENT",
        setCondition,
      }),
    );

    expect(result.current.resolvedCondition).toBeUndefined();
    expect(result.current.conditionValidation.valid).toBe(false);
    expect(setCondition).not.toHaveBeenCalled();
  });

  test("clears descriptors when the seller selects a different condition", () => {
    const setCondition = vi.fn();
    const setDescriptors = vi.fn();
    const { result } = renderHook(() =>
      useAnalyzeConditionOptions({
        ebayMetadata: { conditionPolicy },
        ebayCategoryId: "12345",
        condition: "1000",
        descriptors: [{ name: "grade", values: ["10"] }],
        setCondition,
        setDescriptors,
      }),
    );

    result.current.updateCondition("1500");

    expect(setCondition).toHaveBeenCalledWith("1500");
    expect(setDescriptors).toHaveBeenCalledWith([]);
  });
});
