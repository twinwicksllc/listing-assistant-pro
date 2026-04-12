
-- Organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Org members table (owner + listers)
CREATE TYPE public.org_role AS ENUM ('owner', 'lister');

CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'lister',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

-- Org invitations
CREATE TABLE public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(org_id, email)
);
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;

-- Add org_id and consignor to drafts
ALTER TABLE public.drafts ADD COLUMN org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.drafts ADD COLUMN consignor text DEFAULT '';

-- Security definer function to check org membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = _user_id AND org_id = _org_id
  )
$$;

-- Security definer function to check org owner
CREATE OR REPLACE FUNCTION public.is_org_owner(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE user_id = _user_id AND org_id = _org_id AND role = 'owner'
  )
$$;

-- Security definer function to get user's org_id
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM public.org_members WHERE user_id = _user_id LIMIT 1
$$;

-- Organizations RLS: members can view, owner can update
CREATE POLICY "Org members can view org" ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Owner can update org" ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.is_org_owner(auth.uid(), id));

CREATE POLICY "Authenticated users can create orgs" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Org members RLS
CREATE POLICY "Org members can view members" ON public.org_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org owner can insert members" ON public.org_members
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_owner(auth.uid(), org_id) OR user_id = auth.uid());

CREATE POLICY "Org owner can delete members" ON public.org_members
  FOR DELETE TO authenticated
  USING (public.is_org_owner(auth.uid(), org_id));

-- Org invitations RLS
CREATE POLICY "Org owner can manage invitations" ON public.org_invitations
  FOR ALL TO authenticated
  USING (public.is_org_owner(auth.uid(), org_id));

CREATE POLICY "Invited user can view own invitations" ON public.org_invitations
  FOR SELECT TO authenticated
  USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Update drafts RLS: drop old policies, add org-scoped ones
DROP POLICY IF EXISTS "Users can view own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can insert own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can update own drafts" ON public.drafts;
DROP POLICY IF EXISTS "Users can delete own drafts" ON public.drafts;

-- Drafts: org members can view all org drafts
CREATE POLICY "Org members can view org drafts" ON public.drafts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (org_id IS NOT NULL AND public.is_org_member(auth.uid(), org_id))
  );

-- Drafts: any org member can insert drafts
CREATE POLICY "Users can insert drafts" ON public.drafts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Drafts: creator or org owner can update
CREATE POLICY "Users can update own or org drafts" ON public.drafts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR (org_id IS NOT NULL AND public.is_org_owner(auth.uid(), org_id))
  );

-- Drafts: creator or org owner can delete
CREATE POLICY "Users can delete own or org drafts" ON public.drafts
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (org_id IS NOT NULL AND public.is_org_owner(auth.uid(), org_id))
  );

-- Auto-create org for new users (trigger function)
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
  -- Create profile
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  -- Check for pending invitations
  SELECT * INTO pending_invite FROM public.org_invitations
  WHERE email = NEW.email AND status = 'pending' LIMIT 1;

  IF pending_invite IS NOT NULL THEN
    -- Add as lister to existing org
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (pending_invite.org_id, NEW.id, 'lister');
    UPDATE public.org_invitations SET status = 'accepted' WHERE id = pending_invite.id;
  ELSE
    -- Create personal org
    INSERT INTO public.organizations (id, name, owner_id)
    VALUES (gen_random_uuid(), split_part(NEW.email, '@', 1) || '''s Team', NEW.id)
    RETURNING id INTO new_org_id;
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (new_org_id, NEW.id, 'owner');
  END IF;

  RETURN NEW;
END;
$function$;

-- Function to accept invitation for existing users
CREATE OR REPLACE FUNCTION public.accept_invitation(_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT * INTO inv FROM public.org_invitations WHERE id = _invitation_id AND status = 'pending';
  IF inv IS NULL THEN
    RAISE EXCEPTION 'Invitation not found or already used';
  END IF;
  
  -- Remove user from their current org membership (they switch orgs)
  -- But only if they're not an owner of another org
  DELETE FROM public.org_members WHERE user_id = auth.uid() 
    AND role = 'lister';
  
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (inv.org_id, auth.uid(), 'lister')
  ON CONFLICT (org_id, user_id) DO NOTHING;
  
  UPDATE public.org_invitations SET status = 'accepted' WHERE id = _invitation_id;
END;
$$;
