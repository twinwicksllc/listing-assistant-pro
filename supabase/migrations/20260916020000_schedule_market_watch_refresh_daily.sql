-- Migration: schedule market-watch-refresh's daily batch mode
--
-- Problem 3, Phase 3.4 (small version) of the pricing-reliability plan.
-- Uses get_watches_due_for_refresh (20260916010000) to find watches whose
-- last_checked_at is more than 24h old, in a small capped batch per tick --
-- the same "tick-and-drain" shape as inventory-sync-cron
-- (20260818030000_schedule_inventory_sync_cron.sql), not a single daily
-- invocation processing the whole backlog (that exact design is what caused
-- competitor-prices-cron's WORKER_RESOURCE_LIMIT crash, see that migration's
-- header for the incident).
--
-- Cadence: every 30 minutes, at :13/:43 -- deliberately NOT on a multiple of
-- 5 (avoids the competitor-prices-refresh-cursor-5min job's every-tick
-- collision) and NOT on inventory-sync-cron's :03/:18/:33/:48 pattern,
-- following this project's existing "distinct times" convention for
-- scheduled jobs sharing the same database.
--
-- Cap: 5 watches/tick x 48 ticks/day = 240 watch-refreshes/day capacity.
-- Each refresh is one Browse API call + one Jina scrape (see
-- market-watch-refresh/index.ts) -- deliberately conservative for a
-- niche, low-volume, user-opt-in feature, and each watch itself only needs
-- refreshing once per ~24h at this phase's cadence (see the plan's Phase 3.4
-- section for why daily, not more frequent, was chosen). Retune the batch
-- size here if watch volume ever grows past this capacity, rather than
-- shortening the per-watch staleness window.

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
  'market-watch-refresh-batch-30min',
  '13,43 * * * *',
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
      RAISE EXCEPTION 'market-watch-refresh: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'market-watch-refresh: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'market-watch-refresh: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/market-watch-refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := '{"mode":"batch"}'::jsonb,
      timeout_milliseconds := 60000
    );
  END $inner$;
  $job$
);
