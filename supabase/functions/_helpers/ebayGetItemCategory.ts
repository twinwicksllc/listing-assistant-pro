// ----------------------------------------------------------------
// Looks up each listing's PrimaryCategory.CategoryID via the Trading API's
// GetItem call. Used by ebayInventorySync.ts to backfill
// user_active_listings.category_id for listings ebay-listings returned
// without one.
//
// Why this exists separately from ebay-listings' fetchWatchDataForListings
// (which reads the same field): that GetItem call only runs on ebay-listings'
// Inventory API path. When the Inventory API /offer call rejects the account
// (errorId 25707, invalid SKU -- the production account hits this on every
// sync as of 2026-09-24), ebay-listings falls back to GetMyeBaySelling, whose
// ActiveList items carry no CategoryID at all, so every row came back blank.
// ebay-listings/index.ts can't be imported from here (it calls serve() at
// module load), hence the small standalone helper.
// ----------------------------------------------------------------

// Parallel GetItem calls in flight at once -- bounded so a large backfill
// doesn't fire hundreds of simultaneous requests from one worker.
const GET_ITEM_CONCURRENCY = 10;

// Per-call ceiling covering headers AND body. Without it one hung eBay
// response stalls its whole Promise.all batch, and the sync never reaches
// its upsert/prune before the Edge gateway kills the invocation.
const GET_ITEM_TIMEOUT_MS = 8_000;

// Stop starting new batches once this much wall clock has gone by, leaving
// the rest of the ~150s gateway budget for the upsert/prune that follow.
// Items not reached are simply looked up on the next sync.
const BACKFILL_BUDGET_MS = 60_000;

export function tradingApiUrlFor(tokenUrl: string): string {
  return tokenUrl.includes("sandbox") ? "https://api.sandbox.ebay.com/ws/api.dll" : "https://api.ebay.com/ws/api.dll";
}

// Pulls <PrimaryCategory><CategoryID> out of a GetItem response. eBay nests
// category under PrimaryCategory, not as a bare top-level CategoryID tag.
export function parsePrimaryCategoryId(xmlText: string): string | undefined {
  const primary = xmlText.match(/<PrimaryCategory[^>]*>([\s\S]*?)<\/PrimaryCategory>/);
  const id = primary?.[1].match(/<CategoryID[^>]*>([\s\S]*?)<\/CategoryID>/)?.[1]?.trim();
  return id || undefined;
}

// Returns a map of itemId -> categoryId for every item eBay answered with a
// category. Items whose call failed or returned no category are simply
// absent from the map, so the caller leaves them for the next sync.
export async function fetchPrimaryCategoryIds(
  itemIds: string[],
  tradingUrl: string,
  userToken: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const startedAt = now();

  const lookup = async (itemId: string) => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${itemId}</ItemID>
  <OutputSelector>ItemID,PrimaryCategory.CategoryID</OutputSelector>
</GetItemRequest>`;
    // Same abort-covers-the-body pattern as fetchWithTimeout.ts, inlined so
    // fetchFn stays injectable for tests.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GET_ITEM_TIMEOUT_MS);
    try {
      const resp = await fetchFn(tradingUrl, {
        method: "POST",
        headers: {
          "X-EBAY-API-CALL-NAME": "GetItem",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
          "X-EBAY-API-SITEID": "0",
          "Content-Type": "text/xml",
          "X-EBAY-API-IAF-TOKEN": userToken,
        },
        body: xml,
        signal: controller.signal,
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        console.warn(
          `[inventory-sync] GetItem category lookup HTTP ${resp.status} for ${itemId}: ${bodyText.slice(0, 300)}`,
        );
        return;
      }
      // The Trading API returns HTTP 200 even on a business-logic failure --
      // Ack is Failure/PartialFailure with the real error in <Errors>, not in
      // the status code, so resp.ok alone can't tell success from failure.
      const ackFailed = /<Ack>(Failure|PartialFailure)<\/Ack>/.test(bodyText);
      const categoryId = parsePrimaryCategoryId(bodyText);
      if (categoryId) {
        result[itemId] = categoryId;
      } else if (ackFailed) {
        const shortMessage = bodyText.match(/<ShortMessage>([\s\S]*?)<\/ShortMessage>/)?.[1]?.trim();
        console.warn(
          `[inventory-sync] GetItem Ack failure for ${itemId}: ${shortMessage ?? bodyText.slice(0, 300)}`,
        );
      } else {
        console.warn(`[inventory-sync] GetItem for ${itemId} returned no PrimaryCategory: ${bodyText.slice(0, 300)}`);
      }
    } catch (e) {
      const reason = controller.signal.aborted ? `timed out after ${GET_ITEM_TIMEOUT_MS}ms` : String(e);
      console.warn(`[inventory-sync] GetItem category lookup failed for ${itemId}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  };

  for (let i = 0; i < itemIds.length; i += GET_ITEM_CONCURRENCY) {
    if (now() - startedAt >= BACKFILL_BUDGET_MS) {
      console.warn(
        `[inventory-sync] Category backfill budget reached; ${itemIds.length - i} lookups deferred to next sync`,
      );
      break;
    }
    await Promise.all(itemIds.slice(i, i + GET_ITEM_CONCURRENCY).map(lookup));
  }

  return result;
}
