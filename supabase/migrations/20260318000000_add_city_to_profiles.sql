-- Add city column to profiles table for eBay inventory location
-- postal_code already exists (from 20260314000000 migration)
-- city is used alongside postal_code when creating the eBay inventory location
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS city TEXT;

COMMENT ON COLUMN public.profiles.city IS
  'Seller city — used alongside postal_code for eBay inventory location address';