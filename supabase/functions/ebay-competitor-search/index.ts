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

  // If all prices are the same, return a single bucket
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
  // Remove common filler/noise words for coins & collectibles
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

  // Take up to 6 tokens to keep search focused
  return tokens.slice(0, 6).join(" ");
}

// ----------------------------------------------------------------
// Fetch competitor listings from eBay Finding API (product search).
// Uses the findItemsByKeywords endpoint which requires only an App ID
// (not a user token), making it safe to run server-side without OAuth.
// ----------------------------------------------------------------
async function fetchEbayCompetitors(params: {
  appId: string;
  searchQuery: string;
  categoryId?: string;
  ebayEnv: string;
}): Promise<{
  prices: number[];
  count: number;
  raw: unknown[];
}> {
  const { appId, searchQuery, categoryId, ebayEnv } = params;

  const baseUrl =
    ebayEnv === "production"
      ? "https://svcs.ebay.com/services/search/FindingService/v1"
      : "https://svcs.sandbox.ebay.com/services/search/FindingService/v1";

  const queryParams = new URLSearchParams({
    "OPERATION-NAME": "findItemsByKeywords",
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "keywords": searchQuery,
    "itemFilter(0).name": "ListingType",
    "itemFilter(0).value": "FixedPrice",
    "itemFilter(1).name": "Condition",
    "itemFilter(1).value(0)": "1000", // New
    "itemFilter(1).value(1)": "2000", // Certified refurbished
    "itemFilter(1).value(2)": "2500", // Seller refurbished
    "itemFilter(1).value(3)": "3000", // Pre-owned good
    "paginationInput.entriesPerPage": "50",
    "paginationInput.pageNumber": "1",
    "sortOrder": "BestMatch",
  });

  if (categoryId) {
    queryParams.set("categoryId", categoryId);
  }

  const url = `${baseUrl}?${queryParams.toString()}`;
  console.log(`[ebay-competitor-search] Searching: "${searchQuery}" (category: ${categoryId ?? "any"})`);

  // Retry on 5xx server errors with exponential backoff (up to 3 attempts)
  // Rate limit errors (429/500 with RateLimiter) get longer delays
  let resp: Response | null = null;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (resp.ok || (resp.status < 500)) break; // success or client error — don't retry on client errors

      // 5xx error — check if it's a rate limit
      const respText = await resp!.text();
      const isRateLimited = respText.includes("RateLimiter") || respText.includes("exceeded");
      
      if (attempt < 2) {
        // Exponential backoff: 2s for first retry, 4s for second
        const delayMs = isRateLimited ? (2000 * Math.pow(2, attempt)) : (1500 * Math.pow(1.5, attempt));
        console.warn(
          `[ebay-competitor-search] eBay returned ${resp!.status}${isRateLimited ? " (rate limited)" : ""} — retrying in ${delayMs}ms`
        );
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
    const isRateLimited = errBody.includes("RateLimiter") || errBody.includes("exceeded");
    
    if (isRateLimited) {
      console.error(`[ebay-competitor-search] eBay rate limit exceeded (10001)`);
      throw new Error(`eBay API rate limit exceeded. Please try again in a few minutes.`);
    }
    
    throw new Error(`eBay Finding API error: ${resp?.status ?? "unknown"} ${errBody}`);
  }

  // Safe JSON parsing — guard against truncated responses
  const respText = await resp.text();
  let json: any;
  try {
    json = JSON.parse(respText);
  } catch (parseErr) {
    console.error(`[ebay-competitor-search] JSON parse failed (body length=${respText.length}):`, respText.slice(0, 300));
    throw new Error(`eBay Finding API returned invalid JSON (length=${respText.length})`);
  }

  // Navigate eBay's deeply nested Finding API response structure
  const searchResult =
    json?.findItemsByKeywordsResponse?.[0]?.searchResult?.[0];

  if (!searchResult || searchResult["@count"] === "0") {
    console.log(`[ebay-competitor-search] No results for "${searchQuery}"`);
    return { prices: [], count: 0, raw: [] };
  }

  const items: unknown[] = searchResult.item ?? [];
  const prices: number[] = [];

  for (const item of items) {
    try {
      const itemRecord = item as Record<string, Record<string, unknown>[]>;
      const sellingStatus = itemRecord?.sellingStatus;
      const priceStr =
        sellingStatus?.[0]?.currentPrice &&
        (sellingStatus[0].currentPrice as Record<string, string>[])?.[0]?.__value__;
      const price = parseFloat(priceStr as string);
      if (!isNaN(price) && price > 0) {
        prices.push(price);
      }
    } catch {
      // Skip malformed items
    }
  }

  console.log(
    `[ebay-competitor-search] Found ${prices.length} priced items out of ${items.length} results`
  );

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
    let body;
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
    userId = body.userId;

    console.log("[ebay-competitor-search] Validation step - checking title...");
    if (!title) {
      console.error("[ebay-competitor-search] Missing title");
      return new Response(
        JSON.stringify({ error: "title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Loading environment variables...");
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const appId = Deno.env.get("EBAY_CLIENT_ID");
    console.log("[ebay-competitor-search] ebayEnv:", ebayEnv, "appId exists:", !!appId);

    if (!appId) {
      console.error("[ebay-competitor-search] EBAY_CLIENT_ID not configured");
      return new Response(
        JSON.stringify({ error: "EBAY_CLIENT_ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check database cache before hitting eBay API
    // Primary cache: 23 hours (fresh data)
    // Fallback cache: Any data available (used during rate limits as graceful degradation)
    if (userId && listingId) {
      try {
        const supabaseCheck = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );
        
        // Try fresh cache first (23 hours)
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
              searchQuery: cachedFresh.search_query,
              avgPrice: cachedFresh.avg_price,
              minPrice: cachedFresh.min_price,
              maxPrice: cachedFresh.max_price,
              medianPrice: cachedFresh.median_price,
              priceDelta: cachedFresh.price_delta,
              competitorCount: cachedFresh.competitor_count,
              priceDistribution: cachedFresh.price_distribution ?? [],
              noData: false,
              fromCache: true,
              cacheAge: Math.round((Date.now() - new Date(cachedFresh.fetched_at).getTime()) / 1000),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        console.log("[ebay-competitor-search] No fresh cache found, fetching from eBay...");
      } catch (cacheErr) {
        console.warn("[ebay-competitor-search] Cache check failed, proceeding to eBay:", cacheErr);
      }
    }

    console.log("[ebay-competitor-search] Deriving search query...");
    const searchQuery = deriveSearchQuery(title);
    console.log("[ebay-competitor-search] Search query:", searchQuery);

    console.log("[ebay-competitor-search] Fetching eBay competitors...");
    const { prices, count } = await fetchEbayCompetitors({
      appId,
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
          avgPrice: null,
          minPrice: null,
          maxPrice: null,
          medianPrice: null,
          priceDelta: null,
          competitorCount: 0,
          priceDistribution: [],
          noData: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Computing statistics...");
    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const medianPrice = median(prices);
    const priceDelta =
      yourPrice != null ? Math.round((yourPrice - avgPrice) * 100) / 100 : null;
    const priceDistribution = buildDistribution(prices);

    console.log("[ebay-competitor-search] Stats: avg=$" + avgPrice.toFixed(2) + ", median=$" + medianPrice.toFixed(2));

    // Persist to competitor_prices table if we have the context
    if (userId && listingId) {
      console.log("[ebay-competitor-search] Persisting to database...");
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );

        console.log("[ebay-competitor-search] Deleting existing records...");
        // Upsert by user_id + ebay_listing_id — replace stale snapshot
        // Delete any existing rows for this listing first (simplest upsert strategy)
        await supabase
          .from("competitor_prices")
          .delete()
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId);

        console.log("[ebay-competitor-search] Inserting new record...");
        await supabase.from("competitor_prices").insert({
          user_id: userId,
          ebay_listing_id: listingId,
          search_query: searchQuery,
          avg_price: Math.round(avgPrice * 100) / 100,
          min_price: minPrice,
          max_price: maxPrice,
          median_price: Math.round(medianPrice * 100) / 100,
          price_delta: priceDelta,
          your_price: yourPrice ?? null,
          competitor_count: count,
          price_distribution: priceDistribution,
        });

        console.log(
          `[ebay-competitor-search] Saved snapshot for listing ${listingId}: avg=$${avgPrice.toFixed(2)}, n=${count}`
        );
      } catch (dbErr) {
        // Non-fatal — still return the data to the caller
        console.warn("[ebay-competitor-search] Failed to persist snapshot:", dbErr);
      }
    } else {
      console.log("[ebay-competitor-search] Skipping database persistence (no userId or listingId)");
    }

    console.log("[ebay-competitor-search] Returning response...");
    return new Response(
      JSON.stringify({
        searchQuery,
        avgPrice: Math.round(avgPrice * 100) / 100,
        minPrice,
        maxPrice,
        medianPrice: Math.round(medianPrice * 100) / 100,
        priceDelta,
        competitorCount: count,
        priceDistribution,
        noData: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "no stack";
    console.error("[ebay-competitor-search] *** OUTER ERROR HANDLER ***", {
      message: msg,
      errorType: err?.constructor?.name,
      stack: stack,
    });
    
    // If rate limit error, try to return stale cache as graceful degradation
    if ((msg.includes("rate limit") || msg.includes("exceeded")) && userId && listingId) {
      try {
        console.log("[ebay-competitor-search] Rate limit hit, attempting to return ANY cached data...");
        const supabaseCache = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );
        
        // Get ANY cache for this listing (no TTL restriction)
        const { data: staleCached } = await supabaseCache
          .from("competitor_prices")
          .select("*")
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (staleCached) {
          console.log("[ebay-competitor-search] Found stale cache from", staleCached.fetched_at, "— returning as fallback");
          const cacheAgeHours = Math.round((Date.now() - new Date(staleCached.fetched_at).getTime()) / (60 * 60 * 1000));
          return new Response(
            JSON.stringify({
              searchQuery: staleCached.search_query,
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
              warning: `eBay API rate limit reached. Showing data from ${cacheAgeHours}h ago.`,
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
        error: msg,
        errorType: err?.constructor?.name,
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Add a final log after serve is set up
console.log("[ebay-competitor-search] *** FUNCTION READY ***");
