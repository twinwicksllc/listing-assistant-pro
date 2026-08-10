# Rebrand Phase 0 Schema and Migration Inventory

**Product:** ListrAssistr  
**Source repository:** `twinwicksllc/listing-assistant-pro`  
**Discovery date:** 2026-08-10  
**Status:** Repository migration inventory; live schema reconciliation pending

## Scope and limitations

This inventory is derived from migration filenames, function references, and the
repository function/table mapping. It is not a dump of the live database. Any
live object absent from this file or repository migrations is an exception until
reviewed.

## Product data groups

| Data group         | Repository evidence                                                 | Migration implication                                   | Ownership status               |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| Auth/profiles      | `profiles`, Auth client usage, profile migrations                   | Preserve Auth UUIDs and profile links                   | Requires live review           |
| Organizations      | Organization backfill/owner migrations and org usage                | Include only approved product organizations/members     | Requires cohort review         |
| Drafts/listings    | Draft lifecycle, staging columns, quantity, package dimensions      | Preserve draft IDs and media references                 | ListrAssistr candidate; verify |
| eBay connections   | eBay token storage and profile references                           | Preserve token relationships; validate migration method | Sensitive; verify              |
| Billing            | `subscriptions`, Stripe IDs, checkout/webhook functions             | Reconcile customer/subscription relationships           | Shared-account review          |
| Usage/AI cost      | `usage_tracking`, `gemini_usage`, `cost_alerts`, provider migration | Retention and user/org linkage review                   | Requires live review           |
| Market data        | `competitor_prices`, market watches/history, spot prices            | Separate global reference from user-owned data          | Requires ownership review      |
| Financial data     | listing COGS and listing financials                                 | Preserve listing/user relationships and checksums       | ListrAssistr candidate         |
| Taxonomy/reference | category mappings, aspects, taxonomy cache, test items              | Seed canonical reference data; do not copy blindly      | Classify shared/reference      |
| Knowledge/RAG      | pgvector and knowledge-base migrations                              | Verify extension, embeddings, and source ownership      | Requires review                |
| Support/alerts     | Support, alert, and domain-quality references                       | Apply retention and privacy policy                      | Requires live review           |

## Storage

| Bucket           | Repository evidence                             | Migration controls                                              | Live status |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------- | ----------- |
| `listing-images` | Bucket migrations and frontend/function uploads | Preserve paths, MIME types, checksums, media retention metadata | Unknown     |
| `avatars`        | Bucket migration and profile upload path        | Preserve user linkage and access policy                         | Unknown     |

## Function-to-data relationships observed

The repository mapping identifies these important relationships:

- `analyze-item` -> `usage_tracking`, `spot_price_cache`, `gemini_usage`
- `ebay-publish` -> `listing-images`, `profiles`
- `ebay-competitor-search` -> `competitor_prices`
- `category-lookup`, `setup-categories` -> `category_mappings`
- `transcribe-voice` -> `gemini_usage`
- `create-checkout` -> `profiles`
- `stripe-webhook` -> `profiles`, `subscriptions`
- `check-subscription` -> `subscriptions`, `profiles`
- `competitor-prices-cron` -> `competitor_prices`, `profiles`
- `cost-alert-cron` -> `gemini_usage`, `cost_alerts`
- `customer-portal` -> `profiles`
- `system-status` -> profiles and operational usage/cost tables

## Migration coverage observations

- Repository contains a long migration sequence through media retention and
  domain tracking, but this does not prove the live database matches it.
- Some migrations may be no-op or repair-oriented; compare migration history to
  live objects before creating a clean target project.
- `supabase/config.toml` is linked to project ref `wcednzaxmxwfiijzmjmx`; confirm
  whether that project is shared production infrastructure.
- Function configuration currently sets `verify_jwt = false` for listed
  functions, including Stripe webhook behavior; review function by function.
- Storage public URL generation appears in frontend and functions; absolute old
  URLs must be identified before storage migration.

## Required live reconciliation

The user and AI should collect from the live Supabase project, without exposing
secret values:

- Tables, views, sequences, indexes, constraints, triggers, extensions, grants,
  roles, and RLS policies
- Auth users/identities/configuration and redirect settings
- Storage buckets, policies, object counts, bytes, paths, and checksums
- Deployed function names/versions, JWT settings, CORS, cron, and webhooks
- Objects present live but absent from migrations
