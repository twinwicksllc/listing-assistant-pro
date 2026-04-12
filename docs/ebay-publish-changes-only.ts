// ================================================================
// EXTRACTED FROM: supabase/functions/ebay-publish/index.ts
// ONLY THE NEW/CHANGED SECTIONS — for team review
// ================================================================

// ── NEW: Dynamic Aspect Fetcher (lines 44-130) ────────────────────────

async function fetchDynamicAspectRule(
  categoryId: string,
  supabase: any,
): Promise<AspectRule | null> {
  try {
    // 1. Check the cache table
    const { data: cached } = await supabase
      .from("category_aspects_cache")
      .select("aspects, expires_at")
      .eq("category_id", categoryId)
      .maybeSingle();

    if (cached?.aspects && new Date(cached.expires_at) > new Date()) {
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
              "Authorization": `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "aspects", categoryId }),
          }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.aspects && data.aspects.length > 0) {
            return convertEbayAspectsToRule(data.aspects);
          }
        }
      } catch (fetchErr) {
        console.warn(`fetchDynamicAspectRule: category-lookup call failed for ${categoryId}:`, fetchErr);
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

// ── NEW: Category Tree Detection (lines 132-169) ──────────────────────

type CategoryTreeType = "coin" | "bullion" | "trading_card" | "collectible" | "other";

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

    const breadcrumb = (mapping?.breadcrumb || mapping?.category_name || "").toLowerCase();

    if (breadcrumb) {
      if (breadcrumb.includes("bullion")) return "bullion";
      if (breadcrumb.includes("coins:") || breadcrumb.includes("coins >") || breadcrumb.includes("paper money")) return "coin";
      if (breadcrumb.includes("trading cards") || breadcrumb.includes("collectible card games")) return "trading_card";
      if (breadcrumb.includes("collectibles") || breadcrumb.includes("toys &") || breadcrumb.includes("stuffed animal") || breadcrumb.includes("action figure") || breadcrumb.includes("funko") || breadcrumb.includes("lego") || breadcrumb.includes("board game")) return "collectible";
      return "other";
    }
  } catch (_) { /* fall through to hardcoded */ }

  // Fallback to hardcoded sets
  if (HARDCODED_BULLION_CATEGORY_IDS.has(categoryId)) return "bullion";
  if (HARDCODED_COIN_CATEGORY_IDS.has(categoryId)) return "coin";
  if (HARDCODED_TRADING_CARD_CATEGORY_IDS.has(categoryId)) return "trading_card";
  if (HARDCODED_COLLECTIBLE_CATEGORY_IDS.has(categoryId)) return "collectible";
  return "other";
}

const HARDCODED_COIN_CATEGORY_IDS = new Set(["11981", "39464", "11980", "11971", "41099", "41102", "11973", "39455", "41084", "11950", "41111", "166679", "41109", "526", "253", "45243"]);
const HARDCODED_BULLION_CATEGORY_IDS = new Set(["178906", "39489", "3361", "532", "173685"]);
const HARDCODED_TRADING_CARD_CATEGORY_IDS = new Set(["261328", "183454", "2536", "19107", "64482", "213"]);
const HARDCODED_COLLECTIBLE_CATEGORY_IDS = new Set(["19203", "19209", "261068", "246", "182", "19016"]);


// ── CHANGED: Condition normalization (line ~870) ───────────────────────
// Now accepts an optional categoryTreeType parameter and uses
// detectCategoryTreeSync instead of separate hardcoded ID set checks

function normalizeConditionForCategory(
  rawCondition: string,
  categoryId: string | undefined,
  itemType: string | undefined = undefined,
  categoryTreeType: CategoryTreeType | undefined = undefined,
): { condition: string; corrected: boolean } {
  const condition = LEGACY_CONDITION_MAP[rawCondition] ?? rawCondition;
  const treeType = categoryTreeType || detectCategoryTreeSync(categoryId ?? "", itemType);

  const isCoin = treeType === "coin";
  const isBullion = treeType === "bullion";
  const isTradingCard = treeType === "trading_card";
  const isCollectible = treeType === "collectible";

  // ... (condition mapping logic unchanged, just uses the booleans above)
}

// Sync version for use in normalizeConditionForCategory
function detectCategoryTreeSync(categoryId: string, itemType: string | undefined): CategoryTreeType {
  if (HARDCODED_BULLION_CATEGORY_IDS.has(categoryId)) return "bullion";
  if (HARDCODED_COIN_CATEGORY_IDS.has(categoryId)) return "coin";
  if (HARDCODED_TRADING_CARD_CATEGORY_IDS.has(categoryId)) return "trading_card";
  if (HARDCODED_COLLECTIBLE_CATEGORY_IDS.has(categoryId)) return "collectible";

  // Legacy 261xxx range for bullion
  if (/^261[0-9]{3}$/.test(categoryId) && parseInt(categoryId) >= 261000 && parseInt(categoryId) <= 261076) {
    return "bullion";
  }

  // Item type text hints as last resort
  if (itemType) {
    const lower = itemType.toLowerCase();
    if (/coin/i.test(lower)) return "coin";
    if (/round|bar|ingot|wafer/i.test(lower)) return "bullion";
    if (/trading.?card|pokemon|baseball.?card|sports.?card/i.test(lower)) return "trading_card";
    if (/beanie|plush|funko|action.?figure|lego/i.test(lower)) return "collectible";
  }

  return "other";
}


// ── CHANGED: Aspect building in create_draft handler (line ~2100) ──────
// Now tries dynamic rules first, then falls back to hardcoded

      // Try dynamic aspect rules from eBay API cache
      let categoryForAspects = finalCategoryId ?? "";
      let dynamicRuleApplied = false;
      
      try {
        const _supabaseUrl = Deno.env.get("SUPABASE_URL");
        const _supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (_supabaseUrl && _supabaseServiceKey && categoryForAspects) {
          const _supabase = createClient(_supabaseUrl, _supabaseServiceKey);
          const dynamicRule = await fetchDynamicAspectRule(categoryForAspects, _supabase);
          if (dynamicRule && (dynamicRule.required.length > 0 || dynamicRule.preferred.length > 0)) {
            // Merge: dynamic provides required/preferred,
            // hardcoded fixedValues still override (known-correct values)
            const hardcodedRule = CATEGORY_ASPECT_RULES[categoryForAspects];
            if (hardcodedRule?.fixedValues) {
              dynamicRule.fixedValues = { ...dynamicRule.fixedValues, ...hardcodedRule.fixedValues };
            }
            if (hardcodedRule?.defaults) {
              dynamicRule.defaults = { ...dynamicRule.defaults, ...hardcodedRule.defaults };
            }
            
            // Temporarily inject into map so buildAndNormalizeAspects can use it
            CATEGORY_ASPECT_RULES[`__dynamic_${categoryForAspects}`] = dynamicRule;
            categoryForAspects = `__dynamic_${categoryForAspects}`;
            dynamicRuleApplied = true;
          }
        }
      } catch (dynamicErr) {
        console.warn(`create_draft: dynamic aspect fetch failed, using hardcoded fallback:`, dynamicErr);
      }
      
      // If dynamic didn't work, fall back to hardcoded rules
      if (!dynamicRuleApplied) {
        if (!CATEGORY_ASPECT_RULES[categoryForAspects]) {
          const treeType = detectCategoryTreeSync(categoryForAspects, undefined);
          if (treeType === "coin" || treeType === "bullion" || !categoryForAspects) {
            categoryForAspects = "253"; // US Coins General
          } else {
            categoryForAspects = "__empty__";
          }
        }
      }
      
      const aspects = buildAndNormalizeAspects(
        (itemSpecifics && typeof itemSpecifics === "object"
          ? itemSpecifics
          : {}) as Record<string, unknown>,
        categoryForAspects
      );
      
      // Clean up temporary dynamic rule
      if (dynamicRuleApplied) {
        delete CATEGORY_ASPECT_RULES[categoryForAspects];
      }