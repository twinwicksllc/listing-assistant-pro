// ----------------------------------------------------------------
// Looks up eBay Inventory API offers one SKU at a time via
// GET /sell/inventory/v1/offer?sku={sku}, instead of the unfiltered bulk
// list (GET /sell/inventory/v1/offer?limit=...&offset=...).
//
// Why this exists: the bulk list validates every SKU across the whole
// account, and a single hyphenated SKU (errorId 25707 -- eBay allows only
// alphanumeric characters) fails that call for every listing, not just the
// offending one. A single-SKU query does not trigger that account-wide
// validation, so it succeeds for every listing with a valid SKU even while
// ~805 legacy hyphenated SKUs remain on the account (2026-09-25; see
// CLAUDE.md's eBay integration surface notes -- there is no supported way to
// rename a SKU on a live offer, so those legacy SKUs are permanent).
//
// ebay-listings/index.ts can't import this and call it inline for the same
// reason ebayGetItemCategory.ts is standalone: that file calls serve() at
// module load.
// ----------------------------------------------------------------

// Parallel offer lookups in flight at once -- mirrors
// ebayGetItemCategory.ts's GET_ITEM_CONCURRENCY. A single-SKU offer lookup
// is a lighter call than Trading API's GetItem (no XML parsing on eBay's
// side), so this can run a bit wider without extra risk.
const OFFER_LOOKUP_CONCURRENCY = 15;

// Per-call ceiling covering headers AND body -- same rationale as
// ebayGetItemCategory.ts's GET_ITEM_TIMEOUT_MS: one hung eBay response must
// not stall its whole Promise.all batch.
const OFFER_LOOKUP_TIMEOUT_MS = 8_000;

// Stop starting new batches once this much wall clock has gone by, leaving
// room in the ~150s gateway budget for the enrichment (inventory item
// detail, analytics, watch data) that runs after this. SKUs not reached
// simply fall back to whatever the Trading API merge already covers.
const OFFER_LOOKUP_BUDGET_MS = 45_000;

export type EbayOffer = {
  offerId: string;
  sku: string;
  // deno-lint-ignore no-explicit-any -- passed straight through to the
  // existing enrichment pipeline in ebay-listings/index.ts, which already
  // treats offers as loosely-typed `any`.
  raw: any;
};

export type OffersBySkuResult = {
  offers: Record<string, EbayOffer>;
  // True if any lookup got a 401 -- an expired/invalid token, not a "this
  // SKU isn't live" case. The caller should treat this the same as the old
  // bulk-list call's 401 (surface needsAuth), not silently return a partial
  // listing set as if the account genuinely had fewer live offers.
  unauthorized: boolean;
};

// Returns a map of sku -> offer for every SKU eBay answered with a
// PUBLISHED offer. A SKU that 404s (no longer live -- sold, ended, or never
// existed) or otherwise fails is simply absent from the map; the caller's
// Trading API merge is the safety net for anything missing here.
export async function fetchOffersBySku(
  skus: string[],
  apiBase: string,
  userToken: string,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<OffersBySkuResult> {
  const result: Record<string, EbayOffer> = {};
  let unauthorized = false;
  const startedAt = now();

  const lookup = async (sku: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OFFER_LOOKUP_TIMEOUT_MS);
    try {
      const resp = await fetchFn(
        `${apiBase}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
        {
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
          },
          signal: controller.signal,
        },
      );
      if (!resp.ok) {
        if (resp.status === 401) {
          unauthorized = true;
        } else if (resp.status !== 404) {
          const bodyText = await resp.text();
          console.warn(
            `[ebay-listings] Offer lookup HTTP ${resp.status} for sku "${sku}": ${bodyText.slice(0, 300)}`,
          );
        }
        return;
      }
      let data: { offers?: unknown[] };
      try {
        data = JSON.parse(await resp.text());
      } catch (e) {
        console.warn(`[ebay-listings] Failed to parse offer lookup response for sku "${sku}": ${e}`);
        return;
      }
      // sku is a query filter, not a path param -- eBay returns an array
      // (typically one PUBLISHED offer per SKU in this app's usage), not a
      // single object. An empty array means no live offer for this SKU.
      const offer = (data.offers ?? [])[0] as { offerId?: string } | undefined;
      if (offer?.offerId) {
        result[sku] = { offerId: offer.offerId, sku, raw: offer };
      }
    } catch (e) {
      const reason = controller.signal.aborted ? `timed out after ${OFFER_LOOKUP_TIMEOUT_MS}ms` : String(e);
      console.warn(`[ebay-listings] Offer lookup failed for sku "${sku}": ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  };

  for (let i = 0; i < skus.length; i += OFFER_LOOKUP_CONCURRENCY) {
    if (now() - startedAt >= OFFER_LOOKUP_BUDGET_MS) {
      console.warn(
        `[ebay-listings] Offer lookup budget reached; ${skus.length - i} SKUs left to the Trading API merge`,
      );
      break;
    }
    await Promise.all(skus.slice(i, i + OFFER_LOOKUP_CONCURRENCY).map(lookup));
  }

  return { offers: result, unauthorized };
}
