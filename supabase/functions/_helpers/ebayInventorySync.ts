// ----------------------------------------------------------------
// Syncs one user's active eBay listings into the local user_active_listings
// cache table, so the competitor-price refresh cursor (competitor-prices-cron)
// never has to call the heavy ebay-listings function itself. Used by
// inventory-sync-cron on a slow, capped cadence -- see that function and
// supabase/migrations/20260818000000_create_user_active_listings.sql for the
// full WORKER_RESOURCE_LIMIT incident this decoupling fixes.
//
// fetchActiveListings below is extracted verbatim from the previous
// competitor-prices-cron/index.ts (same token-refresh-then-enumerate logic;
// nothing behavioral changed) -- only its caller and what happens to its
// result moved.
// ----------------------------------------------------------------

import { EbayTokenRefreshConfig, refreshEbayAccessToken } from "./ebayTokenRefresh.ts";
import { decryptToken } from "./tokenCrypto.ts";
import { fetchPrimaryCategoryIds, tradingApiUrlFor } from "./ebayGetItemCategory.ts";

type ActiveListing = { listingId: string; title: string; price: number; categoryId?: string };

// ----------------------------------------------------------------
// Fetch active listings for a user via the ebay-listings function.
// Returns the listings plus the (possibly just-refreshed) eBay user token,
// which the category backfill below reuses for its GetItem calls; null on
// any failure.
// ----------------------------------------------------------------
async function fetchActiveListings(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  // deno-lint-ignore no-explicit-any -- matches the loose typing already
  // used throughout this file for the supabase-js client.
  supabase: any,
  ebayConfig: EbayTokenRefreshConfig,
): Promise<{ listings: ActiveListing[]; userToken: string } | null> {
  const profileResp = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=ebay_access_token,ebay_token_expires_at,ebay_refresh_token`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  if (!profileResp.ok) {
    console.warn(`[inventory-sync] Failed to fetch profile for user ${userId}`);
    return null;
  }

  let profiles: any;
  try {
    profiles = JSON.parse(await profileResp.text());
  } catch (e) {
    console.warn(
      `[inventory-sync] Failed to parse profile response for user ${userId}: ${e}`,
    );
    return null;
  }

  let token = await decryptToken(profiles?.[0]?.ebay_access_token);
  const refreshToken = await decryptToken(profiles?.[0]?.ebay_refresh_token);
  const expiresAt = profiles?.[0]?.ebay_token_expires_at;
  const isExpiredOrMissing = !token ||
    (expiresAt && new Date(expiresAt) < new Date());

  if (isExpiredOrMissing) {
    if (!refreshToken) {
      console.log(`[inventory-sync] No eBay refresh token for user ${userId}, skipping`);
      return null;
    }
    const refreshResult = await refreshEbayAccessToken(
      supabase,
      userId,
      refreshToken,
      ebayConfig,
    );
    if (!refreshResult.ok) {
      console.warn(
        `[inventory-sync] eBay token refresh failed for user ${userId}: ${refreshResult.error}`,
      );
      return null;
    }
    token = refreshResult.accessToken;
  }
  if (!token) return null;

  const listingsResp = await fetch(
    `${supabaseUrl}/functions/v1/ebay-listings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userToken: token }),
    },
  );

  if (!listingsResp.ok) {
    console.warn(
      `[inventory-sync] ebay-listings failed for user ${userId}: ${listingsResp.status}`,
    );
    return null;
  }

  let data: any;
  try {
    data = JSON.parse(await listingsResp.text());
  } catch (e) {
    console.warn(
      `[inventory-sync] Failed to parse ebay-listings response for user ${userId}: ${e}`,
    );
    return null;
  }

  const listings = (data?.listings ?? [])
    .filter((l: Record<string, unknown>) => l.listingId && l.title)
    .map((l: Record<string, unknown>) => ({
      listingId: String(l.listingId),
      title: String(l.title),
      price: Number(l.price ?? 0),
      categoryId: l.categoryId ? String(l.categoryId) : undefined,
    }));
  return { listings, userToken: token };
}

