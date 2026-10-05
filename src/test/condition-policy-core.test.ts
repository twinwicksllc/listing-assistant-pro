import { describe, expect, test } from "vitest";
import {
  buildConditionPolicy,
  CONDITION_ID_TO_ENUM,
  resolvePolicyCondition,
  unavailableConditionPolicy,
  validateConditionSelection,
} from "../../supabase/functions/_helpers/conditionPolicy";
import {
  allowedConditionEnumsFromPolicy,
  buildConditionSelectionPayload,
  conditionIdFromCategoryPolicy,
  splitConditionDescriptorsFromItemSpecifics,
} from "@/lib/ebayConditionPolicy";

const policy = buildConditionPolicy("123", {
  categoryId: "123",
  itemConditionRequired: true,
  itemConditions: [
    { conditionId: 1500, conditionDescription: "Open box" },
    { conditionId: 2010, conditionDescription: "Excellent - Refurbished" },
    { conditionId: 2020, conditionDescription: "Very Good - Refurbished" },
    {
      conditionId: 2750,
      conditionDescription: "Graded",
      conditionDescriptors: [
        {
          conditionDescriptorId: "grade",
          conditionDescriptorName: "Grade",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            mode: "SELECTION_ONLY",
            cardinality: "SINGLE",
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "10",
              conditionDescriptorValueName: "10",
            },
          ],
        },
      ],
    },
  ],
});

function buildSyntheticPolicy(
  itemConditions: unknown[],
  options: {
    categoryId?: string;
    itemConditionRequired?: boolean;
    marketplaceId?: string;
    locale?: string;
    sellerScoped?: boolean;
  } = {},
) {
  const categoryId = options.categoryId ?? "123";
  return buildConditionPolicy(
    categoryId,
    {
      categoryId,
      itemConditionRequired: options.itemConditionRequired ?? true,
      itemConditions,
    },
    options,
  );
}

function conditionWithDescriptors(
  conditionDescriptors: unknown[],
  conditionId = "3000",
) {
  return {
    conditionId,
    conditionDescription: `Synthetic ${conditionId}`,
    conditionDescriptors,
  };
}

