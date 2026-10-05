export const CONDITION_POLICY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Source of truth: eBay's "Item condition ID and name values" page
// (developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html),
// which maps each Metadata API conditionId to exactly one Inventory API
// ConditionEnum. eBay states numeric IDs are used consistently across all
// marketplaces and categories, and that only display names and the supported
// subset vary by category, so the enum is derived from the ID alone. Do not
// match on conditionDescription: eBay documents no label-based lookup, and
// labels differ by category and locale.
export const CONDITION_ID_TO_ENUM: Readonly<Record<string, string>> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2000": "CERTIFIED_REFURBISHED",
  "2010": "EXCELLENT_REFURBISHED",
  "2020": "VERY_GOOD_REFURBISHED",
  "2030": "GOOD_REFURBISHED",
  "2500": "SELLER_REFURBISHED",
  "2750": "LIKE_NEW",
  "2990": "PRE_OWNED_EXCELLENT",
  "3000": "USED_EXCELLENT",
  "3010": "PRE_OWNED_FAIR",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

// Every string this module can hand to the Inventory API. Exported so a test
// can assert the engine never emits a value outside eBay's ConditionEnum list.
export const SUPPORTED_CONDITION_ENUMS: ReadonlySet<string> = new Set(
  Object.values(CONDITION_ID_TO_ENUM),
);

// IDs outside eBay's documented table return null, so publishing fails closed
// ("no supported Inventory API mapping") instead of sending an invented value.
// The description is accepted for call-site compatibility and ignored.
export function conditionEnumFromPolicyCondition(
  conditionId: string,
  _description?: string,
): string | null {
  return CONDITION_ID_TO_ENUM[conditionId] ?? null;
}

export interface DescriptorValueConstraint {
  applicableToConditionDescriptorId?: string;
  applicableToConditionDescriptorValueIds?: string[];
}

export interface PolicyDescriptorValue {
  conditionDescriptorValueId: string;
  conditionDescriptorValueName: string;
  conditionDescriptorValueHelpText?: string;
  conditionDescriptorValueConstraints?: DescriptorValueConstraint[];
}

export interface PolicyDescriptor {
  conditionDescriptorId: string;
  conditionDescriptorName: string;
  conditionDescriptorHelpText?: string;
  conditionDescriptorConstraint?: {
    applicableToConditionDescriptorIds?: string[];
    cardinality?: "SINGLE" | "MULTI";
    defaultConditionDescriptorValueId?: string;
    maxLength?: number;
    mode?: "SELECTION_ONLY" | "FREE_TEXT";
    usage?: "REQUIRED";
  };
  conditionDescriptorValues?: PolicyDescriptorValue[];
}

export interface PolicyCondition {
  conditionId: string;
  conditionEnum: string | null;
  conditionDescription: string;
  conditionHelpText?: string;
  usage?: string;
  conditionDescriptors: PolicyDescriptor[];
}

export interface ConditionPolicy {
  status: "available" | "unavailable";
  categoryId: string;
  marketplaceId: string;
  locale: string;
  fetchedAt: string;
  sellerScoped: boolean;
  itemConditionRequired?: boolean;
  conditions: PolicyCondition[];
  reason?: string;
}

