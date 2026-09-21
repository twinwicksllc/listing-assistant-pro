-- Migration: items-refresh outcome tracking + widened call-log retention
--
-- Follow-on to the 2026-09-21 quota-storm fix (PR #610: reset-window gate +
-- ITEMS_REFRESH_PROBE_CAP=5 + BATCH_LIMIT/REFRESH_CONCURRENCY reductions).
-- The fix's own todo.md monitoring checklist calls for tracking how often
-- attemptItemsRefresh's isItemsRefreshUsable() check rejects the (now
-- 5-probe-capped) getItems result and falls through to a full search --
-- if rejection is frequent, the cap may be too aggressive relative to
-- real-world delisting rates. No existing table captures this: comp_item_ids
-- refresh accept/reject decisions were only ever console.log'd, never
-- persisted, so there was nothing an admin dashboard could query.
--
-- Shaped like ebay_browse_call_log (service-role-only, no RLS policies,
-- append-only event rows) rather than a counter column somewhere, since
-- multiple distinct outcomes need to be distinguished (accepted vs each of
-- the 4 fall-through reasons in attemptItemsRefresh) and a dashboard wants
-- a time series, not just a running total.

CREATE TABLE IF NOT EXISTS public.ebay_items_refresh_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- "accepted": getItems refresh passed isItemsRefreshUsable and was persisted.
  -- "rejected_usability": isItemsRefreshUsable said the surviving comp count
  --   was too thin (the case the monitoring checklist specifically asks about).
  -- "rejected_no_stored_ids": decideRefreshStrategy found no usable stored ids.
  -- "error": row lookup, token fetch, or the getItems call itself threw.
  outcome TEXT NOT NULL,
  reason TEXT, -- free-text detail, e.g. isItemsRefreshUsable's own reason string
  listing_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_items_refresh_outcomes_created_at
  ON public.ebay_items_refresh_outcomes (created_at DESC);

ALTER TABLE public.ebay_items_refresh_outcomes ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only, same as ebay_browse_call_log. Every insert
-- comes from attemptItemsRefresh (competitorSearch.ts) via a fire-and-forget
-- background write, never the frontend.

COMMENT ON TABLE public.ebay_items_refresh_outcomes IS
  'One row per attemptItemsRefresh decision (accepted or one of several fall-through-to-full-search reasons) -- lets the admin dashboard measure how often the 2026-09-21 ITEMS_REFRESH_PROBE_CAP=5 change causes a fall-through, per the quota-storm-fix monitoring checklist in todo.md.';

-- ebay-quota-monitor's hourly prune (pruneOldCallLogRows, RETENTION_DAYS=3)
-- kept ebay_browse_call_log to 3 days of history -- too short for the new
-- admin dashboard's "last 7 days" call-volume view. Widening to 8 days (not
-- exactly 7) gives the dashboard a full 7 calendar days of complete data even
-- when queried right after the day boundary, without having to reason about
-- partial-day edge effects at exactly the 7-day mark.
COMMENT ON TABLE public.ebay_browse_call_log IS
  'One row per actual eBay Browse API call this app''s own code makes -- a same-day running counter for the ebay-quota-monitor cron''s 90%-of-limit self-warning, independent of and complementary to eBay''s own getRateLimits poll. Append-only; pruned to 8 days of history by ebay-quota-monitor''s hourly cron (RETENTION_DAYS, widened 2026-09-21 from 3 days to give the admin quota dashboard a full 7-day view).';
