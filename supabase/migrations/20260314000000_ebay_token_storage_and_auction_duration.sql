-- ============================================================
-- Migration: eBay token server-side storage + auction duration
-- ============================================================
--
-- 1. Add eBay OAuth token columns to profiles table
--    Storing tokens server-side (vs localStorage) prevents XSS exposure.
--
-- 2. Add postal_code to profiles for inventory location creation
--    eBay Inventory API requires a merchantLocationKey (tied to postal code)
--    in every offer payload before publishing.
--
-- 3. Add auction_duration to drafts table
--    eBay requires explicit duration for AUCTION format listings:
--    Days_1, Days_3, Days_5, Days_7, or Days_10
-- ============================================================

-- ----------------------------------------------------------------
-- 1. eBay token columns on profiles
-- ----------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ebay_access_token     text,
  ADD COLUMN IF NOT EXISTS ebay_refresh_token    text,
  ADD COLUMN IF NOT EXISTS ebay_token_expires_at timestamptz;

-- ----------------------------------------------------------------
-- 2. Postal code on profiles (used for eBay inventory location)
-- ----------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS postal_code text;

-- ----------------------------------------------------------------
-- 3. Auction duration on drafts
-- ----------------------------------------------------------------
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS auction_duration text DEFAULT 'Days_7';

-- ----------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260314000000 completed:';
  RAISE NOTICE '  - profiles.ebay_access_token added';
  RAISE NOTICE '  - profiles.ebay_refresh_token added';
  RAISE NOTICE '  - profiles.ebay_token_expires_at added';
  RAISE NOTICE '  - profiles.postal_code added';
  RAISE NOTICE '  - drafts.auction_duration added';
END;
$$;