// Extracted from ebay-competitor-search/index.ts so competitor-prices-cron
// can run this in-process instead of invoking ebay-competitor-search over
// HTTP for every stale listing. That per-listing fetch() call was hitting
// Supabase's own platform-level rate limit on Edge-Function-to-Edge-Function
// invocations (a ~40s cooldown once tripped) well before eBay's own Browse
// API limits ever came into play, and the retry storm that followed
// appears to have gotten the isolate killed outright (no application-level
// error logged, just an abrupt cutoff and a generic EDGE_FUNCTION_ERROR).
//
// Excludes the Request/Response wrapping, request-body validation, and the
// auth.isServiceRole userId-trust logic -- those are concerns specific to
// being invoked by an HTTP request, which a cron caller doesn't have (same
// reasoning as ebayTokenRefresh.ts's extraction from ebay-publish/auth.ts).

// ----------------------------------------------------------------
// Cache TTL — 24 hours. Balances freshness vs. API call volume; raised from
// 8h once competitor-prices-cron moved to a capped, fairness-ranked cursor
// (see get_next_competitor_price_batch) that no longer needs a tight TTL to
// bound per-invocation work -- a longer TTL now reduces steady-state churn
// instead. competitor-prices-cron also uses this constant to decide whether
// a listing is stale enough to refresh (see its p_stale_before parameter).
// ----------------------------------------------------------------

import { GEMINI_FAST_MODEL } from "./geminiModels.ts";
import { runInBackground } from "./sentry.ts";

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Kill switch for the cache-by-product-signature feature, checked at call
// time (not module load) via a live Deno.env.get() so it can be flipped in
// production without a redeploy -- same pattern as category-lookup's
// CATEGORY_GATE4_ENFORCE (supabase/functions/category-lookup/index.ts).
// Default-on: signature matching only ever SKIPS a call it would otherwise
// make (see runCompetitorSearch's wiring), so there's no new failure mode
// to gate behind an opt-in.
function isSignatureMatchEnabled(): boolean {
  return (Deno.env.get("SIGNATURE_MATCH_ENABLED") ?? "true").toLowerCase() !== "false";
}

export interface CompetitorSearchOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Defensive numeric parse for Browse API's watchCount/bidCount -- exported
 * standalone (rather than only inline in fetchEbayCompetitors, which is not
 * itself exported/testable) so the "missing/non-numeric -> undefined, never
 * a coerced 0" contract has direct test coverage. A bare 0 would misreport
 * "confirmed zero interest" for an item eBay simply didn't report a count for.
 *
 * Restricted to number/string inputs before calling Number() -- `Number([])`
 * coerces to 0 and `Number(["5"])` to 5 in JS, which would silently treat a
 * malformed array value from upstream JSON as a real count.
 */
export function parseOptionalCount(raw: unknown): number | undefined {
  if (typeof raw !== "number" && typeof raw !== "string") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export interface CompetitorItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemId?: string;
  itemUrl?: string | null;
  imageUrl?: string | null;
  // Phase 3.2a (pricing-reliability plan): Browse API's ItemSummary includes
  // both by default (no fieldgroups param needed), but neither is guaranteed
  // populated for every item -- eBay has historically gated watcher-count
  // visibility, and bidCount only ever applies to auction-format listings.
  // Both undefined (never a bare null) when absent, so a consumer can use
  // `?? "not shown"` uniformly rather than juggling null vs. undefined.
  watchCount?: number;
  bidCount?: number;
}

// ----------------------------------------------------------------
// Build price distribution buckets from a list of prices.
// Generates up to 5 evenly-spaced buckets between min and max.
// ----------------------------------------------------------------
function buildDistribution(
  prices: number[],
): { min: number; max: number; count: number }[] {
  if (prices.length === 0) return [];

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  if (min === max) return [{ min, max, count: prices.length }];

  const BUCKET_COUNT = 5;
  const step = (max - min) / BUCKET_COUNT;
  const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    min: Math.round((min + i * step) * 100) / 100,
    max: Math.round((min + (i + 1) * step) * 100) / 100,
    count: 0,
  }));

  for (const price of prices) {
    const idx = Math.min(Math.floor((price - min) / step), BUCKET_COUNT - 1);
    buckets[idx].count++;
  }

  return buckets;
}

// ----------------------------------------------------------------
// Fallback: derive a clean search query from a listing title using
// simple heuristics (stop-word removal). Used when Gemini is
// unavailable or times out.
// ----------------------------------------------------------------
function deriveSearchQueryFallback(title: string): string {
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "of",
    "in",
    "for",
    "to",
    "with",
    "lot",
    "set",
    "collection",
    "item",
    "listing",
    "ebay",
    "certified",
    "uncirculated",
    "beautiful",
    "stunning",
    "rare",
    "vintage",
    "antique",
    "original",
    "authentic",
  ]);

  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  return tokens.slice(0, 6).join(" ");
}

function broadenSearchQuery(query: string): string {
  const gradeNoise = new Set([
    "pcgs",
    "ngc",
    "anacs",
    "icg",
    "cac",
    "iccs",
    "ms",
    "pr",
    "pf",
    "au",
    "xf",
    "vf",
    "f",
    "bu",
    "dcam",
    "cameo",
    "cert",
    "certified",
    "first",
    "strike",
    "releases",
    "release",
  ]);

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => !gradeNoise.has(t))
    .filter((t) => !/^\d{6,}$/.test(t))
    .filter((t) => !/^(ms|pr|pf|au|xf|vf)\d{1,2}$/i.test(t));

  return tokens.slice(0, 5).join(" ");
}

// ----------------------------------------------------------------
// Product-signature derivation (cache-by-product-signature feature).
//
// Deliberately DOES NOT reuse deriveSearchQueryFallback's stopWords or
// broadenSearchQuery's gradeNoise sets above, even though this function
// lives right next to them and does similar-looking tokenization. Those two
// sets exist to BROADEN a search query -- stripping a grading service name
// or a grade number there just means "search more loosely," which is safe,
// even desirable. Stripping the same tokens here would mean "treat two
// listings as the SAME priced product," which is a wrong-price bug the
// moment it's untrue -- e.g. gradeNoise strips "pcgs"/"ms63"-style tokens,
// which would silently collapse "1921 Morgan Dollar PCGS MS63" and "...
// MS64" into one signature despite a real price gap between those grades.
// stopWords also strips "certified"/"uncirculated", which would collapse a
// certified/graded listing with a raw one of the same date. And this
// function skips deriveSearchQueryFallback's `length > 1` filter entirely --
// that would drop single-character mint marks (S/D/P), silently merging
// "1909 S VDB Lincoln Cent" (a key date) with "1909 VDB Lincoln Cent" (a
// common date), the single highest-value false-positive case identified for
// this app's coin vertical. See competitorSearch's product-signature plan
// doc for the full reasoning (found via external entity-resolution research
// before implementation, not just an internal guess).
// ----------------------------------------------------------------
// "lot"/"set"/"collection"/"bundle" are deliberately NOT in either list below
// -- they're quantity/unit words, not filler: "1921 Morgan Silver Dollar"
// and "1921 Morgan Silver Dollar Set" price completely differently (one
// coin vs. a multi-coin set), so stripping the word would silently merge a
// single-item listing's comps with a set listing's (found in Copilot review
// of PR #602, 2026-09-19 -- a real false-positive class the original noise
// list missed).
const SIGNATURE_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "for",
  "to",
  "with",
  "item",
  "listing",
  "ebay",
  "beautiful",
  "stunning",
  "rare",
  "vintage",
  "antique",
  "original",
  "authentic",
]);

const LISTING_BOILERPLATE_WORDS = new Set([
  "free",
  "shipping",
  "fast",
  "ship",
  "combined",
  "look",
  "wow",
  "sale",
  "deal",
  "nr",
  "nice",
]);

// Below this many surviving significant tokens, a signature is too generic
// to trust -- production data (2026-09-18 audit) showed short/garbled
// titles producing queries like "202"/"Year"/"price" that repeat across
// unrelated listings via the heuristic search-query fallback. 4 gives
// comfortable margin below that noise floor while staying well under the
// token count of every real duplicate found in that same audit (e.g. "1999
// ty mcdonald teenie beanie baby" survives with 6 tokens).
const SIGNATURE_MIN_TOKENS = 4;

export interface ProductSignatureResult {
  signature: string | null;
  reason: string;
}

/**
 * Derives a normalized, order-insensitive, category-scoped signature from a
 * listing title for the cache-by-product-signature feature -- lets
 * attemptSignatureMatch find an existing fresh comp lookup for a DIFFERENT
 * listing of the same underlying product owned by the same seller, instead
 * of repeating a full Gemini + eBay Browse API search. Returns
 * `{signature: null, reason}` (never throws) whenever the title doesn't
 * yield enough significant tokens to trust -- callers should treat a null
 * signature exactly like a cache miss, not an error.
 */
export function computeProductSignature(
  title: string,
  categoryId?: string,
): ProductSignatureResult {
  if (typeof title !== "string" || title.trim().length === 0) {
    return { signature: null, reason: "title is missing or not a string" };
  }

  // A missing/blank categoryId is deliberately treated as ineligible, not
  // folded into a shared "nocat" bucket -- category_id is nullable on the
  // rows this cron reads, so a common fallback bucket would let two
  // unrelated four-token titles in different (or no) categories match each
  // other's comps (found in Copilot review of PR #602, 2026-09-19).
  if (typeof categoryId !== "string" || categoryId.trim().length === 0) {
    return { signature: null, reason: "no categoryId — not eligible for signature matching" };
  }

  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .filter((t) => !SIGNATURE_STOP_WORDS.has(t) && !LISTING_BOILERPLATE_WORDS.has(t));

  if (tokens.length < SIGNATURE_MIN_TOKENS) {
    return {
      signature: null,
      reason: `only ${tokens.length} significant token(s) after normalization (need ${SIGNATURE_MIN_TOKENS}+)`,
    };
  }

  const sortedTokens = [...tokens].sort();
  const signature = `${categoryId}::${sortedTokens.join("_")}`;
  return {
    signature,
    reason: `${tokens.length} significant tokens, category=${categoryId}`,
  };
}

export interface SearchPlanAttempt {
  query: string;
  categoryId?: string;
  strategy: string;
  filterMode: "fixed" | "any";
}

