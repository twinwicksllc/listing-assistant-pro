import { assertEquals, assertExists } from "https://deno.land/std@0.203.0/assert/mod.ts";
import { type GatedCandidate, selectWinner } from "./resolverCore.ts";

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

// ── Layer 2, rule 1: user_verified always wins ──────────────────────────

Deno.test("selectWinner: user_verified survivor wins even when eBay #1 also survives", () => {
  const userVerified = candidate({
    categoryId: "111",
    source: "user_verified",
    rank: 1,
  });
  const ebayTop = candidate({ categoryId: "222", source: "ebay_api", rank: 1 });

  const result = selectWinner([userVerified, ebayTop]);

  assertExists(result.winner);
  assertEquals(result.winner?.categoryId, "111");
  assertEquals(result.needsConfirmation, false);
});

Deno.test("selectWinner: non-surviving user_verified does NOT win", () => {
  const userVerified = candidate({
    categoryId: "111",
    source: "user_verified",
    rank: 1,
    survived: false,
    dropReason: "not a leaf",
  });
  const ebaySecond = candidate({
    categoryId: "333",
    source: "ebay_api",
    rank: 2,
    breadcrumb: "OtherDomain > X",
  });
  const ebayTop = candidate({
    categoryId: "222",
    source: "ebay_api",
    rank: 1,
    breadcrumb: "Domain > Y",
  });
  const dbExact = candidate({
    categoryId: "222",
    source: "db_exact",
    rank: 1,
    breadcrumb: "Domain > Y",
  });

  const result = selectWinner([userVerified, ebayTop, ebaySecond, dbExact]);

  assertExists(result.winner);
  assertEquals(result.winner?.categoryId, "222");
  assertEquals(result.winner?.source, "ebay_api");
});

// ── Layer 2, rule 3 + Layer 3: eBay #1 needs agreement + separation ─────

Deno.test("selectWinner: eBay #1 wins when agreement + subtree separation both hold", () => {
  const ebayTop = candidate({
    categoryId: "222",
    source: "ebay_api",
    rank: 1,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
  });
  const ebaySecond = candidate({
    categoryId: "999",
    source: "ebay_api",
    rank: 2,
    breadcrumb: "Toys & Hobbies > Action Figures",
  });
  const dbAgree = candidate({
    categoryId: "222",
    source: "db_exact",
    rank: 1,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
  });

  const result = selectWinner([ebayTop, ebaySecond, dbAgree]);

  assertExists(result.winner);
  assertEquals(result.winner?.categoryId, "222");
  assertEquals(result.needsConfirmation, false);
  assertEquals(result.agreementChecked, true);
  assertEquals(result.subtreeSeparated, true);
});

Deno.test("selectWinner: NEEDS_CONFIRMATION when no independent source agrees with eBay #1", () => {
  const ebayTop = candidate({
    categoryId: "222",
    source: "ebay_api",
    rank: 1,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
  });
  const ebaySecond = candidate({
    categoryId: "999",
    source: "ebay_api",
    rank: 2,
    breadcrumb: "Toys & Hobbies > Action Figures",
  });

  const result = selectWinner([ebayTop, ebaySecond]);

  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
  assertEquals(result.agreementSourcesMatched.length, 0);
});

Deno.test("selectWinner: NEEDS_CONFIRMATION when eBay #1 and #2 share the same subtree (not separated)", () => {
  const ebayTop = candidate({
    categoryId: "222",
    source: "ebay_api",
    rank: 1,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
  });
  const ebaySecond = candidate({
    categoryId: "223",
    source: "ebay_api",
    rank: 2,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Gold",
  });
  const dbAgree = candidate({
    categoryId: "222",
    source: "db_exact",
    rank: 1,
    breadcrumb: "Coins & Paper Money > Coins: US > Commemorative > Silver",
  });

  const result = selectWinner([ebayTop, ebaySecond, dbAgree]);

  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
  assertEquals(result.subtreeSeparated, false);
});

Deno.test("selectWinner: eBay #1 with no rank #2 at all is vacuously subtree-separated", () => {
  const ebayTop = candidate({ categoryId: "222", source: "ebay_api", rank: 1 });
  const dbAgree = candidate({ categoryId: "222", source: "db_exact", rank: 1 });

  const result = selectWinner([ebayTop, dbAgree]);

  assertExists(result.winner);
  assertEquals(result.subtreeSeparated, true);
});

// ── Layer 2, rule 4: no survivors at all ────────────────────────────────

Deno.test("selectWinner: NEEDS_CONFIRMATION with empty candidate list", () => {
  const result = selectWinner([]);
  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
});

Deno.test("selectWinner: NEEDS_CONFIRMATION when every candidate failed the hard gates", () => {
  const dead1 = candidate({
    categoryId: "99",
    source: "ebay_api",
    rank: 1,
    survived: false,
    dropReason: "not a leaf",
  });
  const dead2 = candidate({
    categoryId: "256",
    source: "gemini",
    rank: 1,
    survived: false,
    dropReason: "not active",
  });

  const result = selectWinner([dead1, dead2]);

  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
});

// ── eBay #1 didn't survive, but a different candidate did — still NEEDS_CONFIRMATION ──

Deno.test("selectWinner: eBay #1 dropped, db_fuzzy survivor exists — still NEEDS_CONFIRMATION (no consolation prize)", () => {
  const ebayTopDropped = candidate({
    categoryId: "99",
    source: "ebay_api",
    rank: 1,
    survived: false,
    dropReason: "not a leaf",
  });
  const fuzzySurvivor = candidate({
    categoryId: "555",
    source: "db_fuzzy",
    rank: 1,
    survived: true,
  });

  const result = selectWinner([ebayTopDropped, fuzzySurvivor]);

  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
});

Deno.test("selectWinner: gemini alone, even if it survives, never wins outright", () => {
  const geminiOnly = candidate({
    categoryId: "777",
    source: "gemini",
    rank: 1,
    survived: true,
  });

  const result = selectWinner([geminiOnly]);

  assertEquals(result.winner, null);
  assertEquals(result.needsConfirmation, true);
});
