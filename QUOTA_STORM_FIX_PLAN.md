# eBay Browse API Quota Storm — Comprehensive Fix Plan

**Status:** ✅ Both bugs fixed and deployed; **1-week post-fix monitoring in progress, due ~2026-09-28** (checklist lives in `todo.md`). Fixes verified 2026-09-22:

- **Bug 1 (getItems cost):** PR #601 merged — single-item loop rewritten, end-to-end verified, logs populate correctly to `ebay_browse_call_log` with resource tag `"buy.browse.item.bulk"`.
- **Bug 2 (reset-window gate):** PRs #595, #596, #597, #610 merged — quota monitor fixed, browse quota storm incident (67.5k/5k calls) resolved and stable. See `COMPETITOR_PRICES_CRON_SESSION_HANDOFF.md` and PR #610 for incident retrospective.
- **Interim monitoring data (2026-09-24):** eBay-reported `buy.browse` peak per quota window was 2,880 / 2,690 / 2,650 for the windows ending 2026-09-22 / 09-23 / 09-24 (limit 5,000); no quota alerts since 2026-09-21 00:31 UTC; our own call-log sums match eBay's counts. Not yet signed off — wait for the full week.
- **Part C (`buy.item.bulk` entitlement request):** still pending — no outcome recorded in this repo (see Part C below).

## Background: what's broken and why (read this before touching code)

On 2026-09-20, this app burned **67,594 combined Browse API calls in one day against a real 5,000/day ceiling** (~13.5x over). Confirmed directly against production data (Supabase Management API query against project `wcednzaxmxwfiijzmjmx`) and against eBay's own official documentation (researched externally).

There are **TWO independent, unrelated bugs**, both must be fixed. Fixing only one leaves the other live.

### Bug 1: The "cheap" getItems refresh costs MORE than the full search it replaces

PR #601 rewrote `fetchEbayItemsBulk` (in `supabase/functions/_helpers/competitorSearch.ts`) to loop eBay's single-item endpoint (`GET /buy/browse/v1/item/{item_id}`) once per stored comp ID, because eBay's bulk endpoint (`GET /buy/browse/v1/item?item_ids=...`) returns a 403 for this account (confirmed via external research: this needs a SEPARATE OAuth scope, `buy.item.bulk`, gated behind an Application Growth Check + Developer Technical Support ticket, 2-4 week turnaround — filed as a parallel, non-blocking track, see "Bulk entitlement request" section below).

Each stored listing can have up to 20 comp IDs (`comp_item_ids`, capped at 20 elsewhere in the file). `attemptItemsRefresh` currently loops ALL of them through the single-item endpoint every refresh — that's up to 20 real HTTP calls per listing, versus the full-search discovery path's cost of only 2-4 calls per listing (`buildSearchPlan` caps at 2 unique queries × up to 2 filter-mode variants per tier). **The "cheap" refresh is 5-10x more expensive per listing than the full search it exists to avoid.**

Confirmed empirically: one 5-minute cron tick logged exactly 514 single-item calls in one minute from one caller — consistent with ~30 listings × ~17 average stored IDs each, matching `competitor-prices-cron`'s `BATCH_LIMIT=30`.

### Bug 2: The quota gate assumes eBay resets at UTC midnight; it doesn't

`checkBrowseQuotaHeadroom` (the ONLY quota gate in the codebase) defaults its "start of today" boundary to `d.setUTCHours(0, 0, 0, 0)`. Confirmed via external research into eBay's own official API docs: eBay's Browse API rate-limit window is a **fixed-duration block (typically exactly 86400 seconds) anchored to an arbitrary timestamp, NOT a calendar-midnight reset**. Confirmed empirically too: this project's own `ebay_rate_limit_polls` table (which stores eBay's own hourly `getRateLimits` poll responses) shows `buy.browse`'s `call_count` resetting from 5000→0 between the 06:31 and 07:31 UTC hourly polls — consistent with midnight Pacific (~07:00-08:00 UTC depending on DST), not midnight UTC.

**This bug exists in TWO places**, not one:

1. `checkBrowseQuotaHeadroom` in `supabase/functions/_helpers/competitorSearch.ts` (the hot-path gate — HIGH severity, directly controls whether real Browse calls fire)
2. `countSameDayCombinedBrowseCalls`/`countSameDayBrowseCalls` in `supabase/functions/ebay-quota-monitor/index.ts`, feeding `shouldWarn`'s count-based branch (LOWER severity — the poll-based branch of `shouldWarn`, checked first, uses eBay's own real numbers and isn't affected; this only affects the secondary heuristic-counter branch)

