# CONTEXT.md — listing-assistant-pro

> **Purpose:** Stable architecture reference. Contains the facts an AI assistant needs to work effectively across sessions — tech stack, key file map, secrets layout, and critical design decisions. Update when architecture changes, not every session.

---

## Project Overview

**listing-assistant-pro** is a production SaaS app that helps sellers create, optimize, and publish eBay listings. It uses AI to analyze items, generate titles/descriptions, recommend pricing, and handle the full eBay Inventory API publish flow including aspect (item specific) building, coin condition mandates, and category-specific requirements.

- **Live URL:** https://listing-assistant-pro.vercel.app
- **Repository:** https://github.com/twinwicksllc/listing-assistant-pro
- **Primary language:** TypeScript

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| UI Components | shadcn/ui |
| Backend | Supabase (PostgreSQL + Edge Functions) |
| Edge Function runtime | Deno (TypeScript) |
| Auth | Supabase Auth |
| Payments | Stripe (in progress) |
| Deployment (frontend) | Vercel |
| Deployment (functions) | Supabase CLI via GitHub Actions |
| CI/CD | GitHub Actions (`.github/workflows/`) |
| Testing | Vitest (unit), Playwright (e2e) |

---

## Repository Structure

```
listing-assistant-pro/
├── src/                        # React frontend
│   ├── pages/                  # Route-level page components
│   ├── components/             # Shared UI components
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Supabase client, utilities
│   └── types/                  # TypeScript types
├── supabase/
│   ├── functions/              # 36 Deno Edge Functions
│   │   ├── ebay-publish/       # ⚠️ Main publish function (~5100 lines)
│   │   ├── ebay-listings/      # List/sync eBay listings
│   │   ├── ebay-policies/      # Fetch eBay shipping/payment/return policies
│   │   ├── ebay-pricing/       # Pricing research
│   │   ├── analyze-item/       # AI item analysis
│   │   ├── optimize-listing/   # AI description optimizer
│   │   ├── create-checkout/    # Stripe checkout session
│   │   ├── stripe-webhook/     # Stripe event handler
│   │   ├── check-subscription/ # Subscription status gate
│   │   ├── auto-reprice-cron/  # Scheduled repricing
│   │   ├── bulk-publish/       # Bulk listing publish
│   │   └── ... (36 total)
│   └── migrations/             # SQL migration files
├── .github/
│   └── workflows/
│       ├── deploy-functions.yml  # Deploy edge functions on push to main
│       ├── e2e-full-lifecycle.yml
│       ├── e2e-pr-smoke.yml
│       └── test.yml
├── docs/                       # Additional documentation
├── e2e/                        # Playwright e2e tests
└── tools/                      # Dev/analysis scripts
```

---

## Key File: `supabase/functions/ebay-publish/index.ts`

This is the most critical and largest file (~5100 lines). Key exports and sections:

| Symbol | Line (approx) | Purpose |
|--------|---------------|---------|
| `COIN_FIXED_VALUES_ALLOWED_IDS` | ~344 | Set of category IDs that get hardcoded `fixedValues` (Composition, etc.) |
| `CATEGORY_ASPECT_RULES` | ~374 | Hardcoded aspect rules per eBay category — `required`, `preferred`, `defaults`, `fixedValues` |
| `convertEbayAspectsToRule()` | ~110 | Converts dynamic DB/API aspects to rule format; auto-defaults SELECTION_ONLY with 1 value |
| `isGrainBar()` | ~3669 | Override: forces `finalCategoryId = "3360"` for fractional grain bar listings |
| `buildAndNormalizeAspects()` | ~3787 | Builds eBay aspects from itemSpecifics + category rule; fills defaults for required aspects |
| Certification bridge | ~3815 | Derives `Certification` from `_coinConditionDetail` if not set by rule/specifics |
| `conditionDescriptors` fetch | ~4158 | Fetches coin condition descriptors from eBay; distinguishes API exception vs. 0 results |

