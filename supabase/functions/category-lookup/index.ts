import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserOrServiceRole } from "../_helpers/authGuard.ts";
import { GEMINI_FAST_MODEL } from "../_helpers/geminiModels.ts";
import { isKnownParentCategoryId } from "../_helpers/leafCategoryGuard.ts";
import { type CandidateSource, type GatedCandidate, selectWinner } from "./resolverCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

// ── Constants ────────────────────────────────────────────────────────────────
const AUTO_PERSIST_MIN_CONFIDENCE = 85; // Minimum confidence for auto-persist (#2)
const MARKETPLACE_ID = "EBAY_US";
const CATEGORY_TREE_ID = "0";
// CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md §2.4: gate 4 (required-aspect
// satisfiability) ships in warn-only mode for the first two weeks. Set to
// "true" only once corpus data shows no false-positive pattern (Phase 6).
const GATE4_ENFORCE = (Deno.env.get("CATEGORY_GATE4_ENFORCE") || "").toLowerCase() === "true";
// A cache row this old is treated as possibly-stale and revalidated live
// against eBay's getCategorySubtree before being trusted for gate 1/2
// (plan §2.3: "cache-first fast path, live API fallback if cache row
// missing/>7 days old").
const CACHE_STALE_DAYS = 7;
// Minimum meaningful-token overlap for a DB "fuzzy" row to even be gathered
// as a candidate at all. This is a hard filter on candidate GATHERING, not
// a score weight — it never survives into the winner-selection logic below,
// which is pure precedence (resolverCore.ts).
const FUZZY_MIN_TOKEN_OVERLAP = 2;

// NOTE (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md §2.2 "What gets
// deleted"): ALWAYS_GENERIC_TERMS, DOMAIN_SPECIFIC_TERMS, isGenericItemType(),
// computeEffectiveScore(), and every weight/penalty constant that fed the
// old scored-ranking system have all been removed. The new resolver is
// filter-then-rank (hard gates + precedence, no arithmetic) — see
// resolverCore.ts for the replacement logic. Check git history on this file
// if any of that scoring code is ever needed for reference.

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
// Used only as a candidate-gathering filter for DB fuzzy rows (is this row
// even plausibly related to the query text?), never as a score input.
function computeTokenOverlap(
  queryTokens: string[],
  candidateText: string,
): number {
  const candidateTokens = new Set(meaningfulTokens(candidateText));
  return queryTokens.filter((t) => candidateTokens.has(t)).length;
}

// ── Helper: Get eBay app token (client credentials) ──────────────────────────
async function getEbayAppToken(): Promise<
  {
    token: string;
    base: string;
  } | null
> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  if (!clientId || !clientSecret) return null;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl = ebayEnv === "production"
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
  const base = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
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

  const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_suggestions?q=${
    encodeURIComponent(
      query,
    )
  }`;

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
          (a: any, b: any) => (a.categoryTreeNodeLevel || 0) - (b.categoryTreeNodeLevel || 0),
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
  const url =
    `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category?category_id=${
      encodeURIComponent(
        categoryId,
      )
    }`;

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
    const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_subtree?category_id=${
      encodeURIComponent(
        categoryId,
      )
    }`;
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
      // EA-P1-A: Pessimistic default — unknown API errors should NOT be treated as leaf.
      // Capture eBay's response body so the exact error (e.g. "Invalid category ID",
      // errorId, wrong-tree rejection) is visible in the function logs, not just the
      // HTTP status. Body may be empty or non-JSON for some 5xx; guard with try/catch.
      let errBody = "";
      try {
        errBody = (await resp.text()).slice(0, 200);
      } catch {
        errBody = "<unreadable body>";
      }
      console.warn(
        `category-lookup: verifyCategoryLeafActive(${categoryId}) error ${resp.status}: ${errBody}`,
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
    const url = `${base}/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_category_subtree?category_id=${
      encodeURIComponent(
        currentId,
      )
    }`;
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
async function askGeminiForCategory(itemDescription: string): Promise<
  {
    categoryId: string;
    categoryName: string;
    confidence: number;
  } | null
> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    console.warn("category-lookup: GEMINI_API_KEY not set, cannot ask Gemini");
    return null;
  }

  const prompt =
    `You are an eBay category expert. Given the following item description, return the single most accurate eBay leaf category ID.

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
          model: GEMINI_FAST_MODEL,
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
// The list itself lives in _helpers/leafCategoryGuard.ts as the single source of
// truth — this function used to carry its own 16-id copy, which had drifted and
// was missing every Phase 2/3 addition (99, 256, 45243, the dead World Coin ids),
// so parent categories the guard refuses were still being persisted here.
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
  if (isKnownParentCategoryId(categoryId)) {
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
  const status = source === "ebay_api" && confidence >= 85 ? "approved" : "quarantine";

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

// ──────────────────────────────────────────────────────────────────────────
// Filter-then-rank gate helpers (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md §2)
//
// These implement Layer 1's hard gates. All of the precedence/agreement
// DECISION logic (Layer 2 + 3) lives in resolverCore.ts as a pure function —
// everything here is I/O (Supabase cache lookups, eBay API calls) that
// produces the GatedCandidate[] resolverCore.selectWinner() consumes.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Gate 1 + 2: leaf existence + active status.
 *
 * Cache-first (plan §2.3): a fresh (<= CACHE_STALE_DAYS) row in
 * ebay_taxonomy_cache is authoritative and costs zero API calls. Anything
 * missing, or older than the staleness window, falls back to the live
 * getCategorySubtree check (verifyCategoryLeafActive, kept unchanged from
 * the pre-rewrite implementation).
 */
async function checkLeafActiveCacheFirst(
  supabase: any,
  categoryId: string,
  ebayAuth: { token: string; base: string } | null,
): Promise<
  {
    isLeaf: boolean;
    isActive: boolean;
    categoryName: string | null;
    breadcrumb: string | null;
    source: "cache" | "live" | "unknown";
  }
> {
  try {
    const { data: cacheRow } = await supabase
      .from("ebay_taxonomy_cache")
      .select("category_id, category_name, breadcrumb, is_leaf, synced_at")
      .eq("category_id", categoryId)
      .maybeSingle();

    if (cacheRow) {
      const ageDays = (Date.now() - new Date(cacheRow.synced_at).getTime()) /
        (1000 * 60 * 60 * 24);
      if (ageDays <= CACHE_STALE_DAYS) {
        // Fresh cache row is authoritative either way — a confident "not a
        // leaf" from a fresh sync is just as trustworthy as a confident
        // "is a leaf", and saves an API call in both directions.
        return {
          isLeaf: cacheRow.is_leaf === true,
          isActive: cacheRow.is_leaf === true, // presence in the cache implies active
          categoryName: cacheRow.category_name ?? null,
          breadcrumb: cacheRow.breadcrumb ?? null,
          source: "cache",
        };
      }
    }
  } catch (err) {
    console.warn(
      `category-lookup: ebay_taxonomy_cache lookup failed for ${categoryId} — falling back to live check`,
      err,
    );
  }

  if (!ebayAuth) {
    return { isLeaf: false, isActive: false, categoryName: null, breadcrumb: null, source: "unknown" };
  }

  const live = await verifyCategoryLeafActive(categoryId, ebayAuth.token, ebayAuth.base);
  return {
    isLeaf: live.isLeaf,
    isActive: live.isActive,
    categoryName: live.categoryName,
    breadcrumb: null,
    source: "live",
  };
}

/** Cache of categoryId -> accepted conditionIds (null = unknown), scoped to this module. */
const _categoryConditionCache: Map<string, string[] | null> = new Map();

/**
 * Gate 3: does this category accept the item's condition?
 *
 * Mirrors ebay-publish/publish-helpers.ts's categoryAcceptsCondition() —
 * duplicated rather than imported because Supabase edge functions cannot
 * import across function directories (each is deployed independently; see
 * CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md discussion of this
 * constraint). Reuses the app token already obtained via getEbayAppToken()
 * instead of re-authenticating with clientId/clientSecret.
 */
async function fetchCategoryConditionIds(
  categoryId: string,
  ebayAuth: { token: string; base: string },
): Promise<string[] | null> {
  const cacheKey = `${ebayAuth.base}:${categoryId}`;
  const cached = _categoryConditionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const filterParam = encodeURIComponent(`categoryIds:{${categoryId}}`);
    const url =
      `${ebayAuth.base}/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=${filterParam}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${ebayAuth.token}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      _categoryConditionCache.set(cacheKey, null);
      return null;
    }
    const text = await resp.text();
    if (!text || text.trim() === "") {
      _categoryConditionCache.set(cacheKey, null);
      return null;
    }
    const data = JSON.parse(text);
    const policies = data?.itemConditionPolicies;
    if (!Array.isArray(policies) || policies.length === 0) {
      _categoryConditionCache.set(cacheKey, null);
      return null;
    }
    const policy = policies.find((p: any) => p?.categoryId === categoryId) ?? policies[0];
    const ids = (policy?.itemConditions || [])
      .map((c: any) => String(c?.conditionId ?? "").trim())
      .filter((id: string) => id.length > 0);
    const result = ids.length > 0 ? ids : null;
    _categoryConditionCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`category-lookup: fetchCategoryConditionIds(${categoryId}) exception`, err);
    _categoryConditionCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Gate 3 wrapper: returns false only when we POSITIVELY know the category
 * rejects this condition. null/true both mean "don't drop" — per the same
 * fail-safe contract as categoryAcceptsCondition() in ebay-publish.
 *
 * DESIGN NOTE (resolves an open question from the Phase 4 plan): the
 * `lookup` action's caller (analyze-item, Pass 1) does not yet have a
 * condition determined at pre-lookup time — condition is only known later
 * in analyze-item's own pipeline. Rather than block gate 3 entirely on that
 * gap, this gate is made payload-optional: it activates ONLY when a caller
 * supplies `conditionId` in the lookup request. When omitted, gate 3 is a
 * no-op here and the existing downstream ebay-publish condition-reroute
 * logic (categoryAcceptsCondition + GRADED_UNFRIENDLY_WORLD_PARENTS) remains
 * the second line of defense at publish time, as it does today.
 */
