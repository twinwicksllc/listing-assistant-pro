# ListrAssistr Rebrand and Product Migration Plan

## 1. Purpose

This runbook covers the complete transition from the current Sovereign Listing
Suite / Listing Assistant identity and shared infrastructure to the public
ListrAssistr product at `listrassistr.com`.

It is intended to be executable by the engineering, design, operations, legal,
and support teams without requiring the product owner to direct each step.

The work includes:

- Brand identity, visual system, copy, legal pages, and product metadata
- Public domain, DNS, redirects, TLS, email authentication, and monitoring
- Vercel production and preview environments
- A new, product-specific Supabase project
- Selective migration of listing-product users, data, storage, and credentials
- Supabase Auth, Stripe, eBay OAuth, Resend, AI providers, and CI/CD
- Cutover, rollback, post-launch observation, and old-system cleanup

## 2. Approved Decisions

| Decision                | Approved direction                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Product name            | **ListrAssistr**                                                                                                                      |
| Primary domain          | **listrassistr.com**                                                                                                                  |
| Primary application URL | **https://app.listrassistr.com**                                                                                                      |
| Marketing URL           | **https://listrassistr.com**                                                                                                          |
| Legal owner             | **Twin Wicks Digital Solutions**                                                                                                      |
| Backend                 | New, ListrAssistr-only Supabase project                                                                                               |
| Users to migrate        | Users demonstrably associated with listing-product data                                                                               |
| Stripe                  | Keep the existing Stripe account initially; create ListrAssistr-specific products, prices, portal configuration, and webhook endpoint |
| eBay                    | Keep the existing eBay developer account initially; add ListrAssistr URLs and branding                                                |
| Availability            | Brief scheduled maintenance window for final migration and cutover                                                                    |
| Old hostname            | Permanently redirect `lister.teckstart.com` and any other confirmed legacy app hostname to `app.listrassistr.com`                     |
| Domain status           | Not registered at planning time; registration is launch gate 1                                                                        |

## 3. Non-Negotiable Safety Rules

1. Do not delete data or functions from the shared Supabase project during the
   initial launch.
2. Preserve migrated users' UUIDs. Product tables reference `auth.users.id`, so
   changing IDs would break ownership, RLS, team membership, subscriptions, and
   storage relationships.
3. Do not point the production domain at the new stack until auth, row counts,
   storage objects, Edge Functions, Stripe webhooks, and eBay OAuth pass the
   production-readiness gate.
4. Do not rename stable database IDs, storage bucket IDs, browser storage keys,
   or API action names solely for branding. Public display names should change;
   internal compatibility identifiers should remain unless a separate migration
   is justified.
5. Never copy secrets into source control, tickets, chat, or this document.
6. Use a rehearsal against disposable projects before the production migration.
7. Keep the old backend read-only and recoverable for at least 30 days after
   launch. Keep encrypted backups for the retention period approved by legal.
8. A permanent domain redirect does not migrate browser cookies or localStorage.
   Users should expect to sign in again on the new domain. Server-side eBay
   credentials must be migrated so users do not need to reconnect unnecessarily.

## 4. Roles and Ownership

Assign one named person to every role before implementation begins. One person
may fill multiple roles, but no task should have an implicit owner.

| Role                 | Responsibilities                                                            |
| -------------------- | --------------------------------------------------------------------------- |
| Launch lead          | Owns schedule, decision log, go/no-go meeting, and rollback authority       |
| Brand/design owner   | Logo system, color tokens, typography, screenshots, brand QA                |
| Frontend owner       | Runtime brand constants, UI, PWA, metadata, legal copy integration          |
| Backend owner        | New Supabase project, schema, functions, secrets, CORS, scheduled jobs      |
| Data migration owner | User cohort, exports/imports, checksums, rehearsal, final delta             |
| Platform/DNS owner   | Domain registration, Vercel, DNS, TLS, redirects, uptime monitoring         |
| Integrations owner   | eBay, Stripe, Resend/email, Google OAuth, Sentry, AI providers              |
| Security reviewer    | RLS, secret rotation, least privilege, logs, backup/restore validation      |
| QA owner             | Test plan, acceptance matrix, browser/mobile checks, migration verification |
| Legal/support owner  | Terms, privacy, customer notices, support mailbox, launch communications    |

## 5. Current-State Findings

The repository currently contains multiple overlapping identities and operational
references. This is not a logo-only change.

### 5.1 Active brand surfaces

- `package.json` uses `sovereign-listing-suite` as the package name.
- `index.html`, `vite.config.ts`, and `public/manifest.webmanifest` expose
  Sovereign Listing Suite in browser, social, install, and PWA metadata.
