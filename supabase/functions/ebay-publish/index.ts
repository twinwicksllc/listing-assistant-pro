import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Force redeploy v19: fix inventory location update — when location exists, PATCH to update city/postal_code instead of reusing stale address
// Force redeploy v17: fix errorId 25002 for category 45243 (World Coins) - Brand removed from NON_ASPECT_KEYS, Color updated to include BM (Bi-Metallic) for non-copper coins
// Force redeploy v15: shipping location from profile — city+postalCode passed to ensureInventoryLocation; fallback NYC→Chicago
// Force redeploy v14: fix errorId 25002 "Country of Origin value too long" — drop Country of Origin if value > 65 chars or contains sentence punctuation (AI hallucination guard)
// Force redeploy v13: fix errorId 25005 "not a leaf category" for US Mint Proof Sets — correct category 253→41109 (US Coin Proof Sets), add CATEGORY_ASPECT_RULES for 41109 and 526
// fineness/denomination/grade normalisation, required-aspect safety-fill (PR #118)

// ================================================================
// CATEGORY ASPECT RULES
// ================================================================
// Defines required and preferred aspects for the 10 "template" categories.
// For ANY other category the app falls through to generic normalisation.
// ================================================================

interface AspectRule {
  required: string[];
  preferred: string[];
  defaults: Record<string, string>;
  fixedValues?: Record<string, string>;
}

const CATEGORY_ASPECT_RULES: Record<string, AspectRule> = {
  // Gold Bars & Rounds
  "178906": {
    required: [],
    preferred: ["Shape", "Precious Metal Content per Unit", "Brand/Mint", "Fineness"],
    defaults: {},
    fixedValues: { "Composition": "Gold" },
  },
  // Silver Bars & Rounds
  "39489": {
    required: [],
    preferred: ["Shape", "Precious Metal Content per Unit", "Brand/Mint", "Fineness"],
    defaults: {},
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
    preferred: ["Year", "Strike Type", "Mint Location", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "$1" },
    fixedValues: { "Denomination": "$1" },
  },
  // Morgan Dollars 1878-1921
  "39464": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Composition", "Year", "Mint Location", "Strike Type", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "$1" },
    fixedValues: { "Denomination": "$1", "Composition": "Silver", "Fineness": "0.900" },
  },
  // Peace Dollars 1921-1935
  "11980": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "$1" },
    fixedValues: { "Denomination": "$1", "Composition": "Silver", "Fineness": "0.900" },
  },
  // Barber Half Dollars 1892-1915
  "11971": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "50C" },
    fixedValues: { "Denomination": "50C", "Composition": "Silver", "Fineness": "0.900" },
  },
  // Liberty Walking Half Dollars 1916-1947
  "41099": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "50C" },
    fixedValues: { "Denomination": "50C", "Composition": "Silver", "Fineness": "0.900" },
  },
  // Kennedy Half Dollars (1964-present) - Coins & Paper Money > US Coins
  "41102": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "50C" },
    fixedValues: { "Denomination": "50C" },
  },
  // Franklin Half Dollars (1948-1963) - Coins & Paper Money > US Coins
  "11973": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Fineness", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Denomination": "50C" },
    fixedValues: { "Denomination": "50C", "Composition": "Silver", "Fineness": "0.900" },
  },
  // American Silver Eagle
  "41111": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Strike Type", "Denomination"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Uncirculated", "Denomination": "$1" },
    fixedValues: { "Denomination": "$1", "Composition": "Silver", "Fineness": "0.999" },
  },
  // Copper Rounds (non-legal-tender) - Coins & Paper Money > Bullion > Other Bullion
  "166679": {
    required: ["Certification", "Circulated/Uncirculated", "Type"],
    preferred: ["Year", "Composition", "Fineness", "Denomination", "Brand/Mint"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown", "Type": "Round" },
    fixedValues: { "Composition": "Copper" },
  },
  // US Coin Proof Sets
  "41109": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Strike Type", "Country/Region of Manufacture"],
    defaults: { "Certification": "U.S. Mint", "Circulated/Uncirculated": "Uncirculated", "Strike Type": "Proof", "Country/Region of Manufacture": "United States" },
  },
  // US Coin Mint Sets (uncirculated)
  "526": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Country/Region of Manufacture"],
    defaults: { "Certification": "U.S. Mint", "Circulated/Uncirculated": "Uncirculated", "Country/Region of Manufacture": "United States" },
  },
  // US Coins General (catch-all fallback for any US coin category)
  "253": {
    required: ["Certification", "Circulated/Uncirculated"],
    preferred: ["Year", "Mint Location", "Denomination", "Strike Type", "Fineness"],
    defaults: { "Certification": "Uncertified", "Circulated/Uncirculated": "Unknown" },
  },
  // World Coins (general)
  "45243": {
    required: [],
    preferred: ["Year", "Denomination", "Composition", "Circulated/Uncirculated", "Certification", "Grade", "KM Number", "Country of Origin", "Materials sourced from", "Color", "Fineness", "Strike Type"],
    defaults: { "Certification": "Uncertified" },
  },
};

// ================================================================
// VALID ASPECT VALUES
// ================================================================
const VALID_ASPECT_VALUES: Record<string, Set<string>> = {
  "Certification": new Set([
    "Uncertified", "PCGS", "NGC", "PCGS & CAC", "NGC & CAC",
    "U.S. Mint", "ANACS", "ICG", "CAC", "ICCS",
  ]),
  "Circulated/Uncirculated": new Set(["Uncirculated", "Circulated", "Unknown"]),
  "Shape": new Set(["Bar", "Round"]),
  "Strike Type": new Set([
    "Business", "Proof", "Proof-Like", "Deep Mirror Proof-Like", "Satin", "Matte",
  ]),
  "Composition": new Set([
    "Gold", "Silver", "Platinum", "Palladium", "Bronze", "Copper", "Nickel", "Steel", "Zinc",
    "Brass", "Aluminum", "Bimetallic", "Copper-Nickel", "Copper Clad", "Zinc Plated Steel",
  ]),
  // Copper coin color designations (used in World Coins and US Copper coins)
  "Color": new Set(["RD", "RB", "BN", "BM"]),  // BM = Bi-Metallic
};

// ================================================================
// ASPECT NORMALISATION HELPERS
// ================================================================

