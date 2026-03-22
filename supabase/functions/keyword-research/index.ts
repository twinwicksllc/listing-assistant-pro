import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TopItem {
  title: string;
  price: number;
  imageUrl: string | null;
  itemUrl: string | null;
  condition: string;
}

interface BrowseSearchResult {
  prices: number[];
  count: number;
  topItems: TopItem[];
}

// ----------------------------------------------------------------
// Get OAuth App Token for Browse API (same as ebay-pricing)
// ----------------------------------------------------------------
async function getEbayAppToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("eBay API credentials not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
  const tokenUrl =
    ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  console.log(`[keyword-research] Fetching OAuth token from ${tokenUrl}`);

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`[keyword-research] Token error: ${resp.status} - ${txt}`);
    throw new Error(`Failed to get eBay token: ${resp.status}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ----------------------------------------------------------------
// Search using Browse API (browse.search, not Finding API)
// ----------------------------------------------------------------
async function browseSearch(params: {
  query: string;
  token: string;
  ebayEnv: string;
  categoryId?: string | null;
  limit?: number;
  soldFilter?: string; // "sold" for sold items, undefined for active
}): Promise<BrowseSearchResult> {
  const { query, token, ebayEnv, categoryId, limit = 50, soldFilter } = params;

  const apiBase =
    ebayEnv === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 50)),
    sort: soldFilter ? "-date" : "-price",
  });

  if (soldFilter) {
    searchParams.set("filter", soldFilter);
  }

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(`[keyword-research] Browse API search: "${query}" (sold=${!!soldFilter})`);

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`[keyword-research] Browse API error ${resp.status}: ${txt.slice(0, 200)}`);
    return { prices: [], count: 0, topItems: [] };
  }

  const json = await resp.json();
  const items = json?.itemSummaries ?? [];

  if (!items || items.length === 0) {
    console.log(`[keyword-research] No items found for "${query}"`);
    return { prices: [], count: 0, topItems: [] };
  }

  const prices: number[] = [];
  const topItems: TopItem[] = [];

  for (const item of items) {
    try {
      const price = parseFloat(item?.price?.value ?? "0");
      if (!isNaN(price) && price > 0) {
        prices.push(price);

        if (topItems.length < 5) {
          topItems.push({
            title: item.title ?? "Unknown",
            price,
            imageUrl: item.image?.imageUrl ?? null,
            itemUrl: item.itemWebUrl ?? null,
            condition: item.condition ?? "Unknown",
          });
        }
      }
    } catch { /* skip malformed */ }
  }

  console.log(`[keyword-research] Got ${prices.length} items for "${query}"`);
  return { prices, count: prices.length, topItems };
}

// ----------------------------------------------------------------
// Search sold items using Browse API with sold filter
// Note: Browse API doesn't have a direct "sold" search like Finding API,
// so we search without filter and estimate based on pricing patterns.
// For actual sold data, we'd need the Finding API or Marketplace Insights API.
// ----------------------------------------------------------------
async function searchSoldItems(params: {
  query: string;
  token: string;
  ebayEnv: string;
  categoryId?: string | null;
}): Promise<BrowseSearchResult> {
  // Browse API doesn't have a native "sold items" endpoint for anonymous search
  // The Finding API has findCompletedItems but we're hitting rate limits
  // 
  // Alternative: Use the same Browse API search but filter by ended listings
  // For now, we'll return empty sold data and focus on active listings
  // which is what the Browse API provides reliably

  console.log(`[keyword-research] Sold items search via Browse API not available; returning active listing data only`);
  
  // We can approximate sold behavior by searching again with different sort
  // but for now, return empty to avoid confusion
  return { prices: [], count: 0, topItems: [] };
}

// ----------------------------------------------------------------
// Stats helpers
// ----------------------------------------------------------------
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// In-memory cache (4 hours)
const cache = new Map<string, { data: unknown; expiresAt: number }>();

// ----------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { query, categoryId } = body as { query: string; categoryId?: string };

    if (!query || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "query must be at least 2 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cacheKey = `${query.toLowerCase()}|${categoryId ?? ""}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      console.log(`[keyword-research] Cache hit for "${query}"`);
      return new Response(
        JSON.stringify({ ...cached.data, fromCache: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    console.log(`[keyword-research] Fetching market data for: "${query}" (env: ${ebayEnv})`);

    // Get OAuth token for Browse API
    const token = await getEbayAppToken();
    console.log(`[keyword-research] Obtained OAuth token`);

    // Search active listings using Browse API
    const activeResult = await browseSearch({
      query,
      token,
      ebayEnv,
      categoryId,
      limit: 50,
    });

    // Note: Browse API doesn't support sold items search directly
    // We'll set sold count to 0 for now and show only active competitor data
    const soldCount = 0;
    const activeCount = activeResult.count;
    const total = activeCount + soldCount;

    // Calculate sell-through rate placeholder
    // Without sold data, we can't calculate real STR
    const sellThroughRate = 0;

    // Active price stats
    const activePrices = activeResult.prices.sort((a, b) => a - b);
    const avgActivePrice =
      activePrices.length > 0
        ? round2(activePrices.reduce((s, p) => s + p, 0) / activePrices.length)
        : null;
    const minActivePrice = activePrices.length > 0 ? activePrices[0] : null;
    const maxActivePrice = activePrices.length > 0 ? activePrices[activePrices.length - 1] : null;
    const medianActivePrice = activePrices.length > 0 ? round2(median(activePrices)) : null;
    const p25ActivePrice = activePrices.length > 0 ? round2(percentile(activePrices, 25)) : null;
    const p75ActivePrice = activePrices.length > 0 ? round2(percentile(activePrices, 75)) : null;

    // Competition level (based on active count)
    let competitionLevel: "low" | "medium" | "high" = "low";
    if (activeCount > 100) competitionLevel = "high";
    else if (activeCount > 30) competitionLevel = "medium";

    // Demand signal: without sold data, we can't determine this accurately
    // Default to moderate
    const demandSignal: "weak" | "moderate" | "strong" = "moderate";

    const responseData = {
      query,
      categoryId: categoryId ?? null,
      // Sold stats (unavailable via Browse API)
      soldCount,
      avgSoldPrice: null,
      medianSoldPrice: null,
      minSoldPrice: null,
      maxSoldPrice: null,
      p25SoldPrice: null,
      p75SoldPrice: null,
      // Active stats
      activeCount,
      avgActivePrice,
      medianActivePrice,
      minActivePrice,
      maxActivePrice,
      p25ActivePrice,
      p75ActivePrice,
      // Market signals
      sellThroughRate,
      competitionLevel,
      demandSignal,
      // Top items
      topCompetitors: activeResult.topItems,
      topSold: [],
      // Meta
      noData: total === 0,
      fromCache: false,
      dataSource: "browse_api", // Indicate we're using Browse API, not Finding API
    };

    // Cache for 4 hours
    cache.set(cacheKey, {
      data: responseData,
      expiresAt: now + 4 * 60 * 60 * 1000,
    });

    console.log(
      `[keyword-research] Done: active=${activeCount}, competition=${competitionLevel}`
    );

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[keyword-research] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});