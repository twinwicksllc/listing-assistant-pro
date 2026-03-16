-- Migration: Add category mappings table to store verified eBay category IDs
-- This allows the AI to look up known coins by type instead of hard-coding categories
-- and enables learning from verified lookups

CREATE TABLE IF NOT EXISTS public.category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_type TEXT NOT NULL UNIQUE,
  ebay_category_id TEXT NOT NULL,
  category_name TEXT,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  verification_source TEXT DEFAULT 'ai_search', -- 'ai_search', 'user_verified', 'ebay_api'
  confidence SMALLINT DEFAULT 100, -- 0-100 confidence score
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by coin_type
CREATE INDEX IF NOT EXISTS idx_category_mappings_coin_type ON public.category_mappings(coin_type);

-- Comments
COMMENT ON TABLE public.category_mappings IS 'Verified mapping of coin types to eBay category IDs, built up over time as AI analyzes listings';
COMMENT ON COLUMN public.category_mappings.coin_type IS 'Normalized coin description (e.g., "wheat penny 1909-1958", "morgan dollar")';
COMMENT ON COLUMN public.category_mappings.ebay_category_id IS 'eBay leaf category ID that has been verified as correct';
COMMENT ON COLUMN public.category_mappings.verification_source IS 'How the mapping was verified: ai_search (Google Search), user_verified (user confirmed), ebay_api (direct API lookup)';
COMMENT ON COLUMN public.category_mappings.confidence IS 'Confidence score 0-100 for this mapping';

-- Pre-populate with known verified mappings
INSERT INTO public.category_mappings (coin_type, ebay_category_id, category_name, verification_source, confidence)
VALUES
  ('wheat penny 1909-1958', '39455', 'Wheat Penny (1909-1958)', 'user_verified', 100),
  ('kennedy half dollar 1964-present', '41102', 'Kennedy Half Dollars (1964-present)', 'user_verified', 100),
  ('franklin half dollar 1948-1963', '11973', 'Franklin Half Dollars (1948-1963)', 'user_verified', 100),
  ('american silver eagle', '41111', 'American Silver Eagle', 'user_verified', 100),
  ('copper rounds', '166679', 'Copper Rounds (Other Bullion)', 'user_verified', 100),
  ('morgan dollar', '39464', 'Morgan Dollars', 'user_verified', 100),
  ('peace dollar', '11980', 'Peace Dollars', 'user_verified', 100),
  ('barber half dollar', '11971', 'Barber Half Dollars', 'user_verified', 100),
  ('liberty walking half', '41099', 'Liberty Walking Half', 'user_verified', 100),
  ('eisenhower dollar', '11981', 'Eisenhower Dollars', 'user_verified', 100)
ON CONFLICT (coin_type) DO NOTHING;
