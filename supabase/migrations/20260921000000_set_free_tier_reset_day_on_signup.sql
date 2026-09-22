-- ============================================================
-- Set free_tier_reset_day when a new user signs up and creates
-- their personal organization. The handle_new_user() trigger
-- creates the org but never set this date.
--
-- This migration replaces handle_new_user() with a version that
-- also sets organizations.free_tier_reset_day = today's day-of-month
-- at the moment of org creation.
-- ============================================================

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

      -- Set the free tier reset day to today's day-of-month (for rolling-window quota)
      UPDATE public.organizations
      SET free_tier_reset_day = EXTRACT(DAY FROM NOW())::SMALLINT
      WHERE id = new_org_id;

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
