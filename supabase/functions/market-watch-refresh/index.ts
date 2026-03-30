import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    throw new Error(
      `Failed to get eBay token: ${resp.status} - ${txt.slice(0, 100)}`,
    );
  }

  let data: any;
  try {
    const respText = await resp.text();
    data = JSON.parse(respText);
  } catch (e) {
    throw new Error(`Failed to parse eBay token response: ${e}`);
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
}): Promise<{ prices: number[]; count: number; total: number }> {
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

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });

  if (!resp.ok) {
    console.error(`[market-watch-refresh] Browse API error ${resp.status}`);
    return { prices: [], count: 0, total: 0 };
  }

  let json: any;
  try {
    const respText = await resp.text();
    json = JSON.parse(respText);
  } catch (e) {
    console.error(
      `[market-watch-refresh] Failed to parse Browse API response: ${e}`,
    );
    return { prices: [], count: 0, total: 0 };
  }
  const items = json?.itemSummaries ?? [];
  const total = json?.total ?? items.length;

  const prices: number[] = [];
  for (const item of items) {
    try {
      const price = parseFloat(item?.price?.value ?? "0");
      if (!isNaN(price) && price > 0) prices.push(price);
    } catch { /* skip */ }
  }

  return { prices, count: prices.length, total };
}

// ----------------------------------------------------------------
// Scrape eBay sold/completed listings via Jina reader
// Returns sold count and price range estimates from filter sidebar
// ----------------------------------------------------------------
async function scrapeEbaySoldData(
  query: string,
  categoryId?: string | null,
): Promise<{
  soldCount: number;
  avgSoldPrice: number | null;
  minSoldPrice: number | null;
  maxSoldPrice: number | null;
  medianSoldPrice: number | null;
}> {
  const encoded = encodeURIComponent(query);
  let ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Complete=1&LH_Sold=1&_ipg=50&_sop=13`;
  if (categoryId) {
    ebayUrl += `&_sacat=${categoryId}`;
  }

  const jinaUrl = `https://r.jina.ai/${ebayUrl}`;
  console.log(
    `[market-watch-refresh] Fetching sold data via Jina for: "${query}"`,
  );

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
      console.warn(`[market-watch-refresh] Jina fetch failed: ${resp.status}`);
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
    console.warn(`[market-watch-refresh] Jina fetch error: ${e}`);
    return {
      soldCount: 0,
      avgSoldPrice: null,
      minSoldPrice: null,
      maxSoldPrice: null,
      medianSoldPrice: null,
    };
  }

  // Extract sold count from "All Listings (X) Filter Applied"
  const allListingsMatch = content.match(
    /All Listings \(([\d,]+)\)\s+Filter Applied/,
  );
  let soldCount = allListingsMatch ? parseInt(allListingsMatch[1].replace(/,/g, ""), 10) : 0;

  // Fallback: "X results for"
  if (!soldCount) {
    const resultsMatch = content.match(/([\d,]+)\+?\s+results?\s+for/i);
    soldCount = resultsMatch ? parseInt(resultsMatch[1].replace(/,/g, ""), 10) : 0;
  }

  // Extract price range buckets from filter sidebar
  const underMatch = content.match(/Under \$([\d,]+\.?\d*)/);
  const rangeMatch = content.match(/\$([\d,]+\.?\d*) to \$([\d,]+\.?\d*)/);
  const overMatch = content.match(/Over \$([\d,]+\.?\d*)/);

  let avgSoldPrice: number | null = null;
  let minSoldPrice: number | null = null;
  let maxSoldPrice: number | null = null;
  let medianSoldPrice: number | null = null;

  if (underMatch && overMatch) {
    const lowThreshold = parseFloat(underMatch[1].replace(/,/g, ""));
    const highThreshold = parseFloat(overMatch[1].replace(/,/g, ""));
    minSoldPrice = Math.round(lowThreshold * 0.5 * 100) / 100;
    maxSoldPrice = Math.round(highThreshold * 1.5 * 100) / 100;
    avgSoldPrice = Math.round((lowThreshold + highThreshold) / 2 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
  } else if (rangeMatch) {
    const rLow = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const rHigh = parseFloat(rangeMatch[2].replace(/,/g, ""));
    avgSoldPrice = Math.round((rLow + rHigh) / 2 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = Math.round(rLow * 0.7 * 100) / 100;
    maxSoldPrice = Math.round(rHigh * 1.3 * 100) / 100;
  } else if (underMatch) {
    const threshold = parseFloat(underMatch[1].replace(/,/g, ""));
    avgSoldPrice = Math.round(threshold * 0.6 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = Math.round(threshold * 0.1 * 100) / 100;
    maxSoldPrice = threshold;
  } else if (overMatch) {
    const threshold = parseFloat(overMatch[1].replace(/,/g, ""));
    avgSoldPrice = Math.round(threshold * 1.5 * 100) / 100;
    medianSoldPrice = avgSoldPrice;
    minSoldPrice = threshold;
    maxSoldPrice = Math.round(threshold * 3 * 100) / 100;
  }

  console.log(
    `[market-watch-refresh] Sold data: count=${soldCount}, avg=$${avgSoldPrice}`,
  );
  return {
    soldCount,
    avgSoldPrice,
    minSoldPrice,
    maxSoldPrice,
    medianSoldPrice,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    const { watchId, userId } = body as { watchId: string; userId: string };

    if (!watchId || !userId) {
      return new Response(
        JSON.stringify({ error: "watchId and userId are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Fetch the watch record
    const { data: watch, error: watchErr } = await supabase
      .from("market_watches")
      .select("*")
      .eq("id", watchId)
      .eq("user_id", userId)
      .single();

    if (watchErr || !watch) {
      return new Response(
        JSON.stringify({ error: "Watch not found or access denied" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";

    // Run both requests in parallel: Browse API (active) + Jina (sold)
    const token = await getEbayAppToken();

    const [activeResult, soldData] = await Promise.all([
      browseSearch({
        query: watch.search_query,
        token,
        ebayEnv,
        categoryId: watch.category_id,
        limit: 50,
      }),
      scrapeEbaySoldData(watch.search_query, watch.category_id),
    ]);

    const soldCount = soldData.soldCount;
    // Use Browse API `total` for the real active count (not just the 50 fetched)
    const activeCount = activeResult.total > 0 ? activeResult.total : activeResult.count;
    const total = soldCount + activeCount;

    // Sell-through rate: sold / (sold + active)
    const sellThroughRate = total > 0 ? round2(soldCount / total) : 0;

    // Active price stats from Browse API page results
    const prices = activeResult.prices;
    const avgPrice = prices.length > 0 ? round2(avg(prices)) : null;
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
    const medianPrice = prices.length > 0 ? round2(median(prices)) : null;

    const now = new Date().toISOString();

    // Update the watch record with sold data + active data
    await supabase
      .from("market_watches")
      .update({
        last_checked_at: now,
        avg_price: avgPrice,
        min_price: minPrice,
        max_price: maxPrice,
        median_price: medianPrice,
        active_count: activeCount,
        sold_count: soldCount,
        sell_through_rate: sellThroughRate,
        updated_at: now,
      })
      .eq("id", watchId);

    // Insert history snapshot
    await supabase.from("market_price_history").insert({
      watch_id: watchId,
      sampled_at: now,
      avg_price: avgPrice,
      min_price: minPrice,
      max_price: maxPrice,
      median_price: medianPrice,
      active_count: activeCount,
      sold_count: soldCount,
      sell_through_rate: sellThroughRate,
    });

    console.log(
      `[market-watch-refresh] Refreshed watch ${watchId}: avg=$${avgPrice}, active=${activeCount}, sold=${soldCount}, STR=${sellThroughRate}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        watchId,
        // Active pricing (from Browse API)
        avgPrice,
        minPrice,
        maxPrice,
        medianPrice,
        activeCount,
        // Sold data (from Jina eBay scrape)
        soldCount,
        avgSoldPrice: soldData.avgSoldPrice,
        minSoldPrice: soldData.minSoldPrice,
        maxSoldPrice: soldData.maxSoldPrice,
        sellThroughRate,
        lastCheckedAt: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[market-watch-refresh] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
