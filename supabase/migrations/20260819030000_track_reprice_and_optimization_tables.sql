-- Migration: track reprice_rules and optimization_history
--
-- Resolves RBR-0014: both tables were created by hand outside tracked
-- migrations (20260324000001_add_optimization_tables.sql is a `SELECT 1;`
-- no-op placeholder). Built from migrations alone, a fresh ListrAssistr
-- project would silently lack both tables. Definitions below match live
-- production exactly, confirmed via information_schema.columns,
-- pg_constraint, and pg_indexes on 2026-08-19 -- see
-- REBRAND_PHASE_0_EXCEPTION_LOG.md RBR-0014 for the investigation history.
--
-- No trigger exists on either table in production (confirmed via
-- information_schema.triggers) -- reprice_rules.updated_at is set once on
-- insert via its column default and never subsequently maintained. This
-- migration intentionally does not add one, to match live behavior exactly.
--
-- CREATE TABLE IF NOT EXISTS makes this a no-op against current production
-- (both tables already exist there); it exists to make a fresh database
-- match production.

CREATE TABLE IF NOT EXISTS public.reprice_rules (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_name       TEXT        NOT NULL,
  rule_type       TEXT        NOT NULL
    CONSTRAINT reprice_rules_rule_type_check
    CHECK (rule_type = ANY (ARRAY['match_lowest'::text, 'beat_lowest'::text, 'match_avg'::text, 'match_sold_avg'::text])),
  adjustment_pct  NUMERIC     DEFAULT 0,
  floor_price     NUMERIC,
  ceiling_price   NUMERIC,
  category_filter TEXT,
  is_enabled      BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reprice_rules_user_idx ON public.reprice_rules(user_id);

ALTER TABLE public.reprice_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.optimization_history (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id        TEXT        NOT NULL,
  listing_title     TEXT,
  optimization_type TEXT        NOT NULL
    CONSTRAINT optimization_history_optimization_type_check
    CHECK (optimization_type = ANY (ARRAY['price'::text, 'title'::text, 'description'::text, 'reprice_rule'::text])),
  old_value         TEXT,
  new_value         TEXT,
  reasoning         TEXT,
  applied_at        TIMESTAMPTZ DEFAULT now(),
  applied_by        TEXT        DEFAULT 'user'
    CONSTRAINT optimization_history_applied_by_check
    CHECK (applied_by = ANY (ARRAY['user'::text, 'auto'::text])),
  result            TEXT        DEFAULT 'accepted'
    CONSTRAINT optimization_history_result_check
    CHECK (result = ANY (ARRAY['accepted'::text, 'dismissed'::text, 'pending'::text])),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS optimization_history_user_idx ON public.optimization_history(user_id);
CREATE INDEX IF NOT EXISTS optimization_history_listing_idx ON public.optimization_history(listing_id);
CREATE INDEX IF NOT EXISTS optimization_history_applied_at_idx ON public.optimization_history(applied_at DESC);

ALTER TABLE public.optimization_history ENABLE ROW LEVEL SECURITY;

-- Policy names below are new; production already has RLS enabled with its
-- own (differently-named) policies enforcing the same auth.uid() = user_id
-- semantics per the P0-07 review. This is intentionally redundant rather
-- than conflicting on current production -- multiple permissive policies
-- with identical effect are harmless -- and gives a fresh database a named,
-- tracked policy of its own.
CREATE POLICY "Users can manage own reprice rules"
  ON public.reprice_rules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own optimization history"
  ON public.optimization_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
