# Phase 0 Implementation: Discovery, Launch Controls, and AI Model Assignment

**Product:** ListrAssistr  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Branch:** `rebrand/listrassistr`  
**Date opened:** 2026-08-10  
**Status:** In progress

## 1. Purpose

Phase 0 establishes the factual baseline, owners, controls, and decision record
needed before changing the brand, infrastructure, or customer data. It does not
perform the domain cutover, create the production Supabase project, migrate
customer data, or rotate provider credentials.

The output of this phase is a reviewed discovery packet that makes the later
phases executable without relying on undocumented assumptions.

## 2. Repository Transition Control

The target repository for the new ListrAssistr product is the private GitHub
repository [twinwicksllc/listrassistr-official](https://github.com/twinwicksllc/listrassistr-official).

Until cutover is explicitly approved:

- `twinwicksllc/listing-assistant-pro` remains the running current-version
  repository and must remain deployable.
- New ListrAssistr creation, migration tooling, brand work, infrastructure
  configuration, and launch artifacts belong in `listrassistr-official`.
- Do not replace, disable, or destructively rewrite the current repository as a
  shortcut for migration.
- Any code or document temporarily created in the current workspace must have a
  recorded destination and migration step before Phase 0 closes.
- Keep secrets, production exports, credentials, and private customer data out
  of both repositories; use approved secret and artifact storage instead.

The repository transfer itself is a controlled Phase 0/Phase 2 activity. Before
the first production-facing change, verify that the destination repository is
private, access-controlled, backed up, and connected to separate staging and
production deployment environments.

## 3. Phase 0 Exit Gate

Phase 0 is complete only when all of the following have an owner, evidence, and
review status:

- Current production and QA URLs, Vercel projects, Supabase projects, domains,
  webhooks, OAuth applications, cron jobs, and monitoring endpoints
- Secret-name inventory containing names and locations only, never secret values
- Live Supabase schema and infrastructure inventory, including objects not
  represented by repository migrations
- Product ownership classification for shared database, storage, and provider
  resources
- Baseline database row counts, user counts, and storage metrics
- Fresh encrypted backup and a tested restore path
- Deterministic ListrAssistr migration cohort definition and exception process
- Maintenance window, customer communication schedule, go/no-go meeting, and
  rollback decision deadline
- Named owner for every role in the migration plan
- Model assignment and escalation path for Phases 0 through 8

No production data is deleted or modified as part of this phase.

## 4. AI Model Assignment

These assignments use the model availability shown in VS Code on 2026-08-10.
Pricing and model limits can change, so confirm the current model picker and
workspace quota before beginning each phase.

| Phase                      | Primary model | Escalation / second review | Intended use                                                                    |
| -------------------------- | ------------- | -------------------------- | ------------------------------------------------------------------------------- |
| Phase 0 - Discovery        | GPT-5.4 mini  | Claude Haiku 4.5           | Inventory, planning, evidence tables, and documentation                         |
| Phase 1 - Brand Foundation | GPT-5.4 mini  | Gemini 3.5 Flash           | Copy, metadata, light design review, and multimodal asset checks                |
| Phase 2 - Repository Brand | GPT-5.5       | GPT-5.3-Codex              | Multi-file refactors, shared components, runtime string scan, and tests         |
| Phase 3 - Supabase Setup   | GPT-5.5       | Claude Sonnet 5            | Schema, SQL, RLS, migrations, secrets, and function deployment review           |
| Phase 4 - Data Migration   | GPT-5.5       | Claude Sonnet 5            | Rehearsal scripts, cohort logic, checksums, auth, storage, and reconciliation   |
| Phase 5 - Integrations     | GPT-5.4 mini  | Claude Haiku 4.5           | Provider configuration checklists, templates, smoke tests, and runbooks         |
| Phase 6 - CI/CD and DNS    | GPT-5.4 mini  | GPT-5.3-Codex              | YAML, Vercel, redirects, environment wiring, and deployment checks              |
| Phase 7 - Cutover          | GPT-5.5       | Claude Sonnet 5            | Real-time go/no-go support, migration validation, rollback, and incident triage |
| Phase 8 - Hypercare        | GPT-5.4 mini  | Claude Haiku 4.5           | Monitoring review, reconciliation reports, cleanup, and operational docs        |

### Model selection rules

1. Use the primary model for the normal workstream and preserve the full
   conversation context for that phase.
2. Use the escalation model for an independent review of high-risk output, not
   merely to rewrite the same answer.
3. Use GPT-5.3-Codex when the task is predominantly code or configuration and
   the change can be validated by tests, typechecking, or deployment checks.
4. Use GPT-5.5 for decisions combining code, data ownership, security, and
   operational continuity. It is the default for Phases 2, 3, 4, and 7.
5. Keep secrets, tokens, password hashes, customer plaintext exports, and
   private provider credentials out of model prompts and repository files.
6. Human owners retain approval authority for production access, legal decisions,
   destructive operations, migration go/no-go, and rollback.

### Human-and-AI operating protocol

The user is the operational owner for every phase. The AI model assigned to the
active phase is the user's implementation partner and guided technical operator.
The AI must assume that the user has limited coding and infrastructure
experience and should explain the reason, risk, and expected result before each
non-trivial action.

For every task, the AI should:

1. State the current objective and the smallest safe next step.
2. Inspect the repository or service context before proposing a change.
3. Identify exactly what it needs from the user, separating public values such
   as URLs, project IDs, and account names from secrets.
4. Walk the user through creating or changing settings in Vercel, Supabase,
   GitHub, Stripe, eBay, Resend, DNS, Sentry, or other provider dashboards.
5. Provide copyable commands or field-by-field instructions and explain where
   each value belongs.
6. Pause for the user's confirmation after account creation, permission
   changes, production access, destructive actions, or irreversible cutover
   steps.
7. Run the narrowest available validation immediately after each edit or
   configuration change, then report the result plainly.
8. Maintain the decision log, evidence references, unresolved questions, and
   rollback notes as work progresses.

### Secret and credential protocol

The AI may ask the user which secret names, providers, environments, or URLs are
required, but must never ask the user to paste secret values, tokens, password
hashes, service-role keys, webhook signing secrets, or private customer data
into chat, Markdown, source files, tickets, or model prompts. Instead, the AI
must:

- Explain how to generate or retrieve the credential from the official provider
  dashboard.
- Tell the user exactly where to enter it, such as a Vercel environment variable,
  Supabase secret, GitHub Actions secret, Stripe webhook configuration, or local
  terminal prompt.
- Use a placeholder or secret name in all repository artifacts.
- Ask the user to confirm only that the value was entered and, where possible,
  validate it through a safe health check that does not print the credential.
- Stop and request the user to enter sensitive input directly into their own
  terminal when a command prompts for it; the AI must not collect the value.

For authentication setup, the AI should walk through provider configuration,
redirect URLs, callback routes, email templates, allowed origins, and test-user
verification one screen or command at a time. It should distinguish staging
from production and never recommend unrestricted wildcard redirects or using
production credentials in automated tests.

## 5. Ownership and Approvals

The user is the single operational owner for all roles below. The AI model
assigned to the active phase performs the corresponding planning, research,
implementation guidance, documentation, and validation with the user's direct
approval. Specialist review models remain escalation reviewers rather than
independent production operators.

| Role                 | Operational owner | AI responsibility                                      |
| -------------------- | ----------------- | ------------------------------------------------------ |
| Launch lead          | User              | Schedule, decision log, go/no-go, rollback guidance    |
| Brand/design owner   | User              | Name, asset, and visual-system guidance                |
| Frontend owner       | User              | Runtime and metadata implementation guidance           |
| Backend owner        | User              | Supabase, functions, schema, and secret setup guidance |
| Data migration owner | User              | Cohort, backup, counts, and restore guidance           |
| Platform/DNS owner   | User              | Domain, Vercel, DNS, TLS, and monitoring walkthrough   |
| Integrations owner   | User              | eBay, Stripe, Resend, OAuth, AI, and Sentry guidance   |
| Security reviewer    | User              | Access, secret, RLS, backup, and rollback review       |
| QA owner             | User              | Test execution, acceptance evidence, and defect triage |
| Legal/support owner  | User              | Legal identity, notices, mailboxes, and support review |

The user's approval is required for production access, provider account changes,
secret creation, data exports, migration scope, legal copy, maintenance windows,
and go/no-go decisions. The AI must not infer approval from silence.

## 5. Repository Baseline

These findings were verified from the repository during Phase 0 initialization.
They are starting evidence, not a substitute for inspecting live services.

| Area                 | Current evidence                                                      | Phase 0 implication                                                               |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Package identity     | `package.json` name is `sovereign-listing-suite`                      | Record as an active brand surface for Phase 2                                     |
| Frontend stack       | React 18, TypeScript, Vite, Tailwind, Supabase client                 | Build and typecheck are available as baseline checks                              |
| Backend              | Supabase Edge Functions and PostgreSQL/RLS                            | Live project inventory must include functions and policies                        |
| Supabase link        | `supabase/config.toml` points to `wcednzaxmxwfiijzmjmx`               | Confirm whether this is shared production infrastructure                          |
| Function auth        | Listed functions currently have `verify_jwt = false`                  | Security review must classify each function and CORS behavior                     |
| Vercel routing       | `vercel.json` rewrites all paths to `/index.html`                     | Host redirects must be designed before SPA rewrites are changed                   |
| Environment contract | `.env.example` contains Supabase URL, project ID, and publishable key | Inventory all additional variables used by functions and workflows                |
| CI/CD                | Six workflows exist under `.github/workflows`                         | Record environments, secrets, triggers, and production approvals                  |
| Application identity | README and current documentation use legacy product/domain references | Scan active runtime, docs, tests, and deployment metadata separately              |
| AI provider          | README identifies Google Gemini as the current analysis provider      | Inventory Gemini keys, quotas, models, and usage tracking without exposing values |
| Integrations         | eBay, Stripe, Supabase Auth, Resend, Sentry, and AI are in scope      | Each needs an owner, endpoint inventory, and rollback note                        |

## 6. Discovery Work Plan

### 6.1 Launch controls

- Create the launch decision log and record the target maintenance window.
- Record named owners in Section 4.
- Establish an approved location for encrypted exports and backups.
- Define the incident channel, status-page owner, and rollback authority.
- Record the final decision deadline for rollback during cutover.

### 6.2 Endpoint and service inventory

Capture current values in a restricted launch artifact. This repository document
must contain names and references, not credentials or customer data.

| Inventory        | Required fields                                                          | Evidence source                                   |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Domains and URLs | Host, purpose, environment, owner, redirect/TLS status                   | Vercel, DNS provider, browser smoke check         |
| Vercel           | Project, team, domains, environment variables by name, deployment branch | Vercel project settings and deployment history    |
| Supabase         | Project ref, region, plan, database, Auth, Storage, functions, cron      | Supabase dashboard and CLI                        |
| GitHub           | Workflow, trigger, environment, secret/variable names, approval rule     | `.github/workflows` and repository settings       |
| Stripe           | Account, products, prices, webhooks, events, return URLs                 | Stripe dashboard and function configuration       |
| eBay             | App, environment, client, RuName, OAuth URLs, API scopes                 | eBay developer console and function configuration |
| Auth providers   | Site URL, allowed redirects, provider credentials, email templates       | Supabase Auth settings                            |
| Email            | Sending domains, SPF, DKIM, DMARC, sender identities, mailbox owners     | Resend and DNS                                    |
| AI providers     | Provider, model, secret name, quota, environment, usage table            | Supabase secrets, function code, provider console |
| Monitoring       | Sentry project/environment, uptime checks, alert routing                 | Sentry and monitoring provider                    |
| Scheduled work   | Job, schedule, function, credentials, pause/restart method               | Supabase cron, GitHub, Vercel, provider consoles  |

### 6.3 Live Supabase inventory

The backend owner and security reviewer must inspect the live project rather than
assuming repository migrations are complete. Record:

- Schemas, tables, views, materialized views, sequences, indexes, constraints,
  triggers, functions, extensions, publications, and replication settings
- RLS enablement, policies, grants, roles, and service-role-only operations
- Auth users, identities, configuration, templates, providers, and redirect URLs
- Storage buckets, policies, object counts, total bytes, and public/private state
- Edge Functions, deployed versions, JWT settings, secrets by name, and CORS
- Cron jobs, vault/network configuration, webhooks, and logging/retention
- Objects present in production but absent from migrations, with ownership status

Any unexplained live object is a Phase 0 exception and blocks the Phase 0 exit
gate until reviewed.

### 6.4 Ownership classification

Classify each resource as:

- **ListrAssistr-only:** migrate or recreate in the new product project.
- **Other-product-only:** do not migrate; retain under its current owner.
- **Shared:** document the dependency and create an explicit split plan.
- **Ambiguous:** blocked until both product owners approve ownership.

Apply this classification to users, organizations, tables, storage objects,
functions, cron jobs, provider accounts, billing objects, OAuth applications,
email domains, monitoring projects, and secrets.

### 6.5 Baselines and backup evidence

Before any migration rehearsal, record:

- Auth user count and approved product cohort count
- Row counts and primary-key checksums for every product table
- Organization/member/invitation counts and ownership exceptions
- Storage object count, bytes, paths, MIME types, and checksums by bucket
- Function/deployment inventory and current error/latency baseline
- Stripe subscription/customer relationship counts
- eBay token and connection metadata counts, without exporting token values

Create an encrypted database backup and storage manifest. Perform a restore test
against a disposable project and record the result, duration, checksum results,
and unresolved exceptions.

## 7. Suggested Evidence Artifacts

Create these restricted or version-controlled artifacts as appropriate:

- `phase-0-decision-log.md` - decisions, owners, timestamps, and approvals
- `phase-0-service-inventory.md` - endpoints and resource names, no secrets
- `phase-0-secret-inventory.md` - secret names, source, owner, rotation status;
  never values
- `phase-0-schema-inventory.md` - live objects, migration coverage, ownership
- `phase-0-baseline.csv` - counts and checksums, stored securely if customer data
  could be inferred
- `phase-0-restore-report.md` - backup and restore rehearsal evidence
- `phase-0-cohort-definition.sql` - deterministic selection query after review
- `phase-0-exception-log.md` - unresolved items, impact, owner, due date

Keep artifacts containing production topology, counts, customer-derived data, or
secret names in the approved restricted location unless the team explicitly
approves repository storage. Never commit secret values, tokens, plaintext user
exports, password hashes, or private listing content.

## 8. Repository Checks

Run these checks from the repository root and attach results to the Phase 0
packet. These are discovery/baseline checks; they do not prove production safety.

```bash
npm run lint
npm run test
npm run build
npm run format:check
```

Also perform targeted searches for legacy runtime and infrastructure references.
Use an approved exclusion list for historical documentation, product data terms
such as "gold sovereign," migrations, and archives.

```bash
rg -n -i "sovereign listing suite|listing assistant|teckstart|sls\\.|sovereign ai" \
  src public index.html vite.config.ts package.json supabase .github e2e README.md
rg -n "SUPABASE|APP_URL|EBAY_|STRIPE|RESEND|GEMINI|OPENAI|SENTRY|QA_BASE_URL" \
  src supabase .github scripts e2e .env.example
```

Record failures as baseline findings. Do not broaden Phase 0 into brand edits;
those belong to Phase 1 and Phase 2.

## 9. Risks and Controls

| Risk                                          | Control                                                                 | Owner                |
| --------------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| Shared Supabase data is misclassified         | Live inventory, deterministic cohort, dual-owner approval               | Data migration owner |
| A secret is exposed during discovery          | Names-only inventory, restricted storage, no model prompts with values  | Security reviewer    |
| Production is changed accidentally            | Read-only discovery, separate staging project, explicit approvals       | Launch lead          |
| Backup cannot be restored                     | Disposable-project restore rehearsal before migration                   | Backend owner        |
| Legacy runtime references are missed          | Scoped scan plus manual review of generated metadata and workflows      | Frontend owner       |
| Model output is accepted without verification | Independent escalation review and executable checks                     | QA owner             |
| Cutover cannot be reversed in time            | Timed rehearsal, write freeze, rollback deadline, old backend read-only | Launch lead          |

## 10. Phase 0 Completion Record

Complete this section during the phase review.

- [ ] Owners assigned and launch decision log created
- [ ] Service and endpoint inventory approved
- [ ] Secret-name inventory approved
- [ ] Live Supabase inventory completed
- [ ] Shared-resource ownership classification approved
- [ ] Baseline counts and checksums captured
- [ ] Encrypted backup created and restore tested
- [ ] Migration cohort approach reviewed
- [ ] Maintenance window and rollback deadline approved
- [ ] Repository baseline checks recorded
- [ ] Phase 0 exceptions resolved or explicitly accepted by launch lead
- [ ] Phase 1 entry criteria approved

**Phase 0 decision:** `Pending`  
**Reviewed by:** `TBD`  
**Review date:** `TBD`