- `src/index.css` and `src/v2/theme.css` encode the Sovereign identity,
  Cinzel typography, indigo colors, and old design-language comments.
- Public/auth pages and `src/v2/components/SideNav.tsx` import
  `src/assets/teckstart-logo.png` directly.
- `src/pages/LandingPage.tsx` contains old product copy, hard-coded blue styling,
  the hostname `sls.twinwicksds.com`, and Twin Wicks footer text.
- Terms and privacy pages name Sovereign Listing Suite and use
  `legal@twinwicksds.com` / `privacy@twinwicksds.com`.
- Generated listing disclosures say "Sovereign AI Assistant" in frontend code
  and Supabase prompt helpers.
- `supabase/functions/cost-alert-cron/index.ts` sends Sovereign-branded email
  from `alerts@teckstart.com`.
- E2E fixtures and documentation use `sovereignlistingsuite.com` test addresses.
- `public/listrassistr-logo.png` is currently untracked and is a concept asset,
  not yet a complete production logo system.

### 5.2 Infrastructure and integration surfaces

- `supabase/config.toml` is linked to project `wcednzaxmxwfiijzmjmx`.
- Frontend Supabase settings come from `VITE_SUPABASE_URL` and a publishable/anon
  key, documented in `.env.example`.
- `.github/workflows/deploy-functions.yml` deploys migrations and functions to
  `SUPABASE_PROJECT_REF` from the Production GitHub environment.
- E2E workflows depend on `QA_BASE_URL`, Supabase URL, anon key, and service key.
- Stripe checkout uses `APP_URL`, with an old Vercel URL as a fallback in
  `supabase/functions/create-checkout/index.ts`.
- Stripe customer portal derives its return URL from the request origin.
- eBay authorization uses `EBAY_RUNAME` or `EBAY_REDIRECT_URI`; this must match
  an eBay developer-console redirect configuration, not merely a browser URL.
- Browser Google/email auth callbacks derive from `window.location.origin`, but
  every allowed redirect must also be configured in Supabase Auth.
- Many Edge Functions currently return wildcard CORS. Production hardening should
  replace this with an allowlist shared helper covering production, approved
  preview/QA origins, and localhost development.
- Resend is used by the cost alert function. The new sending domain must pass
  SPF/DKIM verification before branded mail is enabled.
- Browser storage includes eBay token fallbacks, policy/taxonomy caches, theme,
  onboarding, cooldown, and pending-draft keys. These do not cross domains.

### 5.3 Database migration risks

- `profiles`, `drafts`, `ebay_tokens`, `subscriptions`, `competitor_prices`,
  `market_watches`, `listing_cogs`, and `listing_financials` depend directly or
  indirectly on `auth.users` UUIDs.
- Organizations, members, and invitations form a second ownership graph.
- Storage buckets include `listing-images` and `avatars`; listing media now also
  includes video-related behavior and retention metadata.
- Reference/cache tables include spot prices, category mappings/aspects,
  taxonomy cache, test/reference items, lookup decisions, and knowledge base.
- Some tables were created manually and are represented by no-op migrations
  (for example reprice/optimization tables). Therefore the migration directory
  cannot be assumed to be a complete description of the live schema.
- Generated TypeScript database types appear older than several migrations and
  must be regenerated from the new project after schema deployment.

## 6. Target Architecture

### 6.1 Public endpoints

| Purpose            | Target                                  |
| ------------------ | --------------------------------------- |
| Marketing site     | `https://listrassistr.com`              |
| Application        | `https://app.listrassistr.com`          |
| QA/staging         | `https://qa.listrassistr.com`           |
| Supabase API       | New project URL supplied by Supabase    |
| Supabase functions | New project `/functions/v1/*` endpoints |
| Support            | `support@listrassistr.com`              |
| Privacy            | `privacy@listrassistr.com`              |
| Legal              | `legal@listrassistr.com`                |
| Automated alerts   | `alerts@listrassistr.com`               |

If marketing and app remain in the same Vite deployment for launch, route the
apex to `/landing` and the app subdomain to the authenticated product. Preserve
the two-host target in configuration so a dedicated marketing site can be split
later without changing the application identity again.

### 6.2 Environment separation

Use separate Supabase projects for production and non-production. At minimum:

- `listrassistr-production`
- `listrassistr-staging`

Never run automated E2E setup against production. Use distinct Stripe test-mode
objects and eBay sandbox credentials in staging.

## 7. Phase 0: Launch Controls and Discovery

**Owner:** Launch lead with all technical owners

The rebrand-specific working documents for this phase are:

- `REBRAND_PHASE_0_IMPLEMENTATION.md` - execution roadmap, ownership protocol,
  model assignments, controls, and completion gate
