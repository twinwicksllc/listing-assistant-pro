import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ItemSpecifics } from "@/types/listing";

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
  allowedConditions: string[];
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
  const [allowedConditions, setAllowedConditions] = useState<string[]>([]);

  const loadListing = useCallback(
    async (listing: EditorListingRef) => {
      setIsLoading(true);
      setErrors({});
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

        if (error) throw error;
        if (!data?.success) {
          throw new Error(data?.error || "Failed to load listing details");
        }

        const offer = data.offer ?? {};
        const inventoryItem = data.inventoryItem ?? {};
        const cogsRow = data.cogs ?? null;

        const nextState: EditorState = {
          listingRef: listing,
          title: listing.title,
          description: listing.description,
          price: offer.price?.value != null ? Number(offer.price.value) : null,
          quantity:
            inventoryItem.availability?.shipToLocationAvailability?.quantity ??
            null,
          condition: inventoryItem.condition ?? null,
          conditionDescription: inventoryItem.conditionDescription ?? "",
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
        setAllowedConditions(data.allowedConditions ?? []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useListingEditor] loadListing error:", msg);
        setErrors((prev) => ({ ...prev, load: msg }));
        toast.error("Couldn't load listing details for editing.");
      } finally {
        setIsLoading(false);
      }
    },
    [userId],
  );

  const updateField = useCallback((field: string, value: unknown) => {
    setEditorState((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value } as EditorState;
    });
    setDirtyFields((prev) => new Set(prev).add(field));
  }, []);

  const onCategoryChange = useCallback(
    async (newCategoryId: string) => {
      updateField("categoryId", newCategoryId);
      try {
        const [aspectsResult, conditionsResult] = await Promise.all([
          supabase.functions.invoke("category-lookup", {
            body: { action: "aspects", categoryId: newCategoryId },
          }),
          supabase.functions.invoke("category-lookup", {
            body: { action: "conditions", categoryId: newCategoryId },
          }),
        ]);

        if (!aspectsResult.error) {
          setCategoryAspects(aspectsResult.data?.aspects ?? []);
        }
        if (!conditionsResult.error) {
          const conditions = conditionsResult.data?.conditions ?? [];
          setAllowedConditions(
            conditions
              .map(
                (c: { conditionDescription?: string; conditionId?: string }) =>
                  c.conditionDescription || c.conditionId || "",
              )
              .filter(Boolean),
          );
        }
      } catch (e) {
        console.warn("[useListingEditor] onCategoryChange refresh failed:", e);
      }
    },
    [updateField],
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
    allowedConditions,
  };
}
