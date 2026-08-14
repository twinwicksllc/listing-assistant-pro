-- Migration: cron_jobs_use_cron_secret
--
-- Switches both scheduled jobs from borrowing the service-role key to a
-- dedicated shared secret, and supersedes the auth arrangement in
-- 20260814000000 and 20260814010000.
--
-- WHY. `requireServiceRole` compares the bearer token to
-- SUPABASE_SERVICE_ROLE_KEY by exact string equality. That works between Edge
-- Functions because both sides read the same environment variable, so the
-- comparison matches whatever the value happens to be and never actually
-- exercises it. A pg_cron caller is the only one that must supply that value as
-- a literal, and the value is opaque from outside the function runtime.
--
-- The practical consequence, observed 2026-08-14: after repairing the URL and
-- confirming the stored key really was a `role: service_role` JWT for this
-- project ref, the endpoint still returned 401 with no way to see what the
-- runtime was comparing against. Diagnosis had cycled through a new-format
-- `sb_`-prefixed key, a trailing space on the URL, and a whitespace hypothesis
-- for the key that could never have been the cause because `extractBearer`
-- already trims. That opacity is the same property that let this outage run for
-- roughly 145 days without anyone noticing (RBR-0025).
--
-- CRON_SECRET is set by the operator on both sides, so it can be verified and
-- rotated deliberately. It is also independent of Supabase's deprecation of the
-- legacy JWT API keys, which the service-role comparison depends on. The full
-- move to `sb_publishable_` / `sb_secret_` keys is deferred to the ListrAssistr
-- project by owner decision (DEC-0021); this migration removes the one place
-- where the legacy key format was load-bearing for an external caller.
--
-- `requireCronSecret` still accepts the service-role key, so nothing that
-- currently invokes these functions with it breaks.
--
-- PREREQUISITES -- this migration refuses to apply without them:
--   1. Edge Function secret CRON_SECRET set in the dashboard
--      (Settings -> Edge Functions -> Secrets). Cannot be verified from SQL;
--      if it is missing the jobs will 401 and the failure will be visible in
--      cron.job_run_details rather than silent.
--   2. Vault secret `cron_secret` holding the identical value.
-- Generate a high-entropy value, for example `openssl rand -base64 48`. Values
-- are never stored in this repository.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION
      'Missing Vault secret cron_secret. Create it, and set the identical value as the CRON_SECRET Edge Function secret, before applying this migration (see RBR-0025).';
  END IF;
END $$;

SELECT cron.schedule(
  'invoke-cost-alert-cron-daily',
  '7 0 * * *',
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
      RAISE EXCEPTION 'cost-alert-cron: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'cost-alert-cron: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'cost-alert-cron: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/cost-alert-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('triggered_at', now()),
      timeout_milliseconds := 10000
    );
  END $inner$;
  $job$
);

SELECT cron.schedule(
  'sync-ebay-taxonomy-weekly',
  '11 3 * * 0',
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
      RAISE EXCEPTION 'sync-ebay-taxonomy: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/sync-ebay-taxonomy',
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

-- The `service_role_key` Vault secret is now unused by any job. It is left in
-- place rather than deleted, since removing it is an operator decision and it is
-- harmless where it sits; delete it via the dashboard if you prefer not to keep
-- a second copy of that credential (see RBR-0020 on plaintext credentials in
-- this project). Any `service_key_candidate` secret created while diagnosing
-- should be deleted -- it served no purpose beyond that test.