function buildSearchPlan(params: {
  title: string;
  geminiQuery: string | null;
  heuristicQuery: string;
  categoryId?: string;
}): SearchPlanAttempt[] {
  const { title, geminiQuery, heuristicQuery, categoryId } = params;

  const uniqueQueries: string[] = [];
  const pushQuery = (q: string | null | undefined) => {
    const cleaned = (q ?? "").trim();
    if (!cleaned) return;
    if (!uniqueQueries.includes(cleaned)) uniqueQueries.push(cleaned);
  };

  pushQuery(geminiQuery);
  pushQuery(heuristicQuery);
  pushQuery(broadenSearchQuery(geminiQuery ?? ""));
  pushQuery(broadenSearchQuery(heuristicQuery));
  pushQuery(deriveSearchQueryFallback(title));

  const plan: SearchPlanAttempt[] = [];
  // Phase 1.2b (pricing-reliability plan): capped at the first 2 unique
  // queries, not 4 -- confirmed 2026-09-17 that eBay's Browse API has a
  // real, hard 5,000-calls/day limit per client_id, shared across every
  // caller (live analyze-item requests, competitor-prices-cron,
  // market-watch-refresh, everything). The un-capped 4-query x 4-filter-mode
  // plan could reach 16 raw calls for a single search, and analyze-item
  // calls this twice per analysis (pre-AI + post-AI) -- up to 32 calls for
  // one item, or (via competitor-prices-cron's 24h refresh cycle) enough to
  // exhaust the daily quota with well under 500 synced listings for a
  // single user. groupPlanIntoTiers/runTieredCompSearch below group this
  // plan into per-query tiers and only run a 2nd tier if the 1st doesn't
  // meet the quality bar -- see their docstrings for the sequential-and-
  // evaluate control flow this caps against.
  for (const query of uniqueQueries.slice(0, 2)) {
    if (categoryId) {
      plan.push({
        query,
        categoryId,
        strategy: "with-category-fixed",
        filterMode: "fixed",
      });
      plan.push({
        query,
        categoryId,
        strategy: "with-category-any",
        filterMode: "any",
      });
    }
    plan.push({
      query,
      categoryId: undefined,
      strategy: "without-category-fixed",
      filterMode: "fixed",
    });
    plan.push({
      query,
      categoryId: undefined,
      strategy: "without-category-any",
      filterMode: "any",
    });
  }

  return plan;
}

/**
 * Groups buildSearchPlan's flat output into contiguous same-query runs --
 * "tier 0" is the full run of 2-4 filter/category attempts for the first
 * unique query, "tier 1" for the second. Does not change buildSearchPlan's
 * own return shape (its flat list is still used for the `attemptedQueries`
 * field in the empty-response body).
 */
export function groupPlanIntoTiers(
  plan: SearchPlanAttempt[],
): SearchPlanAttempt[][] {
  const tiers: SearchPlanAttempt[][] = [];
  let current: SearchPlanAttempt[] = [];
  for (const attempt of plan) {
    if (current.length > 0 && current[0].query !== attempt.query) {
      tiers.push(current);
      current = [];
    }
    current.push(attempt);
  }
  if (current.length > 0) tiers.push(current);
  return tiers;
}

export interface CompQualityGateResult {
  passes: boolean;
  reason: string;
}

/**
 * Phase 1.2b's quality gate: decides whether one tier's result is good
 * enough to stop, or thin enough to justify spending a 2nd tier's worth of
 * eBay quota. Spread (not comp count) is the dial that matters -- comp
 * count mostly reflects category liquidity (how many listings exist at
 * all), not query quality, so requiring more comps for thin categories
 * just penalizes them without signaling whether the query itself was good.
 * A tight spread from few comps means the query pulled a coherent set of
 * the same item; a wide spread means it grabbed unlike things. Global
 * defaults (3 comps / 3x spread) are deliberately not tuned per-category
 * yet -- see the plan doc's Phase 1.2b section for the deferred-until-
 * real-data reasoning on that.
 */
export function evaluateCompQuality(
  prices: number[],
  opts: { minCount?: number; maxSpreadRatio?: number } = {},
): CompQualityGateResult {
  const minCount = opts.minCount ?? 3;
  const maxSpreadRatio = opts.maxSpreadRatio ?? 3;
  if (prices.length < minCount) {
    return { passes: false, reason: `only ${prices.length} comps (need ${minCount}+)` };
  }
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min <= 0) return { passes: false, reason: "non-positive minimum price" };
  const spread = max / min;
  if (spread > maxSpreadRatio) {
    return { passes: false, reason: `price spread ${spread.toFixed(1)}x exceeds ${maxSpreadRatio}x` };
  }
  return { passes: true, reason: `${prices.length} comps within ${spread.toFixed(1)}x spread` };
}

// ----------------------------------------------------------------
// Gemini Flash — generate an optimised eBay search query.
//
// Strategy: give Gemini the full listing title and ask it to
// produce a short (≤8 word) eBay keyword string that will return
// the most comparable sold/active listings. This:
//   • Removes noise adjectives ("beautiful", "stunning", "rare")
//   • Preserves value-critical identifiers (year, mint mark, grade,
//     model number, size, colour)
//   • Adds domain-relevant qualifiers when missing (e.g. "graded"
//     for coins, "raw" if not graded)
//
// Returns the raw query string, or null if Gemini is unavailable.
// Times out after 5 seconds so it never blocks the main pipeline.
// ----------------------------------------------------------------
async function geminiSearchQuery(
  apiKey: string,
  title: string,
  categoryId?: string,
  yourPrice?: number | null,
): Promise<string | null> {
  const label = "[competitorSearch][Gemini]";

  const priceContext = yourPrice && yourPrice > 0
    ? `\nSeller's listed price: $${
      yourPrice.toFixed(
        2,
      )
    } USD — the search results should be for items in a similar price range`
    : "";

  const prompt =
    `You are an eBay search specialist. Given a listing title, produce the shortest, most effective eBay keyword search string (≤8 words) to find comparable active listings at a similar price point.

Rules:
- Keep: brand, model, year, mint mark, grade/certification (e.g. PCGS MS63, NGC AU58), size, color, key identifiers
- Keep: grading/certification info if present — it determines value category (e.g. "PCGS MS63" vs ungraded)
- Remove: marketing adjectives (beautiful, stunning, rare, vintage, antique, original, authentic), condition words (used, new, mint), lot/set/collection qualifiers
- Do NOT add words not implied by the title
- Do NOT remove grading organization names (PCGS, NGC, ANACS) or grade numbers (MS63, AU58, etc.)
- Return ONLY the keyword string — no explanation, no quotes, no punctuation

Title: "${title.slice(0, 200)}"${categoryId ? `\neBay Category ID: ${categoryId}` : ""}${priceContext}

eBay search keywords:`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let resp: Response;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FAST_MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 60,
              stopSequences: ["\n"],
            },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      console.warn(
        `${label} Gemini API ${resp.status} — falling back to heuristic`,
      );
      return null;
    }

    const data = await resp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text || text.length < 3) {
      console.warn(`${label} Empty response — falling back to heuristic`);
      return null;
    }

    // Sanitise: strip any accidental quotes/punctuation Gemini may add
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    console.log(`${label} Query for "${title.slice(0, 60)}…" → "${cleaned}"`);
    return cleaned || null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`${label} Timed out after 5s — falling back to heuristic`);
    } else {
      console.warn(
        `${label} Error: ${String(err)} — falling back to heuristic`,
      );
    }
    return null;
  }
}

