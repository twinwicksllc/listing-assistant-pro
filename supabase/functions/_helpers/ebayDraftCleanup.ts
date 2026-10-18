// ----------------------------------------------------------------
// Core logic for ebay-draft-cleanup: finds out whether each candidate
// Inventory API offer is a safe-to-delete leftover (UNPUBLISHED, SKU matches,
// not behind a live listing) and deletes it.
//
// Why a caller-supplied candidate list instead of enumerating: the bulk offer
// list (GET /sell/inventory/v1/offer) fails for the whole account while any
// hyphenated SKU exists (errorId 25707 -- see ebayOfferLookup.ts and
// CLAUDE.md's eBay integration notes), and ~800 legacy hyphenated SKUs are
// permanent. Looking an offer up by its own offerId does not run that
// account-wide validation, so we verify one offer at a time instead.
//
// Safety model, in order of importance:
//   1. Only the OFFER is ever deleted -- never the inventory item, and never
//      a published offer (that would need a withdraw, which CLAUDE.md says not
//      to automate without approval).
//   2. Every offer is re-read from eBay immediately before deletion; the
//      caller's CSV is a hint, not proof.
//   3. If the list of live listings cannot be read completely, nothing is
//      deleted (fail closed).
// ----------------------------------------------------------------

// Offers verified/deleted in parallel. Small on purpose: each deletion is a
// write against the seller's real account.
const CONCURRENCY = 5;
const CALL_TIMEOUT_MS = 8_000;
// Stop starting new work once this much wall clock has passed, leaving room
// in the ~150s gateway budget. Unreached candidates come back as "not_reached"
// and the caller simply sends them again.
const BUDGET_MS = 90_000;

// The live-listing phase runs BEFORE the per-candidate budget above, so it needs
// its own overall deadline: 50 pages x 16s would otherwise blow the gateway
// budget and kill the request without the fail-closed response.
const LIVE_PHASE_BUDGET_MS = 30_000;

export const MAX_CANDIDATES_PER_CALL = 100;

export type Candidate = { offerId: string; sku: string; listingId?: string };

export type Decision =
  | "delete"
  | "deleted"
  | "already_gone"
  | "skip_published"
  | "skip_live_listing"
  | "skip_sku_mismatch"
  | "skip_unexpected_status"
  | "not_reached"
  | "error";

export type OfferResult = {
  offerId: string;
  sku: string;
  decision: Decision;
  detail?: string;
  // The offer as eBay returned it just before deletion. Returned to the
  // caller so there is a restorable record of everything that was removed.
  backup?: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; candidates: Candidate[] }
  | { ok: false; error: string };

export function parseCandidates(input: unknown): ParseResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: "candidates must be a non-empty array" };
  }
  if (input.length > MAX_CANDIDATES_PER_CALL) {
    return {
      ok: false,
      error: `at most ${MAX_CANDIDATES_PER_CALL} candidates per call`,
    };
  }
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of input) {
    const c = raw as Record<string, unknown>;
    const offerId = String(c?.offerId ?? "").trim();
    const sku = String(c?.sku ?? "").trim();
    const listingId = String(c?.listingId ?? "").trim();
    // offerIds are numeric; this also keeps anything odd out of the URL path.
    if (!/^\d{1,20}$/.test(offerId)) {
      return { ok: false, error: `invalid offerId: ${offerId.slice(0, 30)}` };
    }
    if (!sku || sku.length > 100) {
      return { ok: false, error: `missing or invalid sku for offer ${offerId}` };
    }
    if (listingId && !/^\d{1,20}$/.test(listingId)) {
      return { ok: false, error: `invalid listingId for offer ${offerId}` };
    }
    if (seen.has(offerId)) {
      return { ok: false, error: `duplicate offerId ${offerId}` };
    }
    seen.add(offerId);
    out.push({ offerId, sku, ...(listingId ? { listingId } : {}) });
  }
  return { ok: true, candidates: out };
}

export type BodyParse =
  | { ok: true; candidates: unknown; dryRun: boolean }
  | { ok: false; error: string };

// Validates the request body shape before any field is read: a JSON body of
// `null` (or an array, or a scalar) is a client error, not a 500 crash.
// dryRun defaults to true; only an explicit boolean false enables deletion.
export function parseBody(body: unknown): BodyParse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as { candidates?: unknown; dryRun?: unknown };
  return { ok: true, candidates: b.candidates, dryRun: b.dryRun !== false };
}

// ---- live listings (Trading API) -------------------------------------------

export type LiveListings = { itemIds: Set<string>; skus: Set<string> };

export type LiveListingsResult =
  | { ok: true; live: LiveListings }
  | { ok: false; error: string };

