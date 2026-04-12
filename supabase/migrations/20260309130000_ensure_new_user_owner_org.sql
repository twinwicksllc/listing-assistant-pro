-- ============================================================
-- Ensure every new user automatically becomes owner of their
-- own personal org on signup, unless they were invited to one.
--
-- This migration:
-- 1. Replaces handle_new_user() with a hardened version that
--    wraps org creation in an exception handler so a failure
--    never blocks the signup itself.
-- 2. Drops and recreates the trigger to guarantee it is active
--    and pointing at the latest function version.
-- ============================================================

-- Step 1: Replace the function with a hardened version
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_org_id uuid;
  pending_invite RECORD;
BEGIN
  -- 1. Create profile (safe upsert in case it already exists)
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Check for a pending invitation for this email
  SELECT * INTO pending_invite
  FROM public.org_invitations
  WHERE email = NEW.email AND status = 'pending'
  LIMIT 1;

  IF pending_invite IS NOT NULL THEN
    -- Invited user: add as lister to the inviting org
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (pending_invite.org_id, NEW.id, 'lister')
    ON CONFLICT (org_id, user_id) DO NOTHING;

    UPDATE public.org_invitations
    SET status = 'accepted'
    WHERE id = pending_invite.id;

  ELSE
    -- New independent user: create their own personal org and make them owner
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
      -- Log but never block signup
      RAISE WARNING 'handle_new_user: failed to create org for user % — %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Step 2: Drop and recreate the trigger to ensure it is active
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Step 3: Verify the trigger exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'on_auth_user_created'
    AND event_object_table = 'users'
  ) THEN
    RAISE EXCEPTION 'Trigger on_auth_user_created was not created successfully';
  END IF;
  RAISE NOTICE 'Trigger on_auth_user_created is active on auth.users ✓';
END;
$$;