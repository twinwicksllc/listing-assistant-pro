# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-10  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Current branch:** `docs/rebrand-phase-0-live-schema-reconciliation`
**Base commit:** `115cc9a` (`main` at branch creation)
**Next PR:** #460, focused live schema reconciliation; merge after PR #459

PR #459 records the live legacy Auth inventory and is being merged separately.
This branch must be rebased or recreated from the updated `main` after #459 is
merged if GitHub reports a base-branch conflict.

## Where work stops

The legacy repository remains operational. The repository-only Phase 0 pass and
the object-level live Supabase classification are documented, but Phase 0 is
not closed. No production provider, credential, customer data, Supabase
migration, DNS, Stripe, eBay, OAuth, or cutover action was performed from this
codespace.

The canonical Phase 0 documents are now in `main`:

- `REBRAND_PHASE_0_IMPLEMENTATION.md`
- `REBRAND_PHASE_0_REPOSITORY_DISCOVERY.md`
- `REBRAND_PHASE_0_SERVICE_INVENTORY.md`
- `REBRAND_PHASE_0_SECRET_INVENTORY.md`
- `REBRAND_PHASE_0_SCHEMA_INVENTORY.md`
- `REBRAND_PHASE_0_EXCEPTION_LOG.md`
- `REBRAND_PHASE_0_DECISION_LOG.md`
- `REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md` (PR #460)
- `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` (PR #460)

## Legacy PR history

The following Phase 0 documentation PRs are merged:

- #452 - Phase 0 migration implementation plan
- #453 - Phase 0 operating roadmap
- #454 - `REBRAND_` artifact namespacing
- #455 - Service, secret-name, schema, and exception inventories
- #456 - Repository discovery reconciliation
- #457 - Phase 0 decision log
- #459 - Live legacy Auth inventory (being merged before #460)

PR #460 is the focused live schema reconciliation and closure-checklist change.

## New repository status

The target repository is private `twinwicksllc/listrassistr-official`.

Reported status from the new agent:

- PR #2, initial shell/configuration work, is merged.
- PR #3, staging-safe route and accessibility work, was submitted and reviewed.
- PR #4, updates to the staging authentication plan, is being pushed.
- The next new-repository PR is expected to be #5.
- Vercel is green.
- A dedicated Supabase project was created for the new application:
  `yqftpibxplachhwoclam`.
- Supabase Auth URL configuration was entered for the initial staging setup:
  Site URL `https://listrassistr.com`, callback
  `https://listrassistr.com/auth/callback`, and local callback
  `http://localhost:3000/auth/callback`.
- The target app has not connected to the legacy Supabase project or any
  production provider.

The new repository must remain a separate target-product workspace. Do not copy
production data, secrets, tokens, password hashes, or the legacy backend into it.
The legacy Phase 0 inventories remain authoritative here.

For now, `https://listrassistr.com` is the initial staging application origin.
The planned dedicated QA hostname remains `https://qa.listrassistr.com`; it must
be configured and tested before treating staging and production as fully
separated environments. The current staging project must not receive production
customer data or legacy database credentials.

## Current discovery position

- The legacy Supabase project `wcednzaxmxwfiijzmjmx` is confirmed as shared
  production infrastructure for RankedCEO CRM and the eBay listing application.
- The live object export is classified in
  `REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`.
- Listing candidates, CRM-only candidates, shared/ambiguous objects, system
  schemas, live-only objects, storage buckets, and RLS metadata drift are
  recorded.
- The classification does not yet include exact table definitions, policy
  expressions, grants, row counts, storage metrics, cron schedules, or backup /
  restore evidence.

## Next legacy action after resume

1. Confirm PR #459 is merged, then rebase or recreate PR #460 from updated
   `main` if needed.
2. Begin user-guided, read-only provider inventory.
3. Capture exact live definitions, RLS expressions/grants, storage metrics, and
   cron job definitions.
4. Record provider names, URLs, environment names, owners, secret names, and
   statuses only; never record secret values.
5. Capture approved database/Auth/storage baselines in restricted storage.
6. Create and test an encrypted backup and disposable restore path.
7. Define and rehearse the deterministic ListrAssistr migration cohort.
8. Approve maintenance, communications, rollback, and go/no-go controls.
9. Resolve or explicitly accept the high-impact exceptions before Phase 0 exit.

## Pending Phase 0 gates

- Capture exact live schema definitions, RLS expressions/grants, Storage metrics,
  Edge Function inventory, and cron job definitions.
- Review broad `verify_jwt = false` usage and production deployment automation.
- Confirm Vercel, DNS, Stripe, eBay, Resend, Sentry, and GitHub environments.
- Confirm the staging Supabase project owner, region, empty-project status, and
  final QA hostname plan.
- Capture database/Auth/storage baselines and complete encrypted backup/restore
  rehearsal.
- Define and approve the deterministic migration cohort and exception process.
- Approve ownership classification, backup/restore evidence, cohort scope,
  maintenance window, rollback deadline, and Phase 0 exit.

The detailed status table is maintained in
`REBRAND_PHASE_0_CLOSURE_CHECKLIST.md`.

## Safe resume command

From the repository root:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
```

Before any provider action, review `REBRAND_PHASE_0_DECISION_LOG.md` and obtain
explicit owner approval. The AI must guide dashboard actions one step at a time
and must not request or print sensitive values.
