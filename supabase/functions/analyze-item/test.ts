// Test: analyze-item function with test database items
// deno test --allow-net --allow-env supabase/functions/analyze-item/test.ts

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { getTestItemByDomain, TEST_DOMAINS } from "../_test-helpers/test-db.ts";

// Note: These tests expect:
// 1. Local Supabase running: supabase start
// 2. Functions deployed: supabase functions serve
// 3. Test database seeded: migration 20260329024428_create_test_items_table.sql applied

const FUNCTION_URL = "http://localhost:54321/functions/v1/analyze-item";

/**
 * Helper to call analyze-item function with mock auth
 * In production, these would use real JWT tokens from auth
 */
async function callAnalyzeItem(payload: {
  voiceNote: string;
  images?: string[];
  categoryHints?: string;
}) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Mock auth header - adjust if needed for your setup
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`analyze-item failed: ${response.status} ${error}`);
  }

  return response.json();
}

Deno.test("analyze-item: coins_bullion domain detection", async () => {
  const item = await getTestItemByDomain("coins_bullion");

  const result = await callAnalyzeItem({
    voiceNote: item.title + " " + item.description,
    images: item.image_urls || [],
  });

  assert(result.domain === "coins_bullion", `Expected coins_bullion domain, got ${result.domain}`);
  assert(result.category, "Category should be returned");
  assertEquals(typeof result.category, "number", "Category should be numeric");
  assert(
    result.condition === "Excellent" || result.condition === "Good",
    "Condition should be detected"
  );
  if (item.item_specifics.Weight && item.metal_type === "silver") {
    assert(result.meltValue > 0, "Melt value should be calculated for silver");
  }
});

Deno.test("analyze-item: trading_cards domain detection", async () => {
  const item = await getTestItemByDomain("trading_cards");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  assert(result.domain === "trading_cards", `Expected trading_cards, got ${result.domain}`);
  assert(result.category, "Category should be returned");
  assertEqual(typeof result.suggestedGrade, "string", "Grade should be suggested for cards");
});

Deno.test("analyze-item: jewelry domain detection", async () => {
  const item = await getTestItemByDomain("jewelry");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  assert(result.domain === "jewelry", `Expected jewelry, got ${result.domain}`);
  assert(result.category, "Category should be detected");
});

Deno.test("analyze-item: electronics domain detection", async () => {
  const item = await getTestItemByDomain("electronics");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  assert(result.domain === "electronics", `Expected electronics, got ${result.domain}`);
  assert(result.category, "Category should be returned");
});

Deno.test("analyze-item: vintage_clothing domain detection", async () => {
  const item = await getTestItemByDomain("vintage_clothing");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  assert(result.domain === "vintage_clothing", `Expected vintage_clothing, got ${result.domain}`);
  assert(result.category, "Category should be returned");
});

Deno.test("analyze-item: general domain fallback", async () => {
  const item = await getTestItemByDomain("general");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  assert(result.domain, "Domain should be detected");
  assert(result.category, "Category should be returned");
});

Deno.test("analyze-item: multiple calls with same item should be consistent", async () => {
  const item = await getTestItemByDomain("coins_bullion");
  const voiceNote = item.title;

  const result1 = await callAnalyzeItem({ voiceNote });
  const result2 = await callAnalyzeItem({ voiceNote });

  assertEquals(result1.domain, result2.domain, "Domain should be consistent");
  assertEquals(result1.category, result2.category, "Category should be consistent");
});

Deno.test("analyze-item: response has required fields", async () => {
  const item = await getTestItemByDomain("coins_bullion");

  const result = await callAnalyzeItem({
    voiceNote: item.title,
    images: item.image_urls || [],
  });

  // Verify response structure
  assert(result.domain, "Missing: domain");
  assert(result.category !== undefined, "Missing: category");
  assert(result.title !== undefined, "Missing: title");
  assert(result.description !== undefined, "Missing: description");
  assert(result.condition !== undefined, "Missing: condition");
  assert(Array.isArray(result.suggestedCategories), "Missing/invalid: suggestedCategories array");
});

// Additional helper for test results
function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} (got ${actual}, expected ${expected})`);
  }
}
