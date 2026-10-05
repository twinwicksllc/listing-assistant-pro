import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addressLocationKey, reconcileInventoryLocation } from "./inventoryLocation.ts";

// The shared location logic used by ebay-publish and bulk-publish. These tests
// inject the fetch function, so they pin behaviour for both callers: an existing
// location is never deleted, a matching address is reused, a changed address
// moves new listings to an address-keyed location, and an unreadable location is
// left as is. The caller decides what to do with an unexpected create error.

type Call = { method: string; url: string };

function harness(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = (url: string, options: RequestInit & { timeout?: number }) => {
    const call = { method: String(options.method ?? "GET"), url };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { calls, fetchFn };
}

const base = (fetchFn: ReturnType<typeof harness>["fetchFn"], city = "Lake Villa") => ({
  fetchFn,
  apiBase: "https://api.ebay.com",
  userToken: "tok",
  baseKey: "BULK-ECF30989",
  address: { postalCode: "60046", city, country: "US" },
  locationBody: { name: "Bulk Listing Location" },
  label: "test",
});

const already = () => new Response(JSON.stringify({ errors: [{ errorId: 25803 }] }), { status: 409 });
const stored = (postalCode: string, city?: string) =>
  new Response(JSON.stringify({ location: { address: { postalCode, ...(city ? { city } : {}) } } }), { status: 200 });

Deno.test("reconcile: a missing location is created under the base key", async () => {
  const { calls, fetchFn } = harness(() => new Response(null, { status: 204 }));
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r, { ok: true, key: "BULK-ECF30989" });
  assertEquals(calls.map((c) => c.method), ["POST"]);
});

Deno.test("reconcile: an existing location with a matching address is reused, nothing deleted", async () => {
  const { calls, fetchFn } = harness((c) => c.method === "POST" ? already() : stored("60046", "Lake Villa"));
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r, { ok: true, key: "BULK-ECF30989" });
  assertEquals(calls.map((c) => c.method), ["POST", "GET"]);
});

Deno.test("reconcile: a changed address moves to an address-keyed location, never deleting", async () => {
  const addressKey = await addressLocationKey("60046", "Lake Villa");
  const { calls, fetchFn } = harness((c) => {
    if (c.method === "GET") return stored("10001", "New York");
    if (c.url.endsWith("/BULK-ECF30989")) return already();
    return new Response(null, { status: 204 });
  });
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r, { ok: true, key: addressKey });
  assertEquals(calls.some((c) => c.method === "DELETE"), false);
});

Deno.test("reconcile: a changed address whose keyed location already exists reuses it", async () => {
  const addressKey = await addressLocationKey("60046", "Lake Villa");
  const { calls, fetchFn } = harness((c) => {
    if (c.method === "POST" && c.url.endsWith("/BULK-ECF30989")) return already();
    if (c.method === "POST") return already();
    if (c.url.endsWith("/BULK-ECF30989")) return stored("10001", "New York");
    return stored("60046", "Lake Villa");
  });
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r, { ok: true, key: addressKey });
  assertEquals(calls.map((c) => c.method), ["POST", "GET", "POST", "GET"]);
  assertEquals(calls.some((c) => c.method === "DELETE"), false);
});

Deno.test("reconcile: an address-key conflict with a different stored address is not reused", async () => {
  const addressKey = await addressLocationKey("60046", "Lake Villa");
  const { calls, fetchFn } = harness((c) => {
    if (c.method === "POST") return already();
    if (c.url.endsWith("/BULK-ECF30989")) return stored("10001", "New York");
    return stored("60601", "Chicago");
  });
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r, { ok: true, key: "BULK-ECF30989" });
  assertEquals(calls.map((c) => c.method), ["POST", "GET", "POST", "GET"]);
  assertEquals(calls.some((c) => c.url.endsWith(`/${addressKey}`) && c.method === "GET"), true);
  assertEquals(calls.some((c) => c.method === "DELETE"), false);
});

Deno.test("addressLocationKey: long addresses retain a bounded, collision-resistant suffix", async () => {
  const first = await addressLocationKey("60046", "A city name that is long enough to be truncated one");
  const second = await addressLocationKey("60046", "A city name that is long enough to be truncated two");
  assertEquals(first.length <= 36, true);
  assertEquals(/^[a-zA-Z0-9-]+$/.test(first), true);
  assertEquals(first === second, false);
  assertEquals(await addressLocationKey("60046", "Lake Villa"), await addressLocationKey("60046", "  LAKE   villa "));
});

Deno.test("reconcile: a location that cannot be read is left as it is", async () => {
  const { fetchFn } = harness((c) => c.method === "POST" ? already() : new Response("x", { status: 503 }));
  assertEquals(await reconcileInventoryLocation(base(fetchFn)), { ok: true, key: "BULK-ECF30989" });
});

Deno.test("reconcile: a location that vanishes between the create and the read is left as it is", async () => {
  const { fetchFn } = harness((c) => c.method === "POST" ? already() : new Response(null, { status: 404 }));
  assertEquals(await reconcileInventoryLocation(base(fetchFn)), { ok: true, key: "BULK-ECF30989" });
});

Deno.test("reconcile: a network error on the read is left as it is", async () => {
  let n = 0;
  const fetchFn = () => {
    n++;
    return n === 1 ? Promise.resolve(already()) : Promise.reject(new Error("reset"));
  };
  assertEquals(await reconcileInventoryLocation(base(fetchFn)), { ok: true, key: "BULK-ECF30989" });
});

Deno.test("reconcile: an unexpected create error is reported to the caller, not thrown", async () => {
  const { fetchFn } = harness(() => new Response("boom", { status: 500 }));
  const r = await reconcileInventoryLocation(base(fetchFn));
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 500);
    assertEquals(r.body, "boom");
  }
});

Deno.test("reconcile: the address-keyed create failing keeps the base location", async () => {
  const { fetchFn } = harness((c) => {
    if (c.method === "GET") return stored("10001", "New York");
    if (c.url.endsWith("/BULK-ECF30989")) return already();
    return new Response("bad", { status: 400 });
  });
  assertEquals(await reconcileInventoryLocation(base(fetchFn)), { ok: true, key: "BULK-ECF30989" });
});

Deno.test("reconcile: every write carries an explicit Accept-Language", async () => {
  const seen: Array<string | undefined> = [];
  const fetchFn = (_u: string, o: RequestInit & { timeout?: number }) => {
    seen.push((o.headers as Record<string, string>)["Accept-Language"]);
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  await reconcileInventoryLocation(base(fetchFn));
  assertEquals(seen, ["en-US"]);
});
