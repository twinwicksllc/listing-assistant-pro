# Teckstart Listing Assistant

An AI-powered SaaS platform for creating, pricing, publishing, and managing optimized eBay listings — with deep specialization in coins, bullion, and precious-metals collectibles, and a modular architecture designed to scale across additional verticals.

## Live Demo

**URL**: https://lister.teckstart.com

---

## Overview

Teckstart Listing Assistant turns photos (and optional video or voice notes) into complete, eBay-ready listings. A multi-stage AI pipeline identifies the item, resolves the correct eBay category, fetches required item specifics, generates SEO-optimized titles and descriptions, and estimates fair-market pricing from recent sold comps — then publishes directly to eBay via the Inventory API.

Beyond single-item listing creation, the platform includes a full suite of seller tools: bulk listing via CSV/Excel upload, competitor market research, auto-repricing rules, cost-of-goods-sold (COGS) tracking, profit reporting, live precious-metals spot prices with melt-value protection, team/organization management, and a Stripe-powered subscription billing system with tier-based feature gating.

---

## Features

### AI Listing Generation

- **Multi-Stage Analysis Pipeline**: A six-pass AI pipeline (identification → category resolution → aspects fetch → listing generation → post-lookup verification → specifics regeneration) produces accurate, eBay-compliant listings rather than single-shot guesses
- **Modular Sub-Agent Architecture**: A controller orchestrates domain-specific visual and market sub-agents, with a central domain registry supporting 12 verticals (coins/bullion, trading cards, jewelry, electronics, vintage clothing, auto parts, sneakers, luxury handbags, musical instruments, toys/collectibles, home/garden/tools, and general)
- **RAG Knowledge Base**: pgvector-powered retrieval-augmented generation grounds coin grading and pricing decisions in a seeded knowledge base, reducing hallucination on factual attributes
- **Smart Pricing**: Automatic price range estimation based on recent sold eBay listings, with dynamic pricing informed by condition and market data
- **Melt Value Protection**: For precious metals (gold, silver, platinum), enforces pricing below intrinsic melt value using live spot prices
- **Live Spot Prices**: Real-time metal spot prices cached every 15 minutes and shared across all users
- **Slab Label OCR**: Specialized extraction of certification slab labels (PCGS, NGC, ANACS, ICG, PMG) for year, denomination, grade, cert number, and special designations
- **Metal-Type Enforcement**: Guards throughout the pipeline prevent cross-metal categorization errors (e.g., gold items in silver categories)

### Media Ingestion

- **Multi-Image Upload**: Analyze multiple photos of the same item from different angles
- **Video Support**: Record 5–10 second videos; frames are extracted and analyzed alongside photos
- **On-Device Image Optimization**: Canvas-based auto-cropping (background trimming), brightness/contrast/saturation normalization, and resolution targeting (1200px for AI analysis, 1600px for eBay publishing) — all performed client-side to save bandwidth
- **In-Browser Camera**: Full camera capture with torch/flash control, zoom, and front/back switching
- **Voice Notes**: Add voice context for AI to consider when generating listings; audio is transcribed server-side

### eBay Integration

- **Direct Publishing**: Full eBay Inventory API integration — creates inventory items with images and item specifics, creates offers with pricing and policies, and publishes listings, all from within the app
- **Taxonomy API**: Automated category discovery with multi-tier scoring (eBay API → user-verified DB → tier-based suggestions), intelligent caching (24-hour category cache, 7-day aspect cache), and comprehensive error recovery
- **Business Policies**: Fulfillment, payment, and return policy management with 24-hour caching and parallel fetching
- **eBay OAuth**: Secure token storage and refresh for connected eBay accounts; one-account enforcement for non-Unlimited users
- **Live Listings Management**: View and manage active eBay listings; sync sales and financial data

### Seller Tools

- **Bulk Listing**: Upload CSV/Excel files to create listings in batch, with tier-gated row caps, column mapping, and bulk AI description generation
- **Market Research**: Competitor price analysis with price histograms, trend charts, and detailed comp comparisons
- **Auto-Repricing**: Rule-based repricing engine supporting match-lowest, beat-lowest, match-average, and match-sold-average strategies with floor/ceiling constraints and category filtering
- **COGS & Profit Tracking**: Per-listing cost-of-goods-sold tracking, bulk COGS editing, historical COGS reports, and profit analytics fed by eBay transaction data
- **Market Watches**: Saved searches that monitor market price movements over time
- **Keyword Research**: AI-assisted keyword discovery for listing optimization

### Team & Billing

