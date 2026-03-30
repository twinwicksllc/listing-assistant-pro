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
  total: number; // total matching items (from API, not just page)
  topItems: TopItem[];
}

interface SoldDataResult {
  soldCount: number;
  avgSoldPrice: number | null;
  minSoldPrice: number | null;
  maxSoldPrice: number | null;
  medianSoldPrice: number | null;
}

// ----------------------------------------------------------------
// Get OAuth App Token for Browse API
// ----------------------------------------------------------------
async function getEbayAppToken(): Promise<string> {
  const clientId = Deno.env.get("EBAY_CLIENT_ID");
  const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("eBay API credentials not configured");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
  const tokenUrl = ebayEnv === "production"
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

  let data: any;
  try {
    const respText = await resp.text();
    data = JSON.parse(respText);
  } catch {
    throw new Error(`Failed to parse eBay token response`);
  }
  return data.access_token;
}

// ----------------------------------------------------------------
// Search active listings using Browse API
// ----------------------------------------------------------------
async function browseSearch(params: {
  query: string;
  token: string;
  ebayEnv: string;
  categoryId?: string | null;
  limit?: number;
}): Promise<BrowseSearchResult> {
  const { query, token, ebayEnv, categoryId, limit = 50 } = params;

  const apiBase = ebayEnv === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 50)),
    sort: "-price",
  });

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(`[keyword-research] Browse API search: "${query}"`);

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
    console.error(
      `[keyword-research] Browse API error ${resp.status}: ${txt.slice(0, 200)}`,
    );
    return { prices: [], count: 0, total: 0, topItems: [] };
  }

  let json: any;
  try {
    const respText = await resp.text();
    json = JSON.parse(respText);
  } catch {
    console.error(`[keyword-research] Browse API JSON parse error`);
    return { prices: [], count: 0, total: 0, topItems: [] };
  }
  const items = json?.itemSummaries ?? [];
  // `total` is the overall count across all pages, not just this page
  const total = json?.total ?? items.length;

  if (!items || items.length === 0) {
    console.log(`[keyword-research] No items found for "${query}"`);
    return { prices: [], count: 0, total: 0, topItems: [] };
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

  console.log(
    `[keyword-research] Got ${prices.length} items (total=${total}) for "${query}"`,
  );
  return { prices, count: prices.length, total, topItems };
}

