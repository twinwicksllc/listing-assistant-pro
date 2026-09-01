import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "./supabase.ts";
import { fetchWithTimeout } from "./fetch.ts";

// eBay publish Edge Function.
// Handles OAuth helpers, policy lookup, media upload, inventory/offer creation,
// dynamic category aspects, and category-aware condition normalization.

// ================================================================
// CATEGORY ASPECT RULES
// ================================================================
// Hardcoded fallback rules for known categories.
// The system now FIRST tries to fetch dynamic rules from eBay's
// getItemAspectsForCategory API (cached in category_aspects_cache table).
// If the dynamic fetch fails or returns nothing, these hardcoded rules
// are used as a safety net.
// ================================================================

export interface AspectRule {
  required: string[];
  preferred: string[];
  defaults: Record<string, string>;
  fixedValues?: Record<string, string>;
}

export const EBAY_MARKETPLACE_ID = "EBAY_US";
export const EBAY_CATEGORY_TREE_ID = "0";

export const CERTIFIED_GRADING_COMPANIES = [
  "PCGS",
  "NGC",
  "ANACS",
  "ICG",
  "CAC",
  "ICCS",
  "PMG",
  "Legacy Currency Grading",
];

export const CERTIFIED_GRADING_SERVICES = new Set([
  ...CERTIFIED_GRADING_COMPANIES,
  "PCGS & CAC",
  "NGC & CAC",
]);

export const CERTIFICATION_ASPECT_VALUES = new Set([
  "Uncertified",
  ...CERTIFIED_GRADING_SERVICES,
  "U.S. Mint",
]);

// ================================================================
// DYNAMIC ASPECT FETCHER
// ================================================================
// Fetches aspect rules from category_aspects_cache (populated by
// category-lookup's "aspects" action via eBay's getItemAspectsForCategory).
// Falls back to hardcoded CATEGORY_ASPECT_RULES if cache miss.
// ================================================================

