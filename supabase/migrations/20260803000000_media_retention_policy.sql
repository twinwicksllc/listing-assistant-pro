-- Media retention policy for listing-images bucket assets.
-- - Raw videos and server-uploaded images older than 15 days are eligible for cleanup.
-- - Drafts are preserved for up to 60 days after creation if they remain unpublished.
-- - Published items and drafts that were used for a listing are not treated as retention candidates.

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS media_retention_last_checked TIMESTAMPTZ;

COMMENT ON COLUMN public.drafts.media_retention_last_checked IS 'Last time the media retention cleanup reviewed this draft''s stored media.';
