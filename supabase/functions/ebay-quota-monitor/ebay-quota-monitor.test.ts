import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { findBrowseRate, shouldWarn } from "./index.ts";

// Regression coverage for the eBay Browse API quota monitor (spun out of the
// 2026-09-17 429 investigation, follow-on to PR #580's call-fan-out cap).
// eBay's real limit is 5,000 calls/day per client_id, confirmed at 73.8%
// used on this account's real keyset before this monitor existed. This
// covers the two pure functions that decide whether to warn and how to
// parse eBay's nested rate-limit response shape, without a live HTTP call.

Deno.test("findBrowseRate: finds the buy.browse resource among multiple contexts", () => {
  const rateLimits = [
    {
      apiContext: "sell",
      resources: [{ name: "inventory", rates: [{ limit: 1000, remaining: 500, reset: "2026-09-18T00:00:00Z" }] }],
    },
    {
      apiContext: "buy",
      resources: [
        {
          name: "buy.browse",
          rates: [{ limit: 5000, remaining: 4200, reset: "2026-09-18T14:15:00Z", timeWindow: 86400 }],
        },
      ],
    },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.resource.name, "buy.browse");
  assertEquals(found?.rate.limit, 5000);
  assertEquals(found?.rate.remaining, 4200);
});

Deno.test("findBrowseRate: returns null when no browse resource is present", () => {
  const rateLimits = [
    { apiContext: "sell", resources: [{ name: "inventory", rates: [{ limit: 1000, remaining: 500, reset: "x" }] }] },
  ];
  assertEquals(findBrowseRate(rateLimits), null);
});

Deno.test("findBrowseRate: returns null on an empty rateLimits array", () => {
  assertEquals(findBrowseRate([]), null);
});

Deno.test("findBrowseRate: returns null when a resource has an empty rates array", () => {
  const rateLimits = [
    { apiContext: "buy", resources: [{ name: "buy.browse", rates: [] }] },
  ];
  assertEquals(findBrowseRate(rateLimits), null);
});

Deno.test("shouldWarn: below both thresholds does not warn", () => {
  const r = shouldWarn(5000, 4500, 100);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: eBay's own poll at exactly 90% used warns", () => {
  // 500 remaining of 5000 == 90% used == exactly at the threshold.
  const r = shouldWarn(5000, 500, 0);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("eBay's own poll"), true);
});

Deno.test("shouldWarn: eBay's own poll just under 90% used does not warn", () => {
  // 501 remaining of 5000 == 89.98% used.
  const r = shouldWarn(5000, 501, 0);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: same-day counter at exactly 90% of limit warns even if the poll looks fine", () => {
  const r = shouldWarn(5000, 5000, 4500);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("same-day counter"), true);
});

Deno.test("shouldWarn: same-day counter just under 90% does not warn", () => {
  const r = shouldWarn(5000, 5000, 4499);
  assertEquals(r.warn, false);
});

Deno.test("shouldWarn: a non-positive limit never warns (defensive against a malformed poll)", () => {
  const r = shouldWarn(0, 0, 100);
  assertEquals(r.warn, false);
  assertEquals(r.reason, "no known limit");
});

Deno.test("shouldWarn: both signals crossing the threshold still reports a single warn, prioritising the eBay poll's reason", () => {
  const r = shouldWarn(5000, 100, 4600);
  assertEquals(r.warn, true);
  assertEquals(r.reason.includes("eBay's own poll"), true);
});
