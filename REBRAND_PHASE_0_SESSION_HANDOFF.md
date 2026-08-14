# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-14
**Repository:** `twinwicksllc/listing-assistant-pro`
**Working branch:** `docs/phase-0-rbr-0014-schema-capture` — 5 commits, PR open, docs only
**Production changed today:** yes, once, unintentionally. Read the incident section before doing anything else.

## Read this first — a production schema change happened

A rehearsal script intended for a disposable project was executed against shared
production and dropped all ten `public` → `auth.users` foreign keys. It has been
fully repaired and verified free of orphans, and is recorded as **RBR-0023**.

The lesson is encoded as **DEC-0014**: any SQL capable of modifying schema or data
must carry a guard that raises an exception unless the target project is confirmed
by fingerprint. A prose warning naming the right project is not sufficient — that
is exactly what failed. The fingerprint for the shared production project is the
presence of CRM tables:

```sql
-- Aborts unless this IS production. Invert the NOT for disposable-only scripts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'accounts') THEN
    RAISE EXCEPTION 'Refusing to run: not the production project';
  END IF;
  -- statements here
END $$;
```

**DEC-0015** clarifies that DEC-0006 covers schema as well as rows. **DEC-0016**
requires re-verifying any finding derived from a query run after a known mutation —
added because one finding was recorded from a post-drop query and had to be
retracted.

## What was accomplished today

1. **P0-10 baseline captured** — row counts for all 26 listing tables. The headline:
   96% of rows (31,518 of 32,687) are regenerable cache or telemetry. Real business
   data is only ~1,169 rows across 12 tables. See `REBRAND_PHASE_0_BASELINE.md`.
2. **P0-12 restore rehearsal completed and passed** — 13 tables, 16,285 rows, 100%
   row-count match into a disposable project. Three defects found, all documented
   in `REBRAND_PHASE_0_RESTORE_REPORT.md`.
3. **P0-11 evidence captured** — production has daily backups, latest 6 retained,
   no PITR.
4. **Schema drift fully mapped for all 26 tables** — columns, constraints, and
   indexes, which this repo has never had before.
5. **Six new exceptions logged** — RBR-0019 through RBR-0024.

## The findings that change future work

- **`drafts` live has 52 columns; the migrations produce 43.** The nine missing ones
  include `status`, `price`, `listing_id`, and all three eBay business-policy IDs.
  A ListrAssistr project built from `supabase/migrations/` alone would ship a
  broken publish flow. **The repo does not describe production** — do not assume it
  does. (RBR-0021)
- **eBay OAuth tokens live in `public.profiles` as plaintext columns**, not in
  `ebay_tokens`, which is dead schema with zero rows. Never `SELECT *` from
  `profiles` into a file; use the redacting column list in the restore report.
  Only 2 of 9 users hold tokens, and the owner has accepted asking them to
  reconnect, so tokens are deliberately out of migration scope. (RBR-0019, RBR-0020)
- **A database restore cannot be the rollback plan.** The project is shared with an
  unrelated CRM product and Supabase has no table-subset restore, so rolling back
  would revert CRM data too. RPO is up to 24 hours; the recovery window is about 6
  days. Plan forward-fix instead. (RBR-0024)
- **Count-based comparison is not a sufficient drift check.** `subscriptions` has 11
  columns live and 11 from migrations, and they are not the same 11. Diff names.

## Environment constraints that still apply

- **No direct Postgres connectivity from this machine.** DNS resolves but TCP to
  5432 and 6543 times out; ICMP fails. `psql`, `pg_dump`, `pg_restore`, and
  `supabase db dump`/`db push` are all unusable here. Everything goes through the
  Dashboard browser UI. Do not spend time re-testing this.
- **The SQL Editor caps results at 100 rows** and "Download CSV" exports only what
  the grid returned, silently. There is a **"No limit"** selector — use it, or use
  the Table Editor export. Three tables were silently truncated before this was
  noticed.
- **CSV exports write SQL NULL as the literal string `null`**, which errors on
  `timestamptz`/`uuid`/`numeric` and, worse, silently stores `"null"` as text.
- **No `node_modules`; `npx prettier` fails on TLS.** Use the Deno standalone
  Prettier fallback in `CLAUDE.md` for markdown formatting, and delete the helper
  script afterward.

## Artifacts

**Keep:** `C:\Users\fenwitr\phase0-restore-schema.sql` — the schema-recreation
script, now covering all 26 tables with drift and provenance annotated inline. A
copy lives at `.git\phase0-restore-schema.sql` (untracked by virtue of being inside
`.git/`). It is a **rehearsal scaffold, not a migration schema**: no RLS, grants,
triggers, functions, or views. Its header says so.

**Deliberately destroyed 2026-08-14:** the disposable project
`phase0-restore-test` (`mydedtvyledbjarockrg`) and the local CSV export set,
including `.orig` backups. The CSVs held customer names, listing content, and COGS
financials in plaintext. Nothing in the evidence depends on either — all numbers
were verified while they were live. Do not go looking for them.

## Next actions, cheapest first

1. **P0-09 cron inventory** — not started, read-only, no approval needed.
2. **P0-13 cohort query** — the exclusion rule is settled: profiles whose
   `display_name` matches `qa%` are test accounts (3 of 9). All 54 `test_items`
   rows are orphans and that table should be excluded entirely. What remains is
   writing the selection SQL and getting scope approval. Note several of the
   remaining 6 profiles appear to be the owner's own duplicate accounts — that
   consolidation question is unresolved and is a decision, not a query.
3. **P0-14 and P0-15** — writing tasks needing owner decisions. RBR-0024 already
   frames the P0-15 constraint. P0-14 needs a timed rehearsal to size the window;
   today's run was not timed.
4. **RBR-0022 leftovers** — capture the exact `indexdef` for
   `idx_drafts_published_at` (inferred from its name, not captured), and decide
   whether the four absent `idx_subscriptions_*` indexes and the `status` CHECK
   belong in the target schema.

## Two verifications never returned

Neither is blocking, both are one query:

1. **The FK repair** — production should now show 10 rows for:
   `SELECT conrelid::regclass, conname FROM pg_constraint WHERE confrelid = 'auth.users'::regclass AND connamespace = 'public'::regnamespace ORDER BY 1;`
   The repair reported success, but success was inferred from the absence of an
   error rather than confirmed. This is the one production change from today.
2. **`idx_drafts_published_at`** — see item 4 above.

## Safe resume

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
```

Check for open PRs first — as of this handoff, `docs/phase-0-rbr-0014-schema-capture`
should be the only one. Review `REBRAND_PHASE_0_DECISION_LOG.md` and
`REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` for approval status before any provider
action, and guide dashboard steps one at a time.

## Gate status

4 of 18 gates have evidence: P0-04 (secret inventory), P0-10 (partial — `auth.users`
count confirmed at 9, storage baseline still open under P0-08), P0-11, and P0-12.
Zero gates are approved. All 7 pending approvals (PEND-0001 … PEND-0007) remain
pending, and 24 exceptions are logged with most still open. **Phase 0 is not close
to closing**, and Phase 1 entry (P0-18) has not started.
