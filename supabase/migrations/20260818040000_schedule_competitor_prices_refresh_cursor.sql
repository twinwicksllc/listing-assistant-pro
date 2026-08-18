-- Migration: schedule competitor-prices-cron (cursor-based rewrite)
--
-- Part of the fix for competitor-prices-cron's 2026-08-18 WORKER_RESOURCE_LIMIT
-- crash (see 20260818000000's header for full incident context). This is the
-- fast half of the split: pulls a small, fairness-ranked batch of due-for-refresh
-- (user, listing) pairs via get_next_competitor_price_batch (20260818020000),
-- reading from user_active_listings which inventory-sync-cron
-- (20260818030000) keeps populated on its own separate, slower cadence.
--
-- This REVISES DEC-0018, which approved a daily cadence for this cron before
-- it was ever actually wired to cron.schedule() (confirmed: it had never been
-- scheduled at all -- only ever invoked manually, which is what surfaced the
-- 539-listing-in-one-invocation crash). A single daily invocation processing
-- every user's entire backlog is exactly the design that failed; this
-- migration replaces it with a frequent, capped cursor instead.
--
-- Cadence: every 5 minutes, offset from inventory-sync-cron's
-- `3,18,33,48 * * * *` schedule so the two never compete for CPU/memory
-- budget simultaneously (same "distinct times" convention as the other
-- scheduled jobs in this project).
--
-- Cap: 30 listings/tick (see the cron's call to get_next_competitor_price_batch)
-- x 288 ticks/day = 8,640 listing-refreshes/day capacity. At the 24h cache TTL
-- (competitorSearch.ts CACHE_TTL_MS), steady state needs each active listing
-- refreshed once/day, so this comfortably supports up to ~8,640 total active
-- listings across all connected users combined -- well above the known
-- worst case (539 for one user) even scaled to several such users.

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
  'competitor-prices-refresh-cursor-5min',
  '*/5 * * * *',
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
      RAISE EXCEPTION 'competitor-prices-cron: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'competitor-prices-cron: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'competitor-prices-cron: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/competitor-prices-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  END $inner$;
  $job$
);