// ----------------------------------------------------------------
// Scrape eBay sold/completed listings via Jina reader
// Returns sold count and price range estimates from filter sidebar
// This bypasses eBay's bot detection and doesn't require API access
// ----------------------------------------------------------------
async function scrapeEbaySoldData(
  query: string,
  categoryId?: string | null,
): Promise<SoldDataResult> {
  const encoded = encodeURIComponent(query);
  let ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1&_ipg=50&_sop=13`;
  if (categoryId) {
    ebayUrl += `&_sacat=${categoryId}`;
  }

  const jinaUrl = `https://r.jina.ai/${ebayUrl}`;
  console.log(`[keyword-research] Fetching sold data via Jina for: "${query}"`);

  let content = "";
  try {
    const resp = await fetch(jinaUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ListingAssistant/1.0)",
        "Accept": "text/plain",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      console.warn(`[keyword-research] Jina fetch failed: ${resp.status}`);
      return {
        soldCount: 0,
        avgSoldPrice: null,
        minSoldPrice: null,
        maxSoldPrice: null,
        medianSoldPrice: null,
      };
    }
    content = await resp.text();
  } catch (e) {
    console.warn(`[keyword-research] Jina fetch error: ${e}`);
    return {
      soldCount: 0,
      avgSoldPrice: null,
      minSoldPrice: null,
      maxSoldPrice: null,
      medianSoldPrice: null,
    };
  }

  // Extract sold count from "All Listings (X) Filter Applied" in sidebar
  const allListingsMatch = content.match(
    /All Listings \(([\d,]+)\)\s+Filter Applied/,
  );
  let soldCount = allListingsMatch ? parseInt(allListingsMatch[1].replace(/,/g, ""), 10) : 0;

  // Fallback: "X results for" or "X+ results for"
  if (!soldCount) {
    const resultsMatch = content.match(/([\d,]+)\+?\s+results?\s+for/i);
    soldCount = resultsMatch ? parseInt(resultsMatch[1].replace(/,/g, ""), 10) : 0;
  }

  // Extract price range buckets from the filter sidebar
  // These appear as: "Under $XX.XX", "$XX.XX to $YY.YY", "Over $ZZ.ZZ"
  const underMatch = content.match(/Under \$([\d,]+\.?\d*)/);
  const rangeMatch = content.match(/\$([\d,]+\.?\d*) to \$([\d,]+\.?\d*)/);
  const overMatch = content.match(/Over \$([\d,]+\.?\d*)/);

  let avgSoldPrice: number | null = null;
  let minSoldPrice: number | null = null;
  let maxSoldPrice: number | null = null;
  let medianSoldPrice: number | null = null;

  if (underMatch && overMatch) {
    // Three-bucket price range: Under X ... Range ... Over Y
    const lowThreshold = parseFloat(underMatch[1].replace(/,/g, ""));
    const highThreshold = parseFloat(overMatch[1].replace(/,/g, ""));
    // Estimate: min is ~50% of lower bucket threshold, max is ~150% of upper threshold
    minSoldPrice = Math.round(lowThreshold * 0.5 * 100) / 100;
    maxSoldPrice = Math.round(highThreshold * 1.5 * 100) / 100;
    avgSoldPrice = Math.round((lowThreshold + highThreshold) / 2 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
  } else if (rangeMatch) {
    // Only a range bucket visible
    const rLow = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const rHigh = parseFloat(rangeMatch[2].replace(/,/g, ""));
    avgSoldPrice = Math.round((rLow + rHigh) / 2 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = Math.round(rLow * 0.7 * 100) / 100;
    maxSoldPrice = Math.round(rHigh * 1.3 * 100) / 100;
  } else if (underMatch) {
    // Only "Under X" visible
    const threshold = parseFloat(underMatch[1].replace(/,/g, ""));
    avgSoldPrice = Math.round(threshold * 0.6 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = Math.round(threshold * 0.1 * 100) / 100;
    maxSoldPrice = threshold;
  } else if (overMatch) {
    // Only "Over X" visible
    const threshold = parseFloat(overMatch[1].replace(/,/g, ""));
    avgSoldPrice = Math.round(threshold * 1.5 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = threshold;
    maxSoldPrice = Math.round(threshold * 3 * 100) / 100;
  }

  console.log(
    `[keyword-research] Sold data: count=${soldCount}, avg=$${avgSoldPrice}, range=$${minSoldPrice}-$${maxSoldPrice}`,
  );

  return {
    soldCount,
    avgSoldPrice,
    minSoldPrice,
    maxSoldPrice,
    medianSoldPrice,
  };
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
    const { query, categoryId } = body as {
      query: string;
      categoryId?: string;
    };

    if (!query || query.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: "query must be at least 2 characters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cacheKey = `${query.toLowerCase()}|${categoryId ?? ""}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      console.log(`[keyword-research] Cache hit for "${query}"`);
      return new Response(
        JSON.stringify({ ...cached.data, fromCache: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    console.log(
      `[keyword-research] Fetching market data for: "${query}" (env: ${ebayEnv})`,
    );

    // Run both requests in parallel: Browse API (active) + Jina scrape (sold)
    const token = await getEbayAppToken();
    console.log(`[keyword-research] Obtained OAuth token`);

    const [activeResult, soldData] = await Promise.all([
      browseSearch({ query, token, ebayEnv, categoryId, limit: 50 }),
      scrapeEbaySoldData(query, categoryId),
    ]);

    const soldCount = soldData.soldCount;
    // Use Browse API `total` field for the active count (more accurate than page count)
    const activeCount = activeResult.total > 0 ? activeResult.total : activeResult.count;
    const total = soldCount + activeCount;

    // Sell-through rate: sold / (sold + active)
    const sellThroughRate = total > 0 ? round2(soldCount / total) : 0;

    // Demand signal based on STR
    let demandSignal: "weak" | "moderate" | "strong" = "moderate";
    if (sellThroughRate > 0.5) demandSignal = "strong";
    else if (sellThroughRate < 0.2 && total > 10) demandSignal = "weak";

    // Active price stats from Browse API results
    const activePrices = activeResult.prices.sort((a, b) => a - b);
    const avgActivePrice = activePrices.length > 0
      ? round2(activePrices.reduce((s, p) => s + p, 0) / activePrices.length)
      : null;
    const minActivePrice = activePrices.length > 0 ? activePrices[0] : null;
    const maxActivePrice = activePrices.length > 0 ? activePrices[activePrices.length - 1] : null;
    const medianActivePrice = activePrices.length > 0 ? round2(median(activePrices)) : null;
    const p25ActivePrice = activePrices.length > 0 ? round2(percentile(activePrices, 25)) : null;
    const p75ActivePrice = activePrices.length > 0 ? round2(percentile(activePrices, 75)) : null;

    // Competition level (based on active count from API total)
    let competitionLevel: "low" | "medium" | "high" = "low";
    if (activeCount > 200) competitionLevel = "high";
    else if (activeCount > 50) competitionLevel = "medium";

    const responseData = {
      query,
      categoryId: categoryId ?? null,
      // Sold stats (from Jina eBay scrape)
      soldCount,
      avgSoldPrice: soldData.avgSoldPrice,
      medianSoldPrice: soldData.medianSoldPrice,
      minSoldPrice: soldData.minSoldPrice,
      maxSoldPrice: soldData.maxSoldPrice,
      p25SoldPrice: null, // not available from bucket data
      p75SoldPrice: null,
      // Active stats (from Browse API)
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
      topSold: [], // individual sold item details not available without Marketplace Insights API
      // Meta
      noData: total === 0,
      fromCache: false,
      dataSource: "browse_api_plus_jina",
    };

    // Cache for 4 hours
    cache.set(cacheKey, {
      data: responseData,
      expiresAt: now + 4 * 60 * 60 * 1000,
    });

    console.log(
      `[keyword-research] Done: active=${activeCount}, sold=${soldCount}, STR=${sellThroughRate}, competition=${competitionLevel}, demand=${demandSignal}`,
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