export async function fetchDynamicAspectRule(
  categoryId: string,
  supabase: any,
): Promise<AspectRule | null> {
  try {
    // 1. Check the cache table. Keep the composite context aligned with
    // the category_aspects_cache primary key: category, marketplace, and tree.
    const { data: cached } = await supabase
      .from("category_aspects_cache")
      .select("aspects, expires_at")
      .eq("category_id", categoryId)
      .eq("marketplace_id", EBAY_MARKETPLACE_ID)
      .eq("category_tree_id", EBAY_CATEGORY_TREE_ID)
      .maybeSingle();

    if (cached?.aspects && new Date(cached.expires_at) > new Date()) {
      // Convert eBay API format to our AspectRule format
      return convertEbayAspectsToRule(cached.aspects);
    }

    // 2. Cache miss or stale — call category-lookup to fetch + cache
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/category-lookup`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "aspects", categoryId }),
          },
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.aspects && data.aspects.length > 0) {
            return convertEbayAspectsToRule(data.aspects);
          }
        }
      } catch (fetchErr) {
        console.warn(
          `fetchDynamicAspectRule: category-lookup call failed for ${categoryId}:`,
          fetchErr,
        );
      }
    }

    // 3. If we had stale cache data, use it as fallback
    if (cached?.aspects) {
      return convertEbayAspectsToRule(cached.aspects);
    }

    return null;
  } catch (err) {
    console.warn(`fetchDynamicAspectRule: error for ${categoryId}:`, err);
    return null;
  }
}

// Convert eBay getItemAspectsForCategory response into our AspectRule format
export function convertEbayAspectsToRule(aspects: any[]): AspectRule {
  const required: string[] = [];
  const preferred: string[] = [];
  const defaults: Record<string, string> = {};

  for (const aspect of aspects) {
    const name = aspect.name;
    if (!name) continue;

    if (aspect.required) {
      required.push(name);
    } else if (aspect.usage === "RECOMMENDED") {
      preferred.push(name);
    }

    // For SELECTION_ONLY aspects with exactly one value, set it as default
    if (aspect.mode === "SELECTION_ONLY" && aspect.values?.length === 1) {
      defaults[name] = aspect.values[0];
    }
  }

  return { required, preferred, defaults };
}

export const _categoryConditionCache: Map<
  string,
  Array<{ conditionId: number; conditionDescription: string }>
> = new Map();

export function normalizeConditionDescriptorToEnum(
  value: string | undefined | null,
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  const aliases: Record<string, string> = {
    "brand new": "NEW",
    new: "NEW",
    "new other (see details)": "NEW_OTHER",
    "new-open box": "NEW_OTHER",
    "new open box": "NEW_OTHER",
    "open box": "LIKE_NEW",
    "like new": "LIKE_NEW",
    used: "USED_EXCELLENT",
    "very good": "USED_VERY_GOOD",
    good: "USED_GOOD",
    acceptable: "USED_ACCEPTABLE",
    "for parts or not working": "FOR_PARTS_OR_NOT_WORKING",
    "certified refurbished": "CERTIFIED_REFURBISHED",
    "excellent refurbished": "EXCELLENT_REFURBISHED",
    "very good refurbished": "VERY_GOOD_REFURBISHED",
    "good refurbished": "GOOD_REFURBISHED",
    "seller refurbished": "SELLER_REFURBISHED",
    "pre-owned good": "PRE_OWNED_GOOD",
    "pre-owned fair": "PRE_OWNED_FAIR",
    "pre-owned poor": "PRE_OWNED_POOR",
    "digital good": "DIGITAL_GOOD",
    "certified pre-owned": "CERTIFIED_PRE_OWNED",
    remanufactured: "REMANUFACTURED",
    retread: "RETREAD",
    damaged: "DAMAGED",
    graded: "LIKE_NEW", // 2750 = Graded (per eBay condition ID docs)
    ungraded: "USED_VERY_GOOD", // 4000 = Ungraded (per eBay condition ID docs)
  };

  return (
    aliases[lowered] ??
      raw
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
  );
}

export async function fetchDynamicCategoryConditions(
  categoryId: string,
): Promise<Array<{ conditionId: number; conditionDescription: string }>> {
  if (_categoryConditionCache.has(categoryId)) {
    return _categoryConditionCache.get(categoryId) ?? [];
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) return [];

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/category-lookup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "conditions", categoryId }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(
        `fetchDynamicCategoryConditions: category-lookup error ${resp.status} for ${categoryId}: ${errText}`,
      );
      return [];
    }

    const data = await resp.json();
    const conditions = Array.isArray(data?.conditions)
      ? data.conditions
        .map((condition: any) => ({
          conditionId: Number(condition.conditionId),
          conditionDescription: String(
            condition.conditionDescription ?? "",
          ).trim(),
        }))
        .filter(
          (condition: {
            conditionId: number;
            conditionDescription: string;
          }) =>
            Number.isFinite(condition.conditionId) &&
            condition.conditionDescription,
        )
      : [];

    _categoryConditionCache.set(categoryId, conditions);
    return conditions;
  } catch (err) {
    console.warn(
      `fetchDynamicCategoryConditions: error for ${categoryId}:`,
      err,
    );
    return [];
  }
}

// ================================================================
// CATEGORY TREE DETECTION (replaces hardcoded ID sets)
// ================================================================
// Detects category type from breadcrumb path stored in DB.
// Falls back to hardcoded ID sets if breadcrumb unavailable.
// ================================================================

type CategoryTreeType = "coin" | "bullion" | "trading_card" | "collectible" | "other";

export async function detectCategoryTree(
  categoryId: string,
  supabase: any,
): Promise<CategoryTreeType> {
  // eBay June 2026 mandate top-level parent IDs — always "coin" regardless of breadcrumb
  const COIN_MANDATE_PARENT_IDS = new Set([
    "253",
    "256",
    "3377",
    "4733",
    "18466",
  ]);
  if (COIN_MANDATE_PARENT_IDS.has(categoryId)) return "coin";

  const classifyBreadcrumb = (breadcrumb: string): CategoryTreeType => {
    const normalized = breadcrumb.toLowerCase();
    if (normalized.includes("bullion")) return "bullion";
    if (
      normalized.includes("coins:") ||
      normalized.includes("coins >") ||
      normalized.includes("paper money") ||
      normalized.includes("numismatic") ||
      normalized.includes("coins & paper money")
    ) {
      return "coin";
    }
    if (
      normalized.includes("trading cards") ||
      normalized.includes("collectible card games")
    ) {
      return "trading_card";
    }
    if (
      normalized.includes("collectibles") ||
      normalized.includes("toys &") ||
      normalized.includes("stuffed animal") ||
      normalized.includes("action figure") ||
      normalized.includes("funko") ||
      normalized.includes("lego") ||
      normalized.includes("board game")
    ) {
      return "collectible";
    }
    return "other";
  };

  // First check the weekly taxonomy sync output. Do not remove this path:
  // sync-ebay-taxonomy writes all active leaf breadcrumbs to ebay_taxonomy_cache.
  try {
    const { data: taxonomy } = await supabase
      .from("ebay_taxonomy_cache")
      .select("breadcrumb, category_name")
      .eq("category_id", categoryId)
      .maybeSingle();

    const breadcrumb = taxonomy?.breadcrumb || taxonomy?.category_name || "";
    if (breadcrumb) return classifyBreadcrumb(String(breadcrumb));
  } catch (_) {
    /* fall through to legacy mapping */
  }

  // Legacy fallback for categories cached before the taxonomy sync existed.
  try {
    const { data: mapping } = await supabase
      .from("category_mappings")
      .select("breadcrumb, category_name")
      .eq("ebay_category_id", categoryId)
      .maybeSingle();

    const breadcrumb = mapping?.breadcrumb || mapping?.category_name || "";
    if (breadcrumb) return classifyBreadcrumb(String(breadcrumb));
  } catch (_) {
    /* fall through to hardcoded */
  }

  // Fallback to hardcoded sets
  if (HARDCODED_BULLION_CATEGORY_IDS.has(categoryId)) return "bullion";
  if (HARDCODED_COIN_CATEGORY_IDS.has(categoryId)) return "coin";
  if (HARDCODED_TRADING_CARD_CATEGORY_IDS.has(categoryId)) {
    return "trading_card";
  }
  if (HARDCODED_COLLECTIBLE_CATEGORY_IDS.has(categoryId)) return "collectible";
  return "other";
}

// Hardcoded ID sets kept as fallback for detectCategoryTree.
// NOTE: Only LEAF categories are included here (no parent category IDs like 253, 256, 3377, 4733, 18466).
// Parent categories are detected dynamically via breadcrumb patterns (e.g., "Coins: US", "Coins: World").
// eBay Metadata API and descriptor fetching work with actual leaf category IDs.
// 2026-09-01: corrected every wrong inline comment below using labels
// verified against corpus/ebay_taxonomy_snapshot.json — comments are
// text-only (the code below only ever checks Set membership), but a wrong
// comment is exactly what let 7 confirmed live-leaf-wrong-domain IDs
// (261064/261068/261069/261070/261071, plus 40150/40152 silently reassigned
// by eBay to Action Figures/Go-Karts) go undetected here after being fixed
// everywhere else in the AI-facing pipeline. Removed those 7, removed IDs
// confirmed dead (absent from the live tree) where a correct live
// replacement already exists elsewhere in this Set or has been added below,
// and moved 532/173685 (real coin leaves) out of the bullion Set below,
// where their presence was silently misclassifying them (bullion is checked
// before coin in detectCategoryTree/detectCategoryTreeSync).
export const HARDCODED_COIN_CATEGORY_IDS = new Set([
  // ── eBay June 2026 mandate top-level parent IDs (all descendants require conditionDescriptors) ──
  "253", // Coins: US (parent — all descendants are coins)
  "256", // Coins: World (eBay taxonomy parent)
  "3377", // Coins: Canada (eBay taxonomy parent)
  "4733", // Coins: Ancient (eBay taxonomy parent)
  "18466", // Coins: Medieval (eBay taxonomy parent)
  // ── US Cents ───────────────────────────────────────────────────────────────
  "11981", // Eisenhower Dollar (1971-78)
  "39464", // Morgan Dollar (1878-1921)
  "31373", // Lincoln Memorial Cent (1959-2008)
  "39455", // Lincoln Wheat Small Cent (1909-1958)
  "41084", // Indian Head Small Cent (1859-1909)
  "11950", // Braided Hair Large Cent (1839-57)
  "11949", // Coronet Head Large Cent (1816-39)
  // ── US Nickels ─────────────────────────────────────────────────────────────
  "11980", // Peace Dollar (1921-35)
  "41087", // Jefferson Nickel (1938-Now)
  "139806", // Buffalo Nickel (1913-38)
  // ── US Dimes ───────────────────────────────────────────────────────────────
  "11958", // Seated Liberty Dimes (legacy leaf used in production payloads)
  "11971", // Barber Half Dollar (1892-1915)
  "41090", // Mercury Dime (1916-45)
  // ── US Quarters ────────────────────────────────────────────────────────────
  "41099", // Liberty Walking Half Dollar (1916-47)
  "41102", // Kennedy Half Dollar (1964-Now)
  "171526", // America the Beautiful Quarters (2026)
  // ── US Half Dollars / Dollar Coins ─────────────────────────────────────────
  "11973", // Franklin Half Dollar (1948-1963)
  "11983", // Native American Dollar (2000-Now, was Sacagawea)
  "159713", // Presidential Dollar (2007-Now)
  "11982", // Susan B Anthony Dollar (1979-81, 99)
  // ── US Gold ────────────────────────────────────────────────────────────────
  "39471", // $10, Eagle (Gold Pre-1933)
  "39472", // $20, Double Eagle (Gold Pre-1933)
  "39473", // Fractional, Pioneer (Gold Pre-1933)
  "39470", // $5, Half Eagle (Gold Pre-1933)
  // ── US Coin Sets / Proof ────────────────────────────────────────────────────
  "166679", // Other Bullion (also correct home for the generic bullion-coin fallback)
  "41109", // US Coin Proof Sets
  "526", // US Coin Mint Sets
  // ── US Commemorative ────────────────────────────────────────────────────────
  "179531", // Commemorative Silver (1892-1954)
  "179532", // Commemorative Gold (1903-1926)
  "179533", // Commemorative Modern Silver/Clad (1982-Now)
  "179534", // Commemorative Modern Gold (1984-Now)
  "529", // Commemorative Mixed Lots
  // ── Ancient / Medieval (moved back from the bullion Set below 2026-09-01 —
  // both are real coin leaves, not bullion; their comments were wrong too:
  // "Silver Bars & Rounds" / "Platinum / Palladium Bullion") ────────────────
  "532", // Coins: Ancient > Other Ancient Coins
  "173685", // Coins: Medieval > Other Medieval Coins
  // ── World Coins (45243/40196-40202 removed 2026-09-01: confirmed dead,
  // same Finding B already fixed elsewhere; replaced with live per-country
  // leaves + the 257 catch-all) ────────────────────────────────────────────
  "257", // Coins: World > Other Coins of the World
  "536", // Coins: Canada > Other Canadian Coins
  "173631", // Coins: World > North & Central America > Mexico (1905-Now)
  "3406", // Coins: World > Europe > UK (Great Britain) > Crown
  "535", // Coins: World > Australia & Oceania > Australia > Other
  "7955", // Coins: World > Europe > Germany > West & Unified (1949-Now)
  "539", // Coins: World > Europe > France
  // ── Bullion Coins (overlap with bullion — conditionDescriptors fetched; 0 returned = mandate exempt) ─
  "177652", // Bullion > Gold > Coins
  "177653", // Bullion > Silver > Coins
  "178906", // Bullion > Gold > Bars & Rounds
  // ── Collectibles: Coins (dangerous wrong-domain range removed 2026-09-01 —
  // 261064/261068/261069/261070/261071 are confirmed LIVE LEAVES in Toys &
  // Hobbies / Collectibles: Animation Art, not Coins & Paper Money; 261072-
  // 261076 are absent from the live tree, left as-is per leafCategoryGuard.ts's
  // established precedent — absence doesn't prove an ID no longer exists) ──
  "261072",
  "261073",
  "261074",
  "261075",
  "261076",
]);
export const HARDCODED_BULLION_CATEGORY_IDS = new Set([
  "178906", // Bullion > Gold > Bars & Rounds
  "39489", // Bullion > Silver > Bars & Rounds
  "3361", // Bullion > Silver > Other Silver Bullion
  "3360", // Bullion > Gold > Other Gold Bullion (added 2026-09-01: confirmed
  // live bullion leaf, was missing — meant this ID resolved "coin" instead
  // of "bullion" via the coin Set below)
  "34942", // Bullion > Platinum > Other Platinum Bullion
  "34943", // Bullion > Palladium
  // 532/173685 removed 2026-09-01: both are confirmed live COIN leaves
  // (Coins: Ancient > Other Ancient Coins; Coins: Medieval > Other Medieval
  // Coins), not bullion — their presence here was misclassifying them, since
  // this Set is checked before the coin Set in detectCategoryTree/
  // detectCategoryTreeSync. They remain correctly in HARDCODED_COIN_CATEGORY_IDS.
]);
export const HARDCODED_TRADING_CARD_CATEGORY_IDS = new Set([
  "261328",
  "183454",
  "2536",
  "19107",
  "64482",
  "213",
]);
export const HARDCODED_COLLECTIBLE_CATEGORY_IDS = new Set([
  "19203",
  "19209",
  "261068", // Toys & Hobbies > Action Figures & Accessories > Action Figures
  "246",
  "19016",
  // "182" removed 2026-09-01: confirmed live leaf but wrong domain
  // (Computers/Tablets & Networking > Software > Other Computer Software,
  // not LEGO/collectible — same disease as the coin-category fixes above).
]);

// ================================================================
// COIN/BULLION FIXED-VALUES ALLOWLIST (deficiency #5)
// Only categories in this set may receive hardcoded fixedValues
// (Composition, Fineness, Denomination, Material).
// Prevents coin-specific aspects from leaking to non-coin categories.
// ================================================================
// Only leaf categories allowed to receive coin-specific fixed values (Composition, Fineness, Denomination, Material).
// Parent IDs like 253, 256, 3377, 4733, 18466 are not included; descendant detection via breadcrumbs will handle them.
export const COIN_FIXED_VALUES_ALLOWED_IDS = new Set([
  // Coins (leaf categories only)
  "11981",
  "39464",
  "11980",
  "11971",
  "41099",
  "41102",
  "11973",
  "39455",
  "41084",
  "11950",
  "41111",
  "41109",
  "526",
  "45243",
  "39471",
  "39472",
  "39473",
  "39474",
  "39475",
  // Bullion (leaf categories only)
  "178906",
  "39489",
  "3360",
  "3361",
  "532",
  "173685",
  "166679",
]);

export const CATEGORY_ASPECT_RULES: Record<string, AspectRule> = {
  // Empty rule set for non-coin categories with no specific aspect requirements
  __empty__: {
    required: [],
    preferred: [],
    defaults: {},
  },
  // Gold Bars & Rounds
  "178906": {
    required: [],
    preferred: [
      "Shape",
      "Precious Metal Content per Unit",
      "Brand/Mint",
      "Fineness",
    ],
    defaults: {},
    fixedValues: { Composition: "Gold" },
  },
  // Silver Bars & Rounds
  "39489": {
    required: [],
    preferred: [
      "Shape",
      "Precious Metal Content per Unit",
      "Brand/Mint",
      "Fineness",
    ],
    defaults: {},
    fixedValues: { Composition: "Silver" },
  },
  // Silver Bars & Rounds (grain bar category; same Certification requirement as bullion)
  "3360": {
    required: ["Certification"],
    preferred: [
      "Shape",
      "Precious Metal Content per Unit",
      "Brand/Mint",
      "Fineness",
    ],
    defaults: { Certification: "Uncertified" },
    fixedValues: { Composition: "Silver" },
  },
  // Other Silver Bullion
  "3361": {
    required: ["Certification"],
    preferred: ["Type"],
    defaults: { Certification: "Uncertified" },
    fixedValues: { Composition: "Silver" },
  },
  // Ancient Coins
  "532": {
    required: [],
    preferred: ["KM Number", "Fineness"],
    defaults: {},
  },
  // Medieval Coins
  "173685": {
    required: [],
    preferred: ["KM Number", "Fineness"],
    defaults: {},
  },
  // Eisenhower Dollars 1971-1978
  "11981": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Strike Type",
      "Mint Location",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "$1",
    },
    fixedValues: { Denomination: "$1" },
  },
  // Morgan Dollars 1878-1921
  "39464": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Composition",
      "Year",
      "Mint Location",
      "Strike Type",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "$1",
    },
    fixedValues: {
      Denomination: "$1",
      Composition: "Silver",
      Fineness: "0.900",
    },
  },
  // Peace Dollars 1921-1935
  "11980": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "$1",
    },
    fixedValues: {
      Denomination: "$1",
      Composition: "Silver",
      Fineness: "0.900",
    },
  },
  // Barber Half Dollars 1892-1915
  "11971": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "50C",
    },
    fixedValues: {
      Denomination: "50C",
      Composition: "Silver",
      Fineness: "0.900",
    },
  },
  // Liberty Walking Half Dollars 1916-1947
  "41099": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "50C",
    },
    fixedValues: {
      Denomination: "50C",
      Composition: "Silver",
      Fineness: "0.900",
    },
  },
  // Kennedy Half Dollars (1964-present) - Coins & Paper Money > US Coins
  "41102": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "50C",
    },
    fixedValues: { Denomination: "50C" },
  },
  // Franklin Half Dollars (1948-1963) - Coins & Paper Money > US Coins
  "11973": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Fineness",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "50C",
    },
    fixedValues: {
      Denomination: "50C",
      Composition: "Silver",
      Fineness: "0.900",
    },
  },
  // Wheat Penny (1909-1958) - Coins & Paper Money > US Coins
  "39455": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Composition",
      "Denomination",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "1C",
    },
    fixedValues: { Denomination: "1C", Composition: "Copper" },
  },
  // Indian Head Cent
  "41084": {
    required: ["Certification", "Circulated/Uncirculated", "Material"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "1C",
      Material: "Copper",
    },
    fixedValues: { Denomination: "1C", Material: "Copper" },
  },
  // Braided Hair Large Cent (1793-1857)
  "11950": {
    required: ["Certification", "Circulated/Uncirculated", "Material"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Denomination: "1C",
      Material: "Copper",
    },
    fixedValues: { Denomination: "1C", Material: "Copper" },
  },
  // American Silver Eagle
  "41111": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Strike Type", "Denomination"],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Uncirculated",
      Denomination: "$1",
    },
    fixedValues: {
      Denomination: "$1",
      Composition: "Silver",
      Fineness: "0.999",
    },
  },
  // Copper Rounds (non-legal-tender) - Coins & Paper Money > Bullion > Other Bullion
  "166679": {
    required: ["Certification", "Circulated/Uncirculated", "Type"],
    preferred: [
      "Year",
      "Composition",
      "Fineness",
      "Denomination",
      "Brand/Mint",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      Type: "Round",
    },
    fixedValues: { Composition: "Copper" },
  },
  // US Coin Proof Sets
  "41109": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Strike Type",
      "Country/Region of Manufacture",
    ],
    defaults: {
      Certification: "U.S. Mint",
      "Circulated/Uncirculated": "Uncirculated",
      "Strike Type": "Proof",
      "Country/Region of Manufacture": "United States",
    },
  },
  // US Coin Mint Sets (uncirculated)
  "526": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Country/Region of Manufacture"],
    defaults: {
      Certification: "U.S. Mint",
      "Circulated/Uncirculated": "Uncirculated",
      "Country/Region of Manufacture": "United States",
    },
  },
  // US Coins General (catch-all fallback for any US coin category)
  "253": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: [
      "Year",
      "Mint Location",
      "Denomination",
      "Strike Type",
      "Fineness",
    ],
    defaults: {
      Certification: "Uncertified",
      "Circulated/Uncirculated": "Unknown",
    },
  },
  // World Coins (general)
  "45243": {
    // "Department" is a REQUIRED item specific for Coins: World (errorId 25002
    // "The item specific Department is missing" on publishOffer). eBay's coin
    // taxonomy uses Department to split US vs World vs Ancient etc.; for the
    // 45243 (World) tree the valid value is "World Coins".
    required: ["Department"],
    preferred: [
      "Year",
      "Denomination",
      "Composition",
      "Circulated/Uncirculated",
      "Certification",
      "Grade",
      "KM Number",
      "Country of Origin",
      "Materials sourced from",
      "Color",
      "Fineness",
      "Strike Type",
    ],
    defaults: { Certification: "Uncertified", Department: "World Coins" },
  },
  // Coins: World (taxonomy parent 256) — same Department requirement as 45243.
  // NOTE: 256 is a non-leaf rollup (confirmed absent from ebay_taxonomy_cache,
  // Finding B) — kept here only in case a legacy/stale mapping still ships it;
  // new code should never assign 256 as a category.
  "256": {
    required: ["Department"],
    preferred: [
      "Year",
      "Denomination",
      "Composition",
      "Circulated/Uncirculated",
      "Certification",
      "Grade",
      "Country of Origin",
      "Materials sourced from",
      "Fineness",
    ],
    defaults: { Certification: "Uncertified", Department: "World Coins" },
  },
  // Coins: World > Other Coins of the World (257) — confirmed live LEAF, and
  // the graded-friendly catch-all analyze-item now routes to instead of the
  // non-leaf 45243/256 rollups. Same Department requirement as its siblings.
  "257": {
    required: ["Department"],
    preferred: [
      "Year",
      "Denomination",
      "Composition",
      "Circulated/Uncirculated",
      "Certification",
      "Grade",
      "Country of Origin",
      "Materials sourced from",
      "Fineness",
    ],
    defaults: { Certification: "Uncertified", Department: "World Coins" },
  },
  // Coins: World > South Pacific (Cook Islands, Fiji, Niue, Palau, Tuvalu, …).
  // Graded-friendly leaf; also requires Department = "World Coins".
  "3392": {
    required: ["Department"],
    preferred: [
      "Year",
      "Denomination",
      "Composition",
      "Circulated/Uncirculated",
      "Certification",
      "Grade",
      "Country of Origin",
      "Materials sourced from",
      "Fineness",
      "Strike Type",
    ],
    defaults: { Certification: "Uncertified", Department: "World Coins" },
  },
  // ── Collectibles / Toys / Trading Cards ──────────────────────────────────
  // Sports Trading Cards
  "261328": {
    required: ["Sport"],
    preferred: [
      "Player/Athlete",
      "Card Manufacturer",
      "Year",
      "Season",
      "Team",
      "Features",
      "Autographed",
      "Grade",
      "Professional Grader",
    ],
    defaults: { Sport: "Baseball" },
  },
  // Baseball Cards
  "64482": {
    required: ["Sport"],
    preferred: [
      "Player/Athlete",
      "Card Manufacturer",
      "Year",
      "Team",
      "Features",
      "Grade",
    ],
    defaults: { Sport: "Baseball" },
  },
  // Sports Cards General (parent)
  "213": {
    required: ["Sport"],
    preferred: ["Player/Athlete", "Card Manufacturer", "Year", "Team"],
    defaults: { Sport: "Baseball" },
  },
  // Pokémon Trading Card Games
  "183454": {
    required: [],
    preferred: [
      "Card Name",
      "Card Type",
      "Set",
      "Year",
      "Features",
      "Grade",
      "Professional Grader",
    ],
    defaults: {},
  },
  // Magic: The Gathering
  "2536": {
    required: [],
    preferred: ["Card Name", "Set", "Rarity", "Language", "Features"],
    defaults: {},
  },
  // Non-Sport Trading Cards
  "19107": {
    required: [],
    preferred: ["Card Manufacturer", "Year", "Set", "Features"],
    defaults: {},
  },
  // Beanie Babies
  "19203": {
    required: [],
    preferred: [
      "Character",
      "Brand",
      "Year Introduced",
      "Country/Region of Manufacture",
      "Features",
      "Animal",
    ],
    defaults: { Brand: "Ty" },
  },
  // Stuffed Animals & Plush
  "19209": {
    required: [],
    preferred: [
      "Character",
      "Brand",
      "Material",
      "Animal",
      "Features",
      "Country/Region of Manufacture",
    ],
    defaults: {},
  },
  // Funko Pop Vinyl Figures
  "261068": {
    required: [],
    preferred: [
      "Character",
      "Brand",
      "Franchise",
      "Year",
      "Features",
      "Number in Series",
    ],
    defaults: { Brand: "Funko" },
  },
  // Action Figures
  "246": {
    required: [],
    preferred: [
      "Character",
      "Brand",
      "Franchise",
      "Year",
      "Features",
      "Material",
    ],
    defaults: {},
  },
  // LEGO Sets
  "182": {
    required: [],
    preferred: [
      "Set Number",
      "Theme",
      "Year",
      "Brand",
      "Features",
      "Number of Pieces",
    ],
    defaults: { Brand: "LEGO" },
  },
  // Board Games
  "19016": {
    required: [],
    preferred: [
      "Title",
      "Brand",
      "Year",
      "Number of Players",
      "Age Range",
      "Features",
    ],
    defaults: {},
  },
};

// ================================================================
// VALID ASPECT VALUES
// ================================================================
export const VALID_ASPECT_VALUES: Record<string, Set<string>> = {
  Certification: CERTIFICATION_ASPECT_VALUES,
  "Circulated/Uncirculated": new Set(["Uncirculated", "Circulated", "Unknown"]),
  Shape: new Set(["Bar", "Round"]),
  "Strike Type": new Set([
    "Business",
    "Proof",
    "Proof-Like",
    "Deep Mirror Proof-Like",
    "Satin",
    "Matte",
  ]),
  Composition: new Set([
    "Gold",
    "Silver",
    "Platinum",
    "Palladium",
    "Bronze",
    "Copper",
    "Nickel",
    "Steel",
    "Zinc",
    "Brass",
    "Aluminum",
    "Bimetallic",
    "Copper-Nickel",
    "Copper Clad",
    "Zinc Plated Steel",
  ]),
  // Copper coin color designations (used in World Coins and US Copper coins)
  Color: new Set(["RD", "RB", "BN", "BM"]), // BM = Bi-Metallic
};

// ================================================================
// ASPECT NORMALISATION HELPERS
// ================================================================

export const ASPECT_SKIP_VALUES = new Set([
  "none",
  "unknown",
  "n/a",
  "other",
  "unspecified",
  "not applicable",
  "unknown/not applicable",
  "not specified",
  // "Ungraded" is not a valid Sheldon-scale grade — eBay treats any grade value on an
  // uncertified coin as a numerical-grade policy violation (errorId 25019).  Drop it.
  "ungraded",
]);

export function normalizeFineness(value: string): string {
  const v = value.trim();
  // Already correct format: 0.999, 0.9999, etc.
  if (/^0\.\d{2,5}$/.test(v)) return v;
  // Leading-dot format: .999, .99, .9 -> 0.999, 0.99, 0.9
  // But .9 is ambiguous; for common bullion coins, expand to .999 (99.9%)
  if (/^\.\d{1,5}$/.test(v)) {
    const normalized = "0" + v;
    // If single digit like .9, expand to .999 (common for ASE)
    if (v === ".9") return "0.999";
    return normalized;
  }
  // Pure integer: 999, 9999 -> 0.999, 0.9999
  if (/^\d{3,5}$/.test(v)) {
    const n = parseInt(v, 10);
    const decimals = v.length === 3 ? 3 : v.length === 4 ? 4 : 5;
    return (n / Math.pow(10, decimals)).toFixed(decimals);
  }
  // Percentage: 99.9% -> 0.999
  const pct = v.match(/^(\d+\.?\d*)\s*%$/);
  if (pct) return (parseFloat(pct[1]) / 100).toFixed(3);
  // Embedded decimal: "fine 0.999 silver" -> 0.999
  const dec = v.match(/\b(0\.\d{2,5})\b/);
  if (dec) return dec[1];
  // Embedded leading-dot: "fine .999 silver" -> 0.999
  const leadDot = v.match(/(?<!\d)\.(\d{1,5})\b/);
  if (leadDot) {
    const normalized = "0." + leadDot[1];
    if (leadDot[1] === "9") return "0.999";
    return normalized;
  }
  return v;
}

export function normalizeGrade(value: string): string {
  const v = value.trim();
  const withHyphen = v.match(/^(MS|PR|AU|XF|VF|F|VG|G|AG|FA|P)-?(\d+)$/i);
  if (withHyphen) return `${withHyphen[1].toUpperCase()} ${withHyphen[2]}`;
  const noSep = v.match(/^(MS|PR|AU|XF|VF|VG|AG|FA)([\s-]?)(\d+)$/i);
  if (noSep) return `${noSep[1].toUpperCase()} ${noSep[3]}`;
  return v;
}

export function normalizeDenomination(
  value: string,
  categoryId: string,
): string {
  const v = value.trim();
  const halfDollarCategories = new Set(["11971", "41099"]);
  const dollarCategories = new Set(["11981", "39464", "11980"]);
  if (halfDollarCategories.has(categoryId)) {
    if (/half.?dollar|50.?cent|\$0\.50|^0\.50$/i.test(v)) return "50C";
    if (v === "50C" || v === "50c") return "50C";
  }
  if (dollarCategories.has(categoryId)) {
    if (/one.?dollar|1.?dollar|\$1\.00|^1\.00$/i.test(v)) return "$1";
    if (v === "$1") return "$1";
  }
  return v;
}

export function normalizeCirculatedUncirculated(
  value: string | undefined,
  grade: string | undefined,
): string {
  if (value) {
    const v = value.trim();
    if (/^uncirculated$/i.test(v)) return "Uncirculated";
    if (/^circulated$/i.test(v)) return "Circulated";
    if (/^unknown$/i.test(v)) return "Unknown";
  }
  if (grade) {
    const g = grade.trim().toUpperCase();
    if (/^(MS|PR)\s*\d+/.test(g)) return "Uncirculated";
    if (/^(AU|XF|VF|F|VG|G|AG|FA|P)\s*\d+/.test(g)) return "Circulated";
  }
  return "Unknown";
}

// ----------------------------------------------------------------
// Normalize "Precious Metal Content per Unit" to eBay-accepted values.
// eBay category 39489 (Silver Bars & Rounds) and related bullion categories
// reject non-standard values like "0.1607 Troy oz" at publishOffer time
// with errorId 25604 "Product not found". The accepted values use:
//   - Grams: "1 g", "2 g", "5 g", "10 g", "20 g", "50 g", "100 g", "250 g", "1000 g"
//   - Fractions: "1/20 oz", "1/10 oz", "1/4 oz", "1/2 oz", "1 oz", "2 oz",
//                "5 oz", "10 oz", "1 kilo" (NO "Troy" in the value)
// Strategy:
//   1. Strip " Troy" from any value ("1 Troy oz" -> "1 oz")
//   2. Recognize common gram weights ("5g", "5 g", "5 grams")
//   3. Convert decimal oz to nearest matching fraction or gram equivalent
//      ("0.1607 Troy oz" -> 0.1607 oz -> 5.0g -> "5 g")
//   4. Map decimal fractions to fraction strings ("0.5 oz" -> "1/2 oz")
// ----------------------------------------------------------------
export function normalizePreciousMetalContent(value: string): string {
  const v = value.trim();

  // Already a valid eBay format -- return as-is
  const validFormats = new Set([
    "1/20 oz",
    "1/10 oz",
    "1/4 oz",
    "1/2 oz",
    "1 oz",
    "2 oz",
    "5 oz",
    "10 oz",
    "1 kilo",
    "1 g",
    "2 g",
    "2.5 g",
    "5 g",
    "10 g",
    "20 g",
    "25 g",
    "50 g",
    "100 g",
    "250 g",
    "500 g",
    "1000 g",
  ]);
  if (validFormats.has(v)) return v;

  // Step 1: Strip " Troy" (case-insensitive) -> normalize to plain oz
  // "1 Troy oz" -> "1 oz", "0.1607 Troy oz" -> "0.1607 oz"
  const stripped = v
    .replace(/\s*troy\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Step 2: Try to parse gram values
  // Matches: "5g", "5 g", "5 grams", "5.0g", "10 grams"
  const gramMatch = stripped.match(/^(\d+(?:\.\d+)?)\s*g(?:rams?)?$/i);
  if (gramMatch) {
    const grams = parseFloat(gramMatch[1]);
    const gramMap: [number, string][] = [
      [1, "1 g"],
      [2, "2 g"],
      [2.5, "2.5 g"],
      [5, "5 g"],
      [10, "10 g"],
      [20, "20 g"],
      [25, "25 g"],
      [50, "50 g"],
      [100, "100 g"],
      [250, "250 g"],
      [500, "500 g"],
      [1000, "1000 g"],
    ];
    for (const [target, label] of gramMap) {
      if (Math.abs(grams - target) / target < 0.02) return label;
    }
    return `${grams % 1 === 0 ? grams : grams} g`;
  }

  // Step 3: Parse oz values (after stripping Troy)
  // Matches: "1 oz", "1/4 oz", "0.5 oz", "0.1607 oz"
  const ozMatch = stripped.match(/^(\d+(?:[./]\d+)?)\s*oz$/i);
  if (ozMatch) {
    const ozStr = ozMatch[1];

    // Already a fraction string -- normalize
    const fractionMap: Record<string, string> = {
      "1/20": "1/20 oz",
      "1/10": "1/10 oz",
      "1/4": "1/4 oz",
      "1/2": "1/2 oz",
      "1": "1 oz",
      "2": "2 oz",
      "5": "5 oz",
      "10": "10 oz",
    };
    if (fractionMap[ozStr]) return fractionMap[ozStr];

    // Parse as decimal
    let ozVal: number;
    if (ozStr.includes("/")) {
      const [num, den] = ozStr.split("/").map(Number);
      ozVal = num / den;
    } else {
      ozVal = parseFloat(ozStr);
    }

    // For values like "0.1607 oz" (5g expressed in troy oz),
    // convert to grams first (1 troy oz = 31.1035g) and match gram denominations
    const gramsFromOz = ozVal * 31.1035;
    const gramMapOz: [number, string][] = [
      [1, "1 g"],
      [2, "2 g"],
      [2.5, "2.5 g"],
      [5, "5 g"],
      [10, "10 g"],
      [20, "20 g"],
      [25, "25 g"],
      [50, "50 g"],
      [100, "100 g"],
      [250, "250 g"],
      [500, "500 g"],
      [1000, "1000 g"],
    ];
    for (const [target, label] of gramMapOz) {
      if (Math.abs(gramsFromOz - target) / target < 0.03) return label;
    }

    // Map decimal oz values to eBay fraction strings
    const ozFractionMap: [number, string][] = [
      [0.05, "1/20 oz"],
      [0.1, "1/10 oz"],
      [0.25, "1/4 oz"],
      [0.5, "1/2 oz"],
      [1.0, "1 oz"],
      [2.0, "2 oz"],
      [5.0, "5 oz"],
      [10.0, "10 oz"],
      [32.15, "1 kilo"],
    ];
    for (const [target, label] of ozFractionMap) {
      if (Math.abs(ozVal - target) / target < 0.1) return label;
    }

    return `${ozVal} oz`;
  }

  // Step 4: Handle "1 kilo" variants
  if (
    /^1\s*kilo(?:gram)?$/i.test(stripped) ||
    /^1000\s*g(?:rams?)?$/i.test(stripped)
  ) {
    return "1 kilo";
  }

  // Fallback: return stripped value (removed "Troy" at minimum)
  return stripped;
}

export const ASPECT_KEY_ALIASES: Record<string, string> = {
  "Circulated/Uncirculated": "Circulated/Uncirculated",
  CirculatedUncirculated: "Circulated/Uncirculated",
  "Mint Location": "Mint Location",
  MintLocation: "Mint Location",
  "Strike Type": "Strike Type",
  StrikeType: "Strike Type",
  "KM Number": "KM Number",
  KMNumber: "KM Number",
  "Precious Metal Content per Unit": "Precious Metal Content per Unit",
  PreciousMetalContentperUnit: "Precious Metal Content per Unit",
  "Metal Content": "Precious Metal Content per Unit",
  "Brand/Mint": "Brand/Mint",
  "Manufacturer/Mint": "Brand/Mint",
  Fineness: "Fineness",
  Certification: "Certification",
  Denomination: "Denomination",
  Composition: "Composition",
  Year: "Year",
  Shape: "Shape",
  Grade: "Grade",
  Coin: "Coin",
  "Coin Type": "Coin",
  "Coin/Bullion Type": "Coin",
  "Country of Origin": "Country of Origin",
  "Country/Region of Manufacture": "Country of Origin",
  "Total Precious Metal Content": "Total Precious Metal Content",
  "Certification Number": "Certification Number",
  Variety: "Variety",
  Era: "Era",
  "Cleaned/Uncleaned": "Cleaned/Uncleaned",
  Provenance: "Provenance",
  // These were previously in NON_ASPECT_KEYS; now pass through as real eBay aspects:
  Type: "Type", // required by bullion categories (e.g. 261186 Silver Bullion Coins) — errorId 25002
  Color: "Color", // used by 45243 (World Coins) for copper/bronze coins
  "Materials sourced from": "Materials sourced from",
  Brand: "Brand", // required by 45243 (World Coins) — errorId 25002 when missing
  Department: "Department", // required by Coins: World (45243/256/3392) — errorId 25002 when missing
};

export const NON_ASPECT_KEYS = new Set([
  // "Type" removed — eBay bullion categories (e.g. 261068 Silver Bullion Coins) require
  // "Type" as a real aspect (errorId 25002 when missing).  It must pass through to the
  // Inventory API rather than being silently dropped.
  // "Color" removed — world coins category 45243 uses Color (RD/RB/BN) as a real eBay aspect.
  // "Brand" removed — world coins category 45243 requires Brand as a real eBay aspect (errorId 25002 when missing).
  "Material",
  "Size",
  "Mintage",
  "Series",
  "Modified Item",
  "Mint Mark",
]);

export function normalizeAspectKey(key: string): string {
  // eBay Inventory API expects BARE keys (Fineness, Grade, Year — NOT C:Fineness etc.)
  // The C: prefix is only used in eBay's Category Tree API taxonomy responses, never in payloads.
  // Strip any C: prefix the AI might have output, then resolve aliases to canonical bare names.
  const bare = key.startsWith("C:") ? key.slice(2) : key;
  if (NON_ASPECT_KEYS.has(bare)) return bare;
  if (ASPECT_KEY_ALIASES[bare]) return ASPECT_KEY_ALIASES[bare];
  return bare;
}

export function buildAndNormalizeAspects(
  rawSpecifics: Record<string, unknown>,
  categoryId: string,
): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const rule = CATEGORY_ASPECT_RULES[categoryId];

  for (const [rawKey, rawValue] of Object.entries(rawSpecifics)) {
    // Skip internal-only keys the frontend/backend attaches to itemSpecifics for
    // routing/condition logic (e.g. "_domain", "_coinConditionDetail",
    // "_domainMeta"). These are NOT real eBay aspects. If they leak into the
    // inventory item's product.aspects, eBay's Core Inventory Service rejects the
    // publish with HTTP 500 / errorId 25001 ("A system error has occurred. Core
    // Inventory Service internal error") — which is exactly what was blocking the
    // graded Cook Islands Barn Owl coin ("_domain":"coins_bullion" was being sent).
    if (rawKey.startsWith("_")) continue;
    if (!rawValue || typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;
    if (ASPECT_SKIP_VALUES.has(trimmed.toLowerCase())) continue;

    const key = normalizeAspectKey(rawKey);
    if (NON_ASPECT_KEYS.has(key)) continue; // skip internal-only keys
    if (key.startsWith("_")) continue; // belt-and-suspenders: never emit underscore aspects

    let value = trimmed;
    if (key === "Fineness") value = normalizeFineness(trimmed);
    else if (key === "Grade") value = normalizeGrade(trimmed);
    else if (key === "Denomination") {
      value = normalizeDenomination(trimmed, categoryId);
    } else if (key === "Precious Metal Content per Unit") {
      value = normalizePreciousMetalContent(trimmed);
    } else if (key === "Circulated/Uncirculated") {
      const gradeHint = (rawSpecifics["Grade"] as string) || undefined;
      value = normalizeCirculatedUncirculated(trimmed, gradeHint);
    }

    // eBay hard limit for Country of Origin is 65 characters.
    // Guard against AI hallucination where description text is placed in this field:
    // drop the value if it exceeds 65 chars OR contains sentence-like punctuation (periods, commas in long strings) that no valid country name would ever contain.
    if (key === "Country of Origin") {
      const looksLikeSentence = value.length > 65 ||
        /[.!?]/.test(value) ||
        (value.includes(",") && value.length > 40);
      if (looksLikeSentence) {
        console.warn(
          `buildAndNormalizeAspects: dropping Country of Origin — value looks like AI-generated text (${value.length} chars): "${
            value.slice(
              0,
              80,
            )
          }..."`,
        );
        continue;
      }
    }

    if (VALID_ASPECT_VALUES[key] && !VALID_ASPECT_VALUES[key].has(value)) {
      console.warn(
        `buildAndNormalizeAspects: invalid value "${value}" for ${key} — skipping`,
      );
      continue;
    }

    aspects[key] = [value];
  }

  // Apply fixed values ONLY for coin/bullion categories (deficiency #5 guard)
  // Strip "__dynamic_" prefix to get the real category ID for allowlist check
  const realCatId = categoryId.startsWith("__dynamic_") ? categoryId.slice(10) : categoryId;
  if (rule?.fixedValues && COIN_FIXED_VALUES_ALLOWED_IDS.has(realCatId)) {
    for (const [k, v] of Object.entries(rule.fixedValues)) {
      aspects[k] = [v];
    }
  } else if (rule?.fixedValues) {
    console.warn(
      `buildAndNormalizeAspects: skipping fixedValues for non-coin category ${realCatId}`,
    );
  }

  // ── Sport inference for trading card categories ─────────────────────────
  // If category is a sports card category and Sport is missing, infer from title/description
  const SPORT_CARD_CATS = new Set(["213", "261328", "64482"]);
  if (SPORT_CARD_CATS.has(realCatId) && !aspects["Sport"]) {
    // Try to infer sport from item title or existing aspects
    const textToSearch = (
      (aspects["Player/Athlete"]?.[0] || "") +
      " " +
      (aspects["Team"]?.[0] || "") +
      " " +
      (aspects["Card Manufacturer"]?.[0] || "")
    ).toLowerCase();

    if (/football|nfl|quarterback|touchdown|gridiron/i.test(textToSearch)) {
      aspects["Sport"] = ["Football"];
    } else if (/basketball|nba|hoops/i.test(textToSearch)) {
      aspects["Sport"] = ["Basketball"];
    } else if (/hockey|nhl|puck/i.test(textToSearch)) {
      aspects["Sport"] = ["Hockey"];
    } else if (/soccer|mls|fifa/i.test(textToSearch)) {
      aspects["Sport"] = ["Soccer"];
    } else if (/golf|pga/i.test(textToSearch)) {
      aspects["Sport"] = ["Golf"];
    } else if (/tennis/i.test(textToSearch)) {
      aspects["Sport"] = ["Tennis"];
    } else if (/boxing|mma|ufc/i.test(textToSearch)) {
      aspects["Sport"] = ["Boxing"];
    } else {
      // Default to Baseball for sports cards when sport cannot be inferred
      aspects["Sport"] = ["Baseball"];
    }
    console.log(
      `buildAndNormalizeAspects: inferred Sport="${aspects["Sport"][0]}" for category ${categoryId}`,
    );
  }

  // Fill required aspects with defaults if still missing
  if (rule) {
    if (
      rule.required.includes("Circulated/Uncirculated") &&
      !aspects["Circulated/Uncirculated"]
    ) {
      const grade = aspects["Grade"]?.[0];
      const circVal = normalizeCirculatedUncirculated(undefined, grade);
      aspects["Circulated/Uncirculated"] = [circVal];
      console.log(
        `buildAndNormalizeAspects: derived Circulated/Uncirculated="${circVal}" from grade="${grade}"`,
      );
    }
    for (const [k, v] of Object.entries(rule.defaults)) {
      if (!aspects[k]) {
        aspects[k] = [v];
        console.log(
          `buildAndNormalizeAspects: filled default ${k}="${v}" for category ${categoryId}`,
        );
      }
    }
  }

  // eBay errorId 25019: numerical/descriptive grades are ONLY allowed on certified coins.
  // If Certification is "Uncertified" (or absent), drop the Grade aspect entirely.
  // Sending any grade value on an uncertified coin triggers a policy violation.
  const certValue = aspects["Certification"]?.[0];

  // Normalize cert values that include the grader name plus extra text.
  // e.g. "ICG Genuine" -> "ICG", "NGC MS 65" -> "NGC", "PCGS AU-58" -> "PCGS"
  let normalizedCert = certValue;
  if (certValue && !CERTIFIED_GRADING_SERVICES.has(certValue)) {
    // Try to extract a known grader name from the beginning of the value
    for (const grader of CERTIFIED_GRADING_SERVICES) {
      if (certValue.toUpperCase().startsWith(grader)) {
        normalizedCert = grader;
        console.log(
          `buildAndNormalizeAspects: normalizing Certification "${certValue}" -> "${grader}"`,
        );
        aspects["Certification"] = [grader];
        break;
      }
    }
  }

  if (
    aspects["Grade"] &&
    (!normalizedCert || !CERTIFIED_GRADING_SERVICES.has(normalizedCert))
  ) {
    console.warn(
      `buildAndNormalizeAspects: dropping Grade="${aspects["Grade"][0]}" for category ${categoryId} ` +
        `because Certification="${certValue ?? "not set"}" is not a recognized grading service (eBay errorId 25019)`,
    );
    delete aspects["Grade"];
  }

  return aspects;
}

