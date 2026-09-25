import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CONDITION_DESCRIPTIONS,
  detectCategoryTreeSync,
  generateDraftSku,
  getConditionDescription,
  HARDCODED_BULLION_CATEGORY_IDS,
  HARDCODED_COIN_CATEGORY_IDS,
  HARDCODED_COLLECTIBLE_CATEGORY_IDS,
  HARDCODED_TRADING_CARD_CATEGORY_IDS,
  normalizeConditionDescriptorToEnum,
} from "./publish-helpers.ts";

// Regression guard for the 2026-09-01 stale-coin-category-ID cleanup (see
// todo.md's "cure the disease in the three flagged follow-ups" entry).
//
// HARDCODED_COIN_CATEGORY_IDS / HARDCODED_BULLION_CATEGORY_IDS are the
// fallback-of-a-fallback detectCategoryTree()/detectCategoryTreeSync() use
// when the taxonomy cache and category_mappings DB lookup are unavailable.
// A wrong-domain-live entry here is not just cosmetic: detectCategoryTreeSync
// is a synchronous, zero-I/O function, so it is always computed first even
// when the DB path succeeds and overrides it — and a "coin" false positive
// makes publish-create-draft.ts treat eBay's June 2026 conditionDescriptors
// requirement as mandatory, throwing (aborting the whole publish) if it
// can't resolve descriptors for a category that was never really a coin.

const SNAPSHOT_PATH = "../../../corpus/ebay_taxonomy_snapshot.json";

interface SnapshotCategory {
  category_id: string;
  category_name: string;
  breadcrumb: string;
  is_leaf: boolean;
}

function loadSnapshot(): Map<string, SnapshotCategory> {
  const url = new URL(SNAPSHOT_PATH, import.meta.url);
  const raw = Deno.readTextFileSync(url);
  const parsed = JSON.parse(raw) as { categories: SnapshotCategory[] };
  return new Map(parsed.categories.map((c) => [c.category_id, c]));
}

Deno.test("HARDCODED_COIN_CATEGORY_IDS: no confirmed live leaf outside Coins & Paper Money", () => {
  const snapshot = loadSnapshot();
  const problems: string[] = [];
  for (const id of HARDCODED_COIN_CATEGORY_IDS) {
    const cat = snapshot.get(id);
    if (!cat || !cat.is_leaf) continue; // absent/non-leaf: harmless, see leafCategoryGuard.ts precedent
    if (!/coins & paper money/i.test(cat.breadcrumb)) {
      problems.push(`${id} is a live leaf but wrong domain: ${cat.breadcrumb}`);
    }
  }
  assertEquals(problems, [], `\n${problems.join("\n")}`);
});

Deno.test("HARDCODED_BULLION_CATEGORY_IDS: every entry is a confirmed live bullion leaf", () => {
  const snapshot = loadSnapshot();
  const problems: string[] = [];
  for (const id of HARDCODED_BULLION_CATEGORY_IDS) {
    const cat = snapshot.get(id);
    if (!cat) {
      problems.push(`${id} is absent from the live taxonomy`);
      continue;
    }
    if (!cat.is_leaf) {
      problems.push(`${id} is a non-leaf: ${cat.breadcrumb}`);
      continue;
    }
    if (!/bullion/i.test(cat.breadcrumb)) {
      problems.push(`${id} is a live leaf but not bullion: ${cat.breadcrumb}`);
    }
  }
  assertEquals(problems, [], `\n${problems.join("\n")}`);
});

Deno.test("HARDCODED_COLLECTIBLE_CATEGORY_IDS: no confirmed live leaf in an unrelated domain", () => {
  const snapshot = loadSnapshot();
  const problems: string[] = [];
  for (const id of HARDCODED_COLLECTIBLE_CATEGORY_IDS) {
    const cat = snapshot.get(id);
    if (!cat || !cat.is_leaf) continue;
    // Collectibles legitimately spans several top-level departments (Toys &
    // Hobbies, Collectibles proper); the failure mode already found was a
    // leaf entirely outside anything collectible-shaped (Computer Software).
    if (!/toys|hobbies|collectible/i.test(cat.breadcrumb)) {
      problems.push(`${id} is a live leaf but wrong domain: ${cat.breadcrumb}`);
    }
  }
  assertEquals(problems, [], `\n${problems.join("\n")}`);
});

Deno.test("coin and bullion sets don't cross-contaminate (except the intentional 178906 overlap)", () => {
  const overlap = [...HARDCODED_COIN_CATEGORY_IDS].filter((id) => HARDCODED_BULLION_CATEGORY_IDS.has(id));
  // 178906 (Gold Bars & Rounds) is deliberately in both — it resolves to
  // "bullion" since that Set is checked first, which is the correct outcome
  // for that specific leaf. Any OTHER overlap means a coin leaf was
  // re-added to the bullion Set (the exact bug just fixed for 532/173685).
  assertEquals(overlap, ["178906"]);
});