The data needed to fix this correctly **already exists and is already captured** — `ebay_rate_limit_polls.reset_at` (a `TIMESTAMPTZ`, populated from eBay's own response on every hourly poll) and `ebay_rate_limit_polls.time_window_seconds` (typically 86400). It's just never read back by anything. This is a pure "wire up data already being collected" fix, not a new-capture fix.

### What was ruled out

- **A push-based/webhook alternative** (checking listing liveness without polling): confirmed via codebase-wide search that this app has ZERO existing eBay push/webhook/notification infrastructure — no Notification API usage, no relevant OAuth scope, no inbound eBay webhook receiver of any kind (only Stripe's). Building one would be greenfield work with no existing pattern to extend. **Not pursued for this fix** — too large a lift relative to the immediate problem. Worth revisiting only if the bounded-polling fix below still proves insufficient after rollout.
- **`market-watch-refresh`'s pattern**: confirmed to solve a different problem (aggregate search stats, not per-item liveness) — no reusable pattern for this bug.

---

## Part A: Fix Bug 2 first (reset-window gate) — do this before Part B

Rationale for ordering: Part A is lower-risk, self-contained, and makes Part B's own math more accurate (Part B's fixes are sized against a correctly-measured quota gate). Implementing A first means B's testing has a working gate underneath it.

### A1. New helper function in `supabase/functions/_helpers/competitorSearch.ts`

Add this new exported interface and function immediately **before** the existing `checkBrowseQuotaHeadroom` function (which currently starts at line 1090, immediately after the `QuotaHeadroomResult` interface at lines 1069-1073):

```ts
// Staleness bound for trusting a poll's own window boundary -- twice the
// ebay-quota-monitor cron's hourly cadence, so one missed tick doesn't
// immediately degrade the gate back to the UTC-midnight fallback.
const POLL_STALENESS_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface BrowseQuotaWindowAnchor {
  /** Start of eBay's real current reset window, derived from the most
   * recent fresh poll's reset_at - time_window_seconds. Null when no fresh
   * poll is available -- caller must fall back to UTC midnight. */
  windowStart: Date | null;
  /** eBay's own polled call_limit/call_count at poll time, for the
   * additive correction in checkBrowseQuotaHeadroom. Null alongside
   * windowStart when no fresh poll is available. */
  pollLimit: number | null;
  pollCallCount: number | null;
  reason: string;
}

/**
 * Reads the most recent ebay_rate_limit_polls row and derives the boundary
 * of eBay's ACTUAL current reset window (fixed-duration, e.g. 86400s,
 * anchored to an arbitrary timestamp -- NOT UTC midnight; confirmed via
 * eBay's own docs and this project's own polled data, see
 * checkBrowseQuotaHeadroom's docstring). Exported so this has direct test
 * coverage against a fake Supabase client without a live poll.
 *
 * Fails to {windowStart: null, ...} (not a throw) whenever the poll is
 * missing, errored, or older than POLL_STALENESS_MS -- callers must treat
 * that identically to "no data," falling back to the UTC-midnight default
 * that was checkBrowseQuotaHeadroom's only behavior before this function
 * existed.
 */
export async function getLatestBrowseQuotaWindowAnchor(
  // deno-lint-ignore no-explicit-any -- matches this file's existing loose
  // supabase-js client typing.
  supabase: any,
  now: Date = new Date(),
): Promise<BrowseQuotaWindowAnchor> {
  const nullAnchor = (reason: string): BrowseQuotaWindowAnchor => ({
    windowStart: null,
    pollLimit: null,
    pollCallCount: null,
    reason,
  });
  try {
    const { data, error } = await supabase
      .from("ebay_rate_limit_polls")
      .select(
        "reset_at, time_window_seconds, call_limit, call_count, polled_at",
      )
      .order("polled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return nullAnchor(`poll lookup failed: ${error.message}`);
    if (!data) return nullAnchor("no ebay_rate_limit_polls row exists yet");

    const polledAt = new Date(data.polled_at);
    if (now.getTime() - polledAt.getTime() > POLL_STALENESS_MS) {
      return nullAnchor(`latest poll is stale (polled_at=${data.polled_at})`);
    }

    const resetAt = new Date(data.reset_at);
    if (isNaN(resetAt.getTime())) {
      return nullAnchor(
        `latest poll has an unparseable reset_at: ${data.reset_at}`,
      );
    }

    // eBay's own documented default when a specific poll didn't report a
    // window length -- see this project's captured ebay_rate_limit_polls
    // data, which shows this landing at exactly 86400 in practice.
    const timeWindowSeconds = data.time_window_seconds ?? 86400;
    const windowStart = new Date(resetAt.getTime() - timeWindowSeconds * 1000);

    // reset_at is eBay's NEXT reset -- if that's already in the past, the
    // poll itself is too old to trust as a live window boundary (distinct
    // from the polled_at staleness check above: this catches a poll that
    // is recent by polled_at but whose OWN reported reset has since
    // elapsed, e.g. an unusually short time_window_seconds).
    if (resetAt.getTime() <= now.getTime()) {
      return nullAnchor(
        `latest poll's own reset_at (${data.reset_at}) has already elapsed`,
      );
    }

    return {
      windowStart,
      pollLimit: data.call_limit,
      pollCallCount: data.call_count,
      reason: `derived from poll at ${data.polled_at}, reset_at=${data.reset_at}, window=${timeWindowSeconds}s`,
    };
  } catch (err) {
    return nullAnchor(`unexpected error: ${String(err)}`);
  }
}
```

### A2. Replace `checkBrowseQuotaHeadroom`'s body

The current function (lines 1090-1138) is:

```ts
export async function checkBrowseQuotaHeadroom(
  supabase: any,
  todayStart: Date = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })(),
): Promise<QuotaHeadroomResult> {
  try {
    const { count, error } = await supabase
      .from("ebay_browse_call_log")
      .select("*", { count: "exact", head: true })
      .in("resource", COMBINED_BROWSE_RESOURCES)
      .gte("created_at", todayStart.toISOString());

    if (error) {
      console.warn(
        `[competitorSearch] checkBrowseQuotaHeadroom: count query failed, failing OPEN (assuming headroom): ${error.message}`,
      );
      return {
        hasHeadroom: true,
        sameDayCount: null,
        reason: `count query failed: ${error.message}`,
      };
    }

    const sameDayCount = count ?? 0;
    const ratio = sameDayCount / BROWSE_QUOTA_DAILY_LIMIT;
    if (ratio >= CRITICAL_QUOTA_RATIO) {
      return {
        hasHeadroom: false,
        sameDayCount,
        reason: `combined buy.browse + buy.browse.item.bulk same-day count (${sameDayCount}/${BROWSE_QUOTA_DAILY_LIMIT}) is at or above the critical ${(
          CRITICAL_QUOTA_RATIO * 100
        ).toFixed(0)}% threshold`,
      };
    }
    return {
      hasHeadroom: true,
      sameDayCount,
      reason: `${sameDayCount}/${BROWSE_QUOTA_DAILY_LIMIT} combined calls today`,
    };
  } catch (err) {
    console.warn(
      "[competitorSearch] checkBrowseQuotaHeadroom: unexpected error, failing OPEN:",
      err,
    );
    return {
      hasHeadroom: true,
      sameDayCount: null,
      reason: `unexpected error: ${String(err)}`,
    };
  }
}
```

**Replace it entirely** with:

```ts
export async function checkBrowseQuotaHeadroom(
  supabase: any,
  now: Date = new Date(),
): Promise<QuotaHeadroomResult> {
  try {
    const anchor = await getLatestBrowseQuotaWindowAnchor(supabase, now);

    // Fallback boundary: UTC midnight, unchanged from today's pre-fix
    // behavior -- used whenever no fresh real-reset anchor is available.
    const utcMidnightFallback = (() => {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    })();
    const windowStart = anchor.windowStart ?? utcMidnightFallback;

    const { count, error } = await supabase
      .from("ebay_browse_call_log")
      .select("*", { count: "exact", head: true })
      .in("resource", COMBINED_BROWSE_RESOURCES)
      .gte("created_at", windowStart.toISOString());

    if (error) {
      console.warn(
        `[competitorSearch] checkBrowseQuotaHeadroom: count query failed, failing OPEN (assuming headroom): ${error.message}`,
      );
      return {
        hasHeadroom: true,
        sameDayCount: null,
        reason: `count query failed: ${error.message}`,
      };
    }

    const callsSinceAnchor = count ?? 0;

    // Additive correction: if a fresh poll anchor is available, add its own
    // callCount (calls eBay itself confirms happened before the poll) to
    // calls logged in this app's own counter SINCE that poll -- this
    // recalibrates the self-count against ground truth every poll cycle
    // instead of letting a full window's drift accumulate unchecked.
    // Note: if the poll's own used-ratio was already at/above the critical
    // threshold, estimatedUsed's ratio is automatically at/above it too
    // (estimatedUsed >= pollCallCount, and callsSinceAnchor is always >= 0)
    // -- no separate short-circuit branch is needed for that case.
    const estimatedUsed =
      anchor.pollCallCount != null
        ? anchor.pollCallCount + callsSinceAnchor
        : callsSinceAnchor;

    const ratio = estimatedUsed / BROWSE_QUOTA_DAILY_LIMIT;
    if (ratio >= CRITICAL_QUOTA_RATIO) {
      return {
        hasHeadroom: false,
        sameDayCount: estimatedUsed,
        reason: `combined buy.browse + buy.browse.item.bulk estimated used (${estimatedUsed}/${BROWSE_QUOTA_DAILY_LIMIT}, ${anchor.reason}) is at or above the critical ${(
          CRITICAL_QUOTA_RATIO * 100
        ).toFixed(0)}% threshold`,
      };
    }
    return {
      hasHeadroom: true,
      sameDayCount: estimatedUsed,
      reason: `${estimatedUsed}/${BROWSE_QUOTA_DAILY_LIMIT} combined calls (${anchor.reason})`,
    };
  } catch (err) {
    console.warn(
      "[competitorSearch] checkBrowseQuotaHeadroom: unexpected error, failing OPEN:",
      err,
    );
    return {
      hasHeadroom: true,
      sameDayCount: null,
      reason: `unexpected error: ${String(err)}`,
    };
  }
}
```

**Important implementation notes:**

- The parameter is **renamed** from `todayStart: Date` to `now: Date` — its meaning changed from "the boundary to query from" to "the current instant, from which the real boundary is derived internally." This is a deliberate, visible signature change.
- No migration is needed for this part — `ebay_rate_limit_polls.reset_at` and `.time_window_seconds` already exist (confirmed in `supabase/migrations/20260917000000_create_ebay_quota_monitor_tables.sql`, lines 39-40).

### A3. Update `supabase/functions/_helpers/competitorSearch.test.ts`

**First**, extend the existing `fakeSupabaseForQuotaHeadroom` helper (currently at lines 1509-1531) to also serve `.from("ebay_rate_limit_polls")` — otherwise `getLatestBrowseQuotaWindowAnchor` will throw when called from every existing test. Replace the whole function with:

```ts
function fakeSupabaseForQuotaHeadroom(opts: {
  count?: number | null;
  error?: { message: string } | null;
  onQuery?: (table: string, inArgs: unknown[]) => void;
  // New: controls what getLatestBrowseQuotaWindowAnchor sees when it
  // queries ebay_rate_limit_polls. Defaults to "no row" so every existing
  // test (written before this table existed in this function's logic)
  // keeps exercising the UTC-midnight fallback path unchanged.
  pollRow?: {
    reset_at: string;
    time_window_seconds?: number | null;
    call_limit: number;
    call_count: number;
    polled_at: string;
  } | null;
  pollError?: { message: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "ebay_rate_limit_polls") {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: opts.pollRow ?? null,
              error: opts.pollError ?? null,
            });
          },
        };
      }
      const builder = {
        select() {
          return builder;
        },
        in(...args: unknown[]) {
          opts.onQuery?.(table, args);
          return builder;
        },
        gte() {
          return Promise.resolve({
            count: opts.count === undefined ? 0 : opts.count,
            error: opts.error ?? null,
          });
        },
      };
      return builder;
    },
  };
}
```

**Second**, every existing test at lines 1533-1591 that calls `checkBrowseQuotaHeadroom(svc, new Date(...))` or `checkBrowseQuotaHeadroom(svc, new Date())` continues to work unchanged — the second argument is now interpreted as `now` instead of `todayStart`, but since `pollRow` defaults to `null` (no poll row), `getLatestBrowseQuotaWindowAnchor` returns a null anchor, and `checkBrowseQuotaHeadroom` falls back to the UTC-midnight boundary exactly as before. **Do not change the assertions in these existing tests** — they should still pass as-is once the fake client is updated.

**Third**, add these NEW test cases (append after the existing tests, i.e. after line 1591):

```ts
// ── getLatestBrowseQuotaWindowAnchor (2026-09-2X reset-window fix) ─────────
// eBay's Browse API quota resets on a fixed-duration block anchored to an
// arbitrary timestamp (confirmed via eBay's own docs and this project's own
// polled data), NOT UTC midnight. These tests pin the boundary-derivation
// logic that reads the real reset from ebay_rate_limit_polls.

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: derives windowStart from a fresh poll's reset_at minus time_window_seconds",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 3000,
        polled_at: "2026-09-21T09:31:00.000Z", // 29 min before `now` -- fresh
      },
    });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
    assertEquals(result.windowStart?.toISOString(), "2026-09-21T07:00:00.000Z");
    assertEquals(result.pollLimit, 5000);
    assertEquals(result.pollCallCount, 3000);
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: falls back to 86400s when time_window_seconds is null",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: null,
        call_limit: 5000,
        call_count: 3000,
        polled_at: "2026-09-21T09:31:00.000Z",
      },
    });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
    assertEquals(result.windowStart?.toISOString(), "2026-09-21T07:00:00.000Z");
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: returns null anchor when no poll row exists",
  async () => {
    const svc = fakeSupabaseForQuotaHeadroom({ pollRow: null });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
    assertEquals(result.windowStart, null);
    assertEquals(result.pollCallCount, null);
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: returns null anchor when the latest poll is older than 2 hours (stale)",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 3000,
        polled_at: "2026-09-21T07:00:00.000Z", // 3 hours before `now` -- stale
      },
    });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
    assertEquals(result.windowStart, null);
    assertStringIncludes(result.reason, "stale");
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: returns null anchor when the poll's own reset_at has already elapsed",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      pollRow: {
        reset_at: "2026-09-21T09:00:00.000Z", // in the past relative to `now`
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 3000,
        polled_at: "2026-09-21T09:31:00.000Z", // fresh by polled_at, but reset_at already elapsed
      },
    });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, now);
    assertEquals(result.windowStart, null);
    assertStringIncludes(result.reason, "already elapsed");
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: fails to null anchor (not a throw) on a query error",
  async () => {
    const svc = fakeSupabaseForQuotaHeadroom({
      pollError: { message: "connection reset" },
    });
    const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
    assertEquals(result.windowStart, null);
    assertStringIncludes(result.reason, "connection reset");
  },
);

