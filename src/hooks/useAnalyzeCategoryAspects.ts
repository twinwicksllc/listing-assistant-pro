import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ItemSpecifics } from "@/types/listing";

interface AspectInfo {
  name: string;
  required: boolean;
  usage: string;
  mode: string;
  dataType: string;
  values: string[];
}

interface UseAnalyzeCategoryAspectsParams {
  /** The eBay category ID to fetch aspects for */
  ebayCategoryId: string;
  /** Only run after initial analysis is complete */
  generated: boolean;
  /** Current item specifics — used to preserve values the user has already entered */
  itemSpecifics: ItemSpecifics;
  setItemSpecifics: (updater: (prev: ItemSpecifics) => ItemSpecifics) => void;
  setEbayMetadata: (meta: {
    requiredAspects: string[];
    suggestedAspects: string[];
    allowedConditions: string[];
  } | null) => void;
  /** Previous metadata (to preserve allowedConditions when we only update aspects) */
  currentEbayMetadata: {
    requiredAspects: string[];
    suggestedAspects: string[];
    allowedConditions: string[];
  } | null;
}

/**
 * Watches ebayCategoryId for changes after the initial analysis is complete.
 * When the category changes (e.g. user overrides the AI's category), fetches
 * the new category's required + suggested aspects from the category-lookup
 * edge function and seeds itemSpecifics with empty strings for any aspects
 * that don't already have a value — so they appear as editable rows in the UI.
 *
 * Also updates ebayMetadata.requiredAspects and suggestedAspects so that
 * the "req" / "opt" labels and the publish-time validation reflect the new category.
 */
export function useAnalyzeCategoryAspects({
  ebayCategoryId,
  generated,
  itemSpecifics,
  setItemSpecifics,
  setEbayMetadata,
  currentEbayMetadata,
}: UseAnalyzeCategoryAspectsParams) {
  // Track the last category we fetched aspects for so we don't re-fetch on
  // every render (ebayCategoryId is stable between renders once set).
  const lastFetchedCategoryRef = useRef<string>("");

  useEffect(() => {
    // Only run after the initial AI analysis has completed and a category is set.
    if (!generated || !ebayCategoryId) return;

    // Don't re-fetch for the same category we already have data for.
    if (lastFetchedCategoryRef.current === ebayCategoryId) return;

    lastFetchedCategoryRef.current = ebayCategoryId;

    const fetchAndSeed = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("category-lookup", {
          body: { action: "aspects", categoryId: ebayCategoryId },
        });

        if (error || !data?.aspects?.length) {
          console.warn(
            `useAnalyzeCategoryAspects: no aspects for category ${ebayCategoryId}`,
            error,
          );
          return;
        }

        const aspects: AspectInfo[] = data.aspects;

        // Separate into required and suggested for metadata
        const required = aspects
          .filter((a) => a.required || a.usage === "REQUIRED")
          .map((a) => a.name);
        const suggested = aspects
          .filter((a) => !a.required && a.usage !== "REQUIRED")
          .map((a) => a.name);

        // Update ebayMetadata with new required/suggested aspects.
        // Preserve allowedConditions from the previous fetch if available.
        setEbayMetadata({
          requiredAspects: required,
          suggestedAspects: suggested,
          allowedConditions: currentEbayMetadata?.allowedConditions ?? [],
        });

        // Seed itemSpecifics: add empty string entries for any required or
        // suggested aspect that doesn't already have a value.
        // Required aspects are seeded first, then suggested.
        const seedOrder = [
          ...aspects.filter((a) => a.required || a.usage === "REQUIRED"),
          ...aspects.filter((a) => !a.required && a.usage !== "REQUIRED"),
        ];

        setItemSpecifics((prev) => {
          const next: ItemSpecifics = { ...prev };
          // Remove stale keys that start with _ (internal) but keep user-visible ones
          // that are already filled in by the user.
          for (const aspect of seedOrder) {
            if (!(aspect.name in next)) {
              // New aspect for this category — seed with empty string so it shows
              // as an editable row even before the user types anything.
              (next as Record<string, string>)[aspect.name] = "";
            }
            // If the key already exists (user filled it in or AI set it), keep the value.
          }
          return next;
        });

        console.log(
          `useAnalyzeCategoryAspects: seeded ${seedOrder.length} aspects for category ${ebayCategoryId} (${required.length} required, ${suggested.length} suggested)`,
        );
      } catch (e) {
        console.warn("useAnalyzeCategoryAspects: fetch error", e);
      }
    };

    void fetchAndSeed();
  }, [
    ebayCategoryId,
    generated,
    // NOTE: intentionally NOT including itemSpecifics in deps — we read it
    // via the functional updater to avoid stale closure issues.
    setItemSpecifics,
    setEbayMetadata,
    currentEbayMetadata,
  ]);
}
