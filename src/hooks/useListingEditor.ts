import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ItemSpecifics } from "@/types/listing";
import {
  resolvePolicyCondition,
  unavailableConditionPolicy,
  validateConditionSelection,
} from "../../supabase/functions/_helpers/conditionPolicy";
import type {
  ConditionDescriptorSelection,
  ConditionPolicy,
} from "../../supabase/functions/_helpers/conditionPolicy";

export interface EbayAspect {
  name: string;
  required: boolean;
  usage: string;
  mode: string;
  dataType: string;
  values: string[];
}

export interface EditorListingRef {
  offerId: string | null;
  sku: string;
  listingId: string | null;
  title: string;
  description: string;
}

export interface EditorState {
  listingRef: EditorListingRef;
  title: string;
  description: string;
  price: number | null;
  quantity: number | null;
  condition: string | null;
  conditionDescription: string;
  conditionDescriptors: ConditionDescriptorSelection[];
  categoryId: string | null;
  itemSpecifics: ItemSpecifics;
  bestOfferEnabled: boolean;
  bestOfferAutoAcceptPrice: number | null;
  bestOfferAutoDeclinePrice: number | null;
  cogs: number | null;
  cogsSource: string | null;
  acquiredAt: string | null;
}

export interface SaveResult {
  success: boolean;
  updatedFields: string[];
  errors: string[];
  warnings: string[];
}

export interface UseListingEditorReturn {
  editorState: EditorState | null;
  isLoading: boolean;
  isSaving: boolean;
  dirtyFields: Set<string>;
  errors: Record<string, string>;

  loadListing: (listing: EditorListingRef) => Promise<void>;
  updateField: (field: string, value: unknown) => void;
  saveChanges: () => Promise<SaveResult>;
  discardChanges: () => void;

  onCategoryChange: (newCategoryId: string) => Promise<void>;
  categoryAspects: EbayAspect[];
  conditionPolicy: ConditionPolicy;
  conditionPolicyLoading: boolean;
  conditionPolicyValidation: ReturnType<typeof validateConditionSelection>;
  inventoryItemAvailable: boolean;
}

interface UseListingEditorParams {
  userId: string | null | undefined;
  userToken: string | null | undefined;
}

// Fields that belong to ebay-reprice's `update_content` action (title/description)
// rather than ebay-edit-listing's `save_changes` — see LISTING_EDITOR_PLAN.md Part 3.
const CONTENT_FIELDS = new Set(["title", "description"]);

