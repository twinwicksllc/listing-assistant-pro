-- Add package dimensions columns to drafts table
-- These columns store the weight and dimensions of the package for shipping cost calculation

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS package_weight_lb NUMERIC;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS package_weight_oz NUMERIC;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS package_length_in NUMERIC;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS package_width_in NUMERIC;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS package_height_in NUMERIC;

-- Add comments for clarity
COMMENT ON COLUMN drafts.package_weight_lb IS 'Package weight in pounds (whole number part)';
COMMENT ON COLUMN drafts.package_weight_oz IS 'Package weight in ounces (fractional part, 0-15.99)';
COMMENT ON COLUMN drafts.package_length_in IS 'Package length in inches';
COMMENT ON COLUMN drafts.package_width_in IS 'Package width in inches';
COMMENT ON COLUMN drafts.package_height_in IS 'Package height in inches';
