-- Migration: schedule_cleanup_media_retention
--
-- Schedules cleanup-media-retention, which implements a real, working TTL
-- policy (15-day retention, 60-day grace period for media still referenced by
-- an active/unpublished draft) but has never been wired to run. Investigated
-- 2026-08-17 during a full capture-to-eBay flow review: the function itself
-- is sound, but no migration created a cron.job entry for it, no GitHub
-- Actions workflow calls it, and nothing else in the codebase invokes it. The
-- live cron.job inventory taken 2026-08-14 (RBR-0025) had exactly two
-- entries, neither this one -- the same "built, never scheduled" pattern
-- found twice already that week for invoke-cost-alert-cron and
-- sync-ebay-taxonomy.
--
-- Likely consequence: listing-videos/, listing-video-frames/, and
-- server-uploads/ under the listing-images bucket have been accumulating
-- unchecked since this was built. This plausibly explains part of the
-- 4,735-object / 1.27 GB storage figure found in the P0-10 baseline
-- (REBRAND_PHASE_0_BASELINE.md), against only 6 rows in drafts.
--
-- This job differs from the other two scheduled functions in one important
-- way: it deletes production storage objects and mutates drafts rows,
-- rather than only reading data or sending an email. cleanup-media-retention
-- was given a dry-run mode (JSON body {"dryRun": true}, or ?dryRun=true) for
-- exactly this reason -- run that manually against production and review the
-- reported deletedPaths/deletedCount BEFORE applying this migration. See the
-- companion instructions handed to the operator alongside this migration.
--
-- The function's auth was also migrated in the same change from its own
-- one-off MEDIA_RETENTION_SECRET/x-cleanup-secret header check to the
-- requireCronSecret pattern already adopted for the other two cron jobs
-- (DEC-0022), so this reuses the SAME project_url and cron_secret Vault
-- secrets created for those -- no new secret setup is required.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    RAISE EXCEPTION
      'Missing Vault secret cron_secret. This should already exist from scheduling invoke-cost-alert-cron and sync-ebay-taxonomy-weekly -- if it is missing, create it (and the matching CRON_SECRET Edge Function secret) before applying this migration.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'project_url') THEN
    RAISE EXCEPTION 'Missing Vault secret project_url.';
  END IF;
END $$;

-- Daily is generous for a 15-day TTL; chosen for consistency with the other
-- crons' cadence rather than any urgency. Off the hour and distinct from the
-- other two jobs' times (00:07 and Sun 03:11) to avoid any resource overlap.
SELECT cron.schedule(
  'cleanup-media-retention-daily',
  '23 5 * * *',
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
      RAISE EXCEPTION 'cleanup-media-retention: Vault secret project_url is missing or empty';
    END IF;
    IF v_secret IS NULL OR v_secret = '' THEN
      RAISE EXCEPTION 'cleanup-media-retention: Vault secret cron_secret is missing or empty';
    END IF;
    IF v_url !~ '^https://[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'cleanup-media-retention: project_url is not a bare https origin after normalisation (length %)', length(v_url);
    END IF;

    PERFORM net.http_post(
      url := v_url || '/functions/v1/cleanup-media-retention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      -- Real run, not a dry run: the scheduled job is meant to actually
      -- enforce the TTL once the operator has verified a manual dry run.
      body := jsonb_build_object('dryRun', false),
      timeout_milliseconds := 60000
    );
  END $inner$;
  $job$
);