// ================================================================
// CONDITION ID MAPPING
// ================================================================
export const CONDITION_ID_MAP: Record<string, number> = {
  // Universal conditions
  NEW: 1000,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  LIKE_NEW: 2750,
  // Refurbished (electronics/appliances — NOT for coins)
  CERTIFIED_REFURBISHED: 2000,
  SELLER_REFURBISHED: 2500,
  // USED_* family — correct for Coins & Paper Money category tree
  USED_EXCELLENT: 3000, // AU-50 to XF-45
  USED_VERY_GOOD: 4000, // VF-20 to VF-35
  USED_GOOD: 5000, // F-12 to VG-10
  USED_ACCEPTABLE: 6000, // G-4 to G-6
  FOR_PARTS_OR_NOT_WORKING: 7000, // Damaged/holed/bent coins, junk
  // Trading card / collectible conditions (used by 261328, 183454, 19203, etc.)
  VERY_GOOD: 3000, // Trading cards: Very Good
  GOOD: 4000, // Trading cards: Good
  ACCEPTABLE: 5000, // Trading cards: Acceptable
  // Legacy *_REFURBISHED aliases — mapped to USED_* for coin categories
  EXCELLENT_REFURBISHED: 3000,
  VERY_GOOD_REFURBISHED: 4000,
  GOOD_REFURBISHED: 5000,
  // Legacy PRE_OWNED_* aliases — kept so old DB records can still publish
  PRE_OWNED_GOOD: 3000, // same as USED_EXCELLENT
  PRE_OWNED_FAIR: 5000, // same as USED_GOOD
  PRE_OWNED_POOR: 6000, // same as USED_ACCEPTABLE
};

