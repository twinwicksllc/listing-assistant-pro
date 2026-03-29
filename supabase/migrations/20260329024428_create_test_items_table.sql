-- Create test_items table for automated testing
-- Contains ~60 realistic items across multiple domains for function testing
-- Structure mirrors drafts table but with test-specific metadata

CREATE TABLE IF NOT EXISTS public.test_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT 'https://via.placeholder.com/300x300?text=test',
  image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  price_min NUMERIC NOT NULL DEFAULT 0,
  price_max NUMERIC NOT NULL DEFAULT 0,
  listing_price NUMERIC NOT NULL DEFAULT 0,
  ebay_category_id TEXT,
  item_specifics JSONB DEFAULT '{}',
  condition TEXT DEFAULT 'Good',
  metal_type TEXT DEFAULT 'none',
  metal_weight_oz NUMERIC(10,4) DEFAULT 0,
  cogs NUMERIC DEFAULT NULL,
  listing_format TEXT DEFAULT 'FIXED_PRICE',
  publish_status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_domain CHECK (domain IN ('coins_bullion', 'trading_cards', 'jewelry', 'electronics', 'vintage_clothing', 'general'))
);

-- Enable RLS for security policy compliance
ALTER TABLE public.test_items ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read all test data
-- Test items are public static fixtures for reproducible testing
CREATE POLICY test_items_read_policy ON public.test_items
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Allow service role (functions) to manage test data
CREATE POLICY test_items_manage_policy ON public.test_items
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE INDEX idx_test_items_domain ON public.test_items(domain);
CREATE INDEX idx_test_items_category ON public.test_items(ebay_category_id);

