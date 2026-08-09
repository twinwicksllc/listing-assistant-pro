import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Constants ────────────────────────────────────────────────────────────────
const FUZZY_MIN_SIMILARITY = 0.65; // Minimum fuzzy match threshold (#1)
const FUZZY_MIN_TOKEN_OVERLAP = 2; // Minimum meaningful token overlap (#1)
const AUTO_PERSIST_MIN_CONFIDENCE = 85; // Minimum confidence for auto-persist (#2)
const DETERMINISTIC_LOCK_THRESHOLD = 92; // eBay top-1 score above this = lock (#3) [raised from 88 — EA-P2-C]
const MARKETPLACE_ID = "EBAY_US";
const CATEGORY_TREE_ID = "0";

// Terms that are ALWAYS generic regardless of domain (EA-P1-C)
const ALWAYS_GENERIC_TERMS = new Set([
  "item",
  "items",
  "thing",
  "stuff",
  "misc",
  "miscellaneous",
  "other",
  "general",
  "various",
  "mixed",
  "piece",
  "pieces",
]);

// Domain-specific terms: generic OUTSIDE their domain, meaningful INSIDE it (EA-P1-C)
// Key = the potentially-generic word; Value = domain keywords that make it meaningful
const DOMAIN_SPECIFIC_TERMS: Record<string, string[]> = {
  card: [
    "pokemon",
    "trading",
    "baseball",
    "football",
    "basketball",
    "hockey",
    "tcg",
    "mtg",
    "yugioh",
    "magic",
    "topps",
    "panini",
    "bowman",
    "fleer",
    "donruss",
    "upperdeck",
    "sport",
    "sports",
  ],
  cards: [
    "pokemon",
    "trading",
    "baseball",
    "football",
    "basketball",
    "hockey",
    "tcg",
    "mtg",
    "yugioh",
    "magic",
    "sport",
    "sports",
  ],
  trading: ["card", "cards", "pokemon", "tcg", "mtg"],
  collectible: [
    "beanie",
    "funko",
    "pop",
    "figurine",
    "plush",
    "vintage",
    "antique",
    "memorabilia",
    "figure",
    "action",
  ],
  collectibles: [
    "beanie",
    "funko",
    "pop",
    "figurine",
    "plush",
    "vintage",
    "antique",
    "memorabilia",
    "figure",
    "action",
  ],
  toy: [
    "beanie",
    "baby",
    "plush",
    "action",
    "figure",
    "lego",
    "barbie",
    "hotwheels",
    "hot",
    "wheels",
  ],
  toys: ["beanie", "baby", "plush", "action", "figure", "lego"],
  coin: [
    "penny",
    "nickel",
    "dime",
    "quarter",
    "dollar",
    "eagle",
    "morgan",
    "kennedy",
    "lincoln",
    "buffalo",
    "walking",
    "silver",
    "gold",
    "platinum",
    "proof",
    "bullion",
  ],
  coins: [
    "penny",
    "nickel",
    "dime",
    "quarter",
    "dollar",
    "eagle",
    "morgan",
    "kennedy",
    "lincoln",
    "buffalo",
    "silver",
    "gold",
  ],
  lot: ["coin", "coins", "card", "cards"],
  set: ["coin", "coins", "proof", "mint", "card", "cards", "lego"],
  collection: ["coin", "coins", "card", "cards"],
  vintage: ["coin", "coins", "toy", "toys", "card", "cards"],
  antique: ["coin", "coins", "toy", "toys"],
  rare: ["coin", "coins", "card", "cards", "pokemon"],
};

// Stopwords removed during normalization (#6) — true English stopwords ONLY (EA-P2-D)
// NOTE: Do NOT add domain-relevant terms here (baby, new, set, mint, lot, rare, etc.)
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "it",
  "this",
  "that",
  "was",
  "were",
  "are",
  "be",
  "been",
  "being",
  "has",
  "had",
  "have",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "do",
  "does",
  "did",
  "not",
  "no",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "am",
  "any",
  "because",
  "before",
  "between",
  "both",
  "each",
  "few",
  "here",
  "how",
  "into",
  "its",
  "more",
  "most",
  "only",
  "our",
  "out",
  "over",
  "own",
  "same",
  "some",
  "such",
  "there",
  "these",
  "those",
  "through",
  "under",
  "until",
  "up",
  "we",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "you",
  "your",
]);

// ── Types ────────────────────────────────────────────────────────────────────

interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  breadcrumb: string;
  treeNodeLevel: number;
}

interface AspectInfo {
  name: string;
  required: boolean;
  usage: string;
  mode: string;
  dataType: string;
  values: string[];
}

interface LookupCandidate {
  categoryId: string;
  categoryName: string;
  breadcrumb: string;
  source: string; // db_exact, db_fuzzy, ebay_api, gemini
  rawScore: number; // Raw confidence/score from source
  effectiveScore: number; // Computed score after weighting
  reason: string; // Why this score
  verifiedLeaf: boolean | null;
  verifiedActive: boolean | null;
  tokenOverlap: number; // For fuzzy: how many meaningful tokens matched
  rank: number; // Rank within source
}

interface AuditEntry {
  request_id: string;
  query_text: string;
  candidate_source: string;
  candidate_id: string | null;
  candidate_name: string | null;
  candidate_score: number;
  candidate_rank: number;
  was_selected: boolean;
  reason_selected: string;
  verified_leaf: boolean | null;
  verified_active: boolean | null;
  persisted_to_db: boolean;
  latency_ms: number;
}

// ── Helper: Generate request ID ──────────────────────────────────────────────
function generateRequestId(): string {
  return crypto.randomUUID();
}

