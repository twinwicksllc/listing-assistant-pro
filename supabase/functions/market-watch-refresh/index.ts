import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret, requireUser } from "../_helpers/authGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Phase 3.4 (pricing-reliability plan): a user's manual "Refresh" click is
// each one Browse API call + one Jina scrape -- cheap individually, but
// unbounded clicking could still run up Jina-scraping volume (already a
// flagged ToS-risk surface, see Phase 3.3) for no real benefit, since the
// underlying market data does not meaningfully change faster than this. 6/24h
// leaves room for genuine repeated checking (e.g. watching a specific auction
// close) without being effectively unlimited.
const MANUAL_REFRESH_DAILY_LIMIT = 6;
const MANUAL_REFRESH_ACTION_TYPE = "market_watch_manual_refresh";

// Batch mode's per-tick cap. See the scheduling migration
// (20260916020000_schedule_market_watch_refresh_daily.sql) for the full
// capacity/cadence rationale -- kept here too since this is the number that
// actually bounds one invocation's work, which is what matters for staying
// under the Edge Function timeout.
const BATCH_SIZE_PER_TICK = 5;

// Watches older than this are eligible for the daily batch. Deliberately
// separate from competitorSearch.ts's CACHE_TTL_MS and
// ebayInventorySync.ts's INVENTORY_STALE_MS -- market-watch freshness is a
// different concern with its own acceptable window (see the plan's Phase 3.4
// section for why once daily, not more frequent, was chosen for this
// feature).
const BATCH_STALE_MS = 24 * 60 * 60 * 1000;

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
  // Default to production, matching ebay-publish/category-lookup/etc. --
  // this app's eBay integration is production (confirmed 500+ live
  // listings). A silent sandbox default here would feed a real production
  // OAuth token into eBay's sandbox API, which correctly rejects it.
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
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
    } catch {
      /* skip */
    }
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
        Accept: "text/plain",
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
    avgSoldPrice = Math.round(((lowThreshold + highThreshold) / 2) * 100) / 100;
    medianSoldPrice = avgSoldPrice;
  } else if (rangeMatch) {
    const rLow = parseFloat(rangeMatch[1].replace(/,/g, ""));
    const rHigh = parseFloat(rangeMatch[2].replace(/,/g, ""));
    avgSoldPrice = Math.round(((rLow + rHigh) / 2) * 100) / 100;
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

export interface WatchRow {
  id: string;
  search_query: string;
  category_id: string | null;
}

export interface RefreshedWatchStats {
  watchId: string;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  medianPrice: number | null;
  activeCount: number;
  soldCount: number;
  avgSoldPrice: number | null;
  minSoldPrice: number | null;
  maxSoldPrice: number | null;
  sellThroughRate: number;
  lastCheckedAt: string;
}

/**
 * Fetch, compute, and persist one watch's refresh -- shared by the manual
 * (requireUser) path and the daily batch (requireCronSecret) path so the two
 * cannot drift on what "a refresh" actually does. Takes the already-fetched
 * watch row rather than a bare id so the batch path (which already has the
 * row from the cursor RPC) doesn't need a second, redundant SELECT.
 */
export async function refreshOneWatch(
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing (see the createClient call below).
  supabase: any,
  watch: WatchRow,
): Promise<RefreshedWatchStats> {
  // Default to production, matching ebay-publish/category-lookup/etc. --
  // this app's eBay integration is production (confirmed 500+ live
  // listings). A silent sandbox default here would feed a real production
  // OAuth token into eBay's sandbox API, which correctly rejects it.
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";

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
    .eq("id", watch.id);

  // Insert history snapshot
  await supabase.from("market_price_history").insert({
    watch_id: watch.id,
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
    `[market-watch-refresh] Refreshed watch ${watch.id}: avg=$${avgPrice}, active=${activeCount}, sold=${soldCount}, STR=${sellThroughRate}`,
  );

  return {
    watchId: watch.id,
    avgPrice,
    minPrice,
    maxPrice,
    medianPrice,
    activeCount,
    soldCount,
    avgSoldPrice: soldData.avgSoldPrice,
    minSoldPrice: soldData.minSoldPrice,
    maxSoldPrice: soldData.maxSoldPrice,
    sellThroughRate,
    lastCheckedAt: now,
  };
}

/**
 * Daily batch mode (Phase 3.4): pulls a small, oldest-first batch from
 * get_watches_due_for_refresh and refreshes each in turn. Sequential, not
 * concurrent -- each refresh is already two outbound calls (Browse API +
 * Jina), and BATCH_SIZE_PER_TICK is small enough that running them one at a
 * time comfortably fits the cron's 60s timeout budget (see the scheduling
 * migration) without adding concurrent-request complexity for a batch this
 * small. One watch's failure is logged and skipped, not fatal to the batch --
 * matches the fail-soft posture every other cron in this project uses for a
 * per-item loop (e.g. inventory-sync-cron's per-user loop).
 */
export async function runBatch(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<{ attempted: number; refreshed: number; failed: number }> {
  const staleBefore = new Date(Date.now() - BATCH_STALE_MS).toISOString();
  const { data: candidates, error: rpcErr } = await supabase.rpc(
    "get_watches_due_for_refresh",
    { p_limit: BATCH_SIZE_PER_TICK, p_stale_before: staleBefore },
  );

  if (rpcErr) {
    console.error("[market-watch-refresh] Batch RPC failed:", rpcErr.message);
    return { attempted: 0, refreshed: 0, failed: 0 };
  }

  const watchIds: string[] = (candidates ?? []).map(
    (c: { watch_id: string }) => c.watch_id,
  );
  console.log(`[market-watch-refresh] Batch: ${watchIds.length} watch(es) due for refresh`);

  let refreshed = 0;
  let failed = 0;

  for (const watchId of watchIds) {
    try {
      const { data: watch, error: watchErr } = await supabase
        .from("market_watches")
        .select("id, search_query, category_id")
        .eq("id", watchId)
        .single();

      if (watchErr || !watch) {
        console.warn(`[market-watch-refresh] Batch: watch ${watchId} not found, skipping`);
        failed++;
        continue;
      }

      await refreshOneWatch(supabase, watch);
      refreshed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[market-watch-refresh] Batch: watch ${watchId} failed, skipping:`, msg);
      failed++;
    }
  }

  return { attempted: watchIds.length, refreshed, failed };
}

// ----------------------------------------------------------------
// Main handler
//
// Two callers, two modes:
//   - A real user's manual "Refresh" click: requireUser (a normal JWT),
//     body = { watchId }, gated by MANUAL_REFRESH_DAILY_LIMIT.
//   - The daily batch cron (20260916020000_schedule_market_watch_refresh_daily.sql):
//     requireCronSecret, body = { mode: "batch" }, no per-watch limit --
//     the batch size itself is already the cap (BATCH_SIZE_PER_TICK).
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Batch-mode cron calls with a JSON body; a malformed/empty body just
    // falls through to "not batch mode, no watchId" below rather than
    // throwing before either auth path gets a chance to run.
  }

  if (body?.mode === "batch") {
    const auth = await requireCronSecret(req);
    if (!auth.ok) {
      console.warn(
        "[market-watch-refresh] batch auth rejected:",
        JSON.stringify(describeCronAuthEnv(req)),
      );
      return new Response(JSON.stringify({ error: auth.message }), {
        status: auth.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const summary = await runBatch(supabase);
    console.log("[market-watch-refresh] Batch complete:", summary);
    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Manual (user-initiated) refresh ----
  const auth = await requireUser(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { watchId } = body as { watchId: string };
    // Never trust a client-supplied userId; the verified session is the only
    // valid identity for scoping this watch to its owner.
    const userId = auth.userId!;

    if (!watchId) {
      return new Response(
        JSON.stringify({ error: "watchId is required" }),
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

    // Rate-limit manual refreshes per user, per rolling 24h window -- same
    // count-then-check shape as analyze-item's usage_tracking check.
    // Returned as a 200 with an `error` body (not a 4xx status) so it flows
    // through useMarketWatches.ts's existing `if (data?.error) throw new
    // Error(data.error)` path unchanged: FunctionsHttpError's own .message is
    // the generic "Edge Function returned a non-2xx status code" string, not
    // this text, so a 4xx here would need a frontend change to surface
    // anything useful -- this needs none.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: refreshCount, error: countErr } = await supabase
      .from("usage_tracking")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action_type", MANUAL_REFRESH_ACTION_TYPE)
      .gte("created_at", oneDayAgo);

    if (countErr) {
      console.error("[market-watch-refresh] Usage count query failed:", countErr.message);
    } else if ((refreshCount ?? 0) >= MANUAL_REFRESH_DAILY_LIMIT) {
      return new Response(
        JSON.stringify({
          error: `You've refreshed watches ${MANUAL_REFRESH_DAILY_LIMIT} times in the last 24 hours. ` +
            `Market data updates automatically once a day -- please try again later.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch the watch record
    const { data: watch, error: watchErr } = await supabase
      .from("market_watches")
      .select("id, search_query, category_id")
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

    const stats = await refreshOneWatch(supabase, watch);

    // Track this manual refresh for the rate limit above. Recorded AFTER a
    // successful refresh (not before) so a failed attempt -- which consumed
    // no eBay/Jina calls of consequence beyond what already happened --
    // doesn't cost the user one of their 6 daily manual refreshes.
    try {
      await supabase.from("usage_tracking").insert({
        user_id: userId,
        action_type: MANUAL_REFRESH_ACTION_TYPE,
      });
    } catch (trackErr) {
      console.error("[market-watch-refresh] Failed to track manual refresh usage:", trackErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        // Active pricing (from Browse API)
        avgPrice: stats.avgPrice,
        minPrice: stats.minPrice,
        maxPrice: stats.maxPrice,
        medianPrice: stats.medianPrice,
        activeCount: stats.activeCount,
        // Sold data (from Jina eBay scrape)
        soldCount: stats.soldCount,
        avgSoldPrice: stats.avgSoldPrice,
        minSoldPrice: stats.minSoldPrice,
        maxSoldPrice: stats.maxSoldPrice,
        sellThroughRate: stats.sellThroughRate,
        lastCheckedAt: stats.lastCheckedAt,
        watchId: stats.watchId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[market-watch-refresh] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
