# Rebrand Phase 0 Session Handoff

**As of:** 2026-08-10  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Current branch:** `main`  
**Current commit:** `e77fbdc`  
**Remote state:** `main` matches `origin/main`

## Where work stops

The legacy repository remains operational and has completed the repository-only
Phase 0 documentation pass. No production provider, credential, customer data,
Supabase project, migration, DNS, Stripe, eBay, OAuth, or cutover action was
performed from this codespace.

The canonical Phase 0 documents are now in `main`:

- `REBRAND_PHASE_0_IMPLEMENTATION.md`
- `REBRAND_PHASE_0_REPOSITORY_DISCOVERY.md`
- `REBRAND_PHASE_0_SERVICE_INVENTORY.md`
- `REBRAND_PHASE_0_SECRET_INVENTORY.md`
- `REBRAND_PHASE_0_SCHEMA_INVENTORY.md`
- `REBRAND_PHASE_0_EXCEPTION_LOG.md`
- `REBRAND_PHASE_0_DECISION_LOG.md`

## Legacy PR history

The following Phase 0 documentation PRs are merged:

- #452 - Phase 0 migration implementation plan
- #453 - Phase 0 operating roadmap
- #454 - `REBRAND_` artifact namespacing
- #455 - Service, secret-name, schema, and exception inventories
- #456 - Repository discovery reconciliation
- #457 - Phase 0 decision log

This handoff is intended to be PR #458.

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

## Next legacy action after resume

1. Confirm this handoff PR is merged, then fast-forward local `main`.
2. Begin user-guided, read-only provider inventory.
3. Start with Supabase project ownership and live schema reconciliation.
4. Record provider names, URLs, environment names, owners, secret names, and
   statuses only; never record secret values.
5. Capture approved baselines and storage metrics in restricted storage.
6. Create and test an encrypted backup and disposable restore path.
7. Define the deterministic ListrAssistr migration cohort.
8. Resolve the high-impact exceptions before Phase 0 exit approval.

## Pending Phase 0 gates

- Confirm whether Supabase project `wcednzaxmxwfiijzmjmx` is shared production
  infrastructure.
- Reconcile live schema, RLS, Auth, Storage, Edge Functions, cron, and objects
  absent from repository migrations.
- Review broad `verify_jwt = false` usage and production deployment automation.
- Confirm Vercel, DNS, Stripe, eBay, Resend, Sentry, and GitHub environments.
- Confirm the staging Supabase project owner, region, empty-project status, and
  final QA hostname plan.
- Approve ownership classification, backup/restore evidence, cohort scope,
  maintenance window, rollback deadline, and Phase 0 exit.

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