// ── Helper: Normalize item type for consistent matching ──────────────────────
function normalizeItemType(input: string): string {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

// ── Helper: Deep normalization for dedup (#6) ────────────────────────────────
function deepNormalize(input: string): string {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((w) => !STOPWORDS.has(w) && w.length > 1)
    .sort()
    .join(" ");
}

// ── Helper: Extract meaningful tokens from a string ──────────────────────────
function meaningfulTokens(input: string): string[] {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// ── Helper: Compute token overlap between query and candidate ────────────────
function computeTokenOverlap(
  queryTokens: string[],
  candidateText: string,
): number {
  const candidateTokens = new Set(meaningfulTokens(candidateText));
  return queryTokens.filter((t) => candidateTokens.has(t)).length;
}

// ── Helper: Check if item_type is too generic (#1) ───────────────────────────
// Context-aware generic check (EA-P1-C):
// A term is only generic if the query is outside its domain.
function isGenericItemType(
  candidateText: string,
  queryTokens: string[] = [],
): boolean {
  const tokens = meaningfulTokens(candidateText);
  if (tokens.length === 0) return true;

  const queryLower = queryTokens.map((t) => t.toLowerCase());

  const isTokenGeneric = (t: string): boolean => {
    if (ALWAYS_GENERIC_TERMS.has(t)) return true;
    // Domain-specific: generic only if query is NOT in that domain
    const domainKeywords = DOMAIN_SPECIFIC_TERMS[t];
    if (domainKeywords) {
      const queryInDomain = queryLower.some((q) => domainKeywords.includes(q));
      return !queryInDomain; // Only generic when query is outside this domain
    }
    return false; // Unknown term = not generic
  };

  // Item type is "too generic" only if ALL meaningful tokens are generic
  return tokens.every((t) => isTokenGeneric(t));
}

// ── Helper: Compute effective score with source weighting (#8) ───────────────
function computeEffectiveScore(
  source: string,
  rawScore: number,
  tokenOverlap: number,
  totalQueryTokens: number,
  isGeneric: boolean,
  daysSinceUpdate: number,
  verifiedLeaf: boolean | null = null, // EA-P2-C: non-leaf penalty
): number {
  // Source weight
  const sourceWeights: Record<string, number> = {
    db_exact_user_verified: 15,
    db_exact_ebay_api: 10,
    db_exact: 8,
    ebay_api: 12,
    db_fuzzy: 3,
    gemini: 5,
  };
  const sourceWeight = sourceWeights[source] || 0;

  // Similarity bonus (token overlap as % of query tokens)
  const similarityBonus =
    totalQueryTokens > 0 ? (tokenOverlap / totalQueryTokens) * 15 : 0;

  // Recency bonus (decays over time for non-verified sources)
  let recencyBonus = 0;
  if (source.startsWith("db_")) {
    recencyBonus = Math.max(0, 5 - daysSinceUpdate / 30); // Lose 1 point per month
  }

  // Generic penalty (#1)
  const genericPenalty = isGeneric ? 20 : 0;

  // Ambiguity penalty (low token overlap on fuzzy)
  const ambiguityPenalty =
    source === "db_fuzzy" && tokenOverlap < FUZZY_MIN_TOKEN_OVERLAP ? 15 : 0;

  // Non-leaf penalty (EA-P2-C): parent categories should not reach lock threshold
  const nonLeafPenalty = verifiedLeaf === false ? 30 : 0;

  return Math.min(
    100,
    Math.max(
      0,
      rawScore +
        sourceWeight +
        similarityBonus +
        recencyBonus -
        genericPenalty -
        ambiguityPenalty -
        nonLeafPenalty,
    ),
  );
}

// ── Helper: Get eBay app token (client credentials) ──────────────────────────
async function getEbayAppToken(): Promise<{
  token: string;
  base: string;
} | null> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  if (!clientId || !clientSecret) return null;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl =
    ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const tokenResp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!tokenResp.ok) {
    console.error(
      "category-lookup: failed to get eBay app token",
      tokenResp.status,
    );
    return null;
  }

  const tokenText = await tokenResp.text();
  let tokenJson: any;
  try {
    tokenJson = JSON.parse(tokenText);
  } catch {
    console.error(
      `category-lookup: eBay token response JSON parse failed (length=${tokenText.length}):`,
      tokenText.slice(0, 200),
    );
    return null;
  }
  const base =
    ebayEnv === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";
  return { token: tokenJson.access_token, base };
}

// ── Helper: eBay getCategorySuggestions ───────────────────────────────────────
async function fetchCategorySuggestions(
  rawQuery: string,
  appToken: string,
  base: string,
  retryCount = 0,
): Promise<CategorySuggestion[]> {
  // EA-P2-A: Sanitize query — strip special chars and truncate to eBay's limit
  let query = (rawQuery || "")
    .replace(/[^\w\s.-]/g, " ") // Keep word chars, spaces, hyphens, dots
    .replace(/\s+/g, " ")
    .trim();

  // Truncate long queries to the 6 most meaningful terms
  if (query.length > 180) {
    const meaningful = query
      .split(" ")
      .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()))
      .slice(0, 6);
    query = meaningful.join(" ").trim();
  }

  // Guard: do not call API with too-short query
  if (query.length < 3) {
    console.warn(
      "category-lookup: fetchCategorySuggestions — query too short after sanitization, skipping",
    );
    return [];
  }

  console.log(
    `category-lookup: eBay suggestion query (sanitized, attempt=${retryCount + 1}): "${query}"`,
  );

  const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${encodeURIComponent(
    query,
  )}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json",
      },
    });

    // EA-P3-C: Retry on 400 with shortened query (up to 2 retries)
    if (resp.status === 400 && retryCount < 2) {
      const words = query.split(" ").filter((w) => w.length > 2);
      const shorter = words
        .slice(0, Math.max(2, Math.floor(words.length / 2)))
        .join(" ");
      if (shorter.length >= 3 && shorter !== query) {
        console.log(
          `category-lookup: eBay 400 error — retrying with shorter query: "${shorter}"`,
        );
        return fetchCategorySuggestions(
          shorter,
          appToken,
          base,
          retryCount + 1,
        );
      }
    }

    // EA-P3-C: Retry once on 429 (rate limit) after brief wait
    if (resp.status === 429 && retryCount < 1) {
      console.warn(
        "category-lookup: eBay API rate-limited (429) — retrying after 2s",
      );
      await new Promise((r) => setTimeout(r, 2000));
      return fetchCategorySuggestions(rawQuery, appToken, base, retryCount + 1);
    }

    if (!resp.ok) {
      console.error(
        "category-lookup: getCategorySuggestions error",
        resp.status,
        await resp.text(),
      );
      return [];
    }

    const respText = await resp.text();
    let json: any;
    try {
      json = JSON.parse(respText);
    } catch {
      console.error(
        `category-lookup: getCategorySuggestions JSON parse failed (length=${respText.length}):`,
        respText.slice(0, 200),
      );
      return [];
    }
    const suggestions = json.categorySuggestions || [];

    return suggestions.map((s: any) => {
      const cat = s.category || {};
      const ancestors = s.categoryTreeNodeAncestors || [];

      const ancestorNames = ancestors
        .sort(
          (a: any, b: any) =>
            (a.categoryTreeNodeLevel || 0) - (b.categoryTreeNodeLevel || 0),
        )
        .map((a: any) => a.categoryName)
        .reverse();
      ancestorNames.push(cat.categoryName);

      return {
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        breadcrumb: ancestorNames.join(" > "),
        treeNodeLevel: s.categoryTreeNodeLevel || 0,
      };
    });
  } catch (err) {
    console.error("category-lookup: getCategorySuggestions exception", err);
    return [];
  }
}