- `REBRAND_PHASE_0_REPOSITORY_DISCOVERY.md` - repository-only findings and
  discovery limits collected without production-dashboard access

1. Create a launch project with task owners, due dates, dependencies, and a
   decision log.
2. Record current production and QA URLs, Vercel projects, Supabase project IDs,
   Stripe webhook endpoints/products/prices, eBay RuNames, OAuth providers,
   email domains, cron jobs, and monitoring endpoints.
3. Export a secret-name inventory from Supabase, Vercel, and GitHub. Record only
   names, owners, source systems, rotation status, and target environments.
4. Inventory the live shared Supabase database, not just repository migrations:
   schemas, tables, views, sequences, functions, triggers, policies, extensions,
   publications, cron jobs, vault entries, storage buckets, and Edge Functions.
5. Run schema diff against a clean project built from repository migrations.
   Convert all unexplained live objects into reviewed, idempotent migrations.
6. Identify which shared-project objects belong solely to ListrAssistr, solely
   to the other product, or are genuinely shared. Mark ambiguous objects as
   blocked until both product owners approve ownership.
7. Capture baseline counts and storage metrics by table, user, and bucket.
8. Produce and test encrypted backups of the database and storage object list.
9. Define the maintenance window, customer notice schedule, go/no-go meeting,
   and rollback decision deadline.

**Exit gate:** Current production can be restored; the live schema is accounted
for; no migration object remains "probably ours."

## 8. Phase 1: Domain, Legal, and Brand Foundation

### 8.1 Domain acquisition and security

**Owner:** Platform/DNS owner

1. Register `listrassistr.com` in the legal business account, not a personal
   account.
2. Enable registrar lock, MFA, auto-renew, recovery contacts, and domain-expiry
   alerts.
3. Check trademark and naming conflicts before public launch. Record legal
   approval of the stylized spelling.
4. Choose the authoritative DNS provider and document access/recovery.
5. Add the domain to Vercel. Use the DNS records Vercel displays for the apex
   and `app`; do not copy stale example IP addresses from documentation.
6. Create `qa`, `app`, and required email-verification records.
7. Set DNS TTL to 300 seconds at least 24 hours before cutover. Raise it after
   stabilization.
8. Enable DNSSEC if supported and verify the DS chain.

### 8.2 Email identity

**Owner:** Integrations owner

1. Create role mailboxes or aliases for `support`, `privacy`, `legal`, and
   `security` at `listrassistr.com`.
2. Add the domain to Resend and publish its DKIM/SPF records.
3. Publish DMARC initially with reporting (`p=none`), review reports, then move
   to quarantine/reject after all legitimate senders are aligned.
4. Configure a custom return-path if supported.
5. Send test messages to Gmail, Outlook, and a DMARC analyzer. Verify alignment,
   links, reply handling, and unsubscribe requirements where applicable.

### 8.3 Brand asset production

**Owner:** Brand/design owner

The concept logo uses a strong black/red/white industrial direction. The source
PNG has a large textured white canvas and cannot be used as the only asset.

Produce:

- Editable vector master and outlined-font export
- Horizontal wordmark, compact wordmark, and standalone mark
- Transparent light-background and dark-background variants
- Single-color variant
- Favicon at 16/32/48 pixels
- Apple touch icon and maskable PWA icons at 192/512 pixels
- Social sharing image at 1200x630 pixels
- Email/header-safe raster asset
- Brand usage sheet covering clear space, minimum size, and prohibited variants

Define accessible design tokens for primary red, black/charcoal, white, neutral
grays, success, warning, and destructive states. Test text and controls against
WCAG AA contrast. Red must not be the sole indicator for destructive actions,
errors, active state, or required fields.

**Exit gate:** Domain ownership is secure, legal has approved the name, branded
email can authenticate, and the asset package is approved.

## 9. Phase 2: Repository Brand Foundation

**Owner:** Frontend owner

### 9.1 Centralize identity before replacing surfaces

1. Add a typed brand/runtime module, for example `src/config/brand.ts`, holding:
   product name, short name, legal entity, marketing URL, app URL, support/legal/
   privacy emails, social handles, description, and logo asset paths.
2. Add a shared responsive brand component for the wordmark and compact mark.
3. Replace direct imports of `src/assets/teckstart-logo.png` on active pages and
   in `src/v2/components/SideNav.tsx`.
4. Keep deprecated identifiers in one compatibility map when renaming would
   invalidate sessions, browser caches, database IDs, or API contracts.
5. Add a CI brand-regression script that fails on prohibited active-runtime
   strings while excluding historical migrations, coin terminology such as
   "gold sovereign," approved legal-owner mentions, and archive directories.

