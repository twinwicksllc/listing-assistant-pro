# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-17
**Repository:** `twinwicksllc/listing-assistant-pro`
**Session output:** 23 PRs merged (#481–#503), 0 open

## Read this first — a new, unresolved auth mystery blocks live verification

**RBR-0028's fix (PR #503, merged and deployed) is code-complete but not yet
verified live**, because manually invoking `competitor-prices-cron` with a
confirmed-correct `service_role` key returns `401 Unauthorized` — and this is
not a testing mistake. The owner confirmed: freshly copied from the
`service_role` row (not `anon`) on Settings → API, no extra whitespace, sent
as `Authorization: Bearer <key>` via the dashboard's function-test panel's
manual-header option. Still 401.

This function's auth check (`requireServiceRole` in `_helpers/authGuard.ts`)
does a literal string comparison against `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`
— nothing about it changed in today's RBR-0028 PR, and it is the exact same
mechanism `cleanup-media-retention` and other functions use successfully via
`requireCronSecret`'s service-role fallback. Two things make this worth
treating as a real, unexplained finding rather than user error:

1. `competitor-prices-cron` has **never** been on a `cron.job` schedule (P0-09
   inventory, 2026-08-14, found only two scheduled jobs, neither this one) —
   so nothing has ever actually exercised this function's auth path
   end-to-end before tonight. It is plausible this specific check has been
   broken since the function was written, the same "built but never actually
   invoked successfully" pattern already found twice this week for the other
   crons (RBR-0025).
2. The dashboard's own "Run Edge Function As A Role" → Postgres/Superuser
   selector also returned 401 first, which is expected (it very likely
   injects a signed role-claim JWT, not the literal static service-role key
   string this check requires) — but the manual-header attempt with the
   actual key should have worked and didn't.

**Next session should start here.** Suggested first move: add a redacted
diagnostic to this function's auth-rejection branch (booleans/lengths only,
never the raw value — same pattern as `describeCronAuthEnv` for `CRON_SECRET`
and the `EBAY_ENVIRONMENT` diagnostic from earlier this week), deploy, retry
the manual invocation, and read the function log. That will show directly
whether `SUPABASE_SERVICE_ROLE_KEY` is even set in this function's runtime
environment, its length, and whether it matches what's being sent — the same
"one log line would have identified the cause immediately" lesson from
RBR-0025 applies here too.

## What happened today, roughly in order