async function checkConditionGate(
  categoryId: string,
  conditionId: string | null,
  ebayAuth: { token: string; base: string } | null,
): Promise<boolean | null> {
  if (!conditionId || !ebayAuth) return null; // gate not applicable — don't drop
  const acceptedIds = await fetchCategoryConditionIds(categoryId, ebayAuth);
  if (acceptedIds === null) return null; // unknown — don't drop
  return acceptedIds.includes(String(conditionId));
}

/**
 * Gate 4 (warn-only unless CATEGORY_GATE4_ENFORCE=true): required-aspect
 * satisfiability (plan §2.4). Deliberately conservative for v1 — only
 * REQUIRED aspects are checked, and the bar is "do we have a plausible
 * token from the query text that could satisfy this aspect," not an exact
 * value match. Returns a list of warning strings; empty = no concerns.
 */
async function checkAspectSatisfiability(
  categoryId: string,
  ebayAuth: { token: string; base: string } | null,
  knownTokens: string[],
): Promise<string[]> {
  if (!ebayAuth) return [];
  try {
    const aspects = await fetchItemAspects(categoryId, ebayAuth.token, ebayAuth.base);
    const requiredAspects = aspects.filter((a) => a.required);
    const warnings: string[] = [];

    for (const aspect of requiredAspects) {
      const aspectNameTokens = meaningfulTokens(aspect.name);
      const hasNameOverlap = aspectNameTokens.some((t) => knownTokens.includes(t));
      const hasValueOverlap = aspect.values.some((v) => knownTokens.includes(v.toLowerCase()));
      if (!hasNameOverlap && !hasValueOverlap) {
        warnings.push(
          `Required aspect "${aspect.name}" has no plausible value in the known item data`,
        );
      }
    }
    return warnings;
  } catch (err) {
    console.warn(`category-lookup: checkAspectSatisfiability(${categoryId}) exception`, err);
    return [];
  }
}

