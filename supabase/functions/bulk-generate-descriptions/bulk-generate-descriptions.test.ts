import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Row cap boundary tests for bulk-generate-descriptions
// Tests that the function correctly enforces row limits per tier

interface BulkDescriptionRequest {
  rows: Array<{
    rowIndex: number;
    title: string;
    condition?: string;
    categoryId?: string;
    itemSpecifics?: Record<string, string>;
    imageUrl?: string;
  }>;
  tier: "starter" | "pro" | "unlimited" | "admin";
}

interface BulkDescriptionResponse {
  error?: string;
  results?: Array<{
    rowIndex: number;
    description?: string;
    error?: string;
  }>;
}

// Mock the bulk-generate-descriptions row cap enforcement logic
function enforceRowCap(rows: unknown[], tier: string): {
  capped: boolean;
  cap: number;
  error?: string;
} {
  const ROW_CAPS: Record<string, number> = {
    starter: 5,
    pro: 25,
    unlimited: 1000,
    admin: 1000,
  };

  const cap = ROW_CAPS[tier] ?? 5;
  if (Array.isArray(rows) && rows.length > cap) {
    return {
      capped: true,
      cap,
      error: `Your plan allows AI descriptions for up to ${cap} rows at a time. You submitted ${rows.length}.`,
    };
  }

  return { capped: false, cap };
}

Deno.test("bulk-generate-descriptions: Starter tier capped at 5 rows", () => {
  // Test exactly at cap
  const atCap = enforceRowCap(Array(5).fill({}), "starter");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 5);

  // Test over cap
  const overCap = enforceRowCap(Array(6).fill({}), "starter");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 5);
  assertStringIncludes(overCap.error!, "5 rows");
  assertStringIncludes(overCap.error!, "6");
});

Deno.test("bulk-generate-descriptions: Pro tier capped at 25 rows", () => {
  // Test exactly at cap
  const atCap = enforceRowCap(Array(25).fill({}), "pro");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 25);

  // Test over cap
  const overCap = enforceRowCap(Array(26).fill({}), "pro");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 25);
  assertStringIncludes(overCap.error!, "25 rows");
  assertStringIncludes(overCap.error!, "26");
});

Deno.test("bulk-generate-descriptions: Unlimited tier capped at 1000 rows", () => {
  // Test exactly at cap
  const atCap = enforceRowCap(Array(1000).fill({}), "unlimited");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 1000);

  // Test over cap
  const overCap = enforceRowCap(Array(1001).fill({}), "unlimited");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 1000);
});

Deno.test("bulk-generate-descriptions: Admin tier capped at 1000 rows", () => {
  const atCap = enforceRowCap(Array(1000).fill({}), "admin");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 1000);

  const overCap = enforceRowCap(Array(1001).fill({}), "admin");
  assertEquals(overCap.capped, true);
});

Deno.test("bulk-generate-descriptions: Unknown tier defaults to 5 rows (Starter)", () => {
  const unknown = enforceRowCap(Array(6).fill({}), "unknown");
  assertEquals(unknown.capped, true);
  assertEquals(unknown.cap, 5);
  assertEquals(unknown.error, "Your plan allows AI descriptions for up to 5 rows at a time. You submitted 6.");
});

Deno.test("bulk-generate-descriptions: Empty row array passes cap check", () => {
  const empty = enforceRowCap([], "starter");
  assertEquals(empty.capped, false);
  assertEquals(empty.cap, 5);
});

Deno.test("bulk-generate-descriptions: Single row passes all tier caps", () => {
  for (const tier of ["starter", "pro", "unlimited", "admin"]) {
    const result = enforceRowCap(Array(1).fill({}), tier);
    assertEquals(result.capped, false, `${tier} should allow 1 row`);
  }
});
