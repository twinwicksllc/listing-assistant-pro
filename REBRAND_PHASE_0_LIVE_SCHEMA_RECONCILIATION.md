# Rebrand Phase 0 Live Schema Reconciliation

**Product:** ListrAssistr  
**Source repository:** `twinwicksllc/listing-assistant-pro`  
**Live project:** `RankedCEO-CRM` (`wcednzaxmxwfiijzmjmx`)  
**Discovery date:** 2026-08-10  
**Status:** Classification complete at object-name and RLS-metadata level; ownership, definition, and migration cohort approval remain open

## Evidence and limits

This reconciliation uses the owner-provided comma-delimited Supabase dashboard export and repository migrations/functions. The export establishes object names, object types, RLS enabled/disabled state, bucket names, and policy metadata (name, role, command). It does **not** establish columns, foreign keys, indexes, triggers, policy expressions, row counts, object counts, storage bytes, cron schedules, function versions, or data ownership.

No production changes were made. No customer rows, secrets, tokens, password material, or storage paths are included here.

## Classification vocabulary

- **ListrAssistr candidate:** evidence indicates eBay listing workflow ownership; include only after cohort and dependency review.
- **CRM-only:** evidence indicates RankedCEO CRM ownership; exclude from the ListrAssistr migration cohort unless explicitly approved.
- **Shared/ambiguous:** identity, billing, platform, or AI/support data may cross product boundaries; require an owner decision and dependency evidence.
- **System-managed:** Supabase-managed schemas or operational tables; do not copy as application data.
- **Live-only:** present in the live export but not located in the current repository migrations; schema and ownership must be captured before any selective export.

## Live object classification

### `public` ListrAssistr candidates

| Objects                                                                                                          | Evidence                                                                 | Migration status                                                                                                     | Next action                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `drafts`                                                                                                         | Repository CRUD, draft lifecycle, organization-aware policies            | Repository-backed; live policy set is broader/different in names and roles                                           | Compare columns, dependencies, and policy expressions; select approved listing cohort            |
| `ebay_tokens`                                                                                                    | Repository eBay OAuth functions and token migrations                     | Repository-backed                                                                                                    | Treat as sensitive; confirm owner mapping and re-authentication/secret handling                  |
| `category_mappings`, `category_aspects_cache`, `category_hygiene_log`, `lookup_decisions`, `ebay_taxonomy_cache` | Repository taxonomy functions and migrations                             | Repository-backed                                                                                                    | Separate canonical/reference rows from user-owned rows; verify service-role-only writes          |
| `competitor_prices`, `market_watches`, `market_price_history`, `spot_price_cache`                                | Repository competitor, market-watch, and spot-price functions/migrations | Repository-backed                                                                                                    | Separate global cache/history from user-owned watches and validate retention                     |
| `reprice_rules`, `optimization_history`                                                                          | Live policy names and repository reprice/optimization references         | `reprice_rules` is live-only relative to migration scan; `optimization_history` requires repository definition check | Capture definitions and classify by listing/user ownership before migration                      |
| `listing_cogs`, `listing_financials`                                                                             | Repository listing financial migrations and live policies                | Repository-backed                                                                                                    | Preserve only approved listing records; reconcile listing foreign keys and financial sensitivity |
| `listing-images` bucket                                                                                          | Repository bucket migrations and live storage bucket                     | Repository-backed; live bucket is public                                                                             | Export a manifest and policy/object review; do not copy objects without cohort approval          |
| `client_uploaded_assets`, `client_variant_edit_events`, `client_domain_change_requests`                          | Live names and client-asset/site workflow policy names                   | Live-only relative to current listing migrations; likely CRM/client-site surface                                     | Obtain definitions and product owner decision; default to CRM/shared exclusion                   |

### `public` CRM-only candidates

The following live objects are classified as CRM-owned from their names and policy families: `accounts`, `activities`, `appointments`, `agent_conversations`, `campaign_analytics`, `campaign_emails`, `campaign_sequence_executions`, `campaign_sequences`, `campaigns`, `calendly_connections`, `companies`, `contacts`, `deals`, `email_domains`, `email_messages`, `email_templates`, `email_threads`, `form_fields`, `form_submissions`, `forms`, `industry_leads`, `lead_assignments`, `lead_sources`, `leads`, `messages`, `pipeline_stages`, `pipelines`, `qualified_leads_global`, `sequence_steps`, `suppression_list`, and `audits`.

The following are also CRM or CRM-platform candidates and must remain out of an automatic listing migration: `commission_events`, `commission_payouts`, `commission_rates`, `commission_schemes`, `commissions`, `crm_billing_events`, `crm_subscriptions`, `domain_requests`, `site_templates`, `smile_assessments`, `tenant_site_config`, `tenant_site_deployments`, `tenant_site_variants`, `tenant_site_versions`, and `tenants`.

