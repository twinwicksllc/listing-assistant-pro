-- ================================================================
-- Feature #6: Auto-Optimization — SAFE / IDEMPOTENT VERSION
-- Run this in Supabase SQL Editor. Safe to re-run multiple times.
-- ================================================================

-- ------------------------------------------------------------
-- reprice_rules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reprice_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('match_lowest', 'beat_lowest', 'match_avg', 'match_sold_avg')),
  adjustment_pct NUMERIC(6,2) DEFAULT 0,
  floor_price NUMERIC(10,2),
  ceiling_price NUMERIC(10,2),
  category_filter TEXT,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reprice_rules_user_idx ON public.reprice_rules(user_id);
ALTER TABLE public.reprice_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can manage their own reprice rules"
    ON public.reprice_rules FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- optimization_history
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

DO $$ BEGIN
  CREATE POLICY "Users can manage their own optimization history"
    ON public.optimization_history FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_reprice_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reprice_rules_updated_at ON public.reprice_rules;
CREATE TRIGGER reprice_rules_updated_at
  BEFORE UPDATE ON public.reprice_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_reprice_rules_updated_at();

-- Done!
SELECT 'Migration complete: reprice_rules + optimization_history created' AS status;