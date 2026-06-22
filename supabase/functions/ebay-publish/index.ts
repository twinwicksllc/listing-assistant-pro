import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { captureException, initSentry } from "../_helpers/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

// Force redeploy v24: Dynamic category aspects â fetch from eBay Taxonomy API via category_aspects_cache, hardcoded rules as fallback
// Force redeploy v23: Fix SKU generation â use rpc("increment_sku_sequence") instead of broken { increment: 1 } update syntax
// Force redeploy v17: fix errorId 25002 for category 45243 (World Coins) - Brand removed from NON_ASPECT_KEYS, Color updated to include BM (Bi-Metallic) for non-copper coins
// Force redeploy v15: shipping location from profile â city+postalCode passed to ensureInventoryLocation; fallback NYCâChicago
// Force redeploy v14: fix errorId 25002 "Country of Origin value too long" â drop Country of Origin if value > 65 chars or contains sentence punctuation (AI hallucination guard)
// Force redeploy v13: fix errorId 25005 "not a leaf category" for US Mint Proof Sets â correct category 253â41109 (US Coin Proof Sets), add CATEGORY_ASPECT_RULES for 41109 and 526
// fineness/denomination/grade normalisation, required-aspect safety-fill (PR #118)

// ================================================================
// CATEGORY ASPECT RULES
// ================================================================
// Hardcoded fallback rules for known categories.
// The system now FIRST tries to fetch dynamic rules from eBay's
// getItemAspectsForCategory API (cached in category_aspects_cache table).
// If the dynamic fetch fails or returns nothing, these hardcoded rules
// are used as a safety net.
// ================================================================

interface AspectRule {
  required: string[];
  preferred: string[];
  defaults: Record<string, string>;
  fixedValues?: Record<string, string>;
}

// ================================================================
// DYNAMIC ASPECT FETCHER
// ================================================================
// Fetches aspect rules from category_aspects_cache (populated by
// category-lookup's "aspects" action via eBay's getItemAspectsForCategory).
// Falls back to hardcoded CATEGORY_ASPECT_RULES if cache miss.
// ================================================================

