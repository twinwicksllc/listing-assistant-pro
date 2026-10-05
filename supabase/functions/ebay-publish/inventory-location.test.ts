import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addressLocationKey, ensureInventoryLocation, locationAddressMatches } from "./publish-helpers.ts";

// eBay's updateInventoryLocationDetails has no address container, so an address
// cannot be changed on an existing location, and deleteInventoryLocation is
// refused while a published offer references the location. ensureInventoryLocation
// therefore reads the location, reuses it when the address matches, and uses an
// address-keyed location when it does not. These tests pin that it never deletes.

type Call = { method: string; url: string };

function withFetch(
  handler: (call: Call, init: RequestInit | undefined) => Response,
  run: (calls: Call[]) => Promise<void>,
) {
  return async () => {
    const original = globalThis.fetch;
    const calls: Call[] = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const call = { method: String(init?.method ?? "GET"), url: String(input) };
      calls.push(call);
      return Promise.resolve(handler(call, init));
    }) as typeof fetch;
    try {
      await run(calls);
    } finally {
      globalThis.fetch = original;
    }
  };
}

const BASE = "https://api.ebay.com";
const already = () => new Response(JSON.stringify({ errors: [{ errorId: 25803 }] }), { status: 409 });
const located = (postalCode: string, city?: string) =>
  new Response(JSON.stringify({ location: { address: { postalCode, ...(city ? { city } : {}), country: "US" } } }), {
    status: 200,
  });

Deno.test(
  "ensureInventoryLocation: a new seller's location is created with one POST",
  withFetch(() => new Response(null, { status: 204 }), async (calls) => {
    const key = await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa");
    assertEquals(key, "default-location");
    assertEquals(calls.map((c) => c.method), ["POST"]);
  }),
);

Deno.test(
  "ensureInventoryLocation: an existing location with the same address is reused and nothing is deleted",
  withFetch(
    (call) => {
      if (call.method === "POST") return already();
      if (call.method === "GET") return located("60046", "Lake Villa");
      return new Response(null, { status: 500 });
    },
    async (calls) => {
      const key = await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa");
      assertEquals(key, "default-location");
      assertEquals(calls.map((c) => c.method), ["POST", "GET"]);
      assertEquals(calls.some((c) => c.method === "DELETE"), false);
    },
  ),
);

Deno.test(
  "ensureInventoryLocation: comparing the stored address ignores case and spacing",
  withFetch(
    (call) => call.method === "POST" ? already() : located("60046", "  LAKE   villa "),
    async (calls) => {
      assertEquals(await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa"), "default-location");
      assertEquals(calls.some((c) => c.method === "DELETE"), false);
    },
  ),
);

Deno.test(
  "ensureInventoryLocation: a changed address uses an address-keyed location and never deletes",
  withFetch(
    (call) => {
      if (call.url.endsWith("/default-location") && call.method === "POST") return already();
      if (call.method === "GET") return located("10001", "New York");
      if (call.url.endsWith("/loc-60046-lake-villa") && call.method === "POST") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    },
    async (calls) => {
      const key = await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa");
      assertEquals(key, "loc-60046-lake-villa");
      assertEquals(calls.some((c) => c.method === "DELETE"), false);
      assertEquals(calls.map((c) => c.method), ["POST", "GET", "POST"]);
    },
  ),
);

Deno.test(
  "ensureInventoryLocation: an address-keyed location that already exists is reused",
  withFetch(
    (call) => {
      if (call.method === "GET") return located("10001", "New York");
      return already();
    },
    async (calls) => {
      assertEquals(await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa"), "loc-60046-lake-villa");
      assertEquals(calls.some((c) => c.method === "DELETE"), false);
    },
  ),
);

Deno.test(
  "ensureInventoryLocation: if the location cannot be read, keep using it and change nothing",
  withFetch(
    (call) => call.method === "POST" ? already() : new Response("nope", { status: 500 }),
    async (calls) => {
      assertEquals(await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa"), "default-location");
      assertEquals(calls.map((c) => c.method), ["POST", "GET"]);
    },
  ),
);

Deno.test(
  "ensureInventoryLocation: a network failure reading the location keeps the existing location",
  async () => {
    const original = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (() => {
      n++;
      if (n === 1) return Promise.resolve(already());
      return Promise.reject(new Error("connection reset"));
    }) as typeof fetch;
    try {
      assertEquals(await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa"), "default-location");
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "ensureInventoryLocation: an unexpected create error still throws",
  withFetch(() => new Response("boom", { status: 500 }), async () => {
    let threw = false;
    try {
      await ensureInventoryLocation(BASE, "tok", "60046", "Lake Villa");
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  }),
);

Deno.test("addressLocationKey: letters, digits and hyphens only, at most 36 characters", () => {
  assertEquals(addressLocationKey("60046", "Lake Villa"), "loc-60046-lake-villa");
  assertEquals(addressLocationKey("60046"), "loc-60046");
  assertEquals(addressLocationKey("60046-1234", "St. Mary's / Co."), "loc-600461234-st-mary-s-co");
  const long = addressLocationKey("60046", "A very long city name that would exceed the limit by far");
  assertEquals(long.length <= 36, true);
  assertEquals(/^[a-zA-Z0-9-]+$/.test(long), true);
  assertEquals(long.endsWith("-"), false);
});

Deno.test("locationAddressMatches: postal code must match; an unknown city matches any stored city", () => {
  assertEquals(
    locationAddressMatches(
      { location: { address: { postalCode: "60046", city: "Lake Villa" } } },
      "60046",
      "Lake Villa",
    ),
    true,
  );
  assertEquals(
    locationAddressMatches({ location: { address: { postalCode: "60046", city: "Lake Villa" } } }, "60046"),
    true,
  );
  assertEquals(
    locationAddressMatches(
      { location: { address: { postalCode: "10001", city: "Lake Villa" } } },
      "60046",
      "Lake Villa",
    ),
    false,
  );
  assertEquals(
    locationAddressMatches({ location: { address: { postalCode: "60046", city: "Chicago" } } }, "60046", "Lake Villa"),
    false,
  );
  assertEquals(locationAddressMatches({ location: {} }, "60046"), false);
  assertEquals(locationAddressMatches(null, "60046"), false);
});
