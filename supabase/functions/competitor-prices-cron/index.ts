import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// How long to wait between per-listing searches (ms) to respect eBay rate limits.
// eBay Finding API allows ~5,000 app-level calls/day — with 500ms delay we can
// refresh up to ~720 listings per run comfortably within the limit.
const SEARCH_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------
// Fetch active listings for a user via the ebay-listings function.
// Returns an array of { listingId, title, price, categoryId } or [].
// ----------------------------------------------------------------
async function fetchActiveListings(
  supabaseUrl: string,
  serviceKey: string,
  userId: string
): Promise<{ listingId: string; title: string; price: number; categoryId?: string }[]> {
  // Retrieve the stored eBay token for this user
  const profileResp = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=ebay_access_token,ebay_token_expires_at`, {
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    },
  });

  if (!profileResp.ok) {
    console.warn(`[cron] Failed to fetch profile for user ${userId}`);
    return [];
  }

  const profiles = await profileResp.json();
  const token = profiles?.[0]?.ebay_access_token;
  if (!token) {
    console.log(`[cron] No eBay token for user ${userId}, skipping`);
    return [];
  }

  // Check if token is expired
  const expiresAt = profiles?.[0]?.ebay_token_expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    console.log(`[cron] eBay token expired for user ${userId}, skipping`);
    return [];
  }

  // Call ebay-listings function to get current active listings
  const listingsResp = await fetch(`${supabaseUrl}/functions/v1/ebay-listings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userToken: token }),
  });

  if (!listingsResp.ok) {
    console.warn(`[cron] ebay-listings failed for user ${userId}: ${listingsResp.status}`);
    return [];
  }

  const data = await listingsResp.json();
  const listings = data?.listings ?? [];

  return listings
    .filter((l: Record<string, unknown>) => l.listingId && l.title)
    .map((l: Record<string, unknown>) => ({
      listingId: String(l.listingId),
      title: String(l.title),
      price: Number(l.price ?? 0),
      categoryId: l.categoryId ? String(l.categoryId) : undefined,
    }));
}

// ----------------------------------------------------------------
// Invoke the ebay-competitor-search function for a single listing.
// ----------------------------------------------------------------
async function refreshCompetitorData(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  listing: { listingId: string; title: string; price: number; categoryId?: string }
): Promise<boolean> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/ebay-competitor-search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        listingId: listing.listingId,
        title: listing.title,
        categoryId: listing.categoryId,
        yourPrice: listing.price,
      }),
    });

    if (!resp.ok) {
      console.warn(`[cron] competitor-search failed for listing ${listing.listingId}: ${resp.status}`);
      return false;
    }

    const result = await resp.json();
    if (result.error) {
      console.warn(`[cron] competitor-search error for listing ${listing.listingId}:`, result.error);
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[cron] competitor-search threw for listing ${listing.listingId}:`, err);
    return false;
  }
}

// ----------------------------------------------------------------
// Main handler
// Intended to be called by Supabase cron schedule: "0 2 * * *" (2am UTC daily)
// ----------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: "Supabase credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log("[competitor-prices-cron] Starting daily competitor price refresh...");
  const startTime = Date.now();

  // Step 1: Clean up expired rows from previous runs
  const { error: cleanupErr } = await supabase
    .from("competitor_prices")
    .delete()
    .lt("expires_at", new Date().toISOString());

  if (cleanupErr) {
    console.warn("[competitor-prices-cron] Cleanup error (non-fatal):", cleanupErr.message);
  } else {
    console.log("[competitor-prices-cron] Expired rows cleaned up");
  }

  // Step 2: Fetch all users who have a connected (non-expired) eBay token
  const { data: users, error: usersErr } = await supabase
    .from("profiles")
    .select("id")
    .not("ebay_access_token", "is", null)
    .gt("ebay_token_expires_at", new Date().toISOString());

  if (usersErr) {
    console.error("[competitor-prices-cron] Failed to fetch users:", usersErr.message);
    return new Response(
      JSON.stringify({ error: usersErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const userIds: string[] = (users ?? []).map((u: { id: string }) => u.id);
  console.log(`[competitor-prices-cron] Processing ${userIds.length} connected users`);

  let totalListings = 0;
  let totalRefreshed = 0;
  let totalSkipped = 0;

  // Step 3: For each user, fetch their active listings and refresh competitor data
  for (const userId of userIds) {
    const listings = await fetchActiveListings(supabaseUrl, serviceKey, userId);
    console.log(`[competitor-prices-cron] User ${userId}: ${listings.length} active listings`);
    totalListings += listings.length;

    for (const listing of listings) {
      const ok = await refreshCompetitorData(supabaseUrl, serviceKey, userId, listing);
      if (ok) {
        totalRefreshed++;
      } else {
        totalSkipped++;
      }

      // Throttle to avoid eBay rate limits
      await sleep(SEARCH_DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    users: userIds.length,
    totalListings,
    refreshed: totalRefreshed,
    skipped: totalSkipped,
    elapsedSeconds: parseFloat(elapsed),
  };

  console.log("[competitor-prices-cron] Completed:", summary);

  return new Response(
    JSON.stringify({ success: true, ...summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