Deno.test("detectCategoryTreeSync: the removed 261xxx range regex no longer classifies unknown IDs as bullion", () => {
  // 261099 is an arbitrary, made-up ID in the range the old
  // /^261[0-9]{3}$/ catch-all used to blanket-classify as bullion. It is not
  // in any hardcoded Set and has no itemType hint, so it must now fall
  // through to "other" rather than being silently assumed bullion.
  assertEquals(detectCategoryTreeSync("261099", undefined), "other");
});

Deno.test("detectCategoryTreeSync: confirmed-wrong-domain IDs no longer resolve as coin or bullion", () => {
  for (const id of ["40150", "40152", "261064", "261068", "261069", "261070", "261071"]) {
    const result = detectCategoryTreeSync(id, undefined);
    if (result === "coin" || result === "bullion") {
      throw new Error(`${id} still resolves to "${result}" — expected anything else`);
    }
  }
});

Deno.test("detectCategoryTreeSync: 532 and 173685 resolve as coin, not bullion", () => {
  assertEquals(detectCategoryTreeSync("532", undefined), "coin");
  assertEquals(detectCategoryTreeSync("173685", undefined), "coin");
});

Deno.test("detectCategoryTreeSync: 3360 resolves as bullion (was missing, resolved coin before)", () => {
  assertEquals(detectCategoryTreeSync("3360", undefined), "bullion");
});

// Regression guard for the trading-card follow-up fix (same todo.md entry
// as above, "smaller follow-ups" pass). No dangerous wrong-domain-live IDs
// were found in this Set (lower severity than the coin cleanup — no
// publish-blocking mechanism exists for trading cards anywhere), but 19107
// was dead with a known live replacement (183050), already used correctly
// in analyze-item's AI prompt; only this fallback Set was stale.
Deno.test("HARDCODED_TRADING_CARD_CATEGORY_IDS: no confirmed live leaf outside trading cards/CCG", () => {
  const snapshot = loadSnapshot();
  const problems: string[] = [];
  for (const id of HARDCODED_TRADING_CARD_CATEGORY_IDS) {
    const cat = snapshot.get(id);
    if (!cat || !cat.is_leaf) continue; // absent/non-leaf: harmless, see leafCategoryGuard.ts precedent
    if (!/trading card|collectible card|toys & hobbies/i.test(cat.breadcrumb)) {
      problems.push(`${id} is a live leaf but wrong domain: ${cat.breadcrumb}`);
    }
  }
  assertEquals(problems, [], `\n${problems.join("\n")}`);
});

Deno.test("HARDCODED_TRADING_CARD_CATEGORY_IDS: dead 19107 is gone, replaced by live 183050", () => {
  assertEquals(HARDCODED_TRADING_CARD_CATEGORY_IDS.has("19107"), false);
  assertEquals(HARDCODED_TRADING_CARD_CATEGORY_IDS.has("183050"), true);
});

Deno.test("detectCategoryTreeSync: 183050 resolves as trading_card (19107 no longer does)", () => {
  assertEquals(detectCategoryTreeSync("183050", undefined), "trading_card");
});

// Regression guard for the 2026-09-16 ring-publish bug: eBay's Metadata API
// returns human-readable conditionDescription strings for Jewelry & Watches /
// Sporting Goods categories (confirmed via getItemConditionPolicies for
// category 261994, Fine Jewelry > Rings) that had no alias entry — the
// regex-mangle fallback turned them into non-existent enum tokens like
// "NEW_WITH_TAGS", which normalizeConditionForCategory's "other" branch (no
// coin/bullion/trading_card/collectible correction applies to jewelry) then
// passed through to eBay's publish endpoint untouched.
// Regression guard for the 2026-09-19 non-coin condition-description fix:
// CONDITION_DESCRIPTIONS is universally coin-flavored ("Uncirculated coin",
// "circulated"), which was being sent verbatim as the eBay
// conditionDescription field for every domain, including diecast toy cars
// and pencil sharpeners. getConditionDescription() must keep coin listings
// byte-for-byte identical to the old CONDITION_DESCRIPTIONS[...] lookup
// while giving every other domain generic, non-numismatic text.
Deno.test("getConditionDescription: categoryTreeType 'coin' matches legacy CONDITION_DESCRIPTIONS exactly", () => {
  for (const key of Object.keys(CONDITION_DESCRIPTIONS)) {
    assertEquals(getConditionDescription(key, "coin"), CONDITION_DESCRIPTIONS[key]);
  }
});

