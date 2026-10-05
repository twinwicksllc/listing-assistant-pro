import {
  CONDITION_ID_TO_ENUM,
  resolvePolicyCondition,
  type ConditionDescriptorSelection,
  type ConditionPolicy,
  type PolicyCondition,
} from "../../supabase/functions/_helpers/conditionPolicy";

type CategoryPolicyCondition = Pick<
  PolicyCondition,
  "conditionId" | "conditionDescription"
> & { conditionEnum?: string | null };

export function allowedConditionEnumsFromPolicy(
  conditions: CategoryPolicyCondition[],
): string[] {
  const enums = conditions.flatMap((condition) => {
    const description = condition.conditionDescription?.trim() ?? "";
    if (/^(graded|ungraded)$/i.test(description)) return [];

    const normalized = CONDITION_ID_TO_ENUM[String(condition.conditionId)];
    return normalized ? [normalized] : [];
  });

  return [...new Set(enums)];
}

export function conditionIdFromCategoryPolicy(
  condition: string,
  policyOrConditions: ConditionPolicy | CategoryPolicyCondition[],
): string | undefined {
  if ("status" in policyOrConditions) {
    const match = resolvePolicyCondition(policyOrConditions, condition);
    return match?.conditionId;
  }

  const selection = condition.trim();
  const conditions = policyOrConditions;
  if (/^\d+$/.test(selection)) {
    const exactIds = conditions.filter(
      (candidate) => candidate.conditionId === selection,
    );
    return exactIds.length === 1 ? exactIds[0].conditionId : undefined;
  }

  const labelKey = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, " ");
  const labelMatches = conditions.filter(
    (candidate) =>
      labelKey(candidate.conditionDescription) === labelKey(selection),
  );
  const labelIds = [
    ...new Set(labelMatches.map((candidate) => candidate.conditionId)),
  ];
  if (labelIds.length === 1) return labelIds[0];

  const knownEnums = new Set(Object.values(CONDITION_ID_TO_ENUM));
  if (!knownEnums.has(selection)) return undefined;
  const enumMatches = conditions.filter(
    (candidate) => CONDITION_ID_TO_ENUM[candidate.conditionId] === selection,
  );
  const enumIds = [
    ...new Set(enumMatches.map((candidate) => candidate.conditionId)),
  ];
  return enumIds.length === 1 ? enumIds[0] : undefined;
}

export function splitConditionDescriptorsFromItemSpecifics(
  itemSpecifics: unknown,
): {
  itemSpecifics: Record<string, unknown>;
  conditionDescriptors?: ConditionDescriptorSelection[];
} {
  const source =
    itemSpecifics && typeof itemSpecifics === "object"
      ? (itemSpecifics as Record<string, unknown>)
      : {};
  const { _conditionDescriptors, ...remainingSpecifics } = source;
  return {
    itemSpecifics: remainingSpecifics,
    ...(Array.isArray(_conditionDescriptors)
      ? {
          conditionDescriptors:
            _conditionDescriptors as ConditionDescriptorSelection[],
        }
      : {}),
  };
}

export function buildConditionSelectionPayload(
  condition: string | null | undefined,
  itemSpecifics: unknown,
) {
  return {
    condition: condition ?? "",
    ...splitConditionDescriptorsFromItemSpecifics(itemSpecifics),
  };
}
