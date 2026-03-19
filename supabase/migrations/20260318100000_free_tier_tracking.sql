-- =====================================================================
-- Free Tier Implementation — Phase 1: Database Migration
-- File: 20260318100000_free_tier_tracking.sql
-- Purpose: Add columns, indexes, and functions for per-org rolling-window
--          credit tracking and eBay account metadata
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. profiles: eBay connection metadata (OQ-3: one-account rule)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ebay_username TEXT,
  ADD COLUMN IF NOT EXISTS ebay_account_type TEXT
    CHECK (ebay_account_type IN ('individual', 'business', NULL));

COMMENT ON COLUMN public.profiles.ebay_username IS
  'Connected eBay account username. NULL = no account linked. '
  'Written only by exchange_code action (service role). '
  'Used to enforce the one-account rule for non-Unlimited users.';

COMMENT ON COLUMN public.profiles.ebay_account_type IS
  '"individual" | "business" from eBay Identity API. Informational only; '
  'NOT used for access-control decisions (OQ-3 RESOLVED).';

-- ─────────────────────────────────────────────────────────────────────
-- 2. organizations: rolling-window reset anchor (OQ-2, OQ-4)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS free_tier_reset_day SMALLINT
    CHECK (free_tier_reset_day BETWEEN 1 AND 31);

COMMENT ON COLUMN public.organizations.free_tier_reset_day IS
  'Day-of-month (1–31) when this org''s free credit window resets. '
  'Set by handle_new_user trigger at org creation (= user signup day). '
  'NULL for orgs created before this migration → fresh-start on deploy (OQ-7 RESOLVED).';

-- ─────────────────────────────────────────────────────────────────────
-- 3. usage_tracking: org affiliation for per-org quota (OQ-4 RESOLVED)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.usage_tracking
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

COMMENT ON COLUMN public.usage_tracking.org_id IS
  'The organization this usage event belongs to. '
  'Populated by analyze-item and publish functions via service role. '
  'Per-org credit checks: WHERE org_id = <orgId> instead of WHERE user_id = <userId>.';

-- Performance index for per-org rolling-window queries
CREATE INDEX IF NOT EXISTS idx_usage_tracking_org_action_ts
  ON public.usage_tracking (org_id, action_type, created_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Backfill: attribute existing usage rows to user's earliest org
-- ─────────────────────────────────────────────────────────────────────
UPDATE public.usage_tracking ut
SET org_id = (
  SELECT om.org_id
  FROM public.org_members om
  WHERE om.user_id = ut.user_id
  ORDER BY om.created_at ASC
  LIMIT 1
)
WHERE ut.org_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. PL/pgSQL function: rolling-window start computation
--    Clamps reset_day to the last day of the month
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_free_tier_window_start(p_reset_day SMALLINT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_this_month_last_day  INT;
  v_last_month_last_day  INT;
  v_this_window          DATE;
  v_prev_window          DATE;
BEGIN
  -- Days in current month
  v_this_month_last_day := EXTRACT(DAY FROM
    (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 day'));

  -- Clamp reset_day to this month's length
  v_this_window := DATE_TRUNC('month', NOW()::DATE)
    + (LEAST(p_reset_day, v_this_month_last_day) - 1);

  IF v_this_window <= NOW()::DATE THEN
    RETURN v_this_window::TIMESTAMPTZ;
  END IF;

  -- This month's day hasn't arrived yet — use previous month
  v_last_month_last_day := EXTRACT(DAY FROM
    (DATE_TRUNC('month', NOW() - INTERVAL '1 month') + INTERVAL '1 month' - INTERVAL '1 day'));

  v_prev_window := DATE_TRUNC('month', (NOW() - INTERVAL '1 month')::DATE)
    + (LEAST(p_reset_day, v_last_month_last_day) - 1);

  RETURN v_prev_window::TIMESTAMPTZ;
END; $$;

COMMENT ON FUNCTION public.get_free_tier_window_start IS
  'Returns the UTC timestamp marking the start of a user''s current free-credit window. '
  'Clamps reset_day to the last day of the month when that day does not exist '
  '(e.g., reset_day=31 in February → Feb 28/29). '
  'Used by analyze-item to determine the start of the rolling-window period for per-org credit counting.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. subscriptions table RLS policy (OQ-11 RESOLVED: table confirmed present)
-- ─────────────────────────────────────────────────────────────────────
-- Verify the table has RLS enabled; if not, enable it
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Add SELECT policy scoped to user's own subscription
-- (Prevents unauthenticated reads; service role bypasses this for get-free-credits)
-- Note: DROP POLICY IF EXISTS first (CREATE POLICY does not support IF NOT EXISTS)
DROP POLICY IF EXISTS "Users can read own subscription" ON public.subscriptions;

CREATE POLICY "Users can read own subscription"
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────
-- 7. UPDATE handle_new_user() function to set free_tier_reset_day
-- ─────────────────────────────────────────────────────────────────────
-- NOTE: The trigger 'on_auth_user_created' calls the function 'handle_new_user()'.
--       After the org INSERT completes (in the ELSE block), add this UPDATE:
--
--   UPDATE public.organizations
--     SET free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT
--     WHERE id = new_org_id;
--
-- MANUAL VERIFICATION REQUIRED:
-- 1. Verify the trigger and function exist:
--    SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--    SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'handle_new_user';
-- 
-- 2. Update the function body using:
--    CREATE OR REPLACE FUNCTION public.handle_new_user() ... (see PHASE_1_DEPLOYMENT.md Step 3)
--
-- =====================================================================
