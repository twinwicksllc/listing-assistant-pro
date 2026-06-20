import { useCallback, useMemo } from "react";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import { getConditionLabel, getConditionsForCategory } from "@/types/listing";

interface EbayMetadata {
  allowedConditions: string[];
}

interface UseAnalyzeConditionOptionsParams {
  ebayMetadata: EbayMetadata | null;
  ebayCategoryId: string;
  domain: string;
  setCondition: (value: string) => void;
}

interface ConditionOption {
  value: string;
  label: string;
}

/**
 * AI analysis may return coin-internal labels ("UNGRADED", "GRADED") in
 * allowedConditions. These are not valid eBay Inventory API condition enums
 * and, if used directly, produce a dropdown locked to a single option while
 * also preventing the Coin Condition Details panel from collecting the
 * rawCondition tier required by eBay's June 2026 mandate.
 * When allowedConditions contains only these labels we fall through to
 * getConditionsForCategory so the user sees the full coin-appropriate
 * condition list (NEW, USED_VERY_GOOD, etc.).
 */
const COIN_INTERNAL_LABELS = new Set(["UNGRADED", "GRADED", "ungraded", "graded"]);

export function useAnalyzeConditionOptions({
  ebayMetadata,
  ebayCategoryId,
  domain,
  setCondition,
}: UseAnalyzeConditionOptionsParams) {
  const conditionOptions = useMemo<ConditionOption[]>(() => {
    const allowed = ebayMetadata?.allowedConditions;
    const hasAllowed = Array.isArray(allowed) && allowed.length > 0;

    // If allowedConditions only contains coin-internal labels ("UNGRADED" /
    // "GRADED"), those are not valid eBay API enums — fall through so
    // getConditionsForCategory returns the proper coin tier options instead.
    const isOnlyCoinLabels =
      hasAllowed && allowed!.every((c) => COIN_INTERNAL_LABELS.has(c));

    if (hasAllowed && !isOnlyCoinLabels) {
      return allowed!.map((c) => ({ value: c, label: getConditionLabel(c) }));
    }

    return getConditionsForCategory(
      ebayCategoryId || undefined,
      domain,
      getEbayCategoryBreadcrumb(ebayCategoryId) || undefined,
    );
  }, [domain, ebayCategoryId, ebayMetadata?.allowedConditions]);

  const updateCondition = useCallback((value: string) => {
    setCondition(value);
  }, [setCondition]);

  return {
    conditionOptions,
    updateCondition,
  };
}
