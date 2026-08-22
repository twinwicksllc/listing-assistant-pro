import { useEffect, useRef } from "react";
import { toast } from "sonner";
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

interface EbayMetadata {
  requiredAspects: string[];
  suggestedAspects: string[];
  allowedConditions: string[];
}

interface UseAnalyzeCategoryAspectsParams {
  /** The eBay category ID to fetch aspects for */
  ebayCategoryId: string;
  /** Only run after initial analysis is complete */
  generated: boolean;
  /** Current item specifics — used to preserve values the user has already entered */
  itemSpecifics: ItemSpecifics;
  setItemSpecifics: (updater: (prev: ItemSpecifics) => ItemSpecifics) => void;
  setEbayMetadata: (meta: EbayMetadata | null) => void;
  /** Previous metadata (to preserve allowedConditions when we only update aspects) */
  currentEbayMetadata: EbayMetadata | null;
}

/**
 * Watches ebayCategoryId and refreshes the eBay item-specifics schema whenever
 * it changes (AI analysis result, dropdown pick, or custom-ID confirm).
 *
 * ── Why this hook was rewritten ────────────────────────────────────────────
 * The previous implementation had four defects that combined into the bug
 * "I changed the category to Barber Half but the attributes never refreshed":
 *
 *  1. `lastFetchedCategoryRef` was set BEFORE the network call and never rolled
 *     back on failure. A single failed/empty fetch permanently poisoned that
 *     category ID — every later attempt hit the `=== ebayCategoryId` early
 *     return and no request was ever made again.
 *  2. An empty `aspects` array (exactly what eBay returns for a parent/rollup
 *     category) took the same silent `return` path, so `ebayMetadata` stayed
 *     `null` after `handleCategorySelectChange` cleared it — leaving the UI
 *     with no req/opt labels and an empty specifics table.
 *  3. `currentEbayMetadata` sat in the dependency array while the effect itself
 *     called `setEbayMetadata`, so the effect re-ran on its own output. The ref
 *     guard hid the churn instead of fixing it.
 *  4. Stale specifics from the previous category were never removed, so aspects
 *     belonging to the old category lingered in the table.
 *
 * This version keeps a per-category request token, rolls the ref back on
 * failure so retries are possible, prunes stale untouched aspects, and tells
 * the seller when a category is a parent with no aspects.
 */
