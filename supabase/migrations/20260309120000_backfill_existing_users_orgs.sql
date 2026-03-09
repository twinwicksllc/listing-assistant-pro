-- ============================================================
-- Backfill: Create org + owner membership for existing users
-- who signed up before the handle_new_user trigger was updated
-- ============================================================

DO $$
DECLARE
  u RECORD;
  new_org_id uuid;
BEGIN
  -- Loop over all auth users who have no org_members row
  FOR u IN
    SELECT au.id, au.email
    FROM auth.users au
    LEFT JOIN public.org_members om ON om.user_id = au.id
    WHERE om.user_id IS NULL
  LOOP
    -- Create a personal org for this user
    INSERT INTO public.organizations (id, name, owner_id)
    VALUES (
      gen_random_uuid(),
      split_part(u.email, '@', 1) || '''s Team',
      u.id
    )
    RETURNING id INTO new_org_id;

    -- Add them as owner
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (new_org_id, u.id, 'owner');

    RAISE NOTICE 'Created org for user: %', u.email;
  END LOOP;
END;
$$;