- **Organizations**: Team/organization management with member invitations and per-org usage quotas
- **Stripe Subscriptions**: Full billing system with checkout sessions, webhook-driven state sync, customer portal access, and tier-based feature gating
- **Usage Limits**: Per-organization rolling-window credit tracking with configurable reset days; free-tier (6 analyses/month), Pro (50/month), and Shop/Unlimited tiers
- **Admin Dashboard**: System-wide usage analytics (Gemini and OpenAI API consumption), feature usage tracking, and system status monitoring

### Platform

- **PWA Support**: Installable as a mobile app with offline capability via vite-plugin-pwa and Workbox
- **V2 UI Redesign**: Immersive upload experience with glassmorphism design, skeleton loaders, welcome tours, and a responsive mobile-first layout
- **Error Monitoring**: Sentry integration for production error tracking
- **Comprehensive Testing**: Unit tests (Vitest), E2E smoke tests and full-lifecycle tests (Playwright), and coin-condition validation suites

---

## Tech Stack

- **Frontend**: React 18 with TypeScript, Vite, Tailwind CSS + shadcn/ui (Radix UI primitives), React Router v6, TanStack React Query
- **Backend**: Supabase Edge Functions (Deno runtime)
- **Database**: Supabase PostgreSQL with Row Level Security (RLS), pgvector for RAG embeddings
- **AI**: Google Gemini API (multimodal, multi-pass)
- **Auth**: Supabase Auth (Google OAuth + Email/Password)
- **Payments**: Stripe (Checkout, Billing Portal, Webhooks)
- **Storage**: Supabase Storage (listing media + avatars, with RLS policies)
- **PWA**: vite-plugin-pwa with Workbox
- **Charts**: Recharts
- **Testing**: Vitest (unit), Playwright (E2E)
- **Deployment**: Vercel (frontend) + Supabase CLI (edge functions & migrations)

---

## Architecture

```
                    ┌───────────────────────────────────────────────┐
                    │              React 18 PWA (Vite)               │
                    │                                               │
                    │   Public: Landing, Login, Signup, Auth,       │
                    │           eBay Callback, Terms, Privacy       │
                    │                                               │
                    │   Protected (v2): Home, Analyze, Drafts,      │
                    │     Dashboard, Settings, Billing, Team,       │
                    │     Admin, Bulk, Market, Reprice Rules,       │
                    │     Profit Report, COGS Editor, Listings      │
                    └───────────────────────┬───────────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    │           Supabase Auth (JWT)                 │
                    │     Google OAuth · Email/Password · RBAC      │
                    └───────────────────────┬───────────────────────┘
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌─────────────────┐          ┌──────────────────────┐          ┌─────────────────────┐
│  Edge Functions │          │   Supabase Storage    │          │   Stripe Billing    │
│  (Deno)         │          │  (listing-media,      │          │  Checkout · Portal  │
│                 │          │   avatars, RLS)       │          │  Webhooks · Tiers   │
│  AI Pipeline    │          └──────────────────────┘          └─────────────────────┘
│  eBay APIs      │
│  Stripe Sync    │          ┌──────────────────────┐
│  Cron Jobs      │◄────────►│   eBay REST APIs     │
│  RAG Retrieval  │          │  Inventory · Taxonomy│
└────────┬────────┘          │  Browse · Fulfillment│
         │                   └──────────────────────┘
         ▼
┌──────────────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL                        │
│                                                              │
│  profiles · organizations · org_members · org_invitations    │
│  drafts · subscriptions · usage_tracking · spot_price_cache  │
│  ebay_tokens · competitor_prices · market_price_history      │
│  listing_cogs · listing_financials · market_watches          │
│  category_mappings · category_aspects_cache · ebay_taxonomy  │
│  knowledge_base (pgvector) · gemini_usage · cost_alerts      │
│  support_tickets · test_items · lookup_decisions             │
│  category_hygiene_log                                        │
│                                                              │
│  Row Level Security on all user-scoped tables                │
└──────────────────────────────────────────────────────────────┘
```

---

## AI Analysis Pipeline

The `analyze-item` edge function implements a sophisticated multi-stage AI analysis pipeline. A modular sub-agent architecture (controller + registry + visual-agent + market-agent) orchestrates the flow, with domain-specific logic for each supported vertical.

### Stage 1: Item Identification (Pass 1)

The controller calls Gemini to analyze all images (and video frames) to identify the item type, domain (coins/bullion vs. general collectibles vs. electronics, etc.), metal type, and keywords. An item embedding is pre-computed once and shared across downstream sub-agents to avoid duplicate API calls. Results inform all downstream category and attribute selection.

### Stage 2: Category Resolution (Pre-Lookup + Domain Fallback)