Deno.test(
  "getLatestBrowseQuotaWindowAnchor: fails to null anchor (not a throw) on an unexpected throw",
  async () => {
    const svc = {
      from() {
        throw new Error("network down");
      },
    };
    const result = await getLatestBrowseQuotaWindowAnchor(svc, new Date());
    assertEquals(result.windowStart, null);
  },
);

// ── checkBrowseQuotaHeadroom: real reset-window integration (2026-09-2X) ──

Deno.test(
  "checkBrowseQuotaHeadroom: uses the real reset window instead of UTC midnight when a fresh poll anchor exists",
  async () => {
    // Real window start is ~07:00 UTC yesterday (per the poll). A call logged
    // at 02:00 UTC TODAY is AFTER that real boundary, so it must be counted --
    // this is the one test that would have caught the original bug: under the
    // old UTC-midnight logic, this call would also have been counted (it's
    // after today's midnight too), so this test alone doesn't distinguish the
    // two. The real regression guard is the NEXT test below, which checks a
    // call BEFORE UTC midnight but AFTER the real reset.
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      count: 100,
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 4000,
        polled_at: "2026-09-21T09:31:00.000Z",
      },
    });
    const result = await checkBrowseQuotaHeadroom(svc, now);
    // estimatedUsed = pollCallCount (4000) + callsSinceAnchor (100) = 4100
    assertEquals(result.sameDayCount, 4100);
  },
);

