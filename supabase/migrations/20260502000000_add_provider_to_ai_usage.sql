-- Migration: add provider column to gemini_usage table
-- Repurposes gemini_usage as a unified AI usage table covering
-- both Gemini and OpenAI calls. Existing rows get provider='gemini'.

ALTER TABLE public.gemini_usage
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS cost_usd numeric(10, 8) NOT NULL DEFAULT 0;

-- Back-fill cost for existing Gemini rows using standard pricing
-- (gemini-2.0-flash / gemini-flash-latest: $0.00000125 input, $0.000005 output)
UPDATE public.gemini_usage
SET cost_usd = (prompt_tokens * 0.00000125) + (completion_tokens * 0.000005)
WHERE provider = 'gemini' AND cost_usd = 0;

-- Index for fast per-provider queries in admin dashboard
CREATE INDEX IF NOT EXISTS gemini_usage_provider_idx
  ON public.gemini_usage (provider, created_at DESC);

-- Index for per-user queries
CREATE INDEX IF NOT EXISTS gemini_usage_user_created_idx
  ON public.gemini_usage (user_id, created_at DESC);

COMMENT ON COLUMN public.gemini_usage.provider IS 'AI provider: ''gemini'' or ''openai''';
COMMENT ON COLUMN public.gemini_usage.cost_usd IS 'Estimated cost in USD based on token counts and model pricing';