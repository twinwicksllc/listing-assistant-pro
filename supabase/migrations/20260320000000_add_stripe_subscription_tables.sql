-- ============================================================
-- Add Stripe subscription support tables
--
-- This migration adds:
--   1. subscriptions table - Stores Stripe subscription data
--   2. stripe_customer_id column to profiles table - For caching
--   3. RLS policies for security
--   4. Indexes for performance
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Add stripe_customer_id column to profiles table
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'stripe_customer_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN stripe_customer_id TEXT;
    RAISE NOTICE 'Added column profiles.stripe_customer_id';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 2. Create subscriptions table
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_sub_id       TEXT        NOT NULL UNIQUE,
  stripe_cust_id      TEXT        NOT NULL,
  product_id          TEXT,
  price_id            TEXT,
  status              TEXT        NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  current_period_end  TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- 3. Enable Row Level Security
-- ----------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- 4. RLS Policies
-- ----------------------------------------------------------------

-- SELECT: users can read their own subscriptions
DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: service role can insert (for webhooks)
-- Edge functions use service role key, so they need insert permission
DROP POLICY IF EXISTS "Service role can insert subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can insert subscriptions"
  ON public.subscriptions
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- UPDATE: service role can update (for webhooks)
DROP POLICY IF EXISTS "Service role can update subscriptions" ON public.subscriptions;
CREATE POLICY "Service role can update subscriptions"
  ON public.subscriptions
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ----------------------------------------------------------------
-- 5. Indexes for performance
-- ----------------------------------------------------------------

-- Index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);

-- Index on stripe_sub_id for webhook lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON public.subscriptions(stripe_sub_id);

-- Index on stripe_cust_id for customer lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_cust_id ON public.subscriptions(stripe_cust_id);

-- Index on status for filtering active subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- ----------------------------------------------------------------
-- 6. Auto-update updated_at trigger
-- ----------------------------------------------------------------
DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------
DO $$
DECLARE
  profile_column_exists BOOLEAN;
  subscriptions_count INT;
BEGIN
  -- Verify stripe_customer_id column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'stripe_customer_id'
  ) INTO profile_column_exists;
  
  IF NOT profile_column_exists THEN
    RAISE EXCEPTION 'profiles.stripe_customer_id column was not added!';
  END IF;
  
  -- Verify subscriptions table exists
  SELECT COUNT(*) INTO subscriptions_count FROM public.subscriptions;
  
  RAISE NOTICE 'profiles.stripe_customer_id column exists ✓';
  RAISE NOTICE 'subscriptions table exists with % rows', subscriptions_count;
  RAISE NOTICE 'RLS enabled on subscriptions table ✓';
  RAISE NOTICE 'Migration 20260320000000 completed successfully ✓';
END;
$$;