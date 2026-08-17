# Rebrand Phase 0 Ownership Classification (P0-06)

**Product:** ListrAssistr
**Source repository:** `twinwicksllc/listing-assistant-pro`
**Discovery date:** 2026-08-17
**Status:** Two of three open questions resolved by owner 2026-08-17 (Stripe
account relationship, CRM Edge Functions). One item remains — the
`subscriptions`/`usage_tracking`/`gemini_usage` reclassification, pending a
read-only confirmation query at the end of this document. Table/storage
classification below restates already-evidenced findings from
`REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`; functions, cron, provider
accounts, billing, OAuth, email domains, monitoring, and secrets are classified
here for the first time as a dedicated P0-06 pass.

## Purpose and rule

Per `REBRAND_PHASE_0_IMPLEMENTATION.md` §6.4, every shared-infrastructure resource
must be classified as one of:

- **ListrAssistr-only** — migrate or recreate in the new product project.
- **Other-product-only (CRM-only)** — do not migrate; retain under its current owner.
- **Shared** — document the dependency and create an explicit split plan.
- **Ambiguous** — blocked until both product owners approve ownership.
- **System-managed** — platform-owned resources that can’t be split per-product (record current state; plan replacements in the new project as needed).

This is a planning classification, not authorization to export, modify, or delete
anything. No production change is implied by this document.

## Users, organizations, and tables

Already classified at object-name/RLS-metadata level in
`REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md` — see that document for the full
per-object tables. Summary:

- **ListrAssistr-only:** `drafts`, `ebay_tokens`, taxonomy/cache tables,
  market/reprice tables, `listing_cogs`/`listing_financials`, `listing-images` bucket.
- **CRM-only:** `accounts`, `contacts`, `deals`, `campaigns`, `commissions`,
  `tenants`, and ~40 other CRM-named tables (full list in the reconciliation doc).
- **Shared/ambiguous:** `profiles`/`users` (except the owner/admin account, which
  is confirmed shared per `REBRAND_PHASE_0_SERVICE_INVENTORY.md`), `organizations`/
  `org_members`/`org_invitations`, `knowledge_base`, support/analytics tables.
  **Clarified by the owner 2026-08-17:** ListrAssistr/listing-app user identity
  lives entirely in `profiles`; `profiles` is not ambiguous as a table, only the
  handful of specific rows the owner's own account and QA/test accounts occupy
  are (resolved for cohort purposes under DEC-0029/P0-13). Any separate `users`
  table is CRM's own and out of scope here.
- **Refinement proposed here:** `subscriptions`, `usage_tracking`, `gemini_usage`
  were classified "shared/ambiguous" on 2026-08-10 out of caution. Since then,
  the live export has confirmed CRM maintains its **own** separate billing surface
  (`crm_subscriptions`, `crm_billing_events`, `crm_billing_...`) — evidence CRM
  never used this app's `subscriptions` table. Proposing **ListrAssistr-only**
  for these three, pending a quick confirmation query (do all `subscriptions.user_id`
  values resolve to a listing-app profile, none to a CRM-only account?) before
  this is finalized rather than just renamed.
- **System-managed:** `auth.*`, `cron.*`, `storage.*` internals, `vault.*`, unchanged.

## Storage buckets

| Bucket           | Classification    | Evidence                                                                                       |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `listing-images` | ListrAssistr-only | Repository-backed; 4,735 objects/1,274 MB (RBR-0026)                                           |
| `avatars`        | Shared            | Repository-backed but used by whichever product's user uploads one; owner mapping not yet done |
| `client-uploads` | CRM-only          | Empty; CRM/client-site surface, not in listing migrations                                      |

## Edge Functions (Supabase, this repository)

**ListrAssistr-only — confirmed by owner 2026-08-17.** All 36 deployed
functions under `supabase/functions/` are this repository's own code
(confirmed count matches dashboard, P0-02). The owner confirmed the CRM does
not deploy any Edge Functions of its own into this shared Supabase project —
the "shared secret surface" question below is therefore bounded to whatever
non-Edge-Function process reads project-level secrets, not a second set of
functions.

