-- Migration: revoke anon/authenticated EXECUTE on three cursor RPCs
--
-- Confirmed live on production (2026-09-17/18) via has_function_privilege():
-- get_watches_due_for_refresh, get_users_for_inventory_sync, and
-- get_next_competitor_price_batch all had EXECUTE granted to anon AND
-- authenticated, despite each one's own migration explicitly stating the
-- intent to be service_role-only (each is SECURITY DEFINER and bypasses
-- RLS -- get_users_for_inventory_sync's and get_next_competitor_price_batch's
-- own comments say so directly, citing 20260817010000_grant_execute_org_
-- functions.sql's "confirmed finding" that Supabase's project-level default
-- only grants service_role on newly created SECURITY DEFINER functions).
--
-- That finding is no longer true. This was discovered while hardening
-- match_ebay_categories (20260917030000, Phase 2.2b, PR #587): its own
-- `GRANT EXECUTE ... TO service_role` line was NOT sufficient to keep
-- anon/authenticated out, because this project's ALTER DEFAULT PRIVILEGES
-- now grants EXECUTE to anon/authenticated/service_role individually (not
-- via the PUBLIC pseudo-role) on every function created in `public` --
-- confirmed via pg_proc.proacl directly. `REVOKE ALL ... FROM PUBLIC` alone
-- does not undo an already-explicit per-role grant; anon/authenticated must
-- be named. Whether this default changed recently (plausible, given the
-- same-day 2026-09-17 legacy-API-key rotation this account also went
-- through) or was simply never actually true the way 20260817010000
-- concluded (that migration's own SECURITY DEFINER-function query is a
-- point-in-time observation, not a documented Supabase guarantee) is not
-- resolved here -- either way, the fix is the same: revoke explicitly and
-- verify with has_function_privilege() rather than trust the grant syntax.
--
-- Each of these three functions bypasses RLS by construction (that is
-- their whole purpose -- to read across all users' rows for a cron batch),
-- so an anon or authenticated caller invoking one directly reads data they
-- have no RLS-based right to see. All three are called exclusively by
-- service-role Edge Functions (competitor-prices-cron, inventory-sync-cron,
-- market-watch-refresh) -- confirmed via grep, no frontend `.rpc()` call
-- exists for any of them.

-- Wrapped in a DO block with to_regprocedure() existence checks (not a bare
-- REVOKE/GRANT per function): confirmed listrassistr-qa is missing
-- get_watches_due_for_refresh entirely (checked directly), so an unguarded
-- statement against it would abort this whole migration on that project.
-- Each function is fixed independently so one missing function never blocks
-- the other two.
DO $$
BEGIN
  IF to_regprocedure('public.get_watches_due_for_refresh(integer, timestamptz)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_watches_due_for_refresh(INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_watches_due_for_refresh(INTEGER, TIMESTAMPTZ) TO service_role;
  END IF;

  IF to_regprocedure('public.get_users_for_inventory_sync(integer, timestamptz)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_users_for_inventory_sync(INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_users_for_inventory_sync(INTEGER, TIMESTAMPTZ) TO service_role;
  END IF;

  IF to_regprocedure('public.get_next_competitor_price_batch(integer, timestamptz)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_next_competitor_price_batch(INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_next_competitor_price_batch(INTEGER, TIMESTAMPTZ) TO service_role;
  END IF;
END $$;
