# Rebrand Phase 0 Ownership Classification (P0-06)

**Product:** ListrAssistr
**Source repository:** `twinwicksllc/listing-assistant-pro`
**Discovery date:** 2026-08-17
**Status:** Draft for owner confirmation. Table/storage classification below restates
already-evidenced findings from `REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`;
functions, cron, provider accounts, billing, OAuth, email domains, monitoring, and
secrets are classified here for the first time as a dedicated P0-06 pass.

## Purpose and rule

Per `REBRAND_PHASE_0_IMPLEMENTATION.md` §6.4, every shared-infrastructure resource
must be classified as one of:

- **ListrAssistr-only** — migrate or recreate in the new product project.
- **Other-product-only (CRM-only)** — do not migrate; retain under its current owner.
- **Shared** — document the dependency and create an explicit split plan.
- **Ambiguous** — blocked until both product owners approve ownership.

This is a planning classification, not authorization to export, modify, or delete
anything. No production change is implied by this document.

## Users, organizations, and tables

Already classified at object-name/RLS-metadata level in
`REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md` — see that document for the full
per-object tables. Summary:

- **ListrAssistr candidates:** `drafts`, `ebay_tokens`, taxonomy/cache tables,
  market/reprice tables, `listing_cogs`/`listing_financials`, `listing-images` bucket.
- **CRM-only:** `accounts`, `contacts`, `deals`, `campaigns`, `commissions`,
  `tenants`, and ~40 other CRM-named tables (full list in the reconciliation doc).
- **Shared/ambiguous:** `profiles`/`users` (except the owner/admin account, which
  is confirmed shared per `REBRAND_PHASE_0_SERVICE_INVENTORY.md`), `organizations`/
  `org_members`/`org_invitations`, `knowledge_base`, support/analytics tables.
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
| `avatars`        | Shared/identity   | Repository-backed but used by whichever product's user uploads one; owner mapping not yet done |
| `client-uploads` | CRM-only          | Empty; CRM/client-site surface, not in listing migrations                                      |

## Edge Functions (Supabase, this repository)

**ListrAssistr-only — high confidence.** All 36 deployed functions under
`supabase/functions/` are this repository's own code (confirmed count matches
dashboard, P0-02). No evidence any CRM-owned function is deployed from this
repository. **Open question for the owner:** does the CRM's backend deploy its
_own_ Edge Functions into this same shared Supabase project
(`wcednzaxmxwfiijzmjmx`)? If yes, project-level secrets (see below) are a wider
shared surface than "this repo's functions" even though the functions themselves
remain unambiguously this product's code — worth knowing before Phase 1 secret
rotation planning.

## Cron jobs

**ListrAssistr-only — high confidence.** `cron.job` was inventoried directly
(P0-09): exactly two jobs are defined in the shared project, `cost-alert-cron`
and the taxonomy sync, both calling this repository's functions. No CRM cron job
was found. `auto-reprice-cron` and `competitor-prices-cron` exist in this
repository's code but are deliberately unscheduled (DEC-0017, RBR-0028) — still
ListrAssistr-owned, just not active `cron.job` rows today.

## Provider accounts

| Account                                                                | Classification                           | Evidence                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo `twinwicksllc/listing-assistant-pro`                       | ListrAssistr-only                        | This is the source repository itself                                                                                                                                                                                       |
| Vercel project `tom-fenwicks-projects/listing-assistant-pro`           | ListrAssistr-only                        | P0-01, dedicated project confirmed 2026-08-14                                                                                                                                                                              |
| Supabase project `wcednzaxmxwfiijzmjmx` (RankedCEO-CRM)                | **Shared**                               | PEND-0001 approved 2026-08-14; the top-level shared infrastructure this whole classification exists to untangle                                                                                                            |
| Supabase Auth instance (single instance on the shared project)         | **Shared (system-managed)**              | One Auth instance per project; Site URL is currently configured for `crm.rankedceo.com`, not the listing app's domain (service inventory, 2026-08-10) — a migration-relevant fact, not new ambiguity                       |
| Google OAuth provider config (registered in that shared Auth instance) | **Shared (system-managed)**              | Same reasoning as Auth instance — one provider config serves login for users of either product                                                                                                                             |
| eBay production app                                                    | ListrAssistr-only                        | Confirmed production app, 500+ live listings (P0-03)                                                                                                                                                                       |
| Stripe account                                                         | **Ambiguous — needs owner confirmation** | Confirmed live-mode and this app's webhook/checkout flow, but CRM has its own separate billing tables (`crm_subscriptions`, `crm_billing_events`) of unconfirmed relationship to this Stripe account. Open question below. |
| Resend account                                                         | **Shared**                               | RBR-0031: same login as the CRM owner; only `rankedceo.com` is verified there                                                                                                                                              |
| Sentry                                                                 | Not applicable                           | Confirmed no account exists anywhere (RBR-0032)                                                                                                                                                                            |

## Billing objects

- `subscriptions` (this app's table) — proposed **ListrAssistr-only**, see the
  refinement note above.
- `crm_subscriptions`, `crm_billing_events` — **CRM-only**, per
  `REBRAND_PHASE_0_LIVE_SCHEMA_RECONCILIATION.md`.
- The underlying Stripe **account** relationship between the two is the open
  question above — table-level classification doesn't resolve whether they're
  drawing on the same Stripe account or two different ones.

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
  (`EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/etc., `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `CRON_SECRET`) — **ListrAssistr-only**
  in ownership/purpose, but technically stored at the shared project level, so
  physically readable by any function deployed in that project (see the Edge
  Functions open question above).
- **`RESEND_API_KEY`** — **Shared**, since the account itself is shared (RBR-0031).
- **`SUPABASE_SERVICE_ROLE_KEY`** — **Shared (system-managed)**. This is the
  master key for the entire shared project; it is not a per-product secret by
  construction. The new ListrAssistr Supabase project will mint its own.
- **`SENTRY_DSN`** — Not applicable, no account exists.

## Open questions for the owner (only items this document could not resolve from existing evidence)

1. **Stripe account relationship.** Is the Stripe account behind
   `STRIPE_SECRET_KEY` (this app's checkout/webhook) the same Stripe account
   the CRM's `crm_subscriptions`/`crm_billing_events` draw on, or a fully
   separate Stripe account? This determines whether Stripe is "Shared" or
   "ListrAssistr-only" above.
2. **CRM Edge Functions.** Does the CRM's own backend deploy any Edge Functions
   into this same Supabase project (`wcednzaxmxwfiijzmjmx`), alongside this
   repository's 36? (Affects how wide the "shared secret surface" really is,
   not the ownership of this repo's own functions, which is already clear.)
3. **`subscriptions`/`usage_tracking`/`gemini_usage` refinement.** Confirm the
   proposed upgrade from "shared/ambiguous" to "ListrAssistr-only" — ideally
   with one read-only query confirming every `subscriptions.user_id` resolves
   to a listing-app profile.

Everything else in this document is a confident classification from existing
evidence and needs only a read-through, not new discovery, to approve.
