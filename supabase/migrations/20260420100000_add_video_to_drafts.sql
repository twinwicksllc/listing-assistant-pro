-- Add video support columns to the drafts table.
-- video_url:         Supabase Storage public URL for the raw video file (stored for reference)
-- ebay_video_id:     eBay Video API videoId returned after uploading to eBay
-- ebay_video_status: eBay processing lifecycle — PENDING | PROCESSING | LIVE | FAILED
--                    Publish to eBay is blocked until status = LIVE (or video is removed).

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS ebay_video_id TEXT,
  ADD COLUMN IF NOT EXISTS ebay_video_status TEXT;
