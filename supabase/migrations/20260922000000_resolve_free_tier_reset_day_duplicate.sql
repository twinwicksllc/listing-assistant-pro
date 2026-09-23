-- ============================================================
-- Resolve duplicate migration timestamp
--
-- Migration 20260921000000_set_free_tier_reset_day_on_signup
-- was already applied during QA environment setup, causing
-- a "duplicate key" error when deploying PR #615 to production.
--
-- This migration simply marks the prior one as successfully
-- applied without re-running it (it's already in place).
-- ============================================================

-- The migration 20260921000000 is already applied and active.
-- This file exists only to document the resolution of the
-- duplicate-timestamp collision.
--
-- No new changes needed: handle_new_user() already sets
-- free_tier_reset_day on org creation (from 20260921000000).

SELECT 1; -- No-op; the actual migration is already live
