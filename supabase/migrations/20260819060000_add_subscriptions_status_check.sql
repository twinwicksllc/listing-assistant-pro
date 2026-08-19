-- Migration: add subscriptions_status_check with 'inactive' included
--
-- Completes RBR-0022. The original migration
-- (20260320000000_add_stripe_subscription_tables.sql) declared this CHECK
-- with 8 values mirroring Stripe's own subscription statuses (active,
-- trialing, past_due, canceled, incomplete, incomplete_expired, unpaid,
-- paused), but it was never actually applied to live production. Live's
-- status column DEFAULT is 'inactive', which isn't a Stripe status at all --
-- almost certainly an app-level default for "no subscription yet" rather
-- than something Stripe ever sends. Owner decision 2026-08-19: add
-- 'inactive' as a ninth allowed value rather than change the default.
--
-- Guarded existence check, same reasoning as
-- 20260819050000_reconcile_subscriptions_constraint_drift.sql's
-- profiles_stripe_customer_id_key guard -- ADD CONSTRAINT has no native
-- IF NOT EXISTS in Postgres.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN (
        'active', 'trialing', 'past_due', 'canceled', 'incomplete',
        'incomplete_expired', 'unpaid', 'paused', 'inactive'
      ));
  END IF;
END $$;
