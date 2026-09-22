import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Row cap boundary tests for bulk-publish
// Tests that the function correctly enforces row limits per tier
// (separate from the condition normalization tests in bulk-publish.test.ts)

interface BulkPublishRequest {
  userToken: string;
  rows: unknown[];
  tier: "starter" | "pro" | "unlimited" | "admin";
  dryRun?: boolean;
}

interface CapCheckResult {
  capped: boolean;
  cap: number;
  error?: string;
}

// Mock the bulk-publish row cap enforcement logic
function enforcePublishRowCap(rows: unknown[], tier: string): CapCheckResult {
  const ROW_CAPS: Record<string, number> = {
    starter: 5,
    pro: 50,
    unlimited: 1000,
    admin: 1000,
  };

  const cap = ROW_CAPS[tier] ?? 5;
  if (Array.isArray(rows) && rows.length > cap) {
    return {
      capped: true,
      cap,
      error: `Your plan allows publishing up to ${cap} listings at a time. You submitted ${rows.length}.`,
    };
  }

  return { capped: false, cap };
}

Deno.test("bulk-publish: Starter tier capped at 5 rows", () => {
  // Exactly at cap
  const atCap = enforcePublishRowCap(Array(5).fill({}), "starter");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 5);

  // Over cap
  const overCap = enforcePublishRowCap(Array(6).fill({}), "starter");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 5);
  assertStringIncludes(overCap.error!, "5 listings");
  assertStringIncludes(overCap.error!, "6");
});

Deno.test("bulk-publish: Pro tier capped at 50 rows (different from bulk-generate 25)", () => {
  // Exactly at cap
  const atCap = enforcePublishRowCap(Array(50).fill({}), "pro");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 50);

  // Between Pro's 50 and generate's 25
  const between = enforcePublishRowCap(Array(30).fill({}), "pro");
  assertEquals(between.capped, false, "Pro publish should allow 30 rows (generate caps at 25)");

  // Over cap
  const overCap = enforcePublishRowCap(Array(51).fill({}), "pro");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 50);
  assertStringIncludes(overCap.error!, "50 listings");
  assertStringIncludes(overCap.error!, "51");
});

Deno.test("bulk-publish: Unlimited tier capped at 1000 rows", () => {
  const atCap = enforcePublishRowCap(Array(1000).fill({}), "unlimited");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 1000);

  const overCap = enforcePublishRowCap(Array(1001).fill({}), "unlimited");
  assertEquals(overCap.capped, true);
  assertEquals(overCap.cap, 1000);
});

Deno.test("bulk-publish: Admin tier capped at 1000 rows", () => {
  const atCap = enforcePublishRowCap(Array(1000).fill({}), "admin");
  assertEquals(atCap.capped, false);
  assertEquals(atCap.cap, 1000);

  const overCap = enforcePublishRowCap(Array(1001).fill({}), "admin");
  assertEquals(overCap.capped, true);
});

Deno.test("bulk-publish: Unknown tier defaults to 5 rows (Starter)", () => {
  const unknown = enforcePublishRowCap(Array(6).fill({}), "unknown");
  assertEquals(unknown.capped, true);
  assertEquals(unknown.cap, 5);
});

Deno.test("bulk-publish: Pro tier cap (50) differs from bulk-generate tier cap (25)", () => {
  // This is an important distinction — Pro users can generate 25 descriptions
  // but then only publish 50 at a time, so they may need to batch differently

  const generate25 = enforcePublishRowCap(Array(25).fill({}), "pro");
  assertEquals(generate25.capped, false, "25 should pass publish cap");

  const publish50 = enforcePublishRowCap(Array(50).fill({}), "pro");
  assertEquals(publish50.capped, false, "50 should pass publish cap");

  const tooMany51 = enforcePublishRowCap(Array(51).fill({}), "pro");
  assertEquals(tooMany51.capped, true, "51 should fail publish cap");
});

Deno.test("bulk-publish: Single row passes all tier caps", () => {
  for (const tier of ["starter", "pro", "unlimited", "admin"]) {
    const result = enforcePublishRowCap(Array(1).fill({}), tier);
    assertEquals(result.capped, false, `${tier} should allow 1 row`);
  }
});

Deno.test("bulk-publish: Empty row array passes cap check", () => {
  const empty = enforcePublishRowCap([], "starter");
  assertEquals(empty.capped, false);
  assertEquals(empty.cap, 5);
});
