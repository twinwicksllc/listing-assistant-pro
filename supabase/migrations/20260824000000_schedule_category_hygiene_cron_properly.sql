-- Migration: actually schedule category-hygiene-cron
--
-- 20260331000000_schedule_category_hygiene_cron created the pg_cron extension
-- and the category_hygiene_log table, but never called cron.schedule() --
-- it only left three unexecuted options as SQL comments (Dashboard,
-- pg_cron+pg_net, external scheduler). Confirmed by inspecting every
-- cron.schedule() call across all migrations: only sync-ebay-taxonomy-weekly,
-- invoke-cost-alert-cron-daily, cleanup-media-retention-daily,
-- inventory-sync-every-15min, and competitor-prices-refresh-cursor-5min are
-- actually wired up. category-hygiene-cron has been silently dormant since
-- it was written -- category_hygiene_log has never received a row. This is
-- Finding D of CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md.
--
-- This migration follows the same Vault-secret + net.http_post pattern as
-- 20260818030000_schedule_inventory_sync_cron.sql. The function itself was
-- updated alongside this migration to require the cron secret via
-- requireCronSecret() (supabase/functions/_helpers/authGuard.ts), matching
-- sync-ebay-taxonomy -- previously it had no auth guard at all.
--
-- Cadence: weekly, Sunday 04:11 UTC -- one hour after sync-ebay-taxonomy-weekly
-- (03:11 UTC) so the taxonomy cache used by future precedence-based dedup is
-- freshly synced first, and well clear of cleanup-media-retention-daily
-- (05:23 UTC) and invoke-cost-alert-cron-daily (00:07 UTC). Follows the
-- project's "distinct times" convention for avoiding CPU/memory contention
-- between scheduled jobs.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION
      'Missing Vault secret cron_secret. This should already exist from scheduling the other cron functions -- if it is missing, create it (and the matching CRON_SECRET Edge Function secret) before applying this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    RAISE EXCEPTION 'Missing Vault secret project_url.';
  END IF;
END $$;

SELECT cron.schedule(
  'category-hygiene-weekly',
  '11 4 * * 0',
  $job$
  DO $inner$
  DECLARE
    v_url text;
    v_secret text;
  BEGIN
    SELECT rtrim(trim(decrypted_secret), '/') INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT trim(decrypted_secret) INTO v_secret
      FROM vault.decrypted_secrets WHERE name = 'cron_secret';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE EXCEPTION 'category-hygiene-cron: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'category-hygiene-cron: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'category-hygiene-cron: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/category-hygiene-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  END $inner$;
  $job$
);
