import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type Candidate,
  decide,
  fetchLiveListings,
  isAllowedUser,
  MAX_CANDIDATES_PER_CALL,
  parseBody,
  parseCandidates,
  runCleanup,
  tradingApiUrlFor,
} from "./ebayDraftCleanup.ts";

// ebay-draft-cleanup deletes offers on a real seller account, so these tests
// pin every protection: only UNPUBLISHED offers whose SKU matches the list and
// that are not behind a live listing may be deleted, a dry run never writes,
// and an incomplete view of live listings blocks deletion.

const NO_LIVE = { itemIds: new Set<string>(), skus: new Set<string>() };
const API = "https://api.ebay.com";

function cand(offerId: string, sku = `LA-${offerId}`, listingId?: string): Candidate {
  return { offerId, sku, ...(listingId ? { listingId } : {}) };
}

// ---- parseCandidates -------------------------------------------------------

Deno.test("parseCandidates: accepts valid candidates and trims values", () => {
  const r = parseCandidates([{ offerId: " 123 ", sku: " LA-abc ", listingId: "456" }, {
    offerId: "124",
    sku: "LA01000",
  }]);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.candidates, [
      { offerId: "123", sku: "LA-abc", listingId: "456" },
      { offerId: "124", sku: "LA01000" },
    ]);
  }
});

Deno.test("parseCandidates: rejects non-arrays, empty arrays and oversize batches", () => {
  assertEquals(parseCandidates(undefined).ok, false);
  assertEquals(parseCandidates("x").ok, false);
  assertEquals(parseCandidates([]).ok, false);
  const big = Array.from({ length: MAX_CANDIDATES_PER_CALL + 1 }, (_, i) => ({ offerId: String(i + 1), sku: `S${i}` }));
  assertEquals(parseCandidates(big).ok, false);
  assertEquals(parseCandidates(big.slice(0, MAX_CANDIDATES_PER_CALL)).ok, true);
});

Deno.test("parseCandidates: rejects ids that could alter the request path", () => {
  assertEquals(parseCandidates([{ offerId: "12/../34", sku: "S" }]).ok, false);
  assertEquals(parseCandidates([{ offerId: "", sku: "S" }]).ok, false);
  assertEquals(parseCandidates([{ offerId: "12", sku: "S", listingId: "abc" }]).ok, false);
  assertEquals(parseCandidates([null]).ok, false);
});

Deno.test("parseCandidates: rejects missing sku and duplicate offerIds", () => {
  assertEquals(parseCandidates([{ offerId: "1", sku: "" }]).ok, false);
  assertEquals(parseCandidates([{ offerId: "1", sku: "x".repeat(101) }]).ok, false);
  assertEquals(parseCandidates([{ offerId: "1", sku: "A" }, { offerId: "1", sku: "B" }]).ok, false);
});

Deno.test("parseBody: a null, array or scalar body is a 400, not a crash", () => {
  assertEquals(parseBody(null).ok, false);
  assertEquals(parseBody(undefined).ok, false);
  assertEquals(parseBody("x").ok, false);
  assertEquals(parseBody([{ offerId: "1", sku: "S" }]).ok, false);
  assertEquals(parseBody(42).ok, false);
});

Deno.test("parseBody: dryRun defaults to true and only an explicit false enables deletion", () => {
  const a = parseBody({ candidates: [] });
  assert(a.ok);
  if (a.ok) assertEquals(a.dryRun, true);
  const b = parseBody({ candidates: [], dryRun: false });
  assert(b.ok);
  if (b.ok) assertEquals(b.dryRun, false);
  // Anything other than the boolean false must stay a dry run.
  for (const v of ["false", 0, null, undefined]) {
    const r = parseBody({ candidates: [], dryRun: v });
    assert(r.ok);
    if (r.ok) assertEquals(r.dryRun, true);
  }
});

// ---- decide ----------------------------------------------------------------

Deno.test("decide: an UNPUBLISHED offer with matching sku and no live listing is deletable", () => {
  assertEquals(decide(cand("1", "S1"), { sku: "S1", status: "UNPUBLISHED" }, NO_LIVE).decision, "delete");
});

