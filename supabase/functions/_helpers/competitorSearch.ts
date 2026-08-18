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
// Cache TTL — 8 hours. Balances freshness vs. API call volume.
// competitor-prices-cron also uses this constant to decide whether to skip
// a listing (if its cache is younger than CACHE_TTL_MS, skip it).
// ----------------------------------------------------------------
export const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

export interface CompetitorSearchOutcome {
  status: number;
  body: Record<string, unknown>;
}

interface CompetitorItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemId?: string;
  itemUrl?: string | null;
  imageUrl?: string | null;
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

function buildSearchPlan(params: {
  title: string;
  geminiQuery: string | null;
  heuristicQuery: string;
  categoryId?: string;
}): Array<{
  query: string;
  categoryId?: string;
  strategy: string;
  filterMode: "fixed" | "any";
}> {
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

  const plan: Array<{
    query: string;
    categoryId?: string;
    strategy: string;
    filterMode: "fixed" | "any";
  }> = [];
  for (const query of uniqueQueries.slice(0, 4)) {
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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
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
// Fetch competitor listings via eBay Browse API (modern, no quota issues).
// Uses OAuth Bearer token — no hard 5,000 calls/day limit.
// ----------------------------------------------------------------
async function fetchEbayCompetitors(params: {
  token: string;
  searchQuery: string;
  categoryId?: string;
  ebayEnv: string;
  filterMode?: "fixed" | "any";
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
    try {
      const priceVal = item?.price?.value ?? item?.currentPrice?.value;
      const price = parseFloat(String(priceVal ?? "0"));
      if (isNaN(price) || price <= 0) continue;
      prices.push(price);
      structured.push({
        title: String(item?.title ?? "").slice(0, 200),
        price,
        currency: String(item?.price?.currency ?? "USD"),
        condition: String(item?.condition ?? "Pre-Owned"),
        itemId: item?.itemId ? String(item.itemId) : undefined,
        itemUrl: item?.itemWebUrl ?? null,
        imageUrl: item?.image?.imageUrl ?? item?.thumbnailImages?.[0]?.imageUrl ?? null,
      });
    } catch {
      // Skip malformed items
    }
  }

  console.log(
    `[competitorSearch] Found ${prices.length} priced items out of ${items.length} Browse API results`,
  );

  return { prices, count: prices.length, raw: items, items: structured };
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

    let prices: number[] = [];
    let structuredItems: CompetitorItem[] = [];
    let count = 0;
    let chosenQuery = searchQuery;
    let chosenCategoryId = categoryId;

    for (const attempt of searchPlan) {
      console.log(
        `[competitorSearch] Attempting search (${attempt.strategy}): "${attempt.query}" category=${
          attempt.categoryId ?? "any"
        }`,
      );
      const result = await fetchEbayCompetitors({
        token,
        searchQuery: attempt.query,
        categoryId: attempt.categoryId,
        ebayEnv,
        filterMode: attempt.filterMode,
      });

      if (result.prices.length > 0) {
        prices = result.prices;
        structuredItems = result.items;
        count = result.count;
        chosenQuery = attempt.query;
        chosenCategoryId = attempt.categoryId;
        break;
      }
    }

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
    // Then apply IQR outlier removal for the remaining items.
    const anchoredPrices = priceAnchorFilter(prices, yourPrice);
    const cleanPrices = removeOutliers(anchoredPrices);
    const avgPrice = cleanPrices.reduce((s, p) => s + p, 0) / cleanPrices.length;
    const minPrice = Math.min(...cleanPrices);
    const maxPrice = Math.max(...cleanPrices);
    const medianPrice = median(cleanPrices);
    // Use median as basis for priceDelta — more robust than avg for skewed distributions
    const priceDelta = yourPrice != null ? Math.round((yourPrice - medianPrice) * 100) / 100 : null;
    const priceDistribution = buildDistribution(cleanPrices);

    console.log(
      `[competitorSearch] Stats (after outlier removal): avg=$${avgPrice.toFixed(2)}, median=$${
        medianPrice.toFixed(
          2,
        )
      }, n=${cleanPrices.length} (raw: ${count}, query="${chosenQuery}", category=${chosenCategoryId ?? "any"})`,
    );

    // ------------------------------------------------------------------
    // Step 5 — Persist to competitor_prices (upsert)
    // ------------------------------------------------------------------
    if (userId && listingId) {
      try {
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

        await supabase.from("competitor_prices").upsert(
          {
            user_id: userId,
            ebay_listing_id: listingId,
            search_query: chosenQuery,
            gemini_search_query: geminiQuery ?? null,
            avg_price: Math.round(avgPrice * 100) / 100,
            min_price: minPrice,
            max_price: maxPrice,
            median_price: Math.round(medianPrice * 100) / 100,
            price_delta: priceDelta,
            your_price: yourPrice ?? null,
            competitor_count: cleanPrices.length,
            price_distribution: priceDistribution,
            expires_at: expiresAt,
          },
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

    // Filter structured items to the price-cleaned set so callers (e.g.
    // PriceRecommenderCard) render only the comps that drove the stats.
    const cleanSet = new Set(cleanPrices);
    const cleanItems = structuredItems
      .filter((it) => cleanSet.has(it.price))
      .slice(0, 25);

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