export const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Uncirculated coin or brand new item in original packaging.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  LIKE_NEW: "Professionally graded and encapsulated coin.", // Used as conditionDescription for graded coins (LIKE_NEW = 2750 = Graded)
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  // USED_* — correct conditions for Coins & Paper Money category tree
  // NOTE: Do NOT include numerical grades (AU-50, MS-65, etc.) in descriptions unless coin is certified by NGC, PCGS, ANACS, ICG, CAC, ICCS, PMG, or Legacy Currency Grading
  USED_EXCELLENT: "Lightly circulated. Shows minimal wear on high points only.",
  USED_VERY_GOOD: "Moderately circulated. Major details clear with moderate wear.",
  USED_GOOD: "Heavily circulated. All major features visible but worn.",
  USED_ACCEPTABLE: "Heavily worn but identifiable. Outline and major features visible.",
  FOR_PARTS_OR_NOT_WORKING: "Damaged, holed, bent, or corroded. Not suitable for collecting.",
  // Trading card / collectible conditions
  VERY_GOOD: "Item in very good condition with minor wear.",
  GOOD: "Item in good condition with moderate wear.",
  ACCEPTABLE: "Item in acceptable condition with heavy wear but still functional.",
  // Legacy aliases — redirect to their USED_* equivalents
  EXCELLENT_REFURBISHED: "Lightly circulated. Shows minimal wear on high points only.",
  VERY_GOOD_REFURBISHED: "Moderately circulated. Major details clear with moderate wear.",
  GOOD_REFURBISHED: "Moderately circulated. Major details clear with moderate wear.",
  PRE_OWNED_GOOD: "Lightly circulated. Shows minimal wear on high points only.",
  PRE_OWNED_FAIR: "Heavily circulated. All major features visible but worn.",
  PRE_OWNED_POOR: "Heavily worn but identifiable. Outline and major features visible.",
  DIGITAL_GOOD: "Digital asset delivered electronically.",
  CERTIFIED_PRE_OWNED: "Certified pre-owned item meeting manufacturer or seller program standards.",
  REMANUFACTURED: "Properly rebuilt and restored to full working order.",
  RETREAD: "Used tire with professionally replaced tread.",
  DAMAGED: "Damaged item that may require repair or service.",
};

export const LEGACY_CONDITION_MAP: Record<string, string> = {
  // Migrate old *_REFURBISHED and PRE_OWNED_* values from DB to USED_* equivalents.
  // Users no longer select these from the UI — these only handle old stored records.
  EXCELLENT_REFURBISHED: "USED_EXCELLENT",
  VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
  GOOD_REFURBISHED: "USED_VERY_GOOD",
  PRE_OWNED_GOOD: "USED_EXCELLENT", // "good quality pre-owned" = lightly used, NOT numismatic "Good" (F-12)
  PRE_OWNED_FAIR: "USED_GOOD",
  PRE_OWNED_POOR: "USED_ACCEPTABLE",

  // Safety net: human-readable conditionDescription strings that eBay returns from
  // their category conditions API. If Gemini stores one of these in the draft instead
  // of the uppercase enum key, we map it back here.
  // Root cause: analyze-item was using c.conditionDescription ("New", "Used", etc.)
  // as the enum value in the Gemini prompt, causing errorId 2004 on publish.
  // Fixed in analyze-item (PR #221) but keeping these mappings as a permanent backstop.
  New: "NEW",
  "New other (see details)": "NEW_OTHER",
  "New with defects": "NEW_WITH_DEFECTS",
  "Certified refurbished": "CERTIFIED_REFURBISHED",
  "Seller refurbished": "SELLER_REFURBISHED",
  "Like New": "LIKE_NEW",
  Used: "USED_EXCELLENT",
  "Very Good": "USED_VERY_GOOD",
  Good: "USED_GOOD",
  Acceptable: "USED_ACCEPTABLE",
  "For parts or not working": "FOR_PARTS_OR_NOT_WORKING",
  // Also handle plain lowercase variants
  new: "NEW",
  used: "USED_EXCELLENT",
  "very good": "USED_VERY_GOOD",
  good: "USED_GOOD",
  acceptable: "USED_ACCEPTABLE",
  "like new": "LIKE_NEW",
  "Digital Good": "DIGITAL_GOOD",
  "digital good": "DIGITAL_GOOD",
  "Certified pre-owned": "CERTIFIED_PRE_OWNED",
  "certified pre-owned": "CERTIFIED_PRE_OWNED",
  Remanufactured: "REMANUFACTURED",
  remanufactured: "REMANUFACTURED",
  Retread: "RETREAD",
  retread: "RETREAD",
  Damaged: "DAMAGED",
  damaged: "DAMAGED",

  // eBay returns "Ungraded" / "Graded" as conditionDescription strings for some coin
  // categories (e.g. 3377 Coins: Canada, 3379, etc.). These are NOT valid Inventory API
  // condition enum values and will cause errorId 2004 "Could not serialize field [condition]".
  // Map to the closest valid USED_* coin condition.
  Ungraded: "USED_VERY_GOOD",
  ungraded: "USED_VERY_GOOD",
  UNGRADED: "USED_VERY_GOOD",
  Graded: "NEW",
  GRADED: "NEW",
};

// Condition normalization now uses both hardcoded fallback sets (from top of file)
// AND the dynamic detectCategoryTree function for breadcrumb-based detection.
// The sync version below uses hardcoded sets; the async caller can override via categoryTreeType.

export function normalizeConditionForCategory(
  rawCondition: string,
  categoryId: string | undefined,
  itemType: string | undefined = undefined,
  categoryTreeType: CategoryTreeType | undefined = undefined,
  /**
   * True when the coin/card is in a professional grading slab (NGC, PCGS, etc.).
   * For coins & trading cards eBay uses conditionId 2750 (LIKE_NEW = "Graded")
   * for slabbed items and 4000 (USED_VERY_GOOD = "Ungraded") for raw items.
   * Without this flag a graded PF/MS-70 coin was being force-mapped to
   * USED_VERY_GOOD ("Moderately circulated … moderate wear"), which eBay
   * rejects as an invalid condition for the category.
   */
  isGraded: boolean = false,
): { condition: string; corrected: boolean } {
  // Apply legacy migration first (case-insensitive using normalizeConditionDescriptorToEnum)
  const condition = normalizeConditionDescriptorToEnum(rawCondition);

  // Use provided tree type or fall back to hardcoded ID sets
  const resolvedCategoryTreeType = categoryTreeType || detectCategoryTreeSync(categoryId ?? "", itemType);

  const isCoin = resolvedCategoryTreeType === "coin";
  const isBullion = resolvedCategoryTreeType === "bullion";
  const isTradingCard = resolvedCategoryTreeType === "trading_card";
  const isCollectible = resolvedCategoryTreeType === "collectible";

  if (isCoin) {
    // eBay Inventory API for Coins & Paper Money:
    // LIKE_NEW (2750) = "Graded"   — professionally graded/slabbed coins (NGC, PCGS, etc.)
    // USED_VERY_GOOD (4000) = "Ungraded" — raw/circulated coins
    // Reference: https://developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html
    // "For trading cards or coins, the numeric identifier 2750 indicates that the item is graded."
    // "For trading cards or coins, the numeric identifier 4000 indicates that the item is ungraded."
    const validCoinConditions = new Set([
      "LIKE_NEW", // 2750 = Graded (NGC/PCGS/etc. slabbed coins)
      "USED_VERY_GOOD", // 4000 = Ungraded (raw/circulated coins)
      "FOR_PARTS_OR_NOT_WORKING", // 7000 = Damaged/holed/bent
    ]);

    // GRADED coins → LIKE_NEW (2750 = "Graded"). A slabbed NGC/PCGS coin must be
    // "Graded", never a circulated "USED_*" tier. This is the correct eBay
    // condition for certified coins and is what unblocks publish for e.g. a
    // PF 70 Ultra Cameo. (The old code force-downgraded every NEW coin to
    // USED_VERY_GOOD, which eBay rejects for graded pieces.)
    if (isGraded) {
      if (condition !== "LIKE_NEW") {
        console.log(
          `normalizeConditionForCategory: GRADED coin category ${categoryId} — ${condition} -> LIKE_NEW (2750 Graded)`,
        );
        return { condition: "LIKE_NEW", corrected: true };
      }
      return { condition: "LIKE_NEW", corrected: false };
    }

    if (!validCoinConditions.has(condition)) {
      // RAW/ungraded coins only. LIKE_NEW here would require Professional Grader
      // aspects, so ungraded coins map to USED_VERY_GOOD (4000 = "Ungraded").
      const fallbackMap: Record<string, string> = {
        NEW: "USED_VERY_GOOD",
        NEW_OTHER: "USED_VERY_GOOD",
        NEW_WITH_DEFECTS: "USED_VERY_GOOD",
        CERTIFIED_REFURBISHED: "LIKE_NEW",
        SELLER_REFURBISHED: "USED_VERY_GOOD",
        EXCELLENT_REFURBISHED: "LIKE_NEW",
        VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
        GOOD_REFURBISHED: "USED_VERY_GOOD",
        PRE_OWNED_GOOD: "USED_VERY_GOOD",
        PRE_OWNED_FAIR: "USED_VERY_GOOD",
        PRE_OWNED_POOR: "USED_VERY_GOOD",
        USED_EXCELLENT: "USED_VERY_GOOD",
        USED_GOOD: "USED_VERY_GOOD",
        USED_ACCEPTABLE: "USED_VERY_GOOD",
        GOOD: "USED_VERY_GOOD",
        ACCEPTABLE: "USED_VERY_GOOD",
      };
      const mapped = fallbackMap[condition] ?? "USED_VERY_GOOD";
      console.log(
        `normalizeConditionForCategory: coin category ${categoryId} — ${condition} -> ${mapped}`,
      );
      return { condition: mapped, corrected: true };
    }
  } else if (isBullion) {
    // Bullion: allow everything except LIKE_NEW
    if (condition === "LIKE_NEW") {
      console.log(
        `normalizeConditionForCategory: bullion category ${categoryId} — LIKE_NEW -> NEW`,
      );
      return { condition: "NEW", corrected: true };
    }
  } else if (isTradingCard) {
    // Trading cards: use standard eBay Inventory API ConditionEnum strings.
    // Note: VERY_GOOD/GOOD/ACCEPTABLE are condition IDs 3000/5000/6000 for trading
    // cards, but the Inventory API's ConditionEnum type only accepts USED_* and
    // LIKE_NEW strings — sending "VERY_GOOD" causes errorId 2004 "Could not
    // serialize field [condition]". Keep USED_* here; eBay resolves the display
    // label ("Very Good", "Good", etc.) from the category + enum combination.
    const validCardConditions = new Set([
      // LIKE_NEW removed: conditionId 2750 = Graded — requires Professional Grader
      // (27501) and Grade item specifics (errorId 25064). Only allow ungraded.
      "USED_VERY_GOOD",
      "USED_GOOD",
      "USED_ACCEPTABLE",
    ]);
    if (!validCardConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        NEW: "USED_VERY_GOOD", // graded->ungraded downgrade; LIKE_NEW requires Professional Grader
        NEW_OTHER: "USED_VERY_GOOD",
        NEW_WITH_DEFECTS: "USED_GOOD",
        VERY_GOOD: "USED_VERY_GOOD", // legacy / already-remapped values
        GOOD: "USED_GOOD",
        ACCEPTABLE: "USED_ACCEPTABLE",
        LIKE_NEW: "USED_VERY_GOOD", // graded->ungraded; avoids Professional Grader error
        USED_EXCELLENT: "USED_VERY_GOOD", // LIKE_NEW requires grader aspects; cap at USED_VERY_GOOD
        USED_VERY_GOOD: "USED_VERY_GOOD",
        USED_GOOD: "USED_GOOD",
        USED_ACCEPTABLE: "USED_ACCEPTABLE",
        PRE_OWNED_GOOD: "USED_GOOD",
        PRE_OWNED_FAIR: "USED_ACCEPTABLE",
        PRE_OWNED_POOR: "USED_ACCEPTABLE",
        SELLER_REFURBISHED: "USED_GOOD",
        FOR_PARTS_OR_NOT_WORKING: "USED_ACCEPTABLE",
      };
      const mapped = fallbackMap[condition] ?? "USED_VERY_GOOD";
      console.log(
        `normalizeConditionForCategory: trading card category ${categoryId} — ${condition} -> ${mapped}`,
      );
      return { condition: mapped, corrected: true };
    }
  } else if (isCollectible) {
    // Collectibles/toys/plush: map any non-standard conditions to valid eBay set
    const validCollectibleConditions = new Set([
      "NEW",
      "LIKE_NEW",
      "USED_VERY_GOOD",
      "USED_GOOD",
      "USED_ACCEPTABLE",
    ]);
    if (!validCollectibleConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        NEW_OTHER: "NEW",
        NEW_WITH_DEFECTS: "USED_GOOD",
        VERY_GOOD: "USED_VERY_GOOD", // legacy / already-remapped values
        GOOD: "USED_GOOD",
        ACCEPTABLE: "USED_ACCEPTABLE",
        USED_EXCELLENT: "LIKE_NEW",
        USED_VERY_GOOD: "USED_VERY_GOOD",
        USED_GOOD: "USED_GOOD",
        USED_ACCEPTABLE: "USED_ACCEPTABLE",
        PRE_OWNED_GOOD: "USED_GOOD",
        PRE_OWNED_FAIR: "USED_ACCEPTABLE",
        PRE_OWNED_POOR: "USED_ACCEPTABLE",
        SELLER_REFURBISHED: "USED_GOOD",
        FOR_PARTS_OR_NOT_WORKING: "USED_ACCEPTABLE",
      };
      const mapped = fallbackMap[condition] ?? "USED_GOOD";
      console.log(
        `normalizeConditionForCategory: collectible category ${categoryId} — ${condition} -> ${mapped}`,
      );
      return { condition: mapped, corrected: true };
    }
  }

  return { condition, corrected: false };
}

