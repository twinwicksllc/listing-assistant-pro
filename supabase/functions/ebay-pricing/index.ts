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
    const appId = Deno.env.get("EBAY_CLIENT_ID");
    
    if (!appId) {
      console.error("[ebay-pricing] EBAY_CLIENT_ID not configured");
      return new Response(JSON.stringify({ error: "EBAY_CLIENT_ID not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ebay-pricing] Starting search: query="${query}", env=${ebayEnv}`);

    // Search last 30 days first
    // Using the Finding API's findCompletedItems which is specifically for SOLD items
    const performSearch = async (daysAgo: number): Promise<any[]> => {
      // Use Finding API which has findCompletedItems specifically for sold items
      const findingApiBase = ebayEnv === "production"
        ? "https://svcs.ebay.com/services/search/FindingService/v1"
        : "https://svcs.sandbox.ebay.com/services/search/FindingService/v1";

      const queryParams = new URLSearchParams({
        "OPERATION-NAME": "findCompletedItems",
        "SERVICE-VERSION": "1.0.0",
        "SECURITY-APPNAME": appId,
        "RESPONSE-DATA-FORMAT": "JSON",
        "keywords": query,
        "itemFilter(0).name": "SoldItemsOnly",
        "itemFilter(0).value": "true",
        "paginationInput.entriesPerPage": "20",
        "paginationInput.pageNumber": "1",
        "sortOrder": "EndTimeSoonest",
      });

      const findingUrl = `${findingApiBase}?${queryParams.toString()}`;
      console.log(`[ebay-pricing] Finding API URL (${daysAgo}d): ${findingUrl}`);

      const searchResp = await fetch(findingUrl, {
        headers: { "Accept": "application/json" },
      });

      console.log(`[ebay-pricing] Finding API response status: ${searchResp.status}`);

      if (!searchResp.ok) {
        const errorText = await searchResp.text();
        console.error(`[ebay-pricing] Finding API error (${daysAgo}d): ${searchResp.status} - ${errorText}`);
        return [];
      }

      const searchData = await searchResp.json();
      const searchResult = searchData?.findCompletedItemsResponse?.[0]?.searchResult?.[0];
      const itemSummaries = searchResult?.item ?? [];
      
      console.log(`[ebay-pricing] Finding API items count: ${itemSummaries.length}`);
      if (itemSummaries.length > 0) {
        console.log(`[ebay-pricing] First item (raw): ${JSON.stringify(itemSummaries[0], null, 2)}`);
      }
      return itemSummaries;
    };

    // Search last 30 days first
    let items = await performSearch(30);

    // If fewer than 3 results, expand to 90 days
    if (items.length < 3) {
      console.log(`Only ${items.length} results in 30 days, expanding to 90 days`);
      items = await performSearch(90);
    }

    // Extract prices from results
    // Finding API returns prices in a different structure
    console.log(`[ebay-pricing] Total items from API: ${items.length}`);
    
    const soldItems = items
      .map((item: any) => {
        try {
          const itemRecord = item as Record<string, any>;
          // Finding API structure: itemRecord.sellingStatus[0].currentPrice[0].__value__
          const sellingStatus = itemRecord?.sellingStatus;
          const priceValue = sellingStatus?.[0]?.currentPrice?.[0]?.__value__;
          const price = parseFloat(priceValue as string);
          
          if (!isNaN(price) && price > 0) {
            return {
              title: itemRecord.title?.[0] || "Unknown",
              price,
              currency: "USD",
              condition: itemRecord.condition?.[0]?.conditionDisplayName?.[0] || "Not specified",
              itemId: itemRecord.itemId?.[0],
              imageUrl: itemRecord.galleryURL?.[0] || null,
              itemUrl: itemRecord.viewItemURL?.[0] || null,
            };
          }
        } catch (e) {
          console.warn(`[ebay-pricing] Failed to parse item price: ${e}`);
        }
        return null;
      })
      .filter((item: any): item is SoldItem => item !== null)
      .slice(0, 10);

    console.log(`[ebay-pricing] Sold items after filtering: ${soldItems.length}`);
    if (soldItems.length > 0) {
      console.log(`[ebay-pricing] First item: price=${soldItems[0].price}, title=${soldItems[0].title}`);
      console.log(`[ebay-pricing] All prices: [${soldItems.map(i => i.price).join(", ")}]`);
    }

    const prices = soldItems.map((i: any) => i.price);
    const averagePrice =
      prices.length > 0
        ? parseFloat((prices.reduce((a: number, b: number) => a + b, 0) / prices.length).toFixed(2))
        : 0;

    const lowPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const highPrice = prices.length > 0 ? Math.max(...prices) : 0;

    console.log(`[ebay-pricing] Computed prices: avg=${averagePrice}, low=${lowPrice}, high=${highPrice}, count=${prices.length}`);

    return new Response(
      JSON.stringify({
        soldItems,
        averagePrice,
        lowPrice,
        highPrice,
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