### 9.2 Update active customer surfaces

Update and test:

- `src/pages/LandingPage.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/SignupPage.tsx`
- `src/pages/ForgotPasswordPage.tsx`
- `src/pages/ResetPasswordPage.tsx`
- `src/pages/AuthCallbackPage.tsx`
- `src/pages/TermsPage.tsx`
- `src/pages/PrivacyPage.tsx`
- `src/pages/SettingsPage.tsx`
- `src/v2/pages/SettingsPage2.tsx`
- `src/v2/components/SideNav.tsx`
- Shared footer, support modal, cookie consent, errors, loading, billing, team,
  admin, PDF/CSV exports, and toast copy
- AI-generated listing disclosure in frontend and Edge Function prompt helpers
- Automated alert sender, subject, and HTML footer

Twin Wicks should remain where legal ownership is required, formatted as
"ListrAssistr is a product of Twin Wicks Digital Solutions," rather than as the
primary product brand.

### 9.3 Replace the visual system

1. Replace Sovereign/Cinzel/indigo tokens in `src/index.css` and
   `src/v2/theme.css` with approved ListrAssistr tokens.
2. Remove hard-coded old blues/indigos from active components and migrate them
   to semantic tokens.
3. Choose typography that supports the angular logo without compromising dense
   operational screens. Use display typography sparingly and a highly readable
   UI family for tables, forms, and dashboards.
4. Validate light/dark behavior if both themes remain supported.
5. Check focus rings, links, charts, statuses, disabled controls, and destructive
   buttons under the new palette.
6. Update Playwright visual baselines only after design approval.

### 9.4 Metadata and install surfaces

Update:

- `package.json` package name
- `index.html` title, author, description, OG/Twitter metadata, icons, and theme
- `vite.config.ts` generated PWA manifest
- `public/manifest.webmanifest`
- Favicon, Apple icon, PWA icons, maskable icon, and social card
- `public/robots.txt` and add `public/sitemap.xml` if the marketing site is
  indexable
- Browser install name/short name and offline cache name

Avoid maintaining two independent PWA manifests. Select the Vite-generated
manifest as the source of truth or remove the plugin-generated manifest and keep
the static file, then test the production output.

### 9.5 Legal and marketing copy

1. Legal reviews Terms, Privacy, cookie disclosure, subscription terms, AI
   limitations, eBay authorization language, and data-controller identity.
2. Replace old email addresses and URLs.
3. Add effective dates and archived copies of the pre-rebrand terms.
4. Confirm whether material terms changes require affirmative user acceptance.
5. Replace internal proof points and unsupported marketing claims with verified
   metrics.
6. Update support macros, onboarding, screenshots, demos, help documents, and
   transactional email templates.

### 9.6 Tests and archive policy

1. Update E2E test domains, QA URLs, fixtures, snapshots, and documentation.
2. Decide whether `src/v2/pages/_archive` is retained. If retained, exclude it
   explicitly from runtime brand checks. Prefer deleting it after confirming no
   imports depend on it.
3. Preserve domain vocabulary matches such as British gold sovereign; they are
   product data, not old branding.

**Exit gate:** Searching active runtime code finds no unauthorized old brand or
domain references; build, unit tests, lint, formatting, PWA checks, and visual QA
pass on desktop and mobile.

## 10. Phase 3: New Supabase Projects

**Owner:** Backend owner and security reviewer

1. Create production and staging projects in the business Supabase organization.
2. Record project IDs and regions. Match the old production region unless there
   is an approved data-residency or latency reason to change it.
3. Configure spend limits, backups/PITR, log retention, database password custody,
   MFA, and least-privilege team access.
4. Replace the project ID in `supabase/config.toml` only on the migration branch,
   or remove hard coupling and require explicit `supabase link` per environment.
5. Reconcile live schema drift, then apply migrations to empty staging.
6. Enable required extensions, including vector/cron/network extensions actually
   used by reviewed migrations.
7. Create storage buckets and RLS policies before copying objects.
8. Deploy every Edge Function and verify its JWT policy deliberately. The current
   broad `verify_jwt = false` configuration must be reviewed function by function.
9. Add a shared CORS helper. Production allowlist should include only:
   `https://app.listrassistr.com`, `https://listrassistr.com`, approved QA/preview
   origins, and explicit localhost development origins outside production.
10. Configure scheduled jobs and secret-based cron authentication.
11. Regenerate `src/integrations/supabase/types.ts` from the target schema and
    commit the result.

### 10.1 Secret inventory

Configure environment-appropriate values for every secret actually referenced,
including:

- Supabase URL, anon/publishable key, service role key, and database URL
- `APP_URL`
- eBay client ID/secret, environment, RuName/redirect value
- Stripe secret key and webhook secret
- Gemini and OpenAI/proxy credentials
- Resend API key
- Sentry DSN if error tracking is enabled
- Media retention and cron secrets

Rotate service-role, webhook, and provider secrets after cutover or immediately
if they were ever exposed outside approved secret stores.

**Exit gate:** A clean staging project can be built from reviewed migrations,
functions deploy successfully, RLS tests pass, and all scheduled/integration
health checks work without using the old project.

## 11. Phase 4: Selective Data and Auth Migration

**Owner:** Data migration owner

### 11.1 Define the user cohort

Create a version-controlled migration query that builds a deterministic set of
ListrAssistr user UUIDs. Seed it from product evidence such as:

- Draft ownership
- Stored eBay credentials/profile connection state
- ListrAssistr subscription/customer metadata
- Listing COGS and listing financials
- Competitor searches and market watches
- Product usage records and support tickets
- Explicitly approved allowlist entries

Then compute transitive closure for organizations and memberships:

1. Add organizations owned by or containing seed users when those organizations
   are confirmed to belong to ListrAssistr.
2. Add all required members for those organizations only after ownership review.
3. Include invitations only when the organization is migrating and the invitation
   is still valid.
4. Exclude users with no listing-product evidence unless explicitly approved.
5. Produce an exception report for users present in both products.

The cohort output must contain UUID, email hash for reconciliation, reason for
inclusion, organization IDs, row counts by table, and reviewer approval. Do not
place plaintext user data in Git.

### 11.2 Auth migration

Use the current Supabase-supported auth migration procedure at implementation
time. Requirements:

- Preserve user UUID, email/phone verification state, provider identities,
  metadata required by the app, and password hash when the supported path allows.
- Do not write directly to hosted Auth tables through ad hoc SQL unless Supabase
  support/documentation explicitly approves the procedure and it has passed a
  rehearsal.
- If password hashes or provider identities cannot be migrated safely, use a
  controlled password-reset/re-authentication flow and communicate it before
  cutover.
- Reconfigure Google or other social providers in the new project and verify
  account linking does not create duplicate users.
- Expect existing browser sessions to be invalid because the Supabase project and
  origin change. This is acceptable; users sign in again after launch.

Import Auth users before rows with foreign keys to `auth.users`.

### 11.3 Data classification and order

Migrate in this order:

1. Schema, extensions, functions, triggers, policies, and empty buckets
2. Shared reference data: category/taxonomy/aspect mappings, spot-price cache if
   desired, knowledge-base content, and other approved global tables
3. Auth users and provider identities using the supported method
4. Profiles and product-owned organizations
5. Organization members and invitations
6. Subscriptions and Stripe identifiers
7. eBay tokens/connection metadata
8. Drafts and draft lifecycle data
9. Listing COGS, listing financials, reprice rules, and optimization history
10. Competitor prices, market watches/history, usage, AI-cost, support, and alert
    data according to retention policy
11. Storage objects for migrated users and migrated drafts
12. Derived views/caches, which should be recomputed where practical

Do not migrate test/reference data blindly. Seed canonical reference data from
reviewed migrations and import only production-generated reference data that is
still authoritative.

### 11.4 Storage copy

1. Export an object manifest with bucket, path, owner, size, MIME type, checksum,
   created time, and related draft/user.
2. Filter to the approved cohort and product-owned shared assets.
3. Copy server-to-server with bounded concurrency and retry logging.
4. Preserve object paths when database rows store those paths.
5. Verify checksums and public/private access behavior.
6. Scan for orphaned objects and missing referenced objects; resolve exceptions
   before launch.
7. Do not rely on old public Supabase URLs after cutover. Rewrite absolute stored
   URLs to the new project URL or migrate storage references to stable paths.

### 11.5 Rehearsal requirements

Run at least two complete rehearsals:

1. Full copy into a disposable project to discover schema/auth/storage failures.
2. Timed dress rehearsal using production-scale counts to prove the maintenance
   window is sufficient.

For each rehearsal record duration, row counts, checksums, failed rows, storage
bytes, auth success rate, RLS results, and cleanup steps.

**Exit gate:** The approved cohort can sign into staging, access only its own
data, reconnect-free eBay operations work where tokens remain valid, Stripe state
matches, and migration validation has zero unexplained exceptions.

## 12. Phase 5: External Integrations

### 12.1 Supabase Auth URLs

**Owner:** Backend/integrations owner

Configure:

- Site URL: `https://app.listrassistr.com`
- Allowed redirects for `/auth/callback` and `/reset-password`
- QA callbacks on `https://qa.listrassistr.com`
- Explicit localhost callback URLs for development
- Branded confirmation, invitation, magic-link, recovery, and email-change
  templates using ListrAssistr URLs and support identity
