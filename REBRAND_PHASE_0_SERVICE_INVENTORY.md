# Rebrand Phase 0 Service Inventory

**Product:** ListrAssistr  
**Source repository:** `twinwicksllc/listing-assistant-pro`  
**Discovery date:** 2026-08-10  
**Status:** Repository inventory complete; provider verification pending

## Evidence rules

This inventory records names and configuration references found in the repository.
It does not contain secret values, customer data, or claims about live provider
state. Rows marked `Provider verification required` must be confirmed by the
user in the relevant dashboard or authorized CLI session.

## Services and endpoints

| Service                 | Repository evidence                                          | Environment/status                           | Verification required                                        |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| Frontend                | Vite React app; `npm run build`; output `dist`               | Legacy app source                            | Confirm Vercel project, domains, deployments                 |
| Legacy application URL  | README references `https://lister.teckstart.com`             | Historical repository value                  | Confirm current production URL and all aliases               |
| Supabase API            | `VITE_SUPABASE_URL`; config ref `wcednzaxmxwfiijzmjmx`       | Linked repository project; live role unknown | Confirm project name, region, plan, and ownership            |
| Supabase Edge Functions | 36 function-related directories                              | Repository deployment surface                | Confirm deployed functions, versions, JWT settings, CORS     |
| Supabase Storage        | Buckets `listing-images` and `avatars` in migrations/code    | Repository-defined storage surface           | Confirm live buckets, object counts, bytes, access policies  |
| GitHub Actions          | 6 workflow files under `.github/workflows`                   | Repository CI/CD                             | Confirm environments, approvals, variables, and secret names |
| Vercel                  | `vercel.json` SPA rewrite; Vite build                        | Deployment configuration source              | Confirm project, team, domains, environment variables        |
| Stripe                  | Checkout, portal, subscription check, webhook functions      | Integration in source                        | Confirm account, products, prices, endpoints, event routing  |
| eBay                    | OAuth, Inventory/Browse/Taxonomy/Policies functions          | Integration in source                        | Confirm app, RuName, scopes, sandbox/production settings     |
| Google/Supabase Auth    | Browser callbacks derive from origin                         | Auth integration in source                   | Confirm Site URL, allowed redirects, providers, templates    |
| Gemini/OpenAI           | Gemini analysis and usage; OpenAI proxy names in config scan | AI provider integration                      | Confirm providers, models, quotas, environments              |
| Resend                  | Cost alert function and `RESEND_API_KEY` reference           | Email integration in source                  | Confirm domain, sender identities, SPF/DKIM/DMARC            |
| Sentry                  | Function helper and `SENTRY_DSN` reference                   | Monitoring integration in source             | Confirm projects, environments, alert routes, retention      |
| Scheduled work          | Cron/trigger function directories and taxonomy workflow      | Repository-defined jobs                      | Confirm live schedules, invocations, pause/restart methods   |

## GitHub Actions workflow inventory

| Workflow                     | Trigger/dependency observed                           | Sensitive inputs by name                                 |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `category-taxonomy-sync.yml` | Scheduled taxonomy and category hygiene calls         | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`                   |
| `deploy-functions.yml`       | Supabase migrations/functions; Production environment | `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`          |
| `e2e-full-lifecycle.yml`     | QA full lifecycle tests                               | QA URL, Supabase URL/service/anon keys, eBay sandbox key |
| `e2e-pr-smoke.yml`           | PR smoke tests                                        | QA URL, Supabase URL/service/anon keys                   |
| `pre-commit-checks.yml`      | Formatting and lint                                   | None observed                                            |
| `test.yml`                   | Unit/build/Deno/E2E checks                            | QA and Supabase values where E2E runs                    |

## Function inventory by operational group

- AI/media: `analyze-item`, `bulk-generate-descriptions`, `transcribe-voice`,
  `video-frame-extract`, `optimize-listing`
- eBay: `ebay-user`, `ebay-publish`, `ebay-listings`, `ebay-pricing`,
  `ebay-policies`, `ebay-competitor-search`, `ebay-reprice`, `disconnect-ebay`
- Billing/access: `create-checkout`, `customer-portal`, `check-subscription`,
  `stripe-webhook`, `get-free-credits`
- Scheduled/maintenance: `auto-reprice-cron`, `auto-reprice-trigger`,
  `category-hygiene-cron`, `competitor-prices-cron`, `cost-alert-cron`,
  `market-watch-refresh`, `cleanup-media-retention`
- Research/data: `category-lookup`, `setup-categories`, `spot-prices`,
  `keyword-research`, `filter-comparable-listings`, `cogs-report`,
  `domain-quality-report`, `system-status`, `sync-ebay-taxonomy`
- Shared/test directories: `_helpers`, `_tests`, `_test-helpers`

## Required next confirmations

The user should collect provider-visible names and statuses only. The AI can
walk through each dashboard and record the results without receiving secret
values. No production change is implied by this inventory.