1. **Fixed a wave of real production bugs** surfaced by dashboard errors
   after PR #480 merged over the weekend: an auth-init deadlock risk
   (`getUser()` called near `onAuthStateChange`, #482), missing `EXECUTE`
   grants on four listing-app RPC functions causing 403s on `org_members`
   and `drafts` (#485 — traced to a security-hardening pass that granted CRM
   functions but missed this product's four), `EBAY_ENVIRONMENT` defaulting
   to `sandbox` instead of `production` across ten functions (#481), and a
   storage-cleanup cron that had been built but never scheduled — fixed with
   scheduling, dry-run mode, and `CRON_SECRET` auth (#483), then a second fix
   for a fake `/storage/v1/bucket/{id}/stats` call that had been silently
   404ing since it was written (#484).
2. **Full capture → analyze → draft → eBay-publish flow review**, at the
   owner's request, surfaced six more real findings, each shipped as its own
   PR: SKU/offerId not persisted on partial publish failure, causing every
   retry to orphan the prior inventory item on eBay instead of reusing it via
   the existing idempotent PUT (#487); four defense-in-depth video-publish
   hardening fixes — broadened endpoint-retry logic, an upload timeout, a
   server-side re-verification of LIVE status before attaching a video to a
   listing, and a client-side polling cap (#488); duplicate video-frame
   storage, where extracted frames were being uploaded once by the edge
   function and then re-uploaded a second time client-side (#489); a stale
   "coming soon" UI caption for a feature that already shipped, plus removal
   of one dead component (#491); and a SPA rewrite in `vercel.json` with no
   exclusion for static files, which was serving `index.html` instead of
   `manifest.webmanifest` (#490).
3. **Resolved almost all of the open Phase 0 gates from the 2026-08-14
   handoff.** P0-07 scope narrowed by owner decision (DEC-0026): CRM-side RLS
   families explicitly out of this review's scope, with a standing rule that
   any CRM-side gap found is flagged, never fixed by weakening RLS. P0-06
   ownership classification drafted in full
   (`REBRAND_PHASE_0_OWNERSHIP_CLASSIFICATION.md`, new) and all three open
   questions resolved by the owner: the Stripe account is confirmed shared
   with the CRM (dedicated new ListrAssistr account planned rather than
   splitting it, DEC-0027), the CRM deploys no Edge Functions into the
   shared project (DEC-0028), and `subscriptions`/`usage_tracking`/
   `gemini_usage` are reclassified ListrAssistr-only after a confirmation
   query returned zero cross-product rows (DEC-0030). P0-13's cohort
   de-duplication rule is recorded (DEC-0029): identity lives in `profiles`,
   not a separate `users` table; the owner's own duplicate profiles collapse
   to one, QA/test profiles collapse to one, everyone else transfers — specific
   account identifiers were confirmed directly with the owner and
   deliberately not written into any repo file. P0-15's rollback plan turned
   out to already exist in full in `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`
   §14–15, just never cross-referenced from Phase 0 before (DEC-0031) — and
   its DNS/host-routing restore path was independently already consistent
   with the no-database-restore constraint (RBR-0024), despite predating it.
   P0-16 confirmed: the owner is sole operational owner of all ten roles,
   with AI as proxy per the existing DEC-0008/DEC-0009 framework.
4. **P0-08 storage reconciliation went from "bucket counts only" to nearly
   fully evidenced.** Exact `pg_policies` expressions confirmed a real
   anonymous-INSERT gap on the CRM-owned `client-uploads` bucket — the policy
   named "Service role write" actually has `roles = {public}` with no
   `auth.role() = 'service_role'` check anywhere, the same misnamed-policy
   failure pattern already fixed once this week in `market_price_history`
   (RBR-0017 update). A linkage query against `drafts`/`profiles` found only
   19 of 4,735 `listing-images` objects (0.4%) actually referenced by a live
   draft — **4,716 objects (99.6%) confirmed orphaned** (RBR-0026 update).
   Root cause identified as RBR-0033: `removeDraft()` never deleted its own
   draft's storage objects, and `cleanup-media-retention`'s three tracked
   prefixes were never actually reachable for two of the three — a flat,
   non-recursive `list()` call can't see into the per-user subfolder that
   `listing-videos/` and `listing-video-frames/` both nest, so in practice
   only `server-uploads/` was ever cleaned up. The full per-object manifest
   needed two attempts: the SQL Editor's 100-row display cap silently
   truncated the first try (same Defect 2 as the P0-12 rehearsal), resolved
   by collapsing the whole result into one row via `jsonb_agg` to sidestep
   the row-count cap entirely. Final manifest (4,737 objects, kept on local
   disk only) matched the confirmed aggregate byte-for-byte with zero missing
   checksums.
5. **Shipped the fix for RBR-0033** (#500): `removeDraft` now best-effort
   deletes its own storage objects before the row delete, and
   `cleanup-media-retention` was rewritten from three flat prefix scans to a
   single recursive, paginated walk of the entire bucket, applying the same
   unchanged 15-day/60-day-active-draft policy to every file found regardless
   of folder depth — closing the coverage gap that let 4,716 objects
   accumulate. Shipped straight to production per owner decision (no extra
   manual dry-run requested, since the ~4,716 count was already independently
   confirmed via direct SQL) — the already-scheduled nightly cron
   (`dryRun: false`, 05:23 UTC) picks this up on its first tick after deploy.
   Not yet confirmed by the owner whether that first real run's numbers came
   back as expected.
6. **Incident: raw storage export data was committed to `main`.** A
   Copilot-authored PR (#495) added a storage-export utility and, along with
   it, committed `storage_objects.json` — 1,047 real object paths/owner UUIDs
   (itself incomplete, undercounting the true 4,737 by 78% from the same
   unpaginated-`list()`-call bug found elsewhere today). Caught immediately,
   removed from the tree (#496), and guarded against recurrence with a
   `.gitignore` entry and a README warning — this is the exact "keep exports
   on local disk only" discipline already established for every other
   export this week, just violated once by an automated PR before it was
   caught. **Still an open, deliberately-deferred decision:** whether to
   purge the old commit from git history (a force-push) or leave it in
   history now that it's removed from HEAD — the owner has not yet said
   which they want.
7. **Fixed RBR-0028** (#503, this session's last code change): the cron only
   ever selected users with a currently-unexpired eBay access token, so on
   any real schedule it selected zero users and reported success — worse
   than never scheduling it, since the failure never surfaces in
   `cron.job_run_details`. Added `_helpers/ebayTokenRefresh.ts`, extracted
   from `ebay-publish/auth.ts`'s `handleRefreshToken` minus the
   `Request`/`Response` wrapping and caller-identity check a cron doesn't
   have, with unit tests using an injected fake `fetch` (these actually run
   and pass locally, unlike almost everything else touched this week). The
   cron now selects by refresh-token presence and refreshes an
   expired/missing access token before giving up on a user. Deliberately
   left `ebay-publish/auth.ts`'s own two refresh call sites untouched (a
   live user-facing path, not worth the risk for this fix) and left a
   pre-existing, unrelated `deno check` generic-mismatch error on this same
   file alone (confirmed pre-existing by diffing against the unmodified
   file — not something this change introduced or is responsible for
   fixing). **Blocked on the auth mystery above** before it can be verified
   working end-to-end. Scheduling this cron (a new migration, mirroring
   `20260817000000_schedule_cleanup_media_retention.sql`) is a deliberate,
   separate follow-up not yet started — DEC-0018 already approved a daily
   cadence once the fix is verified live.
8. **Confirmed independently, not something to build:** the "eBay Listings"
   dashboard page (540 live listings) pulls everything — including images —
   fresh from eBay's Inventory/Trading API on every page load, with no
   caching layer. Considered whether to cache the main image locally to cut
   eBay API usage; the owner checked actual usage and found only 50 of 5,000
   daily calls consumed. Caching would also not have reduced API call volume
   anyway, since the image already comes bundled in the same response used
   for price/status — there was no separate image-specific call to eliminate.
   No action taken; correctly identified as a solved-problem-not-yet-a-problem.

## Gate status: 15 of 18 have evidence or are substantially resolved

| Status                       | Gates                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Evidence captured / resolved | P0-01, P0-02, P0-03, P0-04, P0-05, P0-06, P0-07, P0-09, P0-10, P0-11, P0-12, P0-13, P0-15, P0-16 |
| In progress                  | P0-08 (retention decision + migration path remain), P0-14, P0-17                                 |
| Not started                  | P0-18                                                                                            |

At the start of today's session, 9 gates had evidence and P0-06/07/13/15/16
were all still open. Full detail and evidence locations are in
`REBRAND_PHASE_0_CLOSURE_CHECKLIST.md`.

**Exceptions:** 33 logged (up from 32), most newly-added or updated today
carry confirmed hard numbers rather than estimates. **Decisions:** 31
recorded (up from 25). Both logs are in `REBRAND_PHASE_0_EXCEPTION_LOG.md`
and `REBRAND_PHASE_0_DECISION_LOG.md`.

## The findings that matter most beyond today

1. **The storage orphan problem was worse than suspected, and now has a
   confirmed root cause and a shipped fix.** 99.6%, not "substantial" —
   4,716 of 4,735 objects. RBR-0033's fix is live; whether it actually
   cleared the backlog as expected needs the owner to check tomorrow's
   `cron.job_run_details` for `cleanup-media-retention`.
2. **A second cron (`competitor-prices-cron`) may have a broken
   service-role auth check that has never been exercised until tonight.**
   Same root pattern as RBR-0025 (a built-but-never-actually-invoked
   integration point), but this one isn't diagnosed yet — see "Read this
   first."
3. **`REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`'s original
   classifications keep turning out to be more resolvable than they looked
   when written under caution on 2026-08-10.** Three separate items
   (Stripe account, `subscriptions`/`usage_tracking`/`gemini_usage`, the
   rollback plan) all had a real, findable answer sitting either in a direct
   owner confirmation or in a document that already existed but had never
   been cross-referenced. Worth re-checking other "shared/ambiguous" items
   the same way before assuming they need fresh discovery work.
4. **A misnamed RLS policy is a repeatable failure class, not a one-off.**
   Found and fixed once in `market_price_history` this week, found again
   (unfixed, CRM-owned) in `client-uploads` today. Worth a deliberate sweep
   of every policy's actual `qual`/`with_check` against its name at some
   point, on both sides of the shared project.

## Process lessons for whoever continues this

- **A real "can't do X" constraint does not extend to adjacent things that
  are actually still possible.** This environment genuinely can't run
  `tsc`/`eslint`/`vitest` locally (no `node_modules`, `npx` blocked by a TLS
  proxy) — but formatting _is_ checkable via the Deno-standalone-Prettier
  fallback already documented in `CLAUDE.md`, for any file type, not just
  markdown. Skipping that check on frontend `.ts`/`.tsx` files (while
  correctly running it for docs and `deno fmt` for `supabase/functions/**`)
  caused three avoidable CI failures today. Saved as a standing memory note
  this session; run the matching check on every touched file, no exceptions.
- **Verify a testing claim is actually testing the right thing before
  trusting its result.** The dashboard's role-based function-test selector
  looked like it should authenticate as service-role; it didn't, and the
  first 401 from it very nearly got treated as "the fix doesn't work" before
  checking a plain manual-header attempt too.
- **Branch hygiene:** `git fetch && git merge-base --is-ancestor <branch>
origin/main` before pushing more commits to a branch name, every time —
  caught a Copilot-vs-manual duplicate-fix collision today (PR #501, closed
  as redundant) that would otherwise have looked like a real conflict.
- **Automated fix-it agents (Copilot) can commit things you didn't ask for.**
  The storage-export incident (#495/#496) happened inside a PR whose stated
  purpose was a utility script — the committed data export wasn't the
  utility's point, just a side effect nobody reviewed closely before merge.
  Worth a closer look at exactly what's in a Copilot-authored diff before
  approving it, not just whether CI is green.

## Next steps, cheapest and most decision-independent first

1. **Diagnose the `competitor-prices-cron` 401.** Add a redacted auth
   diagnostic (see "Read this first"), deploy, retry, read the log. Likely a
   short investigation given how directly the CRON_SECRET/EBAY_ENVIRONMENT
   precedents solved themselves once logged.
2. **Once diagnosed and fixed if needed, verify RBR-0028 live**, then ship
   the follow-up scheduling migration (DEC-0018 already approves daily
   cadence) — mirrors `20260817000000_schedule_cleanup_media_retention.sql`.
3. **Check tomorrow's `cleanup-media-retention` cron run** for sane
   `deletedCount`/`bytesFreed`/`keptForDraft` numbers, closing out RBR-0033.
4. **Decide on the storage-export git-history purge** — leave the old commit
   in history, or force-push a rewrite. Explicit owner call, not something
   to default on.
5. **P0-08's two remaining items:** the retention decision on the (now
   hopefully-cleared) orphaned objects, and a tested storage migration path
   — the latter is a genuinely bigger, separate workstream.
6. **P0-14 timed rehearsal re-run** — same 13-table export/import as P0-12,
   this time with a stopwatch, using the kept schema script
   (`C:\Users\fenwitr\phase0-restore-schema.sql`).
7. **P0-06's `avatars` bucket owner-mapping** — the one small loose end left
   in the otherwise-closed ownership classification (one stale orphaned
   object, low stakes, not urgent).
8. Once P0-08/P0-14/P0-17 settle, **P0-17** (exception disposition) and then
   **P0-18** (Phase 1 entry decision) become realistic to approach.

## Environment constraints that still apply

- **No direct Postgres/Storage connectivity from this machine** — all
  database and storage work goes through the Supabase Dashboard SQL Editor.
  The SQL Editor's row-display cap (100 rows) has no visible "No limit"
  toggle in the current dashboard version — for a result set that needs to
  exceed it, collapse everything into a single row with `jsonb_agg(...)`
  instead of fighting the pagination UI.
- **`npx prettier`/`npx vitest` still fail on the TLS proxy issue.** Use the
  Deno-standalone-Prettier fallback in `CLAUDE.md` for _any_ Prettier-covered
  file type (markdown, `.ts`, `.tsx`, `.mjs`, JSON configs), not just docs —
  see the process lesson above.
- **`git config core.autocrlf=true`, no `.gitattributes`.** Same as before;
  `deno fmt`/the Prettier fallback both need a CRLF-stripped copy to check
  cleanly, then the fix gets applied to the real (CRLF) file directly.

## Artifacts

**Kept, local disk only, not in the repo:** the complete `storage_objects.json`
manifest (4,737 objects, `C:\Users\fenwitr\Downloads\storage_objects.json`)
— the real P0-08 evidence artifact, gitignored going forward.

**Also still relevant from 2026-08-14:** `C:\Users\fenwitr\phase0-restore-schema.sql`,
needed for the P0-14 timed rehearsal re-run.

## Safe resume

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
```

No open PRs as of this handoff. Start with the `competitor-prices-cron` 401
investigation — it's the one active blocker. Review
`REBRAND_PHASE_0_DECISION_LOG.md` and `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md`
for current status before any provider action, same as always.