const ASPECT_SKIP_VALUES = new Set([
  "none", "unknown", "n/a", "other", "unspecified", "not applicable",
  "unknown/not applicable", "not specified",
  // "Ungraded" is not a valid Sheldon-scale grade — eBay treats any grade value on an
  // uncertified coin as a numerical-grade policy violation (errorId 25019).  Drop it.
  "ungraded",
]);

function normalizeFineness(value: string): string {
  const v = value.trim();
  if (/^0\.\d{2,5}$/.test(v)) return v;
  if (/^\d{3,5}$/.test(v)) {
    const n = parseInt(v, 10);
    const decimals = v.length === 3 ? 3 : v.length === 4 ? 4 : 5;
    return (n / Math.pow(10, decimals)).toFixed(decimals);
  }
  const pct = v.match(/^(\d+\.?\d*)\s*%$/);
  if (pct) return (parseFloat(pct[1]) / 100).toFixed(3);
  const dec = v.match(/\b(0\.\d{2,5})\b/);
  if (dec) return dec[1];
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
    "1/20 oz", "1/10 oz", "1/4 oz", "1/2 oz",
    "1 oz", "2 oz", "5 oz", "10 oz", "1 kilo",
    "1 g", "2 g", "2.5 g", "5 g", "10 g", "20 g",
    "25 g", "50 g", "100 g", "250 g", "500 g", "1000 g",
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
      [1, "1 g"], [2, "2 g"], [2.5, "2.5 g"], [5, "5 g"], [10, "10 g"],
      [20, "20 g"], [25, "25 g"], [50, "50 g"], [100, "100 g"],
      [250, "250 g"], [500, "500 g"], [1000, "1000 g"],
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
      "1/20": "1/20 oz", "1/10": "1/10 oz", "1/4": "1/4 oz",
      "1/2": "1/2 oz", "1": "1 oz", "2": "2 oz", "5": "5 oz",
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
      [1, "1 g"], [2, "2 g"], [2.5, "2.5 g"], [5, "5 g"], [10, "10 g"],
      [20, "20 g"], [25, "25 g"], [50, "50 g"], [100, "100 g"],
      [250, "250 g"], [500, "500 g"], [1000, "1000 g"],
    ];
    for (const [target, label] of gramMapOz) {
      if (Math.abs(gramsFromOz - target) / target < 0.03) return label;
    }

    // Map decimal oz values to eBay fraction strings
    const ozFractionMap: [number, string][] = [
      [0.05,  "1/20 oz"],
      [0.10,  "1/10 oz"],
      [0.25,  "1/4 oz"],
      [0.50,  "1/2 oz"],
      [1.0,   "1 oz"],
      [2.0,   "2 oz"],
      [5.0,   "5 oz"],
      [10.0,  "10 oz"],
      [32.15, "1 kilo"],
    ];
    for (const [target, label] of ozFractionMap) {
      if (Math.abs(ozVal - target) / target < 0.10) return label;
    }

    return `${ozVal} oz`;
  }

  // Step 4: Handle "1 kilo" variants
  if (/^1\s*kilo(?:gram)?$/i.test(stripped) || /^1000\s*g(?:rams?)?$/i.test(stripped)) {
    return "1 kilo";
  }

  // Fallback: return stripped value (removed "Troy" at minimum)
  return stripped;
}

const ASPECT_KEY_ALIASES: Record<string, string> = {
  "Circulated/Uncirculated":         "Circulated/Uncirculated",
  "CirculatedUncirculated":          "Circulated/Uncirculated",
  "Mint Location":                   "Mint Location",
  "MintLocation":                    "Mint Location",
  "Strike Type":                     "Strike Type",
  "StrikeType":                      "Strike Type",
  "KM Number":                       "KM Number",
  "KMNumber":                        "KM Number",
  "Precious Metal Content per Unit": "Precious Metal Content per Unit",
  "PreciousMetalContentperUnit":     "Precious Metal Content per Unit",
  "Metal Content":                   "Precious Metal Content per Unit",
  "Brand/Mint":                      "Brand/Mint",
  "Manufacturer/Mint":               "Brand/Mint",
  "Fineness":                        "Fineness",
  "Certification":                   "Certification",
  "Denomination":                    "Denomination",
  "Composition":                     "Composition",
  "Year":                            "Year",
  "Shape":                           "Shape",
  "Grade":                           "Grade",
  "Coin":                            "Coin",
  "Coin Type":                       "Coin",
  "Coin/Bullion Type":               "Coin",
  "Country of Origin":               "Country of Origin",
  "Country/Region of Manufacture":   "Country of Origin",
  "Total Precious Metal Content":    "Total Precious Metal Content",
  "Certification Number":            "Certification Number",
  "Variety":                         "Variety",
  "Era":                             "Era",
  "Cleaned/Uncleaned":               "Cleaned/Uncleaned",
  "Provenance":                      "Provenance",
  // These were previously in NON_ASPECT_KEYS; now pass through as real eBay aspects:
  "Type":                            "Type",       // required by 261068 (Silver Bullion Coins) — errorId 25002
  "Color":                           "Color",      // used by 45243 (World Coins) for copper/bronze coins
  "Materials sourced from":          "Materials sourced from",
  "Brand":                           "Brand",      // required by 45243 (World Coins) — errorId 25002 when missing
};

const NON_ASPECT_KEYS = new Set([
  // "Type" removed — eBay bullion categories (e.g. 261068 Silver Bullion Coins) require
  // "Type" as a real aspect (errorId 25002 when missing).  It must pass through to the
  // Inventory API rather than being silently dropped.
  // "Color" removed — world coins category 45243 uses Color (RD/RB/BN) as a real eBay aspect.
  // "Brand" removed — world coins category 45243 requires Brand as a real eBay aspect (errorId 25002 when missing).
  "Material", "Size", "Mintage",
  "Series", "Modified Item", "Mint Mark",
]);

