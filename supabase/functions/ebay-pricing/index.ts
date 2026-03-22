import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SoldItem {
  title: string;
  price: number;
  currency: string;
  condition: string;
  itemId?: string;
  imageUrl?: string | null;
  itemUrl?: string | null;
}

// Helper function to get OAuth app token for Browse API
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

  console.log(`[ebay-pricing] Fetching OAuth token from ${tokenUrl}`);

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
    console.error(`[ebay-pricing] Token error: ${resp.status} - ${txt}`);
    throw new Error(`Failed to get eBay token: ${resp.status}`);
  }

  const data = await resp.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "No search query provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    console.log(`[ebay-pricing] Starting search: query="${query}", env=${ebayEnv}`);

    // Get OAuth token for Browse API
    let token: string;
    try {
      token = await getEbayAppToken();
      console.log(`[ebay-pricing] Successfully obtained OAuth token`);
    } catch (tokenErr) {
      console.error(`[ebay-pricing] Failed to get token:`, tokenErr);
      throw tokenErr;
    }

    // Helper function to perform search with date filter on Browse API
    const performSearch = async (daysAgo: number): Promise<any[]> => {
      const now = new Date();
      const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      const endDate = now;

      // Format dates for eBay API (ISO 8601)
      const startDateStr = startDate.toISOString();
      const endDateStr = endDate.toISOString();

      const searchParams = new URLSearchParams({
        q: query,
        limit: "20",
        sort: "-price",
        filter: `buyingOptions:{FIXED_PRICE|AUCTION},soldDate:[${startDateStr}..${endDateStr}]`,
      });

      const searchUrl = `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`;
      console.log(`[ebay-pricing] Browse API search URL (${daysAgo}d): ${searchUrl.substring(0, 80)}...`);

      const searchResp = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "Content-Type": "application/json",
        },
      });

      console.log(`[ebay-pricing] Browse API response status: ${searchResp.status}`);

      if (!searchResp.ok) {
        const errorText = await searchResp.text();
        console.error(`[ebay-pricing] Browse API error (${daysAgo}d): ${searchResp.status} - ${errorText}`);
        return [];
      }

      const searchData = await searchResp.json();
      const itemSummaries = searchData.itemSummaries || [];
      
      console.log(`[ebay-pricing] Browse API items count (${daysAgo}d): ${itemSummaries.length}`);
      if (itemSummaries.length > 0) {
        console.log(`[ebay-pricing] First item sample (${daysAgo}d):`, {
          title: itemSummaries[0].title,
          price: itemSummaries[0].price?.value,
          condition: itemSummaries[0].condition,
        });
      }
      return itemSummaries;
    };

    // Search last 30 days first
    let items = await performSearch(30);

    // If fewer than 3 results, expand to 90 days
    if (items.length < 3) {
      console.log(`[ebay-pricing] Only ${items.length} results in 30 days, expanding to 90 days`);
      items = await performSearch(90);
    }

    // Extract prices from Browse API results
    console.log(`[ebay-pricing] Total items from Browse API: ${items.length}`);
    
    const soldItems = items
      .filter((item: any) => item.price?.value && parseFloat(item.price.value) > 0)
      .map((item: any) => ({
        title: item.title,
        price: parseFloat(item.price.value),
        currency: item.price.currency || "USD",
        condition: item.condition || "Not specified",
        itemId: item.itemId,
        imageUrl: item.image?.imageUrl || null,
        itemUrl: item.itemWebUrl || null,
      }))
      .slice(0, 10);

    console.log(`[ebay-pricing] Valid sold items after filtering: ${soldItems.length}`);
    if (soldItems.length > 0) {
      console.log(`[ebay-pricing] First item: price=${soldItems[0].price}, title=${soldItems[0].title}`);
      console.log(`[ebay-pricing] All prices: [${soldItems.map(i => i.price).join(", ")}]`);
    }

    const prices = soldItems.map((i: any) => i.price).sort((a: number, b: number) => a - b);
    const averagePrice =
      prices.length > 0
        ? parseFloat((prices.reduce((a: number, b: number) => a + b, 0) / prices.length).toFixed(2))
        : 0;

    const lowPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highPrice = prices.length > 0 ? Math.max(...prices) : 0;

    // Median price
    const medianPrice = (() => {
      if (prices.length === 0) return 0;
      const mid = Math.floor(prices.length / 2);
      return prices.length % 2 === 0
        ? parseFloat(((prices[mid - 1] + prices[mid]) / 2).toFixed(2))
        : prices[mid];
    })();

    // Percentile stats (p25, p75) for IQR-based pricing
    const p25 = (() => {
      if (prices.length === 0) return 0;
      const idx = Math.max(0, Math.ceil(0.25 * prices.length) - 1);
      return prices[idx];
    })();

    const p75 = (() => {
      if (prices.length === 0) return 0;
      const idx = Math.max(0, Math.ceil(0.75 * prices.length) - 1);
      return prices[idx];
    })();

    // Price histogram buckets (5 buckets for mini chart)
    const histogram: { bucket: string; count: number; min: number; max: number }[] = [];
    if (prices.length > 0) {
      const bucketSize = (highPrice - lowPrice) / 5 || 1;
      for (let i = 0; i < 5; i++) {
        const bucketMin = lowPrice + i * bucketSize;
        const bucketMax = bucketMin + bucketSize;
        const count = prices.filter((p: number) => p >= bucketMin && (i === 4 ? p <= bucketMax : p < bucketMax)).length;
        histogram.push({
          bucket: `$${bucketMin.toFixed(0)}–$${bucketMax.toFixed(0)}`,
          count,
          min: bucketMin,
          max: bucketMax,
        });
      }
    }

    console.log(`[ebay-pricing] Computed prices: avg=${averagePrice}, low=${lowPrice}, high=${highPrice}, median=${medianPrice}, count=${prices.length}`);

    return new Response(
      JSON.stringify({
        soldItems,
        averagePrice,
        lowPrice,
        highPrice,
        medianPrice,
        p25,
        p75,
        histogram,
        totalFound: items.length,
        query,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ebay-pricing error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
