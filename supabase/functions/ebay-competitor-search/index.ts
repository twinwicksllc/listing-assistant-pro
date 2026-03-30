import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// Build price distribution buckets from a list of prices.
// Generates up to 5 evenly-spaced buckets between min and max.
// ----------------------------------------------------------------
function buildDistribution(
  prices: number[]
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
    const idx = Math.min(
      Math.floor((price - min) / step),
      BUCKET_COUNT - 1
    );
    buckets[idx].count++;
  }

  return buckets;
}

// ----------------------------------------------------------------
// Derive a clean search query from a listing title.
// Trims keywords down to ~5 meaningful tokens so the eBay search
// returns comparable items (not just exact title matches).
// ----------------------------------------------------------------
function deriveSearchQuery(title: string): string {
  const stopWords = new Set([
    "a", "an", "the", "and", "or", "of", "in", "for", "to", "with",
    "lot", "set", "collection", "item", "listing", "ebay",
    "certified", "uncirculated", "beautiful", "stunning", "rare",
    "vintage", "antique", "original", "authentic",
  ]);

  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  return tokens.slice(0, 6).join(" ");
}

// ----------------------------------------------------------------
// Get eBay OAuth App Token (client_credentials — no user token needed).
// This uses the same EBAY_CLIENT_ID + EBAY_CLIENT_SECRET env vars
// already required for publishing and category lookups.
// ----------------------------------------------------------------
async function getEbayAppToken(ebayEnv: string): Promise<string> {
  const clientId     = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("EBAY_CLIENT_ID or EBAY_CLIENT_SECRET not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const tokenUrl = ebayEnv === "production"
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  console.log(`[ebay-competitor-search] Fetching OAuth app token (${ebayEnv})`);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`[ebay-competitor-search] Token error ${resp.status}: ${txt.slice(0, 200)}`);
    throw new Error(`Failed to get eBay OAuth token: ${resp.status}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ----------------------------------------------------------------
// Fetch competitor listings via eBay Browse API (modern, no quota issues).
// Uses client_credentials app token — no user OAuth required.
// Returns active fixed-price listings sorted by best match.
// ----------------------------------------------------------------
async function fetchEbayCompetitors(params: {
  token: string;
  searchQuery: string;
  categoryId?: string;
  ebayEnv: string;
}): Promise<{
  prices: number[];
  count: number;
  raw: unknown[];
}> {
  const { token, searchQuery, categoryId, ebayEnv } = params;

  const apiBase = ebayEnv === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q:     searchQuery,
    limit: "50",
    sort:  "price",
    filter: "buyingOptions:{FIXED_PRICE}",
  });

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(`[ebay-competitor-search] Browse API search: "${searchQuery}" (category: ${categoryId ?? "any"})`);

  let resp: Response | null = null;
  let lastError: Error | null = null;

  // Retry on 5xx with exponential backoff (up to 3 attempts)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization":             `Bearer ${token}`,
          "Content-Type":              "application/json",
          "X-EBAY-C-MARKETPLACE-ID":   "EBAY_US",
        },
      });

      if (resp.ok || resp.status < 500) break; // success or client error — don't retry

      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(`[ebay-competitor-search] Browse API returned ${resp.status} — retrying in ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (fetchErr) {
      lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(`[ebay-competitor-search] Fetch failed (attempt ${attempt + 1}/3) — retrying in ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  if (!resp || !resp.ok) {
    const errBody = await resp?.text?.().catch(() => "(could not read body)") || "(no response)";
    console.error(`[ebay-competitor-search] Browse API failed: ${resp?.status} — ${errBody.slice(0, 300)}`);
    throw new Error(`eBay Browse API error: ${resp?.status ?? "unknown"} — ${errBody.slice(0, 200)}`);
  }

  const respText = await resp.text();
  let json: any;
  try {
    json = JSON.parse(respText);
  } catch (parseErr) {
    console.error(`[ebay-competitor-search] JSON parse failed (length=${respText.length}):`, respText.slice(0, 300));
    throw new Error(`eBay Browse API returned invalid JSON`);
  }

  const items: any[] = json?.itemSummaries ?? [];

  if (items.length === 0) {
    console.log(`[ebay-competitor-search] No results for "${searchQuery}"`);
    return { prices: [], count: 0, raw: [] };
  }

  const prices: number[] = [];
  for (const item of items) {
    try {
      const priceVal = item?.price?.value ?? item?.currentPrice?.value;
      const price = parseFloat(String(priceVal ?? "0"));
      if (!isNaN(price) && price > 0) {
        prices.push(price);
      }
    } catch {
      // Skip malformed items
    }
  }

  console.log(`[ebay-competitor-search] Found ${prices.length} priced items out of ${items.length} results`);
  return { prices, count: prices.length, raw: items };
}

// ----------------------------------------------------------------
// Compute median from a sorted or unsorted array of numbers.
// ----------------------------------------------------------------
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
console.log("[ebay-competitor-search] Module loaded, serve() initializing...");

serve(async (req) => {
  console.log("[ebay-competitor-search] *** REQUEST RECEIVED ***", {
    method: req.method,
    url: req.url,
    headers: {
      "content-type": req.headers.get("content-type"),
      "authorization": req.headers.get("authorization") ? "present" : "missing",
    },
  });

  if (req.method === "OPTIONS") {
    console.log("[ebay-competitor-search] Handling OPTIONS preflight");
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[ebay-competitor-search] Attempting to parse request body...");
    let body: any;
    let listingId: string | undefined;
    let userId: string | undefined;

    try {
      body = await req.json();
      console.log("[ebay-competitor-search] Successfully parsed JSON body, keys:", Object.keys(body));
    } catch (parseErr) {
      console.error("[ebay-competitor-search] JSON parse failed:", parseErr);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body", detail: String(parseErr) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Body parsed:", Object.keys(body));
    const { title, categoryId, yourPrice } = body;
    listingId = body.listingId;
    userId    = body.userId;

    console.log("[ebay-competitor-search] Validation step - checking title...");
    if (!title) {
      console.error("[ebay-competitor-search] Missing title");
      return new Response(
        JSON.stringify({ error: "title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Loading environment variables...");
    // FIXED: Default to "production" — the sandbox Finding API had its own 5k/day
    // quota that was getting exhausted. The Browse API (OAuth) has no such hard limit.
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
    console.log("[ebay-competitor-search] ebayEnv:", ebayEnv);

    // ── Check database cache before hitting eBay API ──────────────────────────
    // Primary cache: 23 hours (fresh data)
    // Fallback cache: Any data available (graceful degradation during API errors)
    if (userId && listingId) {
      try {
        const supabaseCheck = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );

        const freshCutoff = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
        const { data: cachedFresh } = await supabaseCheck
          .from("competitor_prices")
          .select("*")
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId)
          .gte("fetched_at", freshCutoff)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (cachedFresh) {
          console.log("[ebay-competitor-search] Returning fresh cached result from", cachedFresh.fetched_at);
          return new Response(
            JSON.stringify({
              searchQuery:         cachedFresh.search_query,
              avgPrice:            cachedFresh.avg_price,
              minPrice:            cachedFresh.min_price,
              maxPrice:            cachedFresh.max_price,
              medianPrice:         cachedFresh.median_price,
              priceDelta:          cachedFresh.price_delta,
              competitorCount:     cachedFresh.competitor_count,
              priceDistribution:   cachedFresh.price_distribution ?? [],
              noData:              false,
              fromCache:           true,
              cacheAge:            Math.round((Date.now() - new Date(cachedFresh.fetched_at).getTime()) / 1000),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("[ebay-competitor-search] No fresh cache found, fetching from eBay...");
      } catch (cacheErr) {
        console.warn("[ebay-competitor-search] Cache check failed, proceeding to eBay:", cacheErr);
      }
    }

    // ── Get OAuth app token ───────────────────────────────────────────────────
    console.log("[ebay-competitor-search] Getting eBay OAuth app token...");
    let token: string;
    try {
      token = await getEbayAppToken(ebayEnv);
      console.log("[ebay-competitor-search] OAuth token obtained successfully");
    } catch (tokenErr) {
      const msg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      console.error("[ebay-competitor-search] Failed to get OAuth token:", msg);
      return new Response(
        JSON.stringify({ error: `eBay authentication failed: ${msg}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Derive search query and fetch from eBay Browse API ───────────────────
    console.log("[ebay-competitor-search] Deriving search query...");
    const searchQuery = deriveSearchQuery(title);
    console.log("[ebay-competitor-search] Search query:", searchQuery);

    console.log("[ebay-competitor-search] Fetching eBay competitors via Browse API...");
    const { prices, count } = await fetchEbayCompetitors({
      token,
      searchQuery,
      categoryId,
      ebayEnv,
    });
    console.log("[ebay-competitor-search] Fetched", prices.length, "prices from", count, "competitors");

    if (prices.length === 0) {
      console.log("[ebay-competitor-search] No prices found, returning empty response");
      return new Response(
        JSON.stringify({
          searchQuery,
          avgPrice:          null,
          minPrice:          null,
          maxPrice:          null,
          medianPrice:       null,
          priceDelta:        null,
          competitorCount:   0,
          priceDistribution: [],
          noData:            true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Computing statistics...");
    const avgPrice         = prices.reduce((s, p) => s + p, 0) / prices.length;
    const minPrice         = Math.min(...prices);
    const maxPrice         = Math.max(...prices);
    const medianPrice      = median(prices);
    const priceDelta       = yourPrice != null ? Math.round((yourPrice - avgPrice) * 100) / 100 : null;
    const priceDistribution = buildDistribution(prices);

    console.log("[ebay-competitor-search] Stats: avg=$" + avgPrice.toFixed(2) + ", median=$" + medianPrice.toFixed(2));

    // ── Persist to competitor_prices table ───────────────────────────────────
    if (userId && listingId) {
      console.log("[ebay-competitor-search] Persisting to database...");
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );

        await supabase
          .from("competitor_prices")
          .upsert({
            user_id:            userId,
            ebay_listing_id:    listingId,
            search_query:       searchQuery,
            avg_price:          Math.round(avgPrice * 100) / 100,
            min_price:          minPrice,
            max_price:          maxPrice,
            median_price:       Math.round(medianPrice * 100) / 100,
            price_delta:        priceDelta,
            your_price:         yourPrice ?? null,
            competitor_count:   count,
            price_distribution: priceDistribution,
          });

        console.log(`[ebay-competitor-search] Saved snapshot for listing ${listingId}: avg=$${avgPrice.toFixed(2)}, n=${count}`);
      } catch (dbErr) {
        // Non-fatal — still return data to caller
        console.warn("[ebay-competitor-search] Failed to persist snapshot:", dbErr);
      }
    } else {
      console.log("[ebay-competitor-search] Skipping database persistence (no userId or listingId)");
    }

    console.log("[ebay-competitor-search] Returning response...");
    return new Response(
      JSON.stringify({
        searchQuery,
        avgPrice:          Math.round(avgPrice * 100) / 100,
        minPrice,
        maxPrice,
        medianPrice:       Math.round(medianPrice * 100) / 100,
        priceDelta,
        competitorCount:   count,
        priceDistribution,
        noData:            false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const msg   = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "no stack";
    console.error("[ebay-competitor-search] *** OUTER ERROR HANDLER ***", {
      message:   msg,
      errorType: err?.constructor?.name,
      stack:     stack,
    });

    // Rate limit fallback — return stale cache if available
    if ((msg.includes("rate limit") || msg.includes("exceeded") || msg.includes("429")) && userId && listingId) {
      try {
        console.log("[ebay-competitor-search] API error, attempting stale cache fallback...");
        const supabaseCache = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );

        const { data: staleCached } = await supabaseCache
          .from("competitor_prices")
          .select("*")
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (staleCached) {
          const cacheAgeHours = Math.round((Date.now() - new Date(staleCached.fetched_at).getTime()) / (60 * 60 * 1000));
          console.log("[ebay-competitor-search] Returning stale cache from", staleCached.fetched_at);
          return new Response(
            JSON.stringify({
              searchQuery:       staleCached.search_query,
              avgPrice:          staleCached.avg_price,
              minPrice:          staleCached.min_price,
              maxPrice:          staleCached.max_price,
              medianPrice:       staleCached.median_price,
              priceDelta:        staleCached.price_delta,
              competitorCount:   staleCached.competitor_count,
              priceDistribution: staleCached.price_distribution ?? [],
              noData:            false,
              fromCache:         true,
              stale:             true,
              cacheAgeHours,
              warning:           `eBay API temporarily unavailable. Showing data from ${cacheAgeHours}h ago.`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (fallbackErr) {
        console.warn("[ebay-competitor-search] Stale cache fallback failed:", fallbackErr);
      }
    }

    return new Response(
      JSON.stringify({
        error:     msg,
        errorType: err?.constructor?.name,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

console.log("[ebay-competitor-search] *** FUNCTION READY ***");