import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { findBrowseRate, pruneOldCallLogRows, shouldPruneThisTick, shouldWarn } from "./index.ts";

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

Deno.test("findBrowseRate: matches buy.browse exactly, not buy.browse.item.bulk, even when the latter appears first", () => {
  // Regression for a real finding on this account's actual getRateLimits
  // response, which includes BOTH resources -- a substring match on
  // "browse" could pick up the wrong one depending on response ordering
  // (Copilot review, PR #581).
  const rateLimits = [
    {
      apiContext: "buy",
      resources: [
        { name: "buy.browse.item.bulk", rates: [{ limit: 5000, remaining: 5000, reset: "x" }] },
        { name: "buy.browse", rates: [{ limit: 5000, remaining: 1310, reset: "y" }] },
      ],
    },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.resource.name, "buy.browse");
  assertEquals(found?.rate.remaining, 1310);
});

Deno.test("findBrowseRate: case-insensitive match still requires the exact resource name", () => {
  const rateLimits = [
    { apiContext: "buy", resources: [{ name: "Buy.Browse", rates: [{ limit: 5000, remaining: 4000, reset: "z" }] }] },
  ];
  const found = findBrowseRate(rateLimits);
  assertEquals(found?.rate.remaining, 4000);
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

// Retention/pruning: ebay_browse_call_log is append-only and only ever read
// via a same-day query, so rows older than the retention window are pure
// dead weight. This cron runs hourly; the prune should fire on exactly one
// of those 24 ticks/day, not all of them.
Deno.test("shouldPruneThisTick: fires at the designated UTC hour (00)", () => {
  assertEquals(shouldPruneThisTick(0), true);
});

Deno.test("shouldPruneThisTick: does not fire on other UTC hours", () => {
  for (const hour of [1, 5, 12, 23]) {
    assertEquals(shouldPruneThisTick(hour), false);
  }
});

/** Minimal fake mirroring only the .from().delete().lt() shape pruneOldCallLogRows uses. */
function fakeSupabaseForPrune(opts: {
  error?: { message: string };
  onDelete?: (table: string, filterField: string, filterValue: string) => void;
}) {
  return {
    from(table: string) {
      return {
        delete() {
          return {
            lt(field: string, value: string) {
              opts.onDelete?.(table, field, value);
              return Promise.resolve({ error: opts.error ?? null });
            },
          };
        },
      };
    },
  };
}

Deno.test("pruneOldCallLogRows: deletes from ebay_browse_call_log with a cutoff 3 days before `now`", async () => {
  let capturedTable = "";
  let capturedField = "";
  let capturedCutoff = "";
  const svc = fakeSupabaseForPrune({
    onDelete: (table, field, value) => {
      capturedTable = table;
      capturedField = field;
      capturedCutoff = value;
    },
  });
  const now = new Date("2026-09-20T00:31:00.000Z");
  const result = await pruneOldCallLogRows(svc, now);
  assertEquals(result, { pruned: true });
  assertEquals(capturedTable, "ebay_browse_call_log");
  assertEquals(capturedField, "created_at");
  // RETENTION_DAYS = 3, so the cutoff must be exactly 3 days before `now` --
  // rows on the "3 days old, still within retention" side of this boundary
  // must survive, and rows just past it must be deleted.
  assertEquals(capturedCutoff, "2026-09-17T00:31:00.000Z");
});

Deno.test("pruneOldCallLogRows: reports failure on a delete error rather than reporting pruned: true", async () => {
  const svc = fakeSupabaseForPrune({ error: { message: "connection reset" } });
  const result = await pruneOldCallLogRows(svc, new Date());
  assertEquals(result.pruned, false);
  assertEquals(result.error, "connection reset");
});
