# Rebrand Phase 0 Backup and Restore Rehearsal Report

**Product:** ListrAssistr
**Gates:** P0-11 (encrypted backup) and P0-12 (restore rehearsal)
**Performed:** 2026-08-14
**Source project:** `wcednzaxmxwfiijzmjmx` (RankedCEO-CRM — shared with an unrelated CRM product)
**Target project:** `phase0-restore-test` (`mydedtvyledbjarockrg`) — disposable, created for this rehearsal only
**Result:** Passed, with three defects found and fixed during the run

## Outcome in one line

All 13 in-scope tables were exported from production and re-imported into a
clean project with a 100% row-count match, after correcting three defects that
would each have broken a live cutover.

## Method, and why it is manual

This machine cannot open TCP connections to Supabase's Postgres ports — DNS
resolves, but connections to 5432 and 6543 both time out and ICMP fails. That is
a local network or firewall block, not a Supabase or project-specific issue. It
rules out `pg_dump`, `pg_restore`, `psql`, and the Supabase CLI's `db dump` and
`db push` entirely from this environment.

The rehearsal therefore ran through the Supabase Dashboard browser UI:

1. Schema recreated in the target project from a consolidated script.
2. Per-table CSV export from the source project.
3. Per-table CSV import into the target project via the Table Editor.
4. Row-count comparison between source and target.

**Consequence for P0-11:** what exists is a set of per-table CSV files on local
disk, not an encrypted `pg_dump` archive. That is a weaker artifact than the gate
language implies. Encryption, retention, and storage location for these files
still need an owner decision before P0-11 can be approved rather than merely
evidenced.

## Scope

13 of the 26 listing-app tables were moved. The selection follows the P0-10
baseline in [REBRAND_PHASE_0_BASELINE.md](REBRAND_PHASE_0_BASELINE.md):

- **12 business-data tables** — the rows that actually matter.
- **`ebay_taxonomy_cache`** — retained deliberately as a volume test at 15,116
  rows. Nothing else in scope is large enough to surface CSV import limits.

Excluded: three other regenerable cache tables, two usage-telemetry tables, two
taxonomy-support tables, and the six tables that are empty. Excluding them is a
scoping decision, not an oversight — but it does mean this rehearsal did not
exercise `usage_tracking` (6,667 rows) or `gemini_usage` (2,709 rows).

## Row-count validation

Source counts were verified twice: once from the export CSVs by counting records
with a CSV-aware parser, and once from the live database. Target counts came from
`count(*)` in the disposable project after import.

| Table                | Source | Target | Match |
| -------------------- | -----: | -----: | ----- |
| ebay_taxonomy_cache  | 15,116 | 15,116 | yes   |
| listing_cogs         |    814 |    814 | yes   |
| competitor_prices    |    257 |    257 | yes   |
| test_items           |     54 |     54 | yes   |
| profiles             |      9 |      9 | yes   |
| organizations        |      9 |      9 | yes   |
| org_members          |      9 |      9 | yes   |
| drafts               |      6 |      6 | yes   |
| knowledge_base       |      6 |      6 | yes   |
| optimization_history |      2 |      2 | yes   |
| org_invitations      |      1 |      1 | yes   |
| subscriptions        |      1 |      1 | yes   |
| support_tickets      |      1 |      1 | yes   |
| **Total**            | 16,285 | 16,285 | yes   |

13 of 13 tables match. No row loss, no duplication.

## Defects found

All three were found by the rehearsal and would have recurred on a real cutover
using the same export path.

### Defect 1 — CSV exports encode SQL NULL as the literal string `null`

**Symptom:** import failed with
`ERROR: 22007: invalid input syntax for type timestamp with time zone: "null"`.

**Cause:** both the SQL Editor's "Download CSV" and the Table Editor's export
write NULL values as the four-character text `null`. Postgres tolerates that for
`text` columns, silently storing the string `"null"`, and rejects it outright for
`timestamptz`, `uuid`, and `numeric`.

**Severity:** high, and worse than the error suggests. The visible failure was
the timestamp column. The silent failure — text columns receiving a literal
`"null"` string instead of NULL — would not have errored at all and would have
corrupted data invisibly.

**Fix:** every field whose value was exactly `null` was blanked, using a
CSV-aware parser rather than a regex, because `drafts` has 52 columns including
quoted multi-line description fields that a naive replace would corrupt. Affected
files: `drafts` (162 fields), `profiles` (76), `subscriptions` (2),
`organizations` (1), `optimization_history` (1). Column counts stayed uniform
per file and record counts were unchanged, confirming the parse was correct.
Originals retained as `<table>.csv.orig`.

**Checked:** if any field had been an explicit empty string, blanking nulls would
have made the two indistinguishable. Zero such fields existed, so no fidelity was
lost.

