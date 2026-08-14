# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-14
**Repository:** `twinwicksllc/listing-assistant-pro`
**Session output:** 13 PRs merged (#466–#478), 1 PR open awaiting merge

## Read this first — one PR needs to be merged before anything else

**`docs/exception-log-column-corruption-fix`** is open and not yet merged. It
fixes a real integrity bug in `REBRAND_PHASE_0_EXCEPTION_LOG.md`: four rows
(RBR-0017, RBR-0022, RBR-0025, RBR-0027) had their Owner and Status columns
scrambled by a field-numbering mistake in an `awk` command used earlier today,
across several commits, before anyone noticed. The real Owner value was
overwritten with a long status narrative, while the stale original status text
was stranded in the next column instead of being replaced.

It was caught by a systematic audit (checked every row against a corruption
heuristic) before this handoff was written, not by chance. Merge it first, or
the exception log's Owner column cannot be trusted for RBR-0017/22/25/27 until
you do. The closure checklist and decision log tables were checked too and do
**not** have this bug — verified separately.

## What happened today, roughly in order

1. **Finished the P0-11/P0-12 backup and restore rehearsal** that the prior
   session (2026-08-13) had left at "schema recreated, data not started." All
   13 in-scope tables exported and re-imported with a 100% row-count match
   (16,285 rows). Found and fixed three defects in the process: CSV exports
   encoding NULL as the literal string `"null"`, the SQL Editor silently
   truncating exports at 100 rows, and live schema drift on `drafts` (52
   columns live vs 43 from migrations) and `subscriptions` (an `org_id` /
   `created_at` swap that a column-_count_ check couldn't catch). Full detail
   in `REBRAND_PHASE_0_RESTORE_REPORT.md`.
2. **Incident: a rehearsal script dropped 10 production foreign keys.** A `DO`
   block meant for the disposable test project ran against shared production
   instead, because it relied on a prose warning rather than a guard that
   could refuse to run. No data was lost — a dropped FK removes a rule, not
   rows — and all ten were restored the same day with an orphan check
   confirming zero broken rows. Logged as RBR-0023. The corrective control
   (DEC-0014): every destructive SQL snippet must now carry a fingerprint
   guard that raises an exception unless the target project is confirmed,
   rather than trusting a written warning.
3. **P0-10 baseline captured.** 26 listing tables, ~32,687 rows, of which 96%
   turned out to be regenerable cache or telemetry — the real migration cohort
   is roughly 1,169 rows across 12 tables, much smaller than it first looked.
4. **Repaired both scheduled cron jobs**, neither of which had ever succeeded
   (145 and 15 failed runs respectively, 0 successes). Root causes: the
   cost-alert job read Vault secrets that didn't exist; the taxonomy job called
   `current_setting()` on custom GUCs Supabase never sets. Fixing it properly
   took four small migrations, because the original design authenticated
   against the service-role key — which works between Edge Functions (both
   sides read the same env var) but is opaque to an external pg_cron caller,
   making a mismatch undiagnosable. Landed on a dedicated `CRON_SECRET` shared
   secret instead (DEC-0022), plus URL/key normalization and a redacted
   diagnostic logged on any future 401 (DEC-0023). Both jobs verified working
   end to end: cost-alert returned real spend data ($1.72/month, 169 requests)
   and taxonomy did a full 15,111-row refresh in 2.4 seconds.
5. **Found a live listing-pipeline bug while verifying the taxonomy fix.**
   `ebay_taxonomy_cache` had been stale since 2026-05-01 (~105 days), and five
   coin **branch** categories — including top-level 11116 "Coins & Paper
   Money" — were permanently mislabeled as listable leaves by a second cache
   writer (`_helpers/suggestedCategories.ts`) that hardcoded `is_leaf: true`.
   `publish-helpers.ts` reads that table assuming every row is a real leaf, so
   this could plausibly have contributed to this repo's long history of
   coin-category publish failures. Data corrected, code fixed (RBR-0029),
   `deriveLeafStatus` extracted and unit-tested.
6. **Found and fixed an exploitable storage RLS gap.** Every "own photo"
   policy on `storage.objects` (`listing-images`, `avatars`) checked only
   `bucket_id`, never the caller — any authenticated user could delete or
   overwrite any other user's listing photos (4,735 objects, 1.27 GB). Fixed
   with an `owner = auth.uid()` predicate on all six policies; verified both
   at the policy-expression level and by the owner testing upload/delete
   in-app. `client-uploads` (CRM-owned bucket) still allows anonymous INSERT
   and was **not** fixed — not ours to fix — the CRM owner has been emailed.
7. **Found the cost-alert email would have silently failed to deliver.** The
   repaired cron sent from `alerts@teckstart.com`, an unverified domain in a
   Resend account shared with the CRM owner (same login) — only
   `rankedceo.com` is verified there, and the plan tier charges for a second
   domain. Fixed by sending from `alerts@rankedceo.com` instead, since the
   alert is internal-only and not customer-facing (RBR-0031).
8. **Found that Sentry has never actually existed anywhere in this stack.**
   `_helpers/sentry.ts` is an undocumented no-op stub — the real SDK import
   was disabled after a CDN timeout issue and never revisited; there's no
   frontend instrumentation either; the owner confirmed no Sentry account was
   ever set up. This is arguably the root enabler of several other findings
   today: with no working alerting layer, the only way any of these problems
   could surface is someone reading function logs proactively, which nobody
   was doing (RBR-0032). Migration plan corrected to say "build from scratch,"
   not "separate existing environments" (DEC-0025).
9. **Walked the full provider inventory (P0-01/02/03) with the owner**,
   one item at a time: production URL, Vercel project/domains, Edge Function
   count and JWT settings, Stripe (live mode, webhook confirmed healthy-by-
   design), eBay (production app, 500+ live listings, four Developer Program
   notices triaged), Resend (the defect above), Sentry (the finding above).
10. **Recorded two approvals and one decision** from the owner: PEND-0001
    (shared infra ownership) and PEND-0004 (backup posture) approved;
    PEND-0005 (no deployment approval gate) decided.
11. **Cleaned up 229 fully-merged remote branches** (293 → 64) and closed out
    several stranded branches from PR-then-push mistakes (see lesson below).
12. **Found and fixed the column-corruption bug** described above, during a
    self-audit prompted by writing this handoff.

## Gate status: 9 of 18 have evidence, 3 approvals/decisions recorded

| Status                           | Gates                                                         |
| -------------------------------- | ------------------------------------------------------------- |
| Evidence captured                | P0-01, P0-02, P0-03, P0-04, P0-05, P0-09, P0-10, P0-11, P0-12 |
| In progress                      | P0-06, P0-07, P0-08, P0-13, P0-15, P0-17                      |
| Not started                      | P0-14, P0-18                                                  |
| Documented, confirmation pending | P0-16                                                         |

At the start of today's session, only 1 gate (P0-04) had evidence. Full detail
and evidence locations are in `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md`.

**Exceptions:** 32 logged (up from 18), roughly 3 fully resolved, 7 partially
resolved, 22 open. **Decisions:** 25 recorded (up from 13). Both logs are in
`REBRAND_PHASE_0_EXCEPTION_LOG.md` and `REBRAND_PHASE_0_DECISION_LOG.md`.

**Approvals:** PEND-0001 and PEND-0004 approved; PEND-0005 decided (no
deployment gate). PEND-0002, 0003, 0006, 0007 still pending.

## The four findings that matter most beyond today

1. **`supabase/migrations/` does not describe production.** `drafts` is
   missing 9 live columns including `status`, `price`, and all three eBay
   business-policy IDs. A ListrAssistr project built from migrations alone
   would ship a broken publish flow. (RBR-0021)
2. **There is no working error-tracking or alerting anywhere in this
   product.** Sentry is a no-op stub, and that's why the cron outage ran 145
   days and the taxonomy cache sat stale 105 days without anyone noticing.
   Building real observability should be an early, not late, ListrAssistr
   task. (RBR-0032, DEC-0025)
3. **A database restore cannot be the rollback plan.** The project is shared
   with an unrelated CRM, Supabase has no table-subset restore, and RPO is up
   to 24h with a ~6-day recovery window. P0-15 must be forward-fix. (RBR-0024)
4. **Column-_count_ comparisons are not a sufficient drift or corruption
   check.** This bit twice today: once diagnosing `subscriptions` schema drift
   (11 columns both sides, not the same 11), and once in the exception-log
   corruption itself, where every row had the right cell count but the wrong
   content in two of them. Diff by name/position, not by count.

## Process lessons for whoever continues this

- **Branch hygiene:** several times today, a commit was pushed to a branch
  whose PR had already merged, silently stranding it with no PR to review.
  After any merge, run `git fetch && git merge-base --is-ancestor <branch>
origin/main` before pushing more commits to that branch name — don't assume.
- **Destructive SQL needs a fingerprint guard, not a warning** (DEC-0014).
  Applies to any snippet that alters schema or data, not just the one that
  caused RBR-0023.
- **`awk -F'|'` table edits are error-prone across differently-shaped
  markdown tables.** The exception log has Owner before Status; the closure
  checklist and decision log have Status before the last column. A field
  index that's correct for one table is wrong for another. Prefer editing by
  matching on the actual column header, or double-check field position
  against the specific table's header before reusing a pattern.
- **Verify claims of success, don't infer them.** Nearly every real finding
  today came from checking something "known" to work: migrations vs.
  production, a cron's return code vs. an actual email in an inbox, a
  policy's _name_ vs. its actual `qual`/`with_check` expression, Sentry's
  presence in code vs. whether it does anything.

## Next steps, cheapest and most decision-independent first

1. **Merge `docs/exception-log-column-corruption-fix`.** Not optional — see
   top of this document.
2. **P0-13 (migration cohort) — waiting on one owner answer.** The `qa*`
   exclusion rule is settled (3 of 9 profiles), `test_items` is confirmed
   fully orphaned and excludable. Still needed: whether the owner's own
   several near-duplicate profiles should consolidate into one before the
   cohort query is written.
3. **P0-08 (storage manifest/linkage)** — buckets are inventoried
   (object counts, bytes, policies with expressions), but the object manifest
   with checksums and the linkage-to-drafts analysis are still open (RBR-0017,
   RBR-0026). `listing-images` at 4,735 objects for only 6 `drafts` rows
   implies substantial orphaned media worth understanding before any storage
   migration is attempted.
4. **P0-07 scope decision** — listing-app RLS is done (RBR-0015); CRM-side
   policies and public-intake policies are not this product's job to review.
   Getting an explicit owner decision to narrow scope would let this gate
   close rather than stay perpetually "in progress."
5. **P0-14 (maintenance/comms plan)** — needs a _timed_ rehearsal first;
   today's rehearsal didn't record durations. A quick re-run of the same 13
   exports/imports with a stopwatch would unblock this.
6. **P0-15 (rollback plan)** — the hard constraint is documented (RBR-0024,
   no full-database restore); the actual plan (trigger, decision deadline,
   owner, forward-fix runbook) is not yet written.
7. **P0-06 (ownership classification) and P0-16 (named owners confirmation)**
   — both need direct owner confirmation, not further AI discovery.
8. **RBR-0028** — `competitor-prices-cron` cannot run on any schedule as
   written; it only selects users with a currently-unexpired eBay access
   token (2-hour lifetime), so a scheduled run would silently no-op and
   report success. Needs a code fix (mint from the refresh token) before the
   owner's already-approved daily schedule (DEC-0018) can actually be turned
   on.
9. Once P0-06 through P0-08, P0-13, P0-14, P0-15 have evidence, **P0-17**
   (exception disposition) becomes possible — but only once new exceptions
   stop appearing at the rate they have been.

## Environment constraints that still apply

- **No direct Postgres connectivity from this machine** (confirmed
  2026-08-13; DNS resolves, TCP to 5432/6543 times out). All database work
  goes through the Supabase Dashboard SQL Editor / Table Editor. Use the SQL
  Editor's **"No limit"** result-count selector — the default 100-row cap
  silently truncates larger exports.
- **CSV exports encode SQL NULL as the literal string `"null"`.** Any future
  CSV-based export/import must account for this or it will fail (or worse,
  silently store the string `"null"` in a text column).
- **No `node_modules`; `npx prettier`/`npx vitest` fail on a TLS proxy
  issue.** Use the Deno-standalone-Prettier fallback documented in
  `CLAUDE.md` for markdown formatting; there is no local workaround for
  `vitest` yet, rely on CI for frontend test results.
- **`git config core.autocrlf=true`, no `.gitattributes`.** This makes most
  of `supabase/functions/` show as unformatted under `deno fmt --check` — a
  pre-existing artifact, not a real regression. For ListrAssistr, commit a
  `.gitattributes` with `eol=lf` on day one to avoid this permanently; not
  worth retrofitting into this legacy repo.

## Artifacts

**Keep:** `C:\Users\fenwitr\phase0-restore-schema.sql` — the schema-recreation
script, now covering all 26 tables with drift and provenance annotated inline
(also copied to `.git\phase0-restore-schema.sql`, untracked by virtue of being
inside `.git/`). It is a rehearsal scaffold, not a migration-ready schema — no
RLS, grants, triggers, functions, or views. Header states this explicitly.

**Deliberately destroyed 2026-08-14** (after the rehearsal completed and an
embedding-integrity check confirmed a byte-identical round trip): the
disposable project `phase0-restore-test` (`mydedtvyledbjarockrg`) and the
local CSV export set at `C:\Users\fenwitr\phase-0-export\`, which held
customer names, listing content, and COGS financials in plaintext. Nothing in
`REBRAND_PHASE_0_RESTORE_REPORT.md` depends on either still existing.

## Safe resume

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
```

Check for open PRs first — as of this handoff, `docs/exception-log-column-
corruption-fix` should be the only one, and merging it is the first task.
Review `REBRAND_PHASE_0_DECISION_LOG.md` and
`REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` for current approval status before any
provider action, and guide dashboard steps one at a time — nearly every
finding today came from checking a specific claim against reality rather than
accepting it.
