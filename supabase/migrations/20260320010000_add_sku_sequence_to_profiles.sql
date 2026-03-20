-- ============================================================
-- Migration: Add sequential SKU sequence counter to profiles
-- ============================================================
--
-- Adds a per-user counter for generating sequential SKUs instead of
-- random ones. Each user starts at 1000 and increments by 1 for each
-- new listing published. SKU format: LA01000, LA01001, LA01002, etc.
--
-- Atomic increment on server-side (in ebay-publish function) ensures
-- no duplicate SKUs even if multiple publishes happen concurrently.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS next_sku_sequence INTEGER DEFAULT 1000;

COMMENT ON COLUMN public.profiles.next_sku_sequence IS
  'Next sequential number for eBay SKU (starts at 1000, increments by 1). Format: LA + zero-padded 5 digits (LA01000, LA01001, etc.)';

-- Initialize any existing profiles that don't have this value set
UPDATE public.profiles SET next_sku_sequence = 1000 WHERE next_sku_sequence IS NULL;

-- Ensure this column is never null going forward
ALTER TABLE public.profiles ALTER COLUMN next_sku_sequence SET NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'Migration 20260320010000 completed:';
  RAISE NOTICE '  - Added profiles.next_sku_sequence (initialized to 1000 for all users)';
END;
$$;
