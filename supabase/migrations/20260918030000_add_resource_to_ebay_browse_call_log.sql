-- Migration: distinguish which eBay Browse API quota pool a logged call
-- actually drew from (getItems batch-refresh follow-on, PR 1/2).
--
-- ebay_browse_call_log (created 20260917000000) is an append-only counter
-- table ebay-quota-monitor reads for a same-day early-warning heuristic on
-- the buy.browse pool. Every call site logging into it today
-- (competitorSearch.ts, market-watch-refresh, keyword-research) only ever
-- calls item_summary/search, so a bare row-count has always correctly
-- meant "buy.browse calls today." The getItems follow-on work adds a
-- SECOND, genuinely separate call site drawing from buy.browse.item.bulk
-- (confirmed via this account's real getRateLimits data: a completely
-- distinct 5,000/day pool, sitting at 0/5000 unused as of 2026-09-18) --
-- without this column, logging those calls into the same table would let
-- a burst of cheap getItems refreshes falsely inflate the buy.browse
-- early-warning heuristic on a pool nowhere near exhausted.
--
-- Landed ahead of any code that would actually log a second resource value
-- (that's PR 2, not this migration) specifically so the fix ships as a
-- prerequisite, not a same-day retrofit under time pressure -- matches
-- this session's own stated preference for landing safe scaffolding before
-- the PR that changes real behavior (see PR #587 vs #592's sequencing).
--
-- NOT NULL DEFAULT 'buy.browse': every row logged before this column
-- existed really was a buy.browse call (item_summary/search was the only
-- endpoint this codebase ever called), so backfilling the default onto
-- existing rows is correct, not a placeholder.
ALTER TABLE public.ebay_browse_call_log
  ADD COLUMN IF NOT EXISTS resource TEXT NOT NULL DEFAULT 'buy.browse';

COMMENT ON COLUMN public.ebay_browse_call_log.resource IS
  'Which Browse API quota pool this call drew from -- "buy.browse" (item_summary/search, every pre-getItems caller) or "buy.browse.item.bulk" (getItems, added by the getItems follow-on work''s PR 2). Two genuinely separate 5,000/day pools per eBay''s own getRateLimits (confirmed 2026-09-17/18) -- ebay-quota-monitor''s same-day counter filters on resource=''buy.browse'' specifically so a getItems burst can never falsely inflate that pool''s early-warning heuristic. Backfilled to ''buy.browse'' by DEFAULT for every pre-existing row, which is correct: every call logged before this column existed really was against that pool.';