// ── Helper: eBay getItemAspectsForCategory ────────────────────────────────────
async function fetchItemAspects(
  categoryId: string,
  appToken: string,
  base: string,
): Promise<AspectInfo[]> {
  const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${encodeURIComponent(
    categoryId,
  )}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      console.error(
        `category-lookup: getItemAspectsForCategory(${categoryId}) error`,
        resp.status,
      );
      return [];
    }

    const respText = await resp.text();
    let json: any;
    try {
      json = JSON.parse(respText);
    } catch {
      console.error(
        `category-lookup: getItemAspectsForCategory(${categoryId}) JSON parse failed (length=${respText.length}):`,
        respText.slice(0, 200),
      );
      return [];
    }
    const aspects = json.aspects || [];

    return aspects.map((a: any) => {
      const constraint = a.aspectConstraint || {};
      const values = (a.aspectValues || [])
        .map((v: any) => v.localizedValue)
        .filter(Boolean);

      return {
        name: a.localizedAspectName,
        required: constraint.aspectRequired === true,
        usage: constraint.aspectUsage || "OPTIONAL",
        mode: constraint.aspectMode || "FREE_TEXT",
        dataType: constraint.aspectDataType || "STRING",
        values,
      };
    });
  } catch (err) {
    console.error(
      `category-lookup: getItemAspectsForCategory(${categoryId}) exception`,
      err,
    );
    return [];
  }
}

// ── Helper: Verify category is leaf + active via eBay API (#4) ───────────────
async function verifyCategoryLeafActive(
  categoryId: string,
  appToken: string,
  base: string,
): Promise<{
  isLeaf: boolean;
  isActive: boolean;
  categoryName: string | null;
}> {
  try {
    const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_subtree?category_id=${encodeURIComponent(
      categoryId,
    )}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json",
      },
    });

    if (resp.status === 404) {
      return { isLeaf: false, isActive: false, categoryName: null };
    }
    if (!resp.ok) {
      // EA-P1-A: Pessimistic default — unknown API errors should NOT be treated as leaf
      console.warn(
        `category-lookup: verifyCategoryLeafActive(${categoryId}) error`,
        resp.status,
      );
      return { isLeaf: false, isActive: false, categoryName: null };
    }

    const respText = await resp.text();
    let json: any;
    try {
      json = JSON.parse(respText);
    } catch {
      console.error(
        `category-lookup: verifyCategoryLeafActive(${categoryId}) JSON parse failed (length=${respText.length}):`,
        respText.slice(0, 200),
      );
      return { isLeaf: false, isActive: false, categoryName: null };
    }
    const node = json?.categorySubtreeNode;

    // EA-P1-A: Require positive confirmation of valid node — missing/null = not leaf
    if (!node || !node.category) {
      console.warn(
        `category-lookup: verifyCategoryLeafActive(${categoryId}) — no valid node in response`,
      );
      return { isLeaf: false, isActive: false, categoryName: null };
    }

    // A leaf node has no childCategoryTreeNodes or an empty array
    const children = node.childCategoryTreeNodes;
    const isLeaf = !children || children.length === 0;
    const categoryName = node.category.categoryName || null;

    return { isLeaf, isActive: true, categoryName };
  } catch (err) {
    // EA-P1-A: Pessimistic default on exception — never assume valid on unknown error
    console.error(
      `category-lookup: verifyCategoryLeafActive(${categoryId}) exception`,
      err,
    );
    return { isLeaf: false, isActive: false, categoryName: null };
  }
}

// ── Helper: Build breadcrumb by walking up parent nodes (legacy fallback) ────
async function fetchBreadcrumb(
  categoryId: string,
  appToken: string,
  base: string,
): Promise<{ breadcrumb: string; categoryName: string; valid: boolean }> {
  const MAX_DEPTH = 8;
  const parts: string[] = [];
  let currentId = categoryId;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_subtree?category_id=${encodeURIComponent(
      currentId,
    )}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json",
      },
    });

    if (resp.status === 404) {
      if (depth === 0) {
        return { breadcrumb: "", categoryName: "", valid: false };
      }
      break;
    }
    if (!resp.ok) break;

    const breadcrumbText = await resp.text();
    let json: any;
    try {
      json = JSON.parse(breadcrumbText);
    } catch {
      console.error(
        `category-lookup: fetchBreadcrumb(${currentId}) JSON parse failed (length=${breadcrumbText.length})`,
      );
      break;
    }
    const node = json.categorySubtreeNode || json.categoryNode;
    if (!node?.category) break;

    parts.unshift(node.category.categoryName);

    const parentHref = node.parentCategoryTreeNodeHref;
    if (!parentHref) break;

    const parentIdMatch = parentHref.match(/category_id=(\d+)/);
    if (!parentIdMatch) break;

    const parentId = parentIdMatch[1];
    if (parentId === currentId) break;
    currentId = parentId;
  }

  const categoryName = parts.length > 0 ? parts[parts.length - 1] : "";
  const breadcrumb = parts.join(" > ");
  return { breadcrumb, categoryName, valid: parts.length > 0 };
}

// ── Helper: Ask Gemini for category (last-resort fallback, tier 4) ───────────
async function askGeminiForCategory(itemDescription: string): Promise<{
  categoryId: string;
  categoryName: string;
  confidence: number;
} | null> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    console.warn("category-lookup: GEMINI_API_KEY not set, cannot ask Gemini");
    return null;
  }

  const prompt = `You are an eBay category expert. Given the following item description, return the single most accurate eBay leaf category ID.

Item: "${itemDescription}"

Rules:
- Return ONLY a JSON object with fields: categoryId (string), categoryName (string), confidence (number 0-100)
- categoryId must be a valid eBay US leaf category ID (a number as a string)
- confidence: how confident you are this is the right leaf category (0-100)
- Do not include any explanation or extra text — only the JSON object

Example response:
{"categoryId": "19203", "categoryName": "Beanie Babies", "confidence": 97}`;

  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${geminiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-flash-latest",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
        }),
      },
    );

    if (!resp.ok) {
      console.error("category-lookup: Gemini API error", resp.status);
      return null;
    }

    const respText = await resp.text();
    let data: any;
    try {
      data = JSON.parse(respText);
    } catch {
      console.error(
        `category-lookup: Gemini JSON parse failed (length=${respText.length}):`,
        respText.slice(0, 200),
      );
      return null;
    }
    const text = data.choices?.[0]?.message?.content ?? "";

    const jsonMatch = text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      console.warn("category-lookup: Gemini returned no JSON", text);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.categoryId || !parsed.categoryName) return null;

    return {
      categoryId: String(parsed.categoryId).trim(),
      categoryName: String(parsed.categoryName).trim(),
      confidence: Number(parsed.confidence ?? 80),
    };
  } catch (err) {
    console.error("category-lookup: Gemini exception", err);
    return null;
  }
}

// ── Helper: Persist audit entries to lookup_decisions table (#0, #9) ─────────
async function persistAuditEntries(
  supabase: any,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  try {
    await supabase.from("lookup_decisions").insert(entries);
  } catch (err) {
    console.warn("category-lookup: failed to persist audit entries", err);
  }
}

