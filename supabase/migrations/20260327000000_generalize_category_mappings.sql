-- Migration: Generalize category_mappings table for all item types (not just coins)
-- Adds item_type column as an alias/replacement for coin_type
-- Keeps coin_type for backward compat; item_type is the new canonical key

-- 1. Add item_type column (mirrors coin_type, will be the new key going forward)
ALTER TABLE public.category_mappings
  ADD COLUMN IF NOT EXISTS item_type TEXT;

-- 2. Backfill item_type from coin_type for existing rows
UPDATE public.category_mappings
  SET item_type = coin_type
  WHERE item_type IS NULL;

-- 3. Add unique index on item_type for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_mappings_item_type
  ON public.category_mappings(item_type)
  WHERE item_type IS NOT NULL;

-- 4. Add general collectibles / toys / plush categories
INSERT INTO public.category_mappings (coin_type, item_type, ebay_category_id, category_name, verification_source, confidence)
VALUES
  -- Beanie Babies / Plush
  ('beanie babies plush',        'beanie babies plush',        '19203',  'Beanie Babies',                              'user_verified', 100),
  ('ty beanie baby',             'ty beanie baby',             '19203',  'Beanie Babies',                              'user_verified', 100),
  ('stuffed animal plush',       'stuffed animal plush',       '19209',  'Stuffed Animals',                            'user_verified', 100),
  -- Funko / Collectible Figures
  ('funko pop',                  'funko pop',                  '261068', 'Funko Pop Vinyl Figures',                    'user_verified', 100),
  ('action figure',              'action figure',              '246',    'Action Figures',                             'user_verified', 100),
  -- Trading Cards
  ('trading card sports',        'trading card sports',        '261328', 'Sports Trading Cards',                       'user_verified', 100),
  ('trading card pokemon',       'trading card pokemon',       '183454', 'Pokémon Trading Card Games',                 'user_verified', 100),
  -- Jewelry
  ('gold jewelry',               'gold jewelry',               '10986',  'Fine Jewelry > Necklaces & Pendants',        'user_verified', 100),
  ('silver jewelry',             'silver jewelry',             '10986',  'Fine Jewelry > Necklaces & Pendants',        'user_verified', 100),
  -- Books
  ('book hardcover',             'book hardcover',             '29223',  'Books > Fiction > General',                  'user_verified', 100),
  -- Electronics
  ('smartphone',                 'smartphone',                 '9355',   'Cell Phones & Smartphones',                  'user_verified', 100),
  ('video game console',         'video game console',         '139971', 'Video Games & Consoles',                     'user_verified', 100),
  -- Tools
  ('hand tool',                  'hand tool',                  '631',    'Tools & Workshop Equipment',                 'user_verified', 100)
ON CONFLICT (coin_type) DO UPDATE
  SET item_type = EXCLUDED.item_type,
      ebay_category_id = EXCLUDED.ebay_category_id,
      category_name = EXCLUDED.category_name,
      updated_at = NOW();

-- 5. Add text search index for fuzzy item type matching
CREATE INDEX IF NOT EXISTS idx_category_mappings_item_type_trgm
  ON public.category_mappings USING gin(item_type gin_trgm_ops)
  WHERE item_type IS NOT NULL;

-- Enable pg_trgm if not already enabled (needed for trigram index)
-- Note: This is a no-op if already enabled
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMENT ON COLUMN public.category_mappings.item_type IS 'Normalized item description for any category (e.g., "beanie babies plush", "morgan dollar", "funko pop"). New canonical key replacing coin_type.';