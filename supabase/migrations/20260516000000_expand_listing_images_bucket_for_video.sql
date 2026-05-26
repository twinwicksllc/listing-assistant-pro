-- Expand the existing public listing media bucket so optional eBay listing videos
-- can be staged in Supabase Storage before being forwarded to eBay's Video API.
UPDATE storage.buckets
SET
  file_size_limit = 524288000,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-msvideo'
  ]
WHERE id = 'listing-media';
WHERE id = 'listing-images';