function normalizeAspectKey(key: string): string {
  // eBay Inventory API expects BARE keys (Fineness, Grade, Year — NOT C:Fineness etc.)
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
    else if (key === "Denomination") value = normalizeDenomination(trimmed, categoryId);
    else if (key === "Precious Metal Content per Unit") value = normalizePreciousMetalContent(trimmed);
    else if (key === "Circulated/Uncirculated") {
      const gradeHint = (rawSpecifics["Grade"] as string) || undefined;
      value = normalizeCirculatedUncirculated(trimmed, gradeHint);
    }

    // eBay hard limit for Country of Origin is 65 characters.
    // Guard against AI hallucination where description text is placed in this field:
    // drop the value if it exceeds 65 chars OR contains sentence-like punctuation
    // (periods, commas in long strings) that no valid country name would ever contain.
    if (key === "Country of Origin") {
      const looksLikeSentence = value.length > 65 || /[.!?]/.test(value) || (value.includes(",") && value.length > 40);
      if (looksLikeSentence) {
        console.warn(`buildAndNormalizeAspects: dropping Country of Origin — value looks like AI-generated text (${value.length} chars): "${value.slice(0, 80)}..."`);
        continue;
      }
    }

    if (VALID_ASPECT_VALUES[key] && !VALID_ASPECT_VALUES[key].has(value)) {
      console.warn(`buildAndNormalizeAspects: invalid value "${value}" for ${key} — skipping`);
      continue;
    }

    aspects[key] = [value];
  }

  // Apply fixed values for known categories (override AI output)
  if (rule?.fixedValues) {
    for (const [k, v] of Object.entries(rule.fixedValues)) {
      aspects[k] = [v];
    }
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
      console.log(`buildAndNormalizeAspects: derived Circulated/Uncirculated="${circVal}" from grade="${grade}"`);
    }
    for (const [k, v] of Object.entries(rule.defaults)) {
      if (!aspects[k]) {
        aspects[k] = [v];
        console.log(`buildAndNormalizeAspects: filled default ${k}="${v}" for category ${categoryId}`);
      }
    }
  }

  // eBay errorId 25019: numerical/descriptive grades are ONLY allowed on certified coins.
  // If Certification is "Uncertified" (or absent), drop the Grade aspect entirely.
  // Sending any grade value on an uncertified coin triggers a policy violation.
  const certValue = aspects["Certification"]?.[0];
  const CERTIFIED_GRADERS = new Set(["PCGS", "NGC", "ANACS", "ICG", "CAC", "PCGS & CAC", "NGC & CAC"]);
  if (aspects["Grade"] && (!certValue || !CERTIFIED_GRADERS.has(certValue))) {
    console.warn(
      `buildAndNormalizeAspects: dropping Grade="${aspects["Grade"][0]}" for category ${categoryId} ` +
      `because Certification="${certValue ?? "not set"}" is not a recognized grading service (eBay errorId 25019)`
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
  // Refurbished (electronics/appliances — NOT for coins)
  CERTIFIED_REFURBISHED: 2000,
  SELLER_REFURBISHED: 2500,
  // USED_* family — correct for Coins & Paper Money category tree
  USED_EXCELLENT: 3000,   // AU-50 to XF-45
  USED_VERY_GOOD: 4000,   // VF-20 to VF-35
  USED_GOOD: 5000,         // F-12 to VG-10
  USED_ACCEPTABLE: 6000,   // G-4 to G-6
  FOR_PARTS_OR_NOT_WORKING: 7000, // Damaged/holed/bent coins, junk
  // Legacy *_REFURBISHED aliases — mapped to USED_* for coin categories
  EXCELLENT_REFURBISHED: 3000,
  VERY_GOOD_REFURBISHED: 4000,
  GOOD_REFURBISHED: 5000,
  PRE_OWNED_GOOD: 3000,
  PRE_OWNED_FAIR: 5000,
  PRE_OWNED_POOR: 6000,
};

const CONDITION_DESCRIPTIONS: Record<string, string> = {
  NEW: "Uncirculated coin or brand new item in original packaging.",
  NEW_OTHER: "New without original packaging or tags.",
  NEW_WITH_DEFECTS: "New item with minor cosmetic defects.",
  LIKE_NEW: "Like new condition.",
  CERTIFIED_REFURBISHED: "Professionally refurbished and certified to work like new.",
  SELLER_REFURBISHED: "Seller-refurbished item in good working condition.",
  // USED_* — correct conditions for Coins & Paper Money category tree
  USED_EXCELLENT: "Lightly circulated. AU-50 to XF-45. Shows minimal wear on high points only.",
  USED_VERY_GOOD: "Moderately circulated. VF-20 to VF-35. Major details clear with moderate wear.",
  USED_GOOD: "Heavily circulated. F-12 to VG-10. All major features visible but worn.",
  USED_ACCEPTABLE: "Heavily worn but identifiable. G-4 to G-6. Outline and major features visible.",
  FOR_PARTS_OR_NOT_WORKING: "Damaged, holed, bent, or corroded. Not suitable for collecting.",
  // Legacy aliases kept for backward compatibility
  EXCELLENT_REFURBISHED: "Lightly circulated. Shows minimal wear on high points only.",
  VERY_GOOD_REFURBISHED: "Moderately circulated. Major details clear with moderate wear.",
  GOOD_REFURBISHED: "Heavily circulated. All major features visible but worn.",
  PRE_OWNED_GOOD: "Pre-owned item in good condition.",
  PRE_OWNED_FAIR: "Pre-owned item in fair condition.",
  PRE_OWNED_POOR: "Pre-owned item in poor condition.",
};

const LEGACY_CONDITION_MAP: Record<string, string> = {
  // Map old *_REFURBISHED and PRE_OWNED_* to correct USED_* for coin categories
  EXCELLENT_REFURBISHED: "USED_EXCELLENT",
  VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
  GOOD_REFURBISHED: "USED_GOOD",
  PRE_OWNED_GOOD: "USED_EXCELLENT",
  PRE_OWNED_FAIR: "USED_GOOD",
  PRE_OWNED_POOR: "USED_ACCEPTABLE",
};

// Coin categories that only accept the restricted eBay condition set
const COIN_CATEGORY_IDS = new Set(["11981", "39464", "11980", "11971", "41099"]);
const BULLION_CATEGORY_IDS = new Set(["178906", "39489", "3361", "532", "173685"]);

function normalizeConditionForCategory(
  rawCondition: string,
  categoryId: string | undefined,
  itemType: string | undefined = undefined
): { condition: string; corrected: boolean } {
  // Apply legacy migration first
  const condition = LEGACY_CONDITION_MAP[rawCondition] ?? rawCondition;

  const isCoin = COIN_CATEGORY_IDS.has(categoryId ?? "") ||
    (!BULLION_CATEGORY_IDS.has(categoryId ?? "") && itemType?.toLowerCase().includes("coin"));

  const isBullion = BULLION_CATEGORY_IDS.has(categoryId ?? "") ||
    (!isCoin && !!itemType?.toLowerCase().match(/round|bar|ingot|wafer/i));

  // Also handle the legacy 261xxx range for silver/gold bullion coins/bars
  const isLegacyBullion = categoryId
    ? /^261[0-9]{3}$/.test(categoryId) && parseInt(categoryId) >= 261000 && parseInt(categoryId) <= 261076
    : false;

  if (isCoin) {
    // Coins & Paper Money category tree uses USED_* condition family, NOT *_REFURBISHED.
    // Valid coin conditions per eBay's getItemConditionPolicies for this category tree:
    const validCoinConditions = new Set([
      "NEW",             // MS-60 to MS-70 (uncirculated) and slabbed/certified
      "USED_EXCELLENT",  // AU-50 to XF-45 (lightly circulated)
      "USED_VERY_GOOD",  // VF-20 to VF-35 (moderately circulated)
      "USED_GOOD",       // F-12 to VG-10 (heavily circulated)
      "USED_ACCEPTABLE", // G-4 to G-6 (heavily worn but identifiable)
      "FOR_PARTS_OR_NOT_WORKING", // Damaged/holed/bent only
    ]);
    if (!validCoinConditions.has(condition)) {
      const fallbackMap: Record<string, string> = {
        LIKE_NEW: "NEW",
        NEW_OTHER: "NEW",
        NEW_WITH_DEFECTS: "USED_GOOD",
        CERTIFIED_REFURBISHED: "NEW",      // slabbed coins are "new" on eBay
        SELLER_REFURBISHED: "USED_GOOD",
        EXCELLENT_REFURBISHED: "USED_EXCELLENT",
        VERY_GOOD_REFURBISHED: "USED_VERY_GOOD",
        GOOD_REFURBISHED: "USED_GOOD",
        PRE_OWNED_GOOD: "USED_EXCELLENT",
        PRE_OWNED_FAIR: "USED_GOOD",
        PRE_OWNED_POOR: "USED_ACCEPTABLE",
      };
      const mapped = fallbackMap[condition] ?? "USED_EXCELLENT";
      console.log(`normalizeConditionForCategory: coin category ${categoryId} — ${condition} -> ${mapped}`);
      return { condition: mapped, corrected: true };
    }
  } else if (isBullion || isLegacyBullion) {
    // Bullion: allow everything except LIKE_NEW
    if (condition === "LIKE_NEW") {
      console.log(`normalizeConditionForCategory: bullion category ${categoryId} — LIKE_NEW -> NEW`);
      return { condition: "NEW", corrected: true };
    }
  }

  return { condition, corrected: false };
}

// ----------------------------------------------------------------
// Listing duration constants
// GTC = "Good 'Til Cancelled" — required for FIXED_PRICE listings
// Auctions must use a specific day count: 1, 3, 5, 7, or 10
// ----------------------------------------------------------------
const FIXED_PRICE_DURATION = "GTC";
const DEFAULT_AUCTION_DURATION = "Days_7";
const VALID_AUCTION_DURATIONS = ["Days_1", "Days_3", "Days_5", "Days_7", "Days_10"];

// ----------------------------------------------------------------
// Helper: fetch with timeout to prevent hanging requests
// ----------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
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
// Build a fixed-price offer payload
// ----------------------------------------------------------------
function buildFixedPriceOffer(params: {
  sku: string;
  description: string;
  listingPrice: number;
  condition: string;
  conditionDescription: string;
  ebayCategoryId?: string;
  merchantLocationKey: string;
  fulfillmentPolicyId: string;
  paymentPolicyId?: string | null;  // Optional: managed payments sellers don't need this
  returnPolicyId: string;
}): Record<string, unknown> {
  // Build listingPolicies — paymentPolicyId is omitted for managed payments sellers
  const listingPolicies: Record<string, string> = {
    fulfillmentPolicyId: params.fulfillmentPolicyId,
    returnPolicyId: params.returnPolicyId,
  };
  if (params.paymentPolicyId) {
    listingPolicies.paymentPolicyId = params.paymentPolicyId;
  }

  const offer: Record<string, unknown> = {
    sku: params.sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    listingDescription: params.description,
    availableQuantity: 1,
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
  paymentPolicyId?: string | null;  // Optional: managed payments sellers don't need this
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
        `Auction BIN price ${params.auctionBuyItNow} is less than 30% above start price ${params.auctionStartPrice}. Omitting BIN.`
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
      if (params.paymentPolicyId) policies.paymentPolicyId = params.paymentPolicyId;
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
async function uploadDataUrlToStorage(dataUrl: string): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn("uploadDataUrlToStorage: missing Supabase env vars — skipping upload");
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
      console.error("uploadDataUrlToStorage: upload failed:", uploadError.message);
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
// POST creates or updates the location.
// If location exists: PATCH updates it with new address.
// 204 = created, 409 = already exists (both fine).
// Returns the merchantLocationKey on success.
// ----------------------------------------------------------------
async function ensureInventoryLocation(
  apiBase: string,
  userToken: string,
  postalCode: string,
  city = "",
  country = "US"
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
    locationBody.location.address
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
    }
  );

  // 204 = created. If location already exists, POST returns error with errorId 25803.
  // In that case, PATCH the location to update the address.
  if (resp.ok) {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" created successfully (status ${resp.status})`
    );
    return merchantLocationKey;
  }

  // Location already exists — update it with PATCH
  const errText = await resp.text();
  let alreadyExists = false;
  
  try {
    const errJson = JSON.parse(errText);
    alreadyExists = Array.isArray(errJson.errors) &&
      errJson.errors.some((e: { errorId: number }) => e.errorId === 25803);
  } catch { /* not JSON */ }

  if (resp.status === 409 || alreadyExists) {
    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" already exists — updating with PATCH to new address`
    );

    // PATCH the existing location to update the address
    const patchResp = await fetchWithTimeout(
      `${apiBase}/sell/inventory/v1/location/${merchantLocationKey}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
        },
        body: JSON.stringify(locationBody),
        timeout: 15000,
      }
    );

    if (!patchResp.ok) {
      const patchErrText = await patchResp.text();
      console.warn(
        `ensureInventoryLocation: PATCH update failed with status ${patchResp.status}: ${patchErrText}. Proceeding with existing location.`
      );
      // Don't throw — the location exists, even if we couldn't update it.
      return merchantLocationKey;
    }

    console.log(
      `ensureInventoryLocation: location "${merchantLocationKey}" updated successfully (status ${patchResp.status})`
    );
    return merchantLocationKey;
  }

  // Genuine error — not a "already exists" case
  console.error(
    `ensureInventoryLocation: unexpected error ${resp.status}: ${errText}`
  );
  throw new Error(
    `Failed to ensure inventory location: ${resp.status} - ${errText}`
  );
}

serve(async (req) => {
  console.log("*** EBAY-PUBLISH FUNCTION STARTED (v19 - fix inventory location update: PATCH existing location when city/zip changes) ***");
  
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
    
    console.log(`ebay-publish action: ${action}, payload keys: ${Object.keys(payload).join(", ")}`);
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
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    // Environment diagnostic log — emitted on every invocation to aid debugging.
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
    const requiresEbayCredentials = !["get_stored_token", "get_policies"].includes(action);
    if (requiresEbayCredentials && (!clientId || !clientSecret)) {
      throw new Error("eBay API credentials not configured");
    }

    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";
    const authBase =
      ebayEnv === "production"
        ? "https://auth.ebay.com"
        : "https://auth.sandbox.ebay.com";
    const tokenUrl =
      ebayEnv === "production"
        ? "https://api.ebay.com/identity/v1/oauth2/token"
        : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

    // --- ACTION: Get OAuth consent URL ---
    if (action === "get_auth_url") {
      const ruName = Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) throw new Error("EBAY_RUNAME not configured");

      const scopes = [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
      ].join(" ");

      const authUrl =
        `${authBase}/oauth2/authorize?` +
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

      const ruName = Deno.env.get("EBAY_RUNAME") || Deno.env.get("EBAY_REDIRECT_URI");
      if (!ruName) {
        throw new Error("eBay callback URI not configured. Contact admin to set EBAY_RUNAME.");
      }

      console.log("exchange_code: code =", code?.substring(0, 20) + "...", "env =", ebayEnv);

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
        throw new Error(`eBay token exchange failed (${resp.status}): ${errorMsg}`);
      }

      const tokenData = await resp.json();

      if (!tokenData.access_token) {
        throw new Error("eBay returned no access token. Authorization code may have expired or been reused.");
      }

      console.log("exchange_code: token obtained, expires in", tokenData.expires_in, "seconds");

      // --- Store token server-side in Supabase profiles table ---
      // Avoids exposing the token in localStorage (XSS risk).
      // IMPORTANT: Use upsert (not update) so this works even if the profiles row
      // doesn't exist yet. .update() silently affects 0 rows with no error when
      // the row is missing — the token would never be stored server-side, causing
      // get_stored_token to always return null and policies to fail to load.
      if (userId) {
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          if (supabaseUrl && supabaseServiceKey) {
            const supabase = createClient(supabaseUrl, supabaseServiceKey);
            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

            // upsert with onConflict: "id" — creates the row if missing, updates if present
            const { error: upsertError } = await supabase
              .from("profiles")
              .upsert(
                {
                  id: userId,
                  ebay_access_token: tokenData.access_token,
                  ebay_refresh_token: tokenData.refresh_token ?? null,
                  ebay_token_expires_at: expiresAt,
                },
                { onConflict: "id" }
              );

            if (upsertError) {
              console.warn("exchange_code: failed to upsert token in profiles:", upsertError.message);
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
                  "verifyError:", verifyError?.message ?? "token null after upsert"
                );
              } else {
                console.log(
                  "exchange_code: token upserted and verified in profiles for user",
                  userId,
                  "expires_at:", verifyData.ebay_token_expires_at
                );
              }
            }
          }
        } catch (storeErr) {
          // Non-fatal — still return the token to the client as fallback
          console.warn("exchange_code: token storage error (non-fatal):", storeErr);
        }
      }

      return new Response(
        JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_in: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select("ebay_refresh_token")
        .eq("id", userId)
        .single();

      if (error || !data?.ebay_refresh_token) {
        return new Response(
          JSON.stringify({ token: null, error: "No refresh token available. Please reconnect eBay." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          ].join(" "),
        }).toString(),
      });

      if (!refreshResp.ok) {
        const txt = await refreshResp.text();
        console.error("refresh_token: eBay refresh failed:", refreshResp.status, txt);
        return new Response(
          JSON.stringify({ token: null, error: `Token refresh failed (${refreshResp.status}). Please reconnect eBay.` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = await refreshResp.json();
      if (!tokenData.access_token) {
        return new Response(
          JSON.stringify({ token: null, error: "eBay returned no access token during refresh." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Store the new access token (and new refresh token if provided)
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
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
        console.warn("refresh_token: failed to store refreshed token:", updateError.message);
      } else {
        console.log("refresh_token: token refreshed and stored for user", userId, "expires at", expiresAt);
      }

      return new Response(
        JSON.stringify({
          token: tokenData.access_token,
          expiresIn: tokenData.expires_in,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from("profiles")
        .select("ebay_access_token, ebay_token_expires_at, ebay_refresh_token, postal_code, city")
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
        console.warn("get_stored_token: no profile found or query error for user", userId);
        return new Response(
          JSON.stringify({ token: null, postalCode: null, city: null }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const now = new Date();
      const expiresAt = data.ebay_token_expires_at ? new Date(data.ebay_token_expires_at) : null;
      // Consider token expired if it expires within 5 minutes (proactive refresh window)
      const REFRESH_BUFFER_MS = 5 * 60 * 1000;
      const isExpiredOrExpiringSoon = expiresAt
        ? expiresAt.getTime() - now.getTime() < REFRESH_BUFFER_MS
        : true;

      // Proactively refresh if token is expired or expiring within 5 minutes
      if (isExpiredOrExpiringSoon && data.ebay_refresh_token) {
        console.log("get_stored_token: token expiring soon, attempting proactive refresh for user", userId);
        // Skip proactive refresh if eBay app credentials are not configured
        if (!clientId || !clientSecret) {
          console.warn("get_stored_token: skipping proactive refresh — eBay credentials not configured");
          return new Response(
            JSON.stringify({ token: data.ebay_access_token, postalCode: data.postal_code, city: (data as any).city ?? null, isExpired: false }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
              ].join(" "),
            }).toString(),
          });

          if (refreshResp.ok) {
            const tokenData = await refreshResp.json();
            if (tokenData.access_token) {
              const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
              const updatePatch: Record<string, string> = {
                ebay_access_token: tokenData.access_token,
                ebay_token_expires_at: newExpiresAt,
              };
              if (tokenData.refresh_token) {
                updatePatch.ebay_refresh_token = tokenData.refresh_token;
              }
              await supabase.from("profiles").update(updatePatch).eq("id", userId);
              console.log("get_stored_token: proactive refresh succeeded, new expiry:", newExpiresAt);

              return new Response(
                JSON.stringify({
                  token: tokenData.access_token,
                  postalCode: data.postal_code,
                  city: (data as any).city ?? null,
                  isExpired: false,
                  refreshed: true,
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          } else {
            console.warn("get_stored_token: proactive refresh failed:", refreshResp.status);
          }
        } catch (refreshErr) {
          console.warn("get_stored_token: proactive refresh error (non-fatal):", refreshErr);
        }

        // Refresh failed — return null so caller triggers re-auth
        return new Response(
          JSON.stringify({ token: null, postalCode: data.postal_code, city: (data as any).city ?? null, isExpired: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          token: data.ebay_access_token,
          postalCode: data.postal_code,
          city: (data as any).city ?? null,
          isExpired: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Publish a single draft to eBay ---
    if (action === "create_draft") {
      const {
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
        condition,
        ebayCategoryId,
        itemSpecifics,
        postalCode,
        city: payloadCity,
        fulfillmentPolicyId: draftFulfillmentPolicyId,
        paymentPolicyId: draftPaymentPolicyId,
        returnPolicyId: draftReturnPolicyId,
      } = payload;

      if (!userToken) throw new Error("No eBay user token provided");

      console.log(`create_draft: starting publish - title="${title}", format=${listingFormat}, env=${ebayEnv}`);
      console.log(`create_draft: received condition from payload: ${condition}`);
      console.log(`create_draft: postalCode from payload:`, postalCode, `city from payload:`, payloadCity);
      console.log(`create_draft: _debug_postalCode:`, payload._debug_postalCode, `_debug_city:`, payload._debug_city);
      console.log(`create_draft: received ebayCategoryId=${ebayCategoryId}, condition=${condition}, itemSpecifics=${JSON.stringify(itemSpecifics || {})}`);
      console.log(`create_draft: itemSpecifics received:`, JSON.stringify(itemSpecifics || {}, null, 2));

      // Use deterministic SKU if provided (preferred — enables idempotent retries).
      // Fall back to random UUID-based SKU only if not provided.
      const sku = incomingSku ||
        `LA-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

      console.log(`create_draft: sku=${sku}`);

      // eBay Partner Network campaign ID for affiliate revenue tracking
      const epnCampaignId = Deno.env.get("EPN_CAMPAIGN_ID") || "";

      // Build EPN rover affiliate link — wrapped in try/catch so EPN failure
      // never blocks or fails the publish transaction
      const buildAffiliateUrl = (listingId: string): string | null => {
        try {
          const baseUrl = `https://www.ebay.com/itm/${listingId}`;
          if (!epnCampaignId) return baseUrl;
          return `https://rover.ebay.com/rover/1/711-53200-19255-0/1?campid=${encodeURIComponent(epnCampaignId)}&toolid=10001&customid=teckstart&mpre=${encodeURIComponent(baseUrl)}`;
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
      
      // Fallback: if ebayCategoryId is not in CATEGORY_ASPECT_RULES, use US Coins General (253)
      // This handles edge cases where AI assigns an invalid/unsupported category ID
      let categoryForAspects = ebayCategoryId ?? "";
      if (!CATEGORY_ASPECT_RULES[categoryForAspects]) {
        console.warn(`create_draft: category ${categoryForAspects} not in CATEGORY_ASPECT_RULES, falling back to US Coins General (253)`);
        categoryForAspects = "253"; // US Coins General
      }
      
      const aspects = buildAndNormalizeAspects(
        (itemSpecifics && typeof itemSpecifics === "object"
          ? itemSpecifics
          : {}) as Record<string, unknown>,
        categoryForAspects
      );

      console.log(`create_draft: aspects built for category ${ebayCategoryId}:`, JSON.stringify(aspects, null, 2));

      // Extract the item Type (e.g., "Coin", "Round", "Bar") from itemSpecifics
      // This is used to disambiguate coins from bullion when validating conditions
      const itemType = itemSpecifics && typeof itemSpecifics === "object" 
        ? (itemSpecifics as Record<string, unknown>).Type as string | undefined
        : undefined;

      // Map internal condition string to numeric conditionId
      // eBay Inventory API accepts ConditionEnum strings, but many categories
      // also require the numeric conditionId. We send both for maximum compatibility.
      // Migrate any legacy deprecated condition codes to current equivalents,
      // then normalize based on the category and item type (e.g., LIKE_NEW not valid for coins).
      const rawCondition = condition || "USED_EXCELLENT";
      const { condition: normalizedCondition, corrected } = normalizeConditionForCategory(
        rawCondition,
        ebayCategoryId,
        itemType
      );
      const conditionEnum = normalizedCondition;
      const conditionId = CONDITION_ID_MAP[conditionEnum] ?? 3000;
      const conditionDesc = CONDITION_DESCRIPTIONS[conditionEnum]
        ?? conditionEnum.replace(/_/g, " ").toLowerCase()
             .replace(/\b\w/g, (c: string) => c.toUpperCase());

      console.log(`create_draft: condition normalization - rawCondition=${rawCondition}, normalized=${normalizedCondition}, conditionId=${conditionId}, categoryId=${ebayCategoryId}, corrected=${corrected}`);

      if (corrected) {
        console.log(
          `create_draft: condition auto-corrected from ${rawCondition} to ${normalizedCondition} for category ${ebayCategoryId}`
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
        effectiveCity
      );

      // Step 2: Create/update inventory item (PUT is idempotent — safe to retry)
      // NOTE: description goes in the OFFER (listingDescription), not the inventory item.
      // The inventory item holds product data; the offer holds listing-specific data.

      // Resolve imageUrl: eBay rejects base64 data: URLs (errorId 25721).
      // Upload to Supabase Storage if needed to get a public HTTPS URL.
      let resolvedImageUrl = imageUrl as string | undefined;
      if (resolvedImageUrl?.startsWith("data:")) {
        console.log("create_draft: imageUrl is base64 data URL — uploading to storage");
        resolvedImageUrl = await uploadDataUrlToStorage(resolvedImageUrl);
        if (resolvedImageUrl.startsWith("data:")) {
          console.error("create_draft: image upload failed — proceeding without image");
          resolvedImageUrl = undefined;
        }
      }

      // IMPORTANT: condition and conditionDescription belong at the ROOT level
      // of the inventory item body, NOT inside product. Placing them inside product
      // causes eBay error 25021 ("Item condition is required for this category")
      // at publish time, even though the offer creation succeeds.
      // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
      const inventoryBody: Record<string, unknown> = {
        product: {
          title,
          imageUrls: resolvedImageUrl ? [resolvedImageUrl] : [],
        },
        condition: conditionEnum,
        conditionDescription: conditionDesc,
        availability: {
          // shipToLocationAvailability: use only the top-level quantity.
          // availabilityDistributions is for multi-warehouse sellers and causes
          // eBay error 25604 ("Availability not found") for standard single-location accounts.
          shipToLocationAvailability: {
            quantity: 1,
          },
        },
      };

      // Add aspects (item specifics) to the product
      if (Object.keys(aspects).length > 0) {
        (inventoryBody.product as Record<string, unknown>).aspects = aspects;
      }

      console.log(`create_draft: creating inventory item for sku=${sku}, condition=${conditionEnum} (raw=${rawCondition}), merchantLocationKey=${merchantLocationKey}`);
      console.log(`create_draft: inventory body condition:`, JSON.stringify({ condition: conditionEnum, conditionDescription: conditionDesc }));

      const inventoryResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
        {
          method: "PUT",
          timeout: 15000,
          headers: authHeaders,
          body: JSON.stringify(inventoryBody),
        }
      );

      if (!inventoryResp.ok) {
        const errText = await inventoryResp.text();
        console.error("create_draft: eBay inventory error:", inventoryResp.status, errText);
        console.error("create_draft: inventory request body:", JSON.stringify(inventoryBody, null, 2));
        throw new Error(`Failed to create inventory item: ${inventoryResp.status} - ${errText}`);
      }

      console.log(`create_draft: inventory item created successfully for sku=${sku}`);

      // Step 3: Fetch business policies (use draft-level if set, else auto-fetch first)
      const fetchDefaultPolicy = async (policyType: string): Promise<string | null> => {
        const resp = await fetchWithTimeout(
          `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
          { headers: authHeaders, timeout: 15000 }
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
      };

      // Fetch policies — paymentPolicyId is optional for managed payments sellers.
      // Most eBay sellers enrolled in managed payments do NOT need a payment policy.
      // We only require fulfillment and return policies.
      const [fulfillmentPolicyId, paymentPolicyId, returnPolicyId] = await Promise.all([
        draftFulfillmentPolicyId ? Promise.resolve(draftFulfillmentPolicyId) : fetchDefaultPolicy("fulfillment"),
        draftPaymentPolicyId     ? Promise.resolve(draftPaymentPolicyId)     : fetchDefaultPolicy("payment"),
        draftReturnPolicyId      ? Promise.resolve(draftReturnPolicyId)      : fetchDefaultPolicy("return"),
      ]);

      // Only fulfillment and return policies are required; payment policy is optional
      if (!fulfillmentPolicyId || !returnPolicyId) {
        const missing = [
          !fulfillmentPolicyId && "Fulfillment (Shipping)",
          !returnPolicyId && "Return",
        ].filter(Boolean).join(", ");

        console.error(`create_draft: missing required policies for sku ${sku}: ${missing}. draftFulfillment=${draftFulfillmentPolicyId}, draftReturn=${draftReturnPolicyId}`);

        return new Response(
          JSON.stringify({
            error: `Missing required eBay business policies: ${missing}. Please create these policies in your eBay Seller Hub (https://www.ebay.com/sh/ovw/policies) before publishing.`,
            missingPolicies: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`create_draft: policies fetched - fulfillment=${fulfillmentPolicyId}, return=${returnPolicyId}, payment=${paymentPolicyId || "NONE"}`);

      // Step 4: Build offer payload
      // IMPORTANT: The eBay Inventory API (REST) only supports FIXED_PRICE format.
      // Auction listings require the legacy Trading API (XML-based) which is a
      // separate integration path. Attempting to pass format: "AUCTION" to the
      // Inventory API will result in a 400 error.
      // See: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
      if (listingFormat === "AUCTION") {
        console.error(`create_draft: auction format requested but not supported by Inventory API for sku=${sku}`);
        return new Response(
          JSON.stringify({
            error: "Auction format is not supported by the eBay Inventory API. " +
              "Please change the listing format to Fixed Price, or use the eBay " +
              "Seller Hub to create auction listings manually.",
            auctionNotSupported: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const offerBody = buildFixedPriceOffer({
        sku,
        description,
        listingPrice: Number(listingPrice ?? 0),
        condition: conditionEnum,
        conditionDescription: conditionDesc,
        ebayCategoryId: ebayCategoryId || undefined,
        merchantLocationKey,
        fulfillmentPolicyId,
        paymentPolicyId,
        returnPolicyId,
      });

      console.log(`create_draft: built offer for sku=${sku}, price=${listingPrice}, category=${ebayCategoryId || "NONE"}`);
      console.log(`create_draft: offer body categories - categoryId in offer=${(offerBody as Record<string, unknown>).categoryId || "MISSING"}`);
      console.log(`create_draft: offer body:`, JSON.stringify(offerBody, null, 2));

      const offerResp = await fetchWithTimeout(`${apiBase}/sell/inventory/v1/offer`, {
        method: "POST",
        timeout: 15000,
        headers: authHeaders,
        body: JSON.stringify(offerBody),
      });

      let offerId: string | undefined;
      let offerData: Record<string, unknown> | null = null;

      if (!offerResp.ok) {
        const errText = await offerResp.text();
        console.error("create_draft: eBay offer error:", offerResp.status, errText);
        console.error("create_draft: offer request body:", JSON.stringify(offerBody, null, 2));

        // Check if this is errorId 25002 — offer already exists.
        // This can happen if a previous publish attempt created the offer but failed at publish step.
        // When this happens, UPDATE the existing offer with the corrected payload (PUT /offer/{offerId})
        // to ensure any fixes (e.g., condition, policies) take effect before publishing.
        try {
          const errJson = JSON.parse(errText);
          const offerExists = Array.isArray(errJson.errors) &&
            errJson.errors.some((e: { errorId: number }) => e.errorId === 25002);
          if (offerExists) {
            const offerIdParam = errJson.errors[0]?.parameters?.find(
              (p: { name: string; value: string }) => p.name === "offerId"
            );
            if (offerIdParam?.value) {
              offerId = offerIdParam.value;
              console.log(
                `create_draft: offer already exists (errorId 25002), updating existing offerId=${offerId} before publish`
              );
              // Update the existing offer so our corrected payload takes effect
              const updateResp = await fetchWithTimeout(
                `${apiBase}/sell/inventory/v1/offer/${offerId}`,
                {
                  method: "PUT",
                  timeout: 15000,
                  headers: authHeaders,
                  body: JSON.stringify(offerBody),
                }
              );
              if (!updateResp.ok) {
                const updateErrText = await updateResp.text();
                console.warn(
                  `create_draft: offer update failed (non-fatal), will still attempt publish: ${updateResp.status} - ${updateErrText}`
                );
              } else {
                console.log(`create_draft: existing offer ${offerId} updated successfully`);
              }
            }
          }
        } catch {
          // Not JSON or missing offerId — fall through to throw
        }

        if (!offerId) {
          throw new Error(`Failed to create offer: ${offerResp.status} - ${errText}`);
        }
      } else {
        offerData = await offerResp.json();
        offerId = offerData.offerId;
        console.log(`create_draft: offer created successfully, offerId=${offerId}, about to publish...`);
      }

      console.log(`create_draft: proceeding to publish offerId=${offerId}...`);

      // Step 5: Publish the offer to make it a live listing.
      // The publish endpoint does NOT accept a request body — condition is already
      // set on the inventory item (root level). Sending extra body fields causes
      // unexpected behavior. POST with no body is the correct usage.
      // Reference: https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/publishOffer
      const publishResp = await fetchWithTimeout(
        `${apiBase}/sell/inventory/v1/offer/${offerId}/publish`,
        {
          method: "POST",
          timeout: 15000,
          headers: authHeaders,
        }
      );

      if (!publishResp.ok) {
        const errText = await publishResp.text();
        console.error("create_draft: eBay publish error:", publishResp.status, errText);
        console.error("create_draft: failing to publish offer", offerId, "for sku", sku);
        console.error(`create_draft: publish failed with condition=${conditionEnum} (id=${conditionId}), category=${ebayCategoryId}, format=${listingFormat}`);
        return new Response(
          JSON.stringify({
            error: `Offer created (ID: ${offerId}) but publish failed: ${publishResp.status} - ${errText}`,
            offerId,
            sku,
            publishFailed: true,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const publishData = await publishResp.json();
      const listingId = publishData.listingId || offerData.listing?.listingId || null;

      // Build affiliate URL — non-fatal, wrapped in try/catch
      const affiliateUrl = listingId ? buildAffiliateUrl(listingId) : null;

      console.log(`create_draft: Successfully published: listingId=${listingId}, offerId=${offerId}, sku=${sku}, publishData keys: ${Object.keys(publishData).join(", ")}`);

      return new Response(
        JSON.stringify({
          success: true,
          offerId,
          sku,
          listingId,
          affiliateUrl,
          message: "Listing published live on eBay!",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- ACTION: Bulk publish multiple drafts (server-side loop) ---
    if (action === "bulk_create_draft") {
      const { userToken, drafts, postalCode } = payload;
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
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
            const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
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
        // Return empty policies rather than throwing — lets the UI show "no policies" gracefully
        return new Response(
          JSON.stringify({ fulfillment: [], payment: [], returns: [], noToken: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
      // Returns { policies, error } — error is non-null if the fetch failed.
      const fetchPoliciesSafe = async (
        policyType: string
      ): Promise<{ policies: Array<{ id: string; name: string }>; error: string | null }> => {
        try {
          const resp = await fetchWithTimeout(
            `${apiBase}/sell/account/v1/${policyType}_policy?marketplace_id=EBAY_US`,
            { headers: authHeaders, timeout: 15000 }
          );
          if (!resp.ok) {
            const errText = await resp.text();
            console.warn(`get_policies: ${policyType} policy fetch failed (${resp.status}):`, errText);
            return { policies: [], error: `${policyType} policies unavailable (HTTP ${resp.status})` };
          }
          const data = await resp.json();
          const key = `${policyType}Policies`;
          const rawPolicies = data[key] || [];
          const policies = rawPolicies.map((p: Record<string, string>) => ({
            id: p[`${policyType}PolicyId`] || p.policyId || "",
            name: p.name || "(unnamed)",
          }));
          console.log(`get_policies: fetched ${policies.length} ${policyType} policies`);
          return { policies, error: null };
        } catch (fetchErr) {
          console.warn(`get_policies: ${policyType} policy fetch threw:`, fetchErr);
          return { policies: [], error: `${policyType} policies fetch error` };
        }
      };

      // Run all three fetches concurrently; each is independently error-isolated
      const [fulfillmentResult, paymentResult, returnsResult] = await Promise.all([
        fetchPoliciesSafe("fulfillment"),
        fetchPoliciesSafe("payment"),
        fetchPoliciesSafe("return"),
      ]);

      // Collect any per-type errors for the client to display
      const policyErrors: Record<string, string> = {};
      if (fulfillmentResult.error) policyErrors.fulfillment = fulfillmentResult.error;
      if (paymentResult.error)     policyErrors.payment     = paymentResult.error;
      if (returnsResult.error)     policyErrors.returns     = returnsResult.error;

      return new Response(
        JSON.stringify({
          fulfillment: fulfillmentResult.policies,
          payment:     paymentResult.policies,
          returns:     returnsResult.policies,
          ...(Object.keys(policyErrors).length > 0 ? { policyErrors } : {}),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    console.error(`ebay-publish error [action=${actionLabel}]:`, errorMsg, e instanceof Error ? e.stack : "");

    // Only treat as a 400 client error for explicit configuration/input problems.
    // eBay API error strings (e.g. "Failed to create inventory item: 400 - {...}")
    // must NOT match here — they should be 500s so the client knows it's a server-side
    // eBay API failure, not a missing-parameter problem on the client side.
    const isClientError =
      errorMsg.includes("not configured") ||
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
      }
    );
  }
});
