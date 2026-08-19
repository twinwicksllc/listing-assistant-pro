-- Migration: fix subscriptions_status_check non-convergence, add missing DEFAULT
--
-- Follow-up to 20260819060000_add_subscriptions_status_check.sql, caught by
-- Copilot review on PR #519 after it had already merged (so the flawed
-- migration file itself is left as history, not edited -- this corrects it
-- with a new migration instead, standard practice once a migration has
-- shipped).
--
-- The bug: that migration guarded with
-- `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...')`, which
-- only checks whether a constraint by that name exists at all -- not
-- whether it already has the right definition. On current production the
-- constraint didn't exist yet, so the guard happened to work correctly
-- there. But on a FRESH database built by replaying every migration from
-- scratch, the ORIGINAL migration
-- (20260320000000_add_stripe_subscription_tables.sql) already creates
-- subscriptions_status_check with its original 8-value list (no
-- 'inactive') before 20260819060000 ever runs -- so that guard's condition
-- would be false, the 9-value ALTER would never fire, and the fresh
-- database would silently end up with the wrong 8-value constraint.
-- Production and a fresh rebuild would diverge, which is exactly what
-- these reconciliation migrations exist to prevent.
--
-- Also adds `DEFAULT 'inactive'` on the status column itself, which is set
-- in live production (confirmed via information_schema.columns, 2026-08-19)
-- but declared by no migration at all, including the original one -- a
-- third, separate drift caught by the same review.
--
-- Fix: unconditionally drop-if-exists then re-add, so the end state is the
-- same 9-value constraint regardless of which (possibly wrong) definition
-- existed beforehand -- convergent across both production and a fresh
-- rebuild.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check'
  ) THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_status_check;
  END IF;
END $$;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN (
    'active', 'trialing', 'past_due', 'canceled', 'incomplete',
    'incomplete_expired', 'unpaid', 'paused', 'inactive'
  ));

ALTER TABLE public.subscriptions
  ALTER COLUMN status SET DEFAULT 'inactive';
