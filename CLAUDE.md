# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                    # Vite dev server (http://localhost:8080)
npm run build                  # Production build
npm run lint                   # ESLint
npm run format:check           # Prettier check (format to fix)
npm run test                   # Vitest unit tests, run once
npm run test:watch             # Vitest watch mode
npx vitest run path/to.test.ts # Run a single unit test file
npx vitest run -t "test name"  # Run tests matching a name

npm run test:e2e               # Full Playwright E2E suite
npm run test:e2e:smoke         # Smoke tests only (used in PR CI)
npm run test:e2e:full          # Full lifecycle E2E
npx playwright test e2e/tests/smoke.spec.ts -g "test name"  # Single E2E test

npm run verify:coin-mandate    # eBay coin-condition mandate compliance check
node scripts/replay-corpus.mjs # Golden-corpus category replay (blocking CI gate)
```

Edge functions (Deno, in `supabase/functions/`) are linted/formatted/tested separately from the frontend:

```bash
deno fmt --check supabase/functions/
deno lint --config supabase/functions/deno.json supabase/functions/
deno check --config supabase/functions/deno.json supabase/functions/<fn>/index.ts
deno test --allow-env supabase/functions/_helpers/authGuard.test.ts   # example
```

On Windows, if `deno` hits TLS errors resolving `deno.land`/npm imports, prefix with `DENO_TLS_CA_STORE=system`. The npm registry (`registry.npmjs.org`) has been observed to be flaky/rate-limited from some dev sandboxes (intermittent 504s) — this is environmental, not a code problem; retry or defer to CI. `git config core.autocrlf=true` is common on Windows checkouts, which makes nearly the whole `supabase/functions/` tree show as "not formatted" under `deno fmt --check` due to CRLF line endings — that's a pre-existing local artifact, not a real formatting regression; don't try to "fix" it repo-wide.

No root `deno.json` — Deno config lives at `supabase/functions/deno.json` and only applies there.

Some dev sandboxes have no `node_modules/` installed and a corporate TLS proxy that makes `npm install`/`npx prettier` fail with `SELF_SIGNED_CERT_IN_CHAIN`, even with `DENO_TLS_CA_STORE=system` (that flag only affects Deno, not Node/npm). If `npx prettier --write <file>` fails that way, fall back to Prettier's standalone ESM bundle via Deno, which respects `DENO_TLS_CA_STORE=system` and works from `esm.sh`. For Markdown files, load the `babel`/`typescript`/`estree` plugins too, not just `markdown` — Prettier also reformats code inside fenced code blocks, and a markdown-only plugin set will silently skip that and disagree with the real CLI:

```ts
// run: DENO_TLS_CA_STORE=system deno run -A fmt-md.ts <file>
import * as prettier from "https://esm.sh/prettier@3.9.6/standalone?target=es2022";
import * as markdown from "https://esm.sh/prettier@3.9.6/plugins/markdown?target=es2022";
import * as babel from "https://esm.sh/prettier@3.9.6/plugins/babel?target=es2022";
import * as typescript from "https://esm.sh/prettier@3.9.6/plugins/typescript?target=es2022";
import * as estree from "https://esm.sh/prettier@3.9.6/plugins/estree?target=es2022";
const path = Deno.args[0];
const out = await prettier.format(await Deno.readTextFile(path), {
  parser: "markdown",
  plugins: [markdown, babel, typescript, estree],
});
await Deno.writeTextFile(path, out);
```

Pin the prettier version to match `package.json`'s (`^3.9.6` at last check) — a version mismatch between this workaround and the real CLI can itself produce a different, spurious diff.

(The default esm.sh build for `prettier/standalone` breaks under Deno with a `createRequire` error — the `?target=es2022` query param avoids it.) Delete the script after use; don't commit it, and don't leave stray `deno.lock` entries for it — `git checkout HEAD -- deno.lock` if a one-off script pollutes the lockfile with deps nothing actually imports.

### Before committing

Always run the relevant formatters/linters before pushing — CI blocks on both, and each has caught real issues that looked fine by eye:

- Frontend/docs changes: `npm run format:check` (or `prettier --write <file>` per the fallback above if npm/npx can't reach the registry)
- Any `supabase/functions/**` change: `deno fmt --check supabase/functions/<touched-dir>` and `deno lint --config supabase/functions/deno.json supabase/functions/<touched-dir>`

## Architecture

Two-tier app: a Vite/React SPA frontend and Supabase Edge Functions (Deno) backend, sharing one Postgres database with RLS.

### Frontend: v1 vs v2

`src/pages/` is the legacy (v1) UI: auth, landing, legal pages, and older core logic — still active, not dead code. `src/v2/pages/` and `src/v2/components/` are the current UI redesign (glassmorphism, mobile-first) and where most active feature work happens. `src/v2/pages/_archive/` holds retired v2 pages kept for reference; exclude it from brand/lint scans and don't assume its imports are live. When editing a feature, check both trees — some flows (e.g. `ebay-publish` actions) are called from both v1 and v2 pages.

### AI analysis pipeline (`supabase/functions/analyze-item`)

A six-stage pipeline, not a single AI call: (1) item identification via Gemini multimodal analysis of images/video frames, (2) category resolution — eBay Taxonomy API lookup first, falling back to deterministic domain/metal-type rules if that fails or is suppressed, (3) aspects fetch for the resolved category (cached 7 days in `category_aspects_cache`), (4) listing generation using a domain-specific system prompt, (5) post-lookup category verification against the AI-generated title, with metal-type compatibility checks, (6) item-specifics regeneration if category changed after stage 4. A sub-agent architecture under `supabase/functions/_helpers/agent-system/` (controller → registry → visual-agent / market-agent, keyed by a 12-vertical domain registry) drives domain-specific logic. RAG grounding (pgvector `knowledge_base` table, `_helpers/rag/`) reduces hallucination on factual attributes like coin grade/composition. Because of this multi-stage design, a change to category resolution or domain prompts can have effects that only show up several stages later — trace the full pipeline, not just the entry point, before changing shared logic here.

### Category resolution (`supabase/functions/category-lookup`)

Rewritten as **filter-then-rank with no numeric score** (Category Resolver v2, PRs #529–533 + #546). The old design ranked candidates before knowing any were viable and then shipped the best of the rejects; the current one gathers candidates from four sources (`user_verified`/`db_exact` rows in `category_mappings`, eBay `getCategorySuggestions`, a DB fuzzy match, Gemini fallback), puts each through four gates, then picks a winner by **precedence** in `resolverCore.ts` (`user_verified` > eBay's #1 surviving suggestion > `NEEDS_CONFIRMATION`). There is deliberately no arithmetic in the decision path — if nothing survives, the resolver returns `needsConfirmation: true` and asks the user rather than guessing. Don't reintroduce a score.

The gates: (1) leaf existence and (2) active status, both cache-first against `ebay_taxonomy_cache` with a 7-day freshness window (`CACHE_STALE_DAYS`) falling back to a live `getCategorySubtree` call; (3) condition-code compatibility; (4) required-aspect satisfiability. **Gate 4 is warn-only** behind `CATEGORY_GATE4_ENFORCE` — it collects `gate4Warnings` but never drops a candidate. Promoting it to enforcing is tracked as Phase 6 in `todo.md` and is gated on reviewing accumulated warn-only data for false positives first.

**`ebay_taxonomy_cache` is the only source of truth for "does this category exist and is it a leaf."** Every hardcoded category-ID list in this codebase is a liability with a dated, real failure behind it — an audit found six IDs in `analyze-item`'s AI prompt and most of `leafCategoryGuard.ts`'s blocklist that eBay had already retired, plus non-leaf rollups (`99`, `256`, `45243`) being assigned as publish targets, plus three entries (`3390` Irish coins, `20713` Refrigerators, `139971` Video Game Consoles) that were blocked while being perfectly valid live leaves — each mislabeled by its own comment. Prefer querying the cache over extending a list, and validate any ID you do add against `corpus/ebay_taxonomy_snapshot.json` first.

**The parent/rollup blocklist is consolidated — `KNOWN_PARENT_CATEGORY_IDS` in `_helpers/leafCategoryGuard.ts` is the single source of truth.** Call `isKnownParentCategoryId()` rather than declaring a local set; `category-lookup`'s persist gate and `analyze-item`'s post-lookup override both do. Three duplicate copies were deleted (2026-08-31), one of which had been dead code for four months while its live inline twin drifted. **Do not convert that Set literal into an import, rename it, or move the file** — `scripts/replay-corpus.mjs` and `scripts/refresh-taxonomy-snapshot.mjs` both read it as _text_, scraping IDs by constant name, and a re-import breaks the blocking corpus gate silently.

**The stale-ID disease turned out to be systemic across the coin/bullion vertical, not confined to one list (2026-09-01).** The same class of bug — dead IDs, and worse, _live leaves silently reassigned to a different domain_ (`40150` resolves to Action Figures, not Roosevelt Dime) — has been found and fixed across every layer of the pipeline: the AI prompt (`_helpers/domainPrompts.ts`'s `buildCoinBullionPrompt()`), the frontend confirm dialog's breadcrumb map (`src/lib/ebayCategoryMap.ts`, checked _before_ any live verification — the most dangerous instance, a stale hit reports "valid" with no real check ever firing), `analyze-item`'s domain-mismatch check and deterministic fallback (`COINS_PAPER_MONEY_IDS`, `resolveDomainFallbackCategory()`), the publish pipeline's condition/aspect classifier (`ebay-publish/publish-helpers.ts`'s `HARDCODED_COIN_CATEGORY_IDS`/`HARDCODED_BULLION_CATEGORY_IDS`, plus a regex catch-all that used to classify _any_ ID in a whole numeric range as bullion), the frontend's manual-override domain classifier (`src/types/listing.ts`'s `COIN_CATEGORY_IDS`/`BULLION_CATEGORY_IDS` — a wrong classification here **hard-blocks publish**, not just cosmetic), and the Tier-4 emergency bootstrap (`_helpers/suggestedCategories.ts`'s `_LEGACY_BOOTSTRAP_BREADCRUMBS`, exported for testability, dangerous entries deleted rather than corrected per that file's own "shrink, don't maintain" policy). See `todo.md`'s two "stale coin-category-ID" entries for the full replacement table, the four regression tests added, and what's still flagged (`HARDCODED_TRADING_CARD_CATEGORY_IDS`/`TRADING_CARD_CATEGORY_IDS` — a different vertical — and a DB-persistence path that could make a stale label self-perpetuating). Every other domain (trading cards' own staleness aside, jewelry, electronics, etc.) has zero hardcoded category IDs in the AI prompt and cannot have this exact bug in that layer.

**Golden corpus + replay harness — `category-corpus-replay` is a blocking CI gate.** `corpus/golden_corpus.json` holds 18 cases (`must_resolve` / `must_not_regress` / `must_confirm` / `quarantine_needs_review`) replayed offline by `scripts/replay-corpus.mjs` against `corpus/ebay_taxonomy_snapshot.json`, a frozen 15,116-row export of the cache. Run it before pushing any change to category resolution, `leafCategoryGuard.ts`, or the AI prompt's category list — it needs no credentials and it has already caught a real gap that review missed. The snapshot is refreshed by the `refresh-taxonomy-snapshot` job in `category-taxonomy-sync.yml`, which runs after the weekly taxonomy sync, re-validates the corpus against live data, and opens a PR when the tree drifts. Plan and per-phase status: `CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md` and `todo.md`.

### eBay integration surface

`ebay-publish` (~5,400 lines, split across `auth.ts`, `publish.ts`, `publish-create-draft.ts`, `video.ts`, `supabase.ts`, `constants.ts`) handles OAuth token exchange/refresh/storage, draft publishing (inventory item → offer → publish), and video upload — routed through a single Edge Function with an `action` field rather than separate functions per operation. Business policies, taxonomy, competitor search, and listings retrieval are separate functions. Server-to-server calls between these functions (e.g. `analyze-item` → `category-lookup`/`ebay-competitor-search`/`spot-prices`, `auto-reprice-cron`/`competitor-prices-cron` → `ebay-listings`) authenticate with the Supabase **service-role key as a Bearer token**, not a user JWT — this matters when touching auth on any function, since gating "any logged-in user" only will break these internal callers. Trace `grep -rn "functions/v1/<name>"` across `supabase/functions/` before changing a function's auth requirements.

**Competitor pricing redesigned (PR #511, 2026-08-18):** `competitor-prices-cron` no longer loops per-user or calls `ebay-listings` directly. New architecture: `inventory-sync-cron` (scheduled every 15 min) populates `user_active_listings` cache via `ebayInventorySync.ts`, then `competitor-prices-cron` (scheduled every 5 min) reads a fairness-ranked batch via RPC `get_next_competitor_price_batch`. This fixes the original WORKER_RESOURCE_LIMIT crash that came from processing stale inventory in a single invocation. See `COMPETITOR_PRICES_CRON_SESSION_HANDOFF.md` for full detail (PR #511 also fixed open bugs found during rollout).

### Auth pattern for Edge Functions

`supabase/config.toml`'s `verify_jwt = false` on a function does **not** mean it's unauthenticated — many of these functions do their own JWT check in code (`analyze-item`, `create-checkout`, `ebay-user`, etc.), and `stripe-webhook` correctly verifies the `Stripe-Signature` header instead. Auth hardening completed (PR #462): `supabase/functions/_helpers/authGuard.ts` provides three composable checks — `requireUser` (real end-user only), `requireUserOrServiceRole` (frontend users + internal service-role callers), `requireServiceRole` (cron/service-only) — use these for any new function rather than hand-rolling a JWT check. All 15 `verify_jwt = false` functions are now traced and gated appropriately. Pick the pattern by checking the function's actual caller graph (frontend `supabase.functions.invoke` calls carry the user's JWT automatically; internal Edge Function calls typically carry the service-role key) — don't assume "frontend-only" without grepping for internal callers first.

### Database

Two logical groups live in the **same live Supabase project** historically shared with an unrelated CRM product (see Rebrand section below) — but in this repo's own migrations, the schema is listing-app-only: `profiles`/`organizations`/`org_members` (identity), `drafts`/`subscriptions` (listings + billing), `user_active_listings` (listings cache for crons, PR #511), `usage_tracking`/`gemini_usage` (billing/usage), `spot_price_cache`/`competitor_prices`/`market_price_history`/`market_watches` (market data), `category_mappings`/`category_aspects_cache`/`ebay_taxonomy_cache`/`lookup_decisions` (taxonomy), `listing_cogs`/`listing_financials`/`knowledge_base` (financials/RAG), `reprice_rules`/`optimization_history` (auto-reprice, now tracked in migrations as of PR #518). RLS is enabled on all user-scoped tables. Migrations are timestamped SQL in `supabase/migrations/`; schema drift from PR #518 reconciled most production-only columns/constraints, including `drafts` and `subscriptions` alignment — the live schema now matches migrations closely. eBay OAuth tokens are encrypted at rest (`ebay_access_token`, `ebay_refresh_token` use `v1:` prefix for encrypted values).

### CI/CD

`deploy-functions.yml` pushes DB migrations (`supabase db push --yes --include-all`) and deploys functions to the `Production` GitHub environment on push to `main` — there is currently no manual approval gate on this, and several functions deploy with `--no-verify-jwt`. Treat changes that touch migrations or function config as higher-risk than pure frontend changes for this reason.

## Rebrand & migration in progress — read before touching infra or auth

This repo ("Sovereign Listing Suite" internally, eBay listing app externally) is mid-migration to a new product, **ListrAssistr**, moving to a separate private repo (`twinwicksllc/listrassistr-official`). Full plan: `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`.

**Phase 0 closed 2026-08-25 (DEC-0035).** Detailed Phase 0 work: `REBRAND_PHASE_0_EXCEPTION_LOG.md` (final findings and resolutions). **Phase 1 active** — current status: `REBRAND_PHASE_0_SESSION_HANDOFF.md` (most recent snapshot, 2026-08-28); action queue: `REBRAND_PHASE_1_TODO.md` (Section 5 is authoritative next-actions list); evidence/checklists: `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md`, `REBRAND_PHASE_1_RUNBOOKS.md`.

- **This repo stays live and legacy** until cutover is explicitly approved by the user — no destructive changes here for migration purposes.
- **Critical:** the linked Supabase project (`wcednzaxmxwfiijzmjmx`, `RankedCEO-CRM`) is shared production infrastructure between this eBay listing app and an unrelated CRM product — same database, one shared admin account. If you ever see or generate a schema/data export from this project, expect a large CRM schema (`accounts`, `contacts`, `deals`, `campaigns`, `commissions`, `tenants`, etc.) alongside the listing tables — never treat that as this app's data.
- Never request, print, or write secret values, tokens, password hashes, or customer data into chat, commits, or docs — only names/locations. The user enters values directly into provider dashboards.
- Treat any production/provider-account/DNS/Stripe/eBay/Supabase change, data export, or destructive action as requiring explicit user approval first, even if it seems implied by the plan documents.

## Working agreements

- **Never push directly to `main`.** Always create a branch and open a PR. Existing branch prefixes: `fix/`, `feat/`/`feature/`, `docs/`, `perf/`, `rebrand/`.
- `gh` CLI is not installed by default in this environment and has no stored GitHub auth — don't attempt to extract credentials from Git Credential Manager to work around this; either install `gh` and let the user complete `gh auth login` interactively, or hand the user a prefilled `github.com/.../compare/...?quick_pull=1&title=...&body=...` URL to open the PR themselves.