export interface ConditionDescriptorSelection {
  name: string;
  values?: string[];
  additionalInfo?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function normalizeDescriptorValue(value: unknown): PolicyDescriptorValue | undefined {
  if (
    !isRecord(value) || !isNonEmptyString(value.conditionDescriptorValueId) ||
    !isNonEmptyString(value.conditionDescriptorValueName) ||
    !isOptionalString(value.conditionDescriptorValueHelpText)
  ) return undefined;

  let constraints: DescriptorValueConstraint[] | undefined;
  if (value.conditionDescriptorValueConstraints !== undefined) {
    if (!Array.isArray(value.conditionDescriptorValueConstraints)) return undefined;
    constraints = [];
    for (const rawConstraint of value.conditionDescriptorValueConstraints) {
      if (
        !isRecord(rawConstraint) ||
        !isOptionalString(rawConstraint.applicableToConditionDescriptorId) ||
        (rawConstraint.applicableToConditionDescriptorId !== undefined &&
          !isNonEmptyString(rawConstraint.applicableToConditionDescriptorId)) ||
        (rawConstraint.applicableToConditionDescriptorValueIds !== undefined &&
          !isStringArray(rawConstraint.applicableToConditionDescriptorValueIds)) ||
        (rawConstraint.applicableToConditionDescriptorValueIds !== undefined &&
          rawConstraint.applicableToConditionDescriptorId === undefined)
      ) return undefined;
      constraints.push({
        applicableToConditionDescriptorId: rawConstraint.applicableToConditionDescriptorId as string | undefined,
        applicableToConditionDescriptorValueIds: rawConstraint.applicableToConditionDescriptorValueIds as
          | string[]
          | undefined,
      });
    }
  }

  return {
    conditionDescriptorValueId: value.conditionDescriptorValueId,
    conditionDescriptorValueName: value.conditionDescriptorValueName,
    conditionDescriptorValueHelpText: value.conditionDescriptorValueHelpText,
    conditionDescriptorValueConstraints: constraints,
  };
}

function normalizeDescriptor(value: unknown): PolicyDescriptor | undefined {
  if (
    !isRecord(value) || !isNonEmptyString(value.conditionDescriptorId) ||
    !isNonEmptyString(value.conditionDescriptorName) ||
    !isOptionalString(value.conditionDescriptorHelpText)
  ) return undefined;

  let constraint: PolicyDescriptor["conditionDescriptorConstraint"];
  if (value.conditionDescriptorConstraint !== undefined) {
    const rawConstraint = value.conditionDescriptorConstraint;
    if (!isRecord(rawConstraint)) return undefined;
    const cardinality = rawConstraint.cardinality;
    const mode = rawConstraint.mode;
    const usage = rawConstraint.usage;
    const maximumLength = rawConstraint.maxLength;
    if (
      (cardinality !== undefined && cardinality !== "SINGLE" && cardinality !== "MULTI") ||
      (mode !== undefined && mode !== "SELECTION_ONLY" && mode !== "FREE_TEXT") ||
      (usage !== undefined && usage !== "REQUIRED") ||
      (maximumLength !== undefined &&
        (typeof maximumLength !== "number" || !Number.isInteger(maximumLength) || maximumLength < 0 ||
          mode !== "FREE_TEXT")) ||
      !isOptionalString(rawConstraint.defaultConditionDescriptorValueId) ||
      (rawConstraint.defaultConditionDescriptorValueId !== undefined &&
        !isNonEmptyString(rawConstraint.defaultConditionDescriptorValueId)) ||
      (rawConstraint.applicableToConditionDescriptorIds !== undefined &&
        !isStringArray(rawConstraint.applicableToConditionDescriptorIds))
    ) return undefined;
    constraint = {
      applicableToConditionDescriptorIds: rawConstraint.applicableToConditionDescriptorIds as string[] | undefined,
      cardinality: cardinality as "SINGLE" | "MULTI" | undefined,
      defaultConditionDescriptorValueId: rawConstraint.defaultConditionDescriptorValueId as string | undefined,
      maxLength: maximumLength as number | undefined,
      mode: mode as "SELECTION_ONLY" | "FREE_TEXT" | undefined,
      usage: usage as "REQUIRED" | undefined,
    };
  }

  let values: NonNullable<PolicyDescriptor["conditionDescriptorValues"]> | undefined;
  if (value.conditionDescriptorValues !== undefined) {
    if (!Array.isArray(value.conditionDescriptorValues)) return undefined;
    values = [];
    for (const rawValue of value.conditionDescriptorValues) {
      const normalized = normalizeDescriptorValue(rawValue);
      if (!normalized) return undefined;
      values.push(normalized);
    }
    if (new Set(values.map((entry) => entry.conditionDescriptorValueId)).size !== values.length) return undefined;
  }

  if (
    constraint?.defaultConditionDescriptorValueId !== undefined &&
    !values?.some((entry) => entry.conditionDescriptorValueId === constraint?.defaultConditionDescriptorValueId)
  ) {
    return undefined;
  }

  return {
    conditionDescriptorId: value.conditionDescriptorId,
    conditionDescriptorName: value.conditionDescriptorName,
    conditionDescriptorHelpText: value.conditionDescriptorHelpText,
    conditionDescriptorConstraint: constraint,
    conditionDescriptorValues: values,
  };
}

function normalizeCondition(raw: unknown): PolicyCondition | undefined {
  if (!isRecord(raw)) return undefined;
  const conditionId = typeof raw.conditionId === "number" && Number.isInteger(raw.conditionId) && raw.conditionId >= 0
    ? String(raw.conditionId)
    : raw.conditionId;
  if (
    typeof conditionId !== "string" || !/^\d+$/.test(conditionId) ||
    typeof raw.conditionDescription !== "string" || !raw.conditionDescription.trim() ||
    !isOptionalString(raw.conditionHelpText) || !isOptionalString(raw.usage) ||
    (raw.usage !== undefined && raw.usage !== "RESTRICTED") ||
    (raw.conditionDescriptors !== undefined && !Array.isArray(raw.conditionDescriptors))
  ) return undefined;

  const descriptors: PolicyDescriptor[] = [];
  for (const rawDescriptor of raw.conditionDescriptors ?? []) {
    const descriptor = normalizeDescriptor(rawDescriptor);
    if (!descriptor) return undefined;
    descriptors.push(descriptor);
  }
  if (new Set(descriptors.map((descriptor) => descriptor.conditionDescriptorId)).size !== descriptors.length) {
    return undefined;
  }

  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.conditionDescriptorId, descriptor]));
  for (const descriptor of descriptors) {
    const constraint = descriptor.conditionDescriptorConstraint;
    if (constraint?.applicableToConditionDescriptorIds?.some((id) => !descriptorById.has(id))) return undefined;
    for (const value of descriptor.conditionDescriptorValues ?? []) {
      for (const dependency of value.conditionDescriptorValueConstraints ?? []) {
        const associated = descriptorById.get(dependency.applicableToConditionDescriptorId ?? "");
        if (!associated) return undefined;
        if (
          dependency.applicableToConditionDescriptorValueIds?.some((id) =>
            !associated.conditionDescriptorValues?.some((entry) => entry.conditionDescriptorValueId === id)
          )
        ) return undefined;
      }
    }
  }

  return {
    conditionId,
    conditionEnum: conditionEnumFromPolicyCondition(
      conditionId,
      raw.conditionDescription,
    ),
    conditionDescription: raw.conditionDescription.trim(),
    conditionHelpText: raw.conditionHelpText,
    usage: raw.usage,
    conditionDescriptors: descriptors,
  };
}