Deno.test("decide: never deletes a PUBLISHED offer", () => {
  assertEquals(decide(cand("1", "S1"), { sku: "S1", status: "PUBLISHED" }, NO_LIVE).decision, "skip_published");
});

Deno.test("decide: any status other than UNPUBLISHED is skipped", () => {
  assertEquals(decide(cand("1", "S1"), { sku: "S1", status: "ENDED" }, NO_LIVE).decision, "skip_unexpected_status");
  assertEquals(decide(cand("1", "S1"), { sku: "S1" }, NO_LIVE).decision, "skip_unexpected_status");
});

Deno.test("decide: skips when the offer's sku differs from the list", () => {
  assertEquals(decide(cand("1", "S1"), { sku: "OTHER", status: "UNPUBLISHED" }, NO_LIVE).decision, "skip_sku_mismatch");
  assertEquals(decide(cand("1", "S1"), { status: "UNPUBLISHED" }, NO_LIVE).decision, "skip_sku_mismatch");
});

Deno.test("decide: skips when eBay reports the listing ACTIVE", () => {
  const offer = { sku: "S1", status: "UNPUBLISHED", listing: { listingId: "9", listingStatus: "ACTIVE" } };
  assertEquals(decide(cand("1", "S1"), offer, NO_LIVE).decision, "skip_live_listing");
});

Deno.test("decide: skips when the listingId is among the active listings", () => {
  const live = { itemIds: new Set(["777"]), skus: new Set<string>() };
  assertEquals(
    decide(cand("1", "S1", "777"), { sku: "S1", status: "UNPUBLISHED" }, live).decision,
    "skip_live_listing",
  );
  const withOfferListing = { sku: "S1", status: "UNPUBLISHED", listing: { listingId: "777" } };
  assertEquals(decide(cand("1", "S1"), withOfferListing, live).decision, "skip_live_listing");
});

Deno.test("decide: skips when an active listing uses the same sku", () => {
  const live = { itemIds: new Set<string>(), skus: new Set(["S1"]) };
  assertEquals(decide(cand("1", "S1"), { sku: "S1", status: "UNPUBLISHED" }, live).decision, "skip_live_listing");
});

// ---- fetchLiveListings -----------------------------------------------------

function activeListXml(
  opts: { pages?: number | null; items?: Array<{ id: string; sku?: string }>; ack?: string },
): string {
  const items = (opts.items ?? [])
    .map((i) => `<Item><ItemID>${i.id}</ItemID>${i.sku ? `<SKU>${i.sku}</SKU>` : ""}</Item>`)
    .join("");
  const pagination = opts.pages === null
    ? ""
    : `<PaginationResult><TotalNumberOfPages>${opts.pages ?? 1}</TotalNumberOfPages></PaginationResult>`;
  return `<GetMyeBaySellingResponse><Ack>${
    opts.ack ?? "Success"
  }</Ack><ActiveList>${pagination}<ItemArray>${items}</ItemArray></ActiveList></GetMyeBaySellingResponse>`;
}

