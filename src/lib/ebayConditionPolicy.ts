import { normalizeEbayConditionDescription } from "@/types/listing";

const CONDITION_ID_TO_ENUM: Record<number, string> = {
  1000: "NEW",
  1500: "NEW_OTHER",
  1750: "NEW_WITH_DEFECTS",
  2000: "CERTIFIED_REFURBISHED",
  2010: "CERTIFIED_REFURBISHED",
  2020: "CERTIFIED_REFURBISHED",
  2030: "CERTIFIED_REFURBISHED",
  2500: "SELLER_REFURBISHED",
  2750: "LIKE_NEW",
  2990: "PRE_OWNED_EXCELLENT",
  3000: "USED_EXCELLENT",
  3010: "PRE_OWNED_FAIR",
  4000: "USED_VERY_GOOD",
  5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE",
  7000: "FOR_PARTS_OR_NOT_WORKING",
};

export function allowedConditionEnumsFromPolicy(
  conditions: Array<{
    conditionId?: number | string;
    conditionDescription?: string;
  }>,
): string[] {
  const enums = conditions.flatMap((condition) => {
    const description = condition.conditionDescription?.trim() ?? "";
    if (/^(graded|ungraded)$/i.test(description)) return [];

    const conditionId = Number(condition.conditionId);
    const normalized =
      CONDITION_ID_TO_ENUM[conditionId] ??
      normalizeEbayConditionDescription(description);
    return normalized && !/^(graded|ungraded)$/i.test(normalized)
      ? [normalized]
      : [];
  });

  return [...new Set(enums)];
}

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
