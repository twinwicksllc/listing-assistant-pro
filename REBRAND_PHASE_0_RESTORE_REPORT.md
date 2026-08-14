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

**Fix:** use the Table Editor's export (`⋯` → Export data → Download as CSV),
which has no row cap. `profiles` is the deliberate exception — it must come from
the SQL Editor so a redacting column list can be applied (see below). Every
export was then verified by record count before import.

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

## Constraint drift — verified for one table, and it drifted

Beyond columns, live `subscriptions` carries exactly three constraints:
`subscriptions_pkey`, `subscriptions_stripe_sub_id_key`, and
`subscriptions_org_id_fkey`. The migrations declare two more that **production
does not have**:

- `subscriptions_user_id_fkey` → `auth.users` — absent live, so orphaned
  subscription rows are possible in production.
- `subscriptions_status_check` (8 allowed values) — absent live, so production
  can hold arbitrary status strings. Any target schema that reinstates this CHECK
  must first confirm every existing value passes it, or the migration will fail.

**This is an open risk, not a closed finding.** Constraints were compared against
live for this one table only. Column names are now verified for all 26 tables;
constraints are verified for one. See RBR-0022.

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
4. **Vector integrity was not verified.** `knowledge_base` imported all 6 rows,
   but a row count cannot detect a truncated or mangled pgvector `embedding`. A
   dimension-level comparison between projects is still outstanding; silently
   corrupted embeddings would degrade RAG grounding in a way that looks like poor
   AI output rather than bad data.
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

1. Decide encryption, storage location, and retention for the export CSVs, which
   currently sit unencrypted on a local disk (P0-11).
2. Run a full constraint and index diff across all 26 tables (RBR-0022).
3. Verify `knowledge_base` embedding dimensions survived the round trip.
4. Re-run a timed rehearsal once the export path is fixed, to size the
   maintenance window (feeds P0-14).
5. Decide whether the two unexercised telemetry tables need to migrate at all.

## Cleanup

The disposable project `mydedtvyledbjarockrg` still exists and still holds the
imported data, including redacted `profiles` rows. It should be deleted once the
outstanding checks above are done. It contains no credentials and no CRM data.