-- Seed test data: COINS & BULLION (16 items)
INSERT INTO public.test_items (domain, title, description, price_min, price_max, listing_price, ebay_category_id, item_specifics, condition, metal_type, metal_weight_oz, cogs) VALUES
('coins_bullion', 'US Silver Quarter 1964 Kennedy', '1964 Kennedy silver half dollar, 90% silver content, excellent condition', 45.00, 65.00, 55.00, '2536', '{"Year":"1964","Composition":"Silver","Grade":"MS-63"}'::jsonb, 'Excellent', 'silver', 0.3617, 18.50),
('coins_bullion', 'US Gold Eagle American 1 oz 2023', 'American Gold Eagle coin 1 oz bullion 2023 US Mint', 2000.00, 2150.00, 2050.00, '11116', '{"Weight":"1 oz","Type":"Bullion","Year":"2023"}'::jsonb, 'Mint State', 'gold', 1.0, 1900),
('coins_bullion', 'Canada Maple Leaf 1 oz Silver Coin', 'Canadian Maple Leaf 1 oz pure silver bullion coin', 28.00, 32.00, 30.00, '55404', '{"Weight":"1 oz","Composition":"Pure Silver","Country":"Canada"}'::jsonb, 'Uncirculated', 'silver', 1.0, 22.50),
('coins_bullion', 'Morgan Silver Dollar 1921', 'Classic Morgan Dollar from 1921, well circulated vintage coin', 25.00, 40.00, 32.00, '34200', '{"Year":"1921","Type":"Morgan Dollar","Grade":"VF-25"}'::jsonb, 'Very Fine', 'silver', 0.7734, 16.00),
('coins_bullion', 'British Sovereign Gold Coin', 'Gold sovereign coin from UK, 22k gold content', 350.00, 430.00, 390.00, '64982', '{"Country":"UK","Composition":"22K Gold","Weight":"7.32g"}'::jsonb, 'Very Fine', 'gold', 0.2356, 340),
('coins_bullion', 'Chinese Panda Bullion Silver 30g', '30g Chinese Panda bullion coin, .999 fine silver', 18.00, 24.00, 21.00, '55404', '{"Country":"China","Weight":"30g","Composition":".999 Silver"}'::jsonb, 'BU', 'silver', 0.9645, 14.50),
('coins_bullion', 'Switzerland 5 Francs Coin 1955', 'Vintage Swiss 5 francs coin, .835 silver', 8.00, 15.00, 11.00, '64982', '{"Country":"Switzerland","Year":"1955","Composition":".835 Silver"}'::jsonb, 'Fine', 'silver', 0.1372, 5.50),
('coins_bullion', 'Australian Kookaburra Silver Coin', 'Silver kookaburra 1 oz bullion coin from Perth Mint', 30.00, 36.00, 33.00, '55404', '{"Weight":"1 oz","Country":"Australia","Composition":".999 Silver"}'::jsonb, 'Uncirculated', 'silver', 1.0, 23.00),
('coins_bullion', 'US Buffalo Nickel 1928', 'Indian Head Buffalo nickel 1928, key date', 15.00, 28.00, 22.00, '2664', '{"Year":"1928","Type":"Buffalo Nickel","Grade":"VF-20"}'::jsonb, 'Very Fine', 'none', 0, 8.00),
('coins_bullion', 'Mexico Libertad Silver Coin', '1 oz Mexico Libertad silver bullion coin', 28.00, 34.00, 31.00, '55404', '{"Country":"Mexico","Weight":"1 oz","Composition":".999 Silver"}'::jsonb, 'Uncirculated', 'silver', 1.0, 22.50),
('coins_bullion', '1 oz Platinum Bar Ingot', 'Pure .9995 platinum 1 oz bar', 850.00, 950.00, 900.00, '64982', '{"Weight":"1 oz","Purity":".9995","Metal":"Platinum"}'::jsonb, 'Like New', 'platinum', 1.0, 800),
('coins_bullion', 'Roll of 40 US Pre-1965 Silver Dimes', 'Roll of 40 pre-1965 90% silver dimes', 180.00, 220.00, 200.00, '2664', '{"Composition":"90% Silver","Quantity":"40","Denom":"Dimes"}'::jsonb, 'Circulated', 'silver', 3.6, 160),
('coins_bullion', 'South Africa Krugerrand Gold Coin', '1 oz South African Krugerrand gold bullion coin', 1950.00, 2100.00, 2020.00, '11116', '{"Country":"South Africa","Weight":"1 oz","Composition":"22K Gold"}'::jsonb, 'Brilliant Uncirculated', 'gold', 1.0, 1880),
('coins_bullion', 'US Peace Silver Dollar 1926', 'Peace Dollar 1926, original mint luster', 30.00, 50.00, 40.00, '34200', '{"Year":"1926","Type":"Peace Dollar","Grade":"MS-62"}'::jsonb, 'Mint State', 'silver', 0.7734, 19.00),
('coins_bullion', 'UK Britannia Silver Coin 1 oz', 'Royal Mint Britannia 1 oz .999 silver bullion', 32.00, 38.00, 35.00, '55404', '{"Country":"UK","Weight":"1 oz","Composition":".999 Silver"}'::jsonb, 'Uncirculated', 'silver', 1.0, 25.00),
('coins_bullion', 'US Eisenhower Dollar 1971 Silver', 'Eisenhower dollar 1971-S San Francisco 40% silver', 8.00, 14.00, 11.00, '34200', '{"Year":"1971","Type":"Eisenhower","Silver":"40%"}'::jsonb, 'Fine', 'silver', 0.3 , 5.00),