## Cron jobs

**ListrAssistr-only — high confidence.** `cron.job` was inventoried directly
(P0-09): exactly two jobs are defined in the shared project, `cost-alert-cron`
and the taxonomy sync, both calling this repository's functions. No CRM cron job
was found. `auto-reprice-cron` and `competitor-prices-cron` exist in this
repository's code but are deliberately unscheduled (DEC-0017, RBR-0028) — still
ListrAssistr-owned, just not active `cron.job` rows today.

## Provider accounts

| Account                                                                | Classification                             | Evidence                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub repo `twinwicksllc/listing-assistant-pro`                       | ListrAssistr-only                          | This is the source repository itself                                                                                                                                                                                                                                                             |
| Vercel project `tom-fenwicks-projects/listing-assistant-pro`           | ListrAssistr-only                          | P0-01, dedicated project confirmed 2026-08-14                                                                                                                                                                                                                                                    |
| Supabase project `wcednzaxmxwfiijzmjmx` (RankedCEO-CRM)                | **Shared**                                 | PEND-0001 approved 2026-08-14; the top-level shared infrastructure this whole classification exists to untangle                                                                                                                                                                                  |
| Supabase Auth instance (single instance on the shared project)         | **Shared (system-managed)**                | One Auth instance per project; Site URL is currently configured for `crm.rankedceo.com`, not the listing app's domain (service inventory, 2026-08-10) — a migration-relevant fact, not new ambiguity                                                                                             |
| Google OAuth provider config (registered in that shared Auth instance) | **Shared (system-managed)**                | Same reasoning as Auth instance — one provider config serves login for users of either product                                                                                                                                                                                                   |
| eBay production app                                                    | ListrAssistr-only                          | Confirmed production app, 500+ live listings (P0-03)                                                                                                                                                                                                                                             |
| Stripe account                                                         | **Shared — confirmed by owner 2026-08-17** | Owner confirms this is one Stripe account shared with the CRM. Owner intends to set up a new, dedicated Stripe account for ListrAssistr rather than split the shared one; a guided step-by-step review of the current account is planned as a separate follow-up, not part of closing this gate. |
| Resend account                                                         | **Shared**                                 | RBR-0031: same login as the CRM owner; only `rankedceo.com` is verified there                                                                                                                                                                                                                    |
| Sentry                                                                 | Not applicable                             | Confirmed no account exists anywhere (RBR-0032)                                                                                                                                                                                                                                                  |

## Billing objects

