import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the 2026-09-16 ring-publish bug: a draft moved from
// a Books category to a Rings category kept the OLD category's
// allowedConditions (useAnalyzeCategoryAspects.ts preserved them via
// `metadataRef.current?.allowedConditions ?? []` on every branch instead of
// fetching fresh ones), so every condition code offered to the seller was
// illegal for the new jewelry leaf and publish was rejected by eBay.

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { useAnalyzeCategoryAspects } from "@/hooks/useAnalyzeCategoryAspects";

function mockResponsesFor(categoryId: string) {
  invokeMock.mockImplementation(
    async (
      fn: string,
      opts: { body: { action: string; categoryId: string } },
    ) => {
      expect(fn).toBe("category-lookup");
      expect(opts.body.categoryId).toBe(categoryId);
      if (opts.body.action === "aspects") {
        return {
          data: {
            aspects: [{ name: "Metal", required: true, usage: "REQUIRED" }],
          },
          error: null,
        };
      }
      if (opts.body.action === "conditions") {
        return {
          data: {
            conditions: [
              { conditionId: 1000, conditionDescription: "New with tags" },
              { conditionId: 3000, conditionDescription: "Used" },
            ],
          },
          error: null,
        };
      }
      throw new Error(`unexpected action ${opts.body.action}`);
    },
  );
}

describe("useAnalyzeCategoryAspects — allowedConditions refresh on category change", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("replaces allowedConditions with the NEW category's conditions rather than preserving the old ones", async () => {
    mockResponsesFor("67742"); // Jewelry & Watches > Fine Jewelry > Rings

    const setItemSpecifics = vi.fn();
    const setEbayMetadata = vi.fn();

    // Simulate a draft that started life as a Books category — the stale
    // allowedConditions a caller like AnalyzePage would still be holding.
    const staleBooksConditions = ["GOOD", "ACCEPTABLE", "VERY_GOOD"];

    renderHook(() =>
      useAnalyzeCategoryAspects({
        ebayCategoryId: "67742",
        generated: true,
        itemSpecifics: {},
        setItemSpecifics,
        setEbayMetadata,
        currentEbayMetadata: {
          requiredAspects: [],
          suggestedAspects: [],
          allowedConditions: staleBooksConditions,
        },
      }),
    );

    await waitFor(() => expect(setEbayMetadata).toHaveBeenCalled());

    const lastCall =
      setEbayMetadata.mock.calls[setEbayMetadata.mock.calls.length - 1][0];
    expect(lastCall.allowedConditions).toEqual(["New with tags", "Used"]);
    expect(lastCall.allowedConditions).not.toEqual(staleBooksConditions);
  });

  it("falls back to the previous allowedConditions only if the conditions fetch itself errors", async () => {
    invokeMock.mockImplementation(
      async (
        _fn: string,
        opts: { body: { action: string; categoryId: string } },
      ) => {
        if (opts.body.action === "aspects") {
          return { data: { aspects: [] }, error: null };
        }
        if (opts.body.action === "conditions") {
          return { data: null, error: new Error("network error") };
        }
        throw new Error("unexpected action");
      },
    );

    const setEbayMetadata = vi.fn();
    const priorConditions = ["USED_GOOD"];

    renderHook(() =>
      useAnalyzeCategoryAspects({
        ebayCategoryId: "67742",
        generated: true,
        itemSpecifics: {},
        setItemSpecifics: vi.fn(),
        setEbayMetadata,
        currentEbayMetadata: {
          requiredAspects: [],
          suggestedAspects: [],
          allowedConditions: priorConditions,
        },
      }),
    );

    await waitFor(() => expect(setEbayMetadata).toHaveBeenCalled());

    const lastCall =
      setEbayMetadata.mock.calls[setEbayMetadata.mock.calls.length - 1][0];
    expect(lastCall.allowedConditions).toEqual(priorConditions);
  });

  it("re-fetches conditions when the category changes again after an initial fetch", async () => {
    mockResponsesFor("67742");
    const setEbayMetadata = vi.fn();

    const { rerender } = renderHook(
      ({ categoryId }: { categoryId: string }) =>
        useAnalyzeCategoryAspects({
          ebayCategoryId: categoryId,
          generated: true,
          itemSpecifics: {},
          setItemSpecifics: vi.fn(),
          setEbayMetadata,
          currentEbayMetadata: null,
        }),
      { initialProps: { categoryId: "67742" } },
    );

    await waitFor(() => expect(setEbayMetadata).toHaveBeenCalledTimes(1));

    mockResponsesFor("11233"); // switch categories
    await act(async () => {
      rerender({ categoryId: "11233" });
    });

    await waitFor(() => expect(setEbayMetadata).toHaveBeenCalledTimes(2));
    expect(invokeMock).toHaveBeenCalledWith(
      "category-lookup",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "conditions",
          categoryId: "11233",
        }),
      }),
    );
  });
});
