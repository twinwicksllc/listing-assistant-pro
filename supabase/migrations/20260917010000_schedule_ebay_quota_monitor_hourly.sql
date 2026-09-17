-- Migration: schedule ebay-quota-monitor's hourly poll
--
-- Follow-on to PR #580 (Phase 1.2b's search fan-out cap), which fixed the
-- self-inflicted call-volume spike behind a real production 429 pattern.
-- eBay's Browse API has a real, hard 5,000-calls/day limit per client_id --
-- a live check against this account's real keyset (2026-09-17) found
-- buy.browse already at 73.8% used (3,690/5,000) before this monitor
-- existed, and every resource checked reset at the same wall-clock instant
-- (midnight Pacific), not a per-app rolling window. #580 reduced the rate
-- of waste; ebay-quota-monitor makes the remaining budget visible via an
-- authoritative poll plus a same-day running counter, so a spike is
-- caught before the next live 429 rather than after.
--
-- CORRECTED (Copilot review, PR #581): originally scheduled once/day, which
-- defeated the same-day counter's entire purpose as an "early warning
-- between polls" signal -- if it was only ever evaluated once/day, at the
-- same cadence as the poll itself, it could not warn any earlier than the
-- poll would have anyway. Now hourly: :31 past every hour. The email alert
-- itself still fires at most once/day (ebay-quota-monitor's own same-day
-- dedup logic against ebay_rate_limit_polls.alert_sent), so this does not
-- risk alert spam -- it only shrinks the detection-to-alert delay. Cost:
-- 24 extra OAuth-token + getRateLimits calls/day, negligible against the
-- 5,000/day buy.browse limit this is monitoring (a different resource
-- entirely -- developer.analytics.app_rate_limit has its own separate
-- 5,000/day allocation per the account's real getRateLimits output).
--
-- Minute :31 chosen to stay off-round and distinct from every other
-- scheduled job's time in this project (invoke-cost-alert-cron-daily at
-- 00:07, sync-ebay-taxonomy-weekly at Sun 03:11, cleanup-media-retention-
-- daily at 05:23, category-hygiene-weekly at Sun 04:11, market-watch-
-- refresh-batch-30min at :13/:43, inventory-sync-every-15min at
-- :03/:18/:33/:48, competitor-prices-refresh-cursor-5min at every 5th
-- minute) -- following this project's existing "distinct times" convention
-- for jobs sharing the same database.

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
  'ebay-quota-monitor-hourly',
  '31 * * * *',
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
      RAISE EXCEPTION 'ebay-quota-monitor: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'ebay-quota-monitor: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'ebay-quota-monitor: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/ebay-quota-monitor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  END $inner$;
  $job$
);
