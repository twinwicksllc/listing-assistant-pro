-- Add eBay business policy IDs to the drafts table so that policy
-- selections made during listing creation are preserved for draft publishing.
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS fulfillment_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_policy_id TEXT,
  ADD COLUMN IF NOT EXISTS return_policy_id TEXT;
