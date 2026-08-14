# Rebrand Phase 0 Decision Log

**Product:** ListrAssistr  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Log opened:** 2026-08-10  
**Status:** In progress; Phase 0 exit approval is pending

## Decision rules

This log records decisions and approvals that control the rebrand and migration.
A documented direction is not permission to change production. Production access,
provider changes, data exports, destructive actions, migration scope, and cutover
still require explicit approval from the operational owner.

Secret values, customer data, tokens, password hashes, and private exports must
never be recorded here.

## Recorded decisions

| ID       | Decision                                                                                                                                              | Status             | Evidence / rationale                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| DEC-0001 | The target product name is ListrAssistr.                                                                                                              | Recorded           | Parent migration plan                                             |
| DEC-0002 | The target repository is private `twinwicksllc/listrassistr-official`.                                                                                | Recorded           | Parent migration plan and repository transition control           |
| DEC-0003 | `twinwicksllc/listing-assistant-pro` remains the running legacy application until cutover is explicitly approved.                                     | Recorded           | Repository transition control                                     |
| DEC-0004 | The target backend is a new ListrAssistr-only Supabase project, separate from the legacy project.                                                     | Recorded direction | Parent migration plan; live ownership still requires verification |
| DEC-0005 | Staging and production must use separate environments and credentials.                                                                                | Recorded           | Phase 0 implementation plan                                       |
| DEC-0006 | No production data is deleted or modified during Phase 0 discovery.                                                                                   | Control active     | Phase 0 implementation plan                                       |
| DEC-0007 | Phase 0 artifacts record secret names and locations only, never secret values.                                                                        | Control active     | Secret-handling protocol and secret inventory                     |
| DEC-0008 | The user is the operational owner for launch, brand, frontend, backend, migration, platform, integrations, security, QA, and legal/support decisions. | Recorded           | Ownership table in Phase 0 implementation plan                    |
| DEC-0009 | AI models provide implementation and review support; the user retains approval authority for production and irreversible actions.                     | Control active     | Human-and-AI operating protocol                                   |
| DEC-0010 | Repository changes use reviewable branches and pull requests before merge.                                                                            | Control active     | Existing repository workflow; PRs #454, #455, and #456            |
| DEC-0011 | The initial migration preserves user UUID relationships and does not rename stable internal identifiers solely for branding.                          | Recorded direction | Parent migration plan safety rules                                |
| DEC-0012 | The initial migration keeps the existing Stripe and eBay accounts but requires ListrAssistr-specific configuration and explicit integration review.   | Recorded direction | Parent migration plan                                             |
| DEC-0013 | The old backend remains recoverable and read-only for the approved post-launch retention period.                                                      | Recorded direction | Parent migration plan safety rules                                |

## Pending approvals and decisions

| ID        | Decision required                                                                                                    | Owner | Evidence required                                | Status  |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------ | ------- |
| PEND-0001 | Confirm whether Supabase project `wcednzaxmxwfiijzmjmx` is shared production infrastructure and identify its owners. | User  | Provider dashboard inventory                     | Pending |
| PEND-0002 | Approve the live service, secret-name, schema, and exception inventories.                                            | User  | Dashboard reconciliation and review notes        | Pending |
| PEND-0003 | Approve the ListrAssistr migration cohort and ambiguous/shared-resource classifications.                             | User  | Deterministic cohort query and ownership review  | Pending |
| PEND-0004 | Approve encrypted backup location, restore target, and retention period.                                             | User  | Backup and disposable restore evidence           | Pending |
| PEND-0005 | Approve changes, if any, to production deployment gates, JWT settings, CORS, and migration automation.               | User  | GitHub/Supabase configuration review             | Pending |
| PEND-0006 | Approve maintenance window, customer communication schedule, go/no-go meeting, and rollback deadline.                | User  | Cutover runbook and communication plan           | Pending |
| PEND-0007 | Approve Phase 0 exit and Phase 1 entry.                                                                              | User  | Resolved exceptions and completed exit checklist | Pending |

## Approval record

No production or irreversible approval is recorded in this file yet.

