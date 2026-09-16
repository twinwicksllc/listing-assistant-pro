import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the 2026-09-16 ring-publish bug: a draft moved from
// a Books category to a Rings category kept the OLD category's
// allowedConditions (useAnalyzeCategoryAspects.ts preserved them via
// `metadataRef.current?.allowedConditions ?? []` on every branch instead of
// fetching fresh ones), so every condition code offered to the seller was
// illegal for the new jewelry leaf and publish was rejected by eBay.
//
// Also covers a second bug found the same day: eBay's conditions API returns
// human-readable conditionDescription strings ("New with tags", "Used"), not
// ConditionEnum values — toAllowedConditions() must normalize these (via
// normalizeEbayConditionDescription) rather than passing them through raw,
// or the exact string eBay described gets rejected by eBay's own publish
// endpoint for that same category.

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";
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
    // Normalized to ConditionEnum values, not eBay's raw conditionDescription
    // strings ("New with tags", "Used") — those aren't valid Inventory API
    // condition values and eBay's own publish endpoint would reject them.
    expect(lastCall.allowedConditions).toEqual(["NEW", "USED_EXCELLENT"]);
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

// Regression coverage for a third bug found the same day: stale item
// specifics from the OLD category (e.g. Language/Author/Book Title on a
// listing the AI misidentified as a book) survived a category change to
// Rings because the prune loop only dropped EMPTY-string values — a
// non-empty AI-seeded placeholder like "N/A" was treated as "user-filled"
// and kept forever, regardless of whether the new category's aspect schema
// even recognized that key.
describe("useAnalyzeCategoryAspects — stale item specifics pruning on category change", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("drops specifics not in the new category's aspect schema, even when their value is non-empty", async () => {
    mockResponsesFor("261994"); // Jewelry & Watches > Fine Jewelry > Rings

    const setItemSpecifics = vi.fn();
    const setEbayMetadata = vi.fn();

    renderHook(() =>
      useAnalyzeCategoryAspects({
        ebayCategoryId: "261994",
        generated: true,
        itemSpecifics: {},
        setItemSpecifics,
        setEbayMetadata,
        currentEbayMetadata: null,
      }),
    );

    await waitFor(() => expect(setItemSpecifics).toHaveBeenCalled());

    const updater = setItemSpecifics.mock.calls[0][0];
    const staleBookSpecifics = {
      Language: "N/A",
      Author: "N/A",
      "Book Title": "N/A",
      _domain: "books",
    };
    const result = updater(staleBookSpecifics);

    expect(result.Language).toBeUndefined();
    expect(result.Author).toBeUndefined();
    expect(result["Book Title"]).toBeUndefined();
    // Internal (_-prefixed) keys are always preserved regardless of schema.
    expect(result._domain).toBe("books");
    // The new category's own aspect ("Metal", from mockResponsesFor) is seeded.
    expect(result.Metal).toBe("");
  });

  it("clears real specifics down to just internal keys when the new category has no aspects", async () => {
    invokeMock.mockImplementation(
      async (
        _fn: string,
        opts: { body: { action: string; categoryId: string } },
      ) => {
        if (opts.body.action === "aspects") {
          // isActive:true is required alongside isLeaf:false to mean a
          // CONFIRMED parent/rollup category (category-lookup's
          // verifyCategoryLeafActive returns isActive:false on every one of
          // its own failure modes too -- isLeaf:false alone is ambiguous).
          return {
            data: { aspects: [], isLeaf: false, isActive: true },
            error: null,
          };
        }
        if (opts.body.action === "conditions") {
          return { data: { conditions: [] }, error: null };
        }
        throw new Error("unexpected action");
      },
    );

    const setItemSpecifics = vi.fn();
    const setEbayMetadata = vi.fn();

    renderHook(() =>
      useAnalyzeCategoryAspects({
        ebayCategoryId: "253", // a parent/rollup category
        generated: true,
        itemSpecifics: {},
        setItemSpecifics,
        setEbayMetadata,
        currentEbayMetadata: null,
      }),
    );

    await waitFor(() => expect(setItemSpecifics).toHaveBeenCalled());

    const updater = setItemSpecifics.mock.calls[0][0];
    const result = updater({
      Language: "N/A",
      _domain: "books",
    });

    expect(result.Language).toBeUndefined();
    expect(result._domain).toBe("books");
  });

  // Regression coverage for a Copilot review finding on PR #573:
  // category-lookup's verifyCategoryLeafActive returns isLeaf:false on EVERY
  // one of its own failure modes (404, non-2xx, unparseable JSON, a missing
  // node, a thrown exception) -- not just a real parent/rollup category. The
  // hook must not treat that ambiguous shape as a confirmed parent: doing so
  // wiped valid specifics and permanently poisoned the retry cache on a
  // transient API hiccup, not just a genuine parent category.
  it("does NOT wipe specifics or cache the category when isLeaf:false but isActive is NOT true (unknown/transient failure, not a confirmed parent)", async () => {
    invokeMock.mockImplementation(
      async (
        _fn: string,
        opts: { body: { action: string; categoryId: string } },
      ) => {
        if (opts.body.action === "aspects") {
          // isActive:false (or absent) alongside isLeaf:false means the
          // leaf-verification call itself failed -- leaf status is unknown,
          // NOT a confirmed parent.
          return {
            data: { aspects: [], isLeaf: false, isActive: false },
            error: null,
          };
        }
        if (opts.body.action === "conditions") {
          return { data: { conditions: [] }, error: null };
        }
        throw new Error("unexpected action");
      },
    );

    const setItemSpecifics = vi.fn();
    const setEbayMetadata = vi.fn();

    renderHook(() =>
      useAnalyzeCategoryAspects({
        ebayCategoryId: "999999",
        generated: true,
        itemSpecifics: { Metal: "Gold" },
        setItemSpecifics,
        setEbayMetadata,
        currentEbayMetadata: null,
      }),
    );

    // The toast.error path fires instead of the specifics-wipe path.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    // Existing specifics must be left untouched -- no wipe on an unknown failure.
    expect(setItemSpecifics).not.toHaveBeenCalled();
    // ebayMetadata must not be overwritten with an empty schema either --
    // that would incorrectly stop enforcing this category's real requirements.
    expect(setEbayMetadata).not.toHaveBeenCalled();
  });
});
