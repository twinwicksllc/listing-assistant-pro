-- Migration: grant_execute_org_functions
--
-- Fixes a live production bug: every SELECT against org_members, and every
-- SELECT against drafts for a row with org_id set, has been failing with
--   {"code":"42501","message":"permission denied for function is_org_member"}
-- for every authenticated user, unconditionally. Confirmed live 2026-08-17.
--
-- Root cause, confirmed by querying pg_proc/has_function_privilege directly
-- against production: every SECURITY DEFINER function in the public schema
-- (all 30 of them, both this app's and the CRM's) has EXECUTE granted to
-- service_role but NOT to authenticated or anon. Every non-SECURITY DEFINER
-- function (mostly updated_at triggers) has it fine. That 100% clean split,
-- across functions created by many different migrations over months, is not
-- something any migration in this repo did -- git history was checked
-- (including fix/security-hardening, PR #332, which turned out to be
-- entirely Edge Function auth/webhook fixes, not database grants) and found
-- nothing. This is almost certainly Supabase's own project-level default
-- privilege setting for the public schema, meaning it has probably been true
-- since these functions were first created, not a recent regression.
--
-- is_org_member and is_org_owner are each referenced directly inside five
-- policy USING/WITH CHECK clauses (organizations, org_members,
-- org_invitations, and drafts) -- confirmed by grepping every migration for
-- policy clauses calling into them. Postgres does not skip a policy whose
-- USING expression raises an error and fall through to another permissive
-- policy; the error propagates and the whole statement fails. That is why
-- this broke both org_members and drafts identically, and why it does not
-- depend on how many org members exist or how the client shapes its query --
-- PR #480/#482 fixed a real, separate bug in how the frontend selected which
-- membership row to trust, but could not have fixed this, since this fails
-- before any row is even considered.
--
-- accept_invitation is included because it is directly called via
-- supabase.rpc("accept_invitation", ...) from TeamPage.tsx and has the
-- identical problem -- accepting a team invite is currently broken the same
-- way. get_user_org_id is included for consistency (same migration, same
-- trio as is_org_member/is_org_owner) even though no current policy
-- references it, since it is cheap to fix now rather than rediscover later.
--
-- Scope note: this migration grants execute ONLY on functions confirmed to
-- belong to this listing app. The same live query found roughly two dozen
-- other SECURITY DEFINER functions with the identical missing grant whose
-- names (commission/deal/tenant/contact/smile-assessment/audit-lead
-- vocabulary) match tables already classified CRM-owned in
-- REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md. Those are not touched here
-- -- same principle as the client-uploads storage policy left for the CRM
-- owner to fix (RBR-0027). This is very likely a live bug for the CRM
-- product too and is worth flagging to its owner separately.

-- The CRM-table guard this DO block originally had (refusing to run unless
-- public.accounts existed) was dropped 2026-09-02. It was meant to stop this
-- from ever running against an unintended database, but the grant itself
-- isn't CRM-conditional -- these four functions are confirmed to be this
-- app's own (see the scope note above), so any standalone deployment of this
-- app needs the same grant. The guard instead blocked every legitimate
-- non-CRM-shared deployment forever, found when setting up the
-- listrassistr-qa Supabase project, which correctly has no CRM tables at all.
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid, uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.get_user_org_id(uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;
END $$;
