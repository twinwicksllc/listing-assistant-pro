import type {
  ConditionDescriptorSelection,
  ConditionPolicy,
  PolicyDescriptor,
} from "../../../supabase/functions/_helpers/conditionPolicy";

interface ConditionValidation {
  valid: boolean;
  errors: string[];
}

interface ConditionPolicyFieldsProps {
  policy: ConditionPolicy;
  categoryId: string;
  condition: string;
  descriptors: ConditionDescriptorSelection[];
  validation: ConditionValidation;
  loading: boolean;
  onConditionChange: (conditionId: string) => void;
  onDescriptorsChange: (descriptors: ConditionDescriptorSelection[]) => void;
}

export function ConditionPolicyFields({
  policy,
  categoryId,
  condition,
  descriptors,
  validation,
  loading,
  onConditionChange,
  onDescriptorsChange,
}: ConditionPolicyFieldsProps) {
  const policyMatches = policy.categoryId === categoryId;
  const available = !loading && policy.status === "available" && policyMatches;
  const selectedCondition = available
    ? policy.conditions.find((entry) => entry.conditionId === condition)
    : undefined;

  return (
    <section className="space-y-3" aria-label="eBay condition policy">
      {loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading condition requirements for this eBay category...
        </p>
      ) : !available ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          Condition requirements are unavailable for this category. Publishing
          is disabled until eBay's policy can be loaded.
        </p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Condition
            </span>
            <select
              aria-label="Condition"
              value={
                policy.conditions.some(
                  (entry) => entry.conditionId === condition,
                )
                  ? condition
                  : ""
              }
              onChange={(event) => onConditionChange(event.target.value)}
              disabled={policy.conditions.length === 0}
              required={policy.itemConditionRequired !== false}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            >
              <option value="">Select a condition</option>
              {policy.conditions.map((entry) => (
                <option key={entry.conditionId} value={entry.conditionId}>
                  {entry.conditionDescription}
                </option>
              ))}
            </select>
          </label>

          {!selectedCondition && condition && (
            <p
              role="alert"
              className="text-xs text-amber-700 dark:text-amber-300"
            >
              The saved condition is not supported by this category. Choose an
              available condition.
            </p>
          )}
          {!policy.conditions.length && (
            <p className="text-xs text-muted-foreground">
              No condition choices were returned for this category.
            </p>
          )}

          {selectedCondition?.conditionDescriptors.map((descriptor) => (
            <DescriptorField
              key={descriptor.conditionDescriptorId}
              descriptor={descriptor}
              allDescriptors={selectedCondition.conditionDescriptors}
              selections={descriptors}
              onChange={onDescriptorsChange}
            />
          ))}
        </>
      )}

      {validation.errors.length > 0 && !loading && (
        <ul
          className="space-y-1 text-xs text-destructive"
          aria-label="Condition validation errors"
        >
          {validation.errors.map((error, index) => (
            <li key={`${error}-${index}`}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface DescriptorFieldProps {
  descriptor: PolicyDescriptor;
  allDescriptors: PolicyDescriptor[];
  selections: ConditionDescriptorSelection[];
  onChange: (descriptors: ConditionDescriptorSelection[]) => void;
}

function DescriptorField({
  descriptor,
  allDescriptors,
  selections,
  onChange,
}: DescriptorFieldProps) {
  const descriptorId = descriptor.conditionDescriptorId;
  const constraint = descriptor.conditionDescriptorConstraint ?? {};
  const current = selections.find(
    (selection) => selection.name === descriptorId,
  );
  const selectedValues = current?.values ?? [];
  const byId = new Map(
    allDescriptors.map((entry) => [entry.conditionDescriptorId, entry]),
  );
  const requiredDependencies =
    constraint.applicableToConditionDescriptorIds ?? [];
  const valueDependencies = new Map<string, string[]>();
  for (const value of descriptor.conditionDescriptorValues ?? []) {
    for (const dependency of value.conditionDescriptorValueConstraints ?? []) {
      const dependencyId = dependency.applicableToConditionDescriptorId;
      if (!dependencyId) continue;
      const allowed = valueDependencies.get(dependencyId) ?? [];
      allowed.push(
        ...(dependency.applicableToConditionDescriptorValueIds ?? []),
      );
      valueDependencies.set(dependencyId, allowed);
    }
  }
  const missingDependencies = requiredDependencies.filter((id) => {
    const value = selections.find((selection) => selection.name === id);
    return !value?.values?.length && !value?.additionalInfo?.trim();
  });
  for (const [id, allowedValues] of valueDependencies) {
    const value = selections.find((selection) => selection.name === id);
    if (
      !value?.values?.some((selectedId) => allowedValues.includes(selectedId))
    ) {
      missingDependencies.push(id);
    }
  }
  const disabled = missingDependencies.length > 0;

  const updateSelection = (selection: ConditionDescriptorSelection | null) => {
    const next = selections.filter((entry) => entry.name !== descriptorId);
    if (selection) next.push(selection);
    onChange(next);
  };

  const allowedValues = (valueId: string) => {
    const value = descriptor.conditionDescriptorValues?.find(
      (entry) => entry.conditionDescriptorValueId === valueId,
    );
    return (value?.conditionDescriptorValueConstraints ?? []).every(
      (dependency) => {
        const selected = selections.find(
          (entry) =>
            entry.name === dependency.applicableToConditionDescriptorId,
        );
        return !!selected?.values?.some((selectedId) =>
          dependency.applicableToConditionDescriptorValueIds?.includes(
            selectedId,
          ),
        );
      },
    );
  };

  const dependencyNames = [...new Set(missingDependencies)]
    .filter(Boolean)
    .map((id) => byId.get(id)?.conditionDescriptorName ?? id);

  return (
    <div
      className="space-y-1"
      data-testid={`condition-descriptor-${descriptorId}`}
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {descriptor.conditionDescriptorName}
          {constraint.usage === "REQUIRED" && (
            <span className="text-destructive"> *</span>
          )}
        </span>
        {constraint.mode === "FREE_TEXT" ? (
          <input
            aria-label={descriptor.conditionDescriptorName}
            value={current?.additionalInfo ?? ""}
            maxLength={constraint.maxLength}
            disabled={disabled}
            onChange={(event) =>
              updateSelection({
                name: descriptorId,
                additionalInfo: event.target.value,
              })
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground disabled:opacity-60"
          />
        ) : constraint.cardinality === "MULTI" ? (
          <span className="block space-y-1">
            {(descriptor.conditionDescriptorValues ?? []).map((value) => {
              const checked = selectedValues.includes(
                value.conditionDescriptorValueId,
              );
              const enabled = allowedValues(value.conditionDescriptorValueId);
              return (
                <label
                  key={value.conditionDescriptorValueId}
                  className="flex items-center gap-2 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || (!enabled && !checked)}
                    onChange={(event) => {
                      const values = event.target.checked
                        ? [...selectedValues, value.conditionDescriptorValueId]
                        : selectedValues.filter(
                            (id) => id !== value.conditionDescriptorValueId,
                          );
                      updateSelection(
                        values.length ? { name: descriptorId, values } : null,
                      );
                    }}
                  />
                  {value.conditionDescriptorValueName}
                </label>
              );
            })}
          </span>
        ) : (
          <select
            aria-label={descriptor.conditionDescriptorName}
            value={selectedValues[0] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              updateSelection(
                event.target.value
                  ? { name: descriptorId, values: [event.target.value] }
                  : null,
              )
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground disabled:opacity-60"
          >
            <option value="">Select a value</option>
            {(descriptor.conditionDescriptorValues ?? []).map((value) => (
              <option
                key={value.conditionDescriptorValueId}
                value={value.conditionDescriptorValueId}
                disabled={!allowedValues(value.conditionDescriptorValueId)}
              >
                {value.conditionDescriptorValueName}
              </option>
            ))}
          </select>
        )}
      </label>
      {descriptor.conditionDescriptorHelpText && (
        <p className="text-[10px] text-muted-foreground">
          {descriptor.conditionDescriptorHelpText}
        </p>
      )}
      {constraint.maxLength !== undefined &&
        constraint.mode === "FREE_TEXT" && (
          <p className="text-[10px] text-muted-foreground">
            {(current?.additionalInfo ?? "").length}/{constraint.maxLength}
          </p>
        )}
      {disabled && (
        <p className="text-[10px] text-muted-foreground">
          Requires {dependencyNames.join(", ")} first.
        </p>
      )}
      {descriptor.conditionDescriptorValues?.some(
        (value) => value.conditionDescriptorValueHelpText,
      ) && (
        <div className="text-[10px] text-muted-foreground">
          {descriptor.conditionDescriptorValues.map(
            (value) =>
              value.conditionDescriptorValueHelpText && (
                <p key={value.conditionDescriptorValueId}>
                  {value.conditionDescriptorValueName}:{" "}
                  {value.conditionDescriptorValueHelpText}
                </p>
              ),
          )}
        </div>
      )}
    </div>
  );
}