### Defect 2 — SQL Editor silently truncates exports at 100 rows

**Symptom:** `ebay_taxonomy_cache` exported 100 rows instead of 15,116.

**Cause:** the SQL Editor's result grid caps at 100 rows, and "Download CSV"
exports only what the grid returned. No warning is shown.

**Severity:** high. This is a silent-truncation failure — the CSV looks valid.
`listing_cogs` (814) and `competitor_prices` (257) were also truncated to 100 by
the same cap and would have migrated as ~12% and ~39% of their real content.

**Fix as performed:** use the Table Editor's export (`⋯` → Export data →
Download as CSV), which has no row cap. `profiles` was the deliberate exception —
it had to come from the SQL Editor so a redacting column list could be applied
(see below). Every export was then verified by record count before import.

**Better fix, found afterwards:** the SQL Editor has a **"No limit"** selector
that disables the 100-row cap outright. That is preferable for a real cutover,
because it removes the awkward split where one table uses a different export path
from the other twelve — `profiles` could then be exported both redacted and
untruncated from the same place. The rehearsal did not use this route, so it is
untested at 15,000 rows and should be verified before being relied on.

### Defect 3 — Live schema drift from the tracked migrations

**Symptom:** `drafts` and `subscriptions` both rejected their CSVs as
"incompatible with the table".

**Cause:** the target schema was reconstructed from `supabase/migrations/`, which
does not describe the live database.

- **`drafts`:** live has **52 columns; migrations produce 43.** The nine live-only
  columns are `condition_id`, `ebay_category_name`, `fulfillment_policy_id`,
  `listing_id`, `payment_policy_id`, `price`, `return_policy_id`, `status`, and
  `updated_at`.
- **`subscriptions`:** live has `org_id` (uuid, FK to `organizations(id)`
  `ON DELETE SET NULL`) and has **no `created_at` column at all**. The migrations
  produce the opposite. Both sides have 11 columns, so the difference cancels out
  in any count-based comparison.

**Severity:** high, and the most consequential finding of the rehearsal. The plan
of record is a new ListrAssistr Supabase project. Built from migrations alone,
its `drafts` table would silently lack listing status, price, listing ID, and all
three eBay business-policy bindings — the publish flow would fail in ways that
present as application bugs rather than schema problems.

**Fix:** columns added to the target and to the recreation artifact, with the
provenance recorded inline.

**Method note worth keeping:** the first drift scan compared column _counts_ and
reported `subscriptions` as matching. Only a column _name_ diff caught it. Count
comparison is not a sufficient drift check.

## Constraint and index drift — full diff across all 26 tables

A complete diff of live `pg_constraint` and `pg_indexes` against the recreation
artifact was run on 2026-08-14. The first pass produced a misleading result
because it ran while production was missing ten foreign keys due to the incident
recorded in RBR-0023. With that noise excluded, the real picture is narrow:

| Comparison  | Tables identical |
| ----------- | ---------------- |
| Constraints | 25 of 26         |
| Indexes     | 23 of 26         |

Genuine drift, all four items now annotated in the recreation artifact:

1. **`profiles_stripe_customer_id_key`** — a UNIQUE constraint on
   `stripe_customer_id` present in production that no migration declares. Also
   supplies the implicit index of the same name.
2. **`idx_drafts_published_at`** — an index present in production that no
   migration declares. Its exact definition was inferred from the name and has
   **not** been captured; pull `pg_indexes.indexdef` before relying on it.
3. **Four `idx_subscriptions_*` indexes** — `user_id`, `stripe_sub_id`,
   `stripe_cust_id`, and `status` are declared by the migrations but absent in
   production. A performance gap rather than a correctness one; adding them to the
   target schema is recommended.
4. **`subscriptions_status_check`** — an 8-value CHECK declared by the migrations
   and absent in production, so `status` can hold arbitrary strings. A CHECK was
   unaffected by the RBR-0023 incident, so this finding is real. Any target schema
   reinstating it must first confirm every existing value passes, or the migration
   will fail.

**Retracted from an earlier revision of this report:** the claim that production
lacked `subscriptions_user_id_fkey`. That was inferred from a query run after the
RBR-0023 drop and was wrong. The constraint has been restored in production.

## Incident during the rehearsal — RBR-0023

A `DO` block written to drop `auth.users` foreign keys in the disposable project
was executed against **shared production** instead, removing all ten such
constraints from the `public` schema. It relied on a prose warning to target the
right project rather than a guard that could refuse to run.

Detected the same day by the constraint diff above: every `auth.users` FK was
missing while unrelated constraints from the same migration files were present,
an absence pattern matching the script's `WHERE` clause exactly. Project identity
was confirmed by a CRM-table fingerprint query.