export function unavailableConditionPolicy(
  categoryId: string,
  reason: string,
  marketplaceId = "EBAY_US",
  locale = "en-US",
): ConditionPolicy {
  return {
    status: "unavailable",
    categoryId,
    marketplaceId,
    locale,
    fetchedAt: new Date().toISOString(),
    sellerScoped: false,
    conditions: [],
    reason,
  };
}

export function buildConditionPolicy(
  categoryId: string,
  raw: unknown,
  context: { marketplaceId?: string; locale?: string; sellerScoped?: boolean } = {},
): ConditionPolicy {
  const marketplaceId = context.marketplaceId ?? "EBAY_US";
  const locale = context.locale ?? "en-US";
  if (
    !isRecord(raw) || raw.categoryId !== categoryId || typeof raw.itemConditionRequired !== "boolean" ||
    !Array.isArray(raw.itemConditions)
  ) {
    return unavailableConditionPolicy(categoryId, "No matching category condition policy", marketplaceId, locale);
  }
  const conditions = new Map<string, PolicyCondition>();
  for (const rawCondition of raw.itemConditions) {
    const option = normalizeCondition(rawCondition);
    if (!option) {
      return unavailableConditionPolicy(categoryId, "Malformed condition policy", marketplaceId, locale);
    }
    const existing = conditions.get(option.conditionId);
    if (existing) {
      const metadataMatches = existing.conditionEnum === option.conditionEnum &&
        existing.conditionHelpText === option.conditionHelpText &&
        existing.usage === option.usage &&
        JSON.stringify(existing.conditionDescriptors) ===
          JSON.stringify(option.conditionDescriptors);
      if (!metadataMatches) {
        return unavailableConditionPolicy(categoryId, "Conflicting duplicate condition IDs", marketplaceId, locale);
      }
      continue;
    }
    conditions.set(option.conditionId, option);
  }
  return {
    status: "available",
    categoryId,
    marketplaceId,
    locale,
    fetchedAt: new Date().toISOString(),
    sellerScoped: context.sellerScoped ?? false,
    itemConditionRequired: raw.itemConditionRequired,
    conditions: [...conditions.values()],
  };
}