Deno.test("getConditionDescription: undefined categoryTreeType preserves legacy default behavior", () => {
  // Callers that haven't been updated to pass a tree type must see identical
  // output to before this change (backward compatibility requirement).
  for (const key of Object.keys(CONDITION_DESCRIPTIONS)) {
    assertEquals(getConditionDescription(key), CONDITION_DESCRIPTIONS[key]);
  }
});

Deno.test("getConditionDescription: non-coin domains get generic, non-numismatic text", () => {
  for (const treeType of ["bullion", "trading_card", "other", "diecast"]) {
    const desc = getConditionDescription("NEW", treeType);
    assertEquals(desc, "Brand new, unused item in original packaging (if any).");
  }

  const usedExcellent = getConditionDescription("USED_EXCELLENT", "other");
  assertEquals(
    usedExcellent,
    "Gently used item in excellent condition with minimal signs of wear.",
  );
  // Must not contain coin-specific numismatic vocabulary.
  assertEquals(/circulated/i.test(usedExcellent), false);

  const newDesc = getConditionDescription("NEW", "other");
  assertEquals(/coin/i.test(newDesc), false);
});

Deno.test("getConditionDescription: falls back to CONDITION_DESCRIPTIONS for keys with no generic override", () => {
  // NEW_OTHER has no coin-specific wording, so it's intentionally omitted
  // from GENERIC_CONDITION_DESCRIPTIONS and should fall back unchanged.
  assertEquals(
    getConditionDescription("NEW_OTHER", "other"),
    CONDITION_DESCRIPTIONS["NEW_OTHER"],
  );
});

Deno.test("getConditionDescription: unknown enum falls back to title-cased key regardless of tree type", () => {
  assertEquals(getConditionDescription("SOME_UNKNOWN_ENUM", "other"), "Some Unknown Enum");
  assertEquals(getConditionDescription("SOME_UNKNOWN_ENUM", "coin"), "Some Unknown Enum");
});

Deno.test("normalizeConditionDescriptorToEnum: jewelry/sporting conditionDescription strings", () => {
  assertEquals(normalizeConditionDescriptorToEnum("New with tags"), "NEW");
  assertEquals(
    normalizeConditionDescriptorToEnum("New without tags"),
    "NEW_OTHER",
  );
  assertEquals(
    normalizeConditionDescriptorToEnum("New with defects"),
    "NEW_WITH_DEFECTS",
  );
  assertEquals(
    normalizeConditionDescriptorToEnum("Pre-owned"),
    "USED_EXCELLENT",
  );
});

Deno.test("normalizeConditionDescriptorToEnum: is case-insensitive for the new aliases", () => {
  assertEquals(normalizeConditionDescriptorToEnum("NEW WITH TAGS"), "NEW");
  assertEquals(
    normalizeConditionDescriptorToEnum("pre-owned"),
    "USED_EXCELLENT",
  );
});

// Regression coverage for a Copilot review finding on PR #573:
// publish-create-draft.ts's pre-publish "other"-category live-conditions
// check normalized the LIVE side (liveEnums, from Metadata API
// conditionDescriptions) but compared it against the RAW incoming
// conditionEnum -- so a legacy draft/caller supplying a raw descriptor like
// "New with tags" (exactly the case that whole safety net exists to catch)
// could never match, and silently fell through to the USED_EXCELLENT
// fallback (a new ring converted to pre-owned). These tests prove the
// underlying comparison, once BOTH sides are normalized, resolves correctly
// -- the fix itself (publish-create-draft.ts) mirrors this exact logic.
Deno.test("normalizeConditionDescriptorToEnum: normalizing BOTH the live policy and a raw incoming descriptor makes them comparable", () => {
  // Simulates category 261994's live condition policy (Fine Jewelry > Rings).
  const liveConditionDescriptions = [
    "New with tags",
    "New without tags",
    "New with defects",
    "Pre-owned",
  ];
  const liveEnums = liveConditionDescriptions.map(
    normalizeConditionDescriptorToEnum,
  );

  // The exact bug: an incoming RAW descriptor (not yet an enum) must resolve
  // to a value present in the normalized live list once normalized itself --
  // comparing it unnormalized against liveEnums would never match.
  const incomingRaw = "New with tags";
  const normalizedIncoming = normalizeConditionDescriptorToEnum(incomingRaw);

  assertEquals(liveEnums.includes(incomingRaw), false); // the bug: raw never matches normalized live list
  assertEquals(liveEnums.includes(normalizedIncoming), true); // the fix: normalized does
  assertEquals(normalizedIncoming, "NEW");
});

