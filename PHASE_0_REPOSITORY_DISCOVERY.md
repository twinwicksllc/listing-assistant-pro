# Phase 0 Repository Discovery

**Product:** ListrAssistr  
**Repository:** `twinwicksllc/listing-assistant-pro`  
**Branch:** `docs/phase-0-roadmap`  
**Discovery date:** 2026-08-10  
**Scope:** Read-only repository inspection; no production systems, credentials, or customer data accessed

## Summary

This report records repository evidence that can be collected without provider
or production-dashboard access. It supports the Phase 0 implementation plan but
does not replace live Vercel, Supabase, GitHub, Stripe, eBay, Resend, DNS, or
Sentry inventory.

## Confirmed Repository Findings

### Active legacy brand and domain references

The following active-runtime or operational surfaces still contain legacy identity
references and should be addressed during the later brand phases:

- Active pages import `src/assets/teckstart-logo.png`, including Billing, Login,
  Team, Home, Auth Callback, Landing, Reset Password, Signup, Dashboard,
  Settings, and Forgot Password.
- `src/v2/components/SideNav.tsx` imports the same legacy logo asset.
- `src/pages/LandingPage.tsx` contains `sls.twinwicksds.com`.
- `supabase/functions/cost-alert-cron/index.ts` sends from
  `alerts@teckstart.com` with legacy product branding.
- `README.md` still documents `https://lister.teckstart.com` as the live URL.
- Archived V2 pages contain duplicate legacy references and should remain
  excluded from runtime scans unless their imports are reactivated.

These findings confirm that the rebrand is a multi-surface change rather than a
single asset replacement.

### Configuration variable names

The repository references these configuration names. Values were not read or
recorded:

- Supabase: `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_ANON_KEY`, `SUPABASE_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_SUPABASE_ANON_KEY`
- Application and QA: `APP_URL`, `QA_BASE_URL`
- eBay: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENV`,
  `EBAY_ENVIRONMENT`, `EBAY_REDIRECT_URI`, `EBAY_RUNAME`,
  `EBAY_SANDBOX_API_KEY`, `EBAY_TOKEN_KEY`, and related category/condition
  configuration names
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRO_PRODUCT_ID`, `STRIPE_UNLIMITED_PRODUCT_ID`, `STRIPE_TEST_CARD`
- AI, email, and monitoring: `GEMINI_API_KEY`, `OPENAI_PROXY_URL`,
  `OPENAI_PROXY_AUTH_TOKEN`, `RESEND_API_KEY`, `SENTRY_DSN`

The Phase 0 secret inventory must record each name's source system, owner,
environment, and rotation status without recording values.

### CI/CD and deployment surfaces

Six GitHub Actions workflows are present:

- `category-taxonomy-sync.yml`
- `deploy-functions.yml`
- `e2e-full-lifecycle.yml`
- `e2e-pr-smoke.yml`
- `pre-commit-checks.yml`
- `test.yml`

Important repository-level observations:

- `deploy-functions.yml` targets the GitHub `Production` environment.
- It links Supabase using `SUPABASE_PROJECT_REF` and runs
  `supabase db push --yes --include-all`.
- It deploys functions with `--no-verify-jwt` for at least selected functions.
- Taxonomy sync calls Supabase functions using the service key.
- Full and PR E2E workflows use `QA_BASE_URL`, Supabase URL/anon key/service key,
  and the eBay sandbox API key where configured.
- Test CI runs frontend tests/build plus Deno formatting/linting and an E2E smoke
  job.

These observations require a live GitHub environment review before changing
production deployment behavior. In particular, migration auto-apply behavior,
production approvals, and the scope of `--no-verify-jwt` need explicit review.

### Supabase functions and migration surface

The repository contains 36 function-related directories, including application
functions, cron jobs, shared helpers, and tests. Notable operational groups are:

- AI and media: `analyze-item`, `bulk-generate-descriptions`,
  `transcribe-voice`, `video-frame-extract`, `optimize-listing`
- eBay: `ebay-user`, `ebay-publish`, `ebay-listings`, `ebay-pricing`,
  `ebay-policies`, `ebay-competitor-search`, `ebay-reprice`, `disconnect-ebay`
- Billing and access: `create-checkout`, `customer-portal`,
  `check-subscription`, `stripe-webhook`, `get-free-credits`
- Scheduled or maintenance work: `auto-reprice-cron`, `auto-reprice-trigger`,
  `category-hygiene-cron`, `competitor-prices-cron`, `cost-alert-cron`,
  `market-watch-refresh`, `cleanup-media-retention`
- Shared helpers and tests: `_helpers`, `_tests`, `_test-helpers`

Recent migrations show live-feature scope beyond the earliest schema assumptions,
including:

- Listing images and avatars storage buckets plus storage RLS fixes
- Video fields and expanded listing-image handling
- Category mappings, aspects, taxonomy cache, and domain tracking
- Stripe subscription tables and SKU sequence RPCs
- Market watches, optimization tables, COGS, and listing financials
- pgvector and knowledge-base support
- Media retention policy

The live Supabase project must be compared with this migration history because
repository migrations may not represent manually-created or drifted objects.

### Storage usage

The application actively uses two buckets:

- `listing-images`: listing images, uploaded videos, extracted video frames, and
  eBay publishing media
- `avatars`: user profile images stored under an `avatars/` path pattern

The storage migration must preserve paths, related database references, object
access behavior, MIME types, and checksums. Public URL generation is present in
both frontend and Edge Function code, so old Supabase URLs must not survive the
cutover unintentionally.

## Phase 0 Implications

1. The active-runtime brand scan needs an explicit archive exclusion list.
2. The service inventory must include the 6 workflows, 36 function directories,
   storage buckets, cron functions, and all configuration names above.
3. The deployment review must specifically address `db push --yes --include-all`,
   production environment approvals, and function JWT settings.
4. The migration plan must include video frames, retention metadata, listing
   media, avatars, COGS, financials, market watches, taxonomy caches, pgvector,
   and knowledge-base data where ownership review approves them.
5. The old logo/domain/email references should be treated as Phase 2 active work,
   not modified during Phase 0 discovery.

## Not Yet Discoverable Without User Access

The following require the user to open or authorize the relevant provider
systems. The AI can guide each step without receiving secret values:

- Current Vercel projects, domains, deployments, and environment-variable names
- DNS registrar, current records, TLS, SPF, DKIM, and DMARC state
- Live Supabase schema, RLS policies, Auth users/configuration, Storage objects,
  deployed function versions, cron jobs, and secret names
- GitHub private-repository access, environments, protected branches, and secret
  names
- Stripe products, prices, subscriptions, webhook endpoints, and portal config
- eBay application, RuName, OAuth URLs, scopes, and token status
- Resend domains, sender identities, and delivery configuration
- Sentry projects, environments, alert routes, and uptime checks
- Encrypted production backup and disposable-project restore evidence

No production data, credential values, tokens, password hashes, or private
customer content was accessed during this discovery.
