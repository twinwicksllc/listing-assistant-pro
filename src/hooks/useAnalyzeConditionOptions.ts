import { useCallback, useEffect, useMemo } from "react";
import {
  resolvePolicyCondition,
  unavailableConditionPolicy,
  validateConditionSelection,
} from "../../supabase/functions/_helpers/conditionPolicy";
import type {
  ConditionDescriptorSelection,
  ConditionPolicy,
} from "../../supabase/functions/_helpers/conditionPolicy";

interface EbayMetadata {
  allowedConditions?: string[];
  conditionPolicy?: ConditionPolicy;
  isCoinCategory?: boolean;
}

interface UseAnalyzeConditionOptionsParams {
  ebayMetadata: EbayMetadata | null;
  ebayCategoryId: string;
  condition: string;
  descriptors?: ConditionDescriptorSelection[];
  loading?: boolean;
  setCondition: (value: string) => void;
  setDescriptors?: (descriptors: ConditionDescriptorSelection[]) => void;
}

interface ConditionOption {
  value: string;
  label: string;
}

/**
 * Condition choices and labels are category-specific policy data. Legacy AI
 * enums/descriptions are upgraded only when the shared resolver finds one
 * unambiguous policy match; unsupported values remain visible as invalid state.
 */
export function useAnalyzeConditionOptions({
  ebayMetadata,
  ebayCategoryId,
  condition,
  descriptors = [],
  loading = false,
  setCondition,
  setDescriptors,
}: UseAnalyzeConditionOptionsParams) {
  const policy = useMemo(
    () =>
      ebayMetadata?.conditionPolicy ??
      unavailableConditionPolicy(
        ebayCategoryId,
        "Condition policy is unavailable",
      ),
    [ebayCategoryId, ebayMetadata?.conditionPolicy],
  );

  const conditionOptions = useMemo<ConditionOption[]>(() => {
    if (policy.status !== "available" || policy.categoryId !== ebayCategoryId)
      return [];
    return policy.conditions.map((option) => ({
      value: option.conditionId,
      label: option.conditionDescription,
    }));
  }, [ebayCategoryId, policy]);

  const resolvedCondition = useMemo(
    () => resolvePolicyCondition(policy, condition),
    [condition, policy],
  );

  useEffect(() => {
    if (resolvedCondition && condition !== resolvedCondition.conditionId) {
      setCondition(resolvedCondition.conditionId);
    }
  }, [condition, resolvedCondition, setCondition]);

  const conditionValidation = useMemo(
    () =>
      validateConditionSelection(
        policy,
        ebayCategoryId,
        condition,
        descriptors,
      ),
    [condition, descriptors, ebayCategoryId, policy],
  );

  const updateCondition = useCallback(
    (value: string) => {
      if (value !== condition && value !== resolvedCondition?.conditionId) {
        setDescriptors?.([]);
      }
      setCondition(value);
    },
    [condition, resolvedCondition?.conditionId, setCondition, setDescriptors],
  );

  return {
    conditionOptions,
    updateCondition,
    conditionPolicy: policy,
    conditionValidation,
    isPolicyLoading: loading,
    isPolicyAvailable:
      !loading &&
      policy.status === "available" &&
      policy.categoryId === ebayCategoryId,
    resolvedCondition,
  };
}
