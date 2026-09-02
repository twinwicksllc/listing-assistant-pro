-- Creates the bare `subscriptions` table ahead of when it's first referenced.
--
-- 20260318100000_free_tier_tracking.sql (two migrations after this one) ALTERs
-- this table and assumed it already existed -- true on every environment that
-- had it created out-of-band before that migration ever ran, but not true for
-- a database replaying every migration from scratch (2026-09-02, found while
-- setting up the listrassistr-qa Supabase project). The "real" creation
-- migration, 20260320000000_add_stripe_subscription_tables.sql, only runs two
-- days later still and adds RLS/policies/indexes/trigger on top of this same
-- table via CREATE TABLE IF NOT EXISTS, so it stays a safe no-op there.
--
-- Column definitions are copied verbatim from that later migration so the two
-- files can never define the table differently.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_sub_id        TEXT        NOT NULL UNIQUE,
  stripe_cust_id       TEXT        NOT NULL,
  product_id           TEXT,
  price_id             TEXT,
  status               TEXT        NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  current_period_end   TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