- `subscriptions` (this app's table) — proposed **ListrAssistr-only**, see the
  refinement note above; pending the confirmation query below.
- `crm_subscriptions`, `crm_billing_events` — **CRM-only**, per
  `REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`.
- The underlying Stripe **account** is confirmed **Shared** (owner, 2026-08-17)
  regardless of which table's rows point at it — this app's `subscriptions`
  table can still be its own product-scoped table while drawing on a Stripe
  account the CRM also uses. The owner intends to split onto a dedicated
  ListrAssistr Stripe account rather than divide the shared one.

## OAuth applications

- eBay OAuth app — ListrAssistr-only (this app's own RuName/redirect URI).
- Google OAuth (Supabase Auth) — Shared, see provider accounts above.

## Email domains

| Domain             | Classification                             | Evidence                                                                                                                                     |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `rankedceo.com`    | CRM-only (borrowed for one internal alert) | RBR-0031/DEC-0024: CRM's verified Resend domain; this app's cost-alert now sends from it as an accepted workaround, not a claim of ownership |
| `teckstart.com`    | ListrAssistr-only (legacy branding)        | Current production domain `lister.teckstart.com`                                                                                             |
| `listrassistr.com` | ListrAssistr-only (future)                 | Already configured as the new staging project's Auth Site URL                                                                                |

## Monitoring projects

None exist. Not applicable to this classification — DEC-0025 already decided
real error tracking is built fresh for ListrAssistr rather than ported forward.

## Secrets

Classifying by pattern rather than repeating all ~20 names from
`REBRAND_PHASE_0_SECRET_INVENTORY.md` individually:

- **GitHub Actions repository secrets** (`SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`,
  `EBAY_SANDBOX_API_KEY`, etc.) — **ListrAssistr-only**. These live in this
  repository's own GitHub Actions secret store, not shared with a separate CRM
  repository (no evidence CRM code lives in or deploys from this repo).
- **Supabase Edge Function secrets whose semantic owner is this app**
  (`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/etc., `GEMINI_API_KEY`, `CRON_SECRET`)
  — **ListrAssistr-only** in ownership/purpose. Confirmed no CRM Edge Function
  exists in this project to read them, but they remain stored at the shared
  project level (system-managed storage, product-owned value).
- **`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`** — **Shared**, since the
  underlying Stripe account itself is now confirmed shared with the CRM
  (2026-08-17); these become ListrAssistr-only once the planned dedicated
  Stripe account exists and this app's functions point at its keys instead.
- **`RESEND_API_KEY`** — **Shared**, since the account itself is shared (RBR-0031).
- **`SUPABASE_SERVICE_ROLE_KEY`** — **Shared (system-managed)**. This is the
  master key for the entire shared project; it is not a per-product secret by
  construction. The new ListrAssistr Supabase project will mint its own.
- **`SENTRY_DSN`** — Not applicable, no account exists.

## Open questions for the owner — resolved 2026-08-17

1. **Stripe account relationship — resolved.** Confirmed shared with the CRM.
   Owner intends to set up a new, dedicated Stripe account for ListrAssistr
   rather than split the shared one. A guided step-by-step review of the
   current shared account is planned as a separate follow-up task, not part
   of closing this gate.
2. **CRM Edge Functions — resolved.** Confirmed the CRM does not deploy any
   Edge Functions into this shared Supabase project.
3. **`subscriptions`/`usage_tracking`/`gemini_usage` refinement — pending one
   query.** Owner believes these are ListrAssistr-only. Confirmation query
   below; not yet run.

## Confirmation query for item 3 (read-only, counts only — safe to run as-is)

Run in the Supabase SQL Editor against the production project, with **No
limit** selected on the result count. Returns table name, total row count,
and how many rows reference a `user_id` that has zero footprint in the two
tables already confirmed listing-app-only (`drafts`, `org_members`) — no user
IDs, emails, or other row content are returned, only counts:

```sql
select
  'subscriptions' as table_name,
  count(*) as total_rows,
  count(*) filter (
    where user_id not in (select user_id from drafts where user_id is not null)
      and user_id not in (select user_id from org_members where user_id is not null)
  ) as rows_with_no_listing_app_footprint
from subscriptions
union all
select
  'usage_tracking',
  count(*),
  count(*) filter (
    where user_id not in (select user_id from drafts where user_id is not null)
      and user_id not in (select user_id from org_members where user_id is not null)
  )
from usage_tracking
union all
select
  'gemini_usage',
  count(*),
  count(*) filter (
    where user_id not in (select user_id from drafts where user_id is not null)
      and user_id not in (select user_id from org_members where user_id is not null)
  )
from gemini_usage;
```

**Reading the result:** if `rows_with_no_listing_app_footprint` is `0` for a
table, every user with a row there is also a confirmed listing-app user (has
created a draft or belongs to an org), which is strong support for
ListrAssistr-only. A nonzero count doesn't necessarily mean those rows are
CRM-owned — it could just be a listing-app signup who never created a draft
yet — it means those specific rows need a manual look before this
classification is finalized. Report back the three counts (not the IDs); if
any query errors on a missing `user_id` column, tell me the actual column
name shown in the error and I'll adjust the query.

Everything else in this document is a confident classification from existing
evidence and needs only a read-through, not new discovery, to approve.
