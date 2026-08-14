-- Migration: harden_cron_url_normalization
--
-- Follow-up to 20260814000000_fix_cron_jobs_vault_secrets.sql.
--
-- That migration repaired both cron jobs to read the project URL and
-- service_role key from Vault at run time, but concatenated the URL verbatim.
-- The first manual test after deploy failed with:
--
--   ERROR: invalid URL "https://<ref>.supabase.co /functions/v1/cost-alert-cron":
--   Malformed input to a URL function
--
-- Note the space before /functions. The Vault secret had been entered with a
-- trailing space -- invisible in the dashboard, and invisible to a
-- `LIKE '%/'` trailing-slash check.
--
-- Fixing the secret alone repairs the jobs, since they resolve Vault at run
-- time. This migration additionally makes the jobs tolerant of the mistake,
-- because this is the same failure mode that kept the previous outage silent for
-- roughly 145 days: a malformed input producing a NULL or invalid request rather
-- than a loud error. A secret re-entered by hand during ListrAssistr setup can
-- acquire the same stray whitespace, and nobody will be watching for it.
--
-- Normalisation applied to both jobs:
--   * trim() whitespace from both ends of the URL and the key -- a trailing
--     newline on the key produces a 401 that reads like a wrong-key problem
--   * rtrim(..., '/') so a trailing slash cannot yield a double-slash path
--   * an explicit shape check on the URL, so a malformed value fails with a
--     clear message naming the secret instead of a generic URL parse error

SELECT cron.schedule(
  'invoke-cost-alert-cron-daily',
  '7 0 * * *',
  $job$
  DO $inner$
  DECLARE
    v_url text;
    v_key text;
  BEGIN
    SELECT rtrim(trim(decrypted_secret), '/') INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT trim(decrypted_secret) INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE EXCEPTION 'cost-alert-cron: Vault secret project_url is missing or empty';
    END IF;
    IF v_key IS NULL OR v_key = '' THEN
      RAISE EXCEPTION 'cost-alert-cron: Vault secret service_role_key is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'cost-alert-cron: Vault secret project_url is not a bare https origin after normalisation (got length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/cost-alert-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
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
    v_key text;
  BEGIN
    SELECT rtrim(trim(decrypted_secret), '/') INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT trim(decrypted_secret) INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NULL OR v_url = '' THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: Vault secret project_url is missing or empty';
    END IF;
    IF v_key IS NULL OR v_key = '' THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: Vault secret service_role_key is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: Vault secret project_url is not a bare https origin after normalisation (got length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/sync-ebay-taxonomy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  END $inner$;
  $job$
);

-- cron.schedule() upserts by job name, so the two jobs created by the previous
-- migration are replaced in place rather than duplicated. Re-applying this
-- migration is therefore safe.
