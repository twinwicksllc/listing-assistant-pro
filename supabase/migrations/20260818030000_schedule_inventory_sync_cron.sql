-- Migration: schedule inventory-sync-cron
--
-- Part of the fix for competitor-prices-cron's 2026-08-18 WORKER_RESOURCE_LIMIT
-- crash (see 20260818000000's header for full incident context). This is the
-- slow half of the split: populates user_active_listings on a capped,
-- per-invocation-bounded cadence via get_users_for_inventory_sync
-- (20260818010000), decoupled from the fast competitor-price refresh cursor
-- scheduled separately in 20260818040000.
--
-- This REVISES DEC-0018, which approved a daily cadence for
-- competitor-prices-cron before it was ever actually wired to cron.schedule()
-- (confirmed: it had never been scheduled at all -- only ever invoked
-- manually). That single daily-everything design is what produced the
-- 539-listing-in-one-invocation crash. This migration replaces it with a
-- frequent, small-batch cadence instead, following the same Vault-secret /
-- net.http_post pattern as 20260817000000_schedule_cleanup_media_retention.
--
-- Cadence: every 15 minutes, offset by 3 minutes from the competitor-price
-- refresh cursor's `*/5 * * * *` schedule (20260818040000) so the two never
-- compete for CPU/memory budget simultaneously -- same "distinct times"
-- convention already used for cost-alert-cron (00:07 daily), sync-ebay-taxonomy
-- (03:11 weekly), and cleanup-media-retention (05:23 daily).
--
-- Cap: 3 users/tick (see get_users_for_inventory_sync's p_limit) x 96
-- ticks/day = 288 user-syncs/day capacity. At a 6h inventory-freshness
-- target, this supports up to ~72 connected eBay accounts before staleness
-- grows past 6h -- degrades gracefully by retuning cap/period, not by any
-- single invocation growing in size.

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
  'inventory-sync-every-15min',
  '3,18,33,48 * * * *',
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
      RAISE EXCEPTION 'inventory-sync-cron: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'inventory-sync-cron: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'inventory-sync-cron: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/inventory-sync-cron',
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
