import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  detectCategoryTreeSync,
  HARDCODED_BULLION_CATEGORY_IDS,
  HARDCODED_COIN_CATEGORY_IDS,
  HARDCODED_COLLECTIBLE_CATEGORY_IDS,
  HARDCODED_TRADING_CARD_CATEGORY_IDS,
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
