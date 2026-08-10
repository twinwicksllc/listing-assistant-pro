# Rebrand Phase 0 Exception Log

**Product:** ListrAssistr  
**Source repository:** `twinwicksllc/listing-assistant-pro`  
**Discovery date:** 2026-08-10  
**Status:** Open; repository findings recorded, live verification pending

## Exception rules

An exception is any unexplained difference, unverified provider fact, ownership
ambiguity, security concern, or migration risk. No exception is closed by an AI
assumption. The user closes, accepts, or assigns each exception after evidence is
reviewed.

| ID       | Finding                                                                                                                        | Impact                             | Evidence                                       | Owner     | Status / next action                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| RBR-0001 | Supabase project `wcednzaxmxwfiijzmjmx` is shared production infrastructure for RankedCEO CRM and the eBay listing application | High: wrong-project migration risk | Dashboard review and `supabase/config.toml`    | User + AI | Ownership confirmed; keep shared project intact and create a selective split plan       |
| RBR-0002 | Live schema may contain manual objects not represented by migrations                                                           | High: incomplete target schema     | Plan and repository findings                   | User + AI | Open; export live object inventory and schema diff                                      |
| RBR-0003 | Function config has broad `verify_jwt = false` entries                                                                         | High: authorization exposure       | `supabase/config.toml`                         | User + AI | Open; classify each endpoint and test auth/CORS                                         |
| RBR-0004 | Deployment workflow runs `supabase db push --yes --include-all` in Production                                                  | High: migration control risk       | `.github/workflows/deploy-functions.yml`       | User + AI | Open; review approvals and replace with gated process if approved                       |
| RBR-0005 | Provider secret names and environments are not verified from dashboards                                                        | High: cutover/configuration risk   | `.env.example`, workflows, function code       | User + AI | Open; collect names/owners/status only                                                  |
| RBR-0006 | Vercel project, domains, and environment configuration are not verified                                                        | Medium: deployment/cutover risk    | `vercel.json` and plan                         | User + AI | Open; inspect Vercel project settings                                                   |
| RBR-0007 | Stripe account, products, prices, webhooks, and routing are not verified                                                       | High: billing mutation risk        | Stripe Edge Functions and plan                 | User + AI | Open; inventory dashboard objects without changing them                                 |
| RBR-0008 | eBay app, RuName, scopes, and token migration compatibility are not verified                                                   | High: publishing/auth risk         | eBay functions and plan                        | User + AI | Open; inspect developer console and test environment                                    |
| RBR-0009 | Storage object counts, paths, checksums, and public/private policies are unknown                                               | High: media-loss risk              | `listing-images` and `avatars` code/migrations | User + AI | Open; create manifest and restore rehearsal                                             |
| RBR-0010 | User migration cohort and organization closure are not yet defined from live data                                              | High: ownership/RLS risk           | Migration plan                                 | User + AI | Open; write deterministic query after schema inventory                                  |
| RBR-0011 | `listrassistr-official` access and target-repository contents require user confirmation                                        | Medium: parallel-development risk  | New repository setup                           | User      | Open; confirm repo access, branch, and deployment settings                              |
| RBR-0012 | Historical/archived legacy brand references remain in plan, discovery evidence, and archived source                            | Low: false-positive scan risk      | Repository search                              | User + AI | Open; maintain explicit scan exclusions; do not erase historical evidence               |
| RBR-0013 | Approximately 10 legacy Auth users are mostly product-specific, but the owner/admin account is shared across products          | High: identity/cohort/RLS risk     | Supabase Auth dashboard review                 | User + AI | Open; classify the shared account and confirm the ListrAssistr cohort before any export |

## Closure requirements

Close an exception only when evidence is attached or referenced, the user has
approved the decision where required, and any follow-up task has an owner. High-
impact exceptions require explicit user approval before Phase 1/3/4/6/7 gates.
