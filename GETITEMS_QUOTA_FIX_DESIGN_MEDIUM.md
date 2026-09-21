# getItems Quota Fix — Design (medium effort, direct pass, no workflow)

Scope: **only** the getItems single-item-loop cost-inversion problem (Bug 1 from `QUOTA_STORM_FIX_PLAN.md`). Does not re-cover the reset-window bug (Bug 2) or the bulk-entitlement request — those are unchanged from the prior plan. This is a from-scratch design pass at lower effort, done directly rather than via workflow fan-out, to see whether it converges on the same recommendation or something simpler.

## The problem, restated tightly

`attemptItemsRefresh` probes up to 20 stored comp IDs per listing via single-item HTTP calls (forced by eBay's 403 on the real bulk endpoint). The full-search path it's meant to be a cheaper alternative to costs only 2-4 calls/listing (confirmed: `buildSearchPlan` caps tier-1 at 2 queries × 1-2 filter modes each, escalating to tier-2 only if quality is thin). So the "cheap" path is up to 10x more expensive than the "expensive" path it exists to avoid — that's the whole bug.

`competitor-prices-cron` runs every 5 minutes (288 ticks/day), pulling up to `BATCH_LIMIT=30` stale listings per tick, `REFRESH_CONCURRENCY=15` at a time.

## Two knobs, and which one actually matters

There are two independent levers: **(a) cost per listing** (how many IDs to probe), and **(b) volume per day** (how many listings get a refresh attempt at all). Fixing (a) without bounding (b) doesn't work — I confirmed this arithmetically in the prior plan: even capping probes at 5/listing, 30 listings/tick × 288 ticks/day × 5 calls = 43,200/day realistic case, still 8.6x over the 5,000/day ceiling. The quota GATE (`checkBrowseQuotaHeadroom`) is what actually enforces the daily ceiling — the per-listing cap only controls how fast the gate gets approached and how bursty a single tick is before the gate has a chance to catch up.

So the real design question isn't "what's the right per-listing cap" in isolation — it's "what combination of (per-listing cap) + (tick size/concurrency) keeps a single tick's burst small enough that the gate (once fixed for the reset-window bug) can actually intervene before a burst blows past 90% in one shot."

## Recommendation (same conclusion as the prior ultracode pass, reached independently here)

1. **Cap probed IDs per listing to 5** (`ITEMS_REFRESH_PROBE_CAP = 5`), sliced from the front of `comp_item_ids`. Justification: `isItemsRefreshUsable`'s own `minCount` default is 3 — probing 5 still comfortably clears that floor even if 1-2 have delisted, while cutting worst-case per-listing cost from 20 to 5 (a 4x reduction, landing in the same order of magnitude as the full-search baseline's 2-4, rather than 5-10x above it).

2. **Shrink `BATCH_LIMIT` from 30 to 10, and `REFRESH_CONCURRENCY` from 15 to 5.** This doesn't reduce the total number of listings refreshed per day (same 288 ticks/day, cron cadence unchanged) — it reduces how many calls can be in-flight simultaneously before any of them land in `ebay_browse_call_log`, which matters because the quota gate is a live COUNT query: a smaller concurrent slice means the gate re-synchronizes with reality more often within a single tick, catching a runaway burst sooner rather than after all 15 listings' calls have already fired.

3. **The daily ceiling is still enforced by `checkBrowseQuotaHeadroom` alone**, not by these two constants. Once quota crosses the 90% critical threshold (`CRITICAL_QUOTA_RATIO`), the gate returns `hasHeadroom: false` and the cron falls through to stale-cache/no-data for the rest of the day — this part of the design doesn't change, and depends on Bug 2 (the reset-window fix) being correct, since a wrong gate can't stop anything on time.

## Worst-case math (same method, redone here independently)

- Per listing (worst case, all retries exhausted): 5 IDs × 3 attempts = 15 calls.
- Per listing (realistic, no retries): 5 calls.
- Per tick, worst case: 10 listings × 15 = 150 calls.
- Per tick, realistic: 10 × 5 = 50 calls.
- Per day, worst case if every tick were full: 150 × 288 = 43,200.
- Per day, realistic if every tick were full: 50 × 288 = 14,400.

Both numbers are still theoretically above 5,000/day if literally every tick all day found a full batch of stale listings needing all worst-case retries — which is why the gate (Bug 2's fix), not these constants alone, is the actual daily backstop. These constants exist to keep any SINGLE tick's burst small relative to the 4,500-call headroom margin (90% of 5,000), so the gate has room to react across several ticks rather than being blown through in one.

## Where this differs from (or confirms) the prior ultracode-effort plan

**Confirms, unchanged:** `ITEMS_REFRESH_PROBE_CAP = 5`, `BATCH_LIMIT = 10`, `REFRESH_CONCURRENCY = 5`, and the core insight that the per-call cap alone is insufficient without the gate fix.

**Simplification found at this effort level:** the prior plan's Part B3 discussion spent significant space explaining why re-checking the gate mid-tick via `Promise.all` doesn't fully close the intra-slice race, then concluded the fix is smaller concurrency + relying on the gate's live re-query. This pass reaches the same place faster: there is no separate "per-tick budget" mechanism to design — it's just the existing gate, called more frequently (smaller slices), which is already what the prior plan landed on after a longer path there. No functional difference, just less exposition needed to arrive at it.

**Not re-litigated here (out of scope for this pass, deferred to the fuller plan):** the retire-the-feature-entirely angle, the webhook/delta-feed alternative (already ruled out by direct codebase search — no existing infrastructure), and the shared-atomic-budget-table angle (a Postgres advisory-lock/reservation mechanism) — the prior plan's adversarial verification step considered these and this pass didn't re-run that comparison. If you want that comparison re-verified at this effort level too, say so and I'll do a second pass on just that question.

## Implementation (identical to the prior plan's Part B — no changes needed there)

See `QUOTA_STORM_FIX_PLAN.md`, Part B (sections B1-B4) for the exact code diffs, constant placements, and test cases — this design pass arrived at the same recommendation, so that part of the existing document is still the one to implement from. This file exists to answer your specific question ("what does a medium-effort pass conclude") rather than to duplicate the implementation detail.
