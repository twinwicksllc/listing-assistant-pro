# Rebrand Phase 0 Closure Checklist

**Product:** ListrAssistr  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Owner:** User  
**Status:** Open; use this checklist to prepare Phase 0 exit approval

## How to use this checklist

Phase 0 closes only when every required item has an owner, evidence location,
review status, and explicit approval where indicated. This checklist is a
control record, not permission to access or modify production. Keep secret
values, customer data, tokens, password material, and unrestricted exports out
of the repository.

Statuses: `Not started`, `In progress`, `Evidence captured`, `Reviewed`,
`Approved`, or `Blocked`.

## Exit-gate checklist

| ID    | Required item                                                    | Owner                    | Evidence to capture                                                                | Status                                                                                                                                                                               | Approval                          |
| ----- | ---------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| P0-01 | Current production and QA URLs, domains, and deployment projects | User                     | Provider names, URLs, environment, owner, status                                   | In progress                                                                                                                                                                          | User review                       |
| P0-02 | Supabase project and infrastructure inventory                    | User                     | Project refs, region, schemas, functions, Auth, Storage, cron, webhooks            | In progress                                                                                                                                                                          | User review                       |
| P0-03 | Provider and endpoint inventory                                  | User                     | Vercel, DNS, Stripe, eBay, OAuth, Resend, AI, Sentry, monitoring, webhook names    | In progress                                                                                                                                                                          | User review                       |
| P0-04 | Secret-name inventory                                            | User                     | Secret names, provider locations, environment, owner; never values                 | Evidence captured in `REBRAND_PHASE_0_SECRET_INVENTORY.md`                                                                                                                           | User review                       |
| P0-05 | Live schema reconciliation                                       | User + AI                | Object definitions, migration comparison, live-only objects, dependencies          | Object classification captured; definitions pending                                                                                                                                  | User review                       |
| P0-06 | Ownership classification                                         | User                     | Listing-only, CRM-only, shared, ambiguous, system-managed decisions                | In progress                                                                                                                                                                          | Explicit scope approval           |
| P0-07 | RLS and grants review                                            | User + security reviewer | Exact policy expressions, grants, roles, anon/authenticated/service-role tests     | In progress — listing-app/shared tables done (RBR-0015 resolved, PR #464 merged and deployed); CRM-side families, public-intake policies, and `client-uploads` storage still pending | Security approval                 |
| P0-08 | Storage reconciliation                                           | User                     | Bucket policies, object counts, bytes, manifest/checksums, linkage, retention      | In progress                                                                                                                                                                          | Media-scope approval              |
| P0-09 | Cron and scheduled work                                          | User                     | Job name, schedule, command/function, enabled state, owner, recent run status      | Not started                                                                                                                                                                          | Operations approval               |
| P0-10 | Database and Auth baseline                                       | User                     | Table counts, approved row counts, Auth user count, organizations, subscriptions   | Not started                                                                                                                                                                          | Data-owner review                 |
| P0-11 | Encrypted backup                                                 | User                     | Backup identifier, timestamp, encryption/storage location, retention, access owner | Not started                                                                                                                                                                          | Data-owner approval               |
| P0-12 | Restore rehearsal                                                | User + QA owner          | Disposable target, restore result, validation queries, defects, cleanup            | Not started                                                                                                                                                                          | Data-owner and QA approval        |
| P0-13 | Deterministic migration cohort                                   | User + data owner        | User/org/listing/media selection logic, exclusions, exception process              | Not started                                                                                                                                                                          | Explicit migration-scope approval |
| P0-14 | Maintenance and communication plan                               | User + support owner     | Window, notice schedule, support contact, freeze rules, customer impact            | Not started                                                                                                                                                                          | Launch-lead approval              |
| P0-15 | Rollback plan                                                    | User + platform owner    | Rollback trigger, decision deadline, owner, restore path, DNS/provider reversal    | Not started                                                                                                                                                                          | Go/no-go approval                 |
| P0-16 | Named role owners                                                | User                     | Launch, backend, data, platform, integrations, security, QA, support               | Owner assignment documented; confirmation pending                                                                                                                                    | User approval                     |
| P0-17 | Exception disposition                                            | User + AI                | Open/accepted/resolved status, evidence, owner, due date                           | In progress                                                                                                                                                                          | High-risk approval                |
| P0-18 | Phase 1 entry decision                                           | User                     | Signed decision record, date, scope, conditions, unresolved accepted risks         | Not started                                                                                                                                                                          | Explicit go/no-go                 |

## Current evidence map

- [REBRAND_PHASE_0_IMPLEMENTATION.md](REBRAND_PHASE_0_IMPLEMENTATION.md) defines the exit gates and approval protocol.
- [REBRAND_PHASE_0_SERVICE_INVENTORY.md](REBRAND_PHASE_0_SERVICE_INVENTORY.md) contains repository and initial live provider findings.
- [REBRAND_PHASE_0_SECRET_INVENTORY.md](REBRAND_PHASE_0_SECRET_INVENTORY.md) contains secret names and locations without values.
- [REBRAND_PHASE_0_SCHEMA_INVENTORY.md](REBRAND_PHASE_0_SCHEMA_INVENTORY.md) contains repository schema groups and the live summary.
- [REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md](REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md) contains the live object-level classification and unresolved RLS, storage, and cron work.
- [REBRAND_PHASE_0_EXCEPTION_LOG.md](REBRAND_PHASE_0_EXCEPTION_LOG.md) records open migration, ownership, security, storage, and operational exceptions.
- [REBRAND_PHASE_0_DECISION_LOG.md](REBRAND_PHASE_0_DECISION_LOG.md) records decisions and approvals already made.

## Minimum evidence package before closure

Phase 0 should not be marked complete until the following restricted evidence
package exists outside the repository where appropriate:

1. Provider inventory and secret-name inventory reviewed by the owner.
2. Exact live schema/RLS/grant export reconciled with the target migrations.
3. Database, Auth, organization, subscription, and storage baselines.
4. Encrypted backup with a successful disposable restore rehearsal.
5. Deterministic cohort query or equivalent reproducible selection procedure.
6. Maintenance, communication, rollback, and go/no-go records.
7. Exception log with every high-impact item resolved or explicitly accepted.

The schema reconciliation branch and PR #460 may close the documentation task,
but they do not by themselves close Phase 0.