No data was lost — dropping a foreign key removes a rule, not rows, and the
rehearsal row counts were unaffected. The exposure was loss of `ON DELETE
CASCADE`, which would have silently orphaned a user's records on the next auth
deletion. An orphan check across all ten relationships returned zero rows, so all
ten constraints were re-added with their original definitions and no data repair
was required.

Corrective controls are recorded as DEC-0014 through DEC-0016: destructive
snippets must carry a fail-closed environment guard, DEC-0006 is clarified to
cover schema as well as rows, and any finding derived from a query run after a
known mutation must be re-verified before being recorded.

## Deviations from a true restore

Recorded so this rehearsal is not over-credited:

1. **Foreign keys to `auth.users` were dropped in the target** — 10 of them,
   including `profiles.id` itself. The disposable project has no auth users, so
   every import would have failed on a FK violation. The rehearsal therefore
   validates data movement but **not** referential integrity to `auth`. The
   alternative, seeding 9 matching `auth.users` rows, was rejected as it would
   place real user identifiers in a scratch project for little gain.
2. **`profiles` was exported with credentials redacted**, not copied faithfully.
   `ebay_access_token`, `ebay_refresh_token`, `ebay_token_expires_at`, and
   `stripe_customer_id` were replaced with typed NULLs. Verified after export:
   zero occurrences of the eBay token signature `v^1.1#`, zero `cus_` Stripe
   identifiers, and a maximum line length of 283 characters — far too short to
   conceal a token. No credentials left production. See RBR-0020.
3. **RLS, grants, and triggers were not recreated.** The recreation script is
   tables, keys, and indexes only. A restore from it alone yields tables with no
   row-level authorization. This is sufficient for a data-movement rehearsal and
   insufficient for a cutover.
4. **Vector integrity WAS verified — this deviation is closed.** A row count
   cannot detect a truncated or mangled pgvector `embedding`, so all six
   `knowledge_base` rows were compared across both projects on
   `vector_dims(embedding)`, `length(embedding::text)`, and
   `md5(embedding::text)`. All three matched on every row: 768 dimensions, text
   lengths of 9,683 to 9,738 characters, and identical hashes. The embeddings
   round-tripped byte-identically, so RAG grounding is unaffected. (A pgvector
   version comparison was not needed: a version difference could only produce a
   false mismatch, and the hashes matched.) This was the check most likely to fail
   and the one a row count could never have caught.
5. **Duration was not recorded.** The run took one working session on 2026-08-14;
   no per-phase timings were captured. A cutover maintenance window cannot be
   sized from this report alone.

## Assessment

The rehearsal did its job. Three defects were found, two of which — literal
`null` encoding and 100-row truncation — fail silently or partially and would
have produced a corrupted target that looked successful. The schema-drift finding
invalidates the assumption that `supabase/migrations/` describes production,
which affects the entire Phase 1 target-schema design, not just this rehearsal.

**Recommended before P0-11/P0-12 are approved rather than merely evidenced:**

1. ~~Decide encryption, storage location, and retention for the export CSVs.~~
   **Resolved:** the owner elected to destroy them rather than retain them, since
   they hold customer names, listing content, and COGS financials and their only
   purpose was this completed rehearsal. P0-11 rests on the managed daily backup
   instead — a stronger artifact than an encrypted folder would have been.
2. Capture the exact definition of `idx_drafts_published_at`, and decide whether
   the four missing `idx_subscriptions_*` indexes and the `status` CHECK should
   exist in the target schema (RBR-0022).
3. ~~Verify `knowledge_base` embedding integrity.~~ **Resolved:** verified
   byte-identical across both projects by dimension, text length, and md5.
4. Re-run a timed rehearsal once the export path is fixed, to size the
   maintenance window (feeds P0-14).
5. Decide whether the two unexercised telemetry tables need to migrate at all.
6. Settle the rollback strategy on the basis that a full-database restore is not
   available, since the project is shared with the CRM (RBR-0024, feeds P0-15).

## Cleanup

Both rehearsal artifacts were deliberately destroyed after the verification work
completed, rather than retained:

- **Disposable project `mydedtvyledbjarockrg`** — held the imported copy,
  including redacted `profiles` rows. Deleted once the embedding comparison, which
  required both projects alive, had passed. It never contained credentials or CRM
  data.
- **Local CSV export set** — `profiles`, `drafts`, `listing_cogs` and the rest,
  plus the `.orig` pre-cleanup backups. These held customer names, listing
  content, and COGS financials in plaintext, so retaining them would have created
  standing exposure for no ongoing benefit. Re-export takes minutes and the
  procedure is documented above.

Nothing in this report depends on either artifact still existing: every number
here was verified while they were live, and the schema findings are preserved in
the recreation script and the exception log. A future reader should not go looking
for them.
