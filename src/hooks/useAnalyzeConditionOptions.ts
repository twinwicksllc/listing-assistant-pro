import { useCallback, useMemo } from "react";
import { getEbayCategoryBreadcrumb } from "@/lib/ebayCategoryMap";
import {
  getConditionLabel,
  getConditionsForCategory,
  normalizeEbayConditionDescription,
} from "@/types/listing";

interface EbayMetadata {
  allowedConditions: string[];
  /** Authoritative flag from the backend — true when analyze-item determined
   *  this listing belongs to the coins_bullion domain. When set, the condition
   *  dropdown always uses the coin-appropriate tiers from getConditionsForCategory
   *  regardless of what eBay's conditions API returned. */
  isCoinCategory?: boolean;
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
 * Decides which condition options to show in the dropdown.
 *
 * Priority order:
 *  1. Backend isCoinCategory flag → always use coin-specific tiers
 *  2. allowedConditions is empty / all eBay non-enum strings → coin tiers
 *  3. allowedConditions has real eBay enum values → use them directly
 *
 * The backend now normalizes eBay's raw conditionDescription strings
 * (e.g. "New Factory Sealed", "Open Box Used", "Graded", "Ungraded") into
 * real ConditionEnum values before sending allowedConditions, so this hook
 * should receive either a clean list of enum values or an empty array.
 * Every value is still re-normalized here as a belt-and-suspenders safety
 * net -- a stale cached response, a future backend regression, or a value
 * that wasn't in the backend's alias table would otherwise reach the
 * dropdown's `value` (and later, eBay's publish call) unnormalized and
 * cause errorId 2004 "Could not serialize field [condition]".
 */
export function useAnalyzeConditionOptions({
  ebayMetadata,
  ebayCategoryId,
  domain,
  setCondition,
}: UseAnalyzeConditionOptionsParams) {
  const conditionOptions = useMemo<ConditionOption[]>(() => {
    // Backend-authoritative: coin domain always gets coin-specific tiers,
    // no need to inspect allowedConditions at all.
    if (ebayMetadata?.isCoinCategory) {
      return getConditionsForCategory(
        ebayCategoryId || undefined,
        domain,
        getEbayCategoryBreadcrumb(ebayCategoryId) || undefined,
      );
    }

    const allowed = ebayMetadata?.allowedConditions;
    const hasAllowed = Array.isArray(allowed) && allowed.length > 0;

    // Safety net: if allowedConditions somehow still contains eBay's non-enum
    // coin labels (any case), fall through to coin-specific tiers.
    const isOnlyCoinLabels =
      hasAllowed && allowed!.every((c) => /^(ungraded|graded)$/i.test(c));

    if (hasAllowed && !isOnlyCoinLabels) {
      return allowed!.map((c) => {
        // Re-normalize defensively: if `c` is already a valid ConditionEnum
        // (the expected case) this is a no-op passthrough (unknown aliases
        // fall through to an uppercase-snake-case mangle of the same
        // string). If `c` is somehow still a raw eBay conditionDescription
        // string, this maps it to the real enum instead of shipping the
        // raw description as the option's value.
        const normalized = normalizeEbayConditionDescription(c) || c;
        return {
          value: normalized,
          label: getConditionLabel(normalized, domain),
        };
      });
    }

    return getConditionsForCategory(
      ebayCategoryId || undefined,
      domain,
      getEbayCategoryBreadcrumb(ebayCategoryId) || undefined,
    );
  }, [
    domain,
    ebayCategoryId,
    ebayMetadata?.allowedConditions,
    ebayMetadata?.isCoinCategory,
  ]);

  const updateCondition = useCallback(
    (value: string) => {
      setCondition(value);
    },
    [setCondition],
  );

  return {
    conditionOptions,
    updateCondition,
  };
}