export function useListingEditor({
  userId,
  userToken,
}: UseListingEditorParams): UseListingEditorReturn {
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [initialState, setInitialState] = useState<EditorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categoryAspects, setCategoryAspects] = useState<EbayAspect[]>([]);
  const [conditionPolicy, setConditionPolicy] = useState<ConditionPolicy>(
    unavailableConditionPolicy("", "Condition policy has not been loaded"),
  );
  const [conditionPolicyLoading, setConditionPolicyLoading] = useState(false);
  const [inventoryItemAvailable, setInventoryItemAvailable] = useState(false);
  const categoryRequestId = useRef(0);

  const loadListing = useCallback(
    async (listing: EditorListingRef) => {
      const requestId = ++categoryRequestId.current;
      setIsLoading(true);
      setConditionPolicyLoading(true);
      setErrors({});
      setCategoryAspects([]);
      setEditorState(null);
      setInitialState(null);
      setDirtyFields(new Set());
      try {
        const { data, error } = await supabase.functions.invoke(
          "ebay-edit-listing",
          {
            body: {
              action: "get_listing_details",
              offerId: listing.offerId,
              sku: listing.sku,
              listingId: listing.listingId,
              userId,
            },
          },
        );

        if (requestId !== categoryRequestId.current) return;
        if (error) throw error;
        if (!data?.success) {
          throw new Error(data?.error || "Failed to load listing details");
        }

        const offer = data.offer ?? {};
        const inventoryItem = data.inventoryItem ?? {};
        const cogsRow = data.cogs ?? null;
        const nextPolicy: ConditionPolicy =
          data.conditionPolicy ??
          unavailableConditionPolicy(
            String(offer.categoryId ?? ""),
            "Condition policy was not returned with listing details",
          );
        const savedCondition = String(
          inventoryItem.condition ?? inventoryItem.conditionDescription ?? "",
        );
        const resolvedCondition = resolvePolicyCondition(
          nextPolicy,
          savedCondition,
        );

        const nextState: EditorState = {
          listingRef: listing,
          title: listing.title,
          description: listing.description,
          price: offer.price?.value != null ? Number(offer.price.value) : null,
          quantity:
            inventoryItem.availability?.shipToLocationAvailability?.quantity ??
            null,
          condition: resolvedCondition?.conditionId ?? (savedCondition || null),
          conditionDescription: inventoryItem.conditionDescription ?? "",
          conditionDescriptors: Array.isArray(
            inventoryItem.conditionDescriptors,
          )
            ? inventoryItem.conditionDescriptors
            : [],
          categoryId: offer.categoryId ?? null,
          itemSpecifics: (inventoryItem.product?.aspects ??
            {}) as ItemSpecifics,
          bestOfferEnabled: offer.bestOfferTerms?.bestOfferEnabled ?? false,
          bestOfferAutoAcceptPrice: offer.bestOfferTerms?.autoAcceptPrice?.value
            ? Number(offer.bestOfferTerms.autoAcceptPrice.value)
            : null,
          bestOfferAutoDeclinePrice: offer.bestOfferTerms?.autoDeclinePrice
            ?.value
            ? Number(offer.bestOfferTerms.autoDeclinePrice.value)
            : null,
          cogs: cogsRow?.cogs ?? null,
          cogsSource: cogsRow?.cogs_source ?? null,
          acquiredAt: cogsRow?.acquired_at ?? null,
        };

        setEditorState(nextState);
        setInitialState(nextState);
        setDirtyFields(new Set());
        setCategoryAspects(data.categoryAspects ?? []);
        setConditionPolicy(nextPolicy);
        setConditionPolicyLoading(false);
        setInventoryItemAvailable(Boolean(data.inventoryItem));
        if (nextPolicy.status !== "available") {
          setErrors((prev) => ({
            ...prev,
            conditionPolicy:
              nextPolicy.reason || "Condition policy is unavailable",
          }));
        }
      } catch (err) {
        if (requestId !== categoryRequestId.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useListingEditor] loadListing error:", msg);
        setErrors((prev) => ({ ...prev, load: msg }));
        setConditionPolicy(unavailableConditionPolicy("", msg));
        setConditionPolicyLoading(false);
        setCategoryAspects([]);
        setInventoryItemAvailable(false);
        toast.error("Couldn't load listing details for editing.");
      } finally {
        if (requestId === categoryRequestId.current) setIsLoading(false);
      }
    },
    [userId],
  );

  const updateField = useCallback((field: string, value: unknown) => {
    setEditorState((prev) => {
      if (!prev) return prev;
      if (field === "condition" && value !== prev.condition) {
        return {
          ...prev,
          condition: value as string | null,
          conditionDescriptors: [],
        };
      }
      return { ...prev, [field]: value } as EditorState;
    });
    setDirtyFields((prev) => {
      const next = new Set(prev).add(field);
      if (field === "condition") next.add("conditionDescriptors");
      return next;
    });
  }, []);

  const onCategoryChange = useCallback(
    async (newCategoryId: string) => {
      const categoryId = newCategoryId.trim();
      if (!editorState || categoryId === (editorState.categoryId ?? "")) return;

      const requestId = ++categoryRequestId.current;
      setEditorState(
        (prev) =>
          prev && {
            ...prev,
            categoryId: categoryId || null,
            condition: null,
            conditionDescription: "",
            conditionDescriptors: [],
          },
      );
      setDirtyFields((prev) => {
        const next = new Set(prev);
        [
          "categoryId",
          "condition",
          "conditionDescription",
          "conditionDescriptors",
        ].forEach((field) => next.add(field));
        return next;
      });
      setCategoryAspects([]);
      setConditionPolicyLoading(Boolean(categoryId));
      setConditionPolicy(
        unavailableConditionPolicy(
          categoryId,
          categoryId
            ? "Loading condition policy for this category"
            : "Select a category",
        ),
      );
      setErrors((prev) => {
        const next = { ...prev };
        delete next.conditionPolicy;
        return next;
      });
      if (!categoryId) {
        setConditionPolicyLoading(false);
        return;
      }

      try {
        const [aspectsResult, conditionsResult] = await Promise.all([
          supabase.functions.invoke("category-lookup", {
            body: { action: "aspects", categoryId },
          }),
          supabase.functions.invoke("category-lookup", {
            body: { action: "conditions", categoryId },
          }),
        ]);

        if (requestId !== categoryRequestId.current) return;
        setCategoryAspects(
          !aspectsResult.error ? (aspectsResult.data?.aspects ?? []) : [],
        );
        if (aspectsResult.error) {
          console.warn(
            "[useListingEditor] category aspects refresh failed:",
            aspectsResult.error,
          );
        }
        const nextPolicy: ConditionPolicy = conditionsResult.error
          ? unavailableConditionPolicy(
              categoryId,
              String(conditionsResult.error),
            )
          : (conditionsResult.data?.conditionPolicy ??
            unavailableConditionPolicy(
              categoryId,
              "Condition policy was not returned for this category",
            ));
        setConditionPolicy(nextPolicy);
        setConditionPolicyLoading(false);
        if (
          nextPolicy.status !== "available" ||
          nextPolicy.categoryId !== categoryId
        ) {
          setErrors((prev) => ({
            ...prev,
            conditionPolicy:
              nextPolicy.reason ||
              "Condition policy is unavailable for this category",
          }));
        } else {
          setErrors((prev) => {
            const next = { ...prev };
            delete next.conditionPolicy;
            return next;
          });
        }
      } catch (e) {
        if (requestId !== categoryRequestId.current) return;
        const reason = e instanceof Error ? e.message : String(e);
        setConditionPolicy(
          unavailableConditionPolicy(
            categoryId,
            reason || "Condition policy request failed",
          ),
        );
        setConditionPolicyLoading(false);
        setErrors((prev) => ({ ...prev, conditionPolicy: reason }));
        console.warn("[useListingEditor] onCategoryChange refresh failed:", e);
      }
    },
    [editorState],
  );

  const discardChanges = useCallback(() => {
    if (initialState) {
      setEditorState(initialState);
    }
    setDirtyFields(new Set());
    setErrors({});
  }, [initialState]);

  const saveChanges = useCallback(async (): Promise<SaveResult> => {
    if (!editorState) {
      return {
        success: false,
        updatedFields: [],
        errors: ["No listing loaded"],
        warnings: [],
      };
    }

    setIsSaving(true);
    setErrors({});
    const updatedFields: string[] = [];
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    try {
      const { listingRef } = editorState;
      const contentDirty = [...dirtyFields].some((f) => CONTENT_FIELDS.has(f));
      const otherDirty = [...dirtyFields].some((f) => !CONTENT_FIELDS.has(f));

      const calls: Promise<void>[] = [];

      if (contentDirty) {
        calls.push(
          (async () => {
            const titleChanged = dirtyFields.has("title");
            const descChanged = dirtyFields.has("description");
            const { data, error } = await supabase.functions.invoke(
              "ebay-reprice",
              {
                body: {
                  action: "update_content",
                  offerId: listingRef.offerId,
                  sku: listingRef.sku,
                  listingId: listingRef.listingId,
                  userToken,
                  userId,
                  newTitle: titleChanged ? editorState.title.trim() : undefined,
                  newDescription: descChanged
                    ? editorState.description.trim()
                    : undefined,
                },
              },
            );
            if (error) throw error;
            if (!data?.success) {
              throw new Error(data?.error || "Content update failed");
            }
            if (titleChanged) updatedFields.push("title");
            if (descChanged) updatedFields.push("description");
          })().catch((err) => {
            allErrors.push(
              `Content update failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
        );
      }

      if (otherDirty) {
        calls.push(
          (async () => {
            const changes: Record<string, unknown> = {};
            if (dirtyFields.has("price")) changes.price = editorState.price;
            if (dirtyFields.has("quantity"))
              changes.quantity = editorState.quantity;
            if (dirtyFields.has("condition"))
              changes.condition = editorState.condition;
            if (dirtyFields.has("conditionDescription")) {
              changes.conditionDescription = editorState.conditionDescription;
            }
            if (dirtyFields.has("conditionDescriptors")) {
              changes.conditionDescriptors = editorState.conditionDescriptors;
            }
            if (dirtyFields.has("categoryId"))
              changes.categoryId = editorState.categoryId;
            if (dirtyFields.has("itemSpecifics")) {
              changes.itemSpecifics = editorState.itemSpecifics;
            }
            if (dirtyFields.has("bestOfferEnabled")) {
              changes.bestOfferEnabled = editorState.bestOfferEnabled;
            }
            if (dirtyFields.has("bestOfferAutoAcceptPrice")) {
              changes.bestOfferAutoAcceptPrice =
                editorState.bestOfferAutoAcceptPrice;
            }
            if (dirtyFields.has("bestOfferAutoDeclinePrice")) {
              changes.bestOfferAutoDeclinePrice =
                editorState.bestOfferAutoDeclinePrice;
            }

            const cogsDirty =
              dirtyFields.has("cogs") ||
              dirtyFields.has("cogsSource") ||
              dirtyFields.has("acquiredAt");

            const { data, error } = await supabase.functions.invoke(
              "ebay-edit-listing",
              {
                body: {
                  action: "save_changes",
                  offerId: listingRef.offerId,
                  sku: listingRef.sku,
                  listingId: listingRef.listingId,
                  userId,
                  changes,
                  cogsUpdate: cogsDirty
                    ? {
                        cogs: editorState.cogs,
                        cogsSource: editorState.cogsSource ?? "manual",
                        acquiredAt: editorState.acquiredAt,
                      }
                    : undefined,
                },
              },
            );
            if (error) throw error;
            updatedFields.push(...(data?.updatedFields ?? []));
            allErrors.push(...(data?.errors ?? []));
            allWarnings.push(...(data?.warnings ?? []));
          })().catch((err) => {
            allErrors.push(
              `Save failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }),
        );
      }

      await Promise.all(calls);

      const success = allErrors.length === 0;
      if (success) {
        setInitialState(editorState);
        setDirtyFields(new Set());
        toast.success("Listing updated");
      } else {
        setErrors((prev) => ({ ...prev, save: allErrors.join("; ") }));
        toast.error("Some changes failed to save");
      }

      return {
        success,
        updatedFields,
        errors: allErrors,
        warnings: allWarnings,
      };
    } finally {
      setIsSaving(false);
    }
  }, [editorState, dirtyFields, userId, userToken]);

  const categoryId = editorState?.categoryId ?? "";
  const conditionPolicyValidation = validateConditionSelection(
    conditionPolicy,
    categoryId,
    editorState?.condition ?? "",
    editorState?.conditionDescriptors ?? [],
  );

  return {
    editorState,
    isLoading,
    isSaving,
    dirtyFields,
    errors,
    loadListing,
    updateField,
    saveChanges,
    discardChanges,
    onCategoryChange,
    categoryAspects,
    conditionPolicy,
    conditionPolicyLoading,
    conditionPolicyValidation,
    inventoryItemAvailable,
  };
}
