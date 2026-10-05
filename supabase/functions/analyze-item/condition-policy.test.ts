import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildConditionPolicy, type ConditionPolicy } from "../_helpers/conditionPolicy.ts";
import { getPolicyConditionEnums, resolveConditionRecommendation } from "./index.ts";

const sellerPolicy = buildConditionPolicy(
  "123",
  {
    categoryId: "123",
    itemConditionRequired: true,
    itemConditions: [
      { conditionId: 1500, conditionDescription: "Open box" },
      { conditionId: 2010, conditionDescription: "Excellent - Refurbished" },
      { conditionId: 2020, conditionDescription: "Very Good - Refurbished" },
      { conditionId: 2030, conditionDescription: "Good - Refurbished" },
    ],
  },
  { sellerScoped: true },
);

Deno.test("condition policy exposes exact policy enums and labels", () => {
  assertEquals(getPolicyConditionEnums(sellerPolicy), [
    "NEW_OTHER",
    "EXCELLENT_REFURBISHED",
    "VERY_GOOD_REFURBISHED",
    "GOOD_REFURBISHED",
  ]);
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: sellerPolicy },
      "123",
      "Open box",
    ),
    { condition: "NEW_OTHER", conditionNeedsConfirmation: false },
  );
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: sellerPolicy },
      "123",
      "2010",
    ).condition,
    "EXCELLENT_REFURBISHED",
  );
});

Deno.test("condition recommendation requires a unique match for the final category", () => {
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: sellerPolicy },
      "456",
      "EXCELLENT_REFURBISHED",
    ),
    { condition: "", conditionNeedsConfirmation: true },
  );
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: sellerPolicy },
      "123",
      "USED_EXCELLENT",
    ),
    { condition: "", conditionNeedsConfirmation: true },
  );

  const ambiguousPolicy: ConditionPolicy = {
    ...sellerPolicy,
    conditions: [
      { ...sellerPolicy.conditions[0], conditionId: "1000", conditionEnum: "NEW" },
      { ...sellerPolicy.conditions[0], conditionId: "1500", conditionEnum: "NEW" },
    ],
  };
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: ambiguousPolicy },
      "123",
      "NEW",
    ),
    { condition: "", conditionNeedsConfirmation: true },
  );
});

Deno.test("restricted policy alternatives require seller-scoped metadata", () => {
  const unscopedPolicy: ConditionPolicy = {
    ...sellerPolicy,
    sellerScoped: false,
    conditions: [
      { ...sellerPolicy.conditions[1], usage: "RESTRICTED" },
    ],
  };
  assertEquals(getPolicyConditionEnums(unscopedPolicy), []);
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: unscopedPolicy },
      "123",
      "EXCELLENT_REFURBISHED",
    ),
    { condition: "", conditionNeedsConfirmation: true },
  );
});

Deno.test("uncertain AI recommendations require a deliberate seller selection", () => {
  assertEquals(
    resolveConditionRecommendation(
      { conditionPolicy: sellerPolicy },
      "123",
      "EXCELLENT_REFURBISHED",
      true,
    ),
    { condition: "", conditionNeedsConfirmation: true },
  );
});