- Google OAuth consent screen and authorized redirect URI for the new Supabase
  project callback

Do not use unrestricted wildcard redirects in production.

### 12.2 eBay

**Owner:** Integrations owner

1. In the existing eBay developer account, create or update the production
   RuName/redirect entry for ListrAssistr.
2. Update privacy policy, terms, auth-accepted, and auth-declined URLs.
3. Set `EBAY_RUNAME` consistently in the new Supabase production secrets.
4. Confirm the application name and OAuth consent branding displayed by eBay.
5. Retain the old RuName during the redirect/rollback period.
6. Test connect, callback, identity lookup, token refresh, policies, draft create,
   publish, revise, video upload, listing retrieval, and disconnect.
7. Confirm migrated refresh tokens remain valid under the same eBay application.
   If not, run a user reconnect campaign rather than silently failing.

### 12.3 Stripe

**Owner:** Integrations owner and finance

1. Create ListrAssistr products/prices in the existing Stripe account. Do not
   rename another product's objects if they are shared.
2. Decide whether existing subscriptions keep legacy price IDs or are migrated
   through Stripe subscription schedules. Document billing/proration effects.
3. Add a new webhook endpoint for the new Supabase `stripe-webhook` function.
4. Subscribe only to required events and install the new signing secret.
5. Set `APP_URL=https://app.listrassistr.com`; remove the old Vercel fallback from
   production behavior.
6. Configure the customer portal with ListrAssistr identity, return URLs, terms,
   privacy, support contact, and allowed plan changes.
7. Update statement descriptor and receipt branding where legally and
   operationally appropriate.
8. Test new checkout, success/cancel routes, webhook replay/idempotency, existing
   subscriber access, upgrades/downgrades, cancellation, and portal return.
9. During cutover, prevent both old and new webhooks from independently mutating
   divergent databases. Route events to the intended system and verify delivery.

### 12.4 Email, AI, and observability

1. Update Resend sender identities and all template URLs.
2. Verify provider budgets/quotas and move Gemini/OpenAI credentials to the new
   Supabase project.
3. **Implement Sentry (or equivalent) from scratch for ListrAssistr — do not
   assume an existing setup to separate into new environments.** Phase 0
   discovery (RBR-0032, 2026-08-14) found that Sentry has never actually been
   set up for this product: `_helpers/sentry.ts` in the legacy repo is an
   undocumented no-op stub — `initSentry()` never initializes a real client,
   and `captureException`/`withSentryScope` only `console.log`/`console.error`
   — left in place after the real SDK import caused CDN timeout issues during
   deployment and was never revisited. No Sentry account exists at all, and
   there is no frontend instrumentation either. This is a clean-slate build,
   not a migration of working observability, so budget real implementation
   time here rather than a config copy. Whatever CDN/proxy issue blocked the
   original attempt should be diagnosed and avoided before wiring functions
   back into it, and this closes a real gap: without it, function errors
   (including delivery failures like RBR-0031) are only visible in per-function
   console logs that nobody watches proactively.
4. Scrub secrets, OAuth codes, access tokens, and customer listing content from
   logs and error events.
5. Configure uptime checks for marketing, app, auth callback, and a safe backend
   health endpoint.

**Exit gate:** Every provider has a production and staging configuration, a named
owner, a tested rollback, and no dependency on the old public brand/domain.

## 13. Phase 6: Vercel, CI/CD, and DNS

### 13.1 Vercel

**Owner:** Platform owner

1. Create or rename the Vercel project to ListrAssistr without changing the live
   old deployment yet.
2. Connect `listrassistr.com`, `www`, `app`, and `qa` according to the target
   architecture.
3. Configure production/preview/development environment variables separately.
4. Point Vite variables to the new Supabase project.
5. Configure redirects in `vercel.json` or a dedicated redirect deployment:
   - `www.listrassistr.com` to canonical marketing URL
   - Legacy app hostnames to `https://app.listrassistr.com`, preserving path and
     query string where safe
6. Keep SPA rewrites after host redirects so callback routes still resolve.
7. Verify TLS issuance and automatic renewal for every hostname.
8. Add security headers: HSTS only after HTTPS/redirect verification, CSP after
   provider endpoint inventory, Referrer-Policy, X-Content-Type-Options, and an
   appropriate Permissions-Policy.

### 13.2 GitHub environments and workflows

1. Create protected `Production` and `Staging` GitHub environments.
2. Replace Supabase project ref, URL, anon key, service key, and QA base URL.
3. Review all workflows, including function deployment, taxonomy sync, E2E,
   frontend tests, and scheduled jobs.