// Regression coverage for a live production incident (2026-09-20): a Pocket
// Watch (category 3937, "Jewelry & Watches > ... > Pocket Watches",
// categoryTreeType="other") was published with rawCondition=PRE_OWNED_GOOD,
// which passed through normalizeConditionForCategory unchanged (no
// correction branch for "other" categories) and reached eBay's Inventory API
// verbatim. eBay rejected it with errorId 2004 "Could not serialize field
// [condition]" because PRE_OWNED_GOOD/FAIR/POOR are NOT valid ConditionEnum
// values (confirmed against eBay's condition-id-values docs -- ID 3000's
// real enum is USED_EXCELLENT). The "other"-category safety net in
// publish-create-draft.ts was also a no-op for this exact case: eBay's own
// live condition policy for this category returns the description
// "Pre-owned - Good", and the (buggy) alias table used to map that string
// right back to "PRE_OWNED_GOOD" -- so the safety net's own match check
// "confirmed" the invalid value as correct instead of catching it.
Deno.test("normalizeConditionDescriptorToEnum: PRE_OWNED_GOOD/FAIR/POOR are corrected to real USED_* enums, not passed through", () => {
  // Raw enum string form (e.g. a value already stored in the DB, or passed
  // directly as rawCondition without going through the text-alias table).
  assertEquals(normalizeConditionDescriptorToEnum("PRE_OWNED_GOOD"), "USED_EXCELLENT");
  assertEquals(normalizeConditionDescriptorToEnum("PRE_OWNED_FAIR"), "USED_GOOD");
  assertEquals(normalizeConditionDescriptorToEnum("PRE_OWNED_POOR"), "USED_ACCEPTABLE");

  // Human-readable descriptor text form, exactly as eBay's own Metadata API
  // (getItemConditionPolicies) returns it for category 3937.
  assertEquals(normalizeConditionDescriptorToEnum("Pre-owned - Good"), "USED_EXCELLENT");
  assertEquals(normalizeConditionDescriptorToEnum("Pre-owned Good"), "USED_EXCELLENT");
  assertEquals(normalizeConditionDescriptorToEnum("pre-owned fair"), "USED_GOOD");
});

Deno.test("normalizeConditionDescriptorToEnum: the live-incident tautology is fixed -- PRE_OWNED_GOOD no longer 'confirms' itself as valid", () => {
  // Simulates category 3937's live condition policy exactly as returned by
  // eBay during the incident.
  const liveConditions = [
    { conditionId: 3000, conditionDescription: "Pre-owned - Good" },
    { conditionId: 1000, conditionDescription: "New" },
  ];
  const liveEnums = liveConditions.map((c) => normalizeConditionDescriptorToEnum(c.conditionDescription));

  // Before the fix: liveEnums would contain "PRE_OWNED_GOOD", and the
  // upstream conditionEnum "PRE_OWNED_GOOD" would normalize to itself too --
  // so the safety net's match check would pass and ship the invalid value.
  // After the fix: both sides resolve to the real enum "USED_EXCELLENT".
  assertEquals(liveEnums.includes("PRE_OWNED_GOOD"), false);
  assertEquals(liveEnums.includes("USED_EXCELLENT"), true);

  const upstreamConditionEnum = "PRE_OWNED_GOOD"; // what reached publish-create-draft.ts
  const normalizedIncoming = normalizeConditionDescriptorToEnum(upstreamConditionEnum);
  assertEquals(normalizedIncoming, "USED_EXCELLENT");

  const matched = liveConditions.find(
    (c) => normalizeConditionDescriptorToEnum(c.conditionDescription) === normalizedIncoming,
  );
  assertEquals(matched?.conditionId, 3000);
  // The value that would actually be sent to eBay is now a real ConditionEnum.
  assertEquals(normalizedIncoming, "USED_EXCELLENT");
});

// eBay's Inventory API rejects any non-alphanumeric SKU (errorId 25707), and
// a single stored bad SKU fails the bulk GET /offer call for the whole
// account -- which is what forced every inventory sync onto the Trading API
// fallback (2026-09-24). The random fallback used to emit "LA-XXXX".
Deno.test("generateDraftSku: random fallback (no userId) is alphanumeric and within 50 chars", async () => {
  const sku = await generateDraftSku(undefined, undefined);
  assertEquals(/^LA[0-9A-F]{16}$/.test(sku), true, sku);
});

Deno.test("generateDraftSku: an incoming SKU is passed through unchanged", async () => {
  assertEquals(await generateDraftSku("LA01234", undefined), "LA01234");
});
