# Rebrand Phase 0 Secret-Name Inventory

**Product:** ListrAssistr  
**Source repository:** `twinwicksllc/listing-assistant-pro`  
**Discovery date:** 2026-08-10  
**Status:** Names observed in repository; ownership, environment, and rotation verification pending

## Handling rule

This file records secret names and storage locations only. Never add values,
tokens, passwords, private keys, customer exports, or hashes. The user enters
secret values directly into the provider dashboard, approved secret store, or
terminal prompt.

## Browser-safe frontend configuration

These are intended for Vite client configuration and are not secrets by
themselves, but their values and target environments still require review:

| Name                            | Source                   | Required environments            | Status                                 |
| ------------------------------- | ------------------------ | -------------------------------- | -------------------------------------- |
| `VITE_SUPABASE_URL`             | `.env.example`, frontend | Development, staging, production | Target project per environment unknown |
| `VITE_SUPABASE_PROJECT_ID`      | `.env.example`, frontend | Development, staging, production | Target project per environment unknown |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env.example`, frontend | Development, staging, production | Target key per environment unknown     |
| `VITE_SUPABASE_ANON_KEY`        | CI/E2E references        | QA/E2E where used                | Confirm whether still required         |

## Server and CI secret names observed

| Name                        | Likely store                       | Used by                    | Environment               | Rotation/status                        |
| --------------------------- | ---------------------------------- | -------------------------- | ------------------------- | -------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`     | GitHub secret                      | Function deployment        | Production                | Verify owner and rotation              |
| `SUPABASE_SERVICE_KEY`      | GitHub/Supabase secret             | Taxonomy and E2E workflows | QA/production by workflow | Verify scope and rotation              |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase/Vercel secret             | Functions or scripts       | Environment-specific      | Search/dashboard verification required |
| `SUPABASE_URL`              | GitHub/Supabase secret or variable | Workflows/functions        | QA/production             | Confirm target project                 |
| `SUPABASE_PROJECT_REF`      | GitHub environment secret          | Function deployment        | Production                | Confirm current ref and protection     |
| `SUPABASE_ANON_KEY`         | GitHub secret                      | E2E workflows              | QA                        | Confirm target project                 |
| `SUPABASE_KEY`              | Function/script environment        | Repository references      | Unknown                   | Identify live consumer                 |
| `EBAY_CLIENT_ID`            | Supabase secret/provider           | eBay functions             | Sandbox/production        | Verify app and environment             |
| `EBAY_CLIENT_SECRET`        | Supabase secret/provider           | eBay OAuth functions       | Sandbox/production        | Verify rotation status                 |
| `EBAY_REDIRECT_URI`         | Supabase secret/provider           | eBay OAuth                 | Sandbox/production        | Verify against RuName                  |
| `EBAY_RUNAME`               | Supabase secret/provider           | eBay OAuth                 | Sandbox/production        | Verify against developer console       |
| `EBAY_SANDBOX_API_KEY`      | GitHub secret                      | E2E workflow               | QA                        | Confirm sandbox-only scope             |
| `EBAY_TOKEN_KEY`            | Supabase secret                    | Token handling             | Production                | Verify custody and rotation            |
| `STRIPE_SECRET_KEY`         | Supabase secret                    | Checkout/portal/webhook    | Test/production           | Verify account and rotation            |
| `STRIPE_WEBHOOK_SECRET`     | Supabase secret                    | Stripe webhook             | Test/production           | Verify endpoint mapping and rotation   |
| `GEMINI_API_KEY`            | Supabase secret                    | AI functions               | Staging/production        | Verify quota and rotation              |
| `OPENAI_PROXY_URL`          | Supabase/Vercel config             | AI helper if enabled       | Staging/production        | Confirm whether active                 |
| `OPENAI_PROXY_AUTH_TOKEN`   | Supabase secret                    | AI helper if enabled       | Staging/production        | Confirm whether active                 |
| `RESEND_API_KEY`            | Supabase secret                    | Cost alert/email           | Staging/production        | Verify sender domain and rotation      |
| `SENTRY_DSN`                | Vercel/Supabase config             | Monitoring                 | Staging/production        | Confirm project/environment            |

## Public or non-secret configuration names

`APP_URL`, `QA_BASE_URL`, `EBAY_ENV`, `EBAY_ENVIRONMENT`,
`EBAY_MARKETPLACE_ID`, `EBAY_OAUTH_SCOPES`, `EBAY_CATEGORY_TREE_ID`, and product
IDs are configuration values but still require environment and ownership review.

## Required user verification

For each row, the user should confirm the actual store, environment, owner,
last rotation date or status, and whether the value is still used. The AI must
never request the value itself.
