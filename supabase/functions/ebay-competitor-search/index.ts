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

  const resp = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (!resp.ok) {
    throw new Error(`eBay Finding API error: ${resp.status} ${await resp.text()}`);
  }

  const json = await resp.json();

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
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { listingId, title, categoryId, yourPrice, userId } = body;

    if (!title) {
      return new Response(
        JSON.stringify({ error: "title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const appId = Deno.env.get("EBAY_CLIENT_ID");

    if (!appId) {
      return new Response(
        JSON.stringify({ error: "EBAY_CLIENT_ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchQuery = deriveSearchQuery(title);

    const { prices, count } = await fetchEbayCompetitors({
      appId,
      searchQuery,
      categoryId,
      ebayEnv,
    });

    if (prices.length === 0) {
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

    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const medianPrice = median(prices);
    const priceDelta =
      yourPrice != null ? Math.round((yourPrice - avgPrice) * 100) / 100 : null;
    const priceDistribution = buildDistribution(prices);

    // Persist to competitor_prices table if we have the context
    if (userId && listingId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false } }
        );

        // Upsert by user_id + ebay_listing_id — replace stale snapshot
        // Delete any existing rows for this listing first (simplest upsert strategy)
        await supabase
          .from("competitor_prices")
          .delete()
          .eq("user_id", userId)
          .eq("ebay_listing_id", listingId);

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
    }

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
    console.error("[ebay-competitor-search] error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
