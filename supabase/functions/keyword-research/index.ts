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

interface EbayFindingResult {
  prices: number[];
  count: number;
  topItems: TopItem[];
}

// ----------------------------------------------------------------
// Sleep helper
// ----------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------
// Fetch listings from eBay Finding API with retry on rate-limit
// ----------------------------------------------------------------
async function fetchEbayListings(params: {
  appId: string;
  searchQuery: string;
  categoryId?: string | null;
  ebayEnv: string;
  completed: boolean;
  limit?: number;
  maxRetries?: number;
}): Promise<EbayFindingResult> {
  const {
    appId,
    searchQuery,
    categoryId,
    ebayEnv,
    completed,
    limit = 50,
    maxRetries = 3,
  } = params;

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
    "paginationInput.entriesPerPage": String(Math.min(limit, 50)),
    "paginationInput.pageNumber": "1",
    "sortOrder": completed ? "EndTimeSoonest" : "BestMatch",
    "outputSelector(0)": "GalleryInfo",
  });

  if (completed) {
    qp.set("itemFilter(0).name", "SoldItemsOnly");
    qp.set("itemFilter(0).value", "true");
  } else {
    qp.set("itemFilter(0).name", "ListingType");
    qp.set("itemFilter(0).value(0)", "FixedPrice");
    qp.set("itemFilter(0).value(1)", "Auction");
  }

  if (categoryId) qp.set("categoryId", categoryId);

  const url = `${baseUrl}?${qp.toString()}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `[keyword-research] Attempt ${attempt}/${maxRetries} — ${completed ? "completed" : "active"}: "${searchQuery}"`
    );

    const resp = await fetch(url, { headers: { "Accept": "application/json" } });

    if (resp.status === 500) {
      const body = await resp.text();
      const isRateLimit = body.includes("10001") || body.includes("RateLimiter");
      console.error(`[keyword-research] eBay API 500 (attempt ${attempt}): ${body.slice(0, 200)}`);

      if (isRateLimit && attempt < maxRetries) {
        const waitMs = attempt * 2000; // 2s, 4s, 6s
        console.log(`[keyword-research] Rate limited — waiting ${waitMs}ms before retry...`);
        await sleep(waitMs);
        continue;
      }
      return { prices: [], count: 0, topItems: [] };
    }

    if (!resp.ok) {
      console.error(`[keyword-research] eBay API error ${resp.status}`);
      return { prices: [], count: 0, topItems: [] };
    }

    const json = await resp.json();
    const key = completed ? "findCompletedItemsResponse" : "findItemsByKeywordsResponse";
    const searchResult = json?.[key]?.[0]?.searchResult?.[0];

    if (!searchResult || searchResult["@count"] === "0") {
      console.log(`[keyword-research] No results for "${searchQuery}" (${completed ? "sold" : "active"})`);
      return { prices: [], count: 0, topItems: [] };
    }

    const items: unknown[] = searchResult.item ?? [];
    const prices: number[] = [];
    const topItems: TopItem[] = [];

    for (const item of items) {
      try {
        const rec = item as Record<string, unknown>;
        const sellingStatus = (rec.sellingStatus as Record<string, unknown>[])?.[0];
        const currentPrice = (sellingStatus?.currentPrice as Record<string, string>[])?.[0];
        const price = parseFloat(currentPrice?.__value__ ?? "0");

        if (!isNaN(price) && price > 0) {
          prices.push(price);

          if (topItems.length < 5) {
            const titleArr = rec.title as string[] | undefined;
            const title = Array.isArray(titleArr) ? titleArr[0] : String(titleArr ?? "");
            const galleryURL = (rec.galleryURL as string[])?.[0] ?? null;
            const viewItemURL = (rec.viewItemURL as string[])?.[0] ?? null;
            const conditionArr = (rec.condition as Record<string, unknown>[])?.[0];
            const conditionName =
              (conditionArr?.conditionDisplayName as string[])?.[0] ?? "Unknown";

            topItems.push({ title, price, imageUrl: galleryURL, itemUrl: viewItemURL, condition: conditionName });
          }
        }
      } catch { /* skip malformed */ }
    }

    console.log(
      `[keyword-research] Got ${prices.length} prices (${completed ? "sold" : "active"}) for "${searchQuery}"`
    );
    return { prices, count: prices.length, topItems };
  }

  return { prices: [], count: 0, topItems: [] };
}

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

// Simple in-memory cache keyed by query+category, expires after 4 hours
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
    const appId = Deno.env.get("EBAY_CLIENT_ID");

    if (!appId) {
      return new Response(
        JSON.stringify({ error: "EBAY_CLIENT_ID not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[keyword-research] Fetching market data for: "${query}" (env: ${ebayEnv})`);

    // ── Sequential calls with a gap to avoid eBay Finding API rate limits ──
    const activeResult = await fetchEbayListings({
      appId,
      searchQuery: query,
      categoryId,
      ebayEnv,
      completed: false,
      limit: 50,
      maxRetries: 3,
    });

    // 800ms pause between calls to respect eBay Finding API rate limits
    await sleep(800);

    const soldResult = await fetchEbayListings({
      appId,
      searchQuery: query,
      categoryId,
      ebayEnv,
      completed: true,
      limit: 50,
      maxRetries: 3,
    });

    const activeCount = activeResult.count;
    const soldCount = soldResult.count;
    const total = activeCount + soldCount;
    const sellThroughRate = total > 0 ? round2((soldCount / total) * 100) : 0;

    // Sold price stats
    const soldPrices = soldResult.prices.sort((a, b) => a - b);
    const avgSoldPrice =
      soldPrices.length > 0
        ? round2(soldPrices.reduce((s, p) => s + p, 0) / soldPrices.length)
        : null;
    const medianSoldPrice = soldPrices.length > 0 ? round2(median(soldPrices)) : null;
    const minSoldPrice = soldPrices.length > 0 ? soldPrices[0] : null;
    const maxSoldPrice =
      soldPrices.length > 0 ? soldPrices[soldPrices.length - 1] : null;
    const p25SoldPrice =
      soldPrices.length > 0 ? round2(percentile(soldPrices, 25)) : null;
    const p75SoldPrice =
      soldPrices.length > 0 ? round2(percentile(soldPrices, 75)) : null;

    // Active price stats
    const activePrices = activeResult.prices.sort((a, b) => a - b);
    const avgActivePrice =
      activePrices.length > 0
        ? round2(activePrices.reduce((s, p) => s + p, 0) / activePrices.length)
        : null;
    const minActivePrice = activePrices.length > 0 ? activePrices[0] : null;
    const maxActivePrice =
      activePrices.length > 0 ? activePrices[activePrices.length - 1] : null;

    // Competition level
    let competitionLevel: "low" | "medium" | "high" = "low";
    if (activeCount > 100) competitionLevel = "high";
    else if (activeCount > 30) competitionLevel = "medium";

    // Demand signal
    let demandSignal: "weak" | "moderate" | "strong" = "weak";
    if (sellThroughRate >= 50) demandSignal = "strong";
    else if (sellThroughRate >= 25) demandSignal = "moderate";

    const responseData = {
      query,
      categoryId: categoryId ?? null,
      soldCount,
      avgSoldPrice,
      medianSoldPrice,
      minSoldPrice,
      maxSoldPrice,
      p25SoldPrice,
      p75SoldPrice,
      activeCount,
      avgActivePrice,
      minActivePrice,
      maxActivePrice,
      sellThroughRate,
      competitionLevel,
      demandSignal,
      topCompetitors: activeResult.topItems,
      topSold: soldResult.topItems,
      noData: total === 0,
      fromCache: false,
    };

    // Cache for 4 hours
    cache.set(cacheKey, {
      data: responseData,
      expiresAt: now + 4 * 60 * 60 * 1000,
    });

    console.log(
      `[keyword-research] Done: sold=${soldCount}, active=${activeCount}, STR=${sellThroughRate}%, competition=${competitionLevel}`
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