4. Require approval for production migration/function deployment during cutover.
5. Remove `continue-on-error` from migration deployment after migration history
   is reconciled. A failed production migration must stop deployment.
6. Do not auto-apply destructive migrations on every push to `main`.
7. Add post-deploy smoke tests against `app.listrassistr.com` and verify the build
   identifies the expected Supabase project.

### 13.3 DNS cutover records

Use provider-generated values. The final record set should conceptually include:

| Name                    | Type                    | Purpose                                      |
| ----------------------- | ----------------------- | -------------------------------------------- |
| `@`                     | Vercel-required A/ALIAS | Marketing deployment                         |
| `www`                   | CNAME                   | Canonical marketing redirect/deployment      |
| `app`                   | CNAME                   | Production application                       |
| `qa`                    | CNAME                   | Staging application                          |
| provider DKIM selectors | CNAME/TXT               | Email signing                                |
| `@`                     | TXT                     | SPF                                          |
| `_dmarc`                | TXT                     | DMARC policy/reporting                       |
| CAA                     | CAA                     | Approved certificate authorities, if managed |

**Exit gate:** Preview/QA deploys use the new backend, all CI passes, DNS records
are prepared at low TTL, and the old domain redirect is tested before launch.

## 14. Phase 7: Production Cutover Runbook

### 14.1 T-7 to T-1 days

1. Send customer notice covering new name/domain, maintenance window, sign-in
   requirement, support contact, and how to recognize legitimate emails.
2. Freeze schema changes unrelated to migration.
3. Complete final rehearsal and sign off its exception report.
4. Confirm fresh database backup, Auth export path, and storage manifest.
5. Verify old and new domain certificates, redirects, provider dashboards, and
   rollback access.
6. Lower DNS TTL and confirm propagation.
7. Stage the production frontend against the new production Supabase project on
   a non-public deployment URL protected from customer use.
8. Verify Stripe webhook endpoint but keep event routing controlled until the
   write freeze.
9. Prepare status-page and support responses.

### 14.2 Maintenance window

The launch lead timestamps every step and owns the go/no-go decision.

1. Display maintenance mode on the old app and block writes at both UI and backend
   layers. Cron jobs, webhook mutations, publish jobs, and background workers must
   be paused or queued.
2. Record final source counts and transaction cutoff time.
3. Run final cohort query and review additions since rehearsal.
4. Export/import the final Auth cohort using the approved method.
5. Copy final mutable table data in dependency order.
6. Copy storage delta and verify checksums.
7. Reset sequences and refresh/recompute approved derived data.
8. Run automated reconciliation:
   - Row counts by table and user
   - Primary-key set comparison
   - Critical-column checksums
   - Foreign-key/orphan checks
   - Storage object count, bytes, and checksums
   - Subscription/customer/token relationship checks
9. Enable new scheduled jobs and integration secrets.
10. Switch Stripe webhook routing and confirm a signed test event.
11. Run the production smoke suite on the staged new deployment.
12. Point `app.listrassistr.com` to the production deployment and verify TLS.
13. Enable permanent redirects from all confirmed legacy app hostnames, preserving
    path/query except sensitive OAuth parameters.
14. Remove maintenance mode on the new app.
15. Keep old writes disabled and begin hypercare monitoring.

### 14.3 Mandatory smoke tests

Test with a migrated owner, migrated team member, and new user:

- Sign in, sign out, password reset, email confirmation, Google OAuth if enabled
- Organization/team boundaries and owner-only routes
- Existing drafts, images, videos, profiles, settings, and subscription state
- Analyze an item, save a draft, upload media, and publish to eBay
- eBay token refresh, policies, listing retrieval, revision, and disconnect
- Stripe checkout in the appropriate mode, portal, webhook, and entitlement
- Reports, COGS, market research, bulk actions, and scheduled jobs
- Support/legal/privacy links and email delivery
- PWA install/update, favicon, social metadata, mobile layout, and accessibility
- Old URL redirect with representative paths and query strings

### 14.4 Go/no-go thresholds

Launch only when:

- Zero unexplained missing Auth users or critical product rows
- Zero foreign-key violations or cross-tenant RLS leaks
- Storage verification meets 100% for referenced objects
- Migrated-user login and critical smoke tests pass
- Stripe and eBay production callbacks succeed
- Error rate, latency, and provider failures are within approved baseline
- Rollback remains possible within the declared decision window

## 15. Rollback Plan

Rollback authority belongs to the launch lead, advised by engineering and
security. Trigger rollback for data loss, auth failure affecting a material user
segment, RLS leakage, payment misrouting, eBay publishing corruption, or sustained
critical error rates.