async function fetchDynamicAspectRule(
  categoryId: string,
  supabase: any,
): Promise<AspectRule | null> {
  try {
    // 1. Check the cache table
    // Deficiency #7: composite cache key includes marketplace_id
    const marketplaceId = "EBAY_US"; // default marketplace
    const { data: cached } = await supabase
      .from("category_aspects_cache")
      .select("aspects, expires_at")
      .eq("category_id", categoryId)
      .eq("marketplace_id", marketplaceId)
      .maybeSingle();

    if (cached?.aspects && new Date(cached.expires_at) > new Date()) {
      // Convert eBay API format to our AspectRule format
      return convertEbayAspectsToRule(cached.aspects);
    }

    // 2. Cache miss or stale â call category-lookup to fetch + cache
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const resp = await fetch(
          `${supabaseUrl}/functions/v1/category-lookup`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseServiceKey}`,
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
function convertEbayAspectsToRule(aspects: any[]): AspectRule {
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

const _categoryConditionCache: Map<
  string,
  Array<{ conditionId: number; conditionDescription: string }>
> = new Map();

function normalizeConditionDescriptorToEnum(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  const aliases: Record<string, string> = {
    "brand new": "NEW",
    "new": "NEW",
    "new other (see details)": "NEW_OTHER",
    "new-open box": "NEW_OTHER",
    "new open box": "NEW_OTHER",
    "open box": "LIKE_NEW",
    "like new": "LIKE_NEW",
    "used": "USED_EXCELLENT",
    "very good": "USED_VERY_GOOD",
    "good": "USED_GOOD",
    "acceptable": "USED_ACCEPTABLE",
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
    "remanufactured": "REMANUFACTURED",
    "retread": "RETREAD",
    "damaged": "DAMAGED",
    "graded": "LIKE_NEW", // 2750 = Graded (per eBay condition ID docs)
    "ungraded": "USED_VERY_GOOD", // 4000 = Ungraded (per eBay condition ID docs)
  };

  return aliases[lowered] ?? raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function fetchDynamicCategoryConditions(
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
        "Authorization": `Bearer ${supabaseServiceKey}`,
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
          conditionDescription: String(condition.conditionDescription ?? "").trim(),
        }))
        .filter((condition: { conditionId: number; conditionDescription: string }) =>
          Number.isFinite(condition.conditionId) && condition.conditionDescription
        )
      : [];

    _categoryConditionCache.set(categoryId, conditions);
    return conditions;
  } catch (err) {
    console.warn(`fetchDynamicCategoryConditions: error for ${categoryId}:`, err);
    return [];
  }
}

// ================================================================
// CATEGORY TREE DETECTION (replaces hardcoded ID sets)
// ================================================================
// Detects category type from breadcrumb path stored in DB.
// Falls back to hardcoded ID sets if breadcrumb unavailable.
// ================================================================

type CategoryTreeType =
  | "coin"
  | "bullion"
  | "trading_card"
  | "collectible"
  | "other";

async function detectCategoryTree(
  categoryId: string,
  supabase: any,
): Promise<CategoryTreeType> {
  // First try to get breadcrumb from DB
  try {
    const { data: mapping } = await supabase
      .from("category_mappings")
      .select("breadcrumb, category_name")
      .eq("ebay_category_id", categoryId)
      .maybeSingle();

    const breadcrumb = (mapping?.breadcrumb || mapping?.category_name || "")
      .toLowerCase();

    if (breadcrumb) {
      if (breadcrumb.includes("bullion")) return "bullion";
      if (
        breadcrumb.includes("coins:") || breadcrumb.includes("coins >") ||
        breadcrumb.includes("paper money")
      ) return "coin";
      if (
        breadcrumb.includes("trading cards") ||
        breadcrumb.includes("collectible card games")
      ) return "trading_card";
      if (
        breadcrumb.includes("collectibles") || breadcrumb.includes("toys &") ||
        breadcrumb.includes("stuffed animal") ||
        breadcrumb.includes("action figure") || breadcrumb.includes("funko") ||
        breadcrumb.includes("lego") || breadcrumb.includes("board game")
      ) return "collectible";
      return "other";
    }
  } catch (_) { /* fall through to hardcoded */ }

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
const HARDCODED_COIN_CATEGORY_IDS = new Set([
  // ── US Coin parent / top-level ─────────────────────────────────────────────
  "253",    // Coins: US (parent — all descendants are coins)
  // ── US Cents ───────────────────────────────────────────────────────────────
  "11981",  // Wheat Pennies
  "39464",  // Lincoln Cents (Memorial)
  // ── US Nickels ─────────────────────────────────────────────────────────────
  "11980",  // Jefferson Nickels
  "11116",  // Buffalo Nickels
  "11118",  // Liberty Head Nickels
  "11063",  // Shield Nickels
  // ── US Dimes ───────────────────────────────────────────────────────────────
  "11971",  // Roosevelt Dimes
  "40149",  // Dimes (parent/generic)
  "40150",  // Dimes (type 2)
  "40151",  // Mercury Dimes (1916–1945)
  "40152",  // Barber Dimes (1892–1916)
  "40153",  // Seated Liberty Dimes (1837–1891)
  "40154",  // Early American Dimes
  "40155",  // Dimes (variant 5)
  "40156",  // Dimes (variant 6)
  "40157",  // Dimes (variant 7)
  "40158",  // Dimes (variant 8)
  "40159",  // Dimes (variant 9)
  "40160",  // Dimes (variant 10)
  "40161",  // Dimes (variant 11)
  "40162",  // Dimes (variant 12)
  "40163",  // Dimes (variant 13)
  "40164",  // Dimes (variant 14)
  "40165",  // Dimes (variant 15)
  "40166",  // Dimes (variant 16)
  "40167",  // Dimes (variant 17)
  "41090",  // Dimes (AI-resolved parent category — observed in Mercury dime listings)
  // ── US Quarters ────────────────────────────────────────────────────────────
  "41099",  // Washington Quarters
  "41102",  // State Quarters
  "40196",  // Quarters (variant)
  "40197",  // Quarters (variant)
  "40198",  // Quarters (variant)
  "40199",  // Quarters (variant)
  "40200",  // Quarters (variant)
  "40201",  // Quarters (variant)
  "40202",  // Quarters (variant)
  // ── US Half Dollars / Dollar Coins ─────────────────────────────────────────
  "11973",  // Kennedy Half Dollars
  "39455",  // Dollar Coins
  // ── US Gold / Silver ───────────────────────────────────────────────────────
  "41084",  // US Gold Coins
  "11950",  // US Silver Coins
  "19167",  // US Silver type
  "19168",  // US Silver type
  "19169",  // US Silver type
  // ── US Coin Sets / Proof / Rolls ───────────────────────────────────────────
  "41111",  // Coin Sets
  "166679", // US Coin Proof Sets
  "41109",  // US Coin Proof Sets (variant)
  "3411",   // Coin Rolls
  // ── Paper Money ────────────────────────────────────────────────────────────
  "526",    // Paper Money: US
  // ── World / Canadian / Ancient / Medieval / Commemorative / Exonumia ───────
  "45243",  // World Coins
  "45244",  // World Coins (variant)
  "39471",  // Canadian Coins
  "39472",  // Ancient Coins
  "39473",  // Medieval Coins
  "39474",  // Bullion Coins
  "39475",  // Commemorative Coins
  "164743", // World Coins (extended)
  "166680", // Proof Sets (variant)
  "166681", // Proof Sets (variant)
  // ── Bullion Coins (overlap with bullion — conditionDescriptors fetched; 0 returned = mandate exempt) ─
  "177652", // Bullion Coins
  "177653", // Silver Bullion Coins
  "178906", // Gold Bullion Coins / Bars
  // ── Error Coins / Rolls / Collections ──────────────────────────────────────
  "261064", // Error Coins
  "261068", // Collectibles: Coins
  "261069", // Collectibles: Coins variant
  "261070", // Collectibles: Coins variant
  "261071", // Collectibles: Coins variant
  "261072", // Collectibles: Coins variant
  "261073", // Collectibles: Coins variant
  "261074", // Collectibles: Coins variant
  "261075", // Collectibles: Coins variant
  "261076", // Collectibles: Coins variant
  // ── Silver/Gold Bars & Rounds (Certification aspect required) ─────────────
  "532",    // Silver Bars & Rounds
  "3360",   // Silver grain bars
  "3361",   // Gold Bars & Rounds
  "173685", // Platinum / Palladium Bullion
]);
const HARDCODED_BULLION_CATEGORY_IDS = new Set([
  "178906",
  "39489",
  "3361",
  "532",
  "173685",
]);
const HARDCODED_TRADING_CARD_CATEGORY_IDS = new Set([
  "261328",
  "183454",
  "2536",
  "19107",
  "64482",
  "213",
]);
const HARDCODED_COLLECTIBLE_CATEGORY_IDS = new Set([
  "19203",
  "19209",
  "261068",
  "246",
  "182",
  "19016",
]);

// ================================================================
// COIN/BULLION FIXED-VALUES ALLOWLIST (deficiency #5)
// Only categories in this set may receive hardcoded fixedValues
// (Composition, Fineness, Denomination, Material).
// Prevents coin-specific aspects from leaking to non-coin categories.
// ================================================================
// Only leaf categories allowed to receive coin-specific fixed values (Composition, Fineness, Denomination, Material).
// Parent IDs like 253, 256, 3377, 4733, 18466 are not included; descendant detection via breadcrumbs will handle them.
const COIN_FIXED_VALUES_ALLOWED_IDS = new Set([
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

const CATEGORY_ASPECT_RULES: Record<string, AspectRule> = {
  // Empty rule set for non-coin categories with no specific aspect requirements
  "__empty__": {
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
    fixedValues: { "Composition": "Gold" },
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
    fixedValues: { "Composition": "Silver" },
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
    defaults: { "Certification": "Uncertified" },
    fixedValues: { "Composition": "Silver" },
  },
  // Other Silver Bullion
  "3361": {
    required: ["Certification"],
    preferred: ["Type"],
    defaults: { "Certification": "Uncertified" },
    fixedValues: { "Composition": "Silver" },
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "$1",
    },
    fixedValues: { "Denomination": "$1" },
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "$1",
    },
    fixedValues: {
      "Denomination": "$1",
      "Composition": "Silver",
      "Fineness": "0.900",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "$1",
    },
    fixedValues: {
      "Denomination": "$1",
      "Composition": "Silver",
      "Fineness": "0.900",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "50C",
    },
    fixedValues: {
      "Denomination": "50C",
      "Composition": "Silver",
      "Fineness": "0.900",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "50C",
    },
    fixedValues: {
      "Denomination": "50C",
      "Composition": "Silver",
      "Fineness": "0.900",
    },
  },
  // Kennedy Half Dollars (1964-present) - Coins & Paper Money > US Coins
  "41102": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "50C",
    },
    fixedValues: { "Denomination": "50C" },
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "50C",
    },
    fixedValues: {
      "Denomination": "50C",
      "Composition": "Silver",
      "Fineness": "0.900",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "1C",
    },
    fixedValues: { "Denomination": "1C", "Composition": "Copper" },
  },
  // Indian Head Cent
  "41084": {
    required: ["Certification", "Circulated/Uncirculated", "Material"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "1C",
      "Material": "Copper",
    },
    fixedValues: { "Denomination": "1C", "Material": "Copper" },
  },
  // Braided Hair Large Cent (1793-1857)
  "11950": {
    required: ["Certification", "Circulated/Uncirculated", "Material"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: {
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Denomination": "1C",
      "Material": "Copper",
    },
    fixedValues: { "Denomination": "1C", "Material": "Copper" },
  },
  // American Silver Eagle
  "41111": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Strike Type", "Denomination"],
    defaults: {
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Uncirculated",
      "Denomination": "$1",
    },
    fixedValues: {
      "Denomination": "$1",
      "Composition": "Silver",
      "Fineness": "0.999",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
      "Type": "Round",
    },
    fixedValues: { "Composition": "Copper" },
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
      "Certification": "U.S. Mint",
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
      "Certification": "U.S. Mint",
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
      "Certification": "Uncertified",
      "Circulated/Uncirculated": "Unknown",
    },
  },
  // World Coins (general)
  "45243": {
    required: [],
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
    defaults: { "Certification": "Uncertified" },
  },
  // ââ Collectibles / Toys / Trading Cards ââââââââââââââââââââââââââââââââââ
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
    defaults: { "Sport": "Baseball" },
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
    defaults: { "Sport": "Baseball" },
  },
  // Sports Cards General (parent)
  "213": {
    required: ["Sport"],
    preferred: ["Player/Athlete", "Card Manufacturer", "Year", "Team"],
    defaults: { "Sport": "Baseball" },
  },
  // PokÃ©mon Trading Card Games
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
    defaults: { "Brand": "Ty" },
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
    defaults: { "Brand": "Funko" },
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
    defaults: { "Brand": "LEGO" },
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
const VALID_ASPECT_VALUES: Record<string, Set<string>> = {
  "Certification": new Set([
    "Uncertified",
    "PCGS",
    "NGC",
    "PCGS & CAC",
    "NGC & CAC",
    "U.S. Mint",
    "ANACS",
    "ICG",
    "CAC",
    "ICCS",
  ]),
  "Circulated/Uncirculated": new Set(["Uncirculated", "Circulated", "Unknown"]),
  "Shape": new Set(["Bar", "Round"]),
  "Strike Type": new Set([
    "Business",
    "Proof",
    "Proof-Like",
    "Deep Mirror Proof-Like",
    "Satin",
    "Matte",
  ]),
  "Composition": new Set([
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
  "Color": new Set(["RD", "RB", "BN", "BM"]), // BM = Bi-Metallic
};

// ================================================================
// ASPECT NORMALISATION HELPERS
// ================================================================

const ASPECT_SKIP_VALUES = new Set([
  "none",
  "unknown",
  "n/a",
  "other",
  "unspecified",
  "not applicable",
  "unknown/not applicable",
  "not specified",
  // "Ungraded" is not a valid Sheldon-scale grade â eBay treats any grade value on an
  // uncertified coin as a numerical-grade policy violation (errorId 25019).  Drop it.
  "ungraded",
]);

function normalizeFineness(value: string): string {
  const v = value.trim();
  // Already correct format: 0.999, 0.9999, etc.
  if (/^0\.\d{2,5}$/.test(v)) return v;
  // Leading-dot format: .999, .9999 -> 0.999, 0.9999
  if (/^\.\d{2,5}$/.test(v)) return "0" + v;
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
  const leadDot = v.match(/(?<!\d)\.(\d{2,5})\b/);
  if (leadDot) return "0." + leadDot[1];
  return v;
}

function normalizeGrade(value: string): string {
  const v = value.trim();
  const withHyphen = v.match(/^(MS|PR|AU|XF|VF|F|VG|G|AG|FA|P)-?(\d+)$/i);
  if (withHyphen) return `${withHyphen[1].toUpperCase()} ${withHyphen[2]}`;
  const noSep = v.match(/^(MS|PR|AU|XF|VF|VG|AG|FA)([\s-]?)(\d+)$/i);
  if (noSep) return `${noSep[1].toUpperCase()} ${noSep[3]}`;
  return v;
}

function normalizeDenomination(value: string, categoryId: string): string {
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

function normalizeCirculatedUncirculated(
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
function normalizePreciousMetalContent(value: string): string {
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
  const stripped = v.replace(/\s*troy\s*/i, " ").replace(/\s+/g, " ").trim();

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
      [0.10, "1/10 oz"],
      [0.25, "1/4 oz"],
      [0.50, "1/2 oz"],
      [1.0, "1 oz"],
      [2.0, "2 oz"],
      [5.0, "5 oz"],
      [10.0, "10 oz"],
      [32.15, "1 kilo"],
    ];
    for (const [target, label] of ozFractionMap) {
      if (Math.abs(ozVal - target) / target < 0.10) return label;
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

const ASPECT_KEY_ALIASES: Record<string, string> = {
  "Circulated/Uncirculated": "Circulated/Uncirculated",
  "CirculatedUncirculated": "Circulated/Uncirculated",
  "Mint Location": "Mint Location",
  "MintLocation": "Mint Location",
  "Strike Type": "Strike Type",
  "StrikeType": "Strike Type",
  "KM Number": "KM Number",
  "KMNumber": "KM Number",
  "Precious Metal Content per Unit": "Precious Metal Content per Unit",
  "PreciousMetalContentperUnit": "Precious Metal Content per Unit",
  "Metal Content": "Precious Metal Content per Unit",
  "Brand/Mint": "Brand/Mint",
  "Manufacturer/Mint": "Brand/Mint",
  "Fineness": "Fineness",
  "Certification": "Certification",
  "Denomination": "Denomination",
  "Composition": "Composition",
  "Year": "Year",
  "Shape": "Shape",
  "Grade": "Grade",
  "Coin": "Coin",
  "Coin Type": "Coin",
  "Coin/Bullion Type": "Coin",
  "Country of Origin": "Country of Origin",
  "Country/Region of Manufacture": "Country of Origin",
  "Total Precious Metal Content": "Total Precious Metal Content",
  "Certification Number": "Certification Number",
  "Variety": "Variety",
  "Era": "Era",
  "Cleaned/Uncleaned": "Cleaned/Uncleaned",
  "Provenance": "Provenance",
  // These were previously in NON_ASPECT_KEYS; now pass through as real eBay aspects:
  "Type": "Type", // required by bullion categories (e.g. 261186 Silver Bullion Coins) â errorId 25002
  "Color": "Color", // used by 45243 (World Coins) for copper/bronze coins
  "Materials sourced from": "Materials sourced from",
  "Brand": "Brand", // required by 45243 (World Coins) â errorId 25002 when missing
};

const NON_ASPECT_KEYS = new Set([
  // "Type" removed â eBay bullion categories (e.g. 261068 Silver Bullion Coins) require
  // "Type" as a real aspect (errorId 25002 when missing).  It must pass through to the
  // Inventory API rather than being silently dropped.
  // "Color" removed â world coins category 45243 uses Color (RD/RB/BN) as a real eBay aspect.
  // "Brand" removed â world coins category 45243 requires Brand as a real eBay aspect (errorId 25002 when missing).
  "Material",
  "Size",
  "Mintage",
  "Series",
  "Modified Item",
  "Mint Mark",
]);

function normalizeAspectKey(key: string): string {
  // eBay Inventory API expects BARE keys (Fineness, Grade, Year â NOT C:Fineness etc.)
  // The C: prefix is only used in eBay's Category Tree API taxonomy responses, never in payloads.
  // Strip any C: prefix the AI might have output, then resolve aliases to canonical bare names.
  const bare = key.startsWith("C:") ? key.slice(2) : key;
  if (NON_ASPECT_KEYS.has(bare)) return bare;
  if (ASPECT_KEY_ALIASES[bare]) return ASPECT_KEY_ALIASES[bare];
  return bare;
}

function buildAndNormalizeAspects(
  rawSpecifics: Record<string, unknown>,
  categoryId: string,
): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const rule = CATEGORY_ASPECT_RULES[categoryId];

  for (const [rawKey, rawValue] of Object.entries(rawSpecifics)) {
    if (!rawValue || typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;
    if (ASPECT_SKIP_VALUES.has(trimmed.toLowerCase())) continue;

    const key = normalizeAspectKey(rawKey);
    if (NON_ASPECT_KEYS.has(key)) continue; // skip internal-only keys

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
      const looksLikeSentence = value.length > 65 || /[.!?]/.test(value) ||
        (value.includes(",") && value.length > 40);
      if (looksLikeSentence) {
        console.warn(
          `buildAndNormalizeAspects: dropping Country of Origin â value looks like AI-generated text (${value.length} chars): "${
            value.slice(0, 80)
          }..."`,
        );
        continue;
      }
    }

    if (VALID_ASPECT_VALUES[key] && !VALID_ASPECT_VALUES[key].has(value)) {
      console.warn(
        `buildAndNormalizeAspects: invalid value "${value}" for ${key} â skipping`,
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

  // ââ Sport inference for trading card categories âââââââââââââââââââââââââ
  // If category is a sports card category and Sport is missing, infer from title/description
  const SPORT_CARD_CATS = new Set(["213", "261328", "64482"]);
  if (SPORT_CARD_CATS.has(categoryId) && !aspects["Sport"]) {
    // Try to infer sport from item title or existing aspects
    const textToSearch = (
      (aspects["Player/Athlete"]?.[0] || "") + " " +
      (aspects["Team"]?.[0] || "") + " " +
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
  const CERTIFIED_GRADERS = new Set([
    "PCGS",
    "NGC",
    "ANACS",
    "ICG",
    "CAC",
    "ICCS",
    "PCGS & CAC",
    "NGC & CAC",
  ]);
  let normalizedCert = certValue;
  if (certValue && !CERTIFIED_GRADERS.has(certValue)) {
    // Try to extract a known grader name from the beginning of the value
    for (const grader of CERTIFIED_GRADERS) {
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
    (!normalizedCert || !CERTIFIED_GRADERS.has(normalizedCert))
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
const CONDITION_ID_MAP: Record<string, number> = {
  // Universal conditions
  NEW: 1000,
  NEW_OTHER: 1500,
  NEW_WITH_DEFECTS: 1750,
  LIKE_NEW: 2750,
  // Refurbished (electronics/appliances â NOT for coins)
  CERTIFIED_REFURBISHED: 2000,
  SELLER_REFURBISHED: 2500,
  // USED_* family â correct for Coins & Paper Money category tree
  USED_EXCELLENT: 3000, // AU-50 to XF-45
  USED_VERY_GOOD: 4000, // VF-20 to VF-35
  USED_GOOD: 5000, // F-12 to VG-10
  USED_ACCEPTABLE: 6000, // G-4 to G-6
  FOR_PARTS_OR_NOT_WORKING: 7000, // Damaged/holed/bent coins, junk
  // Trading card / collectible conditions (used by 261328, 183454, 19203, etc.)
  VERY_GOOD: 3000, // Trading cards: Very Good
  GOOD: 4000, // Trading cards: Good
  ACCEPTABLE: 5000, // Trading cards: Acceptable
  // Legacy *_REFURBISHED aliases â mapped to USED_* for coin categories
  EXCELLENT_REFURBISHED: 3000,
  VERY_GOOD_REFURBISHED: 4000,
  GOOD_REFURBISHED: 5000,
  // Legacy PRE_OWNED_* aliases â kept so old DB records can still publish
  PRE_OWNED_GOOD: 3000, // same as USED_EXCELLENT
  PRE_OWNED_FAIR: 5000, // same as USED_GOOD
  PRE_OWNED_POOR: 6000, // same as USED_ACCEPTABLE
};

const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Uncirculated coin or brand new item in original packaging.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  LIKE_NEW: "Professionally graded and encapsulated coin.", // Used as conditionDescription for graded coins (LIKE_NEW = 2750 = Graded)
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  // USED_* â correct conditions for Coins & Paper Money category tree
  // NOTE: Do NOT include numerical grades (AU-50, MS-65, etc.) in descriptions unless coin is certified by NGC, PCGS, ANACS, ICG, CAC, or ICCS
  USED_EXCELLENT: "Lightly circulated. Shows minimal wear on high points only.",
  USED_VERY_GOOD: "Moderately circulated. Major details clear with moderate wear.",
  USED_GOOD: "Heavily circulated. All major features visible but worn.",
  USED_ACCEPTABLE: "Heavily worn but identifiable. Outline and major features visible.",
  FOR_PARTS_OR_NOT_WORKING: "Damaged, holed, bent, or corroded. Not suitable for collecting.",
  // Trading card / collectible conditions
  VERY_GOOD: "Item in very good condition with minor wear.",
  GOOD: "Item in good condition with moderate wear.",
  ACCEPTABLE: "Item in acceptable condition with heavy wear but still functional.",
  // Legacy aliases â redirect to their USED_* equivalents
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

const LEGACY_CONDITION_MAP: Record<string, string> = {
  // Migrate old *_REFURBISHED and PRE_OWNED_* values from DB to USED_* equivalents.
  // Users no longer select these from the UI â these only handle old stored records.
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
  "New": "NEW",
  "New other (see details)": "NEW_OTHER",
  "New with defects": "NEW_WITH_DEFECTS",
  "Certified refurbished": "CERTIFIED_REFURBISHED",
  "Seller refurbished": "SELLER_REFURBISHED",
  "Like New": "LIKE_NEW",
  "Used": "USED_EXCELLENT",
  "Very Good": "USED_VERY_GOOD",
  "Good": "USED_GOOD",
  "Acceptable": "USED_ACCEPTABLE",
  "For parts or not working": "FOR_PARTS_OR_NOT_WORKING",
  // Also handle plain lowercase variants
  "new": "NEW",
  "used": "USED_EXCELLENT",
  "very good": "USED_VERY_GOOD",
  "good": "USED_GOOD",
  "acceptable": "USED_ACCEPTABLE",
  "like new": "LIKE_NEW",
  "Digital Good": "DIGITAL_GOOD",
  "digital good": "DIGITAL_GOOD",
  "Certified pre-owned": "CERTIFIED_PRE_OWNED",
  "certified pre-owned": "CERTIFIED_PRE_OWNED",
  "Remanufactured": "REMANUFACTURED",
  "remanufactured": "REMANUFACTURED",
  "Retread": "RETREAD",
  "retread": "RETREAD",
  "Damaged": "DAMAGED",
  "damaged": "DAMAGED",

  // eBay returns "Ungraded" / "Graded" as conditionDescription strings for some coin
  // categories (e.g. 3377 Coins: Canada, 3379, etc.). These are NOT valid Inventory API
  // condition enum values and will cause errorId 2004 "Could not serialize field [condition]".
  // Map to the closest valid USED_* coin condition.
  "Ungraded": "USED_VERY_GOOD",
  "ungraded": "USED_VERY_GOOD",
  "UNGRADED": "USED_VERY_GOOD",
  "Graded": "NEW",
  "GRADED": "NEW",
};

// Condition normalization now uses both hardcoded fallback sets (from top of file)
// AND the dynamic detectCategoryTree function for breadcrumb-based detection.
// The sync version below uses hardcoded sets; the async caller can override via categoryTreeType.

function normalizeConditionForCategory(
  rawCondition: string,
  categoryId: string | undefined,
  itemType: string | undefined = undefined,
  categoryTreeType: CategoryTreeType | undefined = undefined,
): { condition: string; corrected: boolean } {
  // Apply legacy migration first (case-insensitive using normalizeConditionDescriptorToEnum)
  const condition = normalizeConditionDescriptorToEnum(rawCondition);

  // Use provided tree type or fall back to hardcoded ID sets
  const resolvedCategoryTreeType = categoryTreeType ||
    detectCategoryTreeSync(categoryId ?? "", itemType);

  const isCoin = resolvedCategoryTreeType === "coin";
  const isBullion = resolvedCategoryTreeType === "bullion";
  const isTradingCard = resolvedCategoryTreeType === "trading_card";
  const isCollectible = resolvedCategoryTreeType === "collectible";

  if (isCoin) {
    // eBay Inventory API for Coins & Paper Money:
    // LIKE_NEW (2750) = "Graded"   â professionally graded/slabbed coins (NGC, PCGS, etc.)
    // USED_VERY_GOOD (4000) = "Ungraded" â raw/circulated coins
    // Reference: https://developer.ebay.com/api-docs/sell/static/metadata/condition-id-values.html
    // "For trading cards or coins, the numeric identifier 2750 indicates that the item is graded."
    // "For trading cards or coins, the numeric identifier 4000 indicates that the item is ungraded."
    const validCoinConditions = new Set([
      "LIKE_NEW", // 2750 = Graded (NGC/PCGS/etc. slabbed coins)
      "USED_VERY_GOOD", // 4000 = Ungraded (raw/circulated coins)
      "FOR_PARTS_OR_NOT_WORKING", // 7000 = Damaged/holed/bent
    ]);

    if (!validCoinConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        NEW: "USED_VERY_GOOD", // graded->ungraded downgrade; LIKE_NEW requires Professional Grader
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
        `normalizeConditionForCategory: coin category ${categoryId} â ${condition} -> ${mapped}`,
      );
      return { condition: mapped, corrected: true };
    }
  } else if (isBullion) {
    // Bullion: allow everything except LIKE_NEW
    if (condition === "LIKE_NEW") {
      console.log(
        `normalizeConditionForCategory: bullion category ${categoryId} â LIKE_NEW -> NEW`,
      );
      return { condition: "NEW", corrected: true };
    }
  } else if (isTradingCard) {
    // Trading cards: use standard eBay Inventory API ConditionEnum strings.
    // Note: VERY_GOOD/GOOD/ACCEPTABLE are condition IDs 3000/5000/6000 for trading
    // cards, but the Inventory API's ConditionEnum type only accepts USED_* and
    // LIKE_NEW strings â sending "VERY_GOOD" causes errorId 2004 "Could not
    // serialize field [condition]". Keep USED_* here; eBay resolves the display
    // label ("Very Good", "Good", etc.) from the category + enum combination.
    const validCardConditions = new Set([
      // LIKE_NEW removed: conditionId 2750 = Graded â requires Professional Grader
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
        `normalizeConditionForCategory: trading card category ${categoryId} â ${condition} -> ${mapped}`,
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
        `normalizeConditionForCategory: collectible category ${categoryId} â ${condition} -> ${mapped}`,
      );
      return { condition: mapped, corrected: true };
    }
  }

  return { condition, corrected: false };
}

// Synchronous category tree detection using hardcoded ID sets + item type hints
// Used by normalizeConditionForCategory when async breadcrumb detection isn't available
function detectCategoryTreeSync(
  categoryId: string,
  itemType: string | undefined,
): CategoryTreeType {
  if (HARDCODED_BULLION_CATEGORY_IDS.has(categoryId)) return "bullion";
  if (HARDCODED_COIN_CATEGORY_IDS.has(categoryId)) return "coin";
  if (HARDCODED_TRADING_CARD_CATEGORY_IDS.has(categoryId)) {
    return "trading_card";
  }
  if (HARDCODED_COLLECTIBLE_CATEGORY_IDS.has(categoryId)) return "collectible";

  // Also handle the legacy 261xxx range for silver/gold bullion coins/bars
  if (
    /^261[0-9]{3}$/.test(categoryId) && parseInt(categoryId) >= 261000 &&
    parseInt(categoryId) <= 261076
  ) {
    return "bullion";
  }

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
// GTC = "Good 'Til Cancelled" â required for FIXED_PRICE listings
// Auctions must use a specific day count: 1, 3, 5, 7, or 10
// ----------------------------------------------------------------
const FIXED_PRICE_DURATION = "GTC";
const DEFAULT_AUCTION_DURATION = "Days_7";
const VALID_AUCTION_DURATIONS = [
  "Days_1",
  "Days_3",
  "Days_5",
  "Days_7",
  "Days_10",
];

// ----------------------------------------------------------------
// Helper: fetch with timeout to prevent hanging requests
// ----------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const timeout = options.timeout ?? 15000; // 15 second default
  const { timeout: _timeout, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// ----------------------------------------------------------------
// Sanitize listing description to remove patterns eBay rejects (errorId 25002)
// eBay blocks: javascript, .cookie, cookie(, replace(, IFRAME, META, base href, includes
// The word "includes" in plain English text (e.g., "This lot includes...") falsely
// triggers eBay's JS injection filter. Replace with safe synonyms.
// ----------------------------------------------------------------
function sanitizeDescription(desc: string): string {
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
// This converts: **bold** â <b>bold</b>, *italic* â <i>italic</i>,
// line breaks â <br>, bullet points â <ul><li>, etc.
// ----------------------------------------------------------------
function markdownToHtml(markdown: string): string {
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
const GRADE_PATTERN = /\b(MS|PR|PF|AU|XF|EF|VF|F|VG|G|AG|FA|PO|P)-?\s*(\d{1,2})\b/gi;
const CERTIFIED_GRADERS_SET = new Set([
  "PCGS",
  "NGC",
  "ANACS",
  "ICG",
  "CAC",
  "ICCS",
  "PCGS & CAC",
  "NGC & CAC",
]);

function stripGradesIfUncertified(
  text: string,
  certificationValue: string | undefined,
): string {
  if (!text) return text;
  // If certified by an approved grader, grades are allowed â don't strip
  if (certificationValue && CERTIFIED_GRADERS_SET.has(certificationValue)) {
    return text;
  }
  // Strip grade patterns from text (replace with empty string)
  const stripped = text.replace(GRADE_PATTERN, "").replace(/\s{2,}/g, " ")
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
function buildFixedPriceOffer(params: {
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
  // Build listingPolicies â paymentPolicyId is omitted for managed payments sellers
  const listingPolicies: Record<string, unknown> = {
    fulfillmentPolicyId: params.fulfillmentPolicyId,
    returnPolicyId: params.returnPolicyId,
  };
  if (params.paymentPolicyId) {
    listingPolicies.paymentPolicyId = params.paymentPolicyId;
  }

  // Best Offer â only added for fixed-price listings when enabled
  if (params.bestOfferEnabled) {
    const bestOfferTerms: Record<string, unknown> = {
      bestOfferEnabled: true,
    };
    if (
      params.bestOfferAutoAcceptPrice && params.bestOfferAutoAcceptPrice > 0
    ) {
      bestOfferTerms.autoAcceptPrice = {
        value: params.bestOfferAutoAcceptPrice.toFixed(2),
        currency: "USD",
      };
    }
    if (
      params.bestOfferAutoDeclinePrice && params.bestOfferAutoDeclinePrice > 0
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
function buildAuctionOffer(params: {
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
// eBay's Inventory API rejects data: URLs (errorId 25721) â all images must be
// real publicly-accessible HTTPS URLs before they're sent to eBay.
// ----------------------------------------------------------------
async function uploadDataUrlToStorage(dataUrl: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn(
      "uploadDataUrlToStorage: missing Supabase env vars â skipping upload",
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
// to guarantee the address (postalCode/city) is current â eBay PATCH silently ignores
// address fields so DELETE+re-create is the only reliable way to update them.
// If DELETE is blocked (location has active items), fall back to a postal-code-keyed location.
// Returns the merchantLocationKey on success.
// ----------------------------------------------------------------
async function ensureInventoryLocation(
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

  // Location already exists â eBay PATCH does NOT update address fields (postalCode/city are
  // immutable via PATCH; only metadata like name/phone/hours can change).
  // The correct approach is DELETE then re-create so the address is definitely current.
  const errText = await resp.text();
  let alreadyExists = false;

  try {
    const errJson = JSON.parse(errText);
    alreadyExists = Array.isArray(errJson.errors) &&
      errJson.errors.some((e: { errorId: number }) => e.errorId === 25803);
  } catch { /* not JSON */ }

  if (resp.status === 409 || alreadyExists) {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" already exists â attempting DELETE + re-create to update address (PATCH silently ignores address fields)`,
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
        `ensureInventoryLocation: deleted "${merchantLocationKey}" â re-creating with postal code ${postalCode}`,
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
        fallbackErrJson.errors.some((e: { errorId: number }) => e.errorId === 25803);
    } catch { /* not JSON */ }

    if (fallbackResp.status === 409 || fallbackAlreadyExists) {
      // This postal code was used before â the location already exists with the right address.
      console.log(
        `ensureInventoryLocation: fallback location "${fallbackKey}" already exists with correct postal code â using it`,
      );
      return fallbackKey;
    }

    // All attempts exhausted â proceed with whatever key eBay has on file.
    console.error(
      `ensureInventoryLocation: all location update attempts failed. Using "${merchantLocationKey}" with potentially stale address. Last error: ${fallbackResp.status}: ${fallbackErrText}`,
    );
    return merchantLocationKey;
  }

  // Genuine error â not an "already exists" case.
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
const COIN_CONDITION_DESCRIPTOR_PARENT_IDS = new Set([
  "253", // Coins: US
  "256", // Coins: World
  "3377", // Coins: Canada
  "4733", // Coins: Ancient
  "18466", // Coins: Medieval
]);

/** In-memory per-invocation cache for coin condition descriptor lookup results */
const _coinDescriptorCache: Map<
  string,
  Array<{ descriptorId: string; descriptorName: string; values: Array<{ id: string; name: string }> }>
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
async function fetchCoinConditionDescriptors(
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

  console.log(`fetchCoinConditionDescriptors: cache miss for ${categoryId} â fetching from eBay Metadata API`);

  try {
    // Step 1: Get app token for Metadata API
    const tokenUrl = apiBase.includes("sandbox")
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";
    const credentials = btoa(`${clientId}:${clientSecret}`);

    console.log(`fetchCoinConditionDescriptors: requesting app token from ${tokenUrl}`);
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
      console.error(`fetchCoinConditionDescriptors: failed to parse token response:`, parseErr);
      return null;
    }

    const appToken = tokenData?.access_token;
    if (!appToken) {
      console.error(`fetchCoinConditionDescriptors: app token response missing access_token. Response:`, tokenData);
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
          metaErrText.slice(0, 300)
        }`,
      );
      return null;
    }

    let metaData;
    try {
      metaData = await metaResp.json();
    } catch (parseErr) {
      console.error(`fetchCoinConditionDescriptors: failed to parse Metadata API response:`, parseErr);
      return null;
    }

    // Step 3: Validate response structure and extract descriptors
    const policies = metaData?.itemConditionPolicies;
    if (!Array.isArray(policies)) {
      console.warn(
        `fetchCoinConditionDescriptors: unexpected Metadata API schema â itemConditionPolicies not an array. Got:`,
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
              const valName = String(val.conditionDescriptorValueName ?? "").trim();
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
      values: Array.from(d.values.entries()).map(([id, name]) => ({ id, name })),
    }));

    console.log(
      `fetchCoinConditionDescriptors: SUCCESS â found ${result.length} descriptors (${descriptorCount} raw, ${valueCount} values) for category ${categoryId}:`,
      result.map((d) => `${d.descriptorName}(${d.descriptorId})[${d.values.length}v]`).join(", "),
    );

    _coinDescriptorCache.set(cacheKey, result);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`fetchCoinConditionDescriptors: EXCEPTION for category ${categoryId}: ${errMsg}`);
    if (e instanceof Error) {
      console.error(`  Stack: ${e.stack?.split("\n").slice(0, 3).join("\n")}`);
    }
    return null;
  }
}

/**
 * CoinConditionDetail type (mirrors pipelineContracts.ts â kept local to avoid shared imports)
 */
interface CoinConditionDetailGraded {
  type: "graded";
  gradingCompany: string;
  grade: string;
  certificationNumber?: string;
}
interface CoinConditionDetailRaw {
  type: "raw";
  rawCondition: string;
}
type CoinConditionDetail = CoinConditionDetailGraded | CoinConditionDetailRaw;

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
 *     â¢ "Uncirculated"
 *     â¢ "Extremely Fine to About Uncirculated"
 *     â¢ "Fine to Very Fine"
 *     â¢ "Below Fine"
 *   - Finds "Coin Condition" descriptor and maps to numeric ID
 *
 * Throws error if validation fails (mandatory compliance).
 * Returns null only if descriptor lookup fails (external API issue).
 */
function buildCoinConditionDescriptors(
  detail: CoinConditionDetail,
  descriptors: Array<{
    descriptorId: string;
    descriptorName: string;
    mode?: string;
    values: Array<{ id: string; name: string }>;
  }>,
): Array<{ name: string; values?: string[]; additionalInfo?: string }> | null {
  const result: Array<{ name: string; values?: string[]; additionalInfo?: string }> = [];

  if (detail.type === "graded") {
    const graded = detail as CoinConditionDetailGraded;

    // Phase 2: Strict company validation
    const allowedCompanies = ["PCGS", "NGC", "ANACS", "ICG", "CAC", "ICCS"];
    if (!allowedCompanies.includes(graded.gradingCompany)) {
      throw new Error(
        `Phase 2 Validation: Grading company "${graded.gradingCompany}" is not allowed. ` +
          `Must be one of: ${allowedCompanies.join(", ")}`,
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
    const graderDesc = descriptors.find(
      (d) => d.descriptorName.toLowerCase().includes("grader"),
    );
    if (!graderDesc) {
      console.error("buildCoinConditionDescriptors: Grader descriptor not found in eBay response");
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
    const letterGradeDesc = descriptors.find(
      (d) => d.descriptorName.toLowerCase().includes("letter grade"),
    );

    if (numberGradeDesc && numberPart) {
      const numVal = numberGradeDesc.values.find(
        (v) => v.name === numberPart || v.name.startsWith(numberPart),
      );
      if (numVal) {
        result.push({ name: numberGradeDesc.descriptorId, values: [numVal.id] });
      } else {
        console.warn(
          `buildCoinConditionDescriptors: no value ID for number grade="${numberPart}". ` +
            `Available: ${numberGradeDesc.values.map((v) => v.name).join(", ")}`,
        );
      }
    }

    if (letterGradeDesc && letterPart) {
      const letterGradeAliases: Record<string, string[]> = {
        "MS": ["mint state", "ms"],
        "PR": ["proof", "pf", "pr"],
        "PF": ["proof", "pf", "pr"],
        "AU": ["about uncirculated", "au"],
        "EF": ["extremely fine", "ef", "xf"],
        "XF": ["extremely fine", "ef", "xf"],
        "VF": ["very fine", "vf"],
        "F": ["fine", "f"],
        "VG": ["very good", "vg"],
        "G": ["good", "g"],
        "AG": ["about good", "ag"],
        "FR": ["fair", "fr"],
        "PO": ["poor", "po"],
        "SP": ["specimen", "sp"],
        "SMS": ["special mint set", "sms"],
        "DCAM": ["deep cameo", "dcam"],
        "CAM": ["cameo", "cam"],
      };
      const aliases = letterGradeAliases[letterPart.toUpperCase()] ?? [letterPart.toLowerCase()];
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
        result.push({ name: letterGradeDesc.descriptorId, values: [letterVal.id] });
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
      console.error("buildCoinConditionDescriptors: Coin Condition descriptor not found in eBay response");
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
      result.push({ name: coinCondDesc.descriptorId, values: [condValueBroad.id] });
      return result;
    }

    result.push({ name: coinCondDesc.descriptorId, values: [condValue.id] });
    return result;
  }
}

// ================================================================
// SECURITY HELPER â caller-identity verification
// ================================================================
// Every action that reads or writes a user's eBay tokens (exchange_code,
// refresh_token, get_stored_token) MUST call this before touching the DB.
// It validates the caller's Supabase JWT and confirms the authenticated
// user is the same person as the claimed userId payload field.
// Without this check any logged-in user could read or overwrite any
// other user's eBay tokens (IDOR).
// ================================================================
async function assertCallerOwnsUser(
  req: Request,
  claimedUserId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
): Promise<void> {
  const authHeader = req.headers.get("Authorization");
  const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!jwt) {
    throw new Error("Unauthorized: missing Authorization header for token action.");
  }
  // Validate the JWT using the service-role client (verifies against project JWT secret).
  const sc = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error: authErr } = await sc.auth.getUser(jwt);
  if (authErr || !user) {
    throw new Error("Unauthorized: invalid or expired session token.");
  }
  if (user.id !== claimedUserId) {
    throw new Error("Unauthorized: userId does not match the authenticated session.");
  }
}

serve(async (req) => {
  initSentry();

  console.log(
    "*** EBAY-PUBLISH FUNCTION STARTED (v24 - Dynamic category aspects from eBay Taxonomy API, hardcoded rules as fallback) ***",
  );

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declare action outside try so the catch block can reference it in error logs.
  let action: string | undefined;

  try {
    console.log(`ebay-publish request: method=${req.method}, url=${req.url}`);

    const requestBody = await req.json();
    let payload: Record<string, unknown>;
    ({ action, ...payload } = requestBody);

    console.log(
      `ebay-publish action: ${action}, payload keys: ${Object.keys(payload).join(", ")}`,
    );
    if (action === "create_draft") {
      console.log(`create_draft payload:`, {
        hasSku: !!payload.sku,
        hasTitle: !!payload.title,
        hasDescription: !!payload.description,
        listingPrice: payload.listingPrice,
        hasUserToken: !!payload.userToken,
      });
    }

    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";

    // Environment diagnostic log â emitted on every invocation to aid debugging.
    // Masks secrets: shows only first 8 chars of clientId, booleans for secrets.
    console.log("ebay-publish invoked:", {
      action,
      ebayEnv,
      hasClientId: !!clientId,
      clientIdPrefix: clientId ? clientId.substring(0, 8) + "..." : "MISSING",
      hasClientSecret: !!clientSecret,
      hasSupabaseUrl: !!Deno.env.get("SUPABASE_URL"),
      hasServiceKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    });

    // NOTE: clientId/clientSecret are only required for actions that call eBay OAuth endpoints
    // (exchange_code, refresh_token, get_auth_url, create_draft, bulk_create_draft).
    // get_stored_token and get_policies only need Supabase credentials, so we defer
    // this check to avoid blocking those actions when eBay app credentials are misconfigured.
    const requiresEbayCredentials = !["get_stored_token", "get_policies", "upload_video", "get_video_status"]
      .includes(action);
    if (requiresEbayCredentials && (!clientId || !clientSecret)) {
      throw new Error("eBay API credentials not configured");
    }

    const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
    const authBase = ebayEnv === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com";
    const tokenUrl = ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

    // --- ACTION: Get OAuth consent URL ---
    if (action === "get_auth_url") {
      const ruName = Deno.env.get("EBAY_RUNAME") ||
        Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) throw new Error("EBAY_RUNAME not configured");

      const scopes = [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly", // Required for dashboard views/analytics
        "https://api.ebay.com/oauth/api_scope/sell.finances", // Required for shipping label cost data
        "https://api.ebay.com/oauth/api_scope/sell.marketing", // Required for eBay Video API
        "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly", // OQ-5: required for Identity API username/accountType lookup
      ].join(" ");

      const authUrl = `${authBase}/oauth2/authorize?` +
        `client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(ruName)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}`;

      console.log("get_auth_url: ruName =", ruName);

      return new Response(JSON.stringify({ authUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- ACTION: Exchange auth code for user token ---
    if (action === "exchange_code") {
      const { code, userId } = payload;
      if (!code) throw new Error("No authorization code provided");

      // Security: verify the caller owns the userId they claim to be storing tokens for.
      if (userId) {
        const _ecUrl = Deno.env.get("SUPABASE_URL");
        const _ecKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_ecUrl && _ecKey) {
          await assertCallerOwnsUser(req, String(userId), _ecUrl, _ecKey);
        }
      }

      const ruName = Deno.env.get("EBAY_RUNAME") ||
        Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) {
        throw new Error(
          "eBay callback URI not configured. Contact admin to set EBAY_RUNAME.",
        );
      }

      console.log(
        "exchange_code: code =",
        code?.substring(0, 20) + "...",
        "env =",
        ebayEnv,
      );

      const credentials = btoa(`${clientId}:${clientSecret}`);

      const resp = await fetchWithTimeout(tokenUrl, {
        method: "POST",
        timeout: 15000,
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: ruName,
        }).toString(),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        let errorMsg = txt;
        try {
          const json = JSON.parse(txt);
          errorMsg = json.error_description || json.error || txt;
        } catch { /* not JSON */ }
        throw new Error(
          `eBay token exchange failed (${resp.status}): ${errorMsg}`,
        );
      }

      const tokenData = await resp.json();

      if (!tokenData.access_token) {
        throw new Error(
          "eBay returned no access token. Authorization code may have expired or been reused.",
        );
      }

      console.log(
        "exchange_code: token obtained, expires in",
        tokenData.expires_in,
        "seconds",
      );

      // --- Store token server-side in Supabase profiles table ---
      // Avoids exposing the token in localStorage (XSS risk).
      // IMPORTANT: Use upsert (not update) so this works even if the profiles row
      // doesn't exist yet. .update() silently affects 0 rows with no error when
      // the row is missing â the token would never be stored server-side, causing
      // get_stored_token to always return null and policies to fail to load.
      if (userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)
              .toISOString();

            // upsert with onConflict: "id" â creates the row if missing, updates if present
            const { error: upsertError } = await supabase
              .from("profiles")
              .upsert(
                {
                  id: userId,
                  ebay_access_token: tokenData.access_token,
                  ebay_refresh_token: tokenData.refresh_token ?? null,
                  ebay_token_expires_at: expiresAt,
                },
                { onConflict: "id" },
              );

            if (upsertError) {
              console.warn(
                "exchange_code: failed to upsert token in profiles:",
                upsertError.message,
              );
            } else {
              // Read-back verification: confirm the token was actually stored
              const { data: verifyData, error: verifyError } = await supabase
                .from("profiles")
                .select("ebay_access_token, ebay_token_expires_at")
                .eq("id", userId)
                .single();

              if (verifyError || !verifyData?.ebay_access_token) {
                console.warn(
                  "exchange_code: upsert succeeded but read-back verification FAILED for user",
                  userId,
                  "verifyError:",
                  verifyError?.message ?? "token null after upsert",
                );
              } else {
                console.log(
                  "exchange_code: token upserted and verified in profiles for user",
                  userId,
                  "expires_at:",
                  verifyData.ebay_token_expires_at,
                );
              }
            }
          }
        } catch (storeErr) {
          // Non-fatal â still return the token to the client as fallback
          console.warn(
            "exchange_code: token storage error (non-fatal):",
            storeErr,
          );
        }
      }

      // --- NEW: Identity API Call + One-Account Rule (OQ-5, OQ-3) ---
      // Call eBay Identity API to fetch username and account type (exchange_code only, not on refresh)
      // One-account enforcement: block different username if tier is not Unlimited
      try {
        // Resolve credentials here â supabaseUrl/supabaseServiceKey declared above are const-scoped
        // inside the token-storage try block, so we must re-read them from env for this scope.
        const _identitySupabaseUrl = Deno.env.get("SUPABASE_URL");
        const _identityServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const _stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
        const identityBase = ebayEnv === "production" ? "https://apiz.ebay.com" : "https://apiz.sandbox.ebay.com";

        const identityRes = await fetch(
          `${identityBase}/commerce/identity/v1/user/`,
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
        );
        if (!identityRes.ok) {
          const identityErrText = await identityRes.text();
          throw new Error(
            `Identity API failed (${identityRes.status}): ${identityErrText}`,
          );
        }
        const identity = await identityRes.json();
        const newUsername = identity?.userId ?? identity?.username ?? null;
        const accountType = (identity?.accountType ?? "")?.toLowerCase() ??
          "individual";

        // Determine tier for one-account enforcement (OQ-3: gate on LA subscription, not eBay account type)
        // Fetch the eBay user's email from the identity payload (or from the Supabase profile)
        let tierForOneAccountCheck: "starter" | "pro" | "unlimited" = "starter";
        let _userEmailForStripe: string | null = null;
        if (userId && _identitySupabaseUrl && _identityServiceKey) {
          try {
            const _sc = createClient(_identitySupabaseUrl, _identityServiceKey);
            const { data: profileData } = await _sc
              .from("profiles")
              .select("email")
              .eq("id", userId)
              .maybeSingle();
            _userEmailForStripe = profileData?.email ?? null;
          } catch { /* non-fatal */ }
        }
        if (_userEmailForStripe && _stripeSecretKey) {
          try {
            const { default: Stripe } = await import(
              "https://esm.sh/stripe@18.5.0"
            );
            const stripe = new Stripe(_stripeSecretKey, {
              apiVersion: "2025-08-27.basil",
            });
            const customers = await stripe.customers.list({
              email: _userEmailForStripe,
              limit: 1,
            });
            if (customers.data.length > 0) {
              const subs = await stripe.subscriptions.list({
                customer: customers.data[0].id,
                status: "active",
                limit: 1,
              });
              if (subs.data.length > 0) {
                const productId = subs.data[0].items.data[0].price.product;
                if (productId === "prod_U70aT1KvuI2uDx") {
                  tierForOneAccountCheck = "unlimited";
                } else if (productId === "prod_U6zUiC1SYuPrGU") {
                  tierForOneAccountCheck = "pro";
                }
              }
            }
          } catch (stripeE) {
            console.error("Stripe check in exchange_code failed:", stripeE);
          }
        }

        // Check for existing eBay username (one-account rule for non-Unlimited)
        if (userId && _identitySupabaseUrl && _identityServiceKey) {
          const supabase = createClient(
            _identitySupabaseUrl,
            _identityServiceKey,
          );
          const { data: existingProfile } = await supabase
            .from("profiles")
            .select("ebay_username")
            .eq("id", userId)
            .single();

          if (
            existingProfile?.ebay_username &&
            existingProfile.ebay_username !== newUsername &&
            tierForOneAccountCheck !== "unlimited"
          ) {
            return new Response(
              JSON.stringify({
                error: "account_already_linked",
                message:
                  `This Listing Assistant account is already linked to eBay user "${existingProfile.ebay_username}". Disconnect it before connecting a new account.`,
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }

          // Store username and account type
          const { error: usernameErr } = await supabase
            .from("profiles")
            .update({
              ebay_username: newUsername,
              ebay_account_type: accountType,
            })
            .eq("id", userId);

          if (usernameErr) {
            console.warn(
              "exchange_code: failed to store eBay username:",
              usernameErr.message,
            );
          } else {
            console.log(
              "exchange_code: stored eBay username for user",
              userId,
              ":",
              newUsername,
            );
          }
        }
      } catch (identityErr) {
        console.error("Identity API call failed (non-fatal):", identityErr);
        // Still return token to client â identity info is supplementary
      }

      return new Response(
        JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- ACTION: Silently refresh eBay access token using stored refresh token ---
    if (action === "refresh_token") {
      const { userId } = payload;
      if (!userId) throw new Error("No userId provided");

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase credentials not configured");
      }

      // Security: verify the caller owns the userId before rotating their token.
      await assertCallerOwnsUser(req, String(userId), supabaseUrl, supabaseServiceKey);

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select("ebay_refresh_token")
        .eq("id", userId)
        .single();

      if (error || !data?.ebay_refresh_token) {
        return new Response(
          JSON.stringify({
            token: null,
            error: "No refresh token available. Please reconnect eBay.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const credentials = btoa(`${clientId}:${clientSecret}`);
      const refreshResp = await fetchWithTimeout(tokenUrl, {
        method: "POST",
        timeout: 15000,
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: data.ebay_refresh_token,
          scope: [
            "https://api.ebay.com/oauth/api_scope",
            "https://api.ebay.com/oauth/api_scope/sell.inventory",
            "https://api.ebay.com/oauth/api_scope/sell.account",
            "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
            "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
            "https://api.ebay.com/oauth/api_scope/sell.finances",
            "https://api.ebay.com/oauth/api_scope/sell.marketing",
          ].join(" "),
        }).toString(),
      });

      if (!refreshResp.ok) {
        const txt = await refreshResp.text();
        console.error(
          "refresh_token: eBay refresh failed:",
          refreshResp.status,
          txt,
        );
        return new Response(
          JSON.stringify({
            token: null,
            error: `Token refresh failed (${refreshResp.status}). Please reconnect eBay.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const tokenData = await refreshResp.json();
      if (!tokenData.access_token) {
        return new Response(
          JSON.stringify({
            token: null,
            error: "eBay returned no access token during refresh.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Store the new access token (and new refresh token if provided)
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)
        .toISOString();
      const updatePatch: Record<string, string> = {
        ebay_access_token: tokenData.access_token,
        ebay_token_expires_at: expiresAt,
      };
      if (tokenData.refresh_token) {
        updatePatch.ebay_refresh_token = tokenData.refresh_token;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update(updatePatch)
        .eq("id", userId);

      if (updateError) {
        console.warn(
          "refresh_token: failed to store refreshed token:",
          updateError.message,
        );
      } else {
        console.log(
          "refresh_token: token refreshed and stored for user",
          userId,
          "expires at",
          expiresAt,
        );
      }

      return new Response(
        JSON.stringify({
          token: tokenData.access_token,
          expiresIn: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- ACTION: Get stored eBay token for a user (with proactive refresh) ---
    if (action === "get_stored_token") {
      const { userId } = payload;
      if (!userId) throw new Error("No userId provided");

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Supabase credentials not configured");
      }

      // Security: verify the caller owns the userId before returning their stored token.
      await assertCallerOwnsUser(req, String(userId), supabaseUrl, supabaseServiceKey);

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "ebay_access_token, ebay_token_expires_at, ebay_refresh_token, postal_code, city",
        )
        .eq("id", userId)
        .single();

      console.log("get_stored_token: database query result", {
        userId,
        hasData: !!data,
        queryError: error?.message,
        dbPostalCode: data?.postal_code || "NULL",
        dbCity: (data as any)?.city || "NULL",
        dbCityType: typeof (data as any)?.city,
      });

      if (error || !data) {
        console.warn(
          "get_stored_token: no profile found or query error for user",
          userId,
        );
        return new Response(
          JSON.stringify({ token: null, postalCode: null, city: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const now = new Date();
      const expiresAt = data.ebay_token_expires_at ? new Date(data.ebay_token_expires_at) : null;
      // Consider token expired if it expires within 5 minutes (proactive refresh window)
      const REFRESH_BUFFER_MS = 5 * 60 * 1000;
      const isExpiredOrExpiringSoon = expiresAt ? expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS : true;

      // Proactively refresh if token is expired or expiring within 5 minutes
      if (isExpiredOrExpiringSoon && data.ebay_refresh_token) {
        console.log(
          "get_stored_token: token expiring soon, attempting proactive refresh for user",
          userId,
        );
        // Skip proactive refresh if eBay app credentials are not configured
        if (!clientId || !clientSecret) {
          console.warn(
            "get_stored_token: skipping proactive refresh â eBay credentials not configured",
          );
          return new Response(
            JSON.stringify({
              token: data.ebay_access_token,
              postalCode: data.postal_code,
              city: (data as any).city ?? null,
              isExpired: false,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        try {
          const credentials = btoa(`${clientId}:${clientSecret}`);
          const refreshResp = await fetchWithTimeout(tokenUrl, {
            method: "POST",
            timeout: 15000,
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: data.ebay_refresh_token,
              scope: [
                "https://api.ebay.com/oauth/api_scope",
                "https://api.ebay.com/oauth/api_scope/sell.inventory",
                "https://api.ebay.com/oauth/api_scope/sell.account",
                "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
                "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
                "https://api.ebay.com/oauth/api_scope/sell.finances",
                "https://api.ebay.com/oauth/api_scope/sell.marketing",
              ].join(" "),
            }).toString(),
          });

          if (refreshResp.ok) {
            const tokenData = await refreshResp.json();
            if (tokenData.access_token) {
              const newExpiresAt = new Date(
                Date.now() + tokenData.expires_in * 1000,
              ).toISOString();
              const updatePatch: Record<string, string> = {
                ebay_access_token: tokenData.access_token,
                ebay_token_expires_at: newExpiresAt,
              };
              if (tokenData.refresh_token) {
                updatePatch.ebay_refresh_token = tokenData.refresh_token;
              }
              await supabase.from("profiles").update(updatePatch).eq(
                "id",
                userId,
              );
              console.log(
                "get_stored_token: proactive refresh succeeded, new expiry:",
                newExpiresAt,
              );

              return new Response(
                JSON.stringify({
                  token: tokenData.access_token,
                  postalCode: data.postal_code,
                  city: (data as any).city ?? null,
                  isExpired: false,
                  refreshed: true,
                }),
                {
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }
          } else {
            console.warn(
              "get_stored_token: proactive refresh failed:",
              refreshResp.status,
            );
          }
        } catch (refreshErr) {
          console.warn(
            "get_stored_token: proactive refresh error (non-fatal):",
            refreshErr,
          );
        }

        // Refresh failed â return null so caller triggers re-auth
        return new Response(
          JSON.stringify({
            token: null,
            postalCode: data.postal_code,
            city: (data as any).city ?? null,
            isExpired: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          token: data.ebay_access_token,
          postalCode: data.postal_code,
          city: (data as any).city ?? null,
          isExpired: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- ACTION: Upload video to eBay Video API ---
    if (action === "upload_video") {
      const { userToken, videoUrl, title: videoTitle, fileSize, contentType } = payload;
      if (!userToken) throw new Error("No eBay user token provided");
      if (!videoUrl) throw new Error("No videoUrl provided");

      // Step 1: Create the video entity in eBay
      const createResp = await fetchWithTimeout(`${apiBase}/sell/marketing/v1_beta/video`, {
        method: "POST",
        timeout: 15000,
        headers: { Authorization: `Bearer ${userToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: videoTitle || "Item Video", size: Number(fileSize) || 0 }),
      });
      if (!createResp.ok) {
        const e = await createResp.text();
        throw new Error(`eBay video create failed (${createResp.status}): ${e}`);
      }
      const createData = await createResp.json();
      const videoId = createData.videoId;
      if (!videoId) throw new Error("eBay returned no videoId");
      console.log(`upload_video: created eBay video entity videoId=${videoId}`);

      // Step 2: Fetch video bytes from Supabase Storage
      const videoFetchResp = await fetch(videoUrl as string);
      if (!videoFetchResp.ok) {
        throw new Error(`Failed to fetch video from storage (${videoFetchResp.status})`);
      }

      // Step 3: Upload bytes to eBay (no short timeout â large files may take minutes)
      const uploadResp = await fetch(`${apiBase}/sell/marketing/v1_beta/video/${videoId}/upload`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": (contentType as string) || "video/mp4",
          ...(fileSize ? { "Content-Length": String(fileSize) } : {}),
        },
        body: videoFetchResp.body,
      });
      if (!uploadResp.ok && uploadResp.status !== 204) {
        const e = await uploadResp.text();
        throw new Error(`eBay video upload failed (${uploadResp.status}): ${e}`);
      }
      console.log(`upload_video: bytes uploaded for videoId=${videoId}, httpStatus=${uploadResp.status}`);

      return new Response(JSON.stringify({ videoId, status: "PENDING" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- ACTION: Get eBay video processing status ---
    if (action === "get_video_status") {
      const { userToken, videoId } = payload;
      if (!userToken) throw new Error("No eBay user token provided");
      if (!videoId) throw new Error("No videoId provided");

      const statusResp = await fetchWithTimeout(`${apiBase}/sell/marketing/v1_beta/video/${videoId}`, {
        timeout: 10000,
        headers: { Authorization: `Bearer ${userToken}`, "Accept-Language": "en-US" },
      });
      if (!statusResp.ok) {
        const e = await statusResp.text();
        throw new Error(`eBay get video status failed (${statusResp.status}): ${e}`);
      }
      const statusData = await statusResp.json();
      console.log(`get_video_status: videoId=${videoId} status=${statusData.videoStatus}`);

      return new Response(JSON.stringify({ videoId, status: statusData.videoStatus }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- ACTION: Publish a single draft to eBay ---
    if (action === "create_draft") {
      const {
        userId,
        userToken,
        sku: incomingSku,
        title,
        description,
        listingFormat,
        listingPrice,
        auctionStartPrice,
        auctionBuyItNow,
        auctionDuration,
        imageUrl,
        imageUrls,
        condition,
        ebayCategoryId,
        itemSpecifics,
        postalCode,
        city: payloadCity,
        fulfillmentPolicyId: draftFulfillmentPolicyId,
        paymentPolicyId: draftPaymentPolicyId,
        returnPolicyId: draftReturnPolicyId,
        bestOfferEnabled,
        bestOfferAutoAcceptPrice,
        bestOfferAutoDeclinePrice,
        quantity: payloadQuantity,
        pricingMode,
        ebayVideoId: payloadEbayVideoId,
        packageWeightAndSize: payloadPackageWeightAndSize,
      } = payload;

      if (!userToken) throw new Error("No eBay user token provided");

      console.log(
        `create_draft: starting publish - title="${title}", format=${listingFormat}, env=${ebayEnv}`,
      );
      console.log(
        `create_draft: received condition from payload: ${condition}`,
      );
      console.log(
        `create_draft: postalCode from payload:`,
        postalCode,
        `city from payload:`,
        payloadCity,
      );
      console.log(
        `create_draft: _debug_postalCode:`,
        payload._debug_postalCode,
        `_debug_city:`,
        payload._debug_city,
      );
      console.log(
        `create_draft: received ebayCategoryId=${ebayCategoryId}, condition=${condition}, itemSpecifics=${
          JSON.stringify(itemSpecifics || {})
        }`,
      );
      console.log(
        `create_draft: itemSpecifics received:`,
        JSON.stringify(itemSpecifics || {}, null, 2),
      );

      // Generate sequential SKU using atomic database counter.
      // If client provided a SKU, use it (for backwards compatibility on retry).
      // Otherwise, atomically increment the user's next_sku_sequence counter if userId is available.
      // If userId is missing (old frontend code before refresh), fall back to random SKU.
      let sku = incomingSku;
      if (!sku) {
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
              const { data: seqNum, error: seqError } = await supabase
                .rpc("increment_sku_sequence", { user_id: userId });

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
            "create_draft: userId not provided (old frontend code) â will use random SKU fallback",
          );
        }

        // Fallback to random SKU if sequential generation didn't work or userId was missing
        if (!sku) {
          sku = `LA-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
          console.log(`create_draft: using fallback random SKU: ${sku}`);
        }
      }

      console.log(`create_draft: sku=${sku}`);

      // ----------------------------------------------------------------
      // GRAIN BAR CATEGORY OVERRIDE
      // eBay policy (errorId 25019) requires all grain bars to be listed in
      // category 3360 (Coins & Paper Money > Bullion > Gold > Other).
      // Detect grain bars by checking title/description for "grain" keywords.
      // ----------------------------------------------------------------
      function isGrainBar(title: string, description?: string): boolean {
        const combinedText = (title + " " + (description || "")).toLowerCase();
        const grainPatterns = /\b(grain|grains)\b/;
        return grainPatterns.test(combinedText);
      }

      let finalCategoryId = ebayCategoryId;
      if (isGrainBar(title, description)) {
        finalCategoryId = "3360"; // Coins & Paper Money > Bullion > Gold > Other
        console.log(
          `create_draft: GRAIN BAR DETECTED - overriding category ${ebayCategoryId} -> ${finalCategoryId}`,
        );
      }

      // Build direct eBay listing URL (no affiliate wrapping)
      const buildAffiliateUrl = (listingId: string): string | null => {
        try {
          return `https://www.ebay.com/itm/${listingId}`;
        } catch {
          return null;
        }
      };

      // Build eBay-formatted item specifics (aspects) using the category-aware
      // normalisation engine. This handles:
      //   - C: prefix normalisation (AI may omit it)
      //   - Fineness format: "999 fine" / "99.9%" -> "0.999"
      //   - Grade format: "MS-65" -> "MS 65"
      //   - Denomination: "Half Dollar" -> "50C", "One Dollar" -> "$1"
      //   - Circulated/Uncirculated: derived from grade if missing
      //   - Required aspect safety-fill (Certification, Circulated/Uncirculated)
      //   - Fixed values for known categories (Composition, Fineness for silver dollars, etc.)
      //   - Drops placeholder values (none / unknown / n/a / other / etc.)

      // ââ DYNAMIC ASPECT RULES ââââââââââââââââââââââââââââââââââââââââââ
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
            (dynamicRule.required.length > 0 ||
              dynamicRule.preferred.length > 0)
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
          const ruleTreeType = detectCategoryTreeSync(
            categoryForAspects,
            undefined,
          );
          if (!categoryForAspects) {
            // No category at all â use empty rule (generic normalization only)
            console.warn(
              `create_draft: no category ID provided, using empty aspect rule`,
            );
            categoryForAspects = "__empty__";
          } else if (ruleTreeType === "coin" || ruleTreeType === "bullion") {
            // Known coin/bullion type not in CATEGORY_ASPECT_RULES â use empty rule.
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

      const aspects = buildAndNormalizeAspects(
        (itemSpecifics && typeof itemSpecifics === "object" ? itemSpecifics : {}) as Record<string, unknown>,
        categoryForAspects,
      );

      // Clean up temporary dynamic rule from the map
      if (dynamicRuleApplied) {
        delete CATEGORY_ASPECT_RULES[categoryForAspects];
      }

      console.log(
        `create_draft: aspects built for category ${finalCategoryId}:`,
        JSON.stringify(aspects, null, 2),
      );

      // ââ Coin-condition â Certification aspect bridge ââââââââââââââââââââââââ
      // If no Certification aspect was resolved (not in itemSpecifics, not in dynamic
      // or hardcoded defaults), derive it from _coinConditionDetail.
      // Covers any coin/bullion category where eBay requires Certification but the
      // category-level defaults did not set it.
      if (!aspects["Certification"]) {
        const _bridgeIS = itemSpecifics && typeof itemSpecifics === "object"
          ? (itemSpecifics as Record<string, unknown>)
          : {};
        const _ccd = _bridgeIS._coinConditionDetail as
          | { type?: string; graded?: { company?: string } }
          | null
          | undefined;
        if (_ccd) {
          if (_ccd.type === "graded" && _ccd.graded?.company) {
            aspects["Certification"] = [_ccd.graded.company];
            console.log(
              `create_draft: bridged Certification="${_ccd.graded.company}" from graded coin condition detail`,
            );
          } else if (_ccd.type === "raw") {
            aspects["Certification"] = ["Uncertified"];
            console.log(
              `create_draft: bridged Certification="Uncertified" from raw coin condition detail`,
            );
          }
        }
      }

      // Get the final normalized certification value from aspects (already normalized above)
      const finalCertValue = aspects["Certification"]?.[0];

      // Sanitize description: fix JS-blocked words (errorId 25002)
      const sanitizedDescription = sanitizeDescription(description as string);
      if (sanitizedDescription !== description) {
        console.log(
          `create_draft: description sanitized - replaced eBay-blocked patterns (errorId 25002 prevention)`,
        );
      }

      // Strip grade patterns from title & description if coin is not certified (errorId 25019)
      // eBay scans title and description text for grade patterns even when Grade aspect is dropped
      const finalTitle = stripGradesIfUncertified(
        title as string,
        finalCertValue,
      );
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

      // Extract the item Type (e.g., "Coin", "Round", "Bar") from itemSpecifics
      // This is used to disambiguate coins from bullion when validating conditions
      const itemType = itemSpecifics && typeof itemSpecifics === "object"
        ? (itemSpecifics as Record<string, unknown>).Type as string | undefined
        : undefined;

      // Build package weight for calculated-shipping policies.
      // eBay may reject publish with errorId 25020 when weight is missing.
      const toPositiveNumber = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      const inferWeightLbFromSpecifics = (
        specifics: unknown,
      ): number | null => {
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

        // Max 3.9 lb â USPS Ground Coins and most coin shipping services cap at 4 lb.
        // Precious metal content is used as a proxy for item weight, but large bars/lots
        // can produce values that exceed service limits. We cap here to be safe; a UI
        // weight field is the long-term solution.
        const MAX_SHIP_LB = 3.9;

        const ozMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(oz|ounce|ounces|troy\s*oz|toz)\b/);
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
      };

      let packageWeightAndSize: Record<string, unknown> | null = null;
      if (payloadPackageWeightAndSize && typeof payloadPackageWeightAndSize === "object") {
        const incoming = payloadPackageWeightAndSize as Record<string, unknown>;
        const incomingWeight = incoming.weight && typeof incoming.weight === "object"
          ? (incoming.weight as Record<string, unknown>)
          : null;
        const incomingDimensions = incoming.dimensions && typeof incoming.dimensions === "object"
          ? (incoming.dimensions as Record<string, unknown>)
          : (incoming.dimension && typeof incoming.dimension === "object"
            ? (incoming.dimension as Record<string, unknown>)
            : null);
        const incomingValue = toPositiveNumber(incomingWeight?.value);

        const dimLength = toPositiveNumber(incomingDimensions?.length);
        const dimWidth = toPositiveNumber(incomingDimensions?.width);
        const dimHeight = toPositiveNumber(incomingDimensions?.height);
        const normalizedDimensions = (dimLength && dimWidth && dimHeight)
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
      }

      // Resolve category tree type once in function scope so all downstream
      // condition/category logic can safely reuse it.
      const categoryTreeType = detectCategoryTreeSync(
        finalCategoryId ?? "",
        itemType,
      );

      // Map internal condition string to numeric conditionId
      // eBay Inventory API accepts ConditionEnum strings, but many categories
      // also require the numeric conditionId. We send both for maximum compatibility.
      // Migrate any legacy deprecated condition codes to current equivalents,
      // then normalize based on the category and item type (e.g., LIKE_NEW not valid for coins).
      const rawCondition = condition || "USED_EXCELLENT";
      const { condition: normalizedCondition, corrected } = normalizeConditionForCategory(
        rawCondition,
        finalCategoryId,
        itemType,
        categoryTreeType,
      );
      let conditionEnum = normalizedCondition;
      let conditionId = CONDITION_ID_MAP[conditionEnum];
      let effectiveConditionEnum = conditionEnum;
      let conditionDesc = CONDITION_DESCRIPTIONS[conditionEnum] ??
        conditionEnum.replace(/_/g, " ").toLowerCase()
          .replace(/\b\w/g, (c: string) => c.toUpperCase());

      if (
        (!conditionId ||
          ["DIGITAL_GOOD", "CERTIFIED_PRE_OWNED", "REMANUFACTURED", "RETREAD", "DAMAGED"].includes(conditionEnum)) &&
        finalCategoryId
      ) {
        const dynamicConditions = await fetchDynamicCategoryConditions(finalCategoryId);
        const matchedCondition = dynamicConditions.find((candidate) =>
          normalizeConditionDescriptorToEnum(candidate.conditionDescription) === conditionEnum
        );
        if (matchedCondition) {
          conditionId = matchedCondition.conditionId;
          conditionDesc = matchedCondition.conditionDescription;
          conditionEnum = normalizeConditionDescriptorToEnum(matchedCondition.conditionDescription) || conditionEnum;
        }
      }

      conditionId = conditionId ?? 3000;
      let effectiveConditionId = conditionId;

      console.log(
        `create_draft: condition normalization - rawCondition=${rawCondition}, normalized=${normalizedCondition}, conditionId=${conditionId}, categoryId=${finalCategoryId}, corrected=${corrected}`,
      );

      if (corrected) {
        console.log(
          `create_draft: condition auto-corrected from ${rawCondition} to ${normalizedCondition} for category ${finalCategoryId}`,
        );
      }

      // NOTE: Accept-Language must be explicitly set to "en-US".
      // Deno's runtime auto-injects the system locale when this header is omitted,
      // sending an invalid value that eBay rejects with errorId 25709.
      // Explicitly providing "en-US" overrides Deno's injected value.
      const authHeaders = {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
      };

      // Step 1: Ensure inventory location exists before creating the item.
      // The item's shipToLocationAvailability references this location by key,
      // so it must exist first.
      const effectivePostalCode = postalCode || "60601"; // fallback to Chicago if not set
      const effectiveCity = payloadCity || ""; // city may be empty but will be omitted in address if so
      console.log("create_draft: inventory location setup", {
        receivedPostalCode: postalCode || "NOT_SET",
        receivedCity: payloadCity || "NOT_SET",
        effectivePostalCode,
        effectiveCity,
        isFallback: !postalCode,
      });
      const merchantLocationKey = await ensureInventoryLocation(
        apiBase,
        userToken,
        effectivePostalCode,
        effectiveCity,
      );

      // Step 2: Create/update inventory item (PUT is idempotent â safe to retry)
      // NOTE: description goes in the OFFER (listingDescription), not the inventory item.
      // The inventory item holds product data; the offer holds listing-specific data.

      // Resolve imageUrl: eBay rejects base64 data: URLs (errorId 25721).
      // Upload to Supabase Storage if needed to get a public HTTPS URL.
      // Support multiple images: prefer `imageUrls` array if provided, else fall back to singular `imageUrl` for compatibility.
      const resolvedImageUrls: string[] = [];
      const incomingImageUrls = Array.isArray(imageUrls) && imageUrls.length > 0
        ? imageUrls
        : (imageUrl ? [imageUrl as string] : []);
      if (incomingImageUrls.length > 0) {
        console.log(
          `create_draft: received ${incomingImageUrls.length} image(s) â resolving to public URLs`,
        );
        for (const img of incomingImageUrls) {
          let resolved = img as string;
          if (resolved?.startsWith("data:")) {
            console.log(
              "create_draft: image is base64 data URL â uploading to storage",
            );
            resolved = await uploadDataUrlToStorage(resolved);
            if (resolved.startsWith("data:")) {
              console.error(
                "create_draft: one image upload failed â skipping this image",
              );
              continue;
            }
          }
          if (resolved) resolvedImageUrls.push(resolved);
        }
      }

      // IMPORTANT: condition and conditionDescription belong at the ROOT level
      // of the inventory item body, NOT inside product. Placing them inside product
      // causes eBay error 25021 ("Item condition is required for this category")
      // at publish time, even though the offer creation succeeds.
      // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
      const inventoryBody: Record<string, unknown> = {
        product: {
          title: finalTitle,
          imageUrls: resolvedImageUrls,
        },
        condition: conditionEnum,
        conditionDescription: conditionDesc,
        packageWeightAndSize,
        availability: {
          // shipToLocationAvailability: use only the top-level quantity.
          // availabilityDistributions is for multi-warehouse sellers and causes
          // eBay error 25604 ("Availability not found") for standard single-location accounts.
          shipToLocationAvailability: {
            quantity: Number(payloadQuantity) || 1,
          },
        },
      };

      // ââ Trading card: inject Card Condition item specific (eBay errorId 40001) ââââ
      // eBay requires "Card Condition" as an item specific for trading card categories
      // even though the Sell form marks it optional. Derive from effectiveConditionEnum
      // if the AI/user did not already supply it in itemSpecifics.
      if (categoryTreeType === "trading_card" && !aspects["Card Condition"]) {
        const CARD_CONDITION_MAP: Record<string, string> = {
          USED_VERY_GOOD: "Very Good",
          USED_GOOD: "Good",
          USED_ACCEPTABLE: "Poor",
        };
        const cardCond = CARD_CONDITION_MAP[effectiveConditionEnum];
        if (cardCond) {
          aspects["Card Condition"] = [cardCond];
          console.log(
            `create_draft: injected Card Condition="${cardCond}" for trading card category ${finalCategoryId} (condition=${effectiveConditionEnum})`,
          );
        }
      }

      // Add aspects (item specifics) to the product
      if (Object.keys(aspects).length > 0) {
        (inventoryBody.product as Record<string, unknown>).aspects = aspects;
      }

      // Add video if it has been uploaded and is LIVE on eBay
      if (payloadEbayVideoId) {
        (inventoryBody.product as Record<string, unknown>).videoIds = [String(payloadEbayVideoId)];
        console.log(`create_draft: attaching ebayVideoId=${payloadEbayVideoId} to product.videoIds`);
      }

      // ââ eBay June 2026 Coin Condition Descriptors (MANDATORY) ââââââââââââââââââ
      // Extract coinConditionDetail stored under itemSpecifics._coinConditionDetail
      // and translate it to the numeric conditionDescriptors array required by
      // the eBay Inventory API v1.18.5 for coin categories (253, 256, 3377, 4733, 18466 and all descendants).
      const rawItemSpecifics = (
        itemSpecifics && typeof itemSpecifics === "object" ? itemSpecifics : {}
      ) as Record<string, unknown>;
      const coinConditionDetailRaw = rawItemSpecifics._coinConditionDetail as
        | CoinConditionDetail
        | null
        | undefined;

      // Coin categories MUST provide condition details per eBay June 2026 mandate.
      // categoryTreeType="coin" is detected via breadcrumb patterns and includes all descendants
      // of parent categories 253, 256, 3377, 4733, 18466.
      // Three-layer coin detection for the June 2026 conditionDescriptors mandate:
      //  1. categoryTreeType === "coin"  — covers HARDCODED_COIN_CATEGORY_IDS (expanded above)
      //  2. coinConditionDetailRaw != null — frontend sent _coinConditionDetail, which it only
      //     does for coin/bullion categories, so its presence is a reliable coin signal
      //  3. _domain === "coins_bullion" — Gemini Pass-1 classified the item as coin/bullion;
      //     catches any category ID not yet in the hardcoded list
      const publishDomain = rawItemSpecifics._domain as string | undefined;
      const isCoinDescriptorCategory =
        categoryTreeType === "coin" ||
        coinConditionDetailRaw != null ||
        publishDomain === "coins_bullion";

      // VALIDATION: Coin listings in our positively-identified hardcoded list MUST have condition
      // details before we even attempt to publish. For secondary signals (_coinConditionDetail
      // present, or _domain = coins_bullion), we don't throw here — we proceed optimistically
      // and let eBay validate. This prevents blocking edge-case bullion/bar categories that
      // are tagged coins_bullion but don't actually need conditionDescriptors.
      if (categoryTreeType === "coin" && !coinConditionDetailRaw) {
        throw new Error(
          `Coin listings in category ${finalCategoryId} require detailed condition information per eBay June 2026 mandate. ` +
            `Please specify either a certified grade (PCGS, NGC, ANACS, ICG, CAC, ICCS) or a raw condition tier (Uncirculated, Extremely Fine, etc.) before publishing.`,
        );
      }

      if (coinConditionDetailRaw && isCoinDescriptorCategory && clientId && clientSecret) {
        try {
          console.log(
            `create_draft: MANDATORY: fetching coin condition descriptors for category ${finalCategoryId}, type=${coinConditionDetailRaw.type}`,
          );

          let descriptors: any[] | null = null;
          let lastError: Error | null = null;

          // Retry logic: attempt up to 2 times for transient failures
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              descriptors = await fetchCoinConditionDescriptors(
                finalCategoryId,
                clientId,
                clientSecret,
                apiBase,
              );
              if (descriptors && descriptors.length > 0) {
                break; // Success, exit retry loop
              }
            } catch (retryErr) {
              lastError = retryErr as Error;
              console.warn(
                `create_draft: Metadata API attempt ${attempt} failed. ${
                  attempt < 2 ? "Retrying..." : "Will fail after this attempt."
                }`,
                lastError.message,
              );
              if (attempt < 2) {
                // Wait 500ms before retry
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }
          }

          if (descriptors && descriptors.length > 0) {
            const conditionDescriptors = buildCoinConditionDescriptors(
              coinConditionDetailRaw,
              descriptors,
            );
            if (conditionDescriptors && conditionDescriptors.length > 0) {
              inventoryBody.conditionDescriptors = conditionDescriptors;
              console.log(
                `create_draft: MANDATORY: added ${conditionDescriptors.length} conditionDescriptors for coin category ${finalCategoryId}:`,
                JSON.stringify(conditionDescriptors),
              );
            } else {
              // FAIL: Could not map user condition to eBay descriptor values.
              // This is a data integrity issue, not a soft warning.
              throw new Error(
                `Could not map condition details (type: ${coinConditionDetailRaw.type}) to eBay descriptor values for category ${finalCategoryId}. ` +
                  `Verify the grade, company, or raw condition value is valid and try again.`,
              );
            }
          } else if (lastError !== null) {
            // FAIL: Metadata API calls threw exceptions â genuine transient failure.
            // Distinguish this from the "API responded with 0 descriptors" case below.
            throw new Error(
              `Unable to retrieve coin condition descriptors from eBay for category ${finalCategoryId} after 2 attempts. ` +
                `Error: ${lastError.message}. ` +
                `This may be a temporary service issue. Please try again or contact support.`,
            );
          } else {
            // eBay Metadata API responded successfully but returned 0 condition descriptors
            // for this category (e.g. Proof Sets 41109, 166679). This means the category is
            // NOT subject to the June 2026 condition descriptor mandate â proceed without them.
            console.log(
              `create_draft: category ${finalCategoryId} returned 0 condition descriptors from eBay ` +
                `Metadata API â not subject to the condition descriptor mandate, skipping.`,
            );
          }
        } catch (cdErr) {
          // Fatal: Coin condition descriptor error blocks the listing.
          // Phase 3: Enhanced error logging for monitoring and debugging
          const errorMessage = cdErr instanceof Error ? cdErr.message : String(cdErr);
          console.error(`create_draft: FATAL coin descriptor error:`, {
            message: errorMessage,
            stack: cdErr instanceof Error ? cdErr.stack : undefined,
            category: finalCategoryId,
            conditionType: coinConditionDetailRaw?.type,
            timestamp: new Date().toISOString(),
          });
          throw cdErr;
        }
      }
      // ââ End Coin Condition Descriptors (MANDATORY) ââââââââââââââââââââââââââââ

      console.log(
        `create_draft: creating inventory item for sku=${sku}, condition=${conditionEnum} (raw=${rawCondition}), merchantLocationKey=${merchantLocationKey}`,
      );
      console.log(
        `create_draft: inventory body condition:`,
        JSON.stringify({
          condition: conditionEnum,
          conditionDescription: conditionDesc,
          packageWeightAndSize,
        }),
      );

      const inventoryResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
        {
          method: "PUT",
          timeout: 15000,
          headers: authHeaders,
          body: JSON.stringify(inventoryBody),
        },
      );

      if (!inventoryResp.ok) {
        const errText = await inventoryResp.text();
        console.error(
          "create_draft: eBay inventory error:",
          inventoryResp.status,
          errText,
        );
        console.error(
          "create_draft: inventory request body:",
          JSON.stringify(inventoryBody, null, 2),
        );
        throw new Error(
          `Failed to create inventory item: ${inventoryResp.status} - ${errText}`,
        );
      }

      console.log(
        `create_draft: inventory item created successfully for sku=${sku}`,
      );

      // Step 3: Fetch business policies (use draft-level if set, else auto-fetch first)
      const fetchDefaultPolicy = async (
        policyType: string,
      ): Promise<string | null> => {
        const resp = await fetchWithTimeout(
          `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
          { headers: authHeaders, timeout: 15000 },
        );
        if (!resp.ok) {
          console.warn(`Could not fetch ${policyType} policies:`, resp.status);
          return null;
        }
        const data = await resp.json();
        const policies = data[`${policyType}Policies`] ||
          data[`${policyType}Policy`] || [];
        if (Array.isArray(policies) && policies.length > 0) {
          console.log(`Using ${policyType} policy: ${policies[0].name}`);
          return policies[0][`${policyType}PolicyId`] || null;
        }
        return null;
      };

      // Fetch policies â paymentPolicyId is optional for managed payments sellers.
      // Most eBay sellers enrolled in managed payments do NOT need a payment policy.
      // We only require fulfillment and return policies.
      const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
        draftFulfillmentPolicyId ? Promise.resolve(draftFulfillmentPolicyId) : fetchDefaultPolicy("fulfillment"),
        draftPaymentPolicyId ? Promise.resolve(draftPaymentPolicyId) : fetchDefaultPolicy("payment"),
        draftReturnPolicyId ? Promise.resolve(draftReturnPolicyId) : fetchDefaultPolicy("return"),
      ]);

      // Only fulfillment and return policies are required; payment policy is optional
      if (!fulfillmentPolicyId || !returnPolicyId) {
        const missing = [
          !fulfillmentPolicyId && "Fulfillment (Shipping)",
          !returnPolicyId && "Return",
        ].filter(Boolean).join(", ");

        console.error(
          `create_draft: missing required policies for sku ${sku}: ${missing}. draftFulfillment=${draftFulfillmentPolicyId}, draftReturn=${draftReturnPolicyId}`,
        );

        return new Response(
          JSON.stringify({
            error:
              `Missing required eBay business policies: ${missing}. Please create these policies in your eBay Seller Hub (https://www.ebay.com/sh/ovw/policies) before publishing.`,
            missingPolicies: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      console.log(
        `create_draft: policies fetched - fulfillment=${fulfillmentPolicyId}, return=${returnPolicyId}, payment=${
          paymentPolicyId || "NONE"
        }`,
      );

      // Step 4: Build offer payload
      // IMPORTANT: The eBay Inventory API (REST) only supports FIXED_PRICE format.
      // Auction listings require the legacy Trading API (XML-based) which is a
      // separate integration path. Attempting to pass format: "AUCTION" to the
      // Inventory API will result in a 400 error.
      // See: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
      if (listingFormat === "AUCTION") {
        console.error(
          `create_draft: auction format requested but not supported by Inventory API for sku=${sku}`,
        );
        return new Response(
          JSON.stringify({
            error: "Auction format is not supported by the eBay Inventory API. " +
              "Please change the listing format to Fixed Price, or use the eBay " +
              "Seller Hub to create auction listings manually.",
            auctionNotSupported: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const offerBody = buildFixedPriceOffer({
        sku,
        description: htmlDescription,
        listingPrice: (() => {
          const rawQty = Number(payloadQuantity) || 1;
          const rawPrice = Number(listingPrice ?? 0);
          return (pricingMode === "total" && rawQty > 1) ? rawPrice / rawQty : rawPrice;
        })(),
        quantity: Number(payloadQuantity) || 1,
        condition: conditionEnum,
        conditionDescription: conditionDesc,
        ebayCategoryId: finalCategoryId || undefined,
        merchantLocationKey,
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
        bestOfferEnabled: bestOfferEnabled === true,
        bestOfferAutoAcceptPrice: Number(bestOfferAutoAcceptPrice) || undefined,
        bestOfferAutoDeclinePrice: Number(bestOfferAutoDeclinePrice) ||
          undefined,
      });

      console.log(
        `create_draft: built offer for sku=${sku}, price=${listingPrice}, category=${finalCategoryId || "NONE"}`,
      );
      console.log(
        `create_draft: offer body categories - categoryId in offer=${
          (offerBody as Record<string, unknown>).categoryId || "MISSING"
        }`,
      );
      console.log(
        `create_draft: offer body:`,
        JSON.stringify(offerBody, null, 2),
      );

      const offerResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/offer`,
        {
          method: "POST",
          timeout: 15000,
          headers: authHeaders,
          body: JSON.stringify(offerBody),
        },
      );

      let offerId: string | undefined;
      let offerData: Record<string, unknown> | null = null;

      if (!offerResp.ok) {
        const errText = await offerResp.text();
        console.error(
          "create_draft: eBay offer error:",
          offerResp.status,
          errText,
        );
        console.error(
          "create_draft: offer request body:",
          JSON.stringify(offerBody, null, 2),
        );

        // Check if this is errorId 25002 â offer already exists.
        // This can happen if a previous publish attempt created the offer but failed at publish step.
        // When this happens, UPDATE the existing offer with the corrected payload (PUT /offer/{offerId})
        // to ensure any fixes (e.g., condition, policies) take effect before publishing.
        try {
          const errJson = JSON.parse(errText);
          const offerExists = Array.isArray(errJson.errors) &&
            errJson.errors.some((e: { errorId: number }) => e.errorId === 25002);
          if (offerExists) {
            const offerIdParam = errJson.errors[0]?.parameters?.find(
              (p: { name: string; value: string }) => p.name === "offerId",
            );
            if (offerIdParam?.value) {
              offerId = offerIdParam.value;
              console.log(
                `create_draft: offer already exists (errorId 25002), updating existing offerId=${offerId} before publish`,
              );
              // Update the existing offer so our corrected payload takes effect
              const updateResp = await fetchWithTimeout(
                `${apiBase}/sell/inventory/v1/offer/${offerId}`,
                {
                  method: "PUT",
                  timeout: 15000,
                  headers: authHeaders,
                  body: JSON.stringify(offerBody),
                },
              );
              if (!updateResp.ok) {
                const updateErrText = await updateResp.text();
                console.warn(
                  `create_draft: offer update failed (non-fatal), will still attempt publish: ${updateResp.status} - ${updateErrText}`,
                );
              } else {
                console.log(
                  `create_draft: existing offer ${offerId} updated successfully`,
                );
              }
            }
          }
        } catch {
          // Not JSON or missing offerId â fall through to throw
        }

        if (!offerId) {
          throw new Error(
            `Failed to create offer: ${offerResp.status} - ${errText}`,
          );
        }
      } else {
        offerData = await offerResp.json();
        offerId = offerData.offerId;
        console.log(
          `create_draft: offer created successfully, offerId=${offerId}, about to publish...`,
        );
      }

      console.log(`create_draft: proceeding to publish offerId=${offerId}...`);

      // Step 5: Publish the offer to make it a live listing.
      // The publish endpoint does NOT accept a request body â condition is already
      // set on the inventory item (root level). Sending extra body fields causes
      // unexpected behavior. POST with no body is the correct usage.
      // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/publishOffer
      let publishResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
        {
          method: "POST",
          timeout: 15000,
          headers: authHeaders,
        },
      );

      // Auto-recovery for eBay errorId 25021 (invalid CONDITION_ID for category).
      // Some coin categories reject specific USED_* variants at publish-time even if
      // inventory/offer creation succeeded. Retry with safer fallbacks before failing.
      if (!publishResp.ok) {
        const firstErrText = await publishResp.text();
        let isConditionIdError = false;
        try {
          const parsed = JSON.parse(firstErrText);
          const errs: Array<{ errorId?: number; message?: string }> = parsed?.errors ?? [];
          isConditionIdError = errs.some((e) =>
            e.errorId === 25021 || /CONDITION_ID|condition id is invalid/i.test(e.message ?? "")
          );
        } catch {
          isConditionIdError = /CONDITION_ID|condition id is invalid/i.test(firstErrText);
        }

        if (isConditionIdError && offerId) {
          const candidates = categoryTreeType === "coin"
            ? ["USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE", "NEW"]
            : categoryTreeType === "bullion"
            ? ["NEW", "USED_GOOD"]
            : ["USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE"];

          const retryConditions = candidates.filter((c) => c !== effectiveConditionEnum);

          console.warn(
            `create_draft: publish failed with invalid condition for category ${finalCategoryId}; retrying with fallbacks: ${
              retryConditions.join(", ")
            }`,
          );

          for (const retryCondition of retryConditions) {
            const retryDescription = CONDITION_DESCRIPTIONS[retryCondition] ??
              retryCondition.replace(/_/g, " ").toLowerCase()
                .replace(/\b\w/g, (ch: string) => ch.toUpperCase());

            const retryInventoryBody: Record<string, unknown> = {
              ...inventoryBody,
              condition: retryCondition,
              conditionDescription: retryDescription,
            };

            const invRetryResp = await fetchWithTimeout(
              `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
              {
                method: "PUT",
                timeout: 15000,
                headers: authHeaders,
                body: JSON.stringify(retryInventoryBody),
              },
            );

            if (!invRetryResp.ok) {
              const invRetryErr = await invRetryResp.text();
              console.warn(
                `create_draft: retry inventory update failed for condition=${retryCondition}: ${invRetryResp.status} ${
                  invRetryErr.slice(0, 200)
                }`,
              );
              continue;
            }

            const retryOfferBody: Record<string, unknown> = {
              ...(offerBody as Record<string, unknown>),
              condition: retryCondition,
              conditionDescription: retryDescription,
            };

            const offerRetryResp = await fetchWithTimeout(
              `${apiBase}/sell/inventory/v1/offer/${offerId}`,
              {
                method: "PUT",
                timeout: 15000,
                headers: authHeaders,
                body: JSON.stringify(retryOfferBody),
              },
            );

            if (!offerRetryResp.ok) {
              const offerRetryErr = await offerRetryResp.text();
              console.warn(
                `create_draft: retry offer update failed for condition=${retryCondition}: ${offerRetryResp.status} ${
                  offerRetryErr.slice(0, 200)
                }`,
              );
              continue;
            }

            const publishRetryResp = await fetchWithTimeout(
              `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
              {
                method: "POST",
                timeout: 15000,
                headers: authHeaders,
              },
            );

            if (publishRetryResp.ok) {
              publishResp = publishRetryResp;
              effectiveConditionEnum = retryCondition;
              effectiveConditionId = CONDITION_ID_MAP[retryCondition] ?? 3000;
              console.log(
                `create_draft: publish retry succeeded with condition=${effectiveConditionEnum} (id=${effectiveConditionId})`,
              );
              break;
            }

            const publishRetryErr = await publishRetryResp.text();
            console.warn(
              `create_draft: publish retry failed for condition=${retryCondition}: ${publishRetryResp.status} ${
                publishRetryErr.slice(0, 200)
              }`,
            );
            publishResp = publishRetryResp;
          }
        } else {
          // Preserve original failed response body for downstream handling.
          publishResp = new Response(firstErrText, {
            status: publishResp.status,
            statusText: publishResp.statusText,
            headers: publishResp.headers,
          });
        }
      }

      if (!publishResp.ok) {
        const errText = await publishResp.text();
        console.error(
          "create_draft: eBay publish error:",
          publishResp.status,
          errText,
        );
        console.error(
          "create_draft: failing to publish offer",
          offerId,
          "for sku",
          sku,
        );
        console.error(
          `create_draft: publish failed with condition=${effectiveConditionEnum} (id=${effectiveConditionId}), category=${finalCategoryId}, format=${listingFormat}`,
        );
        // Deficiency #8: Demote category mapping on publish failure
        // IMPORTANT: Only demote for errors that indicate a genuinely bad category
        // or condition mismatch. Do NOT demote for transient eBay server errors
        // (errorId 25001 = "Core Inventory Service internal error") or rate limits,
        // as those are eBay-side issues unrelated to our category choice.
        // errorId 25002 is OVERLOADED by eBay â it can mean:
        //   (a) "Invalid condition for category"  â demotable, condition error
        //   (b) "Seller monthly listing limit exceeded"  â NOT demotable, account limit
        //   (c) "Country of Origin value too long"  â NOT demotable, data error
        //   (d) "Missing required item specific"  â NOT demotable, data error
        // We detect seller-limit flavor by checking message text for known keywords.
        const SELLER_LIMIT_PATTERNS = [
          /exceed.*amount.*you can list/i,
          /selling limit/i,
          /monthly.*limit/i,
          /list.*more.*this month/i,
          /\$[\d,]+.*more.*total sales/i,
        ];
        const DEMOTABLE_ERROR_IDS = new Set([
          21919288, // Invalid category ID
          25004, // Category not supported
          21916585, // Category requires item specifics
          25017, // Leaf category required
          25021, // Invalid condition id for selected category
          // NOTE: 25002 intentionally excluded â handled below with message-text check
        ]);
        let shouldDemote = false;
        let isSellerLimitError = false;
        let parsedErrJson: any = null;
        try {
          parsedErrJson = JSON.parse(errText);
          const errors: Array<{ errorId?: number; message?: string }> = parsedErrJson?.errors ?? [];
          const errorIds: number[] = errors.map((e) => e.errorId ?? 0);

          // Check for seller limit flavor of 25002 first
          for (const e of errors) {
            if (e.errorId === 25002 && SELLER_LIMIT_PATTERNS.some((p) => p.test(e.message ?? ""))) {
              isSellerLimitError = true;
              console.warn(
                `create_draft: errorId 25002 is a SELLER LIMIT error (not condition/category) â skipping demotion. Message: ${
                  e.message?.slice(0, 120)
                }`,
              );
              // Undo any demotion that may have already fired for this category
              // (previous code versions incorrectly demoted on seller limit errors)
              try {
                const _repairUrl = Deno.env.get("SUPABASE_URL");
                const _repairKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
                if (_repairUrl && _repairKey && finalCategoryId) {
                  await fetch(`${_repairUrl}/functions/v1/category-lookup`, {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${_repairKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      action: "promote",
                      categoryId: finalCategoryId,
                    }),
                  });
                  console.log(
                    `create_draft: auto-promoted category ${finalCategoryId} to repair incorrect demotion from seller limit error`,
                  );
                }
              } catch (repairErr) {
                console.warn("create_draft: category repair failed (non-fatal):", repairErr);
              }
              break;
            }
          }

          // Only demote for known category/condition mismatch errors, never for 500s or seller limit
          if (!isSellerLimitError && publishResp.status !== 500) {
            shouldDemote = errorIds.some((id) => DEMOTABLE_ERROR_IDS.has(id));
            // 25002 is demotable ONLY when it is NOT a seller limit error
            const has25002 = errorIds.includes(25002);
            if (has25002 && !isSellerLimitError) {
              // Check all 25002 errors in this response â if any is NOT a seller limit, it's a condition error
              const conditionError = errors.some(
                (e) => e.errorId === 25002 && !SELLER_LIMIT_PATTERNS.some((p) => p.test(e.message ?? "")),
              );
              if (conditionError) shouldDemote = true;
            }
          }

          if (!shouldDemote) {
            console.warn(
              `create_draft: skipping category demotion for ${finalCategoryId} â not a category/condition error (HTTP ${publishResp.status}, sellerLimit=${isSellerLimitError})`,
            );
          }
        } catch (_parseErr) {
          // If we can't parse the error body, skip demotion
          shouldDemote = false;
        }
        if (shouldDemote) {
          try {
            const _supabaseUrl = Deno.env.get("SUPABASE_URL");
            const _serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (_supabaseUrl && _serviceKey && finalCategoryId) {
              await fetch(`${_supabaseUrl}/functions/v1/category-lookup`, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${_serviceKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: "demote",
                  categoryId: finalCategoryId,
                  itemType: payload.itemType || "",
                  itemTypeNormalized: payload.itemTypeNormalized || "", // EA-P3-A: precise row targeting
                  reason: `publish_failed_${publishResp.status}`,
                }),
              });
              console.warn(
                `create_draft: demoted category mapping for ${finalCategoryId} after publish failure`,
              );
            }
          } catch (demoteErr) {
            console.warn(
              "create_draft: demote call failed (non-fatal):",
              demoteErr,
            );
          }
        }

        // Provide a user-friendly error message based on the error type
        // Re-use parsedErrJson from the demotion block above (already parsed)
        let userFriendlyError: string;
        try {
          const firstError = parsedErrJson?.errors?.[0];
          const errorId = firstError?.errorId;
          const rawMsg = String(firstError?.message ?? "");
          const policyBlockText = `${rawMsg} ${errText}`;
          const isPolicyBlocked =
            /norfed liberty dollars|counterfeit coins policy|not permitted on ebay|do not attempt to relist/i
              .test(policyBlockText);

          if (isPolicyBlocked) {
            userFriendlyError =
              "eBay blocked this listing due to policy restrictions (NORFED Liberty Dollars / Counterfeit Coins policy). This item type cannot be listed on eBay. Please choose a different item.";
          } else if (publishResp.status === 500 || errorId === 25001) {
            userFriendlyError =
              "eBay is experiencing a temporary issue. Please wait a minute and try publishing again. Your listing details are saved.";
          } else if (isSellerLimitError) {
            // Extract the human-readable portion of the seller limit message
            const limitMatch = rawMsg.match(/You can list up to ([$\d,.]+) more[^.]*\./i);
            const remaining = limitMatch ? limitMatch[1] : null;
            userFriendlyError = remaining
              ? `Your eBay account has reached its monthly selling limit. You have ${remaining} of listing capacity remaining this month. Visit eBay's Selling Limits page to request an increase.`
              : "Your eBay account has reached its monthly selling limit. Please visit eBay's Selling Limits page to request an increase before listing high-value items.";
          } else if (errorId === 25002) {
            userFriendlyError =
              "The selected condition is not valid for this category. Please adjust the condition and try again.";
          } else if (errorId === 21919288 || errorId === 25004 || errorId === 25017) {
            userFriendlyError =
              "The selected category is not valid for this item. Please choose a different category and try again.";
          } else {
            userFriendlyError = firstError?.message || `Publish failed: ${publishResp.status}. Please try again.`;
          }
        } catch (_) {
          userFriendlyError = publishResp.status === 500
            ? "eBay is experiencing a temporary issue. Please wait a minute and try publishing again."
            : `Publish failed: ${publishResp.status}. Please try again.`;
        }

        return new Response(
          JSON.stringify({
            error: userFriendlyError,
            offerId,
            sku,
            publishFailed: true,
            // Seller limit errors are also "transient" from listing perspective â not a listing defect
            isTransientError: publishResp.status === 500 || isSellerLimitError,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const publishData = await publishResp.json();
      const listingId = publishData.listingId ||
        (offerData as any)?.listing?.listingId || null;

      // Build affiliate URL â non-fatal, wrapped in try/catch
      const affiliateUrl = listingId ? buildAffiliateUrl(listingId) : null;

      console.log(
        `create_draft: Successfully published: listingId=${listingId}, offerId=${offerId}, sku=${sku}, publishData keys: ${
          Object.keys(publishData).join(", ")
        }`,
      );

      // Deficiency #8: Promote category mapping on publish success
      try {
        const _supabaseUrl = Deno.env.get("SUPABASE_URL");
        const _serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_supabaseUrl && _serviceKey && finalCategoryId) {
          await fetch(`${_supabaseUrl}/functions/v1/category-lookup`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${_serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "promote",
              categoryId: finalCategoryId,
              itemType: payload.itemType || "",
              itemTypeNormalized: payload.itemTypeNormalized || "", // EA-P3-A: precise row targeting
            }),
          });
          console.log(
            `create_draft: promoted category mapping for ${finalCategoryId}`,
          );
        }
      } catch (promoteErr) {
        console.warn(
          "create_draft: promote call failed (non-fatal):",
          promoteErr,
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          offerId,
          sku,
          listingId,
          affiliateUrl,
          message: "Listing published live on eBay!",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- ACTION: Bulk publish multiple drafts (server-side loop) ---
    if (action === "bulk_create_draft") {
      const { userId, userToken, drafts, postalCode } = payload;
      if (!userToken) throw new Error("No eBay user token provided");
      if (!Array.isArray(drafts) || drafts.length === 0) {
        throw new Error("No drafts provided for bulk publish");
      }

      const results: Array<{
        draftId: string;
        success: boolean;
        listingId?: string;
        offerId?: string;
        sku?: string;
        affiliateUrl?: string;
        error?: string;
      }> = [];

      for (const draft of drafts) {
        try {
          const singleResp = await fetch(req.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: req.headers.get("Authorization") || "",
            },
            body: JSON.stringify({
              action: "create_draft",
              ...(userId ? { userId } : {}),
              userToken,
              postalCode,
              ...draft,
            }),
          });

          const singleData = await singleResp.json();

          if (singleData.success) {
            results.push({
              draftId: draft.draftId,
              success: true,
              listingId: singleData.listingId,
              offerId: singleData.offerId,
              sku: singleData.sku,
              affiliateUrl: singleData.affiliateUrl,
            });
          } else {
            results.push({
              draftId: draft.draftId,
              success: false,
              error: singleData.error || "Unknown error",
            });
          }
        } catch (err) {
          results.push({
            draftId: draft.draftId,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const errorCount = results.filter((r) => !r.success).length;

      return new Response(
        JSON.stringify({
          results,
          successCount,
          errorCount,
          message: `${successCount} of ${drafts.length} listings published to eBay`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- ACTION: Fetch eBay business policies for a user token ---
    // Consolidated here to avoid CORS issues with the separate ebay-policies function.
    // The ebay-publish function already has correct CORS headers and is proven to work.
    if (action === "get_policies") {
      const { userToken, userId } = payload;

      // If no userToken provided directly, try to fetch it from server-side storage
      let resolvedToken = userToken;
      if (!resolvedToken && userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const { createClient } = await import(
              "https://esm.sh/@supabase/supabase-js@2"
            );
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const { data } = await supabase
              .from("profiles")
              .select("ebay_access_token")
              .eq("id", userId)
              .single();
            if (data?.ebay_access_token) resolvedToken = data.ebay_access_token;
          }
        } catch (e) {
          console.warn("get_policies: could not fetch token from profiles:", e);
        }
      }

      if (!resolvedToken) {
        // Return empty policies rather than throwing â lets the UI show "no policies" gracefully
        return new Response(
          JSON.stringify({
            fulfillment: [],
            payment: [],
            returns: [],
            noToken: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // NOTE: Accept-Language must be explicitly set to "en-US".
      // Deno's runtime auto-injects the system locale when this header is omitted,
      // sending an invalid value that eBay rejects with errorId 25709.
      // Explicitly providing "en-US" overrides Deno's injected value.
      const authHeaders = {
        Authorization: `Bearer ${resolvedToken}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
      };

      // Fetch each policy type independently so one failure doesn't kill all three.
      // Returns { policies, error } â error is non-null if the fetch failed.
      const fetchPoliciesSafe = async (
        policyType: string,
      ): Promise<
        { policies: Array<{ id: string; name: string }>; error: string | null }
      > => {
        try {
          const resp = await fetchWithTimeout(
            `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
            { headers: authHeaders, timeout: 15000 },
          );
          if (!resp.ok) {
            const errText = await resp.text();
            console.warn(
              `get_policies: ${policyType} policy fetch failed (${resp.status}):`,
              errText,
            );
            return {
              policies: [],
              error: `${policyType} policies unavailable (HTTP ${resp.status})`,
            };
          }
          const data = await resp.json();
          const key = `${policyType}Policies`;
          const rawPolicies = data[key] || [];
          const policies = rawPolicies.map((p: Record<string, string>) => ({
            id: p[`${policyType}PolicyId`] || p.policyId || "",
            name: p.name || "(unnamed)",
          }));
          console.log(
            `get_policies: fetched ${policies.length} ${policyType} policies`,
          );
          return { policies, error: null };
        } catch (fetchErr) {
          console.warn(
            `get_policies: ${policyType} policy fetch threw:`,
            fetchErr,
          );
          return { policies: [], error: `${policyType} policies fetch error` };
        }
      };

      // Run all three fetches concurrently; each is independently error-isolated
      const [fulfillmentResult, paymentResult, returnsResult] = await Promise
        .all([
          fetchPoliciesSafe("fulfillment"),
          fetchPoliciesSafe("payment"),
          fetchPoliciesSafe("return"),
        ]);

      // Collect any per-type errors for the client to display
      const policyErrors: Record<string, string> = {};
      if (fulfillmentResult.error) {
        policyErrors.fulfillment = fulfillmentResult.error;
      }
      if (paymentResult.error) policyErrors.payment = paymentResult.error;
      if (returnsResult.error) policyErrors.returns = returnsResult.error;

      return new Response(
        JSON.stringify({
          fulfillment: fulfillmentResult.policies,
          payment: paymentResult.policies,
          returns: returnsResult.policies,
          ...(Object.keys(policyErrors).length > 0 ? { policyErrors } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Unknown error";
    // Include action in error log so we can identify which handler threw
    // (action may be undefined if JSON parsing itself failed)
    const actionLabel = action ?? "unknown";
    console.error(
      `ebay-publish error [action=${actionLabel}]:`,
      errorMsg,
      e instanceof Error ? e.stack : "",
    );
    captureException(e, { function: "ebay-publish", action: actionLabel });

    // Only treat as a 400 client error for explicit configuration/input problems.
    // eBay API error strings (e.g. "Failed to create inventory item: 400 - {...}")
    // must NOT match here â they should be 500s so the client knows it's a server-side
    // eBay API failure, not a missing-parameter problem on the client side.
    const isClientError = errorMsg.includes("not configured") ||
      errorMsg.includes("not provided") ||
      errorMsg.includes("No authorization code") ||
      errorMsg.includes("No userId provided") ||
      errorMsg.includes("No drafts provided") ||
      errorMsg.includes("No eBay user token provided");

    return new Response(
      JSON.stringify({ error: errorMsg, action: actionLabel }),
      {
        status: isClientError ? 400 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