export function resolvePolicyCondition(policy: ConditionPolicy, selection: string): PolicyCondition | undefined {
  if (
    !isRecord(policy) || policy.status !== "available" || !selection || !Array.isArray(policy.conditions) ||
    !policy.conditions.every((condition) =>
      isRecord(condition) && typeof condition.conditionId === "string" &&
      typeof condition.conditionDescription === "string" && Array.isArray(condition.conditionDescriptors)
    )
  ) return undefined;
  const exactId = policy.conditions.find((option) => option.conditionId === selection);
  if (exactId) return exactId;
  const matches = policy.conditions.filter((option) =>
    option.conditionEnum === selection || option.conditionDescription === selection
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function validateConditionSelection(
  policy: ConditionPolicy,
  categoryId: string,
  selection: string,
  descriptors: ConditionDescriptorSelection[] = [],
  now = Date.now(),
): { valid: boolean; errors: string[]; condition?: PolicyCondition } {
  const errors: string[] = [];
  if (
    !isRecord(policy) || (policy.status !== "available" && policy.status !== "unavailable") ||
    typeof policy.categoryId !== "string" || typeof policy.fetchedAt !== "string" ||
    !Array.isArray(policy.conditions) || !Array.isArray(descriptors)
  ) {
    return { valid: false, errors: ["Condition policy or descriptor selection is malformed"] };
  }
  const age = now - Date.parse(policy.fetchedAt);
  if (policy.status !== "available") errors.push("Condition policy is unavailable");
  if (policy.categoryId !== categoryId) errors.push("Condition policy belongs to a different category");
  if (!Number.isFinite(age) || age < -60000 || age > CONDITION_POLICY_MAX_AGE_MS) {
    errors.push("Condition policy is stale");
  }
  if (!selection && policy.itemConditionRequired === false && !descriptors.length) {
    return { valid: errors.length === 0, errors };
  }
  const condition = resolvePolicyCondition(policy, selection);
  if (!condition) errors.push("Select a condition supported by this category");
  if (condition && !condition.conditionEnum) errors.push("This condition has no supported Inventory API mapping");
  if (condition?.usage === "RESTRICTED" && !policy.sellerScoped) errors.push("Seller eligibility must be verified");
  const selections = new Map<string, ConditionDescriptorSelection>();
  for (const rawDescriptor of descriptors as unknown[]) {
    if (
      !isRecord(rawDescriptor) || !isNonEmptyString(rawDescriptor.name) ||
      (rawDescriptor.values !== undefined && !isStringArray(rawDescriptor.values)) ||
      !isOptionalString(rawDescriptor.additionalInfo)
    ) {
      errors.push("Malformed condition descriptor selection");
      continue;
    }
    const descriptor = rawDescriptor as unknown as ConditionDescriptorSelection;
    if (selections.has(descriptor.name)) errors.push("Duplicate condition descriptor");
    selections.set(descriptor.name, descriptor);
    if (!condition?.conditionDescriptors.some((entry) => entry.conditionDescriptorId === descriptor.name)) {
      errors.push("Unsupported condition descriptor");
    }
  }
  for (const descriptor of condition?.conditionDescriptors ?? []) {
    const selected = selections.get(descriptor.conditionDescriptorId);
    const constraint = descriptor.conditionDescriptorConstraint ?? {};
    const values = selected?.values ?? [];
    const text = selected?.additionalInfo?.trim() ?? "";
    const supplied = values.length > 0 || text.length > 0;
    if (constraint.usage === "REQUIRED" && !supplied) errors.push(`${descriptor.conditionDescriptorName} is required`);
    if (!supplied) continue;
    if (constraint.mode === "FREE_TEXT") {
      if (values.length || !text) errors.push(`${descriptor.conditionDescriptorName} requires text`);
      if (constraint.maxLength !== undefined && text.length > constraint.maxLength) {
        errors.push(`${descriptor.conditionDescriptorName} exceeds its maximum length`);
      }
    } else {
      if (text || !values.length) errors.push(`${descriptor.conditionDescriptorName} requires a listed value`);
      if (constraint.cardinality === "SINGLE" && values.length > 1) {
        errors.push(`${descriptor.conditionDescriptorName} accepts one value`);
      }
      if (new Set(values).size !== values.length) errors.push("Duplicate descriptor values");
      for (const valueId of values) {
        const value = descriptor.conditionDescriptorValues?.find((entry) =>
          entry.conditionDescriptorValueId === valueId
        );
        if (!value) errors.push(`${descriptor.conditionDescriptorName} has an unsupported value`);
        for (const dependency of value?.conditionDescriptorValueConstraints ?? []) {
          const associated = selections.get(dependency.applicableToConditionDescriptorId ?? "");
          if (
            !associated || (dependency.applicableToConditionDescriptorValueIds !== undefined &&
              !associated.values?.some((entry) => dependency.applicableToConditionDescriptorValueIds?.includes(entry)))
          ) {
            errors.push(`${descriptor.conditionDescriptorName} has an incompatible dependent value`);
          }
        }
      }
    }
    for (const associatedId of constraint.applicableToConditionDescriptorIds ?? []) {
      const associated = selections.get(associatedId);
      if (!associated?.values?.length && !associated?.additionalInfo?.trim()) {
        errors.push("Missing dependent condition descriptor");
      }
    }
  }
  return { valid: errors.length === 0, errors, condition };
}
