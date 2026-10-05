import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConditionPolicy } from "../../supabase/functions/_helpers/conditionPolicy";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import { useListingEditor } from "@/hooks/useListingEditor";

const listing = {
  offerId: "offer-1",
  sku: "SKU1",
  listingId: "listing-1",
  title: "Vintage item",
  description: "Description",
};

function policyFor(categoryId: string) {
  return buildConditionPolicy(categoryId, {
    categoryId,
    itemConditionRequired: true,
    itemConditions: [
      {
        conditionId: 3000,
        conditionDescription: "Used - Excellent",
        conditionDescriptors: [
          {
            conditionDescriptorId: "grading",
            conditionDescriptorName: "Grading",
            conditionDescriptorConstraint: {
              cardinality: "SINGLE",
              mode: "SELECTION_ONLY",
            },
            conditionDescriptorValues: [
              {
                conditionDescriptorValueId: "A",
                conditionDescriptorValueName: "A",
              },
              {
                conditionDescriptorValueId: "B",
                conditionDescriptorValueName: "B",
              },
            ],
          },
        ],
      },
      {
        conditionId: 5000,
        conditionDescription: "Used - Good",
      },
    ],
  });
}

function listingDetails(categoryId = "100") {
  return {
    success: true,
    offer: { categoryId, price: { value: "25.00" } },
    inventoryItem: {
      condition: "USED_EXCELLENT",
      conditionDescription: "Saved seller note",
      conditionDescriptors: [{ name: "grading", values: ["A"] }],
    },
    categoryAspects: [],
    conditionPolicy: policyFor(categoryId),
    cogs: null,
  };
}

describe("useListingEditor condition policy", () => {
  beforeEach(() => invokeMock.mockReset());

  it("resolves the saved enum to a policy ID and retains editable inventory descriptors", async () => {
    invokeMock.mockResolvedValue({ data: listingDetails(), error: null });
    const { result } = renderHook(() =>
      useListingEditor({ userId: "user-1", userToken: "token" }),
    );

    await act(async () => result.current.loadListing(listing));

    expect(result.current.editorState?.condition).toBe("3000");
    expect(result.current.conditionPolicy.conditions[0]).toMatchObject({
      conditionId: "3000",
      conditionDescription: "Used - Excellent",
    });
    expect(result.current.editorState?.conditionDescriptors).toEqual([
      { name: "grading", values: ["A"] },
    ]);
    expect(result.current.inventoryItemAvailable).toBe(true);
    expect(result.current.conditionPolicyValidation.valid).toBe(true);

    act(() => {
      result.current.updateField("conditionDescriptors", [
        { name: "grading", values: ["B"] },
      ]);
    });
    await act(async () => result.current.saveChanges());

    expect(invokeMock).toHaveBeenCalledWith(
      "ebay-edit-listing",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "save_changes",
          changes: {
            conditionDescriptors: [{ name: "grading", values: ["B"] }],
          },
        }),
      }),
    );
  });

  it("clears descriptors when the selected condition changes", async () => {
    invokeMock.mockResolvedValue({ data: listingDetails(), error: null });
    const { result } = renderHook(() =>
      useListingEditor({ userId: "user-1", userToken: "token" }),
    );

    await act(async () => result.current.loadListing(listing));
    act(() => result.current.updateField("condition", "5000"));

    expect(result.current.editorState).toMatchObject({
      condition: "5000",
      conditionDescriptors: [],
    });
    expect(result.current.dirtyFields.has("conditionDescriptors")).toBe(true);
    expect(result.current.conditionPolicyValidation.valid).toBe(true);
  });

  it("ignores an older listing-details response after a newer load starts", async () => {
    let resolveFirst!: (result: { data: unknown; error: null }) => void;
    const firstResult = new Promise<{ data: unknown; error: null }>(
      (resolve) => {
        resolveFirst = resolve;
      },
    );
    invokeMock.mockReturnValueOnce(firstResult).mockResolvedValueOnce({
      data: listingDetails("200"),
      error: null,
    });

    const { result } = renderHook(() =>
      useListingEditor({ userId: "user-1", userToken: "token" }),
    );
    const firstListing = { ...listing, offerId: "offer-old", sku: "OLD" };
    const secondListing = { ...listing, offerId: "offer-new", sku: "NEW" };
    let firstLoad!: Promise<void>;

    await act(async () => {
      firstLoad = result.current.loadListing(firstListing);
      await result.current.loadListing(secondListing);
      resolveFirst({ data: listingDetails("100"), error: null });
      await firstLoad;
    });

    expect(result.current.editorState?.listingRef.sku).toBe("NEW");
    expect(result.current.conditionPolicy.categoryId).toBe("200");
    expect(result.current.isLoading).toBe(false);
  });

  it("clears condition-bound values on category change and does not fall back when policy loading fails", async () => {
    invokeMock.mockImplementation(
      async (
        functionName: string,
        options?: { body?: { action?: string; categoryId?: string } },
      ) => {
        if (functionName === "ebay-edit-listing") {
          return { data: listingDetails(), error: null };
        }
        if (options?.body?.action === "aspects") {
          return { data: { aspects: [{ name: "Material" }] }, error: null };
        }
        return { data: null, error: new Error("policy request failed") };
      },
    );
    const { result } = renderHook(() =>
      useListingEditor({ userId: "user-1", userToken: "token" }),
    );

    await act(async () => result.current.loadListing(listing));
    await act(async () => result.current.onCategoryChange("200"));

    await waitFor(() =>
      expect(result.current.conditionPolicyLoading).toBe(false),
    );
    expect(result.current.editorState).toMatchObject({
      categoryId: "200",
      condition: null,
      conditionDescription: "",
      conditionDescriptors: [],
    });
    expect(result.current.categoryAspects).toEqual([{ name: "Material" }]);
    expect(result.current.conditionPolicy.status).toBe("unavailable");
    expect(result.current.conditionPolicy.categoryId).toBe("200");
    expect(result.current.conditionPolicyValidation.valid).toBe(false);
    expect(result.current.dirtyFields.has("conditionDescriptors")).toBe(true);
  });
});
