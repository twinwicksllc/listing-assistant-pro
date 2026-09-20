import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { normalizeConditionDescriptorToEnum, resolveConditionForCategory } from "./index.ts";

// Regression coverage for a Copilot review finding on PR #573:
// resolveConditionForCategory's LEGACY_CONDITION_MAP lookup is exact and
// case-sensitive, and normalizeConditionDescriptorToEnum's alias table was
// only ever applied to a matched LIVE candidate's conditionDescription, never
// to this function's own raw input. A CSV/API row containing a human-readable
// eBay descriptor like "New with tags" or "Pre-owned" -- exactly the input
// shape this bulk-publish path exists to cover -- fell through untouched and
// could never resolve to a valid Inventory API condition.

Deno.test("normalizeConditionDescriptorToEnum: resolves jewelry/sporting conditionDescription strings", () => {
  assertEquals(normalizeConditionDescriptorToEnum("New with tags"), "NEW");
  assertEquals(
    normalizeConditionDescriptorToEnum("New without tags"),
    "NEW_OTHER",
  );
  assertEquals(
    normalizeConditionDescriptorToEnum("Pre-owned"),
    "USED_EXCELLENT",
  );
});

Deno.test("resolveConditionForCategory: normalizes a raw human-readable descriptor, not just a legacy label", async () => {
  // categoryId="" skips the dynamicConditions network call entirely (the
  // `&& categoryId` guard) -- this isolates the raw-input normalization fix.
  const result = await resolveConditionForCategory("New with tags", "");
  assertEquals(result.conditionEnum, "NEW");
  assertEquals(result.conditionId, 1000);
});

Deno.test("resolveConditionForCategory: 'Pre-owned' resolves to USED_EXCELLENT, not a raw pass-through", async () => {
  const result = await resolveConditionForCategory("Pre-owned", "");
  assertEquals(result.conditionEnum, "USED_EXCELLENT");
  assertEquals(result.conditionId, 3000);
});

Deno.test("resolveConditionForCategory: a legacy already-correct enum still resolves unchanged (idempotency)", async () => {
  const result = await resolveConditionForCategory("USED_VERY_GOOD", "");
  assertEquals(result.conditionEnum, "USED_VERY_GOOD");
  assertEquals(result.conditionId, 4000);
});

Deno.test("resolveConditionForCategory: LEGACY_CONDITION_MAP's own aliases still take precedence", async () => {
  // "New" (capital N, exact LEGACY_CONDITION_MAP key) must still resolve via
  // that map, not accidentally diverge now that normalization runs too.
  const result = await resolveConditionForCategory("New", "");
  assertEquals(result.conditionEnum, "NEW");
});

// Regression coverage for a live production incident (2026-09-20):
// PRE_OWNED_GOOD/FAIR/POOR are NOT valid eBay Inventory API ConditionEnum
// values (confirmed against eBay's condition-id-values docs), but this
// function's own normalizeConditionDescriptorToEnum copy used to map the
// text "pre-owned good" straight to the fake enum "PRE_OWNED_GOOD" instead
// of a real USED_* value, and LEGACY_CONDITION_MAP's exact-case lookup only
// caught the exact-case enum string, not the lowercase text form a CSV/API
// bulk row would actually contain.
Deno.test("normalizeConditionDescriptorToEnum: PRE_OWNED_GOOD/FAIR/POOR text and enum forms both resolve to real USED_* enums", () => {
  assertEquals(normalizeConditionDescriptorToEnum("pre-owned good"), "USED_EXCELLENT");
  assertEquals(normalizeConditionDescriptorToEnum("pre-owned fair"), "USED_GOOD");
  assertEquals(normalizeConditionDescriptorToEnum("PRE_OWNED_GOOD"), "USED_EXCELLENT");
  assertEquals(normalizeConditionDescriptorToEnum("PRE_OWNED_POOR"), "USED_ACCEPTABLE");
});

Deno.test("resolveConditionForCategory: 'Pre-owned good' (bulk CSV text form) resolves to USED_EXCELLENT, never the fake PRE_OWNED_GOOD enum", async () => {
  const result = await resolveConditionForCategory("Pre-owned good", "");
  assertEquals(result.conditionEnum, "USED_EXCELLENT");
  assertEquals(result.conditionId, 3000);
});

Deno.test("resolveConditionForCategory: a legacy stored PRE_OWNED_GOOD enum value still migrates via LEGACY_CONDITION_MAP", async () => {
  const result = await resolveConditionForCategory("PRE_OWNED_GOOD", "");
  assertEquals(result.conditionEnum, "USED_EXCELLENT");
  assertEquals(result.conditionId, 3000);
});
