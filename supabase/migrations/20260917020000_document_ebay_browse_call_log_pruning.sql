-- Migration: update ebay_browse_call_log's table comment now that pruning
-- has shipped.
--
-- 20260917000000_create_ebay_quota_monitor_tables.sql (already applied)
-- flagged this table's unbounded growth as an open TODO, per Copilot
-- review on PR #581. Rather than editing that already-applied migration,
-- this follow-up just updates the comment to point at the shipped
-- mechanism: ebay-quota-monitor's own hourly invocation now prunes rows
-- older than 3 days, guarded to run the DELETE only on the 00:00 UTC tick
-- (shouldPruneThisTick/pruneOldCallLogRows in that function's index.ts).

COMMENT ON TABLE public.ebay_browse_call_log IS
  'One row per actual eBay Browse API call this app''s own code makes -- a same-day running counter for the ebay-quota-monitor cron''s 90%-of-limit self-warning, independent of and complementary to eBay''s own getRateLimits poll. Append-only; pruned once/day (rows older than 3 days) by ebay-quota-monitor''s own hourly invocation, guarded to the 00:00 UTC tick -- see that function''s shouldPruneThisTick/pruneOldCallLogRows.';
