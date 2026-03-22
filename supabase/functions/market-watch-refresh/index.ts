import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ----------------------------------------------------------------
// Sleep helper
// ----------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------
// eBay Finding API helpers — with retry on rate-limit (error 10001)
// ----------------------------------------------------------------
async function fetchEbayListings(params: {
  appId: string;
  searchQuery: string;
  categoryId?: string | null;
  ebayEnv: string;
  completed: boolean;
  maxRetries?: number;
}): Promise<{ prices: number[]; count: number }> {
  const { appId, searchQuery, categoryId, ebayEnv, completed, maxRetries = 3 } = params;

  const baseUrl =
    ebayEnv === "production"
      ? "https://svcs.ebay.com/services/search/FindingService/v1"
      : "https://svcs.sandbox.ebay.com/services/search/FindingService/v1";

  const operation = completed ? "findCompletedItems" : "findItemsByKeywords";

  const qp = new URLSearchParams({
    "OPERATION-NAME": operation,
    "SERVICE-VERSION": "1.0.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "keywords": searchQuery,
    "paginationInput.entriesPerPage": "50",
    "paginationInput.pageNumber": "1",
    "sortOrder": "EndTimeSoonest",
  });

  if (completed) {
    qp.set("itemFilter(0).name", "SoldItemsOnly");
    qp.set("itemFilter(0).value", "true");
  } else {
    qp.set("itemFilter(0).name", "ListingType");
    qp.set("itemFilter(0).value", "FixedPrice");
  }

  if (categoryId) qp.set("categoryId", categoryId);

  const url = `${baseUrl}?${qp.toString()}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[market-watch-refresh] Attempt ${attempt}/${maxRetries} — ${completed ? "sold" : "active"}: "${searchQuery}"`
    );

    const resp = await fetch(url, { headers: { "Accept": "application/json" } });

    if (resp.status === 500) {
      const body = await resp.text();
      const isRateLimit = body.includes("10001") || body.includes("RateLimiter");
      console.error(`[market-watch-refresh] eBay API 500 (attempt ${attempt}): ${body.slice(0, 200)}`);

      if (isRateLimit && attempt < maxRetries) {
        const waitMs = attempt * 2000;
        console.log(`[market-watch-refresh] Rate limited — waiting ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }
      return { prices: [], count: 0 };
    }

    if (!resp.ok) {
      console.error(`[market-watch-refresh] eBay API error: ${resp.status}`);
      return { prices: [], count: 0 };
    }

    const json = await resp.json();
    const key = completed ? "findCompletedItemsResponse" : "findItemsByKeywordsResponse";
    const searchResult = json?.[key]?.[0]?.searchResult?.[0];

    if (!searchResult || searchResult["@count"] === "0") {
      return { prices: [], count: 0 };
    }

    const items: unknown[] = searchResult.item ?? [];
    const prices: number[] = [];

    for (const item of items) {
      try {
        const rec = item as Record<string, Record<string, unknown>[]>;
        const sellingStatus = rec?.sellingStatus;
        const priceStr =
          sellingStatus?.[0]?.currentPrice &&
          (sellingStatus[0].currentPrice as Record<string, string>[])?.[0]?.__value__;
        const price = parseFloat(priceStr as string);
        if (!isNaN(price) && price > 0) prices.push(price);
      } catch { /* skip malformed */ }
    }

    console.log(
      `[market-watch-refresh] Got ${prices.length} prices (${completed ? "sold" : "active"})`
    );
    return { prices, count: prices.length };
  }

  return { prices: [], count: 0 };
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
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
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    // Sequential calls with a gap to avoid eBay Finding API rate limits
    const activeResult = await fetchEbayListings({
      appId,
      searchQuery: watch.search_query,
      categoryId: watch.category_id,
      ebayEnv,
      completed: false,
    });

    await sleep(800);

    const soldResult = await fetchEbayListings({
      appId,
      searchQuery: watch.search_query,
      categoryId: watch.category_id,
      ebayEnv,
      completed: true,
    });

    const allPrices = [...activeResult.prices, ...soldResult.prices];
    const activeCount = activeResult.count;
    const soldCount = soldResult.count;
    const total = activeCount + soldCount;
    const sellThroughRate = total > 0 ? round2((soldCount / total) * 100) : 0;

    const avgPrice = allPrices.length > 0 ? round2(avg(allPrices)) : null;
    const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
    const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
    const medianPrice = allPrices.length > 0 ? round2(median(allPrices)) : null;

    const now = new Date().toISOString();

    // Update the watch record
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
      `[market-watch-refresh] Refreshed watch ${watchId}: avg=$${avgPrice}, active=${activeCount}, sold=${soldCount}, STR=${sellThroughRate}%`
    );

    return new Response(
      JSON.stringify({
        success: true,
        watchId,
        avgPrice,
        minPrice,
        maxPrice,
        medianPrice,
        activeCount,
        soldCount,
        sellThroughRate,
        lastCheckedAt: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[market-watch-refresh] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});