export function useAnalyzeCategoryAspects({
  ebayCategoryId,
  generated,
  setItemSpecifics,
  setEbayMetadata,
  currentEbayMetadata,
}: UseAnalyzeCategoryAspectsParams) {
  // Last category we SUCCESSFULLY fetched aspects for.
  const lastFetchedCategoryRef = useRef<string>("");
  // Category of the request currently in flight (prevents duplicate fetches
  // and lets us ignore responses that arrive out of order).
  const inFlightCategoryRef = useRef<string>("");
  // Read allowedConditions without making it an effect dependency.
  const metadataRef = useRef<EbayMetadata | null>(currentEbayMetadata);
  metadataRef.current = currentEbayMetadata;

  useEffect(() => {
    if (!generated || !ebayCategoryId) return;

    // Already have this category's aspects, or a request is already running.
    if (lastFetchedCategoryRef.current === ebayCategoryId) return;
    if (inFlightCategoryRef.current === ebayCategoryId) return;

    inFlightCategoryRef.current = ebayCategoryId;
    // Capture the target so a slow response for an old category cannot
    // overwrite state belonging to a newer selection.
    const requestedCategoryId = ebayCategoryId;
    let cancelled = false;

    const fetchAndSeed = async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "category-lookup",
          { body: { action: "aspects", categoryId: requestedCategoryId } },
        );

        // The user moved on to a different category while we were waiting.
        if (cancelled || requestedCategoryId !== ebayCategoryId) return;

        if (error) {
          // Transient failure — do NOT mark this category as fetched so the
          // next render (or the user re-picking it) can retry.
          console.warn(
            `useAnalyzeCategoryAspects: aspects fetch failed for ${requestedCategoryId}`,
            error,
          );
          toast.error(
            "Couldn't load eBay item specifics for this category. Re-select the category to retry.",
          );
          return;
        }

        const aspects: AspectInfo[] = Array.isArray(data?.aspects)
          ? data.aspects
          : [];

        if (aspects.length === 0) {
          // eBay returns no aspects for parent/rollup categories. Tell the
          // seller explicitly instead of silently rendering an empty table.
          const isParentCategory = data?.isLeaf === false;
          console.warn(
            `useAnalyzeCategoryAspects: no aspects for category ${requestedCategoryId}` +
              (isParentCategory ? " (non-leaf/parent category)" : ""),
          );

          if (isParentCategory) {
            toast.warning(
              `Category ${requestedCategoryId} is a parent category — eBay provides no item specifics for it. ` +
                "Pick a more specific sub-category (e.g. \"Barber (1892-1915)\" rather than \"Half Dollars\").",
              { duration: 10000 },
            );
          }

          // Publish-time validation must not keep enforcing the OLD category's
          // required aspects, so commit an empty schema rather than leaving
          // metadata null.
          setEbayMetadata({
            requiredAspects: [],
            suggestedAspects: [],
            allowedConditions: metadataRef.current?.allowedConditions ?? [],
          });

          // Only cache the "no aspects" outcome for a confirmed parent. A
          // transient empty response stays retryable.
          if (isParentCategory) {
            lastFetchedCategoryRef.current = requestedCategoryId;
          }
          return;
        }

        const required = aspects
          .filter((a) => a.required || a.usage === "REQUIRED")
          .map((a) => a.name);
        const suggested = aspects
          .filter((a) => !a.required && a.usage !== "REQUIRED")
          .map((a) => a.name);

        setEbayMetadata({
          requiredAspects: required,
          suggestedAspects: suggested,
          allowedConditions: metadataRef.current?.allowedConditions ?? [],
        });

        const validAspectNames = new Set(aspects.map((a) => a.name));

        setItemSpecifics((prev) => {
          const next: ItemSpecifics = {};

          // Keep internal keys (_ prefixed) and any value the user actually
          // filled in; drop empty placeholders left over from the previous
          // category so the table doesn't show stale, unrelated fields.
          for (const [key, value] of Object.entries(prev)) {
            if (key.startsWith("_")) {
              next[key] = value;
              continue;
            }
            const isEmptyString = typeof value === "string" && value.trim() === "";
            if (isEmptyString && !validAspectNames.has(key)) continue;
            next[key] = value;
          }

          // Seed required aspects first, then suggested, so the UI order is
          // meaningful for the seller.
          const seedOrder = [
            ...aspects.filter((a) => a.required || a.usage === "REQUIRED"),
            ...aspects.filter((a) => !a.required && a.usage !== "REQUIRED"),
          ];
          for (const aspect of seedOrder) {
            if (!(aspect.name in next)) {
              (next as Record<string, string>)[aspect.name] = "";
            }
          }
          return next;
        });

        // Only mark as fetched after a genuinely successful load.
        lastFetchedCategoryRef.current = requestedCategoryId;

        console.log(
          `useAnalyzeCategoryAspects: seeded ${aspects.length} aspects for category ${requestedCategoryId} ` +
            `(${required.length} required, ${suggested.length} suggested)`,
        );
      } catch (e) {
        console.warn("useAnalyzeCategoryAspects: fetch error", e);
      } finally {
        if (inFlightCategoryRef.current === requestedCategoryId) {
          inFlightCategoryRef.current = "";
        }
      }
    };

    void fetchAndSeed();

    return () => {
      cancelled = true;
    };
    // NOTE: `itemSpecifics` and `currentEbayMetadata` are deliberately excluded.
    // Both are written by this effect; including them would make it re-run on
    // its own output. They are read via functional updaters / metadataRef.
  }, [ebayCategoryId, generated, setItemSpecifics, setEbayMetadata]);
}