- **Pre-Lookup**: Uses Pass 1 keywords for eBay Taxonomy API lookup with multi-tier scoring (eBay API → user-verified DB → tier-based suggestions)
- **Domain Fallback**: If pre-lookup fails or is suppressed (e.g., "Action Figures" returned for "Silver Eagle"), resolves category deterministically from item type + metal detection (e.g., Silver + American Silver Eagle → 41111; Gold + bar/round → 178906). This guarantees Pass 2 receives the correct eBay category schema before AI generation

### Stage 3: Aspects Fetch

Retrieves eBay's required and optional item specifics (aspects) for the resolved category. Results are cached in the `category_aspects_cache` table (7-day TTL) to minimize API calls. Provides the JSON schema for Pass 2 AI generation.

### Stage 4: Listing Generation (Pass 2)

Uses Gemini with a domain-specific system prompt (from the domain registry). Context includes item images, identification results, competitor pricing, and category-specific requirements. Generates title, description, condition, price range, metal weight, and item specifics matching the schema.

### Stage 5: Post-Lookup Verification

If category wasn't locked in pre-lookup, uses the AI-generated title for a second eBay Taxonomy lookup as verification/override. Applies metal-type compatibility checks to prevent cross-metal assignments.

### Stage 6: Item Specifics Regeneration (Pass 2.5)

If category was corrected after Pass 2, item specifics may have been generated against the wrong schema. Gemini is called again with images + the correct category schema to regenerate only the item specifics. Falls back to surgical scrubbing if regeneration fails.

### Sub-Agent Architecture

- **Controller** (`controller.ts`): Orchestrates the sequential identification pass followed by a parallel burst of the visual and market sub-agents
- **Registry** (`registry.ts`): Central registry mapping each domain to its vision goals (zoom targets), grounding queries, and critical attributes
- **Visual Agent** (`visual-agent.ts`): Performs domain-specific visual inspection (e.g., reading slab labels for coins, model numbers for electronics)
- **Market Agent** (`market-agent.ts`): Performs RAG-grounded market analysis and category validation using the knowledge base
- **Domain Prompts** (`domainPrompts.ts`): Per-domain system prompts for Gemini

### RAG Knowledge Base

A pgvector-enabled `knowledge_base` table stores domain knowledge (coin grading standards, pricing references). The retriever (`rag/retriever.ts`) performs semantic search using item embeddings (`rag/embedding.ts`) to ground AI outputs in factual data, reducing hallucination on attributes like grade, composition, and fair market value.

See tests in `src/test/analyze-item-category-fallback.test.ts` for domain fallback behavior.

---

## Edge Functions

The backend consists of 33 Supabase Edge Functions (Deno runtime):

### AI & Analysis

| Function                     | Purpose                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `analyze-item`               | Multi-stage AI pipeline: image/video analysis → category resolution → listing generation |
| `transcribe-voice`           | Server-side audio transcription for voice notes                                          |
| `video-frame-extract`        | Extracts representative frames from uploaded videos for AI analysis                      |
| `bulk-generate-descriptions` | Batch AI description generation for bulk-listing workflows                               |

### eBay Integration

| Function                     | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `ebay-publish`               | Full Inventory API publishing: inventory item + offer + publish (5,380 lines) |
| `ebay-pricing`               | Fetches recent sold listings for price comparison                             |
| `ebay-policies`              | Fetches fulfillment, payment, and return business policies                    |
| `ebay-listings`              | Retrieves and manages the user's active eBay listings                         |
| `ebay-user`                  | eBay identity/account info for connected users                                |
| `ebay-competitor-search`     | Competitor listing search for market research                                 |
| `ebay-reprice`               | Applies repricing updates to live eBay listings (batched)                     |
| `disconnect-ebay`            | Revokes eBay OAuth connection                                                 |
| `category-lookup`            | eBay Taxonomy API category suggestions                                        |
| `sync-ebay-taxonomy`         | Bulk sync of eBay category taxonomy                                           |
| `setup-categories`           | Category setup and configuration                                              |
| `filter-comparable-listings` | Filters sold listings to find true comparables                                |

### Pricing & Market Data

| Function               | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `spot-prices`          | Fetches and caches live metal spot prices (15-min shared cache) |
| `keyword-research`     | AI-assisted keyword discovery for listing optimization          |
| `market-watch-refresh` | Refreshes saved market watch searches                           |
| `optimize-listing`     | AI-powered listing optimization suggestions                     |

### Bulk Operations

| Function       | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `bulk-publish` | Batch publish multiple listings to eBay (tier-gated row caps) |

### Billing & Subscriptions