describe("shared condition policy", () => {
  test("preserves policy labels and correct transport mappings", () => {
    expect(resolvePolicyCondition(policy, "1500")?.conditionEnum).toBe(
      "NEW_OTHER",
    );
    expect(resolvePolicyCondition(policy, "2750")?.conditionDescription).toBe(
      "Graded",
    );
    expect(resolvePolicyCondition(policy, "2010")?.conditionEnum).toBe(
      "EXCELLENT_REFURBISHED",
    );
    expect(resolvePolicyCondition(policy, "2020")?.conditionEnum).toBe(
      "VERY_GOOD_REFURBISHED",
    );
  });
  test("rejects unsupported, stale and category-mismatched selections without substitution", () => {
    expect(
      validateConditionSelection(policy, "123", "USED_EXCELLENT").valid,
    ).toBe(false);
    expect(validateConditionSelection(policy, "999", "1500").valid).toBe(false);
    expect(
      validateConditionSelection(
        policy,
        "123",
        "1500",
        [],
        Date.now() + 48 * 3600000,
      ).valid,
    ).toBe(false);
  });
  test("enforces required descriptor values", () => {
    expect(validateConditionSelection(policy, "123", "2750").valid).toBe(false);
    expect(
      validateConditionSelection(policy, "123", "2750", [
        { name: "grade", values: ["bad"] },
      ]).valid,
    ).toBe(false);
    expect(
      validateConditionSelection(policy, "123", "2750", [
        { name: "grade", values: ["10"] },
      ]).valid,
    ).toBe(true);
  });

  test("allows an omitted condition when the category marks it optional, even with choices", () => {
    const optionalPolicy = buildSyntheticPolicy(
      [{ conditionId: 1000, conditionDescription: "New" }],
      { itemConditionRequired: false },
    );

    expect(validateConditionSelection(optionalPolicy, "123", "").valid).toBe(
      true,
    );
    expect(
      validateConditionSelection(optionalPolicy, "123", "", [
        { name: "grade", values: ["10"] },
      ]).valid,
    ).toBe(false);
  });
  test("rejects unrelated policies and conflicting duplicates", () => {
    expect(
      buildConditionPolicy("999", { categoryId: "123", itemConditions: [] })
        .status,
    ).toBe("unavailable");
    expect(
      buildConditionPolicy("123", {
        categoryId: "123",
        itemConditionRequired: true,
        itemConditions: [
          { conditionId: 3000, conditionDescription: "Used" },
          { conditionId: 3000, conditionDescription: "Something else" },
        ],
      }).status,
    ).toBe("unavailable");
  });
  test("keeps unknown IDs visible but prevents invented Inventory enums", () => {
    const unknown = buildConditionPolicy("123", {
      categoryId: "123",
      itemConditionRequired: true,
      itemConditions: [
        { conditionId: "9999", conditionDescription: "Future condition" },
      ],
    });
    expect(unknown.conditions[0].conditionEnum).toBeNull();
    expect(validateConditionSelection(unknown, "123", "9999").valid).toBe(
      false,
    );
  });

  test("maps refurbished condition IDs through the shared map and omits unknown IDs", () => {
    const conditions = [
      { conditionId: "2010", conditionDescription: "Excellent - Refurbished" },
      { conditionId: "2020", conditionDescription: "Very Good - Refurbished" },
      { conditionId: "2030", conditionDescription: "Good - Refurbished" },
      { conditionId: "9999", conditionDescription: "Future condition" },
    ];
    expect(allowedConditionEnumsFromPolicy(conditions)).toEqual([
      "EXCELLENT_REFURBISHED",
      "VERY_GOOD_REFURBISHED",
      "GOOD_REFURBISHED",
    ]);
  });

  test("condition ID resolution accepts exact ID, enum, and a unique exact label only", () => {
    const conditions = [
      { conditionId: "2010", conditionDescription: "Excellent - Refurbished" },
      { conditionId: "3000", conditionDescription: "Pre-owned - Good" },
    ];
    expect(conditionIdFromCategoryPolicy("2010", conditions)).toBe("2010");
    expect(
      conditionIdFromCategoryPolicy("EXCELLENT_REFURBISHED", conditions),
    ).toBe("2010");
    expect(
      conditionIdFromCategoryPolicy("Excellent - Refurbished", conditions),
    ).toBe("2010");
    expect(
      conditionIdFromCategoryPolicy("PRE_OWNED_EXCELLENT", conditions),
    ).toBeUndefined();
    expect(conditionIdFromCategoryPolicy("USED_EXCELLENT", conditions)).toBe(
      "3000",
    );
    expect(
      conditionIdFromCategoryPolicy("Unknown condition", conditions),
    ).toBeUndefined();
  });

  test("extracts descriptor selections from specifics without leaking them", () => {
    const descriptors = [{ name: "grade", values: ["10"] }];
    expect(
      splitConditionDescriptorsFromItemSpecifics({
        Brand: "Example",
        _domain: "coins_bullion",
        _conditionDescriptors: descriptors,
      }),
    ).toEqual({
      itemSpecifics: { Brand: "Example", _domain: "coins_bullion" },
      conditionDescriptors: descriptors,
    });
  });

  test("saved-draft payload preserves an exact condition ID without substitution", () => {
    const descriptors = [{ name: "grade", values: ["10"] }];
    expect(
      buildConditionSelectionPayload("2010", {
        Brand: "Example",
        _conditionDescriptors: descriptors,
      }),
    ).toEqual({
      condition: "2010",
      itemSpecifics: { Brand: "Example" },
      conditionDescriptors: descriptors,
    });
    expect(buildConditionSelectionPayload(undefined, {})).toEqual({
      condition: "",
      itemSpecifics: {},
    });
  });

  test("covers every supported condition ID transport mapping", () => {
    const conditions = Object.entries(CONDITION_ID_TO_ENUM).map(
      ([conditionId, conditionEnum]) => ({
        conditionId,
        conditionDescription: `Localized ${conditionId}`,
        expectedEnum: conditionEnum,
      }),
    );
    const mapped = buildSyntheticPolicy(
      conditions.map(
        ({ expectedEnum: _expectedEnum, ...condition }) => condition,
      ),
    );

    expect(mapped.status).toBe("available");
    expect(
      mapped.conditions.map(({ conditionId, conditionEnum }) => [
        conditionId,
        conditionEnum,
      ]),
    ).toEqual(
      conditions.map(({ conditionId, expectedEnum }) => [
        conditionId,
        expectedEnum,
      ]),
    );
    for (const { conditionId } of conditions) {
      expect(validateConditionSelection(mapped, "123", conditionId).valid).toBe(
        true,
      );
    }
  });

  test("keeps category and locale labels isolated while condition IDs remain category-scoped", () => {
    const us = buildSyntheticPolicy(
      [{ conditionId: "1000", conditionDescription: "New" }],
      {
        categoryId: "100",
        marketplaceId: "EBAY_US",
        locale: "en-US",
      },
    );
    const germany = buildSyntheticPolicy(
      [{ conditionId: "1000", conditionDescription: "Neu" }],
      {
        categoryId: "200",
        marketplaceId: "EBAY_DE",
        locale: "de-DE",
      },
    );

    expect(us.conditions[0]).toMatchObject({
      conditionId: "1000",
      conditionDescription: "New",
    });
    expect(germany.conditions[0]).toMatchObject({
      conditionId: "1000",
      conditionDescription: "Neu",
    });
    expect(us).toMatchObject({
      categoryId: "100",
      marketplaceId: "EBAY_US",
      locale: "en-US",
    });
    expect(germany).toMatchObject({
      categoryId: "200",
      marketplaceId: "EBAY_DE",
      locale: "de-DE",
    });
    expect(resolvePolicyCondition(us, "Neu")).toBeUndefined();
    expect(resolvePolicyCondition(germany, "New")).toBeUndefined();
    expect(validateConditionSelection(us, "200", "1000").valid).toBe(false);
    expect(validateConditionSelection(germany, "100", "1000").valid).toBe(
      false,
    );
  });

  test("deduplicates identical condition identity but refuses conflicting IDs and ambiguous labels", () => {
    const duplicateIdentity = buildSyntheticPolicy([
      { conditionId: "3000", conditionDescription: "Used" },
      { conditionId: "3000", conditionDescription: "Used" },
    ]);
    const conflictingIdentity = buildSyntheticPolicy([
      { conditionId: "3000", conditionDescription: "Used" },
      { conditionId: "3000", conditionDescription: "Used - Good" },
    ]);
    const ambiguousLabels = buildSyntheticPolicy([
      { conditionId: "2500", conditionDescription: "Refurbished" },
      { conditionId: "2000", conditionDescription: "Refurbished" },
    ]);

    expect(duplicateIdentity.status).toBe("available");
    expect(duplicateIdentity.conditions).toHaveLength(1);
    expect(conflictingIdentity.status).toBe("unavailable");
    expect(
      resolvePolicyCondition(ambiguousLabels, "Refurbished"),
    ).toBeUndefined();
    expect(resolvePolicyCondition(ambiguousLabels, "2000")?.conditionId).toBe(
      "2000",
    );
    expect(
      resolvePolicyCondition(ambiguousLabels, " refurbished "),
    ).toBeUndefined();
  });

  test("uses the exact localized condition label and requires the official label field", () => {
    const localized = buildSyntheticPolicy(
      [{ conditionId: "1500", conditionDescription: "Boîte ouverte" }],
      {
        marketplaceId: "EBAY_CA",
        locale: "fr-CA",
      },
    );
    const missingLabel = buildSyntheticPolicy([{ conditionId: "1500" }]);
    const blankLabel = buildSyntheticPolicy([
      { conditionId: "1500", conditionDescription: "  " },
    ]);

    expect(
      resolvePolicyCondition(localized, "Boîte ouverte")?.conditionId,
    ).toBe("1500");
    expect(resolvePolicyCondition(localized, "Open box")).toBeUndefined();
    expect(missingLabel.status).toBe("unavailable");
    expect(blankLabel.status).toBe("unavailable");
  });

  test("rejects malformed policy and descriptor schemas as unavailable instead of throwing", () => {
    const malformedPolicies: unknown[] = [
      null,
      {
        categoryId: "123",
        itemConditionRequired: true,
        itemConditions: [null],
      },
      { categoryId: "123", itemConditionRequired: "true", itemConditions: [] },
      { categoryId: "123", itemConditionRequired: true, itemConditions: {} },
      {
        categoryId: "123",
        itemConditionRequired: true,
        itemConditions: [{ conditionId: "3000" }],
      },
      {
        categoryId: "123",
        itemConditionRequired: true,
        itemConditions: [conditionWithDescriptors([null])],
      },
      {
        categoryId: "123",
        itemConditionRequired: true,
        itemConditions: [
          conditionWithDescriptors([
            {
              conditionDescriptorId: "grade",
              conditionDescriptorName: "Grade",
              conditionDescriptorValues: "not-an-array",
            },
          ]),
        ],
      },
    ];

    for (const raw of malformedPolicies) {
      expect(() => buildConditionPolicy("123", raw)).not.toThrow();
      expect(buildConditionPolicy("123", raw).status).toBe("unavailable");
    }
    expect(() =>
      validateConditionSelection({ fetchedAt: null } as never, "123", "3000"),
    ).not.toThrow();
    expect(
      validateConditionSelection({ fetchedAt: null } as never, "123", "3000")
        .valid,
    ).toBe(false);
    expect(
      validateConditionSelection(policy, "123", "1500", [null] as never).valid,
    ).toBe(false);
  });

  test("rejects malformed descriptor constraint enums, max lengths, values, and dependencies", () => {
    const validValue = {
      conditionDescriptorValueId: "A",
      conditionDescriptorValueName: "A",
    };
    const malformedCases: unknown[][] = [
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { usage: "OPTIONAL" },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { mode: "TEXT" },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { cardinality: "MANY" },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { maxLength: -1 },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { maxLength: 1.5 },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { maxLength: "12" },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: { maxLength: 12 },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorValues: [{ conditionDescriptorValueId: "A" }],
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorValues: [validValue, validValue],
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorConstraint: {
            applicableToConditionDescriptorIds: ["missing"],
          },
        },
      ],
      [
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorValues: [
            {
              ...validValue,
              conditionDescriptorValueConstraints: [
                {
                  applicableToConditionDescriptorId: "missing",
                  applicableToConditionDescriptorValueIds: ["X"],
                },
              ],
            },
          ],
        },
      ],
      [
        {
          conditionDescriptorId: "other",
          conditionDescriptorName: "Other",
          conditionDescriptorValues: [validValue],
        },
        {
          conditionDescriptorId: "d",
          conditionDescriptorName: "D",
          conditionDescriptorValues: [
            {
              ...validValue,
              conditionDescriptorValueConstraints: [
                {
                  applicableToConditionDescriptorId: "other",
                  applicableToConditionDescriptorValueIds: ["missing-value"],
                },
              ],
            },
          ],
        },
      ],
    ];

    for (const conditionDescriptors of malformedCases) {
      expect(
        buildSyntheticPolicy([conditionWithDescriptors(conditionDescriptors)])
          .status,
      ).toBe("unavailable");
    }
  });

  test("enforces required free text and its inclusive maximum length", () => {
    const textPolicy = buildSyntheticPolicy([
      conditionWithDescriptors([
        {
          conditionDescriptorId: "certification",
          conditionDescriptorName: "Certification number",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            mode: "FREE_TEXT",
            maxLength: 8,
          },
        },
      ]),
    ]);

    expect(validateConditionSelection(textPolicy, "123", "3000").valid).toBe(
      false,
    );
    expect(
      validateConditionSelection(textPolicy, "123", "3000", [
        { name: "certification", additionalInfo: "ABC12345" },
      ]).valid,
    ).toBe(true);
    expect(
      validateConditionSelection(textPolicy, "123", "3000", [
        { name: "certification", additionalInfo: "ABC123456" },
      ]).valid,
    ).toBe(false);
    expect(
      validateConditionSelection(textPolicy, "123", "3000", [
        { name: "certification", values: ["ABC12345"] },
      ]).valid,
    ).toBe(false);
  });

  test("enforces SINGLE and MULTI descriptor cardinality and unique supported values", () => {
    const cardinalityPolicy = buildSyntheticPolicy([
      conditionWithDescriptors([
        {
          conditionDescriptorId: "grade",
          conditionDescriptorName: "Grade",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            cardinality: "SINGLE",
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "10",
              conditionDescriptorValueName: "10",
            },
            {
              conditionDescriptorValueId: "9",
              conditionDescriptorValueName: "9",
            },
          ],
        },
        {
          conditionDescriptorId: "features",
          conditionDescriptorName: "Features",
          conditionDescriptorConstraint: {
            usage: "REQUIRED",
            cardinality: "MULTI",
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "signed",
              conditionDescriptorValueName: "Signed",
            },
            {
              conditionDescriptorValueId: "proof",
              conditionDescriptorValueName: "Proof",
            },
          ],
        },
      ]),
    ]);

    expect(
      validateConditionSelection(cardinalityPolicy, "123", "3000", [
        { name: "grade", values: ["10"] },
        { name: "features", values: ["signed", "proof"] },
      ]).valid,
    ).toBe(true);
    expect(
      validateConditionSelection(cardinalityPolicy, "123", "3000", [
        { name: "grade", values: ["10", "9"] },
        { name: "features", values: ["signed"] },
      ]).valid,
    ).toBe(false);
    expect(
      validateConditionSelection(cardinalityPolicy, "123", "3000", [
        { name: "grade", values: ["10"] },
        { name: "features", values: ["signed", "signed"] },
      ]).valid,
    ).toBe(false);
  });

  test("enforces descriptor and value dependencies independent of selection order", () => {
    const dependencyPolicy = buildSyntheticPolicy([
      conditionWithDescriptors([
        {
          conditionDescriptorId: "grade",
          conditionDescriptorName: "Grade",
          conditionDescriptorConstraint: { usage: "REQUIRED" },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "graded",
              conditionDescriptorValueName: "Graded",
              conditionDescriptorValueConstraints: [
                {
                  applicableToConditionDescriptorId: "grader",
                  applicableToConditionDescriptorValueIds: ["pcgs"],
                },
              ],
            },
          ],
        },
        {
          conditionDescriptorId: "grader",
          conditionDescriptorName: "Grader",
          conditionDescriptorConstraint: {
            applicableToConditionDescriptorIds: ["grade"],
          },
          conditionDescriptorValues: [
            {
              conditionDescriptorValueId: "pcgs",
              conditionDescriptorValueName: "PCGS",
            },
            {
              conditionDescriptorValueId: "ngc",
              conditionDescriptorValueName: "NGC",
            },
          ],
        },
      ]),
    ]);

    expect(
      validateConditionSelection(dependencyPolicy, "123", "3000", [
        { name: "grader", values: ["pcgs"] },
        { name: "grade", values: ["graded"] },
      ]).valid,
    ).toBe(true);
    expect(
      validateConditionSelection(dependencyPolicy, "123", "3000", [
        { name: "grade", values: ["graded"] },
        { name: "grader", values: ["ngc"] },
      ]).valid,
    ).toBe(false);
    expect(
      validateConditionSelection(dependencyPolicy, "123", "3000", [
        { name: "grade", values: ["graded"] },
      ]).valid,
    ).toBe(false);
  });

  test("treats restricted conditions as available only from the seller-scoped returned set", () => {
    const restricted = [
      {
        conditionId: "2010",
        conditionDescription: "Excellent - Refurbished",
        usage: "RESTRICTED",
      },
    ];
    const publicPolicy = buildSyntheticPolicy(restricted);
    const sellerPolicy = buildSyntheticPolicy(restricted, {
      sellerScoped: true,
    });
    const sellerPolicyWithoutReturnedId = buildSyntheticPolicy([], {
      sellerScoped: true,
    });

    expect(validateConditionSelection(publicPolicy, "123", "2010").valid).toBe(
      false,
    );
    expect(validateConditionSelection(sellerPolicy, "123", "2010").valid).toBe(
      true,
    );
    expect(
      validateConditionSelection(sellerPolicyWithoutReturnedId, "123", "2010")
        .valid,
    ).toBe(false);
  });

  test("distinguishes unavailable policy from a fresh optional category with no conditions", () => {
    const optionalEmpty = buildSyntheticPolicy([], {
      itemConditionRequired: false,
    });
    const unavailable = unavailableConditionPolicy(
      "123",
      "Metadata request failed",
    );
    const result = validateConditionSelection(optionalEmpty, "123", "");

    expect(optionalEmpty.status).toBe("available");
    expect(result.valid).toBe(true);
    expect(result.condition).toBeUndefined();
    expect(validateConditionSelection(unavailable, "123", "").valid).toBe(
      false,
    );
    expect(
      buildSyntheticPolicy([], { itemConditionRequired: true }).status,
    ).toBe("available");
    expect(
      validateConditionSelection(
        buildSyntheticPolicy([], { itemConditionRequired: true }),
        "123",
        "",
      ).valid,
    ).toBe(false);
  });

  test("applies freshness boundaries and safely rejects invalid or far-future timestamps", () => {
    const fresh = buildSyntheticPolicy([
      { conditionId: "3000", conditionDescription: "Used" },
    ]);
    const atAgeLimit = {
      ...fresh,
      fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    const stale = {
      ...fresh,
      fetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString(),
    };
    const invalidDate = { ...fresh, fetchedAt: "not-a-date" };
    const farFuture = {
      ...fresh,
      fetchedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(validateConditionSelection(atAgeLimit, "123", "3000").valid).toBe(
      true,
    );
    expect(validateConditionSelection(stale, "123", "3000").valid).toBe(false);
    expect(validateConditionSelection(invalidDate, "123", "3000").valid).toBe(
      false,
    );
    expect(validateConditionSelection(farFuture, "123", "3000").valid).toBe(
      false,
    );
  });
});