// Synchronous category tree detection using hardcoded ID sets + item type hints
// Used by normalizeConditionForCategory when async breadcrumb detection isn't available
export function detectCategoryTreeSync(
  categoryId: string,
  itemType: string | undefined,
): CategoryTreeType {
  if (HARDCODED_BULLION_CATEGORY_IDS.has(categoryId)) return "bullion";
  if (HARDCODED_COIN_CATEGORY_IDS.has(categoryId)) return "coin";
  if (HARDCODED_TRADING_CARD_CATEGORY_IDS.has(categoryId)) {
    return "trading_card";
  }
  if (HARDCODED_COLLECTIBLE_CATEGORY_IDS.has(categoryId)) return "collectible";

  // 2026-09-01: removed a broad `/^261[0-9]{3}$/` catch-all that used to sit
  // here and classify ANY category ID in the entire 261000-261076 range as
  // bullion — a strictly more dangerous, open-ended version of the exact
  // wrong-domain bug just fixed above (that range also contains, e.g., Toys
  // & Hobbies > Action Figures leaves). Every confirmed-bullion ID in that
  // range is now explicit in HARDCODED_BULLION_CATEGORY_IDS above, which is
  // checked first in this function; an unknown ID in the range now correctly
  // falls through to the item-type text hints below instead of being
  // silently assumed bullion.

  // Item type text hints as last resort
  if (itemType) {
    const lower = itemType.toLowerCase();
    if (/coin/i.test(lower)) return "coin";
    if (/round|bar|ingot|wafer/i.test(lower)) return "bullion";
    if (/trading.?card|pokemon|baseball.?card|sports.?card/i.test(lower)) {
      return "trading_card";
    }
    if (/beanie|plush|funko|action.?figure|lego/i.test(lower)) {
      return "collectible";
    }
  }

  return "other";
}

// ----------------------------------------------------------------
// Listing duration constants
// GTC = "Good 'Til Cancelled" — required for FIXED_PRICE listings
// Auctions must use a specific day count: 1, 3, 5, 7, or 10
// ----------------------------------------------------------------
export const FIXED_PRICE_DURATION = "GTC";
export const DEFAULT_AUCTION_DURATION = "Days_7";
export const VALID_AUCTION_DURATIONS = [
  "Days_1",
  "Days_3",
  "Days_5",
  "Days_7",
  "Days_10",
];

// ----------------------------------------------------------------
// fetchWithTimeout is imported from ./fetch.ts
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Sanitize listing description to remove patterns eBay rejects (errorId 25002)
// eBay blocks: javascript, .cookie, cookie(, replace(, IFRAME, META, base href, includes
// The word "includes" in plain English text (e.g., "This lot includes...") falsely
// triggers eBay's JS injection filter. Replace with safe synonyms.
// ----------------------------------------------------------------
export function sanitizeDescription(desc: string): string {
  if (!desc) return desc;

  let result = desc;

  // Replace plain-English "includes" / "include" with safe synonyms
  // Only replace when used as an English word (not inside HTML attributes or JS)
  result = result.replace(/\bincludes\b/gi, "contains");
  result = result.replace(/\binclude\b/gi, "contain");
  result = result.replace(/\bincluded\b/gi, "contained");
  result = result.replace(/\bincluding\b/gi, "containing");

  // Strip any IFRAME tags
  result = result.replace(/<iframe[^>]*>.*?<\/iframe>/gis, "");
  result = result.replace(/<iframe[^>]*\/>/gis, "");

  // Strip META tags
  result = result.replace(/<meta[^>]*>/gis, "");

  // Strip base href tags
  result = result.replace(/<base[^>]*>/gis, "");

  // Strip inline JS event handlers (onclick=, onload=, etc.)
  result = result.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");

  // Strip script tags
  result = result.replace(/<script[^>]*>.*?<\/script>/gis, "");

  // Strip .cookie and cookie( references
  result = result.replace(/\.cookie\b/gi, "");
  result = result.replace(/\bcookie\s*\(/gi, "");

  // Strip replace( references (JS method)
  result = result.replace(/\breplace\s*\(/gi, "");

  return result;
}

// ----------------------------------------------------------------
// Convert markdown formatting to HTML for eBay listings.
// eBay's listingDescription field expects HTML, but AI generates markdown.
// This converts: **bold** → <b>bold</b>, *italic* → <i>italic</i>,
// line breaks → <br>, bullet points → <ul><li>, etc.
// ----------------------------------------------------------------
export function markdownToHtml(markdown: string): string {
  if (!markdown) return markdown;

  let html = markdown;

  // Don't double-convert - if it already looks like HTML, return as-is
  if (/<[a-z][\s\S]*>/i.test(html)) {
    return html;
  }

  // Pre-process: Convert inline " - " bullets to separate lines
  // Handles cases like "- Year: 2026 - Mint: West Point - Grade: MS 70"
  // Pattern: " - Label:" should become "\n- Label:"
  const bulletLabels = [
    "Year:",
    "Mint:",
    "Grade:",
    "Certification Number:",
    "Metal Content:",
    "Condition:",
    "Historical Note:",
  ];
  const labelPattern = bulletLabels.join("|");
  // Replace " - Label:" with "\n- Label:" when not at start of line
  html = html.replace(
    new RegExp(`(?!^|\n)(\\s*-\\s*)(${labelPattern})`, "g"),
    "\n- $2",
  );

  // Convert headers (### ## #)
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Convert bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  html = html.replace(/__(.+?)__/g, "<b>$1</b>");

  // Convert italic (*text* or _text_) - but avoid matching within words
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

  // Convert bullet points (- item or * item)
  // First, group consecutive bullet lines into <ul> blocks
  const bulletLines: string[] = [];
  const lines = html.split("\n");
  let inBulletList = false;
  const processedLines: string[] = [];

  for (const line of lines) {
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (!inBulletList) {
        processedLines.push("<ul>");
        inBulletList = true;
      }
      processedLines.push(`<li>${bulletMatch[2]}</li>`);
    } else {
      if (inBulletList) {
        processedLines.push("</ul>");
        inBulletList = false;
      }
      processedLines.push(line);
    }
  }
  if (inBulletList) {
    processedLines.push("</ul>");
  }
  html = processedLines.join("\n");

  // Convert numbered lists (1. item, 2. item, etc.)
  const numberedLines: string[] = [];
  const htmlLines = html.split("\n");
  let inNumberedList = false;
  const processedNumberedLines: string[] = [];

  for (const line of htmlLines) {
    const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (numberedMatch) {
      if (!inNumberedList) {
        processedNumberedLines.push("<ol>");
        inNumberedList = true;
      }
      processedNumberedLines.push(`<li>${numberedMatch[2]}</li>`);
    } else {
      if (inNumberedList) {
        processedNumberedLines.push("</ol>");
        inNumberedList = false;
      }
      processedNumberedLines.push(line);
    }
  }
  if (inNumberedList) {
    processedNumberedLines.push("</ol>");
  }
  html = processedNumberedLines.join("\n");

  // Convert line breaks: double newline -> paragraph, single newline -> <br>
  // First, wrap paragraphs (blocks of text separated by blank lines)
  html = html.replace(/\n\n+/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");

  // Wrap in paragraph tags if not already wrapped
  if (!html.startsWith("<")) {
    html = "<p>" + html + "</p>";
  }

  // Clean up empty paragraphs and extra breaks
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>\s*<br>/g, "<p>");
  html = html.replace(/<br>\s*<\/p>/g, "</p>");
  html = html.replace(/<br>\s*<br>/g, "<br>");

  return html;
}

// ----------------------------------------------------------------
// Strip numerical coin grades (e.g. MS-65, AU-58, VF-30) from text
// when the coin is NOT certified by an approved grading service.
// eBay errorId 25019: grades in title/description of uncertified coins
// trigger a policy violation even if the Grade aspect was already dropped.
// ----------------------------------------------------------------
export const GRADE_PATTERN = /\b(MS|PR|PF|AU|XF|EF|VF|F|VG|G|AG|FA|PO|P)-?\s*(\d{1,2})\b/gi;
export function stripGradesIfUncertified(
  text: string,
  certificationValue: string | undefined,
): string {
  if (!text) return text;
  // If certified by an approved grader, grades are allowed — don't strip
  if (
    certificationValue &&
    CERTIFIED_GRADING_SERVICES.has(certificationValue)
  ) {
    return text;
  }
  // Strip grade patterns from text (replace with empty string)
  const stripped = text
    .replace(GRADE_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (stripped !== text) {
    console.log(
      `stripGradesIfUncertified: removed grade pattern(s) from text (cert="${certificationValue ?? "none"}")`,
    );
  }
  return stripped;
}

// ----------------------------------------------------------------
// Build a fixed-price offer payload
// ----------------------------------------------------------------
export function buildFixedPriceOffer(params: {
  sku: string;
  description: string;
  listingPrice: number;
  quantity?: number;
  condition: string;
  conditionDescription: string;
  ebayCategoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId?: string | null; // Optional: managed payments sellers don't need this
  returnPolicyId: string;
  bestOfferEnabled?: boolean;
  bestOfferAutoAcceptPrice?: number;
  bestOfferAutoDeclinePrice?: number;
}): Record<string, unknown> {
  // Build listingPolicies — paymentPolicyId is omitted for managed payments sellers
  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: params.fulfillmentPolicyId,
    returnPolicyId: params.returnPolicyId,
  };
  if (params.paymentPolicyId) {
    listingPolicies.paymentPolicyId = params.paymentPolicyId;
  }

  // Best Offer — only added for fixed-price listings when enabled
  if (params.bestOfferEnabled) {
    const bestOfferTerms: Record<string, unknown> = {
      bestOfferEnabled: true,
    };
    if (
      params.bestOfferAutoAcceptPrice &&
      params.bestOfferAutoAcceptPrice > 0
    ) {
      bestOfferTerms.autoAcceptPrice = {
        value: params.bestOfferAutoAcceptPrice.toFixed(2),
        currency: "USD",
      };
    }
    if (
      params.bestOfferAutoDeclinePrice &&
      params.bestOfferAutoDeclinePrice > 0
    ) {
      bestOfferTerms.autoDeclinePrice = {
        value: params.bestOfferAutoDeclinePrice.toFixed(2),
        currency: "USD",
      };
    }
    listingPolicies.bestOfferTerms = bestOfferTerms;
  }

  const offer: Record<string, unknown> = {
    sku: params.sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    listingDescription: params.description,
    availableQuantity: params.quantity && params.quantity > 1 ? params.quantity : 1,
    listingDuration: FIXED_PRICE_DURATION,
    merchantLocationKey: params.merchantLocationKey,
    pricingSummary: {
      price: {
        value: params.listingPrice.toFixed(2),
        currency: "USD",
      },
    },
    listingPolicies,
    condition: params.condition,
    conditionDescription: params.conditionDescription,
  };
  if (params.ebayCategoryId) {
    offer.categoryId = params.ebayCategoryId;
  }
  return offer;
}

// ----------------------------------------------------------------
// Build an auction offer payload
// Auctions have different required fields and constraints vs fixed price.
// ----------------------------------------------------------------
export function buildAuctionOffer(params: {
  sku: string;
  description: string;
  auctionStartPrice: number;
  auctionBuyItNow?: number;
  auctionDuration: string;
  condition: string;
  conditionDescription: string;
  ebayCategoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId?: string | null; // Optional: managed payments sellers don't need this
  returnPolicyId: string;
}): Record<string, unknown> {
  // Validate auction duration
  const duration = VALID_AUCTION_DURATIONS.includes(params.auctionDuration)
    ? params.auctionDuration
    : DEFAULT_AUCTION_DURATION;

  const pricingSummary: Record<string, unknown> = {
    auctionStartPrice: {
      value: params.auctionStartPrice.toFixed(2),
      currency: "USD",
    },
  };

  // Buy It Now price must be at least 30% above starting bid per eBay rules
  if (params.auctionBuyItNow && params.auctionBuyItNow > 0) {
    const minBuyItNow = params.auctionStartPrice * 1.3;
    if (params.auctionBuyItNow >= minBuyItNow) {
      pricingSummary.price = {
        value: params.auctionBuyItNow.toFixed(2),
        currency: "USD",
      };
    } else {
      console.warn(
        `Auction BIN price ${params.auctionBuyItNow} is less than 30% above start price ${params.auctionStartPrice}. Omitting BIN.`,
      );
    }
  }

  const offer: Record<string, unknown> = {
    sku: params.sku,
    marketplaceId: "EBAY_US",
    format: "AUCTION",
    listingDescription: params.description,
    availableQuantity: 1,
    listingDuration: duration,
    merchantLocationKey: params.merchantLocationKey,
    pricingSummary,
    listingPolicies: (() => {
      const policies: Record<string, string> = {
        fulfillmentPolicyId: params.fulfillmentPolicyId,
        returnPolicyId: params.returnPolicyId,
      };
      if (params.paymentPolicyId) {
        policies.paymentPolicyId = params.paymentPolicyId;
      }
      return policies;
    })(),
    condition: params.condition,
    conditionDescription: params.conditionDescription,
  };
  if (params.ebayCategoryId) {
    offer.categoryId = params.ebayCategoryId;
  }
  return offer;
}

// ----------------------------------------------------------------
// Upload a base64 data URL image to Supabase Storage from within the edge function.
// Returns the public HTTPS URL on success, or the original value on failure.
// eBay's Inventory API rejects data: URLs (errorId 25721) — all images must be
// real publicly-accessible HTTPS URLs before they're sent to eBay.
// ----------------------------------------------------------------
export async function uploadDataUrlToStorage(dataUrl: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn(
      "uploadDataUrlToStorage: missing Supabase env vars — skipping upload",
    );
    return dataUrl;
  }

  try {
    // Parse the MIME type and base64 payload
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!matches) {
      console.warn("uploadDataUrlToStorage: unrecognised data URL format");
      return dataUrl;
    }
    const [, mime, b64] = matches;
    const ext = mime.includes("png") ? "png" : "jpg";

    // Decode base64 to binary using Deno's base64 decoder
    const bytes = decodeBase64(b64);

    const filename = `server-uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Use supabase-js client so auth headers are handled correctly
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { error: uploadError } = await adminClient.storage
      .from("listing-images")
      .upload(filename, bytes, { contentType: mime, upsert: false });

    if (uploadError) {
      console.error(
        "uploadDataUrlToStorage: upload failed:",
        uploadError.message,
      );
      return dataUrl;
    }

    const { data: urlData } = adminClient.storage
      .from("listing-images")
      .getPublicUrl(filename);

    console.log(`uploadDataUrlToStorage: uploaded to ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (err) {
    console.error("uploadDataUrlToStorage: unexpected error:", err);
    return dataUrl;
  }
}

