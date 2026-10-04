import { normalizeEbayConditionDescription } from "@/types/listing";

export function conditionIdFromCategoryPolicy(
  condition: string,
  conditions: Array<{
    conditionId?: number | string;
    conditionDescription?: string;
  }>,
): string | undefined {
  const conditionEnum = normalizeEbayConditionDescription(condition);
  const match = conditions.find(
    (candidate) =>
      normalizeEbayConditionDescription(candidate.conditionDescription) ===
      conditionEnum,
  );
  if (match?.conditionId) return String(match.conditionId);

  if (
    conditionEnum === "PRE_OWNED_EXCELLENT" ||
    conditionEnum === "PRE_OWNED_FAIR"
  ) {
    const fallback =
      conditions.find(
        (candidate) =>
          normalizeEbayConditionDescription(candidate.conditionDescription) ===
          "USED_EXCELLENT",
      ) ?? conditions[0];
    return fallback?.conditionId ? String(fallback.conditionId) : undefined;
  }

  return undefined;
}
