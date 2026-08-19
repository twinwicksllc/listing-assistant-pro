-- Migration: add profiles.last_ebay_sync_at
--
-- Fixes a starvation bug found while rolling out inventory-sync-cron
-- (20260818000000 and friends): get_users_for_inventory_sync originally
-- derived "last synced" purely from MIN(last_seen_at) over
-- user_active_listings. A user whose active-listing enumeration legitimately
-- (or due to an error) returns zero listings never gets a row written to
-- that table at all, so their MIN(last_seen_at) stays NULL forever --
-- which always sorts first (NULLS FIRST) -- so that user gets re-selected
-- on every single tick, permanently occupying a sync slot instead of
-- waiting out the staleness window like everyone else. Confirmed live
-- 2026-08-18/19: inventory-sync-cron kept selecting the same user every
-- invocation, and that user had zero rows in competitor_prices too,
-- ruling out this being the known 539-listing account from the original
-- WORKER_RESOURCE_LIMIT incident -- just an account with genuinely nothing
-- to sync, permanently stuck at the front of the queue regardless.
--
-- This was a deliberate design choice at the time (avoid a second,
-- independently-updated source of truth that could drift from
-- user_active_listings' actual state), but that drift risk is smaller than
-- the starvation bug it caused. This column is set unconditionally at the
-- end of every sync attempt in syncUserInventory
-- (supabase/functions/_helpers/ebayInventorySync.ts), regardless of how
-- many listings were found, so a legitimately-empty account only occupies
-- a slot once per staleness window like everyone else.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_ebay_sync_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_last_ebay_sync_at_connected
  ON public.profiles (last_ebay_sync_at ASC NULLS FIRST)
  WHERE ebay_refresh_token IS NOT NULL;

COMMENT ON COLUMN public.profiles.last_ebay_sync_at IS
  'Set unconditionally at the end of every inventory-sync-cron attempt for this user, regardless of how many active listings were found. Used by get_users_for_inventory_sync to pick the next sync batch -- prevents a zero-listing account from being re-selected on every tick forever.';
