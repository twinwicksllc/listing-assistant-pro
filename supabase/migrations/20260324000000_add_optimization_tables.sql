-- ================================================================
-- Feature #6: Auto-Optimization
-- Creates optimization_history and reprice_rules tables
-- ================================================================

-- ------------------------------------------------------------
-- reprice_rules: user-configured auto-repricing rules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reprice_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('match_lowest', 'beat_lowest', 'match_avg', 'match_sold_avg')),
  adjustment_pct NUMERIC(6,2) DEFAULT 0,  -- e.g. -5 = 5% below target
  floor_price NUMERIC(10,2),              -- never go below this
  ceiling_price NUMERIC(10,2),            -- never go above this
  category_filter TEXT,                   -- null = apply to all categories
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reprice_rules_user_idx ON public.reprice_rules(user_id);

ALTER TABLE public.reprice_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own reprice rules"
  ON public.reprice_rules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- optimization_history: audit log of all optimization actions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.optimization_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  listing_title TEXT,
  optimization_type TEXT NOT NULL CHECK (optimization_type IN ('price', 'title', 'description', 'reprice_rule')),
  old_value TEXT,
  new_value TEXT,
  reasoning TEXT,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  applied_by TEXT DEFAULT 'user' CHECK (applied_by IN ('user', 'auto')),
  result TEXT DEFAULT 'accepted' CHECK (result IN ('accepted', 'dismissed', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS optimization_history_user_idx ON public.optimization_history(user_id);
CREATE INDEX IF NOT EXISTS optimization_history_listing_idx ON public.optimization_history(listing_id);
CREATE INDEX IF NOT EXISTS optimization_history_applied_at_idx ON public.optimization_history(applied_at DESC);

ALTER TABLE public.optimization_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own optimization history"
  ON public.optimization_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- updated_at trigger for reprice_rules
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_reprice_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reprice_rules_updated_at
  BEFORE UPDATE ON public.reprice_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_reprice_rules_updated_at();