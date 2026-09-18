-- Migration: persist individual comp itemIds on competitor_prices (getItems
-- batch-refresh follow-on, planned in shimmying-humming-feather.md's final
-- section, PR 1/2).
--
-- runCompetitorSearch (competitorSearch.ts) already computes each search's
-- individual comp itemIds (CompetitorItem.itemId, parsed straight from
-- Browse API's item_summary/search response) but has never persisted them
-- -- only aggregate stats (avg/min/max/median price, count, distribution)
-- land in this table. That means there is currently nothing durable a
-- future refresh could look up to call eBay's getItems bulk-lookup
-- endpoint (GET /buy/browse/v1/item?item_ids=..., a confirmed-separate and
-- confirmed-unused 5,000/day quota pool, distinct from item_summary/
-- search's buy.browse pool which is under real pressure) instead of
-- re-running a full search. This column closes that gap.
--
-- TEXT[] (not a normalized child table): gate4_warnings TEXT[], added days
-- earlier in this exact table family (20260918010000_add_gate4_warnings_to_
-- lookup_decisions.sql), is the direct precedent for "array of scalar
-- strings on the parent row" in this codebase. Nothing here needs per-item
-- staleness/history -- the whole array is replaced wholesale on every
-- successful refresh (full search or, once PR 2 lands, getItems), matching
-- how this table already treats each row as one full snapshot, not an
-- append-only history. A child table would add a join, a second RLS
-- surface, and cascade-delete bookkeeping for a value read exactly once
-- per refresh cycle by server-side code, never by the frontend directly.
ALTER TABLE public.competitor_prices
  ADD COLUMN IF NOT EXISTS comp_item_ids TEXT[];

COMMENT ON COLUMN public.competitor_prices.comp_item_ids IS
  'itemIds of the individual comps that drove this row''s aggregate stats (from fetchEbayCompetitors'' item_summary/search results, price-cleaned/deduped, capped at 20 -- same cap as a single Browse API getItems bulk-lookup call accepts). Populated so a later refresh of THIS listing can call getItems against these exact itemIds (buy.browse.item.bulk quota pool, confirmed separate and unused) instead of re-running a full item_summary/search (buy.browse pool, confirmed under pressure -- see PR #596''s incident). NULL for rows written before this column existed, and for any row where discovery found no comps -- both are valid "no known itemIds yet" states, not errors; the getItems follow-on work (PR 2) falls back to full search whenever this is null/empty.';
