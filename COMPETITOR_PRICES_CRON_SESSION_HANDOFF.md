# Session handoff: competitor-prices-cron WORKER_RESOURCE_LIMIT fix

**Date:** 2026-08-18. Pick this up by reading this doc top to bottom, then jump to "Next steps" at the bottom.

## What happened, in order

1. `competitor-prices-cron` crashed in production with `WORKER_RESOURCE_LIMIT` (546) — Supabase's fixed, non-configurable per-invocation ceiling (2.0s cumulative CPU-time + 256MB memory; this budget does not reset across loop iterations within one invocation). Root cause: one user had 539+ stale listings, and the cron looped every connected user's entire backlog in-process in a single invocation.
2. Also fixed in passing: `supabase/setup-cli@v1` in `.github/workflows/deploy-functions.yml` was hitting GitHub API rate limits and a Node 20 deprecation warning — bumped to `@v3` (npm-based version resolution instead of the GitHub Releases API). This shipped in **PR #510** (merged, unrelated branch).
3. Designed and implemented a full redesign, approved via plan mode — see `C:\Users\fenwitr\.claude\plans\vectorized-noodling-kahan.md` for the complete plan with reasoning. Summary:
   - **New table** `user_active_listings` (migration `20260818000000`) — local cache of each user's active eBay listings, decoupling "what listings does a user have" (slow/expensive, needs a live `ebay-listings` call) from "does this listing need a competitor-price refresh" (fast/cheap).
   - **New function** `inventory-sync-cron` (`supabase/functions/inventory-sync-cron/index.ts`) — populates that cache, capped at 3 users/tick, scheduled every 15 min (migration `20260818030000`). Uses new helper `supabase/functions/_helpers/ebayInventorySync.ts` (`syncUserInventory`), which extracts the old per-user token-refresh + `ebay-listings`-call logic.
   - **Rewritten** `competitor-prices-cron/index.ts` — no longer loops per-user or calls `ebay-listings` at all. Reads a small, fairness-ranked batch (30/tick, `ROW_NUMBER() PARTITION BY user_id` so no single heavy user starves others) via new RPC `get_next_competitor_price_batch` (migration `20260818020000`), scheduled every 5 min (migration `20260818040000`).
   - New RPC `get_users_for_inventory_sync` (migration `20260818010000`) picks which users' inventory cache is oldest/never-synced, via `MIN(last_seen_at)` aggregate over `user_active_listings` (no new `profiles` column, to avoid a second drift-prone source of truth — **this decision is now suspect, see Open Bug below**).
   - `CACHE_TTL_MS` raised 8h → 24h in `supabase/functions/_helpers/competitorSearch.ts` to reduce steady-state churn.
   - Both crons scheduled via `cron.schedule()` for the first time ever — neither had a live schedule before this (confirmed via investigation: only ever invoked manually). This **revises DEC-0018** (which approved a daily cadence, made before that gap was discovered).
4. Shipped as **PR #511**, branch `fix/competitor-cron-resource-limit` — **merged** to `main` at commit `a13225b84df101e01a764d8cc434c7b652bc8659`, 2026-08-18T21:56:43Z.
5. Confirmed via `gh run view` on the resulting `deploy-functions.yml` run: all 5 migrations applied successfully (`Finished supabase db push`), all functions deployed including the two new/changed ones.
6. Manually triggered both functions via curl to verify end-to-end:
   - `competitor-prices-cron` → `{"success":true,"batchSize":6,"refreshed":6,"skipped":0,"elapsedSeconds":3.7}` — confirms the RPC cursor + refresh loop works.
   - `inventory-sync-cron` → repeatedly returns `{"success":true,"usersSynced":1,"totalListings":0,"totalEnded":0}`, **always the same user** (`a96bfdd8-cd02-40c3-8726-056c2c92bbfc`) — see Open Bug below.
7. **Security incident, resolved:** the user pasted the actual `CRON_SECRET` value in plaintext into this chat while reporting curl results. Flagged immediately; user has since **rotated it** (new value set in both the `cron_secret` Vault secret and the `CRON_SECRET` Edge Function secret) and confirmed the new secret works. The old value in this transcript/doc is dead. **No further action needed on this**, just noting it happened.

## Open bug — found, and now fixed and deployed (2026-08-25)