Deno.test("fetchLiveListings: collects item ids and skus across pages", async () => {
  const seenPages: string[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const page = String(init.body).match(/<PageNumber>(\d+)<\/PageNumber>/)![1];
    seenPages.push(page);
    return new Response(
      activeListXml({
        pages: 2,
        items: page === "1" ? [{ id: "111", sku: "LA-aaa" }] : [{ id: "222" }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const r = await fetchLiveListings("https://trading.test", "tok", fetchFn);
  assert(r.ok);
  if (r.ok) {
    assertEquals([...r.live.itemIds].sort(), ["111", "222"]);
    assertEquals([...r.live.skus], ["LA-aaa"]);
  }
  assertEquals(seenPages, ["1", "2"]);
});

Deno.test("fetchLiveListings: an account with no active items is a valid empty set", async () => {
  const fetchFn = (async () => new Response(activeListXml({ pages: 0 }), { status: 200 })) as unknown as typeof fetch;
  const r = await fetchLiveListings("https://trading.test", "tok", fetchFn);
  assert(r.ok);
});

Deno.test("fetchLiveListings: fails closed on HTTP errors, a failed Ack, a missing pagination block and a thrown fetch", async () => {
  const mk = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
  assertEquals((await fetchLiveListings("u", "t", mk("boom", 500))).ok, false);
  assertEquals((await fetchLiveListings("u", "t", mk(activeListXml({ ack: "Failure" })))).ok, false);
  assertEquals((await fetchLiveListings("u", "t", mk(activeListXml({ pages: null })))).ok, false);
  assertEquals(
    (await fetchLiveListings("u", "t", mk("<GetMyeBaySellingResponse></GetMyeBaySellingResponse>"))).ok,
    false,
  );
  const throwing = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
  assertEquals((await fetchLiveListings("u", "t", throwing)).ok, false);
});

Deno.test("fetchLiveListings: fails closed when the live-listing phase runs out of time", async () => {
  // A multi-page account where each request eats 20s of a 30s budget: the
  // phase must give up with ok:false rather than run for 50 x 16s.
  let t = 0;
  const now = () => (t += 20_000);
  const fetchFn =
    (async () =>
      new Response(activeListXml({ pages: 3, items: [{ id: "1" }] }), { status: 200 })) as unknown as typeof fetch;
  const r = await fetchLiveListings("u", "t", fetchFn, { now, budgetMs: 30_000 });
  assertEquals(r.ok, false);
});

Deno.test("fetchLiveListings: fails closed immediately when the budget is already spent", async () => {
  let called = false;
  const fetchFn = (async () => {
    called = true;
    return new Response(activeListXml({ pages: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await fetchLiveListings("u", "t", fetchFn, { now: () => 1_000_000, budgetMs: 0 });
  assertEquals(r.ok, false);
  assertEquals(called, false);
});

Deno.test("fetchLiveListings: fails closed when the listing list is implausibly long", async () => {
  const fetchFn =
    (async () => new Response(activeListXml({ pages: 9999 }), { status: 200 })) as unknown as typeof fetch;
  assertEquals((await fetchLiveListings("u", "t", fetchFn)).ok, false);
});

Deno.test("tradingApiUrlFor: production by default, sandbox only for a sandbox api base", () => {
  assertEquals(tradingApiUrlFor("https://api.ebay.com"), "https://api.ebay.com/ws/api.dll");
  assertEquals(tradingApiUrlFor("https://api.sandbox.ebay.com"), "https://api.sandbox.ebay.com/ws/api.dll");
});

// ---- runCleanup ------------------------------------------------------------

type Offer = Record<string, unknown>;

// Fake eBay: GET /offer/{id} serves from `offers`; DELETE records the id.
function fakeEbay(offers: Record<string, Offer | number>, deleteStatus = 204) {
  const calls: Array<{ method: string; id: string }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const id = url.split("/offer/")[1];
    const method = init.method ?? "GET";
    calls.push({ method, id });
    if (method === "DELETE") return new Response(null, { status: deleteStatus });
    const o = offers[id];
    if (typeof o === "number") return new Response("err", { status: o });
    if (!o) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(o), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const run = (
  candidates: Candidate[],
  fetchFn: typeof fetch,
  dryRun: boolean,
  live = NO_LIVE,
) => runCleanup({ candidates, apiBase: API, userToken: "tok", live, dryRun, fetchFn });

Deno.test("runCleanup: a dry run reports what it would delete and never sends a DELETE", async () => {
  const { fetchFn, calls } = fakeEbay({ "1": { sku: "S1", status: "UNPUBLISHED" } });
  const r = await run([cand("1", "S1")], fetchFn, true);
  assertEquals(r.results[0].decision, "delete");
  assertEquals(r.summary, { delete: 1 });
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("runCleanup: deletes a verified UNPUBLISHED offer and returns its backup", async () => {
  const offer = { sku: "S1", status: "UNPUBLISHED", offerId: "1", pricingSummary: { price: { value: "9.99" } } };
  const { fetchFn, calls } = fakeEbay({ "1": offer });
  const r = await run([cand("1", "S1")], fetchFn, false);
  assertEquals(r.results[0].decision, "deleted");
  assertEquals(r.results[0].backup, offer);
  assertEquals(calls, [{ method: "GET", id: "1" }, { method: "DELETE", id: "1" }]);
});

Deno.test("runCleanup: never deletes a published offer, a mismatched sku or an offer behind a live listing", async () => {
  const { fetchFn, calls } = fakeEbay({
    "1": { sku: "S1", status: "PUBLISHED" },
    "2": { sku: "DIFFERENT", status: "UNPUBLISHED" },
    "3": { sku: "S3", status: "UNPUBLISHED" },
    "4": { sku: "S4", status: "UNPUBLISHED", listing: { listingStatus: "ACTIVE" } },
  });
  const live = { itemIds: new Set(["333"]), skus: new Set<string>() };
  const r = await run(
    [cand("1", "S1"), cand("2", "S2"), cand("3", "S3", "333"), cand("4", "S4")],
    fetchFn,
    false,
    live,
  );
  assertEquals(r.results.map((x) => x.decision), [
    "skip_published",
    "skip_sku_mismatch",
    "skip_live_listing",
    "skip_live_listing",
  ]);
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("runCleanup: a 404 on read is already_gone and nothing is deleted", async () => {
  const { fetchFn, calls } = fakeEbay({});
  const r = await run([cand("1")], fetchFn, false);
  assertEquals(r.results[0].decision, "already_gone");
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("runCleanup: an unreadable offer is an error, not a deletion", async () => {
  const { fetchFn, calls } = fakeEbay({ "1": 500 });
  const r = await run([cand("1")], fetchFn, false);
  assertEquals(r.results[0].decision, "error");
  assertEquals(calls.filter((c) => c.method === "DELETE").length, 0);
});

Deno.test("runCleanup: a failed DELETE is reported as an error with no backup", async () => {
  const { fetchFn } = fakeEbay({ "1": { sku: "S1", status: "UNPUBLISHED" } }, 500);
  const r = await run([cand("1", "S1")], fetchFn, false);
  assertEquals(r.results[0].decision, "error");
  assertEquals(r.results[0].backup, undefined);
});

Deno.test("runCleanup: a 401 stops the run and the rest come back not_reached", async () => {
  // 6 candidates, concurrency 5: the first batch hits 401, so the 6th is never tried.
  const offers: Record<string, number> = {};
  const cands: Candidate[] = [];
  for (let i = 1; i <= 6; i++) {
    offers[String(i)] = 401;
    cands.push(cand(String(i)));
  }
  const { fetchFn, calls } = fakeEbay(offers);
  const r = await run(cands, fetchFn, false);
  assertEquals(r.unauthorized, true);
  assertEquals(r.results[5].decision, "not_reached");
  assertEquals(calls.some((c) => c.id === "6"), false);
});

Deno.test("runCleanup: stops starting work once the time budget is spent", async () => {
  const { fetchFn, calls } = fakeEbay({ "1": { sku: "S1", status: "UNPUBLISHED" } });
  let t = 0;
  const now = () => (t += 60_000);
  const cands = [cand("1", "S1"), cand("2"), cand("3"), cand("4"), cand("5"), cand("6")];
  const r = await runCleanup({
    candidates: cands,
    apiBase: API,
    userToken: "tok",
    live: NO_LIVE,
    dryRun: true,
    fetchFn,
    now,
  });
  // First batch runs (elapsed 60s), second is cut (elapsed >= 100s).
  assertEquals(r.results[5].decision, "not_reached");
  assertEquals(calls.some((c) => c.id === "6"), false);
});

// ---- isAllowedUser ---------------------------------------------------------

Deno.test("isAllowedUser: deny by default", () => {
  assertEquals(isAllowedUser("u1", undefined), false);
  assertEquals(isAllowedUser("u1", ""), false);
  assertEquals(isAllowedUser("u1", " , "), false);
  assertEquals(isAllowedUser(undefined, "u1"), false);
  assertEquals(isAllowedUser("", ""), false);
});

Deno.test("isAllowedUser: matches only listed ids, ignoring whitespace", () => {
  assertEquals(isAllowedUser("u1", "u1"), true);
  assertEquals(isAllowedUser("u2", "u1, u2 ,u3"), true);
  assertEquals(isAllowedUser("u", "u1,u2"), false);
});