| Function             | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `create-checkout`    | Creates Stripe Checkout sessions (Starter $19 / Pro $49 / Shop $99)           |
| `stripe-webhook`     | Handles Stripe events with signature verification; syncs subscription state   |
| `check-subscription` | Cache-first subscription status check (60-min TTL, falls back to live Stripe) |
| `customer-portal`    | Creates Stripe Billing Portal sessions for self-service management            |
| `get-free-credits`   | Returns tier, credits used, credits remaining, and limit status               |

### Automation (Cron)

| Function                 | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `auto-reprice-cron`      | Scheduled auto-repricing execution             |
| `auto-reprice-trigger`   | Manual trigger for auto-reprice operations     |
| `category-hygiene-cron`  | Scheduled category data validation and cleanup |
| `competitor-prices-cron` | Scheduled competitor price refresh             |
| `cost-alert-cron`        | Scheduled cost threshold alerting              |

### System

| Function        | Purpose                             |
| --------------- | ----------------------------------- |
| `system-status` | System health and status monitoring |
| `cogs-report`   | COGS and profit reporting data      |

---

## Database Schema

The PostgreSQL database includes 23 tables with Row Level Security on all user-scoped tables:

### User & Organization Management

- **`profiles`**: User profiles with display name, avatar, eBay connection metadata (`ebay_username`, `ebay_account_type`), and Stripe customer ID caching
- **`organizations`**: Team/organization management with per-org free-tier reset day
- **`org_members`**: Organization membership mappings
- **`org_invitations`**: Pending team invitations

### Listings & Drafts

- **`drafts`**: Saved listing drafts (title, description, price range, category, item specifics, condition, metal data, package dimensions, quantity, images, video)
- **`ebay_tokens`**: OAuth token storage for connected eBay accounts (access + refresh tokens with expiry)

### Billing & Usage

- **`subscriptions`**: Stripe subscription data (sub ID, customer ID, product ID, price ID, status, period end, cancel-at-period-end) with RLS
- **`usage_tracking`**: Per-org usage events for credit enforcement (action type, org affiliation, timestamps)
- **`gemini_usage`**: AI API consumption tracking
- **`cost_alerts`**: Cost threshold alerting

### Market Data & Pricing

- **`spot_price_cache`**: Shared 15-minute cache for live metal spot prices
- **`competitor_prices`**: Cached competitor pricing data with price distribution JSONB
- **`market_price_history`**: Historical market price tracking
- **`market_watches`**: Saved market search monitors

### Category & Taxonomy

- **`category_mappings`**: User-verified category mappings
- **`category_aspects_cache`**: eBay category aspects with 7-day TTL
- **`ebay_taxonomy_cache`**: Cached eBay taxonomy tree
- **`lookup_decisions`**: Category lookup decision audit trail
- **`category_hygiene_log`**: Category data validation run logs

### Financials & Analytics

- **`listing_cogs`**: Per-listing cost of goods sold
- **`listing_financials`**: eBay transaction financial data (sale price, shipping, fees, SKU)
- **`knowledge_base`**: pgvector-enabled RAG knowledge base for domain grounding
- **`support_tickets`**: User support ticket tracking
- **`test_items`**: Test fixtures for E2E testing

---

## Pricing Tiers

| Tier                 | Price  | AI Analyses/Month           | Bulk Rows | Key Features                                                                          |
| -------------------- | ------ | --------------------------- | --------- | ------------------------------------------------------------------------------------- |
| **Free (Starter)**   | $0     | 6 (per-org, rolling window) | 5         | Single-item listing, AI analysis, eBay publish                                        |
| **Pro**              | $49/mo | 50                          | 25–50     | All Free features + bulk listing, market research, auto-reprice                       |
| **Shop (Unlimited)** | $99/mo | Unlimited                   | 1,000     | All Pro features + unlimited analyses, team management, profit reports, COGS tracking |
| **Admin**            | —      | Unlimited                   | 1,000     | System administration, usage analytics, system status                                 |

Tier detection is performed via the `subscriptions` table's `product_id`, with a cache-first strategy (60-minute DB cache, falling back to live Stripe API). Free-tier credit windows reset on a configurable per-organization day-of-month, tracked via a PL/pgSQL function (`get_free_tier_window_start`).

---

## Getting Started Locally

### Prerequisites

- Node.js 18+ and npm
- A Supabase project with Google OAuth configured
- Google Gemini API key
- Stripe account (for billing features)
- eBay Developer account (for eBay API integration)

### Installation