// ── Helper: Persist to category_mappings with gates (#2) ─────────────────────
// RC-6: Known non-leaf parent categories that must NEVER be persisted to DB.
// These are broad parent nodes in eBay's taxonomy that are not valid for listings.
const BLOCKED_PARENT_CATEGORIES = new Set([
  "253", // Coins & Paper Money > Coins: US (parent)
  "11118", // Coins & Paper Money > Coins: US > Half Dollars (parent)
  "11233", // Jewelry & Watches (parent)
  "261076", // Coins & Paper Money > Bullion (parent)
  "261074", // Coins & Paper Money > Bullion > Silver (parent)
  "261075", // Coins & Paper Money > Bullion > Gold (parent)
  "293", // Consumer Electronics (parent)
  "1", // Collectibles (parent)
  "550", // Art (parent)
  "631", // Tools & Workshop Equipment (parent)
  "20713", // Home & Garden (parent)
  "11450", // Clothing, Shoes & Accessories (parent)
  "220", // Toys & Hobbies > Dolls & Bears (parent)
  "15032", // Cell Phones & Accessories (parent)
  "139971", // Video Games & Consoles (parent)
  "267", // Books & Magazines > Books (parent)
]);

async function safePersistMapping(
  supabase: any,
  normalizedKey: string,
  categoryId: string,
  categoryName: string | null,
  breadcrumb: string | null,
  source: string,
  confidence: number,
  ebayAuth: { token: string; base: string } | null,
): Promise<boolean> {
  // Gate 0: Block known parent categories (RC-6)
  if (BLOCKED_PARENT_CATEGORIES.has(categoryId)) {
    console.warn(
      `category-lookup: BLOCKED auto-persist of known parent category ${categoryId} for "${normalizedKey}"`,
    );
    return false;
  }

  // Gate 1: Minimum confidence (#2)
  if (confidence < AUTO_PERSIST_MIN_CONFIDENCE) {
    console.log(
      `category-lookup: skipping auto-persist for "${normalizedKey}" (confidence ${confidence} < ${AUTO_PERSIST_MIN_CONFIDENCE})`,
    );
    return false;
  }

  // Gate 2: Verify leaf + active (#4)
  let verifiedLeaf = true;
  let verifiedActive = true;
  if (ebayAuth) {
    const verification = await verifyCategoryLeafActive(
      categoryId,
      ebayAuth.token,
      ebayAuth.base,
    );
    verifiedLeaf = verification.isLeaf;
    verifiedActive = verification.isActive;
    if (!verifiedLeaf || !verifiedActive) {
      console.warn(
        `category-lookup: blocking persist of non-leaf/inactive category ${categoryId} for "${normalizedKey}"`,
      );
      return false;
    }
  }

  // Gate 3: Determine status based on source (#2)
  const status =
    source === "ebay_api" && confidence >= 85 ? "approved" : "quarantine";

  // Compute effective_score (#8)
  const sourceWeightMap: Record<string, number> = {
    ebay_api: 5,
    gemini_ai: 0,
    ai_auto: -10,
  };
  const effectiveScore = Math.min(
    100,
    Math.max(0, confidence + (sourceWeightMap[source] || 0)),
  );

  // Deep normalize for dedup (#6)
  const normalized = deepNormalize(normalizedKey);

  try {
    await supabase.from("category_mappings").upsert(
      {
        coin_type: normalizedKey,
        item_type: normalizedKey,
        item_type_normalized: normalized,
        ebay_category_id: categoryId,
        category_name: categoryName,
        breadcrumb: breadcrumb,
        verification_source: source,
        confidence: confidence,
        effective_score: effectiveScore,
        status: status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "coin_type" },
    );
    console.log(
      `category-lookup: persisted ${categoryId} for "${normalizedKey}" (status=${status}, score=${effectiveScore})`,
    );
    return true;
  } catch (saveErr) {
    console.warn("category-lookup: failed to persist mapping", saveErr);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN REQUEST HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const payload = await req.json();
    const {
      action,
      itemType,
      coinType,
      categoryId,
      categoryName,
      verificationSource,
    } = payload;

    const rawItemType = itemType || coinType || "";
    const normalizedKey = normalizeItemType(rawItemType);
    const queryTokens = meaningfulTokens(rawItemType);

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: lookup
    // ══════════════════════════════════════════════════════════════════════
    // Ranked candidate system with deterministic precedence (#1, #3):
    //   1. DB exact (approved, user_verified) — highest trust
    //   2. DB exact (approved, other sources) — high trust
    //   3. eBay getCategorySuggestions — verified leaf from official API
    //   4. DB fuzzy (approved, gated) — only if passes similarity threshold
    //   5. Gemini AI — last resort
    //
    // Winner selection: highest effective_score among verified candidates.
    // If top eBay candidate >= DETERMINISTIC_LOCK_THRESHOLD, lock it (#3).
    // All candidates logged to lookup_decisions table (#0).
    // ══════════════════════════════════════════════════════════════════════

    if (action === "lookup") {
      if (!normalizedKey) {
        return new Response(
          JSON.stringify({ found: false, message: "itemType is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const requestId = generateRequestId();
      const allCandidates: LookupCandidate[] = [];
      const auditEntries: AuditEntry[] = [];
      let ebayAuth: { token: string; base: string } | null = null;

      // ── Tier 1: DB exact match (approved only) (#2) ──────────────────
      const dbExactStart = Date.now();
      // EA-P2-B: Also match on item_type_normalized for order-insensitive exact matches
      const deepNormalizedKey = deepNormalize(normalizedKey);
      const { data: exactRows } = await supabase
        .from("category_mappings")
        .select(
          "ebay_category_id, category_name, confidence, verification_source, item_type, coin_type, breadcrumb, effective_score, updated_at, status",
        )
        .or(
          `item_type.eq.${normalizedKey},coin_type.eq.${normalizedKey},item_type_normalized.eq.${deepNormalizedKey}`,
        )
        .eq("status", "approved")
        .order("effective_score", { ascending: false })
        .limit(3);

      const dbExactLatency = Date.now() - dbExactStart;

      if (exactRows && exactRows.length > 0) {
        for (let i = 0; i < exactRows.length; i++) {
          const row = exactRows[i];
          const daysSinceUpdate =
            (Date.now() - new Date(row.updated_at).getTime()) /
            (1000 * 60 * 60 * 24);
          const sourceKey =
            row.verification_source === "user_verified"
              ? "db_exact_user_verified"
              : row.verification_source === "ebay_api"
                ? "db_exact_ebay_api"
                : "db_exact";

          const effectiveScore = computeEffectiveScore(
            sourceKey,
            row.confidence ?? 80,
            queryTokens.length, // exact match = full overlap
            queryTokens.length,
            false, // exact match is never generic
            daysSinceUpdate,
          );

          allCandidates.push({
            categoryId: row.ebay_category_id,
            categoryName: row.category_name,
            breadcrumb: row.breadcrumb || row.category_name,
            source: sourceKey,
            rawScore: row.confidence ?? 80,
            effectiveScore,
            reason: `DB exact match (${row.verification_source}, confidence=${row.confidence})`,
            verifiedLeaf: null, // Not re-verified for DB exact
            verifiedActive: null,
            tokenOverlap: queryTokens.length,
            rank: i + 1,
          });
        }
      }

      // ── Tier 2: eBay getCategorySuggestions (always run for comparison) ─
      const ebayStart = Date.now();
      ebayAuth = await getEbayAppToken();
      let ebaySuggestions: CategorySuggestion[] = [];

      if (ebayAuth) {
        ebaySuggestions = await fetchCategorySuggestions(
          rawItemType,
          ebayAuth.token,
          ebayAuth.base,
        );

        for (let i = 0; i < Math.min(ebaySuggestions.length, 5); i++) {
          const s = ebaySuggestions[i];
          const tokenOverlap = computeTokenOverlap(
            queryTokens,
            `${s.categoryName} ${s.breadcrumb}`,
          );

          // EA-P2-C: Lower raw scores to leave room for penalties (was 90-3*i)
          const rawScore = 80 - i * 4; // 80, 76, 72, 68, 64 for ranks 1-5

          // Verify leaf status for top candidate (#4) — needed BEFORE scoring for penalty
          let verifiedLeaf: boolean | null = null;
          let verifiedActive: boolean | null = null;
          if (i === 0 && ebayAuth) {
            const verification = await verifyCategoryLeafActive(
              s.categoryId,
              ebayAuth.token,
              ebayAuth.base,
            );
            verifiedLeaf = verification.isLeaf;
            verifiedActive = verification.isActive;
          }

          // EA-P2-C: Pass verifiedLeaf so non-leaf penalty is applied BEFORE lock check
          const effectiveScore = computeEffectiveScore(
            "ebay_api",
            rawScore,
            tokenOverlap,
            queryTokens.length,
            false, // eBay results are never generic
            0, // Fresh from API
            verifiedLeaf, // EA-P2-C: non-leaf penalty in scoring
          );

          allCandidates.push({
            categoryId: s.categoryId,
            categoryName: s.categoryName,
            breadcrumb: s.breadcrumb,
            source: "ebay_api",
            rawScore,
            effectiveScore,
            reason: `eBay getCategorySuggestions rank #${i + 1}`,
            verifiedLeaf,
            verifiedActive,
            tokenOverlap,
            rank: i + 1,
          });
        }
      }
      const ebayLatency = Date.now() - ebayStart;

      // ── Tier 3: DB fuzzy match (approved only, gated) (#1) ───────────
      const dbFuzzyStart = Date.now();
      const keywords = normalizedKey
        .split(" ")
        .filter((w) => w.length > 3 && !STOPWORDS.has(w));
      let fuzzyMatches: any[] = [];

      for (const kw of keywords.slice(0, 3)) {
        const { data: fuzzy } = await supabase
          .from("category_mappings")
          .select(
            "ebay_category_id, category_name, confidence, verification_source, item_type, coin_type, breadcrumb, effective_score, updated_at, status",
          )
          .eq("status", "approved")
          .or(`item_type.ilike.%${kw}%,coin_type.ilike.%${kw}%`)
          .order("effective_score", { ascending: false })
          .limit(3);

        if (fuzzy && fuzzy.length > 0) {
          fuzzyMatches.push(...fuzzy);
        }
      }

      // Deduplicate fuzzy matches by category ID
      const seenFuzzy = new Set<string>();
      fuzzyMatches = fuzzyMatches.filter((f) => {
        if (seenFuzzy.has(f.ebay_category_id)) return false;
        seenFuzzy.add(f.ebay_category_id);
        return true;
      });

      const dbFuzzyLatency = Date.now() - dbFuzzyStart;

      for (let i = 0; i < Math.min(fuzzyMatches.length, 3); i++) {
        const row = fuzzyMatches[i];
        const candidateText = row.item_type || row.coin_type || "";
        const tokenOverlap = computeTokenOverlap(queryTokens, candidateText);
        const daysSinceUpdate =
          (Date.now() - new Date(row.updated_at).getTime()) /
          (1000 * 60 * 60 * 24);
        const isGeneric = isGenericItemType(candidateText, queryTokens); // EA-P1-C: context-aware

        // Apply fuzzy gates (#1)
        if (tokenOverlap < FUZZY_MIN_TOKEN_OVERLAP) {
          console.log(
            `category-lookup: fuzzy candidate "${candidateText}" rejected — token overlap ${tokenOverlap} < ${FUZZY_MIN_TOKEN_OVERLAP}`,
          );
          continue;
        }

        const effectiveScore = computeEffectiveScore(
          "db_fuzzy",
          row.confidence ?? 70,
          tokenOverlap,
          queryTokens.length,
          isGeneric,
          daysSinceUpdate,
        );

        // Skip if score too low after penalties
        if (effectiveScore < FUZZY_MIN_SIMILARITY * 100) {
          console.log(
            `category-lookup: fuzzy candidate "${candidateText}" rejected — effective score ${effectiveScore.toFixed(
              1,
            )} < ${FUZZY_MIN_SIMILARITY * 100}`,
          );
          continue;
        }

        allCandidates.push({
          categoryId: row.ebay_category_id,
          categoryName: row.category_name,
          breadcrumb: row.breadcrumb || row.category_name,
          source: "db_fuzzy",
          rawScore: row.confidence ?? 70,
          effectiveScore,
          reason: `DB fuzzy match "${candidateText}" (overlap=${tokenOverlap}, generic=${isGeneric}, days=${Math.round(
            daysSinceUpdate,
          )})`,
          verifiedLeaf: null,
          verifiedActive: null,
          tokenOverlap,
          rank: i + 1,
        });
      }

      // ── Tier 4: Gemini fallback (only if no good candidates) ─────────
      let geminiLatency = 0;
      const bestSoFar = allCandidates.reduce(
        (best, c) =>
          c.effectiveScore > (best?.effectiveScore ?? 0) ? c : best,
        null as LookupCandidate | null,
      );

      if (!bestSoFar || bestSoFar.effectiveScore < 70) {
        const geminiStart = Date.now();
        const geminiResult = await askGeminiForCategory(rawItemType);
        geminiLatency = Date.now() - geminiStart;

        if (geminiResult) {
          // EA-P1-B: Verify Gemini's suggestion — LLMs hallucinate category IDs
          let geminiVerifiedLeaf: boolean | null = null;
          let geminiVerifiedActive: boolean | null = null;

          if (ebayAuth) {
            const geminiVerification = await verifyCategoryLeafActive(
              geminiResult.categoryId,
              ebayAuth.token,
              ebayAuth.base,
            );
            geminiVerifiedLeaf = geminiVerification.isLeaf;
            geminiVerifiedActive = geminiVerification.isActive;

            if (!geminiVerification.isLeaf || !geminiVerification.isActive) {
              console.warn(
                `category-lookup: Gemini suggested category ${geminiResult.categoryId} ` +
                  `(${geminiResult.categoryName}) is NOT a valid leaf/active category — discarding`,
              );
              // Do NOT add invalid Gemini suggestions to candidates
            } else {
              const effectiveScore = computeEffectiveScore(
                "gemini",
                geminiResult.confidence,
                0,
                0,
                false,
                0,
                geminiVerifiedLeaf,
              );
              allCandidates.push({
                categoryId: geminiResult.categoryId,
                categoryName: geminiResult.categoryName,
                breadcrumb: geminiResult.categoryName,
                source: "gemini",
                rawScore: geminiResult.confidence,
                effectiveScore,
                reason: `Gemini AI suggestion (self-reported confidence=${geminiResult.confidence}, verified leaf)`,
                verifiedLeaf: geminiVerifiedLeaf,
                verifiedActive: geminiVerifiedActive,
                tokenOverlap: 0,
                rank: 1,
              });
            }
          } else {
            // No eBay auth — add with null verification (lower trust, will not reach lock threshold)
            const effectiveScore = computeEffectiveScore(
              "gemini",
              geminiResult.confidence,
              0,
              0,
              false,
              0,
              null,
            );
            allCandidates.push({
              categoryId: geminiResult.categoryId,
              categoryName: geminiResult.categoryName,
              breadcrumb: geminiResult.categoryName,
              source: "gemini",
              rawScore: geminiResult.confidence,
              effectiveScore,
              reason: `Gemini AI suggestion (self-reported confidence=${geminiResult.confidence}, unverified — no eBay auth)`,
              verifiedLeaf: null,
              verifiedActive: null,
              tokenOverlap: 0,
              rank: 1,
            });
          }
        }
      }

      // ── Winner selection ─────────────────────────────────────────────
      // Sort all candidates by effective score descending
      allCandidates.sort((a, b) => b.effectiveScore - a.effectiveScore);

      // Check for deterministic lock (#3): if top eBay candidate is strong enough, lock it
      const topEbay = allCandidates.find(
        (c) => c.source === "ebay_api" && c.rank === 1,
      );
      let winner: LookupCandidate | null = null;
      let lockReason = "";

      if (
        topEbay &&
        topEbay.effectiveScore >= DETERMINISTIC_LOCK_THRESHOLD &&
        topEbay.verifiedLeaf !== false
      ) {
        winner = topEbay;
        lockReason = `Deterministic lock: eBay top-1 score ${topEbay.effectiveScore.toFixed(
          1,
        )} >= ${DETERMINISTIC_LOCK_THRESHOLD}`;
      } else {
        // Take highest effective score, preferring verified leaf
        for (const c of allCandidates) {
          if (c.verifiedLeaf === false) continue; // Skip known non-leaf (#4)
          winner = c;
          lockReason = `Highest effective score: ${c.effectiveScore.toFixed(1)} from ${c.source}`;
          break;
        }
        // If all are non-leaf, take the best anyway
        if (!winner && allCandidates.length > 0) {
          winner = allCandidates[0];
          lockReason = `Fallback: best available candidate (no verified leaf)`;
        }
      }

      // ── Audit logging (#0, #9) ──────────────────────────────────────
      for (const c of allCandidates) {
        auditEntries.push({
          request_id: requestId,
          query_text: rawItemType,
          candidate_source: c.source,
          candidate_id: c.categoryId,
          candidate_name: c.categoryName,
          candidate_score: c.effectiveScore,
          candidate_rank: c.rank,
          was_selected:
            winner !== null &&
            c.categoryId === winner.categoryId &&
            c.source === winner.source,
          reason_selected: c === winner ? lockReason : c.reason,
          verified_leaf: c.verifiedLeaf,
          verified_active: c.verifiedActive,
          persisted_to_db: false,
          latency_ms: c.source.startsWith("db_exact")
            ? dbExactLatency
            : c.source === "ebay_api"
              ? ebayLatency
              : c.source === "db_fuzzy"
                ? dbFuzzyLatency
                : geminiLatency,
        });
      }

      // ── Auto-persist winner (#2 gates applied) ──────────────────────
      let persisted = false;
      if (winner && winner.source === "ebay_api") {
        persisted = await safePersistMapping(
          supabase,
          normalizedKey,
          winner.categoryId,
          winner.categoryName,
          winner.breadcrumb,
          "ebay_api",
          winner.rawScore,
          ebayAuth,
        );
      } else if (winner && winner.source === "gemini") {
        persisted = await safePersistMapping(
          supabase,
          normalizedKey,
          winner.categoryId,
          winner.categoryName,
          winner.breadcrumb,
          "gemini_ai",
          winner.rawScore,
          ebayAuth,
        );
      }

      // Update audit entries with persist status
      if (persisted && winner) {
        const winnerAudit = auditEntries.find((a) => a.was_selected);
        if (winnerAudit) winnerAudit.persisted_to_db = true;
      }

      // Persist audit (non-blocking)
      persistAuditEntries(supabase, auditEntries).catch((e) =>
        console.warn("audit persist failed:", e),
      );

      // ── Build response ──────────────────────────────────────────────
      if (winner) {
        return new Response(
          JSON.stringify({
            found: true,
            itemType: normalizedKey,
            categoryId: winner.categoryId,
            categoryName: winner.categoryName,
            breadcrumb: winner.breadcrumb,
            confidence: winner.rawScore,
            effectiveScore: Math.round(winner.effectiveScore * 100) / 100,
            verificationSource: winner.source.replace("db_exact_", ""),
            source: winner.source,
            reasonSelected: lockReason,
            verifiedLeaf: winner.verifiedLeaf,
            verifiedActive: winner.verifiedActive,
            persistedToDb: persisted,
            requestId: requestId,
            candidateCount: allCandidates.length,
            alternatives: allCandidates
              .filter((c) => c !== winner)
              .slice(0, 3)
              .map((c) => ({
                categoryId: c.categoryId,
                categoryName: c.categoryName,
                breadcrumb: c.breadcrumb,
                source: c.source,
                score: Math.round(c.effectiveScore * 100) / 100,
              })),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // No winner — circuit breaker (#9)
      return new Response(
        JSON.stringify({
          found: false,
          itemType: normalizedKey,
          message:
            "No category passed confidence threshold — present top options to user",
          requestId: requestId,
          topCandidates: allCandidates.slice(0, 3).map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            breadcrumb: c.breadcrumb,
            source: c.source,
            score: Math.round(c.effectiveScore * 100) / 100,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: suggest
    // ══════════════════════════════════════════════════════════════════════
    if (action === "suggest") {
      const query = payload.query || rawItemType || "";
      if (!query) {
        return new Response(
          JSON.stringify({ suggestions: [], message: "query is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        return new Response(
          JSON.stringify({
            suggestions: [],
            message: "eBay API credentials not configured",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const suggestions = await fetchCategorySuggestions(
        query,
        ebayAuth.token,
        ebayAuth.base,
      );

      // Verify top suggestion is leaf (#4)
      if (suggestions.length > 0) {
        const topVerification = await verifyCategoryLeafActive(
          suggestions[0].categoryId,
          ebayAuth.token,
          ebayAuth.base,
        );
        if (!topVerification.isLeaf) {
          console.warn(
            `category-lookup suggest: top suggestion ${suggestions[0].categoryId} is NOT a leaf category`,
          );
        }
      }

      return new Response(
        JSON.stringify({
          suggestions: suggestions.slice(0, 5).map((s, i) => ({
            categoryId: s.categoryId,
            categoryName: s.categoryName,
            breadcrumb: s.breadcrumb,
            rank: i + 1,
          })),
          query,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: aspects
    // ══════════════════════════════════════════════════════════════════════
    if (action === "aspects") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for aspects action");

      // 1. Check cache first (composite key with marketplace/tree) (#7)
      const { data: cached } = await supabase
        .from("category_aspects_cache")
        .select("aspects, category_name, fetched_at, expires_at")
        .eq("category_id", cid)
        .eq("marketplace_id", MARKETPLACE_ID)
        .eq("category_tree_id", CATEGORY_TREE_ID)
        .maybeSingle();

      if (cached && new Date(cached.expires_at) > new Date()) {
        console.log(
          `category-lookup: aspects cache hit for ${cid} (fetched ${cached.fetched_at})`,
        );
        return new Response(
          JSON.stringify({
            categoryId: cid,
            categoryName: cached.category_name,
            aspects: cached.aspects,
            source: "cache",
            fetchedAt: cached.fetched_at,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 2. Cache miss or expired — fetch from eBay API
      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        if (cached) {
          return new Response(
            JSON.stringify({
              categoryId: cid,
              categoryName: cached.category_name,
              aspects: cached.aspects,
              source: "cache_stale",
              fetchedAt: cached.fetched_at,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            categoryId: cid,
            aspects: [],
            source: "none",
            message: "No eBay credentials",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const aspects = await fetchItemAspects(
        cid,
        ebayAuth.token,
        ebayAuth.base,
      );

      if (aspects.length > 0) {
        let catName = categoryName || cached?.category_name || null;
        if (!catName) {
          const { data: mapping } = await supabase
            .from("category_mappings")
            .select("category_name")
            .eq("ebay_category_id", cid)
            .maybeSingle();
          catName = mapping?.category_name || null;
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        try {
          await supabase.from("category_aspects_cache").upsert(
            {
              category_id: cid,
              marketplace_id: MARKETPLACE_ID,
              category_tree_id: CATEGORY_TREE_ID,
              category_name: catName,
              aspects: aspects,
              fetched_at: now.toISOString(),
              expires_at: expiresAt.toISOString(),
              updated_at: now.toISOString(),
            },
            { onConflict: "category_id,marketplace_id,category_tree_id" },
          );
          console.log(
            `category-lookup: cached ${aspects.length} aspects for category ${cid}`,
          );
        } catch (cacheErr) {
          console.warn("category-lookup: failed to cache aspects", cacheErr);
        }

        return new Response(
          JSON.stringify({
            categoryId: cid,
            categoryName: catName,
            aspects: aspects,
            source: "ebay_api",
            fetchedAt: now.toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          categoryId: cid,
          aspects: [],
          source: "ebay_api",
          message: "No aspects found",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: verify / breadcrumb
    // ══════════════════════════════════════════════════════════════════════
    if (action === "verify" || action === "breadcrumb") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) {
        throw new Error("categoryId required for verify/breadcrumb action");
      }

      // RC-5 FIX: ALWAYS verify leaf status via eBay API, even if category exists in DB.
      // The DB fast-path previously returned valid:true without isLeaf, allowing
      // non-leaf parent categories (e.g. 253 "Coins: US") to pass validation.
      // Now we use DB only for name/breadcrumb enrichment, but always verify remotely.
      let dbCategoryName: string | null = null;
      let dbBreadcrumb: string | null = null;
      try {
        const { data: local } = await supabase
          .from("category_mappings")
          .select("ebay_category_id, category_name, breadcrumb")
          .eq("ebay_category_id", cid)
          .maybeSingle();
        if (local?.category_name) {
          dbCategoryName = local.category_name;
          dbBreadcrumb = local.breadcrumb || local.category_name;
        }
      } catch (_) {
        /* continue */
      }

      // Always perform remote verification with leaf check (#4, RC-5)
      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        // No eBay credentials — return DB data if available, but isLeaf is unknown
        return new Response(
          JSON.stringify({
            valid: !!dbCategoryName,
            source: dbCategoryName ? "db" : "none",
            isLeaf: null,
            isActive: null,
            categoryName: dbCategoryName,
            breadcrumb: dbBreadcrumb,
            message: "No eBay credentials — leaf status unknown",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const verification = await verifyCategoryLeafActive(
        cid,
        ebayAuth.token,
        ebayAuth.base,
      );
      const breadcrumbResult = await fetchBreadcrumb(
        cid,
        ebayAuth.token,
        ebayAuth.base,
      );

      return new Response(
        JSON.stringify({
          valid: breadcrumbResult.valid,
          isLeaf: verification.isLeaf,
          isActive: verification.isActive,
          source: "remote",
          categoryName:
            breadcrumbResult.categoryName ||
            verification.categoryName ||
            dbCategoryName,
          breadcrumb: breadcrumbResult.breadcrumb || dbBreadcrumb,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: store (admin or auto-save)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "store") {
      const rawKey = normalizeItemType(rawItemType || categoryName || "");
      const breadcrumb = payload.breadcrumb || null;
      const normalized = deepNormalize(rawKey);

      const authHeader = req.headers.get("authorization");
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, "");
        const { data: userData, error: userErr } =
          await supabase.auth.getUser(token);
        if (userErr || !userData?.user?.id) {
          return new Response(
            JSON.stringify({ error: "Invalid authorization token" }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
        const userId = userData.user.id;
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", userId)
          .maybeSingle();
        const isAdmin = profile?.is_admin === true;
        const source = isAdmin
          ? verificationSource || "user_verified"
          : "ai_auto";
        const status = isAdmin ? "approved" : "quarantine";

        if (!categoryId) {
          throw new Error("categoryId required for store action");
        }

        const { error } = await supabase.from("category_mappings").upsert(
          {
            coin_type: rawKey,
            item_type: rawKey,
            item_type_normalized: normalized,
            ebay_category_id: categoryId,
            category_name: categoryName || null,
            breadcrumb: breadcrumb,
            verification_source: source,
            confidence: isAdmin ? 100 : 80,
            effective_score: isAdmin ? 100 : 70,
            status: status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "coin_type" },
        );

        if (error) throw error;

        return new Response(
          JSON.stringify({
            success: true,
            itemType: rawKey,
            categoryId,
            stored: true,
            status,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // No auth — internal auto-save (apply gates #2)
      if (!categoryId) throw new Error("categoryId required for store action");

      const ebayAuth = await getEbayAppToken();
      const persisted = await safePersistMapping(
        supabase,
        rawKey,
        categoryId,
        categoryName || null,
        breadcrumb,
        verificationSource || "ai_auto",
        75,
        ebayAuth,
      );

      return new Response(
        JSON.stringify({
          success: persisted,
          itemType: rawKey,
          categoryId,
          stored: persisted,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: promote (move quarantined row to approved after publish success)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "promote") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for promote action");

      // Fetch current count first, then update with incremented value
      const { data: promoteExisting } = await supabase
        .from("category_mappings")
        .select("publish_success_count")
        .eq("ebay_category_id", cid)
        .maybeSingle();

      const newSuccessCount =
        ((promoteExisting?.publish_success_count as number) || 0) + 1;

      // EA-P3-A: Filter by item_type_normalized when provided for precise row targeting
      const promoteNormalized =
        payload.itemTypeNormalized ||
        (payload.itemType
          ? deepNormalize(normalizeItemType(payload.itemType))
          : null);

      let promoteQuery = supabase
        .from("category_mappings")
        .update({
          status: "approved",
          publish_success_count: newSuccessCount,
          last_publish_success: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("ebay_category_id", cid);

      if (promoteNormalized) {
        promoteQuery = promoteQuery.eq(
          "item_type_normalized",
          promoteNormalized,
        );
      }

      const { error } = await promoteQuery;

      return new Response(
        JSON.stringify({ success: !error, categoryId: cid, action: "promote" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // ACTION: demote (record publish failure, potentially reject)
    // ══════════════════════════════════════════════════════════════════════
    if (action === "demote") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for demote action");

      // EA-P3-A: Filter by item_type_normalized when provided
      const demoteNormalized =
        payload.itemTypeNormalized ||
        (payload.itemType
          ? deepNormalize(normalizeItemType(payload.itemType))
          : null);

      let demoteSelectQuery = supabase
        .from("category_mappings")
        .select("publish_failure_count, publish_success_count, effective_score")
        .eq("ebay_category_id", cid);

      if (demoteNormalized) {
        demoteSelectQuery = demoteSelectQuery.eq(
          "item_type_normalized",
          demoteNormalized,
        );
      }

      const { data: existing } = await demoteSelectQuery.maybeSingle();

      if (existing) {
        const newFailCount = (existing.publish_failure_count || 0) + 1;
        const successCount = existing.publish_success_count || 0;
        const newScore = Math.max(0, (existing.effective_score || 50) - 10);

        // Auto-reject if 3+ failures and no successes
        const newStatus =
          newFailCount >= 3 && successCount === 0 ? "rejected" : undefined;

        let demoteUpdateQuery = supabase
          .from("category_mappings")
          .update({
            publish_failure_count: newFailCount,
            effective_score: newScore,
            ...(newStatus ? { status: newStatus } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq("ebay_category_id", cid);

        if (demoteNormalized) {
          demoteUpdateQuery = demoteUpdateQuery.eq(
            "item_type_normalized",
            demoteNormalized,
          );
        }

        await demoteUpdateQuery;
      }

      return new Response(
        JSON.stringify({ success: true, categoryId: cid, action: "demote" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ACTION: conditions
    // ═══════════════════════════════════════════════════════════════════════════════
    // Fetch valid item conditions for a specific category from eBay Metadata API.
    // Returns array of {conditionId, conditionDescription, conditionHelpText}
    // Optionally includes condition descriptors for trading card categories.
    if (action === "conditions") {
      const cid = (categoryId || "").toString().trim();
      if (!cid) throw new Error("categoryId required for conditions action");

      const ebayAuth = await getEbayAppToken();
      if (!ebayAuth) {
        return new Response(
          JSON.stringify({
            categoryId: cid,
            conditions: [],
            source: "none",
            message: "No eBay credentials available",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      try {
        // eBay Metadata API: getItemConditionPolicies
        const filterParam = encodeURIComponent(`categoryIds:{${cid}}`);
        const url = `${ebayAuth.base}/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=${filterParam}`;

        console.log(`category-lookup: fetching conditions for category ${cid}`);
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${ebayAuth.token}`,
            Accept: "application/json",
            "Accept-Encoding": "gzip",
          },
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(
            `category-lookup: conditions API error ${resp.status}: ${errText}`,
          );
          return new Response(
            JSON.stringify({
              categoryId: cid,
              conditions: [],
              source: "ebay_api",
              error: `eBay API error: ${resp.status}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const dataText = await resp.text();
        let data: any;
        try {
          data = JSON.parse(dataText);
        } catch {
          console.error(
            `category-lookup: conditions JSON parse failed (length=${dataText.length}):`,
            dataText.slice(0, 200),
          );
          return new Response(
            JSON.stringify({
              categoryId: cid,
              conditions: [],
              source: "ebay_api",
              error: `Invalid JSON in eBay response (length=${dataText.length})`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const policies = data?.itemConditionPolicies || [];

        if (policies.length === 0) {
          return new Response(
            JSON.stringify({
              categoryId: cid,
              conditions: [],
              source: "ebay_api",
              message: "No condition policies found for this category",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Extract the policy for our category
        const policy =
          policies.find((p: any) => p.categoryId === cid) || policies[0];

        // Transform conditions into a cleaner format for frontend consumption
        const conditions = (policy.itemConditions || []).map((cond: any) => ({
          conditionId: cond.conditionId,
          conditionDescription: cond.conditionDescription,
          conditionHelpText: cond.conditionHelpText || null,
          usage: cond.usage || null,
          // Include condition descriptors for trading cards if present
          conditionDescriptors: cond.conditionDescriptors || null,
        }));

        console.log(
          `category-lookup: found ${conditions.length} conditions for category ${cid}`,
        );

        return new Response(
          JSON.stringify({
            categoryId: cid,
            categoryName: policy.categoryName || categoryName || null,
            itemConditionRequired: policy.itemConditionRequired ?? true,
            conditions: conditions,
            source: "ebay_api",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      } catch (fetchErr: any) {
        console.error(`category-lookup: conditions fetch error:`, fetchErr);
        return new Response(
          JSON.stringify({
            categoryId: cid,
            conditions: [],
            source: "ebay_api",
            error: fetchErr.message || "Failed to fetch conditions",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err: any) {
    console.error("category-lookup error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}

Deno.serve(handleRequest);