Deno.test(
  "checkBrowseQuotaHeadroom: combines poll callCount with calls logged since the poll (additive correction)",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svcBelowThreshold = fakeSupabaseForQuotaHeadroom({
      count: 300, // calls since the poll
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 4000, // eBay's own count at poll time
        polled_at: "2026-09-21T09:31:00.000Z",
      },
    });
    const belowResult = await checkBrowseQuotaHeadroom(svcBelowThreshold, now);
    assertEquals(belowResult.sameDayCount, 4300); // 4000 + 300 = 4300/5000 = 86%, still headroom
    assertEquals(belowResult.hasHeadroom, true);

    const svcAboveThreshold = fakeSupabaseForQuotaHeadroom({
      count: 600, // calls since the poll
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 4000,
        polled_at: "2026-09-21T09:31:00.000Z",
      },
    });
    const aboveResult = await checkBrowseQuotaHeadroom(svcAboveThreshold, now);
    assertEquals(aboveResult.sameDayCount, 4600); // 4000 + 600 = 4600/5000 = 92%, no headroom
    assertEquals(aboveResult.hasHeadroom, false);
  },
);

Deno.test(
  "checkBrowseQuotaHeadroom: falls back to UTC-midnight boundary when no poll anchor is available",
  async () => {
    // Regression guard: confirms the pre-existing fallback behavior still
    // works unchanged when ebay_rate_limit_polls has no usable row.
    const svc = fakeSupabaseForQuotaHeadroom({ count: 1000, pollRow: null });
    const result = await checkBrowseQuotaHeadroom(
      svc,
      new Date("2026-09-21T00:00:00.000Z"),
    );
    assertEquals(result.hasHeadroom, true);
    assertEquals(result.sameDayCount, 1000); // no pollCallCount to add -- pure self-count
  },
);

