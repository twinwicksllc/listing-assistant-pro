import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// Cache TTL — 8 hours. Balances freshness vs. API call volume.
// The cron job also uses this constant to decide whether to skip
// a listing (if its cache is younger than CACHE_TTL_MS, skip it).
// ----------------------------------------------------------------
const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours in milliseconds

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
): Promise<string | null> {
  const label = "[ebay-competitor-search][Gemini]";

  const prompt = `You are an eBay search specialist. Given a listing title, produce the shortest, most effective eBay keyword search string (≤8 words) to find comparable active listings.

Rules:
- Keep: brand, model, year, mint mark, grade, size, color, key identifiers
- Remove: marketing adjectives (beautiful, stunning, rare, vintage, antique, original, authentic), condition words (used, new, mint), lot/set/collection qualifiers
- Do NOT add words not implied by the title
- Return ONLY the keyword string — no explanation, no quotes, no punctuation

Title: "${title.slice(0, 200)}"${categoryId ? `\neBay Category ID: ${categoryId}` : ""}

eBay search keywords:`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let resp: Response;
    try {
      resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      console.warn(`${label} Gemini API ${resp.status} — falling back to heuristic`);
      return null;
    }

    const data = await resp.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text || text.length < 3) {
      console.warn(`${label} Empty response — falling back to heuristic`);
      return null;
    }

    // Sanitise: strip any accidental quotes/punctuation Gemini may add
    const cleaned = text
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[^\w\s\-\.]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    console.log(`${label} Query for "${title.slice(0, 60)}…" → "${cleaned}"`);
    return cleaned || null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`${label} Timed out after 5s — falling back to heuristic`);
    } else {
      console.warn(`${label} Error: ${String(err)} — falling back to heuristic`);
    }
    return null;
  }
}

