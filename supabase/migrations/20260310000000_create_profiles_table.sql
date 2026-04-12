-- ============================================================
-- Create public.profiles table (idempotent / safe to re-run)
--
-- This migration:
--   1. Creates the profiles table if it does not exist
--   2. Adds any missing columns (avatar_url, updated_at) safely
--   3. Enables RLS and creates all required policies
--   4. Creates an updated_at auto-update trigger
--   5. Backfills a profile row for every existing auth user
--      that does not already have one
--
-- Safe to run even if the table already exists in any partial
-- state — every step uses IF NOT EXISTS / DO NOTHING guards.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. Create the table (no-op if it already exists)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------
-- 2. Add columns that may be missing on older installs
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'avatar_url'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;
    RAISE NOTICE 'Added column profiles.avatar_url';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'updated_at'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    RAISE NOTICE 'Added column profiles.updated_at';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'created_at'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    RAISE NOTICE 'Added column profiles.created_at';
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 3. Enable Row Level Security
-- ----------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- 4. RLS Policies (drop-and-recreate so they are always current)
-- ----------------------------------------------------------------

-- SELECT: users can read their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- SELECT: org members can view profiles of people in the same org
-- (needed for TeamPage to show member names)
DROP POLICY IF EXISTS "Org members can view member profiles" ON public.profiles;
CREATE POLICY "Org members can view member profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_members om1
      JOIN public.org_members om2 ON om1.org_id = om2.org_id
      WHERE om1.user_id = auth.uid()
        AND om2.user_id = profiles.id
    )
  );

-- INSERT: users can create their own profile row
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE: users can update their own profile
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- DELETE: users can delete their own profile
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (id = auth.uid());

-- ----------------------------------------------------------------
-- 5. Auto-update updated_at on every row change
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------
-- 6. Backfill: create a profile row for every existing auth user
--    that does not already have one.
--    Uses email prefix as the initial display_name.
-- ----------------------------------------------------------------
INSERT INTO public.profiles (id, display_name, created_at, updated_at)
SELECT
  u.id,
  split_part(u.email, '@', 1),
  now(),
  now()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------
-- 7. Harden handle_new_user() to always insert a profile row
--    (replaces any earlier version of this function)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id    uuid;
  pending_invite RECORD;
BEGIN
  -- 7a. Upsert profile (safe — never fails even if row exists)
  INSERT INTO public.profiles (id, display_name, created_at, updated_at)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  -- 7b. Check for a pending invitation for this email
  SELECT * INTO pending_invite
  FROM public.org_invitations
  WHERE email = NEW.email AND status = 'pending'
  LIMIT 1;

  IF pending_invite IS NOT NULL THEN
    -- Invited user: join the inviting org as lister
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (pending_invite.org_id, NEW.id, 'lister')
    ON CONFLICT (org_id, user_id) DO NOTHING;

    UPDATE public.org_invitations
    SET status = 'accepted'
    WHERE id = pending_invite.id;

  ELSE
    -- New independent user: create personal org and make them owner
    BEGIN
      INSERT INTO public.organizations (id, name, owner_id)
      VALUES (
        gen_random_uuid(),
        split_part(NEW.email, '@', 1) || '''s Team',
        NEW.id
      )
      RETURNING id INTO new_org_id;

      INSERT INTO public.org_members (org_id, user_id, role)
      VALUES (new_org_id, NEW.id, 'owner');

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: failed to create org for user % — %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Ensure the trigger is active (drop + recreate)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------
-- 8. Verification
-- ----------------------------------------------------------------
DO $$
DECLARE
  profile_count INT;
  user_count    INT;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM public.profiles;
  SELECT COUNT(*) INTO user_count    FROM auth.users;

  RAISE NOTICE 'profiles table: % rows (% auth users total)', profile_count, user_count;

  -- Confirm RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is NOT enabled on public.profiles!';
  END IF;

  RAISE NOTICE 'RLS is enabled on public.profiles ✓';
  RAISE NOTICE 'Migration 20260310000000 completed successfully ✓';
END;
$$;