- **Phase 0 decision:** `Pending`
- **Approved by:** `TBD`
- **Approval date:** `TBD`
- **Notes:** Live provider inventory, baseline, backup/restore, cohort, and exception review remain outstanding.

## Corrective controls adopted after the RBR-0023 incident

| ID       | Decision                                                                                                                                                                                                                                          | Status         | Evidence / rationale                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DEC-0014 | Every SQL snippet capable of modifying schema or data must carry an environment guard that raises an exception unless the target project is confirmed by fingerprint. A prose warning about which project to use is not an acceptable substitute. | Control active | RBR-0023: a rehearsal script intended for the disposable project ran against shared production and dropped ten foreign keys        |
| DEC-0015 | DEC-0006 is clarified to cover schema as well as rows: no production schema object is created, altered, or dropped during Phase 0 discovery without explicit prior approval for that specific change.                                             | Control active | RBR-0023 breached DEC-0006 under a reading in which it governed only data                                                          |
| DEC-0016 | Read-only verification is preferred over inference when a Phase 0 finding depends on live state, and any finding derived from a query run after a known mutation must be re-verified before it is recorded.                                       | Control active | The retracted portion of RBR-0022 was inferred from a query run after the RBR-0023 drop and wrongly recorded as pre-existing drift |

## Scheduled-work decisions (2026-08-14)

| ID       | Decision                                                                                                                                                                                        | Status         | Evidence / rationale                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-0017 | `auto-reprice-cron` will not be scheduled. It remains available for manual or in-app invocation only.                                                                                           | Recorded       | Owner decision: unattended repricing alters live eBay listing prices. RBR-0025 established it has never been scheduled, so this ratifies the status quo                                                             |
| DEC-0018 | `competitor-prices-cron` will run **daily** once the token-refresh defect is fixed, not every 8 hours as its code comment suggests.                                                             | Recorded       | Owner decision. Daily also means no listing is ever inside the 8-hour cache TTL at run time, so each run performs one full refresh — simpler and cheaper than up to three partial runs per day. Blocked on RBR-0028 |
| DEC-0019 | The cost-alert and taxonomy-sync crons are repaired in this legacy repository before migration, using Vault-backed secrets so the same migration applies unchanged to the ListrAssistr project. | Recorded       | Owner decision to fix rather than port broken definitions forward. RBR-0025; migration `20260814000000_fix_cron_jobs_vault_secrets.sql`                                                                             |
| DEC-0020 | Spend-increasing scheduled work is enabled only after cost alerting is verified working.                                                                                                        | Control active | The Gemini spend guardrail was absent for roughly 145 days (RBR-0025) while `ebay-competitor-search` is the main Gemini consumer                                                                                    |

## API key strategy and cron authentication (2026-08-14)

| ID       | Decision                                                                                                                                                                         | Status         | Evidence / rationale                                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-0021 | The move from Supabase legacy JWT API keys to the newer sb_publishable_ / sb_secret_ format is deferred until the product is running in its new ListrAssistr state.              | Recorded       | Owner decision. 39 files under `supabase/functions` read `SUPABASE_SERVICE_ROLE_KEY`, and the change also touches `authGuard.ts`, the frontend env, GitHub Actions secrets, Vercel env vars and the cron definitions: substantial work in a repository being retired                |
| DEC-0022 | Database-scheduled (pg_cron) callers authenticate with a dedicated `CRON_SECRET`, set by the operator in both Edge Function secrets and Vault, rather than the service-role key. | Control active | RBR-0025: exact-match against `SUPABASE_SERVICE_ROLE_KEY` works between Edge Functions because both sides read the same variable, so it is never exercised; a pg_cron caller must supply the literal, and that value is opaque outside the runtime, making a mismatch undiagnosable |
| DEC-0023 | Rejected cron authentication logs a redacted diagnostic, lengths and booleans only, to the function log and never to the HTTP response.                                          | Control active | The RBR-0025 401s were debugged from outside the runtime across four wrong hypotheses; one log line would have identified the cause immediately                                                                                                                                     |
