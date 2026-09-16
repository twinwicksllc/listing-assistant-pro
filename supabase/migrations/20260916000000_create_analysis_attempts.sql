-- =====================================================================
-- analysis_attempts: diagnostic tracking for analyze-item's silent-death
-- failure mode.
--
-- Why this exists: Supabase Edge Functions are killed by the gateway at a
-- hard ~150s ceiling with NO exception thrown inside the function -- no
-- catch block runs, nothing reaches Sentry (captureException only fires
-- from inside analyze-item's own catch), nothing is logged. Production data
-- pulled 2026-09-16 showed 23 confirmed billed Gemini calls (gemini_usage)
-- for analyze-item in 5 days, all 23 with a matching usage_tracking credit
-- charge, but only 1 matching final StageTimer completion line -- strongly
-- suggesting most requests that reach the expensive Gemini call never
-- return a response at all, silently, while still being charged.
--
-- This table gives analyze-item a server-side, queryable signal for that
-- failure mode: a row is written 'started' at the top of the handler and
-- updated to 'completed'/'failed' at the same two points StageTimer's
-- timer.log() already fires. A row stuck at 'started' for longer than the
-- gateway ceiling is unambiguous proof of a silent kill -- something no
-- amount of application-level logging could show before this table existed.
--
-- This is a diagnostic/reconciliation table, not a billing table. It is
-- deliberately separate from usage_tracking/gemini_usage.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.analysis_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invocation_id TEXT NOT NULL,
  user_id UUID,
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'failed')),
  client_observed_timeout BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  total_ms INTEGER
);

COMMENT ON TABLE public.analysis_attempts IS
  'Diagnostic tracking for analyze-item invocations, written by the service '
  'role. A row stuck at status=started for longer than the Edge Function '
  'gateway ceiling (~150s) indicates a silent platform-level kill that never '
  'reached the function''s own catch block and therefore never reached '
  'Sentry. client_observed_timeout is set true by a small dedicated report '
  'endpoint the frontend calls when supabase.functions.invoke() throws '
  'FunctionsFetchError (a network-level failure distinct from a real HTTP '
  'error response) -- this is the client-side half of the same signal.';

COMMENT ON COLUMN public.analysis_attempts.invocation_id IS
  'Matches the [invocationId] prefix already used throughout analyze-item''s '
  'own console.log/console.warn lines, so a stuck row can be cross-referenced '
  'against any log lines that did make it out before a kill.';

COMMENT ON COLUMN public.analysis_attempts.client_observed_timeout IS
  'True when the frontend itself observed FunctionsFetchError for this '
  'invocation. Written via a separate report call, not by analyze-item '
  'itself -- the frontend has no service-role key, so writes go through a '
  'narrow dedicated path rather than direct table access.';

CREATE INDEX IF NOT EXISTS idx_analysis_attempts_status_started
  ON public.analysis_attempts (status, started_at);

CREATE INDEX IF NOT EXISTS idx_analysis_attempts_invocation_id
  ON public.analysis_attempts (invocation_id);

ALTER TABLE public.analysis_attempts ENABLE ROW LEVEL SECURITY;

-- Matches usage_tracking's existing RLS shape: a user can see their own
-- rows; only the service role writes (analyze-item and the report endpoint
-- both authenticate as service role).
CREATE POLICY "Users can view own analysis attempts" ON public.analysis_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