const MAX_ACTIVE_PAGES = 50;

export function tradingApiUrlFor(apiBase: string): string {
  return apiBase.includes("sandbox") ? "https://api.sandbox.ebay.com/ws/api.dll" : "https://api.ebay.com/ws/api.dll";
}

function xmlTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() ?? "";
}

// Reads every ACTIVE listing, whichever way it was created (Inventory API,
// Seller Hub or Trading API), so a draft that still sits behind a live
// listing is recognised. Any failure returns ok:false -- the caller must not
// delete on a partial view of what is live.
export async function fetchLiveListings(
  tradingUrl: string,
  userToken: string,
  fetchFn: typeof fetch = fetch,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<LiveListingsResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? LIVE_PHASE_BUDGET_MS);
  const itemIds = new Set<string>();
  const skus = new Set<string>();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page++) {
    if (page > MAX_ACTIVE_PAGES) {
      return { ok: false, error: "active listing list exceeds page limit" };
    }
    // Never let one page run past the phase deadline: a slow or large account
    // must fail closed (nothing deleted) rather than be killed by the gateway.
    const remaining = deadline - now();
    if (remaining <= 0) {
      return { ok: false, error: "live listing phase exceeded its deadline" };
    }
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <SoldList><Include>false</Include></SoldList>
  <UnsoldList><Include>false</Include></UnsoldList>
  <ScheduledList><Include>false</Include></ScheduledList>
</GetMyeBaySellingRequest>`;
    let text: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(remaining, CALL_TIMEOUT_MS * 2));
      try {
        const resp = await fetchFn(tradingUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
            "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
            "X-EBAY-API-SITEID": "0",
            "Content-Type": "text/xml",
            "X-EBAY-API-IAF-TOKEN": userToken,
          },
          body: xml,
        });
        text = await resp.text();
        if (!resp.ok) {
          return { ok: false, error: `GetMyeBaySelling HTTP ${resp.status}` };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return { ok: false, error: `GetMyeBaySelling failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!text.includes("<Ack>Success</Ack>") && !text.includes("<Ack>Warning</Ack>")) {
      return { ok: false, error: "GetMyeBaySelling did not return Success" };
    }
    const active = text.match(/<ActiveList[^>]*>([\s\S]*?)<\/ActiveList>/)?.[1] ?? "";
    // An account with no active listings legitimately has no ActiveList
    // items; but a response with no pagination block at all is not a
    // trustworthy "zero".
    const pages = active.match(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/)?.[1];
    if (pages === undefined) {
      return { ok: false, error: "GetMyeBaySelling response had no pagination block" };
    }
    totalPages = parseInt(pages, 10);
    for (const m of active.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
      const id = xmlTag(m[1], "ItemID");
      if (id) itemIds.add(id);
      const sku = xmlTag(m[1], "SKU");
      if (sku) skus.add(sku);
    }
  }
  return { ok: true, live: { itemIds, skus } };
}

// ---- per-offer decision ----------------------------------------------------

type EbayOfferShape = {
  offerId?: string;
  sku?: string;
  status?: string;
  listing?: { listingId?: string; listingStatus?: string };
};

// Pure: decides what to do with one candidate given what eBay says about it.
// "delete" is only returned when every protection passes.
export function decide(
  candidate: Candidate,
  offer: EbayOfferShape,
  live: LiveListings,
): { decision: Decision; detail?: string } {
  if (offer.sku !== candidate.sku) {
    return { decision: "skip_sku_mismatch", detail: "offer sku differs from the list" };
  }
  if (offer.status === "PUBLISHED") {
    return { decision: "skip_published", detail: "offer is published; not touched" };
  }
  if (offer.status !== "UNPUBLISHED") {
    return { decision: "skip_unexpected_status", detail: `status ${String(offer.status)}` };
  }
  const listingId = offer.listing?.listingId || candidate.listingId || "";
  if (offer.listing?.listingStatus === "ACTIVE") {
    return { decision: "skip_live_listing", detail: "eBay reports the listing as ACTIVE" };
  }
  if (listingId && live.itemIds.has(listingId)) {
    return { decision: "skip_live_listing", detail: `listing ${listingId} is active` };
  }
  if (live.skus.has(candidate.sku)) {
    return { decision: "skip_live_listing", detail: "an active listing uses this sku" };
  }
  return { decision: "delete" };
}

export type OfferReadResult =
  | { kind: "ok"; offer: EbayOfferShape }
  | { kind: "missing" }
  | { kind: "unauthorized" }
  | { kind: "error"; detail: string };

async function ebayCall(
  url: string,
  method: "GET" | "DELETE",
  userToken: string,
  fetchFn: typeof fetch,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const resp = await fetchFn(url, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        "Accept-Language": "en-US",
      },
    });
    // Always read the body so the connection is released (same reason as
    // ebayOfferLookup.ts).
    const text = await resp.text();
    return { status: resp.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function readOffer(
  apiBase: string,
  offerId: string,
  userToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<OfferReadResult> {
  try {
    const { status, text } = await ebayCall(
      `${apiBase}/sell/inventory/v1/offer/${offerId}`,
      "GET",
      userToken,
      fetchFn,
    );
    if (status === 401) return { kind: "unauthorized" };
    if (status === 404) return { kind: "missing" };
    if (status < 200 || status >= 300) {
      return { kind: "error", detail: `GET offer HTTP ${status}: ${text.slice(0, 200)}` };
    }
    try {
      return { kind: "ok", offer: JSON.parse(text) };
    } catch {
      return { kind: "error", detail: "GET offer returned non-JSON" };
    }
  } catch (e) {
    return { kind: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOffer(
  apiBase: string,
  offerId: string,
  userToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; unauthorized?: boolean; detail?: string }> {
  try {
    const { status, text } = await ebayCall(
      `${apiBase}/sell/inventory/v1/offer/${offerId}`,
      "DELETE",
      userToken,
      fetchFn,
    );
    if (status === 204 || status === 200) return { ok: true };
    if (status === 404) return { ok: true, detail: "already gone" };
    if (status === 401) return { ok: false, unauthorized: true, detail: "token rejected" };
    return { ok: false, detail: `DELETE offer HTTP ${status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ---- orchestration ---------------------------------------------------------

export type RunParams = {
  candidates: Candidate[];
  apiBase: string;
  userToken: string;
  live: LiveListings;
  // false = verify only. Deletion needs an explicit false.
  dryRun: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
};

export type RunResult = {
  results: OfferResult[];
  unauthorized: boolean;
  summary: Record<string, number>;
};

export async function runCleanup(p: RunParams): Promise<RunResult> {
  const fetchFn = p.fetchFn ?? fetch;
  const now = p.now ?? Date.now;
  const startedAt = now();
  const results = new Map<string, OfferResult>();
  let unauthorized = false;

  const work = async (c: Candidate) => {
    const read = await readOffer(p.apiBase, c.offerId, p.userToken, fetchFn);
    if (read.kind === "unauthorized") {
      unauthorized = true;
      results.set(c.offerId, { offerId: c.offerId, sku: c.sku, decision: "error", detail: "token rejected" });
      return;
    }
    if (read.kind === "missing") {
      results.set(c.offerId, { offerId: c.offerId, sku: c.sku, decision: "already_gone" });
      return;
    }
    if (read.kind === "error") {
      results.set(c.offerId, { offerId: c.offerId, sku: c.sku, decision: "error", detail: read.detail });
      return;
    }
    const verdict = decide(c, read.offer, p.live);
    if (verdict.decision !== "delete") {
      results.set(c.offerId, { offerId: c.offerId, sku: c.sku, ...verdict });
      return;
    }
    if (p.dryRun) {
      results.set(c.offerId, { offerId: c.offerId, sku: c.sku, decision: "delete", detail: "dry run: would delete" });
      return;
    }
    const del = await deleteOffer(p.apiBase, c.offerId, p.userToken, fetchFn);
    if (del.unauthorized) unauthorized = true;
    results.set(c.offerId, {
      offerId: c.offerId,
      sku: c.sku,
      decision: del.ok ? "deleted" : "error",
      ...(del.detail ? { detail: del.detail } : {}),
      ...(del.ok ? { backup: read.offer as Record<string, unknown> } : {}),
    });
  };

  for (let i = 0; i < p.candidates.length; i += CONCURRENCY) {
    if (unauthorized || now() - startedAt >= BUDGET_MS) break;
    await Promise.all(p.candidates.slice(i, i + CONCURRENCY).map(work));
  }

  const ordered: OfferResult[] = p.candidates.map((c) =>
    results.get(c.offerId) ?? { offerId: c.offerId, sku: c.sku, decision: "not_reached" as Decision }
  );
  const summary: Record<string, number> = {};
  for (const r of ordered) summary[r.decision] = (summary[r.decision] ?? 0) + 1;
  return { results: ordered, unauthorized, summary };
}

// ---- access control --------------------------------------------------------

// Deny by default: this function deletes offers on a real seller account, so
// it only runs for user ids listed in EBAY_DRAFT_CLEANUP_USER_IDS
// (comma-separated). An unset or empty list allows nobody.
export function isAllowedUser(userId: string | null | undefined, allowList: string | undefined): boolean {
  if (!userId || !allowList) return false;
  return allowList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}