// ----------------------------------------------------------------
// Ensure an eBay inventory location exists for the seller.
// POST creates it; if it already exists (409/errorId 25803), DELETE and re-create
// to guarantee the address (postalCode/city) is current — eBay PATCH silently ignores
// address fields so DELETE+re-create is the only reliable way to update them.
// If DELETE is blocked (location has active items), fall back to a postal-code-keyed location.
// Returns the merchantLocationKey on success.
// ----------------------------------------------------------------
export async function ensureInventoryLocation(
  apiBase: string,
  userToken: string,
  postalCode: string,
  city = "",
  country = "US",
): Promise<string> {
  const merchantLocationKey = "default-location";

  const locationBody = {
    location: {
      address: {
        ...(city ? { city } : {}),
        postalCode,
        country,
      },
    },
    locationEnabled: true,
    name: "Default Seller Location",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };

  console.log(
    `ensureInventoryLocation: attempting to create/update location "${merchantLocationKey}" with address:`,
    locationBody.location.address,
  );

  const resp = await fetchWithTimeout(
    `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        // Accept-Language must be explicitly set to "en-US".
        // Deno's runtime auto-injects the system locale when omitted,
        // sending an invalid value that eBay rejects with errorId 25709.
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(locationBody),
      timeout: 15000,
    },
  );

  // 204 = created successfully.
  if (resp.ok) {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" created successfully (status ${resp.status})`,
    );
    return merchantLocationKey;
  }

  // Location already exists — eBay PATCH does NOT update address fields (postalCode/city are
  // immutable via PATCH; only metadata like name/phone/hours can change).
  // The correct approach is DELETE then re-create so the address is definitely current.
  const errText = await resp.text();
  let alreadyExists = false;

  try {
    const errJson = JSON.parse(errText);
    alreadyExists = Array.isArray(errJson.errors) &&
      errJson.errors.some((e: { errorId: number }) => e.errorId === 25803);
  } catch {
    /* not JSON */
  }

  if (resp.status === 409 || alreadyExists) {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" already exists — attempting DELETE + re-create to update address (PATCH silently ignores address fields)`,
    );

    // Step 1: DELETE the existing location so we can re-create it with the correct address.
    const deleteResp = await fetchWithTimeout(
      `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Accept-Language": "en-US",
        },
        timeout: 15000,
      },
    );

    if (deleteResp.ok || deleteResp.status === 204) {
      console.log(
        `ensureInventoryLocation: deleted "${merchantLocationKey}" — re-creating with postal code ${postalCode}`,
      );
      const reCreateResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "Content-Language": "en-US",
            "Accept-Language": "en-US",
          },
          body: JSON.stringify(locationBody),
          timeout: 15000,
        },
      );
      if (reCreateResp.ok) {
        console.log(
          `ensureInventoryLocation: location "${merchantLocationKey}" re-created with postal code ${postalCode} successfully`,
        );
        return merchantLocationKey;
      }
      const reCreateErrText = await reCreateResp.text();
      console.error(
        `ensureInventoryLocation: re-create failed after DELETE (${reCreateResp.status}): ${reCreateErrText}`,
      );
      // Fall through to postal-code-based fallback key.
    } else {
      const deleteErrText = await deleteResp.text();
      console.warn(
        `ensureInventoryLocation: DELETE failed (${deleteResp.status}): ${deleteErrText}. Location may have active items assigned. Falling back to postal-code-keyed location.`,
      );
    }

    // Step 2 (fallback): Use a location key derived from the postal code so new listings
    // always get a location with the correct address even if the default key can't be updated.
    const fallbackKey = `loc-${postalCode.replace(/[^a-zA-Z0-9]/g, "")}`;
    console.log(
      `ensureInventoryLocation: creating postal-code-keyed location "${fallbackKey}" as fallback`,
    );
    const fallbackResp = await fetchWithTimeout(
      `${apiBase}/sell/inventory/v1/location/${fallbackKey}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify(locationBody),
        timeout: 15000,
      },
    );

    if (fallbackResp.ok) {
      console.log(
        `ensureInventoryLocation: fallback location "${fallbackKey}" created with postal code ${postalCode}`,
      );
      return fallbackKey;
    }

    const fallbackErrText = await fallbackResp.text();
    let fallbackAlreadyExists = false;
    try {
      const fallbackErrJson = JSON.parse(fallbackErrText);
      fallbackAlreadyExists = Array.isArray(fallbackErrJson.errors) &&
        fallbackErrJson.errors.some(
          (e: { errorId: number }) => e.errorId === 25803,
        );
    } catch {
      /* not JSON */
    }

    if (fallbackResp.status === 409 || fallbackAlreadyExists) {
      // This postal code was used before — the location already exists with the right address.
      console.log(
        `ensureInventoryLocation: fallback location "${fallbackKey}" already exists with correct postal code — using it`,
      );
      return fallbackKey;
    }

    // All attempts exhausted — proceed with whatever key eBay has on file.
    console.error(
      `ensureInventoryLocation: all location update attempts failed. Using "${merchantLocationKey}" with potentially stale address. Last error: ${fallbackResp.status}: ${fallbackErrText}`,
    );
    return merchantLocationKey;
  }

  // Genuine error — not an "already exists" case.
  console.error(
    `ensureInventoryLocation: unexpected error ${resp.status}: ${errText}`,
  );
  throw new Error(
    `Failed to ensure inventory location: ${resp.status} - ${errText}`,
  );
}

// ================================================================
// COIN CONDITION DESCRIPTORS (eBay June 2026 mandate)
// ================================================================
// eBay Inventory API v1.18.5 added conditionDescriptors support for:
//   253 - Coins: US, 256 - Coins: World, 3377 - Coins: Canada,
//   4733 - Coins: Ancient, 18466 - Coins: Medieval
// (and all leaf categories beneath them)
//
// conditionDescriptors format:
//   { name: "<numericDescriptorId>", values: ["<numericValueId>"], additionalInfo?: "<certNum>" }
//
// Descriptor IDs and value IDs are fetched at runtime from eBay's
// getItemConditionPolicies Metadata API (app token; cached per invocation).
// ================================================================

/** Top-level coin parent category IDs that require conditionDescriptors */
export const COIN_CONDITION_DESCRIPTOR_PARENT_IDS = new Set([
  "253", // Coins: US
  "256", // Coins: World
  "3377", // Coins: Canada
  "4733", // Coins: Ancient
  "18466", // Coins: Medieval
]);

/** In-memory per-invocation cache for coin condition descriptor lookup results */
export const _coinDescriptorCache: Map<
  string,
  Array<{
    descriptorId: string;
    descriptorName: string;
    values: Array<{ id: string; name: string }>;
  }>
> = new Map();

/**
 * Fetches coin condition descriptor IDs for a given leaf category from eBay's
 * getItemConditionPolicies Metadata API. Returns an array of descriptor objects
 * with their IDs and possible values, or null if the fetch fails.
 *
 * Uses an app-level OAuth token (client_credentials grant).
 * Results are cached in-memory for the current function invocation.
 *
 * Robust error handling with detailed logging for debugging API failures.
 */
export async function fetchCoinConditionDescriptors(
  categoryId: string,
  clientId: string,
  clientSecret: string,
  apiBase: string,
): Promise<
  Array<{
    descriptorId: string;
    descriptorName: string;
    values: Array<{ id: string; name: string }>;
    mode?: string; // "FREE_TEXT" for certification number
  }> | null
> {
  const cacheKey = `${apiBase}:${categoryId}`;
  if (_coinDescriptorCache.has(cacheKey)) {
    console.log(`fetchCoinConditionDescriptors: cache hit for ${categoryId}`);
    return _coinDescriptorCache.get(cacheKey)!;
  }

  console.log(
    `fetchCoinConditionDescriptors: cache miss for ${categoryId} — fetching from eBay Metadata API`,
  );

  try {
    // Step 1: Get app token for Metadata API
    const tokenUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";
    const credentials = btoa(`${clientId}:${clientSecret}`);

    console.log(
      `fetchCoinConditionDescriptors: requesting app token from ${tokenUrl}`,
    );
    const tokenResp = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      timeout: 8000,
    });

    if (!tokenResp.ok) {
      const tokenErrText = await tokenResp.text();
      console.error(
        `fetchCoinConditionDescriptors: app token request FAILED (${tokenResp.status}): ${tokenErrText.slice(0, 200)}`,
      );
      return null;
    }

    let tokenData;
    try {
      tokenData = await tokenResp.json();
    } catch (parseErr) {
      console.error(
        `fetchCoinConditionDescriptors: failed to parse token response:`,
        parseErr,
      );
      return null;
    }

    const appToken = tokenData?.access_token;
    if (!appToken) {
      console.error(
        `fetchCoinConditionDescriptors: app token response missing access_token. Response:`,
        tokenData,
      );
      return null;
    }

    // Step 2: Call Metadata API for this category
    const metaBase = apiBase.includes("sandbox") ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
    const encodedFilter = encodeURIComponent(`categoryIds:{${categoryId}}`);
    const metaUrl =
      `${metaBase}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodedFilter}`;

    console.log(
      `fetchCoinConditionDescriptors: requesting condition policies from ${metaUrl.replace(encodedFilter, "...")}`,
    );
    const metaResp = await fetchWithTimeout(metaUrl, {
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Accept-Language": "en-US",
      },
      timeout: 10000,
    });

    if (!metaResp.ok) {
      const metaErrText = await metaResp.text();
      console.error(
        `fetchCoinConditionDescriptors: Metadata API request FAILED (${metaResp.status}) for category ${categoryId}: ${
          metaErrText.slice(
            0,
            300,
          )
        }`,
      );
      return null;
    }

    // Read the body as text first. Some categories (e.g. 45243 "Coins: World")
    // legitimately return HTTP 200 with an EMPTY body, which means "no condition
    // policies for this category". Calling metaResp.json() directly on an empty
    // body throws `SyntaxError: Unexpected end of JSON input`, which previously
    // surfaced as a scary console.error even though it is an expected,
    // non-fatal outcome. Guard for that explicitly and treat it as info-level.
    const metaBodyText = await metaResp.text();
    if (!metaBodyText || metaBodyText.trim() === "") {
      console.log(
        `fetchCoinConditionDescriptors: Metadata API returned an empty body for category ${categoryId} — no condition policies available (this is expected for some categories).`,
      );
      return null;
    }

    let metaData;
    try {
      metaData = JSON.parse(metaBodyText);
    } catch (parseErr) {
      console.warn(
        `fetchCoinConditionDescriptors: could not parse Metadata API response for category ${categoryId} (treating as no policies). Body starts with: ${
          metaBodyText.slice(
            0,
            120,
          )
        }`,
        parseErr,
      );
      return null;
    }

    // Step 3: Validate response structure and extract descriptors
    const policies = metaData?.itemConditionPolicies;
    if (!Array.isArray(policies)) {
      console.warn(
        `fetchCoinConditionDescriptors: unexpected Metadata API schema — itemConditionPolicies not an array. Got:`,
        JSON.stringify(metaData).slice(0, 300),
      );
      return null;
    }

    console.log(
      `fetchCoinConditionDescriptors: Metadata API returned ${policies.length} policies for category ${categoryId}`,
    );

    // Collect all unique condition descriptors across all itemConditions
    const descriptorMap: Map<
      string,
      {
        descriptorId: string;
        descriptorName: string;
        mode?: string;
        values: Map<string, string>;
      }
    > = new Map();

    let descriptorCount = 0;
    let valueCount = 0;

    for (const policy of policies) {
      const itemConditions = policy?.itemConditions;
      if (!Array.isArray(itemConditions)) continue;

      for (const cond of itemConditions) {
        const conditionDescriptors = cond?.conditionDescriptors;
        if (!Array.isArray(conditionDescriptors)) continue;

        for (const desc of conditionDescriptors) {
          const id = String(desc.conditionDescriptorId ?? "").trim();
          const name = String(desc.conditionDescriptorName ?? "").trim();
          const mode = desc.conditionDescriptorConstraint?.mode as string | undefined;

          if (!id || !name) {
            console.warn(
              `fetchCoinConditionDescriptors: skipping descriptor with missing id or name:`,
              { id, name },
            );
            continue;
          }

          descriptorCount++;

          if (!descriptorMap.has(id)) {
            descriptorMap.set(id, {
              descriptorId: id,
              descriptorName: name,
              mode,
              values: new Map(),
            });
          }

          const entry = descriptorMap.get(id)!;
          const conditionValues = desc?.conditionDescriptorValues;
          if (Array.isArray(conditionValues)) {
            for (const val of conditionValues) {
              const valId = String(val.conditionDescriptorValueId ?? "").trim();
              const valName = String(
                val.conditionDescriptorValueName ?? "",
              ).trim();
              if (valId && valName) {
                entry.values.set(valId, valName);
                valueCount++;
              }
            }
          }
        }
      }
    }

    const result = Array.from(descriptorMap.values()).map((d) => ({
      descriptorId: d.descriptorId,
      descriptorName: d.descriptorName,
      mode: d.mode,
      values: Array.from(d.values.entries()).map(([id, name]) => ({
        id,
        name,
      })),
    }));

    console.log(
      `fetchCoinConditionDescriptors: SUCCESS — found ${result.length} descriptors (${descriptorCount} raw, ${valueCount} values) for category ${categoryId}:`,
      result
        .map(
          (d) => `${d.descriptorName}(${d.descriptorId})[${d.values.length}v]`,
        )
        .join(", "),
    );

    _coinDescriptorCache.set(cacheKey, result);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `fetchCoinConditionDescriptors: EXCEPTION for category ${categoryId}: ${errMsg}`,
    );
    if (e instanceof Error) {
      console.error(`  Stack: ${e.stack?.split("\n").slice(0, 3).join("\n")}`);
    }
    return null;
  }
}

/**
 * eBay conditionId 2750 = "Graded" (LIKE_NEW). Professionally slabbed coins
 * MUST publish under this condition, and not every category accepts it.
 */
export const EBAY_CONDITION_ID_GRADED = "2750";

/** Cache of categoryId -> accepted conditionIds (null = unknown). */
export const _conditionPolicyCache: Map<string, string[] | null> = new Map();

/**
 * Determines whether a category accepts the "Graded" (2750) condition, by
 * asking eBay rather than consulting a hardcoded blocklist.
 *
 * WHY THIS EXISTS
 * ---------------
 * Rollup categories such as 45243 ("Coins: World") reject graded coins with
 * `invalid condition for category 45243` at publish time. We previously
 * hardcoded that single ID in `GRADED_UNFRIENDLY_WORLD_PARENTS`, which:
 *   - only covers the one rollup we happened to hit in production, and
 *   - goes stale the moment eBay changes a category's policy.
 *
 * eBay models graded-vs-raw as a CONDITION, not as a branch of the taxonomy
 * (their coin-mandate docs note grading is available to "all leaf categories
 * descending from" the coin parents, except rolls/sets/lots). So the
 * authoritative question is not "which category is this?" but "does this
 * category accept condition 2750?" — which only getItemConditionPolicies can
 * answer.
 *
 * COST: none in the common path. Results are cached, and the same Metadata
 * API endpoint is already called moments later by
 * `fetchCoinConditionDescriptors` during a graded-coin publish.
 *
 * Returns:
 *   true  — category explicitly lists condition 2750
 *   false — category returned policies that do NOT include 2750
 *   null  — unknown (no credentials, API error, or empty policy response).
 *           Callers MUST treat null as "don't know" and fall back to the
 *           existing hardcoded rules rather than blocking a publish.
 */
export async function categoryAcceptsCondition(
  categoryId: string,
  conditionId: string,
  clientId: string,
  clientSecret: string,
  apiBase: string,
): Promise<boolean | null> {
  const cacheKey = `${apiBase}:${categoryId}`;

  let conditionIds: string[] | null | undefined = _conditionPolicyCache.get(cacheKey);

  if (conditionIds === undefined) {
    conditionIds = await fetchCategoryConditionIds(
      categoryId,
      clientId,
      clientSecret,
      apiBase,
    );
    _conditionPolicyCache.set(cacheKey, conditionIds);
  }

  // Unknown → let the caller keep its existing behaviour.
  if (conditionIds === null || conditionIds.length === 0) return null;

  return conditionIds.includes(String(conditionId));
}

