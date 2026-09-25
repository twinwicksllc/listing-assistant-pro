import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchOffersBySku } from "./ebayOfferLookup.ts";

// Regression coverage for the account-wide bulk-offer-list failure: a single
// hyphenated SKU (errorId 25707) fails GET /sell/inventory/v1/offer for the
// whole account. Per-SKU queries (?sku=) don't trigger that validation, so
// this is the primary enumeration path -- see ebay-listings/index.ts's merge
// with the Trading API fallback for anything a SKU query misses.

Deno.test("fetchOffersBySku: returns offers for SKUs eBay has a PUBLISHED offer for", async () => {
  const fetchFn = (async (url: string) => {
    const sku = new URL(url).searchParams.get("sku");
    if (sku === "LA00001") {
      return new Response(JSON.stringify({ offers: [{ offerId: "111", sku: "LA00001" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ offers: [] }), { status: 200 });
  }) as unknown as typeof fetch;

  const { offers, unauthorized } = await fetchOffersBySku(
    ["LA00001", "LA00002"],
    "https://api.ebay.com",
    "tok",
    fetchFn,
  );
  assertEquals(Object.keys(offers), ["LA00001"]);
  assertEquals(offers["LA00001"].offerId, "111");
  assertEquals(unauthorized, false);
});

Deno.test("fetchOffersBySku: a 404 for one SKU is silent and doesn't block the rest", async () => {
  let warnCalled = false;
  const originalWarn = console.warn;
  console.warn = () => {
    warnCalled = true;
  };
  try {
    const fetchFn = (async (url: string) => {
      const sku = new URL(url).searchParams.get("sku");
      if (sku === "gone") return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ offers: [{ offerId: "222", sku: "ok" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const { offers } = await fetchOffersBySku(["gone", "ok"], "https://api.ebay.com", "tok", fetchFn);
    assertEquals(offers, { ok: { offerId: "222", sku: "ok", raw: { offerId: "222", sku: "ok" } } });
    // A 404 (SKU no longer live) is expected and must not be logged as a warning.
    assertEquals(warnCalled, false);
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("fetchOffersBySku: a non-404 error is logged but doesn't throw or block other SKUs", async () => {
  const fetchFn = (async (url: string) => {
    const sku = new URL(url).searchParams.get("sku");
    if (sku === "bad") return new Response("server error", { status: 500 });
    return new Response(JSON.stringify({ offers: [{ offerId: "333", sku: "ok" }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const { offers, unauthorized } = await fetchOffersBySku(["bad", "ok"], "https://api.ebay.com", "tok", fetchFn);
  assertEquals(Object.keys(offers), ["ok"]);
  assertEquals(unauthorized, false);
});

Deno.test("fetchOffersBySku: a 401 sets unauthorized so the caller can surface needsAuth, not a partial listing set", async () => {
  const fetchFn = (async () => {
    return new Response("unauthorized", { status: 401 });
  }) as unknown as typeof fetch;

  const { offers, unauthorized } = await fetchOffersBySku(["a", "b"], "https://api.ebay.com", "expired", fetchFn);
  assertEquals(offers, {});
  assertEquals(unauthorized, true);
});

Deno.test("fetchOffersBySku: an empty offers array for a SKU is omitted, not an error", async () => {
  const fetchFn = (async () => {
    return new Response(JSON.stringify({ offers: [] }), { status: 200 });
  }) as unknown as typeof fetch;

  const { offers } = await fetchOffersBySku(["x"], "https://api.ebay.com", "tok", fetchFn);
  assertEquals(offers, {});
});

Deno.test("fetchOffersBySku: passes an abort signal so a hung response can be cut off", async () => {
  let sawSignal = false;
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return new Response(JSON.stringify({ offers: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchOffersBySku(["a"], "https://api.ebay.com", "tok", fetchFn);
  assertEquals(sawSignal, true);
});

Deno.test("fetchOffersBySku: batches lookups under the concurrency cap", async () => {
  let maxConcurrent = 0;
  let current = 0;
  const fetchFn = (async () => {
    current++;
    maxConcurrent = Math.max(maxConcurrent, current);
    await new Promise((r) => setTimeout(r, 5));
    current--;
    return new Response(JSON.stringify({ offers: [] }), { status: 200 });
  }) as unknown as typeof fetch;

  const skus = Array.from({ length: 40 }, (_, i) => `sku${i}`);
  await fetchOffersBySku(skus, "https://api.ebay.com", "tok", fetchFn);
  assertEquals(maxConcurrent <= 15, true);
});

Deno.test("fetchOffersBySku: stops starting batches once the time budget is spent", async () => {
  // Each lookup "takes" 4s of fake clock; a 15-wide batch ends at 60s --
  // past the 45s budget -- so no second batch starts.
  let t = 0;
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    t += 4_000;
    return new Response(JSON.stringify({ offers: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const skus = Array.from({ length: 30 }, (_, i) => `sku${i}`);
  await fetchOffersBySku(skus, "https://api.ebay.com", "tok", fetchFn, () => t);
  assertEquals(calls, 15);
});