This classification is intentionally conservative. It is based on names and policy text, not row-level inspection. `companies` and `accounts` require special care because their names could be used as higher-level ownership entities by either product.

### `public` shared or ambiguous

| Objects                                                                                                                                                          | Why unresolved                                                                                    | Required decision                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `profiles`, `users`                                                                                                                                              | Identity/profile records; live owner/admin account spans both products                            | Define identity mapping, roles, and explicit cohort; preserve UUID relationships only for approved users |
| `organizations`, `org_members`, `org_invitations`                                                                                                                | Repository-backed organization model, but live organizations may belong to CRM, listings, or both | Classify organizations and membership closure before export                                              |
| `subscriptions`, `billing_usage`, `usage_tracking`, `gemini_usage`, `cost_alerts`                                                                                | Billing and AI/usage records may be product-specific or shared                                    | Map provider/customer/product IDs and decide retention; avoid copying secrets or unrelated billing data  |
| `knowledge_base`                                                                                                                                                 | Repository-backed RAG table, but source ownership and audience are unclear                        | Classify source documents and embeddings; migrate only approved ListrAssistr content                     |
| `support_tickets`, `notification_log`, `audit_logs`                                                                                                              | Operational/support data may contain both products and private customer information               | Define retention and product filter; default to exclusion until filtered                                 |
| `feature_importance`, `model_performance`, `model_readiness`, `prediction_history`, `ai_insights`, `ai_model_performance`, `ai_scoring_history`, `training_jobs` | Model/analytics names do not identify product ownership                                           | Determine model, account, and source-product keys before classification                                  |
| `test_items`                                                                                                                                                     | Repository test table exists, but live rows may be operational test data                          | Exclude from production cohort unless explicitly needed for QA                                           |
| `domain_quality_metrics` view                                                                                                                                    | Live view with no repository table migration identified                                           | Capture view definition and dependencies; classify from underlying source tables                         |

### System-managed schemas and objects

Exclude these from application-data migration. Record them for target-environment provisioning and security review only:

- `auth`: `audit_log_entries`, `custom_oauth_providers`, `flow_state`, `identities`, `instances`, `mfa_amr_claims`, `mfa_challenges`, `mfa_factors`, `oauth_authorizations`, `oauth_client_states`, `oauth_clients`, `oauth_consents`, `one_time_tokens`, `refresh_tokens`, `saml_providers`, `saml_relay_states`, `schema_migrations`, `sessions`, `sso_domains`, `sso_providers`, `users`, `webauthn_challenges`, and `webauthn_credentials`.
- `cron`: `job`, `job_run_details`.
- `net`: `_http_response`, `http_request_queue`.
- `realtime`: `messages`, `schema_migrations`, `subscription`.
- `storage`: `buckets`, `buckets_analytics`, `buckets_vectors`, `migrations`, `objects`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`, and `vector_indexes`.
- `supabase_migrations.schema_migrations`, `vault.secrets`, `vault.decrypted_secrets`, and extension views `extensions.pg_stat_statements` and `extensions.pg_stat_statements_info`.

The `qa.qa_runs` and `qa.qa_scenarios` tables are operational QA objects. Recreate them from approved target migrations or fixtures, but do not treat their live rows as listing or CRM production data.

## Storage reconciliation

| Bucket           | Live status            | Repository status               | Classification                                   | Required evidence                                                                                               |
| ---------------- | ---------------------- | ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `avatars`        | Present; public bucket | Repository-backed               | Shared/identity                                  | Object manifest, owner mapping, and decision whether avatars are copied or re-created                           |
| `listing-images` | Present; public bucket | Repository-backed               | ListrAssistr candidate                           | Object manifest, listing/draft linkage, checksums, bytes, and public URL rewrite plan                           |
| `client-uploads` | Present; public bucket | Not found in listing migrations | CRM/client-site candidate; ownership unconfirmed | Bucket policy expressions, object inventory, source table linkage, and explicit exclusion or inclusion decision |

The export shows public-read policies for all three buckets. Policy names also show authenticated writes for avatars/listing images and service-role writes for `client-uploads`; expressions and object-level ownership still require a direct policy definition export.

## RLS policy reconciliation

The live export shows RLS enabled for all listed `public` application tables and for the relevant system tables. It also shows policy drift that must not be resolved by policy-name matching alone.

**Exact `pg_policies` expressions and `information_schema.role_table_grants` were pulled on 2026-08-13 for the listing-app and shared/ambiguous tables** (`drafts`, `ebay_tokens`, `profiles`, `organizations`, `org_members`, `org_invitations`, `category_mappings`, `category_aspects_cache`, `category_hygiene_log`, `lookup_decisions`, `ebay_taxonomy_cache`, `competitor_prices`, `market_watches`, `market_price_history`, `spot_price_cache`, `reprice_rules`, `optimization_history`, `listing_cogs`, `listing_financials`, `subscriptions`, `usage_tracking`, `gemini_usage`, `knowledge_base`, `test_items`). Findings:

- **False alarm resolved:** `roles = {public}` on a policy does not mean it's open to anonymous callers. For `drafts`, `ebay_tokens`, `competitor_prices`, `market_watches`, `optimization_history`, `reprice_rules`, `usage_tracking`, `gemini_usage`, and the `category_aspects_cache`/`category_hygiene_log`/`ebay_taxonomy_cache`/`lookup_decisions` "service role" policies, the actual `qual`/`with_check` correctly checks `auth.uid() = user_id` or `auth.role() = 'service_role'`. Standard Supabase table grants give `anon`/`authenticated` broad SQL privileges on these tables, but RLS is the real gate and it holds — `auth.uid()` is `NULL` for unauthenticated/anon-key-only requests, so these checks correctly deny them. This resolves the concern raised about `drafts.Users can manage own drafts` and the four cache/log tables.
- **Confirmed real gap, now fixed:** `market_price_history`'s `"Service role can insert history"` policy (`supabase/migrations/20260323000000_add_market_watches.sql`) was `FOR INSERT WITH CHECK (true)` with no role restriction and no `auth.role()` check — unlike its correctly-written siblings. Combined with the standard `anon` INSERT grant on this table (confirmed via `role_table_grants`), **any caller holding the public anon key could insert arbitrary rows into `market_price_history` for any `watch_id`, unauthenticated.** Fixed in `supabase/migrations/20260813000000_fix_market_price_history_insert_policy.sql` (`fix/market-price-history-insert-policy` branch) to require `auth.role() = 'service_role'`, matching the correct pattern elsewhere. Verified the sole writer, `market-watch-refresh`, already authenticates with the service-role key, so the fix doesn't break it. **Still needs applying to the live shared project** — this migration is written but not yet deployed to production; deploying it will happen via the existing `deploy-functions.yml` `db push` on merge to `main` (see RBR-0004 — no approval gate currently exists on that pipeline), so treat the merge itself as the production change and get explicit go-ahead first.
- **New finding, now fixed:** `market-watch-refresh` (the function that writes to `market_price_history`) had no `verify_jwt` override in `supabase/config.toml`, so it defaulted to gateway `verify_jwt = true` — but that only requires _a_ validly-signed JWT, and the public anon key satisfies that. It also had no code-level check, and trusted a client-supplied `userId` in its query filter instead of the verified session (the same pattern already fixed in `ebay-competitor-search`). Fixed by gating with `authGuard.ts`'s `requireUser` and using the verified `auth.userId` instead of `body.userId` — same branch as the `market_price_history` policy fix.
- Cleanup-only, not security issues: `drafts` carries both a legacy "manage own drafts" ALL policy and newer org-aware split CRUD policies (redundant, not permissive); `usage_tracking` has two near-duplicate SELECT policies.
- **`profiles` and `subscriptions` grants confirmed safe (2026-08-13 re-run):** both follow the standard Supabase pattern — broad `anon`/`authenticated`/`service_role` table grants, but every policy on both tables is scoped to `{authenticated}` only (none to `{public}`/`anon`), so `anon` connections match no policy for any command and are denied by default regardless of the grants. `market_price_history`'s grants were also re-confirmed broad (including `anon` INSERT), which is exactly why the policy fix above was necessary rather than optional.
- Still outstanding, not yet re-verified with exact expressions: the CRM-side duplicate-looking families (`Users can manage account data` / `manage_account_data_non_recursive`), the anonymous insert/read policies on CRM/public-intake tables (`audits`, `domain_requests`, `leads`, `smile_assessments`, tenant onboarding), and `storage.objects` policies for `client-uploads`.

## Cron and operational reconciliation

The export confirms that `cron.job` and `cron.job_run_details` exist and have RLS policies, but it does not contain individual job names, schedules, commands, enabled state, or run history. Repository evidence identifies scheduled work including auto-reprice, category hygiene, competitor prices, cost alerts, market-watch refresh, and media-retention cleanup. Capture the live job definitions and map each to a target owner before migration or shutdown planning.

## Migration decision

Do not migrate the shared project wholesale. The default target cohort is:

1. Approved ListrAssistr users and organizations only.
2. Listing drafts/listings, eBay connection records handled through approved re-authentication, listing media, listing financials, and listing-owned market/reprice data only.
3. Approved taxonomy/reference and knowledge data after source ownership review.
4. No CRM-only rows, CRM storage, CRM billing, CRM communications, or system-managed rows.

This is a planning classification, not authorization to export or mutate production. Phase 0 remains open until definitions, dependencies, row-level cohort queries, storage manifests, backup/restore evidence, RLS tests, cron definitions, and owner approvals are attached.