// ----------------------------------------------------------------
// Fills in categoryId for listings ebay-listings returned without one.
// ebay-listings' Trading API fallback (taken whenever the Inventory API
// rejects the account -- see ebayGetItemCategory.ts) never returns a
// category, so without this every row stays NULL and getItems refresh plus
// the signature cache, both keyed on category_id, sit idle.
//
// Cost control: only listings with no category_id already cached get a
// GetItem call. That's one call per listing on the first backfill, then
// only newly-listed items after that -- not N calls every sync.
// ----------------------------------------------------------------
export async function backfillMissingCategoryIds(
  // deno-lint-ignore no-explicit-any -- matches the loose typing already
  // used throughout this codebase for the supabase-js client.
  supabase: any,
  userId: string,
  listings: ActiveListing[],
  lookupCategoryIds: (itemIds: string[]) => Promise<Record<string, string>>,
): Promise<ActiveListing[]> {
  const missing = listings.filter((l) => !l.categoryId);
  if (missing.length === 0) return listings;

  // A failed lookup here must not be read as "nothing cached" -- that would
  // re-fire GetItem for every listing. Skip the backfill this pass instead.
  const { data: cachedRows, error } = await supabase
    .from("user_active_listings")
    .select("ebay_listing_id")
    .eq("user_id", userId)
    .not("category_id", "is", null);
  if (error) {
    console.warn(
      `[inventory-sync] Category backfill skipped for user ${userId}, cache lookup failed: ${error.message}`,
    );
    return listings;
  }

  const alreadyCached = new Set((cachedRows ?? []).map((r: { ebay_listing_id: string }) => r.ebay_listing_id));
  const toLookUp = missing.map((l) => l.listingId).filter((id) => !alreadyCached.has(id));
  if (toLookUp.length === 0) return listings;

  const found = await lookupCategoryIds(toLookUp);
  console.log(
    `[inventory-sync] Category backfill for user ${userId}: looked up ${toLookUp.length}, found ${
      Object.keys(found).length
    }`,
  );
  return listings.map((l) => (!l.categoryId && found[l.listingId] ? { ...l, categoryId: found[l.listingId] } : l));
}

// ----------------------------------------------------------------
// Syncs one user's active listings into user_active_listings: enumerates
// live via fetchActiveListings above, upserts each (last_seen_at set to this
// pass's timestamp, first_seen_at omitted so it's only set by the column
// default on first insert), then prunes any row for this user not touched
// by this pass -- those listings ended/sold since the last sync. Also
// deletes any now-stale competitor_prices rows for the pruned listings, so
// the price-refresh cursor (get_next_competitor_price_batch) never wastes a
// slot on a listing that no longer exists.
// ----------------------------------------------------------------
export async function syncUserInventory(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  // deno-lint-ignore no-explicit-any -- matches the loose typing already
  // used throughout this codebase for the supabase-js client.
  supabase: any,
  ebayConfig: EbayTokenRefreshConfig,
): Promise<{ listingCount: number; endedCount: number }> {
  const syncStartedAt = new Date().toISOString();
  let result: { listingCount: number; endedCount: number } = { listingCount: 0, endedCount: 0 };
  try {
    const fetched = await fetchActiveListings(
      supabaseUrl,
      serviceKey,
      userId,
      supabase,
      ebayConfig,
    );

    const listings = fetched
      ? await backfillMissingCategoryIds(
        supabase,
        userId,
        fetched.listings,
        (itemIds) => fetchPrimaryCategoryIds(itemIds, tradingApiUrlFor(ebayConfig.tokenUrl), fetched.userToken),
      )
      : null;

    result = await syncListingsIntoCache(supabase, userId, syncStartedAt, listings);
  } catch (e) {
    console.warn(`[inventory-sync] Sync failed for user ${userId}: ${e}`);
  }

  // Set unconditionally, regardless of outcome above -- see this column's
  // own migration comment (20260819000000) for why: a user whose sync
  // attempt finds zero listings (or fails) must still be marked as
  // attempted, or get_users_for_inventory_sync would re-select them on
  // every single tick forever instead of waiting out the staleness window
  // like everyone else.
  const { error: markSyncedErr } = await supabase
    .from("profiles")
    .update({ last_ebay_sync_at: syncStartedAt })
    .eq("id", userId);

  if (markSyncedErr) {
    console.warn(
      `[inventory-sync] Failed to record last_ebay_sync_at for user ${userId}: ${markSyncedErr.message}`,
    );
  }

  return result;
}

