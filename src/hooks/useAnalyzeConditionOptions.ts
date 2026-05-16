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

export function useAnalyzeConditionOptions({
  ebayMetadata,
  ebayCategoryId,
  domain,
  setCondition,
}: UseAnalyzeConditionOptionsParams) {
  const conditionOptions = useMemo<ConditionOption[]>(() => {
    if (ebayMetadata?.allowedConditions && ebayMetadata.allowedConditions.length > 0) {
      return ebayMetadata.allowedConditions.map((c) => ({ value: c, label: getConditionLabel(c) }));
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