### Category Aspect Rule Design
- Hardcoded rules in `CATEGORY_ASPECT_RULES` are merged with dynamic rules from `category_aspects_cache` DB table
- Dynamic rules fetched from eBay Taxonomy API are cached in DB
- `convertEbayAspectsToRule()` cannot auto-default `Certification` (multiple valid values) — must be in hardcoded `defaults` or bridge logic
- Categories without entries in `CATEGORY_ASPECT_RULES` fall through to `__empty__` (no required, no defaults)

### eBay Coin Condition Detail
- Stored in `itemSpecifics._coinConditionDetail`
- Shape: `{ type: "raw" | "graded", graded?: { company: string, grade?: string, certNumber?: string } }`
- Used by the Certification bridge (type=raw → "Uncertified", type=graded → company name e.g. "PCGS")

---

## GitHub Actions — Deploy Pipeline

**File:** `.github/workflows/deploy-functions.yml`
**Trigger:** Push to `main` with changes in `supabase/functions/**`

**Important:** The `Push Database Migrations` step runs with:
```yaml
continue-on-error: true
timeout-minutes: 2
```
This is **intentional** — `supabase db push` requires a direct PostgreSQL connection (`SUPABASE_DB_URL`) which is not available in GitHub Actions (only `SUPABASE_ACCESS_TOKEN` is set). Without this, the step hangs indefinitely at `Initialising login role...`. Schema changes must be applied manually.

---

## Environment Variables / Secrets

### Supabase Edge Functions (set in Supabase dashboard)
- `OPENAI_API_KEY` — AI description/analysis generation
- `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` — eBay API OAuth
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Stripe
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase access

### GitHub Actions Secrets
- `SUPABASE_ACCESS_TOKEN` — Supabase CLI auth (function deploy only, not DB push)
- `SUPABASE_PROJECT_REF` — Project reference ID
- `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` — Vercel deploy

### Frontend (Vercel env vars)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY`

---

## Supabase Database — Key Tables

| Table | Purpose |
|-------|---------|
| `listings` | Core listing records with itemSpecifics JSON |
| `ebay_tokens` | Per-user eBay OAuth tokens |
| `category_aspects_cache` | Cached eBay taxonomy aspect rules per category |
| `subscriptions` | Stripe subscription state |
| `users` | Supabase auth users + profile |

---

## Stripe Pricing Tiers

| Tier | Monthly | Annual |
|------|---------|--------|
| Starter | $19/mo | $190/yr |
| Pro | $49/mo | $490/yr |
| Shop | $99/mo | $990/yr |

---

## eBay Category Quick Reference

| Category ID | Name | Notes |
|-------------|------|-------|
| 41109 | Proof Sets | Coin condition descriptors required |
| 3360 | Silver Bars & Rounds (grain bar) | Set by `isGrainBar()` override; Certification required |
| 3361 | Silver Bars & Rounds | Standard bullion |
| 178906 | Gold Bars | `CATEGORY_ASPECT_RULES` entry exists but empty required/defaults |
| 39489 | Silver Bars | Same as above — watch for future Certification requirement |

---

## Critical Design Decisions

1. **No direct DB access from GitHub Actions.** Migration step must be manual. See deploy pipeline section.
2. **`isGrainBar()` uses title keyword matching.** Risk of false-positives on multi-word titles. Revisit before adding more grain-bar-specific logic.
3. **`ebay-publish/index.ts` is a monolith by design** (initially). Splitting is planned but requires careful module boundary design to avoid circular deps in Deno.
4. **IDOR protection added in PR #360.** Verify listing ownership before any publish/update operation — uses `user_id` check on `listings` table.
5. **Aspect rules are layered:** hardcoded `CATEGORY_ASPECT_RULES` → merged with dynamic DB cache → itemSpecifics override → Certification bridge fallback.

---

_Last updated: 2026-06-04_