// ----------------------------------------------------------------
// Get an eBay OAuth app token via client_credentials grant.
// Uses EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (same as keyword-research).
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

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to get eBay OAuth token: ${resp.status} — ${body.slice(0, 200)}`);
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
}): Promise<{ prices: number[]; count: number; raw: unknown[] }> {
  const { token, searchQuery, categoryId, ebayEnv } = params;

  const apiBase = ebayEnv === "production"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q:      searchQuery,
    limit:  "50",
    sort:   "price",
    filter: "buyingOptions:{FIXED_PRICE}",
  });

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(`[ebay-competitor-search] Browse API search: "${searchQuery}" (category: ${categoryId ?? "any"})`);

  let resp: Response | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "Accept": "application/json",
        },
      });

      if (resp.ok || resp.status < 500) break;

      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(`[ebay-competitor-search] Browse API returned ${resp.status} — retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (fetchErr) {
      if (attempt < 2) {
        const delayMs = 1500 * Math.pow(1.5, attempt);
        console.warn(`[ebay-competitor-search] Fetch error (attempt ${attempt + 1}/3) — retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  if (!resp || !resp.ok) {
    const errBody = await resp?.text?.().catch(() => "(could not read body)") ?? "(no response)";
    console.error(`[ebay-competitor-search] Browse API failed: ${resp?.status} — ${errBody.slice(0, 300)}`);
    throw new Error(`eBay Browse API error: ${resp?.status ?? "unknown"} — ${errBody.slice(0, 200)}`);
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

  console.log(
    `[ebay-competitor-search] Found ${prices.length} priced items out of ${items.length} Browse API results`
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
  });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Track these for stale-cache fallback in error handler
  let userId: string | undefined;
  let listingId: string | undefined;

  try {
    let body: any;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body", detail: String(parseErr) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { title, categoryId, yourPrice } = body;
    listingId = body.listingId;
    userId    = body.userId;

    if (!title) {
      return new Response(
        JSON.stringify({ error: "title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ebay-competitor-search] Loading environment variables...");
    // Default to "production" — sandbox has its own separate (tiny) quota
    const ebayEnv   = Deno.env.get("EBAY_ENVIRONMENT") || "production";
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    console.log("[ebay-competitor-search] ebayEnv:", ebayEnv, "geminiKey exists:", !!geminiKey);

    // ------------------------------------------------------------------
    // Supabase client (used for cache read + write)
    // ------------------------------------------------------------------
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

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
          const cacheAgeMs   = Date.now() - new Date(cachedFresh.fetched_at).getTime();
          const cacheAgeMins = Math.round(cacheAgeMs / 60000);
          const cacheExpiresAt = new Date(
            new Date(cachedFresh.fetched_at).getTime() + CACHE_TTL_MS
          ).toISOString();
          console.log(`[ebay-competitor-search] Cache hit (${cacheAgeMins}min old) — returning cached data`);
          return new Response(
            JSON.stringify({
              searchQuery:       cachedFresh.gemini_search_query ?? cachedFresh.search_query,
              avgPrice:          cachedFresh.avg_price,
              minPrice:          cachedFresh.min_price,
              maxPrice:          cachedFresh.max_price,
              medianPrice:       cachedFresh.median_price,
              priceDelta:        cachedFresh.price_delta,
              competitorCount:   cachedFresh.competitor_count,
              priceDistribution: cachedFresh.price_distribution ?? [],
              noData:            false,
              fromCache:         true,
              cacheAgeMins,
              cacheExpiresAt,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log("[ebay-competitor-search] Cache miss / stale — fetching live data from eBay...");
      } catch (cacheErr) {
        console.warn("[ebay-competitor-search] Cache check failed, proceeding to eBay:", cacheErr);
      }
    }

    // ------------------------------------------------------------------
    // Step 1 — Generate optimised search query via Gemini Flash
    // Falls back to heuristic if Gemini is unavailable / times out.
    // ------------------------------------------------------------------
    let geminiQuery: string | null = null;
    if (geminiKey) {
      geminiQuery = await geminiSearchQuery(geminiKey, title, categoryId);
    } else {
      console.log("[ebay-competitor-search] No GEMINI_API_KEY — skipping Gemini query optimisation");
    }

    const searchQuery = geminiQuery ?? deriveSearchQueryFallback(title);
    const usedGemini  = !!geminiQuery;
    console.log(`[ebay-competitor-search] Search query (${usedGemini ? "Gemini" : "heuristic"}): "${searchQuery}"`);

    // ------------------------------------------------------------------
    // Step 2 — Get eBay OAuth token
    // ------------------------------------------------------------------
    let token: string;
    try {
      token = await getEbayAppToken(ebayEnv);
    } catch (tokenErr) {
      console.error("[ebay-competitor-search] Failed to get eBay OAuth token:", tokenErr);
      return new Response(
        JSON.stringify({ error: String(tokenErr) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ------------------------------------------------------------------
    // Step 3 — Fetch from eBay Browse API
    // ------------------------------------------------------------------
    const { prices, count } = await fetchEbayCompetitors({
      token,
      searchQuery,
      categoryId,
      ebayEnv,
    });

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

    // ------------------------------------------------------------------
    // Step 4 — Compute statistics
    // ------------------------------------------------------------------
    const avgPrice          = prices.reduce((s, p) => s + p, 0) / prices.length;
    const minPrice          = Math.min(...prices);
    const maxPrice          = Math.max(...prices);
    const medianPrice       = median(prices);
    const priceDelta        = yourPrice != null ? Math.round((yourPrice - avgPrice) * 100) / 100 : null;
    const priceDistribution = buildDistribution(prices);

    console.log(`[ebay-competitor-search] Stats: avg=$${avgPrice.toFixed(2)}, median=$${medianPrice.toFixed(2)}, n=${count}`);

    // ------------------------------------------------------------------
    // Step 5 — Persist to competitor_prices (upsert)
    // ------------------------------------------------------------------
    if (userId && listingId) {
      try {
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

        await supabase
          .from("competitor_prices")
          .upsert({
            user_id:             userId,
            ebay_listing_id:     listingId,
            search_query:        searchQuery,
            gemini_search_query: geminiQuery ?? null,
            avg_price:           Math.round(avgPrice * 100) / 100,
            min_price:           minPrice,
            max_price:           maxPrice,
            median_price:        Math.round(medianPrice * 100) / 100,
            price_delta:         priceDelta,
            your_price:          yourPrice ?? null,
            competitor_count:    count,
            price_distribution:  priceDistribution,
            expires_at:          expiresAt,
          }, { onConflict: "user_id,ebay_listing_id" });

        console.log(`[ebay-competitor-search] Saved snapshot for listing ${listingId}: avg=$${avgPrice.toFixed(2)}, n=${count}`);
      } catch (dbErr) {
        // Non-fatal — still return data to caller
        console.warn("[ebay-competitor-search] Failed to persist snapshot:", dbErr);
      }
    }

    const cacheExpiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

    return new Response(
      JSON.stringify({
        searchQuery,
        geminiSearchQuery:  geminiQuery,
        avgPrice:           Math.round(avgPrice * 100) / 100,
        minPrice,
        maxPrice,
        medianPrice:        Math.round(medianPrice * 100) / 100,
        priceDelta,
        competitorCount:    count,
        priceDistribution,
        noData:             false,
        fromCache:          false,
        cacheExpiresAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const msg   = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack    : "no stack";
    console.error("[ebay-competitor-search] *** OUTER ERROR HANDLER ***", { message: msg, stack });

    // Graceful degradation — serve stale cache if we have any
    if (userId && listingId) {
      try {
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
          const cacheAgeHours = Math.round(
            (Date.now() - new Date(staleCached.fetched_at).getTime()) / (60 * 60 * 1000)
          );
          console.log(`[ebay-competitor-search] Returning stale cache (${cacheAgeHours}h old) as fallback`);
          return new Response(
            JSON.stringify({
              searchQuery:       staleCached.gemini_search_query ?? staleCached.search_query,
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
              warning:           `eBay API error. Showing data from ${cacheAgeHours}h ago.`,
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