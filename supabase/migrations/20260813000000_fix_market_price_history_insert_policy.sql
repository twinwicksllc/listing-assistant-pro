-- Phase 0 RLS review (RBR-0015) found that "Service role can insert history"
-- on public.market_price_history was named as if restricted to the service
-- role but had WITH CHECK (true), no auth.role() check and no TO clause.
-- Combined with the standard Supabase anon/authenticated INSERT grant, this
-- allowed any caller holding the public anon key to insert arbitrary rows
-- for any watch_id, unauthenticated. Fix to match the pattern already used
-- correctly elsewhere (category_aspects_cache, category_hygiene_log,
-- lookup_decisions, ebay_taxonomy_cache).

DROP POLICY IF EXISTS "Service role can insert history" ON public.market_price_history;

CREATE POLICY "Service role can insert history"
  ON public.market_price_history
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
