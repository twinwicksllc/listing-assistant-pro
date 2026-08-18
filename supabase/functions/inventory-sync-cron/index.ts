import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { describeCronAuthEnv, requireCronSecret } from "../_helpers/authGuard.ts";
import { syncUserInventory } from "../_helpers/ebayInventorySync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How many users to sync per invocation. Each sync is one call to the very
// heavy ebay-listings function -- see get_users_for_inventory_sync's own
// migration comment (20260818010000) for the capacity arithmetic behind this
// number and the WORKER_RESOURCE_LIMIT incident that made a per-invocation
// cap necessary in the first place.
const USERS_PER_TICK = 3;

// How long a user's user_active_listings cache can go without a resync
// before it's eligible again. Deliberately separate from competitorSearch.ts's
// CACHE_TTL_MS -- inventory freshness and price-data freshness are different
// concerns with different acceptable windows.
const INVENTORY_STALE_MS = 6 * 60 * 60 * 1000;

// ----------------------------------------------------------------
// Main handler
// Scheduled via supabase/migrations/20260818030000_schedule_inventory_sync_cron.sql
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await requireCronSecret(req);
  if (!auth.ok) {
    console.warn(
      "[inventory-sync-cron] auth rejected:",
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

  const ebayClientId = Deno.env.get("EBAY_CLIENT_ID") ?? "";
  const ebayClientSecret = Deno.env.get("EBAY_CLIENT_SECRET") ?? "";
  const ebayEnv = Deno.env.get("EBAY_ENVIRONMENT") || "production";
  const ebayConfig = {
    clientId: ebayClientId,
    clientSecret: ebayClientSecret,
    tokenUrl: ebayEnv === "production"
      ? "https://api.ebay.com/identity/v1/oauth2/token"
      : "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  };

  if (!ebayClientId || !ebayClientSecret) {
    return new Response(
      JSON.stringify({ error: "eBay API credentials not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log("[inventory-sync-cron] Starting inventory sync run...");
  const startTime = Date.now();

  const staleBefore = new Date(Date.now() - INVENTORY_STALE_MS).toISOString();
  const { data: candidates, error: rpcErr } = await supabase.rpc(
    "get_users_for_inventory_sync",
    { p_limit: USERS_PER_TICK, p_stale_before: staleBefore },
  );

  if (rpcErr) {
    console.error("[inventory-sync-cron] RPC failed:", rpcErr.message);
    return new Response(JSON.stringify({ error: rpcErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userIds: string[] = (candidates ?? []).map(
    (c: { user_id: string }) => c.user_id,
  );
  console.log(`[inventory-sync-cron] Syncing ${userIds.length} user(s)`);

  let totalListings = 0;
  let totalEnded = 0;

  for (const userId of userIds) {
    const { listingCount, endedCount } = await syncUserInventory(
      supabaseUrl,
      serviceKey,
      userId,
      supabase,
      ebayConfig,
    );
    console.log(
      `[inventory-sync-cron] User ${userId}: ${listingCount} active, ${endedCount} ended`,
    );
    totalListings += listingCount;
    totalEnded += endedCount;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    usersSynced: userIds.length,
    totalListings,
    totalEnded,
    elapsedSeconds: parseFloat(elapsed),
  };

  console.log("[inventory-sync-cron] Completed:", summary);

  return new Response(JSON.stringify({ success: true, ...summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
