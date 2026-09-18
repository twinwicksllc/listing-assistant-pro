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

export interface BulkItemsLookupResult {
  items: CompetitorItem[];
  foundItemIds: string[];
  missingItemIds: string[];
}

/**
 * Bulk item lookup via GET /buy/browse/v1/item?item_ids=... -- draws from
 * eBay's buy.browse.item.bulk quota pool, confirmed via a live getRateLimits
 * check (2026-09-17/18) to be a SEPARATE 5,000/day pool from buy.browse
 * (item_summary/search), and confirmed sitting at 0/5,000 used -- entirely
 * unused by this codebase until now. Up to 20 IDs per call; callers must
 * pre-cap (comp_item_ids is capped to 20 at write time in
 * buildCompetitorPricesUpsertPayload's caller, matching a single call's max).
 *
 * A missing itemId in the response is eBay's documented way of saying
 * "delisted/ended" -- there is no per-item error, the id is simply absent
 * from the returned array. That is never treated as a failure for the
 * whole call; only a fully-failed HTTP request (after retries) throws.
 * An item that IS present but shows e.g. OUT_OF_STOCK availability is still
 * alive (the listing exists), not delisted -- this function does not treat
 * availability status as a delisting signal, only presence/absence in the
 * response does.
 *
 * *** NOT YET VERIFIED against a live eBay call *** -- no eBay credentials
 * exist in this dev sandbox. Before this path is trusted in production,
 * manually confirm against a real account: (a) the itemId format captured
 * from item_summary/search's itemSummaries[].itemId is accepted as-is by
 * this endpoint's item_ids param, (b) the response's field names actually
 * match what parseCompetitorItem expects, (c) a deliberately delisted/
 * invalid itemId is omitted rather than causing a 4xx for the whole batch.
 * See the getItems batch-refresh plan (shimmying-humming-feather.md) for
 * the full verification step this must go through before merge.
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
  const url = `${apiBase}/buy/browse/v1/item?item_ids=${itemIds.map((id) => encodeURIComponent(id)).join(",")}`;

  console.log(
    `[competitorSearch] Browse API getItems bulk lookup: ${itemIds.length} itemId(s)`,
  );

  let resp: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Same reasoning as fetchEbayCompetitors: log at the point of the
      // actual HTTP attempt, not once per call, since a retried 5xx still
      // consumes real quota against the buy.browse.item.bulk pool.
      logBrowseApiCall(supabaseForLogging, `${loggingCaller} (attempt ${attempt + 1})`, "buy.browse.item.bulk");
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
          `[competitorSearch] getItems returned ${resp.status} — retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (fetchErr) {
      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(
          `[competitorSearch] getItems fetch error (attempt ${attempt + 1}/3) — retrying in ${delayMs}ms`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (!resp || !resp.ok) {
    const errBody = (await resp?.text?.().catch(() => "(could not read body)")) ??
      "(no response)";
    console.error(
      `[competitorSearch] getItems failed: ${resp?.status} — ${errBody.slice(0, 300)}`,
    );
    throw new Error(
      `eBay getItems error: ${resp?.status ?? "unknown"} — ${errBody.slice(0, 200)}`,
    );
  }

  const respText = await resp.text();
  let json: any;
  try {
    json = JSON.parse(respText);
  } catch {
    throw new Error(`eBay getItems returned invalid JSON`);
  }

  const rawItems: any[] = json?.items ?? [];
  const items: CompetitorItem[] = [];
  for (const raw of rawItems) {
    const parsed = parseCompetitorItem(raw);
    if (parsed) items.push(parsed);
  }

  const foundItemIds = items
    .map((it) => it.itemId)
    .filter((id): id is string => !!id);
  const foundSet = new Set(foundItemIds);
  const missingItemIds = itemIds.filter((id) => !foundSet.has(id));

  console.log(
    `[competitorSearch] getItems: ${foundItemIds.length}/${itemIds.length} requested itemIds still present`,
  );

  return { items, foundItemIds, missingItemIds };
}

export interface CompSearchAttemptResult {
  prices: number[];
  count: number;
  items: CompetitorItem[];
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
  // Which Browse API quota pool this call actually drew from. Default
  // "buy.browse" (item_summary/search, every call site before the getItems
  // follow-on work) keeps every existing 2-arg call site source-compatible.
  // "buy.browse.item.bulk" (getItems) is a genuinely separate 5,000/day
  // pool per eBay's own getRateLimits -- ebay-quota-monitor's same-day
  // counter filters on this column specifically so a burst of cheap
  // getItems calls can never inflate the buy.browse early-warning heuristic.
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
}): Promise<CompetitorSearchOutcome | null> {
  const { supabase, userId, listingId, ebayEnv, yourPrice } = params;

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

  const usability = isItemsRefreshUsable({
    requestedCount: storedItemIds.length,
    foundCount: bulkResult.items.length,
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
  const newCompItemIds = cleanItems
    .map((it) => it.itemId)
    .filter((id): id is string => !!id)
    .slice(0, 20);

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

  try {
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
      // getItems refresh attempt — cheap bulk lookup of already-known comps
      // instead of a full re-search, drawing from the (confirmed unused)
      // buy.browse.item.bulk pool rather than buy.browse. Only reached when
      // the cache check above found nothing fresh. Returns null on any
      // failure/unusable-result to fall through to the existing full-search
      // path below, completely unchanged -- this can only ever REMOVE a
      // buy.browse call when it succeeds, never add one or introduce a new
      // failure mode.
      // ------------------------------------------------------------------
      const itemsRefreshOutcome = await attemptItemsRefresh({
        supabase,
        userId,
        listingId,
        ebayEnv,
        yourPrice,
      });
      if (itemsRefreshOutcome) {
        return itemsRefreshOutcome;
      }
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
