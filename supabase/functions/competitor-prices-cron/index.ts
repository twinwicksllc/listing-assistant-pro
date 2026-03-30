import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Must match CACHE_TTL_MS in ebay-competitor-search/index.ts.
// The cron skips any listing whose cache is younger than this.
const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// How long to wait between per-listing eBay calls (ms).
// Browse API has no hard quota, but we throttle to be polite and
// avoid transient 429s under sustained load.
const SEARCH_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------
// Fetch active listings for a user via the ebay-listings function.
// Returns an array of { listingId, title, price, categoryId } or [].
// ----------------------------------------------------------------
async function fetchActiveListings(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
): Promise<
  { listingId: string; title: string; price: number; categoryId?: string }[]
> {
  const profileResp = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=ebay_access_token,ebay_token_expires_at`,
    {
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
    },
  );

  if (!profileResp.ok) {
    console.warn(`[cron] Failed to fetch profile for user ${userId}`);
    return [];
  }

  let profiles: any;
  try {
    profiles = JSON.parse(await profileResp.text());
  } catch (e) {
    console.warn(
      `[cron] Failed to parse profile response for user ${userId}: ${e}`,
    );
    return [];
  }

  const token = profiles?.[0]?.ebay_access_token;
  if (!token) {
    console.log(`[cron] No eBay token for user ${userId}, skipping`);
    return [];
  }

  const expiresAt = profiles?.[0]?.ebay_token_expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    console.log(`[cron] eBay token expired for user ${userId}, skipping`);
    return [];
  }

  const listingsResp = await fetch(
    `${supabaseUrl}/functions/v1/ebay-listings`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userToken: token }),
    },
  );

  if (!listingsResp.ok) {
    console.warn(
      `[cron] ebay-listings failed for user ${userId}: ${listingsResp.status}`,
    );
    return [];
  }

  let data: any;
  try {
    data = JSON.parse(await listingsResp.text());
  } catch (e) {
    console.warn(
      `[cron] Failed to parse ebay-listings response for user ${userId}: ${e}`,
    );
    return [];
  }

  return (data?.listings ?? [])
    .filter((l: Record<string, unknown>) => l.listingId && l.title)
    .map((l: Record<string, unknown>) => ({
      listingId: String(l.listingId),
      title: String(l.title),
      price: Number(l.price ?? 0),
      categoryId: l.categoryId ? String(l.categoryId) : undefined,
    }));
}

// ----------------------------------------------------------------
// Build a map of listingId → fetched_at for listings that already
// have fresh competitor data (< CACHE_TTL_MS old).
// Used to skip those listings and save eBay API calls.
// ----------------------------------------------------------------
async function fetchFreshCacheMap(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  listingIds: string[],
): Promise<Record<string, string>> {
  if (listingIds.length === 0) return {};

  const freshCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from("competitor_prices")
    .select("ebay_listing_id, fetched_at")
    .eq("user_id", userId)
    .in("ebay_listing_id", listingIds)
    .gte("fetched_at", freshCutoff);

  if (error) {
    console.warn(
      `[cron] Cache map query failed for user ${userId}: ${error.message}`,
    );
    return {};
  }

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    map[row.ebay_listing_id] = row.fetched_at;
  }
  return map;
}

// ----------------------------------------------------------------
// Invoke the ebay-competitor-search function for a single listing.
// The function handles its own cache check internally — the cron's
// pre-check above is an optimisation to avoid even invoking the
// function for obviously-fresh listings.
// ----------------------------------------------------------------
async function refreshCompetitorData(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  listing: {
    listingId: string;
    title: string;
    price: number;
    categoryId?: string;
  },
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${supabaseUrl}/functions/v1/ebay-competitor-search`,
      {
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
      },
    );

    if (!resp.ok) {
      console.warn(
        `[cron] competitor-search failed for listing ${listing.listingId}: ${resp.status}`,
      );
      return false;
    }

    let result: any;
    try {
      result = JSON.parse(await resp.text());
    } catch (e) {
      console.warn(
        `[cron] Failed to parse competitor-search response for listing ${listing.listingId}: ${e}`,
      );
      return false;
    }

    if (result.error) {
      console.warn(
        `[cron] competitor-search error for listing ${listing.listingId}:`,
        result.error,
      );
      return false;
    }

    if (result.fromCache) {
      // Function returned cached data — counts as success even though
      // no eBay call was made (cache TTL check inside the function)
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
// Intended to be called by Supabase cron schedule.
// Suggested schedule: every 8 hours — "0 */8 * * *"
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(
    "[competitor-prices-cron] Starting competitor price refresh run...",
  );
  const startTime = Date.now();

  // Step 1: Clean up expired rows
  const { error: cleanupErr } = await supabase
    .from("competitor_prices")
    .delete()
    .lt("expires_at", new Date().toISOString());

  if (cleanupErr) {
    console.warn(
      "[competitor-prices-cron] Cleanup error (non-fatal):",
      cleanupErr.message,
    );
  } else {
    console.log("[competitor-prices-cron] Expired rows cleaned up");
  }

  // Step 2: Fetch all users with a connected, non-expired eBay token
  const { data: users, error: usersErr } = await supabase
    .from("profiles")
    .select("id")
    .not("ebay_access_token", "is", null)
    .gt("ebay_token_expires_at", new Date().toISOString());

  if (usersErr) {
    console.error(
      "[competitor-prices-cron] Failed to fetch users:",
      usersErr.message,
    );
    return new Response(
      JSON.stringify({ error: usersErr.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const userIds: string[] = (users ?? []).map((u: { id: string }) => u.id);
  console.log(
    `[competitor-prices-cron] Processing ${userIds.length} connected user(s)`,
  );

  let totalListings = 0;
  let totalRefreshed = 0;
  let totalSkipped = 0;
  let totalFresh = 0;

  // Step 3: For each user, fetch their active listings and refresh stale ones
  for (const userId of userIds) {
    const listings = await fetchActiveListings(supabaseUrl, serviceKey, userId);
    console.log(
      `[competitor-prices-cron] User ${userId}: ${listings.length} active listing(s)`,
    );
    totalListings += listings.length;

    if (listings.length === 0) continue;

    // Pre-check which listings already have fresh cache — skip those entirely
    const listingIds = listings.map((l) => l.listingId);
    const freshMap = await fetchFreshCacheMap(supabase, userId, listingIds);
    const freshCount = Object.keys(freshMap).length;
    const staleCount = listings.length - freshCount;
    totalFresh += freshCount;

    console.log(
      `[competitor-prices-cron] User ${userId}: ${freshCount} fresh (skip), ${staleCount} stale (refresh)`,
    );

    for (const listing of listings) {
      // Skip if cache is still fresh
      if (freshMap[listing.listingId]) {
        const ageMin = Math.round(
          (Date.now() - new Date(freshMap[listing.listingId]).getTime()) /
            60000,
        );
        console.log(
          `[competitor-prices-cron] Skipping listing ${listing.listingId} (cache ${ageMin}min old)`,
        );
        totalSkipped++;
        continue;
      }

      const ok = await refreshCompetitorData(
        supabaseUrl,
        serviceKey,
        userId,
        listing,
      );
      if (ok) {
        totalRefreshed++;
      } else {
        totalSkipped++;
      }

      // Throttle between eBay calls
      await sleep(SEARCH_DELAY_MS);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    users: userIds.length,
    totalListings,
    fresh: totalFresh,
    refreshed: totalRefreshed,
    skipped: totalSkipped,
    elapsedSeconds: parseFloat(elapsed),
  };

  console.log("[competitor-prices-cron] Completed:", summary);

  return new Response(
    JSON.stringify({ success: true, ...summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
