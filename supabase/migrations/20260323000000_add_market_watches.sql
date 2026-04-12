-- ================================================================
-- Feature #5: Market Research Tools
-- Creates market_watches and market_price_history tables
-- ================================================================

-- ------------------------------------------------------------
-- market_watches: user-pinned search terms to monitor
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  search_query TEXT NOT NULL,
  category_id TEXT,
  label TEXT,                         -- user-friendly name for this watch
  last_checked_at TIMESTAMPTZ,
  avg_price NUMERIC(10,2),
  min_price NUMERIC(10,2),
  max_price NUMERIC(10,2),
  median_price NUMERIC(10,2),
  active_count INTEGER DEFAULT 0,
  sold_count INTEGER DEFAULT 0,
  sell_through_rate NUMERIC(5,2),     -- sold / (sold + active) * 100
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_watches_user_idx ON public.market_watches(user_id);
CREATE INDEX IF NOT EXISTS market_watches_org_idx ON public.market_watches(org_id);

-- RLS
ALTER TABLE public.market_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own market watches"
  ON public.market_watches
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- market_price_history: time-series snapshots per watch
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id UUID NOT NULL REFERENCES public.market_watches(id) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ DEFAULT NOW(),
  avg_price NUMERIC(10,2),
  min_price NUMERIC(10,2),
  max_price NUMERIC(10,2),
  median_price NUMERIC(10,2),
  active_count INTEGER DEFAULT 0,
  sold_count INTEGER DEFAULT 0,
  sell_through_rate NUMERIC(5,2)
);

CREATE INDEX IF NOT EXISTS market_price_history_watch_idx ON public.market_price_history(watch_id);
CREATE INDEX IF NOT EXISTS market_price_history_sampled_idx ON public.market_price_history(sampled_at DESC);

-- RLS
ALTER TABLE public.market_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view history for their watches"
  ON public.market_price_history
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.market_watches mw
      WHERE mw.id = market_price_history.watch_id
        AND mw.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can insert history"
  ON public.market_price_history
  FOR INSERT
  WITH CHECK (true);

-- ------------------------------------------------------------
-- updated_at trigger for market_watches
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_market_watches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER market_watches_updated_at
  BEFORE UPDATE ON public.market_watches
  FOR EACH ROW EXECUTE FUNCTION public.set_market_watches_updated_at();