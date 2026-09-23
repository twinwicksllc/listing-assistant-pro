import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { buildAuditEntry, checkLeafActiveCacheFirst, validateLlmCategoryPicks } from "./index.ts";
import type { GatedCandidate } from "./resolverCore.ts";

function shortlistRow(
  categoryId: string,
  overrides: Partial<{ categoryName: string; breadcrumb: string; similarity: number }> = {},
) {
  return {
    categoryId,
    categoryName: overrides.categoryName ?? `Category ${categoryId}`,
    breadcrumb: overrides.breadcrumb ?? `Domain > Category ${categoryId}`,
    similarity: overrides.similarity ?? 0.9,
  };
}

Deno.test("validateLlmCategoryPicks: a valid subset passes through unchanged", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222"), shortlistRow("333")];
  const picks = [{ categoryId: "222", categoryName: "Category 222" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 1);
  assertEquals(result[0].categoryId, "222");
});

Deno.test("validateLlmCategoryPicks: a hallucinated ID not in the shortlist is dropped", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222")];
  const picks = [{ categoryId: "999", categoryName: "Invented Category" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: all-hallucinated picks yield zero candidates", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222")];
  const picks = [
    { categoryId: "888", categoryName: "Fake A" },
    { categoryId: "999", categoryName: "Fake B" },
  ];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: ordering is preserved as rank 1-3, hallucinations skipped in place", () => {
  const shortlist = [shortlistRow("111"), shortlistRow("222"), shortlistRow("333")];
  const picks = [
    { categoryId: "333", categoryName: "Category 333" },
    { categoryId: "999", categoryName: "Invented" }, // dropped, does not shift ranks of survivors
    { categoryId: "111", categoryName: "Category 111" },
  ];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 2);
  assertEquals(result[0].categoryId, "333");
  assertEquals(result[1].categoryId, "111");
});

Deno.test("validateLlmCategoryPicks: empty picks list returns empty", () => {
  const shortlist = [shortlistRow("111")];
  const result = validateLlmCategoryPicks([], shortlist);
  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: empty shortlist drops every pick", () => {
  const picks = [{ categoryId: "111", categoryName: "Category 111" }];
  const result = validateLlmCategoryPicks(picks, []);
  assertEquals(result.length, 0);
});

Deno.test("validateLlmCategoryPicks: returned rows come from the shortlist, not the LLM's own text", () => {
  // The LLM's self-reported categoryName is discarded in favor of the
  // shortlist's real categoryName/breadcrumb/similarity -- this is what
  // "selected only from the supplied list" actually enforces end-to-end.
  const shortlist = [
    shortlistRow("111", { categoryName: "Real Name", breadcrumb: "Real > Breadcrumb", similarity: 0.77 }),
  ];
  const picks = [{ categoryId: "111", categoryName: "LLM's made-up name" }];

  const result = validateLlmCategoryPicks(picks, shortlist);

  assertEquals(result.length, 1);
  assertEquals(result[0].categoryName, "Real Name");
  assertEquals(result[0].breadcrumb, "Real > Breadcrumb");
  assertEquals(result[0].similarity, 0.77);
});

// ── buildAuditEntry: Gate 4 warning persistence (Phase 6 data-collection fix) ──
// Regression coverage for the real gap found 2026-09-18: gate4Warnings was
// computed for every candidate but never persisted anywhere except the
// winner's own HTTP response body -- so Phase 6's "review two weeks of
// warn-only data" could never actually start, since no queryable dataset
// existed. These lock in that EVERY gated candidate's warnings are now
// recorded, not just the winner's.

function candidate(overrides: Partial<GatedCandidate> = {}): GatedCandidate {
  return {
    categoryId: "12345",
    categoryName: "Test Category",
    breadcrumb: "Domain > Sub > Test Category",
    source: "ebay_api",
    rank: 1,
    survived: true,
    dropReason: null,
    gate4Warnings: [],
    reason: "test candidate",
    ...overrides,
  };
}