// ----------------------------------------------------------------
// Upserts fetched listings into user_active_listings and prunes anything
// for this user not touched by this pass (ended/sold since the last sync),
// cleaning up the corresponding competitor_prices rows too. Extracted from
// syncUserInventory so the unconditional last_ebay_sync_at update above
// isn't duplicated across every early-return path.
//
// category_id is only written when this pass actually has one: omitting the
// key from a row (rather than sending null) makes the upsert's ON CONFLICT
// UPDATE leave the stored value alone, so a listing whose category was
// backfilled once keeps it on every later pass that comes back blank.
// ----------------------------------------------------------------
export async function syncListingsIntoCache(
  // deno-lint-ignore no-explicit-any -- matches the loose typing already
  // used throughout this codebase for the supabase-js client.
  supabase: any,
  userId: string,
  syncStartedAt: string,
  listings: ActiveListing[] | null,
): Promise<{ listingCount: number; endedCount: number }> {
  if (!listings) {
    return { listingCount: 0, endedCount: 0 };
  }

  if (listings.length > 0) {
    // Two batches, because supabase-js builds a bulk upsert's column list
    // from the union of all rows' keys -- a single mixed batch would send
    // null category_id for the rows that omitted it, clobbering them anyway.
    const toRow = (l: ActiveListing) => ({
      user_id: userId,
      ebay_listing_id: l.listingId,
      title: l.title,
      price: l.price,
      ...(l.categoryId ? { category_id: l.categoryId } : {}),
      last_seen_at: syncStartedAt,
    });
    const batches = [
      listings.filter((l) => l.categoryId),
      listings.filter((l) => !l.categoryId),
    ].filter((b) => b.length > 0);

    for (const batch of batches) {
      const { error: upsertErr } = await supabase
        .from("user_active_listings")
        .upsert(batch.map(toRow), { onConflict: "user_id,ebay_listing_id" });

      if (upsertErr) {
        console.warn(
          `[inventory-sync] Upsert failed for user ${userId}: ${upsertErr.message}`,
        );
        return { listingCount: 0, endedCount: 0 };
      }
    }
  }

  const { data: ended, error: pruneErr } = await supabase
    .from("user_active_listings")
    .delete()
    .eq("user_id", userId)
    .lt("last_seen_at", syncStartedAt)
    .select("ebay_listing_id");

  if (pruneErr) {
    console.warn(
      `[inventory-sync] Prune failed for user ${userId}: ${pruneErr.message}`,
    );
    return { listingCount: listings.length, endedCount: 0 };
  }

  const endedIds = (ended ?? []).map((r: { ebay_listing_id: string }) => r.ebay_listing_id);
  if (endedIds.length > 0) {
    const { error: cpDeleteErr } = await supabase
      .from("competitor_prices")
      .delete()
      .eq("user_id", userId)
      .in("ebay_listing_id", endedIds);

    if (cpDeleteErr) {
      console.warn(
        `[inventory-sync] Failed to clean up competitor_prices for ended listings, user ${userId}: ${cpDeleteErr.message}`,
      );
    }
  }

  return { listingCount: listings.length, endedCount: endedIds.length };
}
