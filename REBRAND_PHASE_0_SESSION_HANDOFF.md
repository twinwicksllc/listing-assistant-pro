# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-13
**Repository:** `twinwicksllc/listing-assistant-pro`
**Current branch:** `main` (clean); this update is being made on `docs/session-handoff-2026-08-13`
**Open, unmerged PR from earlier today:** `docs/phase-0-status-update-post-464` — confirms PR #464 deployed live and updates RBR-0015/0018/P0-07. Merge this whenever convenient; nothing blocks on it.

## Where work stops

No destructive or irreversible action was taken against the shared production Supabase project (`wcednzaxmxwfiijzmjmx`, RankedCEO-CRM) today. Everything below is either (a) already-merged code/doc changes, or (b) read-only queries plus work against a brand-new, disposable, empty Supabase project created purely for a restore rehearsal.

## What happened today, in order

1. **PR #462, #463 merged** (from a prior session): edge-function auth hardening (`authGuard.ts`) and `CLAUDE.md`.
2. **PR #464 merged**: fixed a real, exploitable RLS gap on `market_price_history` (anonymous callers could insert fake rows) and a companion auth fix to `market-watch-refresh`. Confirmed deployed live (owner observed the function's "updated" timestamp in the dashboard).
3. **RLS/grants review (RBR-0015) completed** for the 26-table listing-app/shared list — most `roles={public}` policies turned out to be false alarms; `market_price_history` was the one real gap (now fixed).
4. **Started P0-11/P0-12 (encrypted backup + restore rehearsal)** — this is the unfinished thread to pick up tomorrow. See "Next action" below for exactly where it stands.

## Critical environment finding: this network cannot reach Supabase's database ports directly

Confirmed via repeated testing (DNS resolves fine, but every TCP connection to port 5432 **and** 6543 times out, and even ICMP ping fails): **this machine/network cannot make direct Postgres connections to Supabase** (not a Supabase-side issue, not project-specific — a local network/firewall block). This means `psql`, `pg_dump`, `pg_restore`, and the Supabase CLI's `db dump`/`db push` **cannot be used against any Supabase project from here**, full stop.

**Implication for all future Phase 0 (and later migration) work from this machine:** everything must go through the Supabase Dashboard's browser UI (SQL Editor, Table Editor CSV import/export) — that channel is confirmed working (used repeatedly today for RLS/grants queries and schema creation). Don't waste time re-attempting CLI-based database connections here unless the network situation changes.

Local tools were installed anyway (in case this ever gets unblocked, or for use from a different network):
- `C:\Users\fenwitr\pgsql-tools\bin\` — `psql.exe`, `pg_dump.exe`, `pg_restore.exe`, `pg_dumpall.exe`
- `C:\Users\fenwitr\pgsql-tools\bin-supabase\supabase.exe` — Supabase CLI v2.114.0

Not added to system PATH (intentionally, to avoid an unrequested system change) — use full paths or `cd` into the folder.

## P0-11/P0-12 (encrypted backup + restore rehearsal) — current state

**Approach, given the network constraint above:** dashboard-only. Export via `SELECT * FROM <table>` + "Download CSV" per table in the SQL Editor; restore into a disposable project via a schema script + Table Editor CSV import.

**Disposable restore-test project:** `phase0-restore-test`, project ref **`mydedtvyledbjarockrg`**.

**Schema: DONE — all 26 tables now exist in the disposable project.**
- 24 of 26 were reconstructed by tracing every migration in `supabase/migrations/` that touches each table (chronologically, to get the *current* shape, not just the first `CREATE TABLE`). Verified independently against the actual migration files before use (spot-checked a mid-history primary-key change and a pgvector column — both matched exactly).
- The other 2 — **`reprice_rules`** and **`optimization_history`** — had no tracked migration at all (their placeholder migration, `20260324000001_add_optimization_tables.sql`, is a literal `SELECT 1` no-op; the tables were created by hand directly against the live database). Their schema was captured today via `information_schema` queries against the live project and has now been created in the disposable project too. **This also resolves the "capture definitions" part of RBR-0014** for these two tables specifically (see exception log update).
- The full reconstructed schema script (schema-only, no data, no secrets) is saved locally at `C:\Users\fenwitr\phase0-restore-schema.sql` (also a copy at `.git\phase0-restore-schema.sql`, gitignored by virtue of being inside `.git/`). It only covers the first 24 tables — the `reprice_rules`/`optimization_history` `CREATE TABLE` statements were given directly in chat, not yet appended to that file.

**Data: NOT STARTED.** This is where to pick up tomorrow.

**26-table list** (for the CSV export/import loop):
`drafts`, `ebay_tokens`, `category_mappings`, `category_aspects_cache`, `category_hygiene_log`, `lookup_decisions`, `ebay_taxonomy_cache`, `competitor_prices`, `market_watches`, `market_price_history`, `spot_price_cache`, `reprice_rules`, `optimization_history`, `listing_cogs`, `listing_financials`, `profiles`, `organizations`, `org_members`, `org_invitations`, `subscriptions`, `usage_tracking`, `gemini_usage`, `knowledge_base`, `test_items`, `cost_alerts`, `support_tickets`

## Next action (start here tomorrow)

1. For each of the 26 tables above: run `SELECT * FROM public.<table>;` in the **source** project's (`wcednzaxmxwfiijzmjmx`) SQL Editor, click "Download CSV", save with a clear naming convention (e.g. `phase0_export_<table>.csv`) into one local folder outside the repo.
2. For each table's CSV: use the **disposable project's** (`mydedtvyledbjarockrg`) Table Editor → select the table → "Import data from CSV" to load it.
3. Validate: compare row counts between source and disposable-project tables (a `SELECT count(*)` in each SQL Editor is enough — non-sensitive, safe to share).
4. Write up the rehearsal result (duration, table-by-table row-count match/mismatch, any defects) into a new `REBRAND_PHASE_0_RESTORE_REPORT.md` — this is the evidence artifact Phase 0 actually asks for (see `REBRAND_PHASE_0_IMPLEMENTATION.md` §9).
5. Once that's done, P0-11 and P0-12 can move from "Not started"/"In progress" to "Evidence captured" in the closure checklist.
6. Security cleanup whenever convenient (not blocking): `C:\Users\fenwitr\pgconn.txt` still holds the production DB password in plain text and is no longer needed (everything remaining is browser-based) — delete it. `C:\Users\fenwitr\phase0-backup-2026-08-13.dump` is a leftover empty (0-byte) file from an abandoned CLI attempt — also safe to delete.

## Safe resume command

From the repository root:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
```

Check for open PRs before starting new work — as of this handoff, `docs/phase-0-status-update-post-464` is open and unmerged.

Before any further provider action, review `REBRAND_PHASE_0_DECISION_LOG.md` and `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` for current approval status. Guide dashboard actions one step at a time; never request or print secret values — the network-connectivity issue above means every remaining database interaction should go through the dashboard UI anyway, which naturally keeps secrets out of the terminal/chat.