function baseCtx(overrides: Partial<Parameters<typeof buildAuditEntry>[1]> = {}) {
  return {
    requestId: "req-1",
    queryText: "1921 morgan silver dollar",
    winner: null,
    lockReason: "NEEDS_CONFIRMATION: no candidate survived the hard gates",
    latencyMs: 42,
    ...overrides,
  };
}

Deno.test("buildAuditEntry: a candidate with no Gate 4 warnings persists gate4_warnings as null, not an empty array", () => {
  const c = candidate({ gate4Warnings: [] });
  const entry = buildAuditEntry(c, baseCtx());
  assertEquals(entry.gate4_warnings, null);
});

Deno.test("buildAuditEntry: a non-empty Gate 4 warnings list is persisted verbatim", () => {
  const warnings = [
    'Required aspect "Grade" has no plausible value in the known item data',
  ];
  const c = candidate({ gate4Warnings: warnings });
  const entry = buildAuditEntry(c, baseCtx());
  assertEquals(entry.gate4_warnings, warnings);
});

Deno.test("buildAuditEntry: warnings are recorded on a NON-winning candidate too (the whole point of this fix)", () => {
  const winner = candidate({ categoryId: "111", source: "ebay_api", gate4Warnings: [] });
  const loser = candidate({
    categoryId: "222",
    source: "db_fuzzy",
    survived: false,
    dropReason: "Gate 1 failed: not a leaf",
    gate4Warnings: ['Required aspect "Metal" has no plausible value in the known item data'],
  });

  const entry = buildAuditEntry(loser, baseCtx({ winner, lockReason: "eBay rank #1 confirmed" }));

  assertEquals(entry.was_selected, false);
  assertEquals(entry.gate4_warnings, ['Required aspect "Metal" has no plausible value in the known item data']);
});

Deno.test("buildAuditEntry: the winning candidate's own fields (was_selected, reason_selected) are unaffected by this change", () => {
  const winner = candidate({ categoryId: "111", source: "ebay_api", gate4Warnings: [] });
  const entry = buildAuditEntry(winner, baseCtx({ winner, lockReason: "eBay rank #1 confirmed by agreement" }));

  assertEquals(entry.was_selected, true);
  assertEquals(entry.reason_selected, "eBay rank #1 confirmed by agreement");
});

Deno.test("buildAuditEntry: a dropped (non-Gate-4) candidate's reason_selected still reports its own dropReason, gate4_warnings independent of that", () => {
  const c = candidate({
    survived: false,
    dropReason: "Gate 2 failed: not confirmed active",
    gate4Warnings: ['Required aspect "Year" has no plausible value in the known item data'],
  });
  const entry = buildAuditEntry(c, baseCtx());

  assertEquals(entry.reason_selected, "Gate 2 failed: not confirmed active");
  assertEquals(entry.verified_active, false);
  assertEquals(entry.gate4_warnings, ['Required aspect "Year" has no plausible value in the known item data']);
});

Deno.test("buildAuditEntry: a candidate dropped by Gate 3 (condition) or an enforced Gate 4 reports verified_leaf/verified_active as true, not null (Copilot review, PR #598)", () => {
  // Gates run strictly in order with an `if (!dropReason)` guard
  // (gateCandidate) -- a Gate 3/4 dropReason can only exist if Gates 1/2
  // already passed. Reporting null here would contradict the row's own
  // dropReason instead of confirming what actually happened.
  const gate3Dropped = candidate({
    survived: false,
    dropReason: "Gate 3 failed: category 12345 does not accept condition 1000",
  });
  const gate3Entry = buildAuditEntry(gate3Dropped, baseCtx());
  assertEquals(gate3Entry.verified_leaf, true);
  assertEquals(gate3Entry.verified_active, true);

  const gate4Dropped = candidate({
    survived: false,
    dropReason: 'Gate 4 failed (enforced): Required aspect "Grade" has no plausible value',
    gate4Warnings: ['Required aspect "Grade" has no plausible value'],
  });
  const gate4Entry = buildAuditEntry(gate4Dropped, baseCtx());
  assertEquals(gate4Entry.verified_leaf, true);
  assertEquals(gate4Entry.verified_active, true);
});

