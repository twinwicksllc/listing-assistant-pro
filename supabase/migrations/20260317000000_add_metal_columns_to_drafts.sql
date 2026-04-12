-- Add precious-metal content columns to drafts table
-- Used to compute melt value alerts on DraftsPage and Dashboard
ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS metal_type       TEXT           DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS metal_weight_oz  NUMERIC(10,4)  DEFAULT 0;