**Update 2026-08-25:** option (a) below was implemented — migrations `20260819000000_add_profiles_last_ebay_sync_at.sql` and `20260819010000_fix_inventory_sync_cursor_starvation.sql`, plus the corresponding write in `ebayInventorySync.ts` (`profiles.last_ebay_sync_at` set unconditionally after every sync attempt, regardless of outcome). Both migrations sat unapplied in production for six days due to an unrelated CI bug (see `REBRAND_PHASE_0_EXCEPTION_LOG.md`'s RBR-0034) and were confirmed applied 2026-08-25T21:23:43Z. The two open sub-questions below (same account as the 539-listing backlog? real enumeration bug?) were never chased down, since the fix in step 3 makes them moot for the starvation symptom either way — worth revisiting only if a fresh, unrelated zero-listings anomaly shows up.

**Symptom:** `inventory-sync-cron` keeps selecting the same single user (`a96bfdd8-cd02-40c3-8726-056c2c92bbfc`) every single invocation, and that user always returns `0 active, 0 ended` listings with no warning/error logged.

**Root cause (diagnosed, high confidence):** `syncUserInventory` (in `ebayInventorySync.ts`) returns early when `fetchActiveListings` returns zero listings, **without writing anything to `user_active_listings`**. Since `get_users_for_inventory_sync` derives "last synced" via `MIN(last_seen_at)` over that table, a user who is ever reported as having zero listings gets **no row, ever** — so their `MIN(last_seen_at)` is permanently `NULL`, which always sorts first (`NULLS FIRST`). This user will be selected on literally every future tick, forever, regardless of how much real time passes. This directly undermines the "no single user should monopolize a sync slot" design goal the whole redesign was built around — it's the same failure mode in miniature, just triggered by zero listings instead of many.

**Two sub-questions still open, need to check before fixing:**

1. Is `a96bfdd8-cd02-40c3-8726-056c2c92bbfc` the **same account** that had the 539-listing backlog in the original crash, or a different/test account? No warning was logged (no "missing refresh token" / "token refresh failed" / "ebay-listings failed" line), meaning the call chain completed successfully and `ebay-listings` itself reported zero active listings. If this is the _same_ account that had 539 listings a few hours earlier, going to 0 is suspicious and may indicate a real regression in the enumeration path (e.g. a subtle response-shape mismatch that only manifests for large inventories, or something changed on eBay's side). If it's a different account, 0 is plausibly just correct (an account with no current listings).
2. Check Supabase Dashboard → Table Editor → `profiles` for this user's `ebay_access_token` / `ebay_refresh_token` / `ebay_token_expires_at` sanity, and consider manually calling `ebay-listings` directly for this user to see the raw response shape, if question 1 points toward a real bug.

**Proposed fix (not yet implemented — needs go-ahead):** persist a "last sync attempt" signal that's written **unconditionally**, regardless of how many listings were found, so a legitimately-zero-listings account only occupies a slot once every `INVENTORY_STALE_MS` (6h) like everyone else. Two ways to do this, pick one:

- **(a)** Add a `profiles.last_ebay_sync_at TIMESTAMPTZ` column, set at the end of every `syncUserInventory` call regardless of outcome; change `get_users_for_inventory_sync` to order by that instead of (or alongside) the `user_active_listings` aggregate. This was explicitly avoided in the original design (to prevent two independently-updated sources of truth drifting), but that concern is smaller than the bug it would fix — recommend going with this.
- **(b)** A small dedicated tracking table (`user_inventory_sync_log(user_id, last_synced_at)`) instead of a `profiles` column — cleaner separation, one more table.

Recommend (a) for simplicity unless there's a reason to prefer (b).

## Reference

- **Plan file (full design + reasoning):** `C:\Users\fenwitr\.claude\plans\vectorized-noodling-kahan.md`
- **PR #511** (merged): https://github.com/twinwicksllc/listing-assistant-pro/pull/511
- **PR #510** (merged, unrelated setup-cli fix): https://github.com/twinwicksllc/listing-assistant-pro/pull/510
- **Branch `fix/competitor-cron-resource-limit`** — merged, safe to delete locally/remotely whenever.
- **Key files:** `supabase/functions/competitor-prices-cron/index.ts`, `supabase/functions/inventory-sync-cron/index.ts`, `supabase/functions/_helpers/ebayInventorySync.ts`, `supabase/functions/_helpers/competitorSearch.ts`, migrations `20260818000000` through `20260818040000`.
- **Manual trigger commands** (Windows cmd.exe — substitute the rotated `CRON_SECRET` yourself, don't paste it into chat):
  ```cmd
  curl -X POST "https://wcednzaxmxwfiijzmjmx.supabase.co/functions/v1/inventory-sync-cron" -H "Authorization: Bearer %CRON_SECRET%" -H "Content-Type: application/json"
  curl -X POST "https://wcednzaxmxwfiijzmjmx.supabase.co/functions/v1/competitor-prices-cron" -H "Authorization: Bearer %CRON_SECRET%" -H "Content-Type: application/json"
  ```

## Next steps (in order)

1. Check whether `a96bfdd8-cd02-40c3-8726-056c2c92bbfc` is the known 539-listing account or a different one (Dashboard → `profiles` table, or ask whoever owns that test account).
2. Based on that, decide if there's a real enumeration bug to chase (if same account) or it's a non-issue (if a legitimately-empty different account).
3. Implement the "last sync attempt" fix (option (a) recommended above) regardless — it's a real bug independent of the answer to #1.
4. Re-verify: trigger `inventory-sync-cron` a few times, confirm it cycles through _different_ users each time (or exhausts the pool and stops returning the same one), then trigger `competitor-prices-cron` and confirm `batchSize` grows as more users' inventories land in `user_active_listings`.
5. Once caught up, let the actual `cron.schedule()` entries run unattended for a while and spot-check logs/`cron.job_run_details` for steady-state health.
