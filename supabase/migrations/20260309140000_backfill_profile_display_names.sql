-- ============================================================
-- Backfill display_name for profiles where it is null or empty
-- Uses the email username prefix from auth.users as fallback
-- ============================================================

UPDATE public.profiles p
SET display_name = split_part(u.email, '@', 1)
FROM auth.users u
WHERE p.id = u.id
  AND (p.display_name IS NULL OR p.display_name = '');

-- Verify
SELECT id, display_name FROM public.profiles;