-- Migration: reconcile remaining subscriptions/profiles constraint and index drift
--
-- Resolves the mechanical part of RBR-0022. Full diff (2026-08-14, re-verified
-- 2026-08-19) found: `profiles_stripe_customer_id_key` (a UNIQUE constraint on
-- profiles.stripe_customer_id, present in production, declared by no
-- migration) and four `idx_subscriptions_*` indexes (user_id, stripe_sub_id,
-- stripe_cust_id, status -- declared by the original migration
-- 20260320000000_add_stripe_subscription_tables.sql but absent in live
-- production, cause unconfirmed). All five are idempotent adds -- safe
-- against current production (matches what should already be true per the
-- original migration's own intent) and against a fresh database.
--
-- DELIBERATELY NOT INCLUDED: subscriptions_status_check. The original
-- migration declares CHECK (status IN ('active', 'trialing', 'past_due',
-- 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')) --
-- eight values -- but live production's status column DEFAULT is
-- 'inactive', which is NOT in that list. Reinstating the CHECK verbatim
-- would make any future insert relying on the column default fail
-- immediately. This needs an owner decision (add 'inactive' to the allowed
-- list, treat 'inactive' as a bug in the live default and change the
-- default instead, or something else) before it can be resolved -- tracked
-- as the remaining open item under RBR-0022.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_stripe_customer_id_key'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_stripe_customer_id_key UNIQUE (stripe_customer_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON public.subscriptions(stripe_sub_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust_id ON public.subscriptions(stripe_cust_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