// ----------------------------------------------------------------
// Get an eBay OAuth app token via client_credentials grant.
// Uses EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (same as keyword-research).
// ----------------------------------------------------------------
async function getEbayAppToken(ebayEnv: string): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to get eBay OAuth token: ${resp.status} — ${body.slice(0, 200)}`,
    );
  }

  const data = await resp.json();
  return data.access_token as string;
}

// ----------------------------------------------------------------
// Fetch competitor listings via eBay Browse API (OAuth Bearer token).
// CORRECTED 2026-09-17: this DOES have a real, hard 5,000-calls/day limit
// per client_id -- confirmed via a live getRateLimits check against this
// account's real keyset, which showed buy.browse at 73.8% used before any
// quota monitoring existed. See ebay-quota-monitor/index.ts and PR #580/#581.
// ----------------------------------------------------------------
async function fetchEbayCompetitors(params: {
  token: string;
  searchQuery: string;
  categoryId?: string;
  ebayEnv: string;
  filterMode?: "fixed" | "any";
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabaseForLogging: any;
  loggingCaller: string;
}): Promise<{
  prices: number[];
  count: number;
  raw: unknown[];
  items: CompetitorItem[];
}> {
  const {
    token,
    searchQuery,
    categoryId,
    ebayEnv,
    filterMode = "fixed",
    supabaseForLogging,
    loggingCaller,
  } = params;

  const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q: searchQuery,
    limit: "50",
    sort: "price",
  });

  if (filterMode === "fixed") {
    searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
  }

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(
    `[competitorSearch] Browse API search: "${searchQuery}" (category: ${
      categoryId ?? "any"
    }, filterMode: ${filterMode})`,
  );

  let resp: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Log at the point of the actual HTTP call, not once per planned
      // search attempt in the caller -- a 5xx/network retry here still
      // consumes real Browse API quota (Copilot review, PR #581), so
      // logging only once around this whole retrying function would
      // undercount the same-day counter by up to 3x on a retry-heavy run.
      logBrowseApiCall(supabaseForLogging, `${loggingCaller} (attempt ${attempt + 1})`);
      resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          Accept: "application/json",
        },
      });

      if (resp.ok || resp.status < 500) break;

      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(
          `[competitorSearch] Browse API returned ${resp.status} — retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (fetchErr) {
      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(
          `[competitorSearch] Fetch error (attempt ${attempt + 1}/3) — retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (!resp || !resp.ok) {
    const errBody = (await resp?.text?.().catch(() => "(could not read body)")) ??
      "(no response)";
    console.error(
      `[competitorSearch] Browse API failed: ${resp?.status} — ${errBody.slice(0, 300)}`,
    );
    throw new Error(
      `eBay Browse API error: ${resp?.status ?? "unknown"} — ${errBody.slice(0, 200)}`,
    );
  }

  const respText = await resp.text();
  let json: any;
  try {
    json = JSON.parse(respText);
  } catch {
    throw new Error(`eBay Browse API returned invalid JSON`);
  }

  const items: any[] = json?.itemSummaries ?? [];
  const prices: number[] = [];
  const structured: CompetitorItem[] = [];

  for (const item of items) {
    const parsed = parseCompetitorItem(item);
    if (!parsed) continue;
    prices.push(parsed.price);
    structured.push(parsed);
  }

  console.log(
    `[competitorSearch] Found ${prices.length} priced items out of ${items.length} Browse API results`,
  );

  return { prices, count: prices.length, raw: items, items: structured };
}

/**
 * Parses one Browse API item object into a CompetitorItem, or null if it
 * has no usable price. Shared verbatim between item_summary/search's
 * itemSummaries[] (fetchEbayCompetitors) and getItems' items[]
 * (fetchEbayItemsBulk) -- both endpoints use the same field names for
 * everything this app reads (price.value/currency, condition, title,
 * itemWebUrl, image.imageUrl, watchCount, bidCount) per eBay's Browse API
 * docs. Using one function for both guards against stat drift: any
 * difference in resulting prices/stats between the two endpoints can only
 * come from eBay returning different underlying data, never from divergent
 * app-side parsing.
 *
 * NOT YET VERIFIED against a live getItems response (no eBay credentials in
 * this dev sandbox) -- see fetchEbayItemsBulk's own docstring for the
 * required manual verification step before this is trusted for the getItems
 * path in production.
 */
export function parseCompetitorItem(item: unknown): CompetitorItem | null {
  try {
    const it = item as Record<string, any>;
    const priceVal = it?.price?.value ?? it?.currentPrice?.value;
    const price = parseFloat(String(priceVal ?? "0"));
    if (isNaN(price) || price <= 0) return null;
    // watchCount/bidCount are already present on Browse API's default
    // ItemSummary response (no fieldgroups param needed) but not
    // guaranteed populated for every item -- see parseOptionalCount's own
    // docstring for why a missing value must stay undefined, not become 0.
    return {
      title: String(it?.title ?? "").slice(0, 200),
      price,
      currency: String(it?.price?.currency ?? "USD"),
      condition: String(it?.condition ?? "Pre-Owned"),
      itemId: it?.itemId ? String(it.itemId) : undefined,
      itemUrl: it?.itemWebUrl ?? null,
      imageUrl: it?.image?.imageUrl ?? it?.thumbnailImages?.[0]?.imageUrl ?? null,
      watchCount: parseOptionalCount(it?.watchCount),
      bidCount: parseOptionalCount(it?.bidCount),
    };
  } catch {
    // Malformed item -- skip rather than throw, matching this file's
    // existing tolerance for individual bad items in a Browse API response.
    return null;
  }
}

// Per-item HTTP deadline (Copilot review, PR #601) -- without this, a single
// stalled eBay response holds Promise.allSettled (and therefore the whole
// refresh, and the cron's current batch slot) open until the Edge Function's
// own gateway ceiling, since allSettled can't finish until every promise
// settles one way or another.
const ITEM_LOOKUP_TIMEOUT_MS = 8_000;

// Bounds how many single-item lookups run concurrently WITHIN one
// fetchEbayItemsBulk call (Copilot review, PR #601). itemIds is already
// capped at 20 by callers, but competitor-prices-cron itself refreshes up to
// REFRESH_CONCURRENCY (15) listings in parallel -- with unbounded per-item
// fan-out, a normal batch of 15 listings x 20 stored ids could fire up to 300
// simultaneous eBay requests at once, versus the 15 the replaced bulk
// endpoint would have made. Capping this helper's OWN concurrency keeps the
// worst case bounded (15 x 4 = 60) regardless of what the outer cron does.
const ITEM_LOOKUP_CONCURRENCY = 4;

export interface BulkItemsLookupResult {
  items: CompetitorItem[];
  foundItemIds: string[];
  /** Confirmed gone -- eBay returned a 404 for this id. Safe to drop. */
  missingItemIds: string[];
  /**
   * Transient failure (timeout, 5xx exhausted, network error) -- NOT a
   * confirmed delisting (Copilot review, PR #601: conflating the two let a
   * flaky single request permanently drop a still-live comp from
   * comp_item_ids on the next persist). Callers should retain these ids for
   * a future refresh attempt rather than treat them as gone.
   */
  uncertainItemIds: string[];
}

/**
 * Fetches known itemIds via eBay's SINGLE-item Browse API endpoint,
 * GET /buy/browse/v1/item/{item_id}, one call per id (bounded concurrency).
 *
 * NOT the bulk endpoint (GET /buy/browse/v1/item?item_ids=...) -- that was
 * the original design (see this function's own git history / the getItems
 * batch-refresh plan's PR 1/2), but a live verification call against this
 * account's real production keyset (2026-09-18) confirmed the bulk form
 * returns 403 "Insufficient permissions to fulfill the request" while the
 * single-item form on the exact same token/scope succeeds immediately.
 * Checked the Application Keys page directly: both getItem and getItems
 * are documented under the SAME base `api_scope` this app already has (no
 * scope is missing) -- this points to an eBay-side compliance/tier
 * restriction specific to the bulk operation, not a fixable config error
 * on this app's side. Rather than wait on an eBay support ticket, this
 * function was rewritten to loop single-item calls -- a smaller quota win
 * than the original 20-per-call design (1 call per comp instead of up to
 * 20 comps per call) but confirmed working today.
 *
 * CORRECTED 2026-09-20 (do not re-introduce the old claim below): this
 * function's own log lines are still stamped "buy.browse.item.bulk" per
 * eBay's getRateLimits resource NAMING for continuity with existing
 * dashboards/alerts, but that name does NOT mean this traffic draws from a
 * pool independent of buy.browse. A live production incident confirmed the
 * opposite: with buy.browse's own poll reporting remaining=0, single-item
 * getItem calls from this exact function were ALSO rejected with the same
 * `429 errorId 2001 "The request limit has been reached for the resource"`
 * (~63,000 getItem calls in 24h against a 5,000/day limit). Whatever eBay's
 * metadata reports about these being separate named resources, the two
 * clearly share -- or at minimum both individually exhaust against -- the
 * same real-world ceiling for this account. Treat buy.browse and
 * buy.browse.item.bulk as ONE combined budget for any capacity-planning or
 * quota-gating decision (see checkBrowseQuotaHeadroom below, and
 * ebay-quota-monitor/index.ts, which now polls both resource names).
 *
 * (Original, now-disproven claim, kept here so a future reader can see
 * exactly what was corrected and why: "Each single-item call still draws
 * from a resource distinct from buy.browse (item_summary/search) per eBay's
 * own getRateLimits response.")
 *
 * Three outcomes per itemId, NOT two (Copilot review, PR #601 -- the first
 * version conflated the last two, which let a flaky single request
 * permanently drop a still-live comp from the next refresh's persisted set):
 * - found: eBay returned a usable item -- alive, in `items`/`foundItemIds`.
 * - missing (confirmed gone): a 404, or a 200 whose shape didn't parse into
 *   a usable comp -- in `missingItemIds`. Safe to drop permanently.
 * - uncertain (NOT confirmed gone): every retry timed out, errored, or
 *   returned a non-404 non-2xx status (e.g. a 403, meaning the endpoint
 *   itself may have broken) -- in `uncertainItemIds`. Callers should retain
 *   these ids for a future attempt rather than treat them as delisted.
 * An item that IS returned but shows e.g. OUT_OF_STOCK availability is
 * still alive (the listing exists), not delisted -- this function does
 * not treat availability status as a delisting signal, only a 404 does.
 *
 * Each per-item HTTP attempt is bounded by ITEM_LOOKUP_TIMEOUT_MS (a stalled
 * response can't hold the whole refresh open), and lookups within one call
 * run at most ITEM_LOOKUP_CONCURRENCY at a time (competitor-prices-cron
 * already refreshes multiple listings in parallel; unbounded per-item
 * fan-out on top of that could multiply into hundreds of simultaneous
 * requests -- see both constants' own comments).
 */
export async function fetchEbayItemsBulk(params: {
  token: string;
  itemIds: string[];
  ebayEnv: string;
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabaseForLogging: any;
  loggingCaller: string;
}): Promise<BulkItemsLookupResult> {
  const { token, itemIds, ebayEnv, supabaseForLogging, loggingCaller } = params;
  const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  console.log(
    `[competitorSearch] Browse API single-item lookup: ${itemIds.length} itemId(s)`,
  );

  type FetchOneResult =
    | { itemId: string; kind: "found"; item: CompetitorItem }
    | { itemId: string; kind: "missing" } // confirmed 404 -- actually gone
    | { itemId: string; kind: "uncertain"; reason: string }; // transient -- unknown, not gone

  async function fetchOne(itemId: string): Promise<FetchOneResult> {
    const url = `${apiBase}/buy/browse/v1/item/${encodeURIComponent(itemId)}`;
    let resp: Response | null = null;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ITEM_LOOKUP_TIMEOUT_MS);
      try {
        // Same reasoning as fetchEbayCompetitors: log at the point of the
        // actual HTTP attempt, not once per id, since a retried 5xx still
        // consumes real quota.
        logBrowseApiCall(supabaseForLogging, `${loggingCaller} (attempt ${attempt + 1})`, "buy.browse.item.bulk");
        resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            Accept: "application/json",
          },
          signal: controller.signal,
        });
        lastErr = null;

        // 404 means "this specific item is gone" -- not retryable, and not
        // a failure for the batch as a whole (see this function's own
        // docstring). Any other non-OK status is either retryable (5xx) or
        // a real error (e.g. a 403 would mean the single-item endpoint
        // itself stopped working, which should surface as a thrown error,
        // not be silently treated as "this one item is missing").
        if (resp.ok || resp.status === 404 || resp.status < 500) break;

        if (attempt < 2) {
          const delayMs = 1500 * Math.pow(1.5, attempt);
          console.warn(
            `[competitorSearch] getItem(${itemId}) returned ${resp.status} — retrying in ${delayMs}ms`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      } catch (fetchErr) {
        lastErr = fetchErr;
        resp = null;
        if (attempt < 2) {
          const delayMs = 1500 * Math.pow(1.5, attempt);
          const isTimeout = controller.signal.aborted;
          console.warn(
            `[competitorSearch] getItem(${itemId}) ${isTimeout ? "timed out" : "fetch error"} (attempt ${
              attempt + 1
            }/3) — retrying in ${delayMs}ms`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    if (resp && resp.status === 404) {
      return { itemId, kind: "missing" };
    }
    if (!resp || !resp.ok) {
      // Exhausted retries with no confirmed 404 -- this is unknown, not
      // confirmed gone (Copilot review, PR #601). A 403 (the single-item
      // endpoint itself breaking) lands here too, which is intentional: it
      // should read as "couldn't confirm," not "this one item vanished."
      const status = resp?.status;
      const errBody = resp ? await resp.text().catch(() => "(could not read body)") : null;
      const reason = errBody !== null
        ? `HTTP ${status} — ${errBody.slice(0, 200)}`
        : `${lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown error")}`;
      return { itemId, kind: "uncertain", reason };
    }

    let respText: string;
    let json: any;
    try {
      respText = await resp.text();
      json = JSON.parse(respText);
    } catch (parseErr) {
      // A malformed response is also "couldn't confirm," not "gone."
      return {
        itemId,
        kind: "uncertain",
        reason: `invalid JSON response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      };
    }

    const parsed = parseCompetitorItem(json);
    if (!parsed) {
      // The HTTP call succeeded but the item shape didn't parse (e.g.
      // missing/zero price) -- distinct from a 404: eBay found the item,
      // it's just not usable as a comp. Treat as confirmed-not-a-comp
      // (missing), not uncertain, since there's no reason to retry it.
      return { itemId, kind: "missing" };
    }
    return { itemId, kind: "found", item: parsed };
  }

  // Bounded concurrency WITHIN this call (Copilot review, PR #601) -- see
  // ITEM_LOOKUP_CONCURRENCY's own comment for why unbounded Promise.all(map)
  // is unsafe once the outer cron's own parallelism is accounted for. A
  // single failing id must not sink every other id in the batch, so results
  // are collected via a plain array + index rather than allSettled (nothing
  // here throws per-item anymore -- fetchOne always resolves; only a
  // programmer error would reject, and that should propagate).
  const results: FetchOneResult[] = new Array(itemIds.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= itemIds.length) return;
      results[i] = await fetchOne(itemIds[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(ITEM_LOOKUP_CONCURRENCY, itemIds.length) }, worker),
  );

  const items: CompetitorItem[] = [];
  const missingItemIds: string[] = [];
  const uncertainItemIds: string[] = [];

  for (const outcome of results) {
    if (outcome.kind === "found") {
      items.push(outcome.item);
    } else if (outcome.kind === "missing") {
      missingItemIds.push(outcome.itemId);
    } else {
      uncertainItemIds.push(outcome.itemId);
      console.warn(
        `[competitorSearch] getItem(${outcome.itemId}) uncertain, not confirmed delisted: ${outcome.reason}`,
      );
    }
  }

  const foundItemIds = items
    .map((it) => it.itemId)
    .filter((id): id is string => !!id);

  console.log(
    `[competitorSearch] Single-item lookups: ${foundItemIds.length}/${itemIds.length} requested itemIds still present ` +
      `(${missingItemIds.length} confirmed gone, ${uncertainItemIds.length} uncertain)`,
  );

  // Only throw if EVERY id came back uncertain with nothing confirmed either
  // way -- that's the "the endpoint itself may be broken" case (e.g. every
  // call 403s), which should surface as a hard failure rather than a
  // 0-comps-found result silently persisted.
  if (items.length === 0 && missingItemIds.length === 0 && uncertainItemIds.length === itemIds.length) {
    throw new Error(`eBay getItem: all ${itemIds.length} lookups failed/uncertain`);
  }

  return { items, foundItemIds, missingItemIds, uncertainItemIds };
}

export interface CompSearchAttemptResult {
  prices: number[];
  count: number;
  items: CompetitorItem[];
}

// Combined-quota gate for the eBay Browse API. See fetchEbayItemsBulk's
// corrected docstring above for the incident this exists to prevent:
// buy.browse and buy.browse.item.bulk are reported as separate named
// resources by getRateLimits, but the 2026-09-20/21 quota-storm incident
// proved they draw against the SAME real-world 5,000/day ceiling per
// client_id -- getItem (bulk) calls returned the identical
// `429 errorId 2001` buy.browse calls did, at the same time. Before this
// gate existed, runCompetitorSearch/attemptItemsRefresh had no way to know
// quota was already gone and would keep firing calls straight into the 429
// wall for the rest of the day, burning nothing but time and generating
// noise. CRITICAL_QUOTA_RATIO is set well above ebay-quota-monitor's own
// WARN_THRESHOLD_RATIO (0.9) -- that email alert is meant to fire EARLY as
// a heads-up with headroom still left to react; this gate is a hard stop
// only once quota is essentially exhausted, so the two never fight over
// which one is "right" at 91% used.
const BROWSE_QUOTA_DAILY_LIMIT = 5000;
const CRITICAL_QUOTA_RATIO = 0.90;
const COMBINED_BROWSE_RESOURCES = ["buy.browse", "buy.browse.item.bulk"] as const;

export interface QuotaHeadroomResult {
  hasHeadroom: boolean;
  sameDayCount: number | null;
  reason: string;
}

/**
 * Checks whether today's COMBINED same-day count across both buy.browse
 * and buy.browse.item.bulk (see COMBINED_BROWSE_RESOURCES above) still has
 * headroom under the real shared 5,000/day ceiling. Exported so the
 * combined-count query and the critical-ratio decision both have direct
 * test coverage against a fake Supabase client, matching
 * ebay-quota-monitor's countSameDayBrowseCalls/shouldWarn precedent.
 *
 * Fails OPEN (hasHeadroom: true) on a query error -- this gate sits on the
 * hot path of every competitor-price lookup, so a transient DB blip here
 * must never take down the whole feature. The email alert in
 * ebay-quota-monitor already covers the "something is wrong, go look"
 * signal; this gate is a best-effort optimization on top of that, not a
 * safety-critical control.
 */
export async function checkBrowseQuotaHeadroom(
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabase: any,
  todayStart: Date = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })(),
): Promise<QuotaHeadroomResult> {
  try {
    const { count, error } = await supabase
      .from("ebay_browse_call_log")
      .select("*", { count: "exact", head: true })
      .in("resource", COMBINED_BROWSE_RESOURCES)
      .gte("created_at", todayStart.toISOString());

    if (error) {
      console.warn(
        `[competitorSearch] checkBrowseQuotaHeadroom: count query failed, failing OPEN (assuming headroom): ${error.message}`,
      );
      return { hasHeadroom: true, sameDayCount: null, reason: `count query failed: ${error.message}` };
    }

    const sameDayCount = count ?? 0;
    const ratio = sameDayCount / BROWSE_QUOTA_DAILY_LIMIT;
    if (ratio >= CRITICAL_QUOTA_RATIO) {
      return {
        hasHeadroom: false,
        sameDayCount,
        reason:
          `combined buy.browse + buy.browse.item.bulk same-day count (${sameDayCount}/${BROWSE_QUOTA_DAILY_LIMIT}) is at or above the critical ${
            (CRITICAL_QUOTA_RATIO * 100).toFixed(0)
          }% threshold`,
      };
    }
    return {
      hasHeadroom: true,
      sameDayCount,
      reason: `${sameDayCount}/${BROWSE_QUOTA_DAILY_LIMIT} combined calls today`,
    };
  } catch (err) {
    // Same fail-open reasoning as the error branch above -- an unexpected
    // throw (e.g. a network blip on the query itself) is still just a
    // monitoring-path failure, not a reason to also break competitor search.
    console.warn("[competitorSearch] checkBrowseQuotaHeadroom: unexpected error, failing OPEN:", err);
    return { hasHeadroom: true, sameDayCount: null, reason: `unexpected error: ${String(err)}` };
  }
}

/**
 * Fire-and-forget increment of the same-day Browse API call counter (see
 * the ebay-quota-monitor migration/function for how this is read). Never
 * awaited by the caller and never throws into it -- a logging failure must
 * not affect the real Browse API call it's counting, which is why this
 * takes the already-open supabase client rather than opening its own.
 * Exported so other Browse API callers (market-watch-refresh,
 * keyword-research) can share this one implementation instead of
 * duplicating it -- there is no shared Browse API client module in this
 * codebase to hook a counter into otherwise (confirmed: each caller keeps
 * its own getEbayAppToken/search function).
 */
export function logBrowseApiCall(
  // deno-lint-ignore no-explicit-any -- matches the loose supabase-js typing
  // already used throughout this codebase's Edge Functions.
  supabase: any,
  caller: string,
  // Which named resource eBay's getRateLimits reports this call under.
  // Default "buy.browse" (item_summary/search, every call site before the
  // getItems follow-on work) keeps every existing 2-arg call site
  // source-compatible. "buy.browse.item.bulk" (getItem/getItems) is
  // reported as a separate named resource by getRateLimits, but the
  // 2026-09-20/21 quota-storm incident proved both resources draw against
  // the SAME real-world 5,000/day ceiling per client_id -- getItem calls
  // returned 429 errorId 2001 ("Too many requests") at the same time
  // buy.browse calls did, even though ebay-quota-monitor's same-day counter
  // (which only filtered on resource === "buy.browse") still showed plenty
  // of headroom. This column is kept purely for observability/breakdown
  // (which resource is generating the load) -- see
  // checkBrowseQuotaHeadroom() below and ebay-quota-monitor/index.ts, both
  // of which now sum counts across BOTH resource values when deciding
  // whether quota is exhausted.
  resource: "buy.browse" | "buy.browse.item.bulk" = "buy.browse",
): void {
  try {
    // Registered via runInBackground (EdgeRuntime.waitUntil) rather than a
    // bare unawaited .then() -- without it, this insert can be cut off
    // mid-flight once the handler's own response has already been sent,
    // since nothing else keeps the isolate alive for it (Copilot review,
    // PR #581). Falls back to a bare unawaited call under plain `deno test`,
    // where EdgeRuntime doesn't exist -- see runInBackground's own docstring.
    runInBackground(
      Promise.resolve(supabase.from("ebay_browse_call_log").insert({ caller, resource }))
        .then((result: { error?: { message?: string } } | undefined) => {
          if (result?.error) {
            console.warn(
              `[competitorSearch] Failed to log Browse API call for quota tracking: ${
                result.error.message ?? JSON.stringify(result.error)
              }`,
            );
          }
        })
        .catch((err: unknown) => {
          console.warn(`[competitorSearch] Failed to log Browse API call for quota tracking: ${String(err)}`);
        }),
    );
  } catch (err) {
    console.warn(`[competitorSearch] Failed to log Browse API call for quota tracking: ${String(err)}`);
  }
}

/**
 * Runs a list of search attempts sequentially, accumulating prices/items
 * ACROSS attempts within this one tier and stopping early once the running
 * total passes evaluateCompQuality's bar (same default 3-comps/3x-spread
 * gate the between-tier check in runTieredCompSearch already uses -- pass
 * the same `opts` here so the two bars stay in sync by construction).
 *
 * This closes a residual gap in Phase 1.2b: capping tiers at 2 bounds
 * *between-tier* attempts, but a tier alone could still burn all of its own
 * 2-4 raw attempts even after the first one or two already accumulated a
 * comfortably-passing set, or even when the running total is thin for a
 * reason more attempts in the same tier won't fix. Stops as soon as the
 * accumulated result passes the quality gate, OR once every attempt in the
 * tier has been tried, whichever comes first -- an attempt that returns 0
 * comps never satisfies the gate on its own, so the loop still continues
 * past a genuinely empty result exactly as it did before this change.
 */
export async function runAttemptsSequential(
  attempts: SearchPlanAttempt[],
  fetchOne: (attempt: SearchPlanAttempt) => Promise<CompSearchAttemptResult>,
  opts: { minCount?: number; maxSpreadRatio?: number } = {},
): Promise<{ result: CompSearchAttemptResult; chosen: SearchPlanAttempt | null }> {
  const accumulatedPrices: number[] = [];
  const accumulatedItems: CompetitorItem[] = [];
  // buildSearchPlan's attempts within one tier share the same query and
  // often the same category, varying only filterMode (fixed-price vs. any
  // buying option) or whether categoryId is set at all -- "any" is a
  // superset of "fixed", and "any category" often reoverlaps with "fixed
  // category" for a common item. Accumulating across attempts without
  // dedup would double-count the same real eBay listing across attempts,
  // inflating comp count and corrupting avgPrice/medianPrice/spread with
  // duplicates rather than genuinely new comps. Dedup by itemId (present on
  // Browse API's default ItemSummary response); an item missing itemId is
  // kept as-is -- rare in practice, and the alternative (dropping it) would
  // silently lose a real comp for a much rarer case than the duplication
  // this exists to prevent.
  const seenItemIds = new Set<string>();
  let chosen: SearchPlanAttempt | null = null;

  for (const attempt of attempts) {
    const result = await fetchOne(attempt);
    if (result.prices.length > 0) {
      // result.prices/result.items are index-parallel in the real
      // fetchEbayCompetitors output (both pushed together per raw item, see
      // that function), but iterate by prices.length rather than
      // items.length -- some callers (tests, or a future caller) may pass a
      // shorter/empty items array, and a price should never be silently
      // dropped just because its structured item metadata is unavailable.
      for (let i = 0; i < result.prices.length; i++) {
        const item = result.items[i];
        if (item?.itemId) {
          if (seenItemIds.has(item.itemId)) continue;
          seenItemIds.add(item.itemId);
        }
        if (item) accumulatedItems.push(item);
        accumulatedPrices.push(result.prices[i]);
      }
      chosen = attempt;
      if (evaluateCompQuality(accumulatedPrices, opts).passes) {
        break;
      }
    }
  }

  return {
    result: { prices: accumulatedPrices, count: accumulatedPrices.length, items: accumulatedItems },
    chosen,
  };
}

export interface TieredCompSearchResult {
  prices: number[];
  count: number;
  items: CompetitorItem[];
  chosen: SearchPlanAttempt | null;
  tiersUsed: number;
}

/**
 * Phase 1.2b's sequential-and-evaluate control flow, replacing the old
 * fire-everything-until-something-hits loop. Awaits tier 0 in full; if its
 * result passes evaluateCompQuality, stops there -- 1 tier used, no quota
 * spent on tier 1. Only falls through to tier 1 when tier 0 is thin or
 * empty, and never proceeds past 2 tiers regardless of outcome (structurally
 * guaranteed anyway, since buildSearchPlan only ever produces 2).
 *
 * escapeHatchMs is a tail-latency safety net, not the primary trigger: the
 * common path evaluates tier 0 after it actually resolves. Only if tier 0
 * hasn't resolved within escapeHatchMs does tier 1 fire concurrently as
 * insurance (tier 0 is not cancelled) -- in that case both are awaited and
 * the better result wins, since there was no chance to cheaply check
 * whether tier 0 alone would have sufficed.
 */
export async function runTieredCompSearch(
  tiers: SearchPlanAttempt[][],
  fetchOne: (attempt: SearchPlanAttempt) => Promise<CompSearchAttemptResult>,
  opts: { minCount?: number; maxSpreadRatio?: number; escapeHatchMs?: number } = {},
): Promise<TieredCompSearchResult> {
  if (tiers.length === 0) {
    return { prices: [], count: 0, items: [], chosen: null, tiersUsed: 0 };
  }

  const tier0Promise = runAttemptsSequential(tiers[0], fetchOne, opts);

  if (tiers.length === 1) {
    const tier0 = await tier0Promise;
    return { ...tier0.result, chosen: tier0.chosen, tiersUsed: 1 };
  }

  const escapeHatchMs = opts.escapeHatchMs ?? 1000;
  let tier1Promise: ReturnType<typeof runAttemptsSequential> | null = null;

  const raced = await Promise.race([
    tier0Promise.then(() => "tier0" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), escapeHatchMs)),
  ]);

  if (raced === "timeout") {
    // Tier 0 is slow -- fire tier 1 concurrently as insurance, without
    // cancelling tier 0.
    tier1Promise = runAttemptsSequential(tiers[1], fetchOne, opts);
  }

  const tier0 = await tier0Promise;

  if (!tier1Promise) {
    // Tier 0 resolved within the escape hatch window -- evaluate it before
    // deciding whether tier 1 is even needed.
    if (tier0.chosen && evaluateCompQuality(tier0.result.prices, opts).passes) {
      return { ...tier0.result, chosen: tier0.chosen, tiersUsed: 1 };
    }
    tier1Promise = runAttemptsSequential(tiers[1], fetchOne, opts);
  }

  const tier1 = await tier1Promise;

  const tier0Gate = tier0.chosen
    ? evaluateCompQuality(tier0.result.prices, opts)
    : { passes: false, reason: "no result" };
  const tier1Gate = tier1.chosen
    ? evaluateCompQuality(tier1.result.prices, opts)
    : { passes: false, reason: "no result" };

  if (tier0Gate.passes && !tier1Gate.passes) {
    return { ...tier0.result, chosen: tier0.chosen, tiersUsed: 2 };
  }
  if (tier1Gate.passes && !tier0Gate.passes) {
    return { ...tier1.result, chosen: tier1.chosen, tiersUsed: 2 };
  }
  // Both pass or both fail -- pick whichever has more comps.
  if (tier1.result.prices.length > tier0.result.prices.length) {
    return { ...tier1.result, chosen: tier1.chosen, tiersUsed: 2 };
  }
  return { ...tier0.result, chosen: tier0.chosen, tiersUsed: 2 };
}

// ----------------------------------------------------------------
// Compute median from a sorted or unsorted array of numbers.
// ----------------------------------------------------------------
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ----------------------------------------------------------------
// Price-anchor pre-filter: when the seller's price is known and
// significant (> $50), remove results priced at less than 10% of
// the seller's price. This prevents $0.95 novelty coins from
// contaminating the market analysis of a $995 graded gold coin.
// Also removes items priced at more than 10x yourPrice (unrelated
// premium items that happen to match by keyword).
// ----------------------------------------------------------------
function priceAnchorFilter(
  prices: number[],
  yourPrice: number | null | undefined,
): number[] {
  if (!yourPrice || yourPrice < 50) return prices;
  const lower = yourPrice * 0.1; // Must be at least 10% of your price
  const upper = yourPrice * 10.0; // Must not be more than 10x your price
  const filtered = prices.filter((p) => p >= lower && p <= upper);
  if (filtered.length !== prices.length) {
    console.log(
      `[competitorSearch] Price-anchor filter ($${lower.toFixed(2)}-$${
        upper.toFixed(
          2,
        )
      }): ${prices.length} → ${filtered.length} prices (removed ${
        prices.length - filtered.length
      } price-mismatched items)`,
    );
  }
  // Fall back to unfiltered if we filtered too aggressively (< 2 items remain)
  return filtered.length >= 2 ? filtered : prices;
}

// ----------------------------------------------------------------
// Remove statistical outliers using the IQR (Interquartile Range)
// method. Prices outside Q1 - 1.5*IQR .. Q3 + 1.5*IQR are removed.
// This eliminates $3.99 trinkets and $2,499 unrelated premium items
// from skewing the competitor price analysis.
// Requires at least 4 items to apply filtering; returns all if fewer.
// ----------------------------------------------------------------
function removeOutliers(prices: number[]): number[] {
  if (prices.length < 4) return prices;
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length / 4);
  const q3Idx = Math.floor((3 * sorted.length) / 4);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;
  // If IQR is 0 (all same price), skip filtering
  if (iqr === 0) return prices;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const filtered = sorted.filter((p) => p >= lower && p <= upper);
  console.log(
    `[competitorSearch] IQR filter: ${prices.length} → ${filtered.length} prices (removed ${
      prices.length - filtered.length
    } outliers, range $${lower.toFixed(2)}-$${upper.toFixed(2)})`,
  );
  return filtered.length >= 2 ? filtered : prices; // Fallback if too aggressive
}

/**
 * Builds the exact row upserted into competitor_prices after a successful
 * search. Extracted as a pure function (rather than inlined in
 * runCompetitorSearch) specifically so fetched_at/expires_at are directly
 * unit-testable without mocking the whole search pipeline -- their absence
 * here was a real production bug (2026-09-18): a Postgres column DEFAULT
 * only fires on INSERT, never on ON CONFLICT DO UPDATE, so omitting
 * fetched_at left every refresh silently keeping the original insert-time
 * value forever. That froze every row's staleness clock while
 * get_next_competitor_price_batch's 24h filter kept re-selecting the same
 * ~541 rows as "stale," and competitor-prices-cron (every 5 min) kept
 * re-fetching them in an unbroken loop -- confirmed via pg_stat_user_tables
 * showing 48,292 updates against only 578 inserts on this table, and every
 * row's fetched_at frozen at the same ~20-hour-old timestamp. That loop is
 * what actually burned a full day's 5,000-call Browse API quota with zero
 * new listings created, not any per-listing query-fan-out logic.
 */
export function buildCompetitorPricesUpsertPayload(params: {
  userId: string;
  listingId: string;
  searchQuery: string;
  geminiQuery: string | null;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  priceDelta: number | null;
  yourPrice: number | null;
  competitorCount: number;
  priceDistribution: unknown;
  now?: Date;
  /**
   * itemIds of the individual comps that drove this row's aggregate stats,
   * already capped by the caller (see runCompetitorSearch's Step 5) at 20 --
   * a single Browse API getItems bulk-lookup call's max. Optional/nullable
   * so every pre-existing call site stays source-compatible: omitting it
   * persists `null`, which is indistinguishable from "no comps found" or "a
   * row written before this column existed" -- both are valid "nothing to
   * refresh yet" states for the getItems follow-on work to fall back to
   * full search on, not errors.
   */
  compItemIds?: string[] | null;
  /**
   * Cache-by-product-signature feature (see computeProductSignature):
   * written on every persist path so a FUTURE listing of the same product
   * can find this row via attemptSignatureMatch. Optional/nullable so every
   * pre-existing call site stays source-compatible -- omitting it persists
   * `null`, meaning "not eligible for signature matching yet," identical to
   * a row written before this column existed.
   */
  productSignature?: string | null;
}) {
  const now = params.now ?? new Date();
  return {
    user_id: params.userId,
    ebay_listing_id: params.listingId,
    search_query: params.searchQuery,
    gemini_search_query: params.geminiQuery,
    avg_price: Math.round(params.avgPrice * 100) / 100,
    min_price: params.minPrice,
    max_price: params.maxPrice,
    median_price: Math.round(params.medianPrice * 100) / 100,
    price_delta: params.priceDelta,
    your_price: params.yourPrice,
    competitor_count: params.competitorCount,
    price_distribution: params.priceDistribution,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    comp_item_ids: params.compItemIds ?? null,
    product_signature: params.productSignature ?? null,
  };
}

export interface CompStats {
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  priceDelta: number | null;
  priceDistribution: ReturnType<typeof buildDistribution>;
  cleanPrices: number[];
}

/**
 * Price-anchor filter -> outlier removal -> avg/min/max/median/delta/
 * distribution. Extracted from runCompetitorSearch's own Step 4 (verbatim
 * math, just relocated) so BOTH the full-search discovery path and the new
 * getItems-based refresh path (attemptItemsRefresh) compute stats
 * identically -- the concrete guard against "getItems returning a
 * materially different price shape leads to stat drift": any difference in
 * resulting numbers between the two paths can only come from eBay
 * returning different underlying prices for the same itemId, never from
 * divergent app-side arithmetic.
 */
export function computeCompStats(params: {
  prices: number[];
  yourPrice: number | null | undefined;
}): CompStats {
  const { prices, yourPrice } = params;
  const anchoredPrices = priceAnchorFilter(prices, yourPrice);
  const cleanPrices = removeOutliers(anchoredPrices);
  const avgPrice = cleanPrices.reduce((s, p) => s + p, 0) / cleanPrices.length;
  const minPrice = Math.min(...cleanPrices);
  const maxPrice = Math.max(...cleanPrices);
  const medianPrice = median(cleanPrices);
  const priceDelta = yourPrice != null ? Math.round((yourPrice - medianPrice) * 100) / 100 : null;
  const priceDistribution = buildDistribution(cleanPrices);
  return { avgPrice, minPrice, maxPrice, medianPrice, priceDelta, priceDistribution, cleanPrices };
}

export interface RefreshStrategyDecision {
  useItemsRefresh: boolean;
  reason: string;
}

/**
 * Decides whether a listing has enough previously-stored comp itemIds to
 * even attempt the cheap getItems refresh path. Pure so both branches have
 * direct test coverage without a live fetch/DB round trip -- same pattern
 * as evaluateCompQuality/groupPlanIntoTiers in this file. This only looks
 * at what's known BEFORE any call is made; whether the results that come
 * back are actually trustworthy is a separate, later decision
 * (isItemsRefreshUsable) made only after fetchEbayItemsBulk returns.
 */
export function decideRefreshStrategy(params: {
  storedItemIds: string[] | null | undefined;
}): RefreshStrategyDecision {
  const ids = params.storedItemIds ?? [];
  if (ids.length === 0) {
    return { useItemsRefresh: false, reason: "no stored itemIds — first encounter or pre-migration row" };
  }
  return { useItemsRefresh: true, reason: `${ids.length} stored itemIds available for bulk refresh` };
}

export interface ItemsRefreshUsability {
  usable: boolean;
  reason: string;
}

/**
 * Decides whether a getItems bulk-lookup RESULT is trustworthy enough to
 * use, once it's actually back. A listing whose tracked comps have mostly
 * delisted since the last refresh is no longer a good market sample --
 * minRemainingRatio (default 0.5) forces a fallback to full rediscovery in
 * that case rather than computing stats off a badly-thinned set.
 * minCount (default 3) mirrors evaluateCompQuality's own comp-count bar for
 * consistency across this file's two quality gates.
 */
export function isItemsRefreshUsable(params: {
  requestedCount: number;
  foundCount: number;
  minCount?: number;
  minRemainingRatio?: number;
}): ItemsRefreshUsability {
  const minCount = params.minCount ?? 3;
  const minRemainingRatio = params.minRemainingRatio ?? 0.5;
  if (params.foundCount < minCount) {
    return { usable: false, reason: `only ${params.foundCount} comps survived (need ${minCount}+)` };
  }
  const remainingRatio = params.requestedCount > 0 ? params.foundCount / params.requestedCount : 0;
  if (remainingRatio < minRemainingRatio) {
    return {
      usable: false,
      reason: `only ${(remainingRatio * 100).toFixed(0)}% of tracked comps still live (need ${
        (minRemainingRatio * 100).toFixed(0)
      }%+)`,
    };
  }
  return { usable: true, reason: `${params.foundCount}/${params.requestedCount} tracked comps still live` };
}

/**
 * Attempts the cheap getItems-based refresh path for an already-known
 * listing. Returns a CompetitorSearchOutcome on success, or null to signal
 * "fall through to the existing full-search discovery path unchanged" --
 * every branch here either succeeds and returns, or falls through; no
 * branch introduces a new failure mode reaching runCompetitorSearch's
 * caller. Only ever called when userId && listingId are both present.
 */
export async function attemptItemsRefresh(params: {
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabase: any;
  userId: string;
  listingId: string;
  ebayEnv: string;
  yourPrice: number | null | undefined;
  /** Threaded through to buildCompetitorPricesUpsertPayload -- see that
   * param's own docstring. Computed once by the caller (runCompetitorSearch)
   * rather than recomputed here. */
  productSignature?: string | null;
}): Promise<CompetitorSearchOutcome | null> {
  const { supabase, userId, listingId, ebayEnv, yourPrice, productSignature } = params;

  let row: any;
  try {
    const { data } = await supabase
      .from("competitor_prices")
      .select("*")
      .eq("user_id", userId)
      .eq("ebay_listing_id", listingId)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    row = data;
  } catch (err) {
    console.warn("[competitorSearch] attemptItemsRefresh: row lookup failed, falling through to full search:", err);
    return null;
  }

  const decision = decideRefreshStrategy({ storedItemIds: row?.comp_item_ids });
  if (!decision.useItemsRefresh) {
    console.log(`[competitorSearch] attemptItemsRefresh: ${decision.reason}`);
    return null;
  }

  const storedItemIds: string[] = row.comp_item_ids;

  let token: string;
  try {
    token = await getEbayAppToken(ebayEnv);
  } catch (err) {
    console.warn("[competitorSearch] attemptItemsRefresh: token fetch failed, falling through to full search:", err);
    return null;
  }

  let bulkResult: BulkItemsLookupResult;
  try {
    bulkResult = await fetchEbayItemsBulk({
      token,
      itemIds: storedItemIds,
      ebayEnv,
      supabaseForLogging: supabase,
      loggingCaller: "competitorSearch:getItems",
    });
  } catch (err) {
    console.warn("[competitorSearch] attemptItemsRefresh: getItems call failed, falling through to full search:", err);
    return null;
  }

  // Uncertain ids count toward "survived" for the usability check -- they
  // are NOT confirmed gone (Copilot review, PR #601), so treating them like
  // confirmed delistings here would make a transient blip (a timeout, one
  // flaky 500) look like real market attrition and trigger an unnecessary
  // fall-through to a full rediscovery search.
  const survivedCount = bulkResult.items.length + bulkResult.uncertainItemIds.length;
  const usability = isItemsRefreshUsable({
    requestedCount: storedItemIds.length,
    foundCount: survivedCount,
  });
  if (!usability.usable) {
    console.log(`[competitorSearch] attemptItemsRefresh: ${usability.reason} — falling through to full search`);
    return null;
  }

  const stats = computeCompStats({
    prices: bulkResult.items.map((it) => it.price),
    yourPrice,
  });

  // Build compItemIds from the CLEANED item set, not bulkResult.foundItemIds
  // -- foundItemIds is everything getItems returned, before the price-anchor
  // /outlier filters computeCompStats just applied. Persisting the raw
  // found set would let comps the stats themselves rejected keep counting
  // toward the NEXT refresh's survival ratio, so comp_item_ids would no
  // longer represent "the items that drove these saved stats" (Copilot
  // review, PR #600).
  const cleanSet = new Set(stats.cleanPrices);
  const cleanItems = bulkResult.items.filter((it) => cleanSet.has(it.price)).slice(0, 25);
  // Retain uncertainItemIds too, not just confirmed-found ones (Copilot
  // review, PR #601) -- an id that timed out or 500'd this time is NOT
  // confirmed delisted, so dropping it here would permanently bias future
  // refreshes against a comp that's very likely still live. Only ids
  // fetchEbayItemsBulk actually confirmed gone (missingItemIds) are excluded.
  const newCompItemIds = [
    ...cleanItems.map((it) => it.itemId).filter((id): id is string => !!id),
    ...bulkResult.uncertainItemIds,
  ].slice(0, 20);

  try {
    const payload = buildCompetitorPricesUpsertPayload({
      userId,
      listingId,
      searchQuery: row.search_query,
      geminiQuery: row.gemini_search_query ?? null,
      avgPrice: stats.avgPrice,
      minPrice: stats.minPrice,
      maxPrice: stats.maxPrice,
      medianPrice: stats.medianPrice,
      priceDelta: stats.priceDelta,
      yourPrice: yourPrice ?? null,
      competitorCount: stats.cleanPrices.length,
      priceDistribution: stats.priceDistribution,
      compItemIds: newCompItemIds,
      productSignature,
    });
    const { error: upsertErr } = await supabase.from("competitor_prices").upsert(payload, {
      onConflict: "user_id,ebay_listing_id",
    });
    // The Supabase client reports a failed write via a returned `error`,
    // not a throw -- an unchecked await here would silently log/report
    // success on a write that never landed, leaving fetched_at/comp_item_ids
    // unchanged and causing every subsequent cron tick to repeat this same
    // bulk lookup for no benefit (Copilot review, PR #600, citing
    // ebayInventorySync.ts's own error-checked upsert as the precedent).
    if (upsertErr) {
      console.warn("[competitorSearch] attemptItemsRefresh: upsert reported an error:", upsertErr);
    } else {
      console.log(
        `[competitorSearch] getItems refresh saved for listing ${listingId}: avg=$${
          stats.avgPrice.toFixed(2)
        }, n=${stats.cleanPrices.length}`,
      );
    }
  } catch (dbErr) {
    // Non-fatal, matching the full-search path's own persist-failure
    // handling -- still return the freshly-computed data to the caller.
    console.warn("[competitorSearch] attemptItemsRefresh: failed to persist snapshot:", dbErr);
  }

  const cacheExpiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

  return {
    status: 200,
    body: {
      searchQuery: row.gemini_search_query ?? row.search_query,
      finalSearchQuery: row.search_query,
      geminiSearchQuery: row.gemini_search_query ?? null,
      avgPrice: Math.round(stats.avgPrice * 100) / 100,
      minPrice: stats.minPrice,
      maxPrice: stats.maxPrice,
      medianPrice: Math.round(stats.medianPrice * 100) / 100,
      priceDelta: stats.priceDelta,
      competitorCount: stats.cleanPrices.length,
      priceDistribution: stats.priceDistribution,
      items: cleanItems,
      noData: false,
      fromCache: false,
      cacheExpiresAt,
      refreshMethod: "getItems",
    },
  };
}

// Minimum comps a sibling row must have before its stats are trusted enough
// to copy into another listing -- same literal as evaluateCompQuality's
// default minCount, kept in sync deliberately: a signature match must never
// propagate an already-thin snapshot to N listings just because it happened
// to be fresh.
const SIGNATURE_MATCH_MIN_COMPS = 3;

/**
 * Guards against reusing a sibling's aggregates across incompatible
 * price-anchor contexts (found in Copilot review of PR #602, 2026-09-19).
 * The sibling's avg/min/max/median/count were computed by computeCompStats,
 * which runs priceAnchorFilter keyed on THAT listing's own yourPrice --
 * items priced under 10% or over 10x of it get dropped before the
 * aggregates are ever computed. If this listing's yourPrice would have
 * produced a materially different anchor window, the sibling's aggregates
 * may reflect comps this listing's own search would have excluded (or vice
 * versa), and recomputing only priceDelta on top of them does not correct
 * that. Only the two "anchor filter didn't fire at all" cases (both prices
 * missing/under the $50 floor) or "both prices close enough that the 10x
 * window is effectively the same" are treated as compatible; everything
 * else falls through to a real search instead of guessing.
 */
function anchorContextsCompatible(
  yourPrice: number | null | undefined,
  siblingYourPrice: number | null | undefined,
): boolean {
  const a = yourPrice != null && yourPrice >= 50 ? yourPrice : null;
  const b = siblingYourPrice != null && siblingYourPrice >= 50 ? siblingYourPrice : null;
  if (a === null && b === null) return true; // anchor filter never applied to either
  if (a === null || b === null) return false; // filter applied to only one
  const ratio = a / b;
  return ratio >= 0.5 && ratio <= 2.0;
}

/**
 * Attempts the cache-by-product-signature path: finds an existing FRESH
 * comp lookup for a DIFFERENT listing of the same seller with the same
 * product signature, and reuses its stats/comp itemIds for this listing
 * instead of running a new Gemini + eBay Browse API search. Returns a
 * CompetitorSearchOutcome on success, or null to signal "fall through to
 * the next path unchanged" -- same fail-open contract as
 * attemptItemsRefresh, and every failure mode here (no sibling, stale
 * sibling, thin sibling, DB error) falls through rather than throwing.
 *
 * Recomputes price_delta against THIS listing's own yourPrice rather than
 * copying the sibling's -- two listings sharing a signature can have
 * different seller-set prices, and copying the sibling's price_delta
 * verbatim would show every dupe listing the wrong delta.
 */
export async function attemptSignatureMatch(params: {
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabase: any;
  userId: string;
  listingId: string;
  signature: string;
  yourPrice: number | null | undefined;
}): Promise<CompetitorSearchOutcome | null> {
  const { supabase, userId, listingId, signature, yourPrice } = params;

  let sibling: any;
  try {
    const freshCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data } = await supabase
      .from("competitor_prices")
      .select("*")
      .eq("user_id", userId)
      .eq("product_signature", signature)
      .neq("ebay_listing_id", listingId)
      .gte("fetched_at", freshCutoff)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sibling = data;
  } catch (err) {
    console.warn("[competitorSearch] attemptSignatureMatch: lookup failed, falling through:", err);
    return null;
  }

  if (!sibling) {
    console.log(`[competitorSearch] attemptSignatureMatch: no fresh sibling for signature "${signature}"`);
    return null;
  }

  if ((sibling.competitor_count ?? 0) < SIGNATURE_MATCH_MIN_COMPS) {
    console.log(
      `[competitorSearch] attemptSignatureMatch: sibling listing ${sibling.ebay_listing_id} has only ${
        sibling.competitor_count ?? 0
      } comps (need ${SIGNATURE_MATCH_MIN_COMPS}+) — falling through`,
    );
    return null;
  }

  // The sibling's aggregates were computed by computeCompStats using ITS OWN
  // your_price as the anchor for priceAnchorFilter -- if this listing's
  // yourPrice implies a materially different anchor window, those
  // aggregates may include/exclude comps this listing's own search would
  // not have, and recomputing only priceDelta on top of them would not fix
  // that (found in Copilot review of PR #602, 2026-09-19). Fall through to
  // a real search rather than reuse an aggregate computed under an
  // incompatible price context.
  if (!anchorContextsCompatible(yourPrice, sibling.your_price)) {
    console.log(
      `[competitorSearch] attemptSignatureMatch: sibling listing ${sibling.ebay_listing_id}'s price anchor ($${sibling.your_price}) is incompatible with this listing's ($${yourPrice}) — falling through`,
    );
    return null;
  }

  const medianPrice: number = sibling.median_price;
  const priceDelta = yourPrice != null ? Math.round((yourPrice - medianPrice) * 100) / 100 : null;

  // Preserve the sibling's ORIGINAL fetched_at rather than stamping "now" --
  // this row did no live Gemini/eBay lookup, so treating it as freshly
  // fetched would let two duplicate listings perpetually renew each other's
  // stale snapshot (each sees the other as "fresh" on its next check),
  // silently starving the cron of any real refresh (found in Copilot review
  // of PR #602, 2026-09-19). Expiry is derived from the same original
  // timestamp the sibling itself will expire on.
  const siblingFetchedAt = new Date(sibling.fetched_at);

  try {
    const payload = buildCompetitorPricesUpsertPayload({
      userId,
      listingId,
      searchQuery: sibling.search_query,
      geminiQuery: sibling.gemini_search_query ?? null,
      avgPrice: sibling.avg_price,
      minPrice: sibling.min_price,
      maxPrice: sibling.max_price,
      medianPrice,
      priceDelta,
      yourPrice: yourPrice ?? null,
      competitorCount: sibling.competitor_count,
      priceDistribution: sibling.price_distribution,
      compItemIds: sibling.comp_item_ids ?? null,
      productSignature: signature,
      now: siblingFetchedAt,
    });
    const { error: upsertErr } = await supabase.from("competitor_prices").upsert(payload, {
      onConflict: "user_id,ebay_listing_id",
    });
    if (upsertErr) {
      console.warn("[competitorSearch] attemptSignatureMatch: upsert reported an error:", upsertErr);
    } else {
      console.log(
        `[competitorSearch] Signature match saved for listing ${listingId}: reused from ${sibling.ebay_listing_id}, avg=$${
          Number(sibling.avg_price).toFixed(2)
        }`,
      );
    }
  } catch (dbErr) {
    // Non-fatal, matching attemptItemsRefresh's own persist-failure handling
    // -- still return the freshly-computed data to the caller.
    console.warn("[competitorSearch] attemptSignatureMatch: failed to persist snapshot:", dbErr);
  }

  const cacheExpiresAt = new Date(siblingFetchedAt.getTime() + CACHE_TTL_MS).toISOString();

  return {
    status: 200,
    body: {
      searchQuery: sibling.gemini_search_query ?? sibling.search_query,
      finalSearchQuery: sibling.search_query,
      geminiSearchQuery: sibling.gemini_search_query ?? null,
      avgPrice: Math.round(Number(sibling.avg_price) * 100) / 100,
      minPrice: sibling.min_price,
      maxPrice: sibling.max_price,
      medianPrice: Math.round(medianPrice * 100) / 100,
      priceDelta,
      competitorCount: sibling.competitor_count,
      priceDistribution: sibling.price_distribution ?? [],
      noData: false,
      fromCache: false,
      cacheExpiresAt,
      refreshMethod: "signatureMatch",
      matchedListingId: sibling.ebay_listing_id,
    },
  };
}

/**
 * Extracts up to 20 itemIds from the price-cleaned comp set for storage on
 * competitor_prices.comp_item_ids -- 20 is a single Browse API getItems
 * bulk-lookup call's max item_ids, chosen so a future refresh of this
 * listing (see the getItems follow-on work) never needs pagination/
 * batching logic. Pure and exported so the cap/filter behavior has direct
 * test coverage without exercising the whole search pipeline.
 */
export function extractCompItemIds(items: CompetitorItem[]): string[] {
  return items
    .map((it) => it.itemId)
    .filter((id): id is string => !!id)
    .slice(0, 20);
}

// ----------------------------------------------------------------
// Run a full competitor-price search + persist cycle for one listing.
// Assumes the caller has already validated its inputs (non-empty title,
// resolved/trusted userId) -- this is the HTTP-independent core that both
// ebay-competitor-search/index.ts and competitor-prices-cron/index.ts call.
// ----------------------------------------------------------------
export async function runCompetitorSearch(params: {
  // deno-lint-ignore no-explicit-any -- matches the loose supabase-js typing
  // already used throughout this codebase's Edge Functions.
  supabase: any;
  userId?: string;
  listingId?: string;
  title: string;
  categoryId?: string;
  yourPrice?: number | null;
  ebayEnv: string;
  geminiKey?: string;
}): Promise<CompetitorSearchOutcome> {
  const { supabase, userId, listingId, title, categoryId, yourPrice, ebayEnv, geminiKey } = params;

  // Computed once up front (cache-by-product-signature feature) so both the
  // new signature-match step below AND the full-search persist at the end
  // of this function use the identical value -- every persist path needs to
  // write it so a FUTURE listing can find this one.
  const sig = computeProductSignature(title, categoryId);

  try {
    // ------------------------------------------------------------------
    // Combined-quota pre-flight gate (2026-09-21 quota-storm fix). Checked
    // once up front, before any cache/signature-match short-circuit --
    // those two paths never call eBay at all, so gating them would be
    // pointless; this only actually matters once we're about to reach
    // attemptItemsRefresh or the full search below. Computed here (not
    // deeper in the function) so BOTH of those call sites share the exact
    // same read of "is there headroom today" rather than risking two
    // slightly-different-in-time answers from two separate queries.
    // ------------------------------------------------------------------
    const quotaHeadroom = await checkBrowseQuotaHeadroom(supabase);
    if (!quotaHeadroom.hasHeadroom) {
      console.warn(
        `[competitorSearch] Skipping eBay Browse API call(s) -- ${quotaHeadroom.reason}. Serving cache/no-data instead of burning more calls into an exhausted quota.`,
      );
    }

    // ------------------------------------------------------------------
    // Cache check — return immediately if data is < CACHE_TTL_MS old.
    // ------------------------------------------------------------------
    if (userId && listingId) {
      try {
        const freshCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
        const { data: cachedFresh } = await supabase
          .from("competitor_prices")
          .select("*")
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId)
          .gte("fetched_at", freshCutoff)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cachedFresh) {
          const cacheAgeMs = Date.now() - new Date(cachedFresh.fetched_at).getTime();
          const cacheAgeMins = Math.round(cacheAgeMs / 60000);
          const cacheExpiresAt = new Date(
            new Date(cachedFresh.fetched_at).getTime() + CACHE_TTL_MS,
          ).toISOString();
          console.log(
            `[competitorSearch] Cache hit (${cacheAgeMins}min old) — returning cached data`,
          );
          return {
            status: 200,
            body: {
              searchQuery: cachedFresh.gemini_search_query ?? cachedFresh.search_query,
              avgPrice: cachedFresh.avg_price,
              minPrice: cachedFresh.min_price,
              maxPrice: cachedFresh.max_price,
              medianPrice: cachedFresh.median_price,
              priceDelta: cachedFresh.price_delta,
              competitorCount: cachedFresh.competitor_count,
              priceDistribution: cachedFresh.price_distribution ?? [],
              noData: false,
              fromCache: true,
              cacheAgeMins,
              cacheExpiresAt,
            },
          };
        }

        console.log(
          "[competitorSearch] Cache miss / stale — fetching live data from eBay...",
        );
      } catch (cacheErr) {
        console.warn(
          "[competitorSearch] Cache check failed, proceeding to eBay:",
          cacheErr,
        );
      }

      // ------------------------------------------------------------------
      // Signature-match attempt — reuse a FRESH comp lookup from a
      // DIFFERENT listing of the same product for this same seller, if one
      // exists. Tried before attemptItemsRefresh since a signature hit
      // skips Gemini AND eBay entirely, cheaper than even a getItems call.
      // Only reached when the cache check above found nothing fresh for
      // THIS listing. Returns null (or is skipped outright when no
      // signature was derived) to fall through unchanged.
      // ------------------------------------------------------------------
      if (isSignatureMatchEnabled() && sig.signature) {
        const signatureOutcome = await attemptSignatureMatch({
          supabase,
          userId,
          listingId,
          signature: sig.signature,
          yourPrice,
        });
        if (signatureOutcome) {
          return signatureOutcome;
        }
      } else if (sig.signature === null) {
        console.log(`[competitorSearch] no product signature: ${sig.reason}`);
      }

      // ------------------------------------------------------------------
      // getItems refresh attempt — cheap single-item lookup of already-known
      // comps instead of a full re-search. Logged under the
      // "buy.browse.item.bulk" resource name for dashboard continuity, but
      // (CORRECTED 2026-09-20) that traffic shares the same real-world
      // 5,000/day ceiling as buy.browse -- see the corrected docstring on
      // fetchEbayItemsBulk above. Only reached when the cache check above
      // found nothing fresh, AND only when checkBrowseQuotaHeadroom below
      // confirms there's combined headroom left today -- otherwise this
      // falls straight through to the full-search path without spending
      // any more calls into an already-exhausted quota.
      // ------------------------------------------------------------------
      if (quotaHeadroom.hasHeadroom) {
        const itemsRefreshOutcome = await attemptItemsRefresh({
          supabase,
          userId,
          listingId,
          ebayEnv,
          yourPrice,
          productSignature: sig.signature,
        });
        if (itemsRefreshOutcome) {
          return itemsRefreshOutcome;
        }
      }
    }

    // ------------------------------------------------------------------
    // Quota-exhausted short-circuit -- if the combined pre-flight gate
    // above found no headroom, do NOT proceed to the full Gemini + Browse
    // API search fan-out below (that's the expensive multi-tier path,
    // several calls per listing). Fall back to whatever stale cache exists
    // for this listing, or a clean noData response if there isn't one --
    // either is far better than adding to an already-429ing call volume.
    // ------------------------------------------------------------------
    if (!quotaHeadroom.hasHeadroom) {
      if (userId && listingId) {
        try {
          const { data: staleCached } = await supabase
            .from("competitor_prices")
            .select("*")
            .eq("user_id", userId)
            .eq("ebay_listing_id", listingId)
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (staleCached) {
            const cacheAgeHours = Math.round(
              (Date.now() - new Date(staleCached.fetched_at).getTime()) / (60 * 60 * 1000),
            );
            console.log(
              `[competitorSearch] Quota exhausted -- returning stale cache (${cacheAgeHours}h old) instead of a live search`,
            );
            return {
              status: 200,
              body: {
                searchQuery: staleCached.gemini_search_query ?? staleCached.search_query,
                avgPrice: staleCached.avg_price,
                minPrice: staleCached.min_price,
                maxPrice: staleCached.max_price,
                medianPrice: staleCached.median_price,
                priceDelta: staleCached.price_delta,
                competitorCount: staleCached.competitor_count,
                priceDistribution: staleCached.price_distribution ?? [],
                noData: false,
                fromCache: true,
                stale: true,
                cacheAgeHours,
                warning: "eBay Browse API daily quota is exhausted. Showing cached data.",
              },
            };
          }
        } catch (fallbackErr) {
          console.warn(
            "[competitorSearch] Quota-exhausted stale-cache fallback failed:",
            fallbackErr,
          );
        }
      }

      return {
        status: 200,
        body: {
          searchQuery: title,
          avgPrice: null,
          minPrice: null,
          maxPrice: null,
          medianPrice: null,
          priceDelta: null,
          competitorCount: 0,
          priceDistribution: [],
          noData: true,
          warning: "eBay Browse API daily quota is exhausted. Try again after the daily reset.",
        },
      };
    }

    // ------------------------------------------------------------------
    // Step 1 — Generate optimised search query via Gemini Flash
    // Falls back to heuristic if Gemini is unavailable / times out.
    // ------------------------------------------------------------------
    let geminiQuery: string | null = null;
    if (geminiKey) {
      geminiQuery = await geminiSearchQuery(
        geminiKey,
        title,
        categoryId,
        yourPrice,
      );
    } else {
      console.log(
        "[competitorSearch] No GEMINI_API_KEY — skipping Gemini query optimisation",
      );
    }

    const heuristicQuery = deriveSearchQueryFallback(title);
    const searchQuery = geminiQuery ?? heuristicQuery;
    const usedGemini = !!geminiQuery;
    console.log(
      `[competitorSearch] Search query (${usedGemini ? "Gemini" : "heuristic"}): "${searchQuery}"`,
    );

    // ------------------------------------------------------------------
    // Step 2 — Get eBay OAuth token
    // ------------------------------------------------------------------
    let token: string;
    try {
      token = await getEbayAppToken(ebayEnv);
    } catch (tokenErr) {
      console.error(
        "[competitorSearch] Failed to get eBay OAuth token:",
        tokenErr,
      );
      return { status: 500, body: { error: String(tokenErr) } };
    }

    // ------------------------------------------------------------------
    // Step 3 — Fetch from eBay Browse API
    // ------------------------------------------------------------------
    const searchPlan = buildSearchPlan({
      title,
      geminiQuery,
      heuristicQuery,
      categoryId,
    });

    const tiers = groupPlanIntoTiers(searchPlan);
    const tiered = await runTieredCompSearch(tiers, (attempt) => {
      console.log(
        `[competitorSearch] Attempting search (${attempt.strategy}): "${attempt.query}" category=${
          attempt.categoryId ?? "any"
        }`,
      );
      // Counter logging happens inside fetchEbayCompetitors itself, at each
      // actual HTTP attempt (including internal 5xx/network retries) --
      // not here, which would only count once per planned search attempt
      // and undercount by up to 3x on a retry-heavy run.
      return fetchEbayCompetitors({
        token,
        searchQuery: attempt.query,
        categoryId: attempt.categoryId,
        ebayEnv,
        filterMode: attempt.filterMode,
        supabaseForLogging: supabase,
        loggingCaller: "competitorSearch",
      });
    });

    const prices = tiered.prices;
    const structuredItems = tiered.items;
    const count = tiered.count;
    const chosenQuery = tiered.chosen?.query ?? searchQuery;
    const chosenCategoryId = tiered.chosen?.categoryId ?? categoryId;
    console.log(
      `[competitorSearch] Tiered search used ${tiered.tiersUsed} tier(s) of ${tiers.length} available`,
    );

    if (prices.length === 0) {
      console.log(
        `[competitorSearch] No prices found after ${searchPlan.length} attempts, returning empty response`,
      );
      return {
        status: 200,
        body: {
          searchQuery,
          attemptedQueries: searchPlan.map((a) => ({
            query: a.query,
            categoryId: a.categoryId ?? null,
            strategy: a.strategy,
            filterMode: a.filterMode,
          })),
          avgPrice: null,
          minPrice: null,
          maxPrice: null,
          medianPrice: null,
          priceDelta: null,
          competitorCount: 0,
          priceDistribution: [],
          noData: true,
        },
      };
    }

    // ------------------------------------------------------------------
    // Step 4 — Compute statistics (with price-anchor + outlier removal)
    // ------------------------------------------------------------------
    // First apply a price-anchor filter: remove items whose price is
    // < 10% or > 10x the seller's own price. This prevents e.g. $0.95
    // novelty coins from polluting the market analysis of a $995 graded
    // gold coin when both match the same keywords.
    // Then apply IQR outlier removal for the remaining items. Shared with
    // attemptItemsRefresh's getItems path via computeCompStats -- see that
    // function's own docstring for why sharing this exact code matters.
    const { avgPrice, minPrice, maxPrice, medianPrice, priceDelta, priceDistribution, cleanPrices } = computeCompStats(
      { prices, yourPrice },
    );

    console.log(
      `[competitorSearch] Stats (after outlier removal): avg=$${avgPrice.toFixed(2)}, median=$${
        medianPrice.toFixed(
          2,
        )
      }, n=${cleanPrices.length} (raw: ${count}, query="${chosenQuery}", category=${chosenCategoryId ?? "any"})`,
    );

    // Filter structured items to the price-cleaned set so callers (e.g.
    // PriceRecommenderCard) render only the comps that drove the stats.
    // Computed BEFORE Step 5 (moved up from after it) -- the getItems
    // batch-refresh follow-on plan needs these itemIds AT persist time,
    // not just for the HTTP response, so a later refresh of this same
    // listing can call getItems against them instead of re-running a full
    // search (see shimmying-humming-feather.md's getItems follow-on plan).
    const cleanSet = new Set(cleanPrices);
    const cleanItems = structuredItems
      .filter((it) => cleanSet.has(it.price))
      .slice(0, 25);
    const compItemIds = extractCompItemIds(cleanItems);

    // ------------------------------------------------------------------
    // Step 5 — Persist to competitor_prices (upsert)
    // ------------------------------------------------------------------
    if (userId && listingId) {
      try {
        const payload = buildCompetitorPricesUpsertPayload({
          userId,
          listingId,
          searchQuery: chosenQuery,
          geminiQuery: geminiQuery ?? null,
          avgPrice,
          minPrice,
          maxPrice,
          medianPrice,
          priceDelta,
          yourPrice: yourPrice ?? null,
          competitorCount: cleanPrices.length,
          priceDistribution,
          compItemIds,
          productSignature: sig.signature,
        });

        await supabase.from("competitor_prices").upsert(
          payload,
          { onConflict: "user_id,ebay_listing_id" },
        );

        console.log(
          `[competitorSearch] Saved snapshot for listing ${listingId}: avg=$${avgPrice.toFixed(2)}, n=${count}`,
        );
      } catch (dbErr) {
        // Non-fatal — still return data to caller
        console.warn(
          "[competitorSearch] Failed to persist snapshot:",
          dbErr,
        );
      }
    }

    const cacheExpiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

    return {
      status: 200,
      body: {
        searchQuery,
        finalSearchQuery: chosenQuery,
        geminiSearchQuery: geminiQuery,
        avgPrice: Math.round(avgPrice * 100) / 100,
        minPrice,
        maxPrice,
        medianPrice: Math.round(medianPrice * 100) / 100,
        priceDelta,
        competitorCount: cleanPrices.length,
        priceDistribution,
        items: cleanItems,
        noData: false,
        fromCache: false,
        cacheExpiresAt,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "no stack";
    console.error("[competitorSearch] *** OUTER ERROR HANDLER ***", {
      message: msg,
      stack,
    });

    // Graceful degradation — serve stale cache if we have any
    if (userId && listingId) {
      try {
        const { data: staleCached } = await supabase
          .from("competitor_prices")
          .select("*")
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (staleCached) {
          const cacheAgeHours = Math.round(
            (Date.now() - new Date(staleCached.fetched_at).getTime()) /
              (60 * 60 * 1000),
          );
          console.log(
            `[competitorSearch] Returning stale cache (${cacheAgeHours}h old) as fallback`,
          );
          return {
            status: 200,
            body: {
              searchQuery: staleCached.gemini_search_query ?? staleCached.search_query,
              avgPrice: staleCached.avg_price,
              minPrice: staleCached.min_price,
              maxPrice: staleCached.max_price,
              medianPrice: staleCached.median_price,
              priceDelta: staleCached.price_delta,
              competitorCount: staleCached.competitor_count,
              priceDistribution: staleCached.price_distribution ?? [],
              noData: false,
              fromCache: true,
              stale: true,
              cacheAgeHours,
              warning: `eBay API error. Showing data from ${cacheAgeHours}h ago.`,
            },
          };
        }
      } catch (fallbackErr) {
        console.warn(
          "[competitorSearch] Stale cache fallback failed:",
          fallbackErr,
        );
      }
    }

    return {
      status: 500,
      body: {
        error: msg,
        errorType: err?.constructor?.name,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
