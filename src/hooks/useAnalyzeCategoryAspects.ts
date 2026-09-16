import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeEbayConditionDescription } from "@/types/listing";
import type { ItemSpecifics } from "@/types/listing";

interface AspectInfo {
  name: string;
  required: boolean;
  usage: string;
  mode: string;
  dataType: string;
  values: string[];
}

interface RawCondition {
  conditionId?: string | number;
  conditionDescription?: string;
}

interface EbayMetadata {
  requiredAspects: string[];
  suggestedAspects: string[];
  allowedConditions: string[];
}

/**
 * Mirrors analyze-item's `allowedConditions` transform (index.ts, building
 * `ebayMetadata`) so a category change gets the same shape eBay's own
 * condition-policy API would produce for the new category, not stale codes
 * left over from whatever category the item started in.
 *
 * eBay's conditions API returns human-readable `conditionDescription`
 * strings ("New with tags", "Pre-owned", ...), not Inventory API
 * `ConditionEnum` values — these must be normalized before being used as a
 * dropdown value, or the exact string eBay described gets rejected by
 * eBay's own publish endpoint for that same category.
 */
function toAllowedConditions(conditions: RawCondition[]): string[] {
  return conditions
    .map((c) => c.conditionDescription || String(c.conditionId ?? ""))
    .filter((desc) => desc.length > 0 && !/^(graded|ungraded)$/i.test(desc))
    .map((desc) => normalizeEbayConditionDescription(desc) || desc);
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
  /** Previous metadata — only used as a fallback if the fresh conditions fetch itself fails */
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
 *     belonging to the old category lingered in the table — and the removal
 *     only checked for EMPTY string values, so an AI-seeded placeholder like
 *     "N/A" (e.g. Author/Book Title on a book the AI misidentified, still
 *     present after the user manually corrected the category to Rings) was
 *     treated as "user-filled" and never dropped, no matter how unrelated it
 *     was to the new category's schema.
 *  5. `allowedConditions` was carried over from the OLD category's metadata on
 *     every branch instead of being refetched, so switching categories (e.g.
 *     Books → Rings) kept condition codes eBay only accepts for the old leaf —
 *     none of which are legal for the new one, blocking publish.
 *
 * This version keeps a per-category request token, rolls the ref back on
 * failure so retries are possible, prunes every specific not present in the
 * new category's aspect schema regardless of its value, fetches conditions
 * fresh alongside aspects on every category change, and tells the seller
 * when a category is a parent with no aspects.
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
        const [{ data, error }, conditionsResult] = await Promise.all([
          supabase.functions.invoke("category-lookup", {
            body: { action: "aspects", categoryId: requestedCategoryId },
          }),
          // Fetch conditions fresh for the NEW category rather than keeping
          // whatever allowedConditions belonged to the OLD one — a draft moved
          // from Books to Rings otherwise keeps book-only condition codes,
          // every one of which eBay rejects for a jewelry leaf.
          supabase.functions.invoke("category-lookup", {
            body: { action: "conditions", categoryId: requestedCategoryId },
          }),
        ]);

        // The user moved on to a different category while we were waiting.
        if (cancelled || requestedCategoryId !== ebayCategoryId) return;

        let allowedConditions = metadataRef.current?.allowedConditions ?? [];
        if (conditionsResult.error) {
          console.warn(
            `useAnalyzeCategoryAspects: conditions fetch failed for ${requestedCategoryId}`,
            conditionsResult.error,
          );
        } else if (Array.isArray(conditionsResult.data?.conditions)) {
          // Replace outright — even an empty result means "this category has
          // no eBay-restricted conditions," which is still more correct than
          // carrying over a different category's codes.
          allowedConditions = toAllowedConditions(
            conditionsResult.data.conditions,
          );
        }

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
          // eBay returns no aspects for parent/rollup categories — but
          // category-lookup's isLeaf:false ALSO covers every failure mode of
          // its own leaf-verification call (404, non-2xx, unparseable JSON,
          // a missing node, a thrown exception — see verifyCategoryLeafActive
          // in category-lookup/index.ts, which returns isLeaf:false AND
          // isActive:false on every one of those). Copilot review (PR #573):
          // treating isLeaf:false alone as "confirmed parent" wiped valid
          // specifics and permanently poisoned lastFetchedCategoryRef on a
          // transient API hiccup, not just a real parent. isActive:true is
          // only set on a genuine successful check (leaf or not) — require
          // BOTH before treating this as confirmed rather than unknown.
          const isParentCategory =
            data?.isLeaf === false && data?.isActive === true;
          const isUnknownFailure =
            data?.isLeaf === false && data?.isActive !== true;
          console.warn(
            `useAnalyzeCategoryAspects: no aspects for category ${requestedCategoryId}` +
              (isParentCategory
                ? " (confirmed non-leaf/parent category)"
                : isUnknownFailure
                  ? " (leaf status unknown — treating as transient, will retry)"
                  : ""),
          );

          if (isParentCategory) {
            toast.warning(
              `Category ${requestedCategoryId} is a parent category — eBay provides no item specifics for it. ` +
                'Pick a more specific sub-category (e.g. "Barber (1892-1915)" rather than "Half Dollars").',
              { duration: 10000 },
            );
          }

          if (isUnknownFailure) {
            // Leaf status genuinely unknown (the leaf-verification call
            // itself failed) — do NOT wipe specifics or cache anything.
            // Treat exactly like the aspects-fetch-error branch below:
            // leave existing state alone so a retry (re-picking the
            // category, or this effect re-running) can recover cleanly.
            toast.error(
              "Couldn't confirm this category's item specifics. Re-select the category to retry.",
            );
            return;
          }

          // Publish-time validation must not keep enforcing the OLD category's
          // required aspects, so commit an empty schema rather than leaving
          // metadata null.
          setEbayMetadata({
            requiredAspects: [],
            suggestedAspects: [],
            allowedConditions,
          });

          // No aspects means no valid aspect names for this category — drop
          // every real (non-underscore) key so a category with genuinely no
          // schema doesn't keep showing whatever the previous category left
          // behind (e.g. a parent rollup after leaving a leaf with specifics).
          // Only reached for a CONFIRMED parent (isUnknownFailure returned
          // above otherwise) — a transient failure never reaches this wipe.
          setItemSpecifics((prev) => {
            const next: ItemSpecifics = {};
            for (const [key, value] of Object.entries(prev)) {
              if (key.startsWith("_")) next[key] = value;
            }
            return next;
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
          allowedConditions,
        });

        const validAspectNames = new Set(aspects.map((a) => a.name));

        setItemSpecifics((prev) => {
          const next: ItemSpecifics = {};

          // Keep internal keys (_ prefixed) and any value belonging to the
          // NEW category's aspect schema; drop everything else — including a
          // non-empty value like "N/A" the AI seeded for the OLD category
          // (e.g. Author/Book Title surviving a switch to Rings). Value
          // content is irrelevant here: only membership in validAspectNames
          // decides whether a key belongs on this category's table at all.
          for (const [key, value] of Object.entries(prev)) {
            if (key.startsWith("_")) {
              next[key] = value;
              continue;
            }
            if (!validAspectNames.has(key)) continue;
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
