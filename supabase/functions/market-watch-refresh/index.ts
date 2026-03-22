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
  const tokenUrl =
    ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  console.log(`[market-watch-refresh] Fetching OAuth token from ${tokenUrl}`);

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
    console.error(`[market-watch-refresh] Token error: ${resp.status} - ${txt}`);
    throw new Error(`Failed to get eBay token: ${resp.status}`);
  }

  const data = await resp.json();
  return data.access_token;
}

// ----------------------------------------------------------------
// Search using Browse API
// ----------------------------------------------------------------
async function browseSearch(params: {
  query: string;
  token: string;
  ebayEnv: string;
  categoryId?: string | null;
  limit?: number;
}): Promise<{ prices: number[]; count: number }> {
  const { query, token, ebayEnv, categoryId, limit = 50 } = params;

  const apiBase =
    ebayEnv === "production"
      ? "https://api.ebay.com"
      : "https://api.sandbox.ebay.com";

  const searchParams = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 50)),
    sort: "-price",
  });

  if (categoryId) {
    searchParams.set("category_ids", categoryId);
  }

  const url = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
  console.log(`[market-watch-refresh] Browse API search: "${query}"`);

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
    console.error(`[market-watch-refresh] Browse API error ${resp.status}: ${txt.slice(0, 200)}`);
    return { prices: [], count: 0 };
  }

  const json = await resp.json();
  const items = json?.itemSummaries ?? [];

  if (!items || items.length === 0) {
    console.log(`[market-watch-refresh] No items found for "${query}"`);
    return { prices: [], count: 0 };
  }

  const prices: number[] = [];

  for (const item of items) {
    try {
      const price = parseFloat(item?.price?.value ?? "0");
      if (!isNaN(price) && price > 0) {
        prices.push(price);
      }
    } catch { /* skip malformed */ }
  }

  console.log(`[market-watch-refresh] Got ${prices.length} items for "${query}"`);
  return { prices, count: prices.length };
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

    // Get OAuth token for Browse API
    const token = await getEbayAppToken();
    console.log(`[market-watch-refresh] Obtained OAuth token`);

    // Search active listings using Browse API
    const activeResult = await browseSearch({
      query: watch.search_query,
      token,
      ebayEnv,
      categoryId: watch.category_id,
      limit: 50,
    });

    // Browse API doesn't support sold items search
    // We'll track only active listings for now
    const soldCount = 0;
    const activeCount = activeResult.count;
    const total = activeCount + soldCount;
    const sellThroughRate = 0;

    const prices = activeResult.prices;
    const avgPrice = prices.length > 0 ? round2(avg(prices)) : null;
    const minPrice = prices.length > 0 ? Math.min(...prices) : null;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
    const medianPrice = prices.length > 0 ? round2(median(prices)) : null;

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
      `[market-watch-refresh] Refreshed watch ${watchId}: avg=$${avgPrice}, active=${activeCount}`
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