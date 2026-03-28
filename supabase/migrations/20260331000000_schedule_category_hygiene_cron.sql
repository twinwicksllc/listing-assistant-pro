-- Migration: Schedule category-hygiene-cron weekly job
--
-- OPTION A: Using Supabase Dashboard (Recommended)
-- 1. Go to Dashboard > Database > Cron Jobs
-- 2. Create a new cron job with:
--    - Name: category-hygiene-weekly
--    - Schedule: 0 2 * * 0 (Every Sunday at 2 AM UTC)
--    - Command: SELECT 1; (placeholder - actual call needs pg_net)
--
-- OPTION B: Using pg_cron + pg_net (requires Vault setup)
-- See: https://supabase.com/docs/guides/functions/schedule-functions
--
-- OPTION C: External scheduler (GitHub Actions, cron-job.org, etc.)
-- Call the endpoint weekly:
--   POST https://wjkmpxmzcsphvchehnfh.supabase.co/functions/v1/category-hygiene-cron
--   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
--   Body: {}

-- Enable pg_cron extension for future use
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a simple log table for tracking manual runs (optional)
CREATE TABLE IF NOT EXISTS public.category_hygiene_log (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  results JSONB,
  error TEXT
);

-- Add an RLS policy for service role only
ALTER TABLE public.category_hygiene_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on category_hygiene_log"
  ON public.category_hygiene_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.category_hygiene_log IS
  'Tracks category-hygiene-cron execution history for monitoring';