-- TRADING CARDS (8 items)
('trading_cards', 'Pokemon Charizard Base Set 1st Edition PSA 8', 'Base Set Charizard holographic 1st edition, graded PSA 8', 8000.00, 12000.00, 10000.00, '183454', '{"Game":"Pokemon","Set":"Base Set","Card":"Charizard","Grade":"PSA 8","Edition":"1st"}'::jsonb, 'Near Mint-Mint', 'none', 0, 5500),
('trading_cards', 'Magic The Gathering Black Lotus Alpha', 'MTG Alpha Black Lotus near mint condition', 15000.00, 20000.00, 17500.00, '2536', '{"Game":"MTG","Set":"Alpha","Card":"Black Lotus","Condition":"NM"}'::jsonb, 'Excellent', 'none', 0, 12000),
('trading_cards', 'Yu-Gi-Oh Blue Eyes White Dragon 1st Edition', 'Blue Eyes White Dragon SDK-001 1st edition PSA 7', 300.00, 450.00, 375.00, '61793', '{"Game":"Yu-Gi-Oh","Set":"SDK","Card":"Blue Eyes","Edition":"1st Ed"}'::jsonb, 'Near Mint', 'none', 0, 150),
('trading_cards', 'Baseball Card Babe Ruth 1914 Cracker Jack', 'Rare Babe Ruth Cracker Jack baseball card 1914', 2500.00, 4000.00, 3250.00, '261328', '{"Sport":"Baseball","Player":"Babe Ruth","Year":"1914"}'::jsonb, 'Good', 'none', 0, 1800),
('trading_cards', 'Pokemon Pikachu Illustrator Holo Card', 'Rare Pikachu Illustrator holographic card, Indonesian print', 200.00, 350.00, 275.00, '183454', '{"Game":"Pokemon","Card":"Pikachu Illustrator","Type":"Holo"}'::jsonb, 'Near Mint', 'none', 0, 100),
('trading_cards', 'Sports Card Collection Lot 50 Cards', 'Vintage lot of 50 mixed sports cards from 1980s-1990s', 25.00, 75.00, 50.00, '261328', '{"Sport":"Mixed","Decade":"1980-1990","Quantity":"50"}'::jsonb, 'Good', 'none', 0, 20),
('trading_cards', 'Digimon Card Wargreymon Holo Rare', 'Holographic Wargreymon rare card from Digimon TCG', 18.00, 35.00, 26.00, '183454', '{"Game":"Digimon","Card":"Wargreymon","Rarity":"Holo Rare"}'::jsonb, 'Mint', 'none', 0, 8),
('trading_cards', 'Vintage Star Wars Trading Card Lot 100', 'Bundle of 100 vintage Star Wars trading cards, mixed condition', 40.00, 100.00, 70.00, '261328', '{"Franchise":"Star Wars","Type":"Trading Card","Quantity":"100"}'::jsonb, 'Fair to Good', 'none', 0, 30),

-- JEWELRY (7 items)
('jewelry', '14K Gold Diamond Ring 2 Carat Solitaire', 'Solitaire diamond ring 14K yellow gold, 2.0 carat diamond', 4500.00, 6500.00, 5500.00, '67742', '{"Metal":"14K Gold","Gemstone":"Diamond","Weight":"2.0ct","Style":"Solitaire"}'::jsonb, 'Like New', 'gold', 0.5, 3200),
('jewelry', 'Sterling Silver Pearl Necklace 18 Inch', 'Freshwater pearl on sterling silver chain, 18 inch', 35.00, 85.00, 60.00, '164316', '{"Metal":"Sterling Silver","Gemstone":"Freshwater Pearl","Length":"18 inches"}'::jsonb, 'Excellent', 'none', 0, 18),
('jewelry', 'Vintage Rolex Submariner Gold Watch', 'Vintage Rolex Submariner 18K yellow gold, 1960s', 8000.00, 12000.00, 10000.00, '137835', '{"Brand":"Rolex","Model":"Submariner","Metal":"18K Gold","Decade":"1960s"}'::jsonb, 'Good', 'gold', 2.1, 6500),
('jewelry', 'White Gold Sapphire Earrings Studs', 'Blue sapphire stud earrings 14K white gold', 250.00, 450.00, 350.00, '10968', '{"Metal":"14K White Gold","Gemstone":"Sapphire","Type":"Studs"}'::jsonb, 'Excellent', 'gold', 0.2, 150),
('jewelry', 'Vintage Opal Brooch Sterling Silver', 'Victorian opal brooch with sterling silver setting, milgrain detail', 120.00, 250.00, 185.00, '98764', '{"Era":"Victorian","Metal":"Sterling Silver","Gemstone":"Opal","Type":"Brooch"}'::jsonb, 'Good', 'none', 0, 65),
('jewelry', 'Titanium Engagement Ring Set', 'Modern titanium engagement and wedding band set, hypoallergenic', 300.00, 500.00, 400.00, '67742', '{"Metal":"Titanium","Type":"Engagement Set","Style":"Modern"}'::jsonb, 'Like New', 'none', 0, 150),
('jewelry', 'Vintage Gold Locket Pendant Chain', 'Antique 10K gold locket with chain, engraved, opens', 180.00, 350.00, 265.00, '164316', '{"Metal":"10K Gold","Type":"Locket","Era":"Antique"}'::jsonb, 'Fair', 'gold', 0.4, 140),

-- ELECTRONICS (8 items)
('electronics', 'Apple iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max in deep purple, sealed in box', 1100.00, 1300.00, 1200.00, '9355', '{"Brand":"Apple","Model":"iPhone 15 Pro Max","Storage":"256GB","Color":"Deep Purple"}'::jsonb, 'New', 'none', 0, 950),
('electronics', 'Sony A7IV Mirrorless Camera 61MP', 'Sony a7IV 61MP mirrorless camera with 2 lenses, like new', 1800.00, 2200.00, 2000.00, '31388', '{"Brand":"Sony","Model":"a7IV","Megapixels":"61MP","Lenses":"2"}'::jsonb, 'Excellent', 'none', 0, 1500),
('electronics', 'MacBook Pro 14 inch M3 512GB 2024', 'MacBook Pro 14-inch M3 chip, 512GB, space gray, like new', 1500.00, 1800.00, 1650.00, '177', '{"Brand":"Apple","Model":"MacBook Pro 14","Chip":"M3","Storage":"512GB"}'::jsonb, 'Excellent', 'none', 0, 1200),
('electronics', 'Samsung 75 inch QLED 4K Smart TV', '75" QLED 4K Smart TV, 120Hz refresh rate, original remote', 1200.00, 1600.00, 1400.00, '11071', '{"Brand":"Samsung","Size":"75 inches","Type":"QLED 4K","Features":"Smart TV"}'::jsonb, 'Good', 'none', 0, 900),
('electronics', 'PlayStation 5 Console Disc Edition', 'PS5 Disc edition with 2 controllers, 3 games, all cords', 500.00, 600.00, 550.00, '309966', '{"Brand":"Sony","Console":"PlayStation 5","Edition":"Disc","Included":"2 controllers + 3 games"}'::jsonb, 'Good', 'none', 0, 400),
('electronics', 'GoPro Hero 12 4K Action Camera', 'GoPro Hero 12 with mounting accessories and 2 batteries', 380.00, 450.00, 415.00, '31388', '{"Brand":"GoPro","Model":"Hero 12","Resolution":"4K","Included":"Mounts + 2 batteries"}'::jsonb, 'Like New', 'none', 0, 300),
('electronics', 'Bose QuietComfort Ultra Headphones', 'Bose QC Ultra noise-cancelling headphones, black', 300.00, 400.00, 350.00, '112529', '{"Brand":"Bose","Model":"QC Ultra","Feature":"Noise-Cancelling"}'::jsonb, 'Excellent', 'none', 0, 220),
('electronics', 'DJI Air 3S Drone 4K Camera Gimbal', 'DJI Air 3S quadcopter with 4K cameras and gimbal stabilization', 650.00, 800.00, 725.00, '178893', '{"Brand":"DJI","Model":"Air 3S","Camera":"4K","Features":"Gimbal"}'::jsonb, 'Like New', 'none', 0, 550),

-- VINTAGE CLOTHING (6 items)
('vintage_clothing', 'Levis 501 Jeans Red Tab 1980s sz 32', 'Vintage Levis 501 original fit denim jeans 1980s, size 32', 65.00, 125.00, 95.00, '57988', '{"Brand":"Levis","Model":"501","Color":"Blue","Decade":"1980s","Size":"32"}'::jsonb, 'Good', 'none', 0, 35),
('vintage_clothing', 'Chanel Tweed Jacket Classic Vintage', 'Vintage Chanel tweed jacket, black and white, size 6', 800.00, 1200.00, 1000.00, '63861', '{"Brand":"Chanel","Type":"Tweed Jacket","Color":"Black/White","Size":"6"}'::jsonb, 'Excellent', 'none', 0, 500),
('vintage_clothing', 'Harley Davidson T-Shirt 1970s Single Stitch', '1970s Harley Davidson single-stitch t-shirt, faded black', 120.00, 250.00, 185.00, '15687', '{"Brand":"Harley Davidson","Era":"1970s","Type":"T-Shirt","Fabric":"Single Stitch"}'::jsonb, 'Good', 'none', 0, 80),
('vintage_clothing', 'Nike Air Jordan 1985 Sneakers Size 10', 'Original Nike Air Jordan 1985 sneakers, size 10, vintage condition', 450.00, 750.00, 600.00, '52365', '{"Brand":"Nike","Model":"Air Jordan","Year":"1985","Size":"10"}'::jsonb, 'Good', 'none', 0, 300),
('vintage_clothing', 'Burberry Trench Coat Camel Vintage', 'Vintage Burberry trench coat, camel color, size M', 350.00, 600.00, 475.00, '63861', '{"Brand":"Burberry","Type":"Trench Coat","Color":"Camel","Size":"M"}'::jsonb, 'Excellent', 'none', 0, 250),
('vintage_clothing', 'Band Tee Lot 5 Shirts Pink Floyd Beatles', 'Lot of 5 vintage band t-shirts including Pink Floyd and Beatles', 85.00, 180.00, 130.00, '15687', '{"Type":"Band T-Shirts","Bands":"Pink Floyd, Beatles, etc","Quantity":"5"}'::jsonb, 'Fair to Good', 'none', 0, 60),

-- MISCELLANEOUS COLLECTIBLES & GENERAL ITEMS (9 items)
('general', 'Beanie Baby Collection Lot 20 Rare', 'Collection of 20 Beanie Babies including rare PVC versions', 150.00, 350.00, 250.00, '257655', '{"Type":"Beanie Babies","Quantity":"20","Rarity":"Some Rare/PVC"}'::jsonb, 'Good', 'none', 0, 100),
('general', 'Vintage Postage Stamp Collection Album', 'Stamp collection album with 200+ international vintage stamps', 80.00, 200.00, 140.00, '260571', '{"Type":"Stamp Collection","Quantity":"200+","Era":"Vintage"}'::jsonb, 'Good', 'none', 0, 50),
('general', 'Royal Typewriter 1960s Turquoise', 'Classic Royal typewriter in working condition, turquoise enamel', 75.00, 150.00, 112.00, '91087', '{"Brand":"Royal","Period":"1960s","Color":"Turquoise","Condition":"Working"}'::jsonb, 'Good', 'none', 0, 40),
('general', 'Vintage Tiffany Style Lamp Stained Glass', 'Handmade stained glass lamp in tiffany style, 18" diameter shade', 120.00, 280.00, 200.00, '25854', '{"Style":"Tiffany","Material":"Stained Glass","Size":"18 inch shade"}'::jsonb, 'Good', 'none', 0, 80),
('general', 'Vinyl Record Collection 50 LPs', 'Large lot of 50 vinyl records, classic rock, soul, jazz', 200.00, 500.00, 350.00, '98584', '{"Format":"Vinyl LP","Quantity":"50","Genres":"Classic Rock, Soul, Jazz"}'::jsonb, 'Fair to Good', 'none', 0, 150),
('general', 'Lego Set Harry Potter Hogwarts Castle 6000+pcs', 'LEGO Harry Potter Hogwarts Castle 71043, complete in box', 380.00, 480.00, 430.00, '220057', '{"Brand":"LEGO","Theme":"Harry Potter","Set":"Hogwarts Castle","Pieces":"6000+"}'::jsonb, 'Excellent', 'none', 0, 300),
('general', 'Vintage Comic Book Collection X-Men #1 1963', 'X-Men #1 comic from 1963, CGC graded 4.0', 1500.00, 3000.00, 2250.00, '202037', '{"Title":"X-Men","Issue":"1","Year":"1963","Grade":"CGC 4.0"}'::jsonb, 'Good', 'none', 0, 900),
('general', 'Bicycle Vintage Mountain Bike 1990s Trek', '1990s Trek mountain bike, aluminum frame, 21-speed', 200.00, 400.00, 300.00, '100519', '{"Brand":"Trek","Type":"Mountain Bike","Material":"Aluminum","Gears":"21-speed","Decade":"1990s"}'::jsonb, 'Good', 'none', 0, 150),
('general', 'Coffee Table Book Photography National Geographic', 'National Geographic large format photography coffee table book', 25.00, 60.00, 42.00, '267400', '{"Publisher":"National Geographic","Type":"Photography Book","Format":"Coffee Table"}'::jsonb, 'Excellent', 'none', 0, 15);

COMMENT ON TABLE public.test_items IS
  'Test dataset for automated function testing. Contains ~60 items across 6 domains: coins_bullion, trading_cards, jewelry, electronics, vintage_clothing, general. Used for CI/CD function validation.';

COMMENT ON COLUMN public.test_items.domain IS
  'Item domain for routing to domain-specific AI prompts and category trees';
COMMENT ON COLUMN public.test_items.user_id IS
  'Fixed test user UUID for reproducible testing';
