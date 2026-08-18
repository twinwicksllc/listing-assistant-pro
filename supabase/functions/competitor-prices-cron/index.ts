import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";
import { CACHE_TTL_MS, runCompetitorSearch } from "../_helpers/competitorSearch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// CACHE_TTL_MS imported above -- also the cutoff passed to
// get_next_competitor_price_batch below. Shared with competitorSearch.ts's
// own cache check so the two can't drift out of sync (they used to be
// duplicated constants).

// How long to wait between batches of eBay calls (ms).
// Browse API has no hard quota, but we throttle to be polite and
// avoid transient 429s under sustained load.
const SEARCH_DELAY_MS = 300;

// How many refreshCompetitorData calls to run concurrently per batch.
const REFRESH_CONCURRENCY = 15;

// How many (user, listing) pairs to pull per invocation, via
// get_next_competitor_price_batch. This cron used to loop every connected
// user's entire listing backlog in one invocation, enumerating live via the
// heavy ebay-listings function -- one user alone had 539+ stale listings,
// which crashed the invocation with WORKER_RESOURCE_LIMIT (Supabase's fixed,
// non-configurable 2.0s cumulative CPU-time / 256MB-per-invocation ceiling;
// that budget does not reset across loop iterations, so total work done in
// one invocation is what matters, not how it's parallelized). This cron now
// only reads from the local user_active_listings cache (kept fresh by the
// separate inventory-sync-cron) via a fairness-ranked cursor RPC, so its
// per-invocation work stays small and bounded regardless of how many users
// or listings exist. See supabase/migrations/20260818020000_add_competitor_price_cursor_rpc.sql
// and 20260818040000_schedule_competitor_prices_refresh_cursor.sql for the
// capacity arithmetic behind this number.
const BATCH_LIMIT = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------
// Run the competitor-search logic for a single listing, in-process (see
// runCompetitorSearch's own comment for why this doesn't go over HTTP to
// ebay-competitor-search).
// ----------------------------------------------------------------
async function refreshCompetitorData(
  // deno-lint-ignore no-explicit-any -- matches the loose typing already
  // used throughout this file for the supabase-js client.
  supabase: any,
  userId: string,
  listing: {
    listingId: string;
    title: string;
    price: number;
    categoryId?: string;
  },
  ebayEnv: string,
  geminiKey: string | undefined,
): Promise<boolean> {
  try {
    const { body: result } = await runCompetitorSearch({
      supabase,
      userId,
      listingId: listing.listingId,
      title: listing.title,
      categoryId: listing.categoryId,
      yourPrice: listing.price,
      ebayEnv,
      geminiKey,
    });

    if (result.error) {
      console.warn(
        `[cron] competitor-search error for listing ${listing.listingId}:`,
        result.error,
      );
      return false;
    }

    if (result.fromCache) {
      console.log(
        `[cron] Listing ${listing.listingId} served from internal cache`,
      );
    }

    return true;
  } catch (err) {
    console.warn(
      `[cron] competitor-search threw for listing ${listing.listingId}:`,
      err,
    );
    return false;
  }
}

// ----------------------------------------------------------------
// Main handler
// Scheduled via supabase/migrations/20260818040000_schedule_competitor_prices_refresh_cursor.sql
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Uses the same CRON_SECRET pattern as cleanup-media-retention,
  // cost-alert-cron, and sync-ebay-taxonomy (see authGuard.ts), rather than
  // requiring the service-role key directly -- that comparison broke here
  // once the platform's injected SUPABASE_SERVICE_ROLE_KEY value moved to
  // Supabase's newer, shorter secret-key format while the dashboard's
  // legacy "service_role" panel still showed the old ~200+ char JWT-format
  // key, so a correctly-copied key still failed a length-mismatched compare.
  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[competitor-prices-cron] auth rejected:",
      JSON.stringify(describeCronAuthEnv(req)),
    );
    return new Response(JSON.stringify({ error: auth.message }), {
      status: auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Supabase credentials not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  const geminiKey = Deno.env.get("GEMINI_API_KEY");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(
    "[competitor-prices-cron] Starting competitor price refresh run...",
  );
  const startTime = Date.now();

  const staleBefore = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data: batch, error: rpcErr } = await supabase.rpc(
    "get_next_competitor_price_batch",
    { p_limit: BATCH_LIMIT, p_stale_before: staleBefore },
  );

  if (rpcErr) {
    console.error("[competitor-prices-cron] RPC failed:", rpcErr.message);
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const listings: {
    userId: string;
    listingId: string;
    title: string;
    price: number;
    categoryId?: string;
  }[] = (batch ?? []).map((row: {
    user_id: string;
    ebay_listing_id: string;
    title: string;
    price: number | null;
    category_id: string | null;
  }) => ({
    userId: row.user_id,
    listingId: row.ebay_listing_id,
    title: row.title,
    price: row.price ?? 0,
    categoryId: row.category_id ?? undefined,
  }));

  console.log(`[competitor-prices-cron] Batch size: ${listings.length}`);

  let totalRefreshed = 0;
  let totalSkipped = 0;

  // Refresh in bounded-concurrency batches instead of all at once -- see
  // REFRESH_CONCURRENCY above for why.
  for (let i = 0; i < listings.length; i += REFRESH_CONCURRENCY) {
    const batchSlice = listings.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.all(
      batchSlice.map((listing) => refreshCompetitorData(supabase, listing.userId, listing, ebayEnv, geminiKey)),
    );
    for (const ok of results) {
      if (ok) {
        totalRefreshed++;
      } else {
        totalSkipped++;
      }
    }

    if (i + REFRESH_CONCURRENCY < listings.length) {
      await sleep(SEARCH_DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    batchSize: listings.length,
    refreshed: totalRefreshed,
    skipped: totalSkipped,
    elapsedSeconds: parseFloat(elapsed),
  };

  console.log("[competitor-prices-cron] Completed:", summary);

  return new Response(JSON.stringify({ success: true, ...summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