/**
 * Fetches the list of valid conditionIds for a category from eBay's
 * getItemConditionPolicies Metadata API. Returns null when the answer cannot
 * be determined (auth failure, non-200, empty body, or unexpected schema).
 *
 * NOTE: some categories legitimately return HTTP 200 with an EMPTY body,
 * which means "no condition policies" — that is reported as null (unknown),
 * never as an empty allow-list, so we never block a publish on it.
 */
async function fetchCategoryConditionIds(
  categoryId: string,
  clientId: string,
  clientSecret: string,
  apiBase: string,
): Promise<string[] | null> {
  try {
    const tokenUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const tokenResp = await fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
      timeout: 8000,
    });
    if (!tokenResp.ok) {
      console.warn(
        `categoryAcceptsCondition: token request failed (${tokenResp.status}) — treating as unknown`,
      );
      return null;
    }

    const tokenData = await tokenResp.json();
    const appToken = tokenData?.access_token;
    if (!appToken) return null;

    const metaBase = apiBase.includes("sandbox") ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
    const encodedFilter = encodeURIComponent(`categoryIds:{${categoryId}}`);
    const metaResp = await fetchWithTimeout(
      `${metaBase}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodedFilter}`,
      {
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Accept-Language": "en-US",
        },
        timeout: 10000,
      },
    );
    if (!metaResp.ok) {
      console.warn(
        `categoryAcceptsCondition: Metadata API ${metaResp.status} for category ${categoryId} — treating as unknown`,
      );
      return null;
    }

    const bodyText = await metaResp.text();
    if (!bodyText || bodyText.trim() === "") {
      console.log(
        `categoryAcceptsCondition: empty policy body for category ${categoryId} — treating as unknown`,
      );
      return null;
    }

    const data = JSON.parse(bodyText);
    const policies = data?.itemConditionPolicies;
    if (!Array.isArray(policies) || policies.length === 0) return null;

    const policy = policies.find((p: { categoryId?: string }) => p?.categoryId === categoryId) ??
      policies[0];
    const itemConditions = policy?.itemConditions;
    if (!Array.isArray(itemConditions)) return null;

    const ids = itemConditions
      .map((c: { conditionId?: string | number }) => String(c?.conditionId ?? "").trim())
      .filter((id: string) => id.length > 0);

    console.log(
      `categoryAcceptsCondition: category ${categoryId} accepts conditionIds [${ids.join(", ")}]`,
    );
    return ids.length > 0 ? ids : null;
  } catch (e) {
    console.warn(
      `categoryAcceptsCondition: exception for category ${categoryId} — treating as unknown:`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/**
 * CoinConditionDetail type (mirrors pipelineContracts.ts — kept local to avoid shared imports)
 */
export interface CoinConditionDetailGraded {
  type: "graded";
  gradingCompany: string;
  grade: string;
  certificationNumber?: string;
}
export interface CoinConditionDetailRaw {
  type: "raw";
  rawCondition: string;
}
export type CoinConditionDetail = CoinConditionDetailGraded | CoinConditionDetailRaw;

export function normalizeCoinConditionDetail(
  input: unknown,
): CoinConditionDetail | null {
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const type = String(rec.type ?? "")
    .trim()
    .toLowerCase();

  if (type === "raw") {
    const rawCondition = String(rec.rawCondition ?? "").trim();
    if (!rawCondition) return null;
    return { type: "raw", rawCondition };
  }

  if (type === "graded") {
    const gradingCompany = String(
      rec.gradingCompany ??
        (typeof rec.graded === "object" && rec.graded ? (rec.graded as Record<string, unknown>).company : ""),
    ).trim();
    const grade = String(
      rec.grade ??
        (typeof rec.graded === "object" && rec.graded ? (rec.graded as Record<string, unknown>).grade : ""),
    ).trim();
    const certificationNumber = String(
      rec.certificationNumber ??
        (typeof rec.graded === "object" && rec.graded
          ? (rec.graded as Record<string, unknown>).certificationNumber
          : ""),
    ).trim();

    if (!gradingCompany || !grade) return null;
    return {
      type: "graded",
      gradingCompany,
      grade,
      ...(certificationNumber ? { certificationNumber } : {}),
    };
  }

  return null;
}

export function mapConditionEnumToRawCoinTier(
  conditionEnum: string,
): CoinConditionDetailRaw["rawCondition"] {
  const normalized = String(conditionEnum || "").toUpperCase();
  if (["NEW", "NEW_OTHER", "NEW_WITH_DEFECTS"].includes(normalized)) {
    return "Uncirculated";
  }
  if (["LIKE_NEW", "USED_EXCELLENT"].includes(normalized)) {
    return "Extremely Fine to About Uncirculated";
  }
  if (["USED_VERY_GOOD", "USED_GOOD"].includes(normalized)) {
    return "Fine to Very Fine";
  }
  return "Below Fine";
}

export function synthesizeCoinConditionDetail(
  normalizedConditionEnum: string,
  itemSpecifics: Record<string, unknown>,
): CoinConditionDetail {
  const cert = String(itemSpecifics["Certification"] ?? "").trim();
  const grade = String(itemSpecifics["Grade"] ?? "").trim();
  const certNum = String(itemSpecifics["Certification Number"] ?? "").trim();
  const circulated = String(itemSpecifics["Circulated/Uncirculated"] ?? "")
    .trim()
    .toLowerCase();

  const isUncertified = !cert || /^uncertified$/i.test(cert);
  const hasUsableGrade = !!grade && !/^ungraded$/i.test(grade);

  if (!isUncertified && hasUsableGrade) {
    return {
      type: "graded",
      gradingCompany: cert,
      grade,
      ...(certNum ? { certificationNumber: certNum } : {}),
    };
  }

  if (circulated === "uncirculated") {
    return { type: "raw", rawCondition: "Uncirculated" };
  }

  return {
    type: "raw",
    rawCondition: mapConditionEnumToRawCoinTier(normalizedConditionEnum),
  };
}

/**
 * Builds the conditionDescriptors array for the eBay Inventory API PUT body.
 * Implements strict Phase 2 validation for graded vs raw coins.
 *
 * For GRADED coins:
 *   - Validates gradingCompany is one of: PCGS, NGC, ANACS, ICG, CAC, ICCS
 *   - Validates grade format matches pattern: LETTER_CODE + NUMBER (e.g., "MS 65")
 *   - Finds descriptors and maps to numeric IDs
 *   - Adds optional certificationNumber via additionalInfo
 *
 * For RAW coins:
 *   - Validates rawCondition is one of 4 eBay tiers:
 *     • "Uncirculated"
 *     • "Extremely Fine to About Uncirculated"
 *     • "Fine to Very Fine"
 *     • "Below Fine"
 *   - Finds "Coin Condition" descriptor and maps to numeric ID
 *
 * Throws error if validation fails (mandatory compliance).
 * Returns null only if descriptor lookup fails (external API issue).
 */
export function buildCoinConditionDescriptors(
  detail: CoinConditionDetail,
  descriptors: Array<{
    descriptorId: string;
    descriptorName: string;
    mode?: string;
    values: Array<{ id: string; name: string }>;
  }>,
): Array<{ name: string; values?: string[]; additionalInfo?: string }> | null {
  const result: Array<{
    name: string;
    values?: string[];
    additionalInfo?: string;
  }> = [];

  if (detail.type === "graded") {
    const graded = detail as CoinConditionDetailGraded;

    // Phase 2: Strict company validation (eBay June 2026 mandate approved list)
    if (!CERTIFIED_GRADING_COMPANIES.includes(graded.gradingCompany)) {
      throw new Error(
        `Phase 2 Validation: Grading company "${graded.gradingCompany}" is not allowed. ` +
          `Must be one of: ${CERTIFIED_GRADING_COMPANIES.join(", ")}`,
      );
    }

    // Phase 2: Strict grade format validation
    if (!graded.grade || graded.grade.trim().length === 0) {
      throw new Error(
        `Phase 2 Validation: Grade is required for graded coins. Format: LETTER_CODE + NUMBER (e.g., "MS 65")`,
      );
    }
    const gradeFormatRegex = /^[A-Z]{1,3}\s*\d{1,2}(\s+[A-Z]{2,})?$/;
    if (!gradeFormatRegex.test(graded.grade.trim())) {
      throw new Error(
        `Phase 2 Validation: Grade format is invalid: "${graded.grade}". ` +
          `Must be LETTER_CODE + NUMBER (e.g., "MS 65", "PR 70 DCAM")`,
      );
    }

    // Find Grader descriptor
    const graderDesc = descriptors.find((d) => d.descriptorName.toLowerCase().includes("grader"));
    if (!graderDesc) {
      console.error(
        "buildCoinConditionDescriptors: Grader descriptor not found in eBay response",
      );
      throw new Error(
        `eBay Metadata API error: Grader descriptor not found for this category. Please try again.`,
      );
    }

    // Match grading company
    const companyLower = graded.gradingCompany.toLowerCase();
    const graderValue = graderDesc.values.find(
      (v) =>
        v.name.toLowerCase().includes(companyLower) ||
        companyLower.includes(v.name.toLowerCase().split(" ")[0]),
    );
    if (!graderValue) {
      throw new Error(
        `eBay Metadata API error: No value ID found for grading company "${graded.gradingCompany}". ` +
          `Available values: ${graderDesc.values.map((v) => v.name).join(", ")}`,
      );
    }
    result.push({ name: graderDesc.descriptorId, values: [graderValue.id] });

    // Parse and validate grade parts
    const gradeStr = graded.grade.trim();
    const gradeParts = gradeStr.split(/\s+/);
    const letterPart = gradeParts[0] ?? "";
    const numberPart = gradeParts[1] ?? "";
    const suffixPart = gradeParts.slice(2).join(" ");

    console.log(
      `buildCoinConditionDescriptors [GRADED]: company=${graded.gradingCompany}, ` +
        `grade_parsed={letter=${letterPart}, number=${numberPart}, suffix=${suffixPart}}`,
    );

    // Find grade descriptors
    const numberGradeDesc = descriptors.find(
      (d) =>
        d.descriptorName.toLowerCase().includes("number grade") ||
        d.descriptorName.toLowerCase().includes("numerical grade") ||
        d.descriptorName.toLowerCase() === "grade",
    );
    const letterGradeDesc = descriptors.find((d) => d.descriptorName.toLowerCase().includes("letter grade"));

    if (numberGradeDesc && numberPart) {
      const numVal = numberGradeDesc.values.find(
        (v) => v.name === numberPart || v.name.startsWith(numberPart),
      );
      if (numVal) {
        result.push({
          name: numberGradeDesc.descriptorId,
          values: [numVal.id],
        });
      } else {
        console.warn(
          `buildCoinConditionDescriptors: no value ID for number grade="${numberPart}". ` +
            `Available: ${numberGradeDesc.values.map((v) => v.name).join(", ")}`,
        );
      }
    }

    if (letterGradeDesc && letterPart) {
      const letterGradeAliases: Record<string, string[]> = {
        MS: ["mint state", "ms"],
        PR: ["proof", "pf", "pr"],
        PF: ["proof", "pf", "pr"],
        AU: ["about uncirculated", "au"],
        EF: ["extremely fine", "ef", "xf"],
        XF: ["extremely fine", "ef", "xf"],
        VF: ["very fine", "vf"],
        F: ["fine", "f"],
        VG: ["very good", "vg"],
        G: ["good", "g"],
        AG: ["about good", "ag"],
        FR: ["fair", "fr"],
        PO: ["poor", "po"],
        SP: ["specimen", "sp"],
        SMS: ["special mint set", "sms"],
        DCAM: ["deep cameo", "dcam"],
        CAM: ["cameo", "cam"],
      };
      const aliases = letterGradeAliases[letterPart.toUpperCase()] ?? [
        letterPart.toLowerCase(),
      ];
      if (suffixPart) {
        const suffixAliases = letterGradeAliases[suffixPart.toUpperCase()];
        if (suffixAliases) aliases.push(...suffixAliases);
      }
      const letterVal = letterGradeDesc.values.find(
        (v) =>
          aliases.some((alias) => v.name.toLowerCase().includes(alias)) ||
          v.name.toLowerCase() === letterPart.toLowerCase(),
      );
      if (letterVal) {
        result.push({
          name: letterGradeDesc.descriptorId,
          values: [letterVal.id],
        });
      } else {
        console.warn(
          `buildCoinConditionDescriptors: no value ID for letter grade="${letterPart}". ` +
            `Available: ${letterGradeDesc.values.map((v) => v.name).join(", ")}`,
        );
      }
    }

    // Certification number (optional)
    if (graded.certificationNumber) {
      const certDesc = descriptors.find(
        (d) =>
          d.descriptorName.toLowerCase().includes("certification") ||
          d.mode === "FREE_TEXT",
      );
      if (certDesc) {
        result.push({
          name: certDesc.descriptorId,
          additionalInfo: graded.certificationNumber.slice(0, 30),
        });
      }
    }

    return result.length > 0 ? result : null;
  } else {
    // RAW coin path
    const raw = detail as CoinConditionDetailRaw;

    // Phase 2: Strict raw condition validation
    const allowedTiers = [
      "Uncirculated",
      "Extremely Fine to About Uncirculated",
      "Fine to Very Fine",
      "Below Fine",
    ];
    if (!allowedTiers.includes(raw.rawCondition)) {
      throw new Error(
        `Phase 2 Validation: Raw condition "${raw.rawCondition}" is not allowed. ` +
          `Must be one of:\n${allowedTiers.map((t) => `  - "${t}"`).join("\n")}`,
      );
    }

    // Find "Coin Condition" descriptor
    const coinCondDesc = descriptors.find(
      (d) =>
        d.descriptorName.toLowerCase().includes("coin condition") ||
        d.descriptorName.toLowerCase().includes("condition"),
    );
    if (!coinCondDesc) {
      console.error(
        "buildCoinConditionDescriptors: Coin Condition descriptor not found in eBay response",
      );
      throw new Error(
        `eBay Metadata API error: Coin Condition descriptor not found for this category. Please try again.`,
      );
    }

    console.log(
      `buildCoinConditionDescriptors [RAW]: condition="${raw.rawCondition}", ` +
        `available_values=[${coinCondDesc.values.map((v) => v.name).join(", ")}]`,
    );

    // Map raw condition to descriptor value ID
    const rawCondLower = raw.rawCondition.toLowerCase();
    const condValue = coinCondDesc.values.find(
      (v) =>
        v.name.toLowerCase().includes(rawCondLower.split(" ")[0]) ||
        rawCondLower.includes(v.name.toLowerCase().split(" ")[0]),
    );
    if (!condValue) {
      // Try broader match
      const condValueBroad = coinCondDesc.values.find(
        (v) =>
          rawCondLower.includes(v.name.toLowerCase()) ||
          v.name.toLowerCase().includes(rawCondLower),
      );
      if (!condValueBroad) {
        throw new Error(
          `Phase 2 Validation: Unable to map raw condition "${raw.rawCondition}" to eBay descriptor values. ` +
            `Available values: ${coinCondDesc.values.map((v) => v.name).join(", ")}`,
        );
      }
      result.push({
        name: coinCondDesc.descriptorId,
        values: [condValueBroad.id],
      });
      return result;
    }

    result.push({ name: coinCondDesc.descriptorId, values: [condValue.id] });
    return result;
  }
}

// ================================================================
// ACTION HANDLERS - OAuth, tokens, video, and publishing
// Extracted into separate modules: auth.ts, video.ts, supabase.ts
// ================================================================

// ================================================================
// CREATE_DRAFT HELPERS
// ================================================================
// Keep the create_draft action readable by splitting each major publish
// responsibility into a focused helper while preserving the existing flow.

export async function generateDraftSku(
  incomingSku: unknown,
  userId: unknown,
): Promise<string> {
  let sku = incomingSku ? String(incomingSku) : "";
  if (sku) return sku;

  // Attempt sequential SKU generation if userId is provided
  if (userId) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn(
        "create_draft: Supabase credentials not configured, falling back to random SKU",
      );
    } else {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Atomically increment next_sku_sequence via RPC and get the new value
        const { data: seqNum, error: seqError } = await supabase.rpc(
          "increment_sku_sequence",
          { user_id: userId },
        );

        if (seqError || seqNum == null) {
          console.error(
            "create_draft: failed to increment SKU sequence:",
            seqError?.message || "no data returned",
          );
          // Fall through to random SKU fallback
        } else {
          // Format as LA + zero-padded 5-digit sequence number (e.g., LA01000, LA01001, ...)
          sku = `LA${String(seqNum).padStart(5, "0")}`;
          console.log(
            `create_draft: generated sequential SKU: ${sku} (sequence #${seqNum})`,
          );
        }
      } catch (skuErr) {
        console.error("create_draft: SKU generation error:", skuErr);
        // Fall through to random SKU fallback
      }
    }
  } else {
    console.log(
      "create_draft: userId not provided (old frontend code) — will use random SKU fallback",
    );
  }

  // Fallback to random SKU if sequential generation didn't work or userId was missing
  if (!sku) {
    sku = `LA-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    console.log(`create_draft: using fallback random SKU: ${sku}`);
  }

  return sku;
}

export function isGrainBar(title: string, description?: string): boolean {
  const combinedText = (title + " " + (description || "")).toLowerCase();
  const grainPatterns = /\b(grain|grains)\b/;
  return grainPatterns.test(combinedText);
}

export function buildListingUrl(listingId: string): string | null {
  try {
    return `https://www.ebay.com/itm/${listingId}`;
  } catch {
    return null;
  }
}

