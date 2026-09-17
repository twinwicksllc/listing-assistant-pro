-- Migration: tables for the eBay Browse API quota monitor
--
-- Follow-on to PR #580 (Phase 1.2b's search-fan-out cap), which fixed the
-- self-inflicted call-volume spike behind a real production 429 pattern
-- (confirmed 2026-09-17). eBay's Browse API has a real, hard 5,000-calls/day
-- limit per client_id, shared across every caller: live analyze-item
-- requests, competitor-prices-cron, market-watch-refresh. A live check
-- against this account's real keyset (2026-09-17, before any monitoring
-- existed) showed buy.browse already at 73.8% used (3,690/5,000) -- a real,
-- current risk, not theoretical. #580 reduced the rate of waste; this adds
-- visibility into the remaining budget so a spike is caught before the next
-- live 429, not after.
--
-- Two tables, two purposes -- confirmed via exploration that NEITHER of this
-- app's existing counter tables is a clean fit for both:
--
--   ebay_rate_limit_polls: one row per daily getRateLimits poll -- the
--   authoritative, ground-truth signal straight from eBay itself
--   (limit/count/remaining/reset/timeWindow). Shaped like cost_alerts
--   (service-role-only, no RLS, fixed numeric snapshot columns) rather than
--   usage_tracking, since this is per-resource numeric state, not a bare
--   "an event happened" marker.
--
--   ebay_browse_call_log: one row per actual Browse API call this app's own
--   code makes, for same-day visibility between daily polls. This genuinely
--   IS "count occurrences of an action within a time window" -- exactly
--   usage_tracking's own pattern -- but usage_tracking.user_id is NOT NULL
--   (confirmed by reading its original migration), and this is an app-level
--   count, not a per-user one. A separate table with a nullable user_id
--   avoids bending usage_tracking's per-user RLS model onto a global count.

CREATE TABLE IF NOT EXISTS public.ebay_rate_limit_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_name TEXT NOT NULL, -- e.g. "buy.browse"
  api_context TEXT, -- e.g. "buy"
  call_limit INTEGER NOT NULL,
  call_count INTEGER NOT NULL,
  call_remaining INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL,
  time_window_seconds INTEGER,
  alert_sent BOOLEAN NOT NULL DEFAULT false,
  polled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_rate_limit_polls_polled_at
  ON public.ebay_rate_limit_polls (polled_at DESC);

ALTER TABLE public.ebay_rate_limit_polls ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only, same as cost_alerts. Admin-facing reads go
-- through system-status (which already authenticates the caller as admin),
-- not direct table access from the frontend.

COMMENT ON TABLE public.ebay_rate_limit_polls IS
  'One row per daily poll of eBay''s getRateLimits API -- the authoritative remaining-quota signal for the ebay-quota-monitor cron.';

CREATE TABLE IF NOT EXISTS public.ebay_browse_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller TEXT NOT NULL, -- e.g. "competitorSearch", "market-watch-refresh", "keyword-research"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_browse_call_log_created_at
  ON public.ebay_browse_call_log (created_at DESC);

ALTER TABLE public.ebay_browse_call_log ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only. Every insert comes from a server-side
-- Edge Function call site, never the frontend.

COMMENT ON TABLE public.ebay_browse_call_log IS
  'One row per actual eBay Browse API call this app''s own code makes -- a same-day running counter for the ebay-quota-monitor cron''s 90%-of-limit self-warning, independent of and complementary to eBay''s own getRateLimits poll. Append-only; consider retention/pruning before this grows unbounded at production call volume (flagged, not yet implemented -- see PR #581 review).';

-- No automated pruning yet. At the account's real confirmed limit
-- (5,000 calls/day), this table could grow by roughly 1.8M rows/year if
-- every day ran at the ceiling -- in practice far less, but unbounded
-- growth on a table nothing ever reads past a same-day window is worth
-- addressing before this runs at full production volume for a long time.
-- Flagged by Copilot review on PR #581; not blocking this PR, but tracked
-- here rather than silently dropped -- a follow-up migration should add a
-- daily prune (e.g. delete rows older than 2-3 days) once this ships.
