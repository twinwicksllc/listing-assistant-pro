-- Migration: fix_cron_jobs_vault_secrets
--
-- Repairs the two scheduled jobs in this project, neither of which has ever
-- succeeded. Evidence from cron.job_run_details on 2026-08-14:
--
--   invoke-cost-alert-cron-daily-midnight-utc  145 runs, 0 successes
--     ERROR: null value in column "url" of relation "http_request_queue"
--     violates not-null constraint -- headers showed "Authorization": null too.
--     Cause: the job read vault secrets named 'project_url' and
--     'publishable_key', and vault.secrets was EMPTY, so both subqueries
--     returned NULL and net.http_post was handed a NULL url.
--
--   sync-ebay-taxonomy-weekly                   15 runs, 0 successes
--     ERROR: unrecognized configuration parameter "app.supabase_url"
--     Cause: the job called current_setting() on custom GUCs that Supabase
--     does not set, without the missing_ok argument, so it raised before
--     issuing any HTTP request.
--
-- Consequences of the outage: cost alerting never fired (corroborated by
-- cost_alerts holding 0 rows), so the spend guardrail over Gemini usage was
-- absent for roughly 145 days; and the weekly eBay taxonomy sync never ran, so
-- ebay_taxonomy_cache (15,116 rows) was only ever populated by application
-- calls and its freshness is unknown. Tracked as RBR-0025.
--
-- PREREQUISITE -- this migration is inert without it:
--   Two Vault secrets must exist before this runs, created via the dashboard
--   (Project Settings -> Vault). Values are never stored in the repository:
--     project_url        e.g. https://<project-ref>.supabase.co
--     service_role_key   the project's service_role key
--   Both jobs below read from vault.decrypted_secrets, so the same migration
--   applies unchanged to the ListrAssistr project -- deliberately, so this fix
--   is not another hand-applied production change that no migration describes.
--
-- Auth note: sync-ebay-taxonomy and cost-alert-cron both enforce
-- requireServiceRole, so the service_role key is required. The previous
-- cost-alert job passed a publishable (anon) key, which would have been
-- rejected even had the URL resolved.

-- ---------------------------------------------------------------------------
-- Guard: refuse to run unless both prerequisite secrets are present. Failing
-- loudly here beats deploying a job that silently repeats the NULL-url failure
-- for another 145 days.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  missing text[];
BEGIN
  SELECT array_agg(n) INTO missing
  FROM (VALUES ('project_url'), ('service_role_key')) AS v(n)
  WHERE NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = v.n);

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing required Vault secret(s): %. Create them in Project Settings -> Vault before applying this migration (see RBR-0025).',
      array_to_string(missing, ', ');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Unschedule the broken jobs. cron.unschedule() raises if the job does not
-- exist, so existence is checked first to keep this migration idempotent and
-- safe to apply to a fresh project that has neither job.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Prefixed to avoid shadowing cron.job.jobname, which would make the
  -- comparison below depend on qualification to disambiguate.
  v_jobname text;
BEGIN
  FOREACH v_jobname IN ARRAY ARRAY[
    'invoke-cost-alert-cron-daily-midnight-utc',
    'sync-ebay-taxonomy-weekly'
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = v_jobname) THEN
      PERFORM cron.unschedule(v_jobname);
      RAISE NOTICE 'Unscheduled %', v_jobname;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Reschedule against Vault.
--
-- Both commands resolve url and key at run time from vault.decrypted_secrets,
-- and both COALESCE to a deliberate failure rather than passing NULL into
-- net.http_post -- the original job's silent-NULL behaviour is precisely what
-- made this outage invisible for 145 days.
--
-- Minute offsets avoid exactly-on-the-hour scheduling.
-- ---------------------------------------------------------------------------

-- Daily cost alert. Retains the original daily cadence, shifted off midnight.
SELECT cron.schedule(
  'invoke-cost-alert-cron-daily',
  '7 0 * * *',
  $job$
  DO $inner$
  DECLARE
    v_url text;
    v_key text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE EXCEPTION 'cost-alert-cron: missing Vault secret project_url or service_role_key';
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

-- Weekly eBay taxonomy sync. Sundays 03:00 UTC as before, shifted off the hour.
SELECT cron.schedule(
  'sync-ebay-taxonomy-weekly',
  '11 3 * * 0',
  $job$
  DO $inner$
  DECLARE
    v_url text;
    v_key text;
  BEGIN
    SELECT decrypted_secret INTO v_url
      FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_key
      FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE EXCEPTION 'sync-ebay-taxonomy: missing Vault secret project_url or service_role_key';
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

-- ---------------------------------------------------------------------------
-- Deliberately NOT scheduled here:
--
--   auto-reprice-cron         Owner decision 2026-08-14 (DEC-0017): repricing
--                             alters live listing prices unattended and will
--                             not run on a schedule.
--
--   competitor-prices-cron    Blocked on a code defect, not configuration
--                             (RBR-0028): the function selects only users whose
--                             ebay_access_token is currently unexpired, and eBay
--                             access tokens live about two hours. Zero of nine
--                             profiles hold an unexpired access token, so a
--                             scheduled run would select no users and no-op
--                             while reporting success. It must mint a token from
--                             the stored refresh token first. Owner has approved
--                             a daily cadence once fixed (DEC-0018).
-- ---------------------------------------------------------------------------
