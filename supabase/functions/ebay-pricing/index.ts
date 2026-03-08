import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    console.error("eBay token error:", resp.status, txt);
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

    const token = await getEbayAppToken();
    const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "sandbox";
    const apiBase =
      ebayEnv === "production"
        ? "https://api.ebay.com"
        : "https://api.sandbox.ebay.com";

    // Search sold/completed items using Browse API
    // filter=buyingOptions:{FIXED_PRICE|AUCTION}&filter=conditions:{USED}
    const searchParams = new URLSearchParams({
      q: query,
      limit: "20",
      sort: "-price",
      // The Browse API item_summary endpoint with SOLD filter
      filter: "buyingOptions:{FIXED_PRICE|AUCTION}",
    });

    const searchResp = await fetch(
      `${apiBase}/buy/browse/v1/item_summary/search?${searchParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "Content-Type": "application/json",
        },
      }
    );

    if (!searchResp.ok) {
      const errText = await searchResp.text();
      console.error("eBay search error:", searchResp.status, errText);
      // Return empty results rather than failing — allows AI pricing to still work
      return new Response(
        JSON.stringify({
          soldItems: [],
          averagePrice: 0,
          totalFound: 0,
          query,
          note: "eBay API returned an error. AI-estimated pricing is shown instead.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const searchData = await searchResp.json();
    const items = searchData.itemSummaries || [];

    // Extract prices from results
    const soldItems = items
      .filter((item: any) => item.price?.value)
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

    const prices = soldItems.map((i: any) => i.price);
    const averagePrice =
      prices.length > 0
        ? parseFloat((prices.reduce((a: number, b: number) => a + b, 0) / prices.length).toFixed(2))
        : 0;

    const lowPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highPrice = prices.length > 0 ? Math.max(...prices) : 0;

    return new Response(
      JSON.stringify({
        soldItems,
        averagePrice,
        lowPrice,
        highPrice,
        totalFound: searchData.total || items.length,
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