/** A candidate as gathered, before Layer 1 gating is applied. */
interface RawCandidate {
  categoryId: string;
  categoryName: string;
  breadcrumb: string;
  source: CandidateSource;
  rank: number;
  reason: string;
}

/**
 * Runs a single gathered candidate through all Layer-1 hard gates and
 * returns the GatedCandidate resolverCore.selectWinner() expects. ANY gate
 * failure marks `survived: false` with a `dropReason` — gate 4 is the sole
 * exception, which only drops when GATE4_ENFORCE is explicitly turned on.
 */
async function gateCandidate(
  raw: RawCandidate,
  supabase: any,
  ebayAuth: { token: string; base: string } | null,
  conditionId: string | null,
  knownTokens: string[],
): Promise<GatedCandidate> {
  let categoryName = raw.categoryName;
  let breadcrumb = raw.breadcrumb;
  let dropReason: string | null = null;

  // Gates 1 + 2: leaf existence + active status
  const leafActive = await checkLeafActiveCacheFirst(supabase, raw.categoryId, ebayAuth);
  if (leafActive.categoryName) categoryName = leafActive.categoryName;
  if (leafActive.breadcrumb) breadcrumb = leafActive.breadcrumb;

  if (!leafActive.isLeaf) {
    dropReason = `Gate 1 failed: category ${raw.categoryId} is not a confirmed leaf (checked via ${leafActive.source})`;
  } else if (!leafActive.isActive) {
    dropReason = `Gate 2 failed: category ${raw.categoryId} is not confirmed active (checked via ${leafActive.source})`;
  }

  // Gate 3: condition acceptance (only enforced when a conditionId was supplied)
  if (!dropReason && conditionId) {
    const accepts = await checkConditionGate(raw.categoryId, conditionId, ebayAuth);
    if (accepts === false) {
      dropReason = `Gate 3 failed: category ${raw.categoryId} does not accept condition ${conditionId}`;
    }
  }

  // Gate 4: required-aspect satisfiability (warn-only unless GATE4_ENFORCE)
  let gate4Warnings: string[] = [];
  if (!dropReason) {
    gate4Warnings = await checkAspectSatisfiability(raw.categoryId, ebayAuth, knownTokens);
    if (GATE4_ENFORCE && gate4Warnings.length > 0) {
      dropReason = `Gate 4 failed (enforced): ${gate4Warnings.join("; ")}`;
    }
  }

  return {
    categoryId: raw.categoryId,
    categoryName,
    breadcrumb,
    source: raw.source,
    rank: raw.rank,
    survived: dropReason === null,
    dropReason,
    gate4Warnings,
    reason: raw.reason,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN REQUEST HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const auth = await requireUserOrServiceRole(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
      conditionId,
    } = payload;

    const rawItemType = itemType || coinType || "";
    const normalizedKey = normalizeItemType(rawItemType);
    const queryTokens = meaningfulTokens(rawItemType);

    // ════════════════════════════════════════════════════════════════════
    // ACTION: lookup
    // ════════════════════════════════════════════════════════════════════
    // Filter-then-rank resolver (CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md
    // §2). No score, no arithmetic:
    //
    //   1. Gather candidates from user_verified DB row, db_exact DB row,
    //      eBay getCategorySuggestions, DB fuzzy, and Gemini fallback.
    //   2. Run every candidate through Layer-1 hard gates (leaf, active,
    //      condition, aspect satisfiability) — gateCandidate().
    //   3. Hand the gated list to resolverCore.selectWinner() for Layer 2
    //      (precedence) + Layer 3 (agreement check). NEEDS_CONFIRMATION is
    //      a first-class outcome, never silently resolved.
    //
    // All candidates (survivors and drops alike) are logged to
    // lookup_decisions for audit/debugging.
    // ════════════════════════════════════════════════════════════════════

    if (action === "lookup") {
      if (!normalizedKey) {
        return new Response(
          JSON.stringify({ found: false, message: "itemType is required" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const requestId = generateRequestId();
      const rawCandidates: RawCandidate[] = [];
      const conditionIdStr = conditionId != null ? String(conditionId) : null;

      const ebayAuth = await getEbayAppToken();

      // ── Gather: user_verified / db_exact DB row(s) ─────────────────────
      const deepNormalizedKey = deepNormalize(normalizedKey);
      const dbStart = Date.now();
      const { data: exactRows } = await supabase
        .from("category_mappings")
        .select(
          "ebay_category_id, category_name, confidence, verification_source, item_type, coin_type, breadcrumb, updated_at, status",
        )
        .or(
          `item_type.eq.${normalizedKey},coin_type.eq.${normalizedKey},item_type_normalized.eq.${deepNormalizedKey}`,
        )
        .eq("status", "approved")
        .order("updated_at", { ascending: false })
        .limit(3);
      const dbLatency = Date.now() - dbStart;

      if (exactRows && exactRows.length > 0) {
        for (let i = 0; i < exactRows.length; i++) {
          const row = exactRows[i];
          const source: CandidateSource = row.verification_source === "user_verified" ? "user_verified" : "db_exact";
          rawCandidates.push({
            categoryId: row.ebay_category_id,
            categoryName: row.category_name,
            breadcrumb: row.breadcrumb || row.category_name,
            source,
            rank: i + 1,
            reason: `DB exact match (${row.verification_source}, confidence=${row.confidence})`,
          });
        }
      }

      // ── Gather: eBay getCategorySuggestions ────────────────────────────
      const ebayStart = Date.now();
      let ebaySuggestions: CategorySuggestion[] = [];
      if (ebayAuth) {
        ebaySuggestions = await fetchCategorySuggestions(
          rawItemType,
          ebayAuth.token,
          ebayAuth.base,
        );
        for (let i = 0; i < Math.min(ebaySuggestions.length, 5); i++) {
          const s = ebaySuggestions[i];
          rawCandidates.push({
            categoryId: s.categoryId,
            categoryName: s.categoryName,
            breadcrumb: s.breadcrumb,
            source: "ebay_api",
            rank: i + 1,
            reason: `eBay getCategorySuggestions rank #${i + 1}`,
          });
        }
      }
      const ebayLatency = Date.now() - ebayStart;

      // ── Gather: DB fuzzy match (candidate-gathering filter only — no score) ──
      const dbFuzzyStart = Date.now();
      const keywords = normalizedKey
        .split(" ")
        .filter((w) => w.length > 3 && !STOPWORDS.has(w));
      let fuzzyMatches: any[] = [];
      for (const kw of keywords.slice(0, 3)) {
        const { data: fuzzy } = await supabase
          .from("category_mappings")
          .select(
            "ebay_category_id, category_name, confidence, verification_source, item_type, coin_type, breadcrumb, updated_at, status",
          )
          .eq("status", "approved")
          .or(`item_type.ilike.%${kw}%,coin_type.ilike.%${kw}%`)
          .order("updated_at", { ascending: false })
          .limit(3);
        if (fuzzy && fuzzy.length > 0) fuzzyMatches.push(...fuzzy);
      }
      const seenFuzzy = new Set<string>();
      fuzzyMatches = fuzzyMatches.filter((f) => {
        if (seenFuzzy.has(f.ebay_category_id)) return false;
        seenFuzzy.add(f.ebay_category_id);
        return true;
      });
      const dbFuzzyLatency = Date.now() - dbFuzzyStart;

      let fuzzyRank = 1;
      for (const row of fuzzyMatches.slice(0, 5)) {
        const candidateText = row.item_type || row.coin_type || "";
        const tokenOverlap = computeTokenOverlap(queryTokens, candidateText);
        if (tokenOverlap < FUZZY_MIN_TOKEN_OVERLAP) continue; // not even plausibly related
        rawCandidates.push({
          categoryId: row.ebay_category_id,
          categoryName: row.category_name,
          breadcrumb: row.breadcrumb || row.category_name,
          source: "db_fuzzy",
          rank: fuzzyRank++,
          reason: `DB fuzzy match "${candidateText}" (token overlap=${tokenOverlap})`,
        });
        if (fuzzyRank > 3) break;
      }

      // ── Gather: Gemini fallback (only when nothing else was found) ─────
      let geminiLatency = 0;
      if (rawCandidates.length === 0) {
        const geminiStart = Date.now();
        const geminiResult = await askGeminiForCategory(rawItemType);
        geminiLatency = Date.now() - geminiStart;
        if (geminiResult) {
          rawCandidates.push({
            categoryId: geminiResult.categoryId,
            categoryName: geminiResult.categoryName,
            breadcrumb: geminiResult.categoryName,
            source: "gemini",
            rank: 1,
            reason:
              `Gemini AI suggestion (self-reported confidence=${geminiResult.confidence}) — never an oracle, agreement-check participant only`,
          });
        }
      }

      // ── Layer 1: run every gathered candidate through the hard gates ───
      const gatedCandidates: GatedCandidate[] = await Promise.all(
        rawCandidates.map((c) => gateCandidate(c, supabase, ebayAuth, conditionIdStr, queryTokens)),
      );

      // ── Layer 2 + 3: precedence + agreement check (resolverCore.ts) ─────
      const result = selectWinner(gatedCandidates);

      // ── Audit logging (#0, #9) ──────────────────────────────────────────
      const auditEntries: AuditEntry[] = gatedCandidates.map((c) => ({
        request_id: requestId,
        query_text: rawItemType,
        candidate_source: c.source,
        candidate_id: c.categoryId,
        candidate_name: c.categoryName,
        candidate_score: 0, // no score in the filter-then-rank model
        candidate_rank: c.rank,
        was_selected: result.winner !== null &&
          c.categoryId === result.winner.categoryId &&
          c.source === result.winner.source,
        reason_selected: c === result.winner ? result.lockReason : (c.dropReason ?? c.reason),
        verified_leaf: c.survived ? true : (c.dropReason?.startsWith("Gate 1") ? false : null),
        verified_active: c.survived ? true : (c.dropReason?.startsWith("Gate 2") ? false : null),
        persisted_to_db: false,
        latency_ms: c.source === "user_verified" || c.source === "db_exact"
          ? dbLatency
          : c.source === "ebay_api"
          ? ebayLatency
          : c.source === "db_fuzzy"
          ? dbFuzzyLatency
          : geminiLatency,
      }));

      // ── Auto-persist winner (only automated sources — never re-persist
      //    a user_verified row back over itself) ──────────────────────────
      let persisted = false;
      if (result.winner && result.winner.source === "ebay_api") {
        persisted = await safePersistMapping(
          supabase,
          normalizedKey,
          result.winner.categoryId,
          result.winner.categoryName,
          result.winner.breadcrumb,
          "ebay_api",
          AUTO_PERSIST_MIN_CONFIDENCE,
          ebayAuth,
        );
      }
      if (persisted) {
        const winnerAudit = auditEntries.find((a) => a.was_selected);
        if (winnerAudit) winnerAudit.persisted_to_db = true;
      }

      persistAuditEntries(supabase, auditEntries).catch((e) => console.warn("audit persist failed:", e));

      // ── Build response ──────────────────────────────────────────────────
      // Field names are kept as close as possible to the pre-rewrite shape
      // (found, categoryId, categoryName, breadcrumb, verifiedLeaf,
      // needsConfirmation, topCandidates, alternatives, source) to minimize
      // downstream breakage in analyze-item / the frontend. `effectiveScore`
      // and `confidence` are retired — there is no score in this model.
      if (result.winner) {
        return new Response(
          JSON.stringify({
            found: true,
            itemType: normalizedKey,
            categoryId: result.winner.categoryId,
            categoryName: result.winner.categoryName,
            breadcrumb: result.winner.breadcrumb,
            verificationSource: result.winner.source,
            source: result.winner.source,
            reasonSelected: result.lockReason,
            verifiedLeaf: true,
            verifiedActive: true,
            agreementChecked: result.agreementChecked,
            agreementSourcesMatched: result.agreementSourcesMatched,
            subtreeSeparated: result.subtreeSeparated,
            gate4Warnings: result.winner.gate4Warnings,
            persistedToDb: persisted,
            requestId,
            candidateCount: gatedCandidates.length,
            alternatives: gatedCandidates
              .filter((c) => c !== result.winner)
              .slice(0, 3)
              .map((c) => ({
                categoryId: c.categoryId,
                categoryName: c.categoryName,
                breadcrumb: c.breadcrumb,
                source: c.source,
                survived: c.survived,
              })),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // No winner — NEEDS_CONFIRMATION. Never silently resolved via
      // allCandidates[0]; the caller must surface a confirm-your-category
      // prompt with the top surviving/near-miss candidates.
      return new Response(
        JSON.stringify({
          found: false,
          needsConfirmation: true,
          itemType: normalizedKey,
          message: result.lockReason,
          requestId,
          topCandidates: gatedCandidates.slice(0, 5).map((c) => ({
            categoryId: c.categoryId,
            categoryName: c.categoryName,
            breadcrumb: c.breadcrumb,
            source: c.source,
            survived: c.survived,
            dropReason: c.dropReason,
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
            // A category that returns aspects is by definition a leaf.
            isLeaf: true,
            source: "ebay_api",
            fetchedAt: now.toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Zero aspects almost always means `cid` is a parent/rollup node rather
      // than a true leaf — eBay only exposes item aspects on leaf categories.
      // Verify explicitly so the client can distinguish "this category is a
      // parent, pick a real leaf" from "transient API failure, retry".
      const leafCheck = await verifyCategoryLeafActive(
        cid,
        ebayAuth.token,
        ebayAuth.base,
      );

      if (!leafCheck.isLeaf) {
        console.warn(
          `category-lookup: aspects requested for NON-LEAF category ${cid} — returning isLeaf:false`,
        );
      }

      return new Response(
        JSON.stringify({
          categoryId: cid,
          categoryName: leafCheck.categoryName,
          aspects: [],
          isLeaf: leafCheck.isLeaf,
          isActive: leafCheck.isActive,
          source: "ebay_api",
          message: leafCheck.isLeaf
            ? "No aspects found"
            : "Category is not a leaf — eBay exposes no item aspects for parent categories",
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
          categoryName: breadcrumbResult.categoryName ||
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
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
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
        const source = isAdmin ? verificationSource || "user_verified" : "ai_auto";
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

      const newSuccessCount = ((promoteExisting?.publish_success_count as number) || 0) + 1;

      // EA-P3-A: Filter by item_type_normalized when provided for precise row targeting
      const promoteNormalized = payload.itemTypeNormalized ||
        (payload.itemType ? deepNormalize(normalizeItemType(payload.itemType)) : null);

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
      const demoteNormalized = payload.itemTypeNormalized ||
        (payload.itemType ? deepNormalize(normalizeItemType(payload.itemType)) : null);

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
        const newStatus = newFailCount >= 3 && successCount === 0 ? "rejected" : undefined;

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
        const url =
          `${ebayAuth.base}/sell/metadata/v1/marketplace/${MARKETPLACE_ID}/get_item_condition_policies?filter=${filterParam}`;

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
        const policy = policies.find((p: any) => p.categoryId === cid) || policies[0];

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
