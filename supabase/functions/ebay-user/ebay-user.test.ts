import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchIdentityWithRetry } from "./index.ts";

// Regression coverage for the 2026-09-20 ebay-user 502 investigation.
// A single 502 was observed in production where eBay's Identity API
// returned a non-OK, non-401/403 status with no diagnostic body captured
// in the log retention window. There was previously *zero* retry here --
// any one-off transient 5xx (or dropped connection) immediately surfaced
// as a hard 502 to the user. fetchIdentityWithRetry mirrors the retry
// pattern already established for the Browse API in
// _helpers/competitorSearch.ts: up to 3 attempts, retry only on 5xx/network
// error, never on 4xx.

function withMockedFetch<T>(
  handler: (callIndex: number) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  let callIndex = 0;
  globalThis.fetch = (() => {
    const idx = callIndex++;
    return Promise.resolve(handler(idx));
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("fetchIdentityWithRetry: a 200 on the first attempt returns immediately, no retry", async () => {
  let calls = 0;
  const { resp, lastFetchErr } = await withMockedFetch(
    () => {
      calls++;
      return new Response(JSON.stringify({ username: "alice" }), { status: 200 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(calls, 1);
  assertEquals(resp?.status, 200);
  assertEquals(lastFetchErr, null);
});

Deno.test("fetchIdentityWithRetry: a 401 is returned immediately without retrying (not transient)", async () => {
  let calls = 0;
  const { resp } = await withMockedFetch(
    () => {
      calls++;
      return new Response("unauthorized", { status: 401 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(calls, 1);
  assertEquals(resp?.status, 401);
});

Deno.test("fetchIdentityWithRetry: a 403 is returned immediately without retrying (not transient)", async () => {
  let calls = 0;
  const { resp } = await withMockedFetch(
    () => {
      calls++;
      return new Response("forbidden", { status: 403 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(calls, 1);
  assertEquals(resp?.status, 403);
});

Deno.test("fetchIdentityWithRetry: a single transient 503 self-heals on the second attempt", async () => {
  const { resp } = await withMockedFetch(
    (idx) => {
      if (idx === 0) return new Response("service unavailable", { status: 503 });
      return new Response(JSON.stringify({ username: "bob" }), { status: 200 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(resp?.status, 200);
});

Deno.test("fetchIdentityWithRetry: a persistent 5xx across all 3 attempts is surfaced as the final response, not thrown", async () => {
  let calls = 0;
  const { resp, lastFetchErr } = await withMockedFetch(
    () => {
      calls++;
      return new Response("boom", { status: 502 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(calls, 3);
  assertEquals(resp?.status, 502);
  assertEquals(lastFetchErr, null);
});

Deno.test("fetchIdentityWithRetry: a network error that never recovers returns a null response with the last error captured", async () => {
  let calls = 0;
  const { resp, lastFetchErr } = await withMockedFetch(
    () => {
      calls++;
      throw new TypeError("network error");
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(calls, 3);
  assertEquals(resp, null);
  assertEquals(lastFetchErr instanceof TypeError, true);
});

Deno.test("fetchIdentityWithRetry: a network error that recovers on attempt 2 returns the successful response", async () => {
  const { resp, lastFetchErr } = await withMockedFetch(
    (idx) => {
      if (idx === 0) throw new TypeError("network error");
      return new Response(JSON.stringify({ username: "carol" }), { status: 200 });
    },
    () => fetchIdentityWithRetry("https://api.ebay.com", "tok"),
  );
  assertEquals(resp?.status, 200);
  assertEquals(lastFetchErr, null);
});