Deno.test(
  "checkBrowseQuotaHeadroom: falls back to UTC-midnight boundary when the latest poll is stale",
  async () => {
    const now = new Date("2026-09-21T10:00:00.000Z");
    const svc = fakeSupabaseForQuotaHeadroom({
      count: 1000,
      pollRow: {
        reset_at: "2026-09-22T07:00:00.000Z",
        time_window_seconds: 86400,
        call_limit: 5000,
        call_count: 4000,
        polled_at: "2026-09-21T07:00:00.000Z", // 3 hours old -- stale
      },
    });
    const result = await checkBrowseQuotaHeadroom(svc, now);
    // Stale poll -> null anchor -> pure self-count, no additive correction
    assertEquals(result.sameDayCount, 1000);
  },
);
```

Also add `getLatestBrowseQuotaWindowAnchor` and `BrowseQuotaWindowAnchor` to the existing `import { ... } from "./competitorSearch.ts"` block at the top of `competitorSearch.test.ts`.

### A4. Mirror the fix in `supabase/functions/ebay-quota-monitor/index.ts` (lower priority, do after A1-A3 are verified working)

The exact same UTC-midnight bug exists at **lines 511-512** (`const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);`), feeding **both**:

- The same-day alert-dedup query (lines 513-518) — LOW impact, worst case is one extra alert email in the 00:00-07:xx UTC window per day (fails toward "send," already the accepted-safe direction per this file's own comment at lines 508-510).
- `countSameDayCombinedBrowseCalls` (called at line 533), feeding `shouldWarn`'s count-based branch (lines 271-277) — LOWER-MEDIUM impact, since `shouldWarn`'s poll-based branch (lines 265-270, checked FIRST) already uses eBay's real numbers independently.

**Recommended approach:** since `getLatestBrowseQuotaWindowAnchor` is now a general-purpose exported function in `competitorSearch.ts`, import and reuse it here rather than re-implementing the same logic a second time (this codebase has a documented history of exactly this kind of duplication causing drift — see CLAUDE.md's "consolidate the duplicated parent-category blocklists" section for the precedent of what happens when the same logic exists in two places and only one gets fixed).

Add the import at the top of `ebay-quota-monitor/index.ts`:

```ts
import { getLatestBrowseQuotaWindowAnchor } from "../_helpers/competitorSearch.ts";
```

Replace **lines 511-512**:

```ts
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);
```

with:

```ts
const now = new Date();
const anchor = await getLatestBrowseQuotaWindowAnchor(svc, now);
const todayStart =
  anchor.windowStart ??
  (() => {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
```

The rest of the function (the dedup query at 513-518, and the `countSameDayCombinedBrowseCalls(svc, todayStart)` call at line 533) then automatically uses the corrected boundary with zero further changes, since they already just consume `todayStart` as a parameter.

**Do NOT change** `shouldPruneThisTick`/`pruneOldCallLogRows` (lines 290-321) — confirmed independently correct: it's a rolling 3-day retention cutoff computed from `now.getTime()` directly, not calendar-aligned, and an ~8-hour offset from eBay's real reset is immaterial against a 72-hour retention window.

**New test** for `ebay-quota-monitor/ebay-quota-monitor.test.ts`: add a test confirming the handler (or, if the handler itself isn't unit-testable in isolation, at minimum a test on the composed boundary logic if you extract it) uses `getLatestBrowseQuotaWindowAnchor`'s result rather than a hardcoded UTC-midnight `Date` when a fresh poll anchor is available — mirroring test pattern from A3 above. If the existing test file's structure makes this awkward to test at the handler level, it's acceptable to skip a new test here as long as A1-A3's tests already cover `getLatestBrowseQuotaWindowAnchor`'s correctness directly (they do) — flag this explicitly in the PR description rather than silently skipping.

---

## Part B: Fix Bug 1 (getItems per-listing/per-tick cost)

### B1. Cap how many stored comp IDs get probed per refresh

The current code in `attemptItemsRefresh` (lines 1642-1664) passes **all** of `row.comp_item_ids` (up to 20) to `fetchEbayItemsBulk`. `isItemsRefreshUsable` (lines 1574-1594) only requires `foundCount >= 3` AND `foundCount/requestedCount >= 0.5` to trust the result — so probing fewer IDs can still satisfy that gate, as long as the SIZE of what's requested shrinks proportionally.

**Add a new constant** near the other quota-related constants (after `CRITICAL_QUOTA_RATIO` at line 1066):

```ts
// Caps how many of a listing's stored comp_item_ids get probed per
// getItems refresh attempt. Confirmed root cause of the 2026-09-20 quota
// storm: probing up to 20 ids/listing via the single-item-loop workaround
// (forced by eBay's 403 on the real bulk endpoint, see fetchEbayItemsBulk's
// own docstring) costs MORE per listing than the full-search path's 2-4
// calls/listing -- inverting this feature's entire cost premise. Capped at
// 5: isItemsRefreshUsable's own minCount default is 3, so 5 probed ids
// still comfortably satisfies "3+ survivors" even if 1-2 of the 5 have
// delisted, while bounding worst-case cost to roughly the SAME order of
// magnitude as the full-search alternative it must beat.
const ITEMS_REFRESH_PROBE_CAP = 5;
```

**Change line 1642** from:

```ts
const storedItemIds: string[] = row.comp_item_ids;
```

to:

```ts
// Probe only a bounded SUBSET of stored comp_item_ids -- see
// ITEMS_REFRESH_PROBE_CAP's own comment for why probing all 20 inverted
// this feature's cost premise. Slicing the front N (not a random sample)
// keeps this deterministic and simple; comp_item_ids is not ordered by any
// meaningful recency signal today, so front-N is not measurably worse than
// a random subset, and a future improvement could re-order comp_item_ids
// by last-confirmed-live-date if this proves too coarse in practice.
const storedItemIds: string[] = (row.comp_item_ids as string[]).slice(
  0,
  ITEMS_REFRESH_PROBE_CAP,
);
```

**Also update `isItemsRefreshUsable`'s call site** at lines 1672-1675 — no code change needed there, since `requestedCount: storedItemIds.length` already reflects the (now-capped) `storedItemIds`, not the original `row.comp_item_ids`. Confirm this is still true after the edit (it is, since `storedItemIds` is now the sliced array and `requestedCount` reads from it directly).

### B2. Worst-case math after B1 alone

- Per listing: up to `ITEMS_REFRESH_PROBE_CAP` (5) single-item calls, each with up to 3 retry attempts on 5xx/timeout (existing retry logic, lines 896-945, unchanged) = worst case 15 calls/listing (vs. up to 60 before this fix, and vs. the full-search path's 2-4 calls/listing baseline it must beat).
- Per tick: `BATCH_LIMIT` (30) × 15 worst-case = 450 calls/tick (vs. up to 600+ before).
- Per day: 450 × 288 ticks/day = **129,600 worst-case calls/day** — still far over 5,000/day if EVERY listing in EVERY tick hit the worst case (all 5 probes needing all 3 retries). This worst-case ceiling alone is not sufficient — **B1 must be combined with B3 below**, not treated as a complete fix on its own.
- **Realistic case** (no retries needed, the common path): 30 listings × 5 calls = 150 calls/tick × 288 ticks/day = **43,200 calls/day** — still far over 5,000/day. **B1 alone, even in the realistic case, does not fix the problem.** The per-call cap reduces the multiplier but doesn't address the volume: `BATCH_LIMIT=30` listings every 5 minutes, all day, will exceed 5,000/day through this path alone regardless of the per-listing cap, UNLESS most ticks find nothing stale to refresh (the CACHE_TTL_MS=24h staleness filter is the only thing currently bounding how many listings are even eligible per tick — but once a backlog of >24h-stale listings exists, as it does after any real incident, many consecutive ticks will be full).

**Conclusion: B1 (per-listing cap) is necessary but not sufficient. B3 (below) is required as well.**

### B3. Add a per-tick call budget check inside `checkBrowseQuotaHeadroom`'s caller

The existing gate (`checkBrowseQuotaHeadroom`, fixed in Part A) is checked ONCE per listing, independently, with no coordination between the up-to-`REFRESH_CONCURRENCY` (15) listings processed concurrently in one cron tick. Each of those 15 can see "headroom available" and proceed, even though their combined in-flight calls (now up to 15 × 15 = 225 worst-case, or 15 × 5 = 75 realistic-case, per Part B1's math) could exceed the actual remaining headroom before any of them finishes and logs its calls.

**Fix: re-check headroom before EACH concurrency slice in `competitor-prices-cron/index.ts`, not just implicitly via each listing's own independent call into `runCompetitorSearch`.**

Current code in `supabase/functions/competitor-prices-cron/index.ts`, lines 230-246:

```ts
for (let i = 0; i < listings.length; i += REFRESH_CONCURRENCY) {
  const batchSlice = listings.slice(i, i + REFRESH_CONCURRENCY);
  const results = await Promise.all(
    batchSlice.map((listing) =>
      refreshCompetitorData(
        supabase,
        listing.userId,
        listing,
        ebayEnv,
        geminiKey,
      ),
    ),
  );
  for (const ok of results) {
    if (ok) {
      totalRefreshed++;
    } else {
      totalSkipped++;
    }
  }

  if (i + REFRESH_CONCURRENCY < listings.length) {
    await sleep(SEARCH_DELAY_MS);
  }
}
```

This doesn't need a NEW quota check added here — `runCompetitorSearch` (called transitively via `refreshCompetitorData`) already calls the now-fixed `checkBrowseQuotaHeadroom` once per listing, and Part A's fix already makes that check read the TRUE current state (via the additive correction: `pollCallCount + callsSinceAnchor`) rather than a stale snapshot. The critical property Part A's additive correction provides is: **`callsSinceAnchor` is a live COUNT query against `ebay_browse_call_log`, re-run fresh for every single listing's own gate check** (not cached/memoized across the tick) — so as listings within a slice actually log their calls via `logBrowseApiCall`, the NEXT listing's gate check in the same `Promise.all` will see a HIGHER count if enough time/calls have elapsed for the write to land before the next listing's read.

**However**, this only closes the gap for calls that have ALREADY been logged by the time a sibling checks — it does NOT prevent all 15 listings in one `Promise.all` slice from passing the gate check nearly simultaneously (before ANY of them have logged even one call yet), then all proceeding to make their own up-to-5-call loops concurrently. This is the same fundamental race as before Part A, just with a more accurate (but still snapshot-based) count.

**Additional fix needed: shrink `REFRESH_CONCURRENCY` and add an explicit in-tick running total.**

In `supabase/functions/competitor-prices-cron/index.ts`:

1. **Change `REFRESH_CONCURRENCY`** (currently `15`, at line 36) to a smaller value. Given B1's realistic per-listing cost of up to 5 calls, and wanting the WHOLE tick's realistic cost to stay well under a few hundred calls (leaving room for other same-day callers like `market-watch-refresh`/`keyword-research`/live `analyze-item` requests), change to:

   ```ts
   const REFRESH_CONCURRENCY = 5;
   ```

   New worst-case-per-tick: `BATCH_LIMIT` (30, unchanged) listings processed in slices of 5 → still processes all 30 per tick (just in more, smaller concurrent slices — total tick duration increases slightly, total call volume per tick is UNCHANGED by this alone; concurrency width only affects how bunched-up the calls are in TIME, not how many happen). **This change alone does not reduce total daily volume** — it reduces how many calls can be in-flight at once before the NEXT listing's gate check has a chance to see them logged, making Part A's additive-correction re-check meaningfully tighter (checking every 5 listings instead of every 15 means the gate re-synchronizes with reality 3x more often within a tick).

2. **Reduce `BATCH_LIMIT`** (currently `30`, at line 52) to bound each tick's absolute worst case directly. Change to:

   ```ts
   const BATCH_LIMIT = 10;
   ```

   New worst-case-per-tick (after B1+this change): 10 listings × 5 calls (realistic, no retries) = 50 calls/tick. Worst case with retries: 10 × 15 = 150 calls/tick.
   New worst-case-per-day: 50 (realistic) × 288 ticks/day = **14,400 calls/day** — still over 5,000/day if every tick is full. Worst case with retries: 150 × 288 = 43,200/day.

   **This is still not enough on its own.** The real bound has to come from Part A's gate actually firing and returning `hasHeadroom: false` once the 90% threshold is crossed for the day — at which point `runCompetitorSearch` falls through to the stale-cache/no-data branch (lines 2122-2183, already correct, unchanged) instead of making any more real calls. **The constants above (B1, and this section's `REFRESH_CONCURRENCY`/`BATCH_LIMIT` reduction) are about shrinking the worst-case BURST size and re-sync frequency, not about being the sole mechanism that caps the day's total** — Part A's gate is what actually stops the day's total at ~4,500 (90% of 5,000). The point of B1 and this section together is to make sure that BEFORE the gate trips, the app isn't already deep into a 13x-over-budget burst within a single tick or two, the way it was on 2026-09-20 (which happened specifically because pre-Part-A, the gate's OWN accounting was wrong, so it never tripped in time).

3. **No code change needed for `SEARCH_DELAY_MS`** (currently `300`ms, line 33) — leave as-is, it already exists and is orthogonal to this fix (smooths bursts within a slice, not a quota mechanism per its own comment).

### B4. Update `supabase/functions/_helpers/competitorSearch.test.ts` for B1

Existing test file already imports `attemptItemsRefresh`, `fetchEbayItemsBulk`, `decideRefreshStrategy`, `isItemsRefreshUsable` (confirmed at lines 3, 11, 14, 16). Add these NEW tests, placed near the existing `attemptItemsRefresh`-adjacent tests (search the test file for `"attemptItemsRefresh"` as a string to find the right section — likely near the `decideRefreshStrategy`/`isItemsRefreshUsable` tests around lines 824-839 per earlier investigation):

```ts
// ── ITEMS_REFRESH_PROBE_CAP (2026-09-2X quota-storm fix) ────────────────────
// Root cause of the 2026-09-20 incident: probing all (up to 20) stored
// comp_item_ids per refresh cost MORE than the full-search path it exists
// to replace. These tests pin the cap to a specific, deliberately visible
// value -- a future change to it should be a reviewed diff, not silent.

Deno.test(
  "attemptItemsRefresh: probes at most ITEMS_REFRESH_PROBE_CAP stored itemIds, even when more are stored",
  async () => {
    const twentyIds = Array.from({ length: 20 }, (_, i) => `v1|${i}|0`);
    let capturedItemIds: string[] = [];
    // (Construct a fake supabase + fetch mock here following this test file's
    // existing pattern for attemptItemsRefresh tests -- capture the itemIds
    // array actually passed to fetchEbayItemsBulk's underlying fetch calls,
    // e.g. via a fetch spy counting distinct v1|<n>|0 URLs hit, or by
    // asserting on the mocked fetch call count directly if that's this file's
    // existing pattern for fetchEbayItemsBulk-adjacent tests.)
    // ... existing test file's specific mocking pattern goes here ...
    // Assertion: exactly 5 (ITEMS_REFRESH_PROBE_CAP) distinct itemIds were
    // fetched, not 20.
  },
);
```

**Note for whoever implements this**: the exact mocking mechanics for this test depend on this test file's existing pattern for testing `attemptItemsRefresh` (which itself calls `fetchEbayItemsBulk`, which calls real `fetch`). Read the existing tests around `fetchEbayItemsBulk` (lines 658-822 per earlier investigation) to match the established fetch-mocking convention in this file exactly, rather than inventing a new one. The core assertion that matters: **given a stored `comp_item_ids` array of 20 entries, the number of distinct outbound HTTP calls (or distinct itemIds passed to `fetchEbayItemsBulk`) is capped at 5, not 20.**

### B5. Update `todo.md` / add a monitoring note

Per this repo's own working pattern (CLAUDE.md's "monitoring to-dos" precedent from the 90%-threshold change earlier in this session), add a note to `todo.md` (or a new memory) for a **1-week check after this deploys**:

- Query `ebay_browse_call_log` daily totals by resource for the week following deploy — confirm combined daily total stays comfortably under 5,000 (target: well under 4,500, the 90% critical threshold), not just "doesn't 429."
- Query how often `attemptItemsRefresh`'s `isItemsRefreshUsable` check now rejects the (5-probe, capped) result and falls through to full search — if this happens often, `ITEMS_REFRESH_PROBE_CAP=5` may be too aggressive relative to real-world delisting rates for this app's listings, and the cap may need to move up slightly (with the daily-volume math re-checked at the new value before shipping).
- Confirm `checkBrowseQuotaHeadroom`'s `reason` field (visible in function logs) is reporting real `reset_at`-derived boundaries (e.g. "derived from poll at ...") rather than falling back to UTC-midnight on every call — if it's ALWAYS falling back, that means `ebay-quota-monitor`'s hourly poll isn't populating fresh rows reliably, which would need separate investigation (check `ebay-quota-monitor`'s own invocation logs/cron health).

---

## Part C: Bulk-entitlement request (parallel track, non-blocking, do independently of A/B)

Confirmed via external research: eBay's bulk `getItems` endpoint requires the separate `buy.item.bulk` OAuth scope (distinct from the base `buy.item` scope this app already has for single-item `getItem` calls), gated behind:

1. An **Application Growth Check (AGC)** submitted via the Developer Portal's Production Keyset dashboard, explicitly requesting the `buy.item.bulk` scope.
2. A **Developer Technical Support (DTS) ticket** stating the architecture and business use case (why single-item `getItem` is insufficient — cite this exact incident: quota exhaustion from N single-item calls replacing what should be 1 bulk call).
3. Typical turnaround: **2-4 weeks** (DTS responds in 3-5 business days; compliance review adds the rest).
4. Prerequisites: verified production developer account in good standing, zero compliance strikes, a working sandbox demo, and — notably — apps facilitating buyer discovery/traffic conversion are "typically required" to belong to the eBay Partner Network (EPN); worth clarifying in the DTS ticket whether this app's use case (internal comp-pricing for the seller's OWN listings, not buyer-facing discovery) actually triggers that requirement, since it may not apply here.

**Action for the user (not a code task):** file the AGC request + DTS ticket now, in parallel with implementing Parts A/B. If/when `buy.item.bulk` is granted, `fetchEbayItemsBulk` can be reverted to call the real bulk endpoint (1 call covers up to 20 ids) instead of looping single-item calls — at which point `ITEMS_REFRESH_PROBE_CAP` could likely be raised back toward 20 with a corresponding call-volume win. This is a follow-up, not part of this fix — flagged here so it isn't lost, but Parts A/B must not be gated on this landing (2-4 week timeline, no guarantee of approval).

---

## Rollout plan

1. Implement Part A (A1-A3) on a branch. Run full test suite (`deno test --allow-env supabase/functions/_helpers/competitorSearch.test.ts`), `deno fmt --check`, `deno lint`. Do NOT touch Part A4 (`ebay-quota-monitor`) in the same PR unless it's trivial — consider a separate follow-up PR for A4 to keep the diff reviewable.
2. Implement Part B (B1-B4) on a separate branch (or the same one, as a second commit, reviewer's preference) — but Part A should merge/deploy FIRST if split, since B's own safety depends on A's gate being accurate.
3. Before merging: re-run `node scripts/replay-corpus.mjs` if touched files overlap category-lookup (they don't here, but confirm no accidental import chain pulls this into that gate).
4. After deploy: monitor per B5's checklist for at least 3-7 days (spans one full realistic incident-recurrence window) before considering this "done."
5. **Rollback plan**: if the fix doesn't behave as expected (e.g. `checkBrowseQuotaHeadroom` starts reporting `hasHeadroom: false` far more often than expected, effectively disabling the refresh feature) — the safest rollback is reverting Part A's `checkBrowseQuotaHeadroom` body to the pre-fix UTC-midnight-only version (Part A's fallback path IS that pre-fix behavior, so setting `POLL_STALENESS_MS` to `0` would force permanent fallback without a full code revert — a fast, reversible kill switch worth keeping in mind, though a real revert commit is cleaner for a permanent rollback). For Part B, reverting `ITEMS_REFRESH_PROBE_CAP` upward (or removing the cap / restoring `REFRESH_CONCURRENCY`/`BATCH_LIMIT` to their pre-fix values) is a one-line-per-constant change, no migration involved.

## Open items not resolved by this plan (flag to user, do not resolve unilaterally)

- Whether `ITEMS_REFRESH_PROBE_CAP = 5` is the right number long-term, versus some other value — chosen here to comfortably clear `isItemsRefreshUsable`'s `minCount=3` floor while meaningfully bounding cost; B5's monitoring plan is how this gets validated or adjusted with real data.
- Whether `BATCH_LIMIT = 10` / `REFRESH_CONCURRENCY = 5` slow the OVERALL rate at which the whole listing backlog gets refreshed to an unacceptable degree for users with many stale listings (fewer listings processed per tick, but ticks are still every 5 minutes, so the backlog drain rate drops from 30/5min to 10/5min = 2,880/day theoretical max vs. 8,640/day before). If a user has thousands of listings, this could mean some listings' comp prices go stale for longer before catching up. Not addressed in this plan — flagged as a real tradeoff the user should be aware of, not silently accepted.
- The bulk-entitlement request (Part C) outcome and timeline are entirely outside this codebase's control.