export async function resolveAspectCategory(finalCategoryId: string): Promise<{
  categoryForAspects: string;
  dynamicRuleApplied: boolean;
}> {
  // ── DYNAMIC ASPECT RULES ──────────────────────────────────────────
  // Try to fetch aspect rules from eBay's Taxonomy API (cached in DB).
  // Falls back to hardcoded CATEGORY_ASPECT_RULES if dynamic fetch fails.
  let categoryForAspects = finalCategoryId ?? "";
  let dynamicRuleApplied = false;

  // Try dynamic aspect rules from eBay API cache
  try {
    const _supabaseUrl = Deno.env.get("SUPABASE_URL");
    const _supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (_supabaseUrl && _supabaseServiceKey && categoryForAspects) {
      const _supabase = createClient(_supabaseUrl, _supabaseServiceKey);
      const dynamicRule = await fetchDynamicAspectRule(
        categoryForAspects,
        _supabase,
      );
      if (
        dynamicRule &&
        (dynamicRule.required.length > 0 || dynamicRule.preferred.length > 0)
      ) {
        // Merge: dynamic rules provide required/preferred/defaults,
        // but hardcoded fixedValues still override (they encode known-correct values like Fineness for Morgan Dollars)
        const hardcodedRule = CATEGORY_ASPECT_RULES[categoryForAspects];
        // Deficiency #5: Only merge hardcoded fixedValues for coin/bullion categories
        if (
          hardcodedRule?.fixedValues &&
          COIN_FIXED_VALUES_ALLOWED_IDS.has(categoryForAspects)
        ) {
          dynamicRule.fixedValues = {
            ...dynamicRule.fixedValues,
            ...hardcodedRule.fixedValues,
          };
        } else if (hardcodedRule?.fixedValues) {
          console.warn(
            `create_draft: skipping hardcoded fixedValues merge for non-coin category ${categoryForAspects}`,
          );
        }
        // Also merge hardcoded defaults that are known-good (e.g., Certification: "Uncertified")
        if (hardcodedRule?.defaults) {
          dynamicRule.defaults = {
            ...dynamicRule.defaults,
            ...hardcodedRule.defaults,
          };
        }

        // Temporarily inject into CATEGORY_ASPECT_RULES so buildAndNormalizeAspects can use it
        CATEGORY_ASPECT_RULES[`__dynamic_${categoryForAspects}`] = dynamicRule;
        categoryForAspects = `__dynamic_${categoryForAspects}`;
        dynamicRuleApplied = true;
        console.log(
          `create_draft: using DYNAMIC aspect rules for category ${finalCategoryId} (${dynamicRule.required.length} required, ${dynamicRule.preferred.length} preferred)`,
        );
      }
    }
  } catch (dynamicErr) {
    console.warn(
      `create_draft: dynamic aspect fetch failed for ${categoryForAspects}, using hardcoded fallback:`,
      dynamicErr,
    );
  }

  // If dynamic didn't work, fall back to hardcoded rules
  if (!dynamicRuleApplied) {
    if (!CATEGORY_ASPECT_RULES[categoryForAspects]) {
      // Prefer the DB-backed detector (ebay_taxonomy_cache first, then
      // category_mappings) so rare categories not in the hardcoded ID sets
      // still get correctly routed to the coin/bullion empty-rule path
      // below instead of falling through with no aspect rule at all.
      let ruleTreeType = detectCategoryTreeSync(categoryForAspects, undefined);
      try {
        const _ruleSupabaseUrl = Deno.env.get("SUPABASE_URL");
        const _ruleSupabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_ruleSupabaseUrl && _ruleSupabaseKey && categoryForAspects) {
          ruleTreeType = await detectCategoryTree(
            categoryForAspects,
            createClient(_ruleSupabaseUrl, _ruleSupabaseKey),
          );
        }
      } catch (ruleTreeErr) {
        console.warn(
          `create_draft: DB category tree detection failed for aspect rule fallback (${categoryForAspects}), using sync fallback ${ruleTreeType}:`,
          ruleTreeErr,
        );
      }
      if (!categoryForAspects) {
        // No category at all — use empty rule (generic normalization only)
        console.warn(
          `create_draft: no category ID provided, using empty aspect rule`,
        );
        categoryForAspects = "__empty__";
      } else if (ruleTreeType === "coin" || ruleTreeType === "bullion") {
        // Known coin/bullion type not in CATEGORY_ASPECT_RULES — use empty rule.
        // 253 (US Coins General) is a non-leaf parent and causes eBay errorId 25003.
        console.warn(
          `create_draft: coin/bullion category ${categoryForAspects} not in CATEGORY_ASPECT_RULES, using generic normalization`,
        );
        categoryForAspects = "__empty__";
      } else {
        console.warn(
          `create_draft: category ${categoryForAspects} not in CATEGORY_ASPECT_RULES, using empty aspect rule (non-coin category)`,
        );
        categoryForAspects = "__empty__";
      }
    }
  }

  return { categoryForAspects, dynamicRuleApplied };
}

export function prepareListingDescription(
  title: string,
  description: string,
  finalCertValue: string | undefined,
): { finalTitle: string; htmlDescription: string } {
  // Sanitize description: fix JS-blocked words (errorId 25002)
  const sanitizedDescription = sanitizeDescription(description);
  if (sanitizedDescription !== description) {
    console.log(
      `create_draft: description sanitized - replaced eBay-blocked patterns (errorId 25002 prevention)`,
    );
  }

  // Strip grade patterns from title & description if coin is not certified (errorId 25019)
  // eBay scans title and description text for grade patterns even when Grade aspect is dropped
  const finalTitle = stripGradesIfUncertified(title, finalCertValue);
  const finalDescription = stripGradesIfUncertified(
    sanitizedDescription,
    finalCertValue,
  );
  if (finalTitle !== title) {
    console.log(
      `create_draft: grade stripped from title (cert="${finalCertValue ?? "none"}"): "${title}" -> "${finalTitle}"`,
    );
  }
  if (finalDescription !== sanitizedDescription) {
    console.log(
      `create_draft: grade stripped from description (cert="${finalCertValue ?? "none"}")`,
    );
  }

  // Convert markdown to HTML for eBay listing
  // AI generates markdown (**bold**, bullets, etc.) but eBay expects HTML
  const htmlDescription = markdownToHtml(finalDescription);
  if (htmlDescription !== finalDescription) {
    console.log(
      `create_draft: converted markdown to HTML for eBay listingDescription`,
    );
  }

  return { finalTitle, htmlDescription };
}

export function toPositiveNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function inferWeightLbFromSpecifics(specifics: unknown): number | null {
  if (!specifics || typeof specifics !== "object") return null;
  const rec = specifics as Record<string, unknown>;
  const raw = String(
    rec["Precious Metal Content per Unit"] ??
      rec["Total Precious Metal Content"] ??
      rec["Weight"] ??
      "",
  )
    .trim()
    .toLowerCase();
  if (!raw) return null;

  // Max 3.9 lb — USPS Ground Coins and most coin shipping services cap at 4 lb.
  // Precious metal content is used as a proxy for item weight, but large bars/lots
  // can produce values that exceed service limits. We cap here to be safe; a UI
  // weight field is the long-term solution.
  const MAX_SHIP_LB = 3.9;

  const ozMatch = raw.match(
    /([0-9]+(?:\.[0-9]+)?)\s*(oz|ounce|ounces|troy\s*oz|toz)\b/,
  );
  if (ozMatch) {
    // Add light packaging buffer and enforce a sane minimum.
    const oz = Number(ozMatch[1]);
    const lb = Math.max(0.125, (oz + 1.0) / 16);
    return Number(Math.min(MAX_SHIP_LB, lb).toFixed(3));
  }

  const gMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(g|gram|grams)\b/);
  if (gMatch) {
    const grams = Number(gMatch[1]);
    const oz = grams * 0.0352739619;
    const lb = Math.max(0.125, (oz + 1.0) / 16);
    return Number(Math.min(MAX_SHIP_LB, lb).toFixed(3));
  }

  const lbMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(lb|lbs|pound|pounds)\b/);
  if (lbMatch) {
    const lb = Number(lbMatch[1]);
    return Number(Math.min(MAX_SHIP_LB, Math.max(0.125, lb)).toFixed(3));
  }

  return null;
}

export function buildPackageWeightAndSize(
  payloadPackageWeightAndSize: unknown,
  itemSpecifics: unknown,
): Record<string, unknown> {
  let packageWeightAndSize: Record<string, unknown> | null = null;
  if (
    payloadPackageWeightAndSize &&
    typeof payloadPackageWeightAndSize === "object"
  ) {
    const incoming = payloadPackageWeightAndSize as Record<string, unknown>;
    const incomingWeight = incoming.weight && typeof incoming.weight === "object"
      ? (incoming.weight as Record<string, unknown>)
      : null;
    const incomingDimensions = incoming.dimensions && typeof incoming.dimensions === "object"
      ? (incoming.dimensions as Record<string, unknown>)
      : incoming.dimension && typeof incoming.dimension === "object"
      ? (incoming.dimension as Record<string, unknown>)
      : null;
    const incomingValue = toPositiveNumber(incomingWeight?.value);

    const dimLength = toPositiveNumber(incomingDimensions?.length);
    const dimWidth = toPositiveNumber(incomingDimensions?.width);
    const dimHeight = toPositiveNumber(incomingDimensions?.height);
    const normalizedDimensions = dimLength && dimWidth && dimHeight
      ? {
        length: dimLength,
        width: dimWidth,
        height: dimHeight,
        unit: String(incomingDimensions?.unit || "INCH").toUpperCase(),
      }
      : null;

    if (incomingValue) {
      packageWeightAndSize = {
        ...incoming,
        weight: {
          ...(incomingWeight || {}),
          value: incomingValue,
          unit: String(incomingWeight?.unit || "POUND").toUpperCase(),
        },
        ...(normalizedDimensions ? { dimensions: normalizedDimensions } : {}),
      };
    }
  }

  if (!packageWeightAndSize) {
    const inferredLb = inferWeightLbFromSpecifics(itemSpecifics) ?? 0.25;
    console.log("[ebay-publish] inferred shipping weight lb:", inferredLb);
    packageWeightAndSize = {
      weight: {
        value: inferredLb,
        unit: "POUND",
      },
    };
  } else {
    console.log(
      "[create_draft] final packageWeightAndSize:",
      JSON.stringify(packageWeightAndSize),
    );
  }

  return packageWeightAndSize;
}

export async function resolveCategoryTreeType(
  finalCategoryId: string,
  itemType: string | undefined,
): Promise<CategoryTreeType> {
  // Resolve category tree type once in function scope so all downstream
  // condition/category logic can safely reuse it. Prefer the DB-backed
  // path because sync-ebay-taxonomy writes authoritative breadcrumbs to
  // ebay_taxonomy_cache; fall back to hardcoded detection if unavailable.
  let categoryTreeType = detectCategoryTreeSync(
    finalCategoryId ?? "",
    itemType,
  );
  try {
    const categorySupabaseUrl = Deno.env.get("SUPABASE_URL");
    const categorySupabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (categorySupabaseUrl && categorySupabaseKey && finalCategoryId) {
      categoryTreeType = await detectCategoryTree(
        String(finalCategoryId),
        createClient(categorySupabaseUrl, categorySupabaseKey),
      );
    }
  } catch (categoryTreeErr) {
    console.warn(
      `create_draft: DB category tree detection failed for ${finalCategoryId}, using fallback ${categoryTreeType}:`,
      categoryTreeErr,
    );
  }

  return categoryTreeType;
}

export async function resolveDraftImageUrls(
  imageUrl: unknown,
  imageUrls: unknown,
): Promise<string[]> {
  // Resolve imageUrl: eBay rejects base64 data: URLs (errorId 25721).
  // Upload to Supabase Storage if needed to get a public HTTPS URL.
  // Support multiple images: prefer `imageUrls` array if provided, else fall back to singular `imageUrl` for compatibility.
  const resolvedImageUrls: string[] = [];
  const incomingImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
    ? imageUrls
    : imageUrl
    ? [imageUrl as string]
    : [];
  if (incomingImageUrls.length > 0) {
    console.log(
      `create_draft: received ${incomingImageUrls.length} image(s) — resolving to public URLs`,
    );
    for (const img of incomingImageUrls) {
      let resolved = img as string;
      if (resolved?.startsWith("data:")) {
        console.log(
          "create_draft: image is base64 data URL — uploading to storage",
        );
        resolved = await uploadDataUrlToStorage(resolved);
        if (resolved.startsWith("data:")) {
          console.error(
            "create_draft: one image upload failed — skipping this image",
          );
          continue;
        }
      }
      if (resolved) resolvedImageUrls.push(resolved);
    }
  }

  return resolvedImageUrls;
}

export async function fetchDefaultPolicy(
  apiBase: string,
  authHeaders: Record<string, string>,
  policyType: string,
): Promise<string | null> {
  const resp = await fetchWithTimeout(
    `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
    { headers: authHeaders, timeout: 15000 },
  );
  if (!resp.ok) {
    console.warn(`Could not fetch ${policyType} policies:`, resp.status);
    return null;
  }
  const data = await resp.json();
  const policies = data[`${policyType}Policies`] || data[`${policyType}Policy`] || [];
  if (Array.isArray(policies) && policies.length > 0) {
    console.log(`Using ${policyType} policy: ${policies[0].name}`);
    return policies[0][`${policyType}PolicyId`] || null;
  }
  return null;
}

export async function resolveDraftBusinessPolicies({
  apiBase,
  authHeaders,
  draftFulfillmentPolicyId,
  draftPaymentPolicyId,
  draftReturnPolicyId,
}: {
  apiBase: string;
  authHeaders: Record<string, string>;
  draftFulfillmentPolicyId: unknown;
  draftPaymentPolicyId: unknown;
  draftReturnPolicyId: unknown;
}): Promise<{
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
}> {
  // Fetch policies — paymentPolicyId is optional for managed payments sellers.
  // Most eBay sellers enrolled in managed payments do NOT need a payment policy.
  // We only require fulfillment and return policies.
  const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
    draftFulfillmentPolicyId
      ? Promise.resolve(String(draftFulfillmentPolicyId))
      : fetchDefaultPolicy(apiBase, authHeaders, "fulfillment"),
    draftPaymentPolicyId
      ? Promise.resolve(String(draftPaymentPolicyId))
      : fetchDefaultPolicy(apiBase, authHeaders, "payment"),
    draftReturnPolicyId
      ? Promise.resolve(String(draftReturnPolicyId))
      : fetchDefaultPolicy(apiBase, authHeaders, "return"),
  ]);

  return { fulfillmentPolicyId, paymentPolicyId, returnPolicyId };
}