Deno.test("buildAuditEntry: latency and query/request context pass through unchanged", () => {
  const c = candidate({ source: "vector_llm" });
  const entry = buildAuditEntry(c, baseCtx({ requestId: "req-xyz", queryText: "graded coin", latencyMs: 250 }));

  assertEquals(entry.request_id, "req-xyz");
  assertEquals(entry.query_text, "graded coin");
  assertEquals(entry.latency_ms, 250);
  assertEquals(entry.candidate_source, "vector_llm");
});

// ── checkLeafActiveCacheFirst: regression coverage for the "verify" action's
// grounded-category-lock bottleneck (2026-09-22) ────────────────────────────
//
// analyze-item's grounded_tier_verify stage calls category-lookup's
// "verify" action, which (before this fix) always did a live eBay OAuth
// token fetch + getCategorySubtree call regardless of ebay_taxonomy_cache
// state -- a real production run for a UK Britannia coin hit the 25s
// internalFunction timeout on exactly this call. checkLeafActiveCacheFirst
// is the cache-first gate the main resolver path already trusted; the
// "verify" action now calls it too. These tests cover the function
// directly (mocked Supabase client) rather than the full HTTP handler,
// matching this file's existing pattern for isolable/pure logic.

function mockSupabase(cacheRow: Record<string, unknown> | null, throwOnSelect = false) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  if (throwOnSelect) throw new Error("simulated DB error");
                  return { data: cacheRow, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

Deno.test("checkLeafActiveCacheFirst: fresh cache row (leaf) answers with zero eBay calls", async () => {
  const freshRow = {
    category_id: "177653",
    category_name: "Coins",
    breadcrumb: "Coins & Paper Money > Bullion > Silver > Coins",
    is_leaf: true,
    synced_at: new Date().toISOString(), // 0 days old — well within CACHE_STALE_DAYS
  };

  const result = await checkLeafActiveCacheFirst(mockSupabase(freshRow) as any, "177653", null);

  assertEquals(result.source, "cache");
  assertEquals(result.isLeaf, true);
  assertEquals(result.isActive, true);
  assertEquals(result.breadcrumb, "Coins & Paper Money > Bullion > Silver > Coins");
});

Deno.test("checkLeafActiveCacheFirst: fresh cache row (non-leaf) is still authoritative, not re-verified live", async () => {
  const freshRow = {
    category_id: "253",
    category_name: "Coins: US",
    breadcrumb: "Coins & Paper Money > Coins: US",
    is_leaf: false,
    synced_at: new Date().toISOString(),
  };

  // ebayAuth is null here -- if the function tried to fall through to a
  // live call, it would return source:"unknown", not source:"cache". A
  // confident non-leaf cache hit must short-circuit before that fallback.
  const result = await checkLeafActiveCacheFirst(mockSupabase(freshRow) as any, "253", null);

  assertEquals(result.source, "cache");
  assertEquals(result.isLeaf, false);
  assertEquals(result.isActive, false);
});

Deno.test("checkLeafActiveCacheFirst: stale cache row (older than CACHE_STALE_DAYS) falls through, not trusted", async () => {
  const staleRow = {
    category_id: "177653",
    category_name: "Coins",
    breadcrumb: "Coins & Paper Money > Bullion > Silver > Coins",
    is_leaf: true,
    synced_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days old > 7-day threshold
  };

  // No ebayAuth provided -- the live fallback path returns "unknown"
  // rather than "cache", proving the stale row was not trusted as-is.
  const result = await checkLeafActiveCacheFirst(mockSupabase(staleRow) as any, "177653", null);

  assertEquals(result.source, "unknown");
});

Deno.test("checkLeafActiveCacheFirst: cache miss (no row) falls through to live path", async () => {
  const result = await checkLeafActiveCacheFirst(mockSupabase(null) as any, "999999", null);

  // No ebayAuth -> live path can't run either -> "unknown", not "cache"
  assertEquals(result.source, "unknown");
  assertEquals(result.isLeaf, false);
});

Deno.test("checkLeafActiveCacheFirst: a DB error on the cache lookup falls through gracefully, does not throw", async () => {
  const result = await checkLeafActiveCacheFirst(mockSupabase(null, true) as any, "177653", null);

  assertEquals(result.source, "unknown");
});