1. Re-enable maintenance mode on the new app.
2. Stop new-project cron jobs, function mutations, and webhook processing.
3. Record all writes accepted by the new system since cutover.
4. Restore DNS/host routing to the old deployment.
5. Restore Stripe webhook routing to the old function.
6. Re-enable old jobs and writes only after confirming source consistency.
7. Reconcile or replay new-system writes manually; do not discard them.
8. Notify customers and support with a factual status update.
9. Preserve logs and migration artifacts for incident review.

Because the old hostname is intended to redirect permanently, do not enable HSTS
preload or remove old infrastructure until the rollback period has ended.

## 16. Phase 8: Hypercare and Cleanup

### 16.1 First 72 hours

1. Monitor auth success, Edge Function error rate, Stripe webhooks, eBay token
   refresh, publish failures, storage 404s, email delivery, latency, and spend.
2. Review support contacts and failed-login cohorts at least twice daily.
3. Re-run row/storage reconciliation after 24 and 72 hours.
4. Keep the old shared backend read-only.
5. Patch only launch-critical issues; defer unrelated changes.

### 16.2 After 30 days

1. Obtain written approval from both product owners before removing any object
   from the old shared Supabase project.
2. Export a final encrypted archive and document retention/deletion dates.
3. Remove ListrAssistr Edge Functions, cron jobs, webhooks, secrets, and tables
   from the old project only through reviewed migrations/scripts.
4. Revoke old service keys and rotate shared provider credentials where feasible.
5. Remove obsolete Vercel environment variables and GitHub secrets.
6. Keep legacy domain redirects and monitor them. Do not allow certificates or
   domain registration to lapse while redirects are required.
7. Raise DNS TTL after stability is established.
8. Archive old legal terms, screenshots, and release notes.
9. Update repository name/description, README, badges, issue templates, and team
   documentation after the product cutover is stable.

## 17. Validation Matrix

| Area       | Automated evidence                         | Manual evidence                             |
| ---------- | ------------------------------------------ | ------------------------------------------- |
| Brand      | Prohibited-string scan, metadata/PWA tests | Design review across public/auth/app/email  |
| Frontend   | Typecheck, lint, unit, build, Playwright   | Desktop/mobile/browser/accessibility review |
| Auth       | Callback and RLS integration tests         | Migrated/new/social/password users sign in  |
| Database   | Counts, checksums, FK/orphan scripts       | Spot-check representative accounts          |
| Storage    | Manifest checksum comparison               | Images/video/avatar render and delete       |
| eBay       | Sandbox and production smoke actions       | Consent branding and real listing workflow  |
| Stripe     | Test-mode lifecycle and webhook replay     | Existing production subscriber verification |
| Email      | SPF/DKIM/DMARC and delivery tests          | Branding, links, replies, accessibility     |
| DNS/TLS    | Resolver and certificate automation        | Major-network/browser checks                |
| Redirects  | Path/query redirect test matrix            | Bookmarks and old email links               |
| Operations | Deploy and rollback rehearsal              | Launch owner sign-off                       |

## 18. Required Deliverables

The team must produce these artifacts before declaring the migration complete:

- Approved brand asset package and token specification
- Central brand configuration and shared logo component
- Brand-reference CI scan with documented exceptions
- Legal-approved Terms and Privacy versions with effective dates
- DNS record inventory and ownership/recovery document
- New production/staging Supabase projects and access matrix
- Live-schema reconciliation report and idempotent migration set
- Secret-name/environment matrix
- User cohort query, inclusion report, and approvals
- Auth/data/storage migration scripts with dry-run mode
- Two rehearsal reports and timed cutover estimate
- Automated reconciliation report
- Provider configuration checklist for eBay, Stripe, Resend, OAuth, and monitoring
- Cutover log, smoke-test evidence, and go/no-go sign-off
- Rollback rehearsal evidence
- Post-launch cleanup approval and audit trail

## 19. Final Completion Criteria

The project is complete only when all of the following are true:

1. Customers encounter ListrAssistr consistently across web, PWA, OAuth, billing,
   email, support, and legal surfaces.
2. `app.listrassistr.com` is canonical, secure, monitored, and backed by the new
   ListrAssistr-only Supabase project.
3. All approved users and their product data have been reconciled with no
   unexplained exceptions.
4. Existing Stripe/eBay integrations operate under ListrAssistr configuration.
5. Legacy hostnames redirect permanently without breaking safe deep links.
6. The old shared backend is read-only during the rollback window and is cleaned
   only after explicit cross-product approval.
7. CI prevents old branding/domains from returning to active runtime code.
8. Operations can deploy, monitor, restore, and rotate credentials without the
   product owner's direct involvement.