```bash
# Clone the repository
git clone https://github.com/twinwicksllc/listing-assistant-pro.git
cd listing-assistant-pro

# Install dependencies
npm install

# Copy environment file and fill in your values
cp .env.example .env.local
```

### Environment Variables

Create a `.env.local` file (or `.env` for local Supabase CLI) with the following:

```env
# Supabase (public/anon keys — required for the frontend)
VITE_SUPABASE_PROJECT_ID=your_project_id_here
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
VITE_SUPABASE_URL=https://your-project-id.supabase.co
```

Additional secrets required on the Supabase project (set via Supabase dashboard or CLI):

- `GEMINI_API_KEY` — Google Gemini API key
- `STRIPE_SECRET_KEY` — Stripe secret key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `APP_URL` — Public app URL for Stripe redirect URLs
- eBay API credentials (client ID, client secret, dev ID, etc.)
- `SENTRY_DSN` — Sentry error monitoring (optional)

### Running the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:8080`

### Deploying Edge Functions & Migrations

```bash
# Link your Supabase project
supabase link --project-ref your-project-ref

# Push database migrations
supabase db push --yes --include-all

# Deploy edge functions
supabase functions deploy analyze-item --no-verify-jwt
supabase functions deploy ebay-publish --no-verify-jwt
# ... repeat for other functions as needed
```

---

## Testing

### Unit Tests

```bash
npm run test              # Run all unit tests (Vitest)
npm run test:watch        # Watch mode
```

### E2E Tests (Playwright)

```bash
npm run test:e2e          # Full E2E suite
npm run test:e2e:smoke    # Smoke tests only
npm run test:e2e:full     # Full lifecycle tests
npm run test:coin-validation  # Coin condition validation
npm run test:coin-e2e     # Coin condition E2E
```

### Coin Mandate Verification

```bash
npm run verify:coin-mandate    # Verify eBay coin condition mandate compliance
```

---

## CI/CD

Four GitHub Actions workflows automate the development pipeline:

| Workflow                | Trigger                                       | Purpose                                                     |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `test.yml`              | Push/PR                                       | Runs unit tests                                             |
| `e2e-pr-smoke.yml`      | Pull request                                  | Runs Playwright smoke tests against PR                      |
| `e2e-full-lifecycle.yml | Weekly (Mon 2AM UTC) + manual                 | Full lifecycle E2E tests with test user setup and cleanup   |
| `deploy-functions.yml`  | Push to `main` (functions/migrations changed) | Pushes DB migrations and deploys edge functions to Supabase |

Vercel automatically builds and deploys the frontend on push to `main`.

---

## Deployment

### Frontend (Vercel)

1. Connect the GitHub repository to Vercel
2. Set environment variables in the Vercel dashboard
3. Deploy — Vercel automatically builds on push to `main`

### Custom Domain

The app is configured for `lister.teckstart.com`. To use a custom domain:

1. Update the `start_url` in `vite.config.ts` PWA manifest
2. Configure the domain in Vercel settings
3. Update redirect URIs in Google Cloud Console (OAuth) and eBay Developer Portal

---

## Project Structure

```
listing-assistant-pro/
├── src/
│   ├── v2/                    # V2 UI redesign (active)
│   │   ├── pages/             # 15 v2 page components
│   │   ├── components/        # v2 shared components (AppShell, SideNav, etc.)
│   │   └── theme.ts           # v2 theme configuration
│   ├── pages/                 # Legacy/v1 pages (auth, landing, core logic)
│   ├── components/            # Shared UI components (analyze, admin, camera, etc.)
│   ├── hooks/                 # React hooks (auth, drafts, analysis, publish, etc.)
│   ├── lib/                   # Utilities (imageOptimizer, ebayCategoryMap, etc.)
│   ├── types/                 # TypeScript type definitions
│   ├── contexts/              # React contexts (AuthContext)
│   ├── integrations/          # Supabase client integration
│   └── test/                  # Unit tests
├── supabase/
│   ├── functions/             # 33 edge functions (Deno)
│   │   ├── _helpers/          # Shared helpers (agent-system, RAG, eBay, Sentry)
│   │   │   ├── agent-system/  # Sub-agent architecture (controller, registry, sub-agents)
│   │   │   └── rag/           # RAG embedding & retrieval
│   │   └── *.ts               # Individual edge function entry points
│   ├── migrations/            # SQL migrations (timestamped)
│   └── config.toml            # Supabase project configuration
├── e2e/                       # Playwright E2E tests & fixtures
├── scripts/                   # Utility scripts (test setup, seeding, etc.)
├── .github/workflows/         # CI/CD pipelines
└── package.json
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a pull request

---

## License

This project is proprietary software owned by Teckstart.
