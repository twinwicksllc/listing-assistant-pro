# CLAUDE.md

Guidance for Claude Code in this repository.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run format:check
npm run test
npm run test:watch
npx vitest run path/to.test.ts
npx vitest run -t "test name"

npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:full
npx playwright test e2e/tests/smoke.spec.ts -g "test name"

npm run verify:coin-mandate
node scripts/replay-corpus.mjs
```

Edge Functions (`supabase/functions/`) use Deno separately:

```bash
deno fmt --check supabase/functions/<touched-dir>
deno lint --config supabase/functions/deno.json supabase/functions/<touched-dir>
deno check --config supabase/functions/deno.json supabase/functions/<fn>/index.ts
deno test --allow-env supabase/functions/_helpers/authGuard.test.ts
```

### Environment notes

- There is no root `deno.json`; use `supabase/functions/deno.json`.
- On Windows Deno TLS failures, use `DENO_TLS_CA_STORE=system`.
- Some sandboxes lack `node_modules` or have npm TLS/rate-limit failures. Treat those as environmental; retry or rely on CI.
- CRLF Windows checkouts can make `deno fmt --check` report unrelated formatting across the functions tree. Check only touched directories; do not reformat the tree wholesale.
- If npm-based Prettier is unavailable, use a temporary Deno/esm.sh workaround pinned to the project Prettier version. Do not commit the script or resulting lockfile changes.

## Before opening a PR

Run the relevant checks:

- Frontend/docs: `npm run format:check`, `npm run lint`, and relevant tests.
- Edge Functions: Deno format, lint, type-check, and relevant tests.
- Category-resolution, taxonomy, leaf-guard, or category-prompt changes: `node scripts/replay-corpus.mjs`.
- Confirm migration version prefixes are unique:

```bash
ls supabase/migrations | cut -d_ -f1 | sort | uniq -d
```

Never edit an applied migration. Add a new migration instead. Test schema changes from an empty database where possible.

## Review rules

- Check every Supabase query terminal result for `error` before trusting `data` or `count`.
- `select()` is capped at 1,000 rows. Use exact-count/head queries or pagination for metrics that can grow.
- Reuse canonical helpers rather than recreating partial validation logic.
- Every append-only table needs a retention/pruning plan.
- Metrics must use denominators that match the outcome being measured.
- Follow existing sibling test patterns for new UI components.
- Test new behavior by first making the test fail against the broken behavior.
- Never log secrets, tokens, customer data, or raw auth headers.

## Architecture

This is a Vite/React SPA with Supabase Edge Functions (Deno) and one Postgres database protected by RLS.

### Frontend

- `src/pages/`: active legacy v1 UI.
- `src/v2/pages/` and `src/v2/components/`: current UI redesign and primary feature area.
- `src/v2/pages/_archive/`: reference only; do not treat imports as live.
- When changing a feature, check both v1 and v2 callers.

### Duplicate async work

Do not merely suppress duplicate requests. Every duplicate caller must receive the original operation’s result.

For requests that can fire during remounts or rapid user actions:

- Claim the guard synchronously.
- Use module-scoped state if remounts must be covered.
- Store and return the in-flight promise.
- Attach a no-op rejection handler when storing an unadopted promise to avoid unhandled rejections.

See `src/hooks/useAnalyzeGeneration.ts` and its duplicate-guard tests.

### AI analysis pipeline

`supabase/functions/analyze-item` is a multi-stage pipeline:

1. Multimodal item identification.
2. Category resolution.
3. Category aspects retrieval/cache.
4. Listing generation.
5. Category verification against generated output.
6. Item-specific regeneration if category changes.

Trace the entire pipeline before changing shared category, domain, or prompt logic.

For every Gemini call:

- Set an output cap with room for the intended response.
- Detect truncation using the field appropriate to its endpoint:
  - Native Gemini: `candidates[0].finishReason === "MAX_TOKENS"`
  - OpenAI-compatible endpoint: `choices[0].finish_reason === "length"`
- Log truncation distinctly from parsing failures.
- State JSON constraints in prompts and keep tolerant parsers; JSON mode is not sufficient on all paths.

## Category resolution

Category Resolver v2 is **filter-then-rank**, not score-based.

- Candidate precedence: `user_verified` → surviving eBay suggestion → `NEEDS_CONFIRMATION`.
- If no candidate passes, require user confirmation. Do not reintroduce numeric scoring.
- Validate leaf existence and active status through `ebay_taxonomy_cache`, with its defined freshness/live fallback behavior.
- Gate 4 remains warn-only unless `CATEGORY_GATE4_ENFORCE` is intentionally enabled after reviewing warning data.
- Use `KNOWN_PARENT_CATEGORY_IDS` and `isKnownParentCategoryId()` from `_helpers/leafCategoryGuard.ts`; do not duplicate the list.
- That constant is text-scraped by maintenance scripts: do not rename, move, or replace it with an import.
- Hardcoded category IDs are high-risk. Prefer cache/taxonomy lookups; validate unavoidable IDs against `corpus/ebay_taxonomy_snapshot.json`.
- Run the golden-corpus replay before changing category resolution, category prompts, taxonomy snapshots, or leaf guards.

See `CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md` and `todo.md` for detailed status.

## eBay integration

- eBay Inventory API rejects hyphenated SKUs. Do not rely on bulk offer enumeration being resilient to one bad SKU.
- Existing live offer SKUs cannot be renamed in place. Do not automate republish/withdraw migration without explicit approval.
- Use known-SKU lookups plus the Trading API fallback as implemented in `ebay-listings`.
- eBay uses multiple hosts; confirm the API’s documented host before changing endpoint construction.
- OAuth scopes are fixed at consent time. Adding a scope requires provider registration, code deployment, then user reconnection.
- `ebay-publish` uses an `action` router. Trace callers before changing its auth or behavior.
- Internal Edge Function callers commonly authenticate with the service-role Bearer token. Grep function callers before narrowing auth.

## Edge Function auth

`verify_jwt = false` does not mean public access.

Use `_helpers/authGuard.ts`:

- `requireUser`: end user only.
- `requireUserOrServiceRole`: frontend users and internal service calls.
- `requireServiceRole`: cron/internal only.

Choose based on the complete caller graph, not function name or assumptions.

## Database and migrations

- RLS is required on every user-scoped table.
- OAuth tokens are encrypted at rest; never expose or rewrite them casually.
- Migrations are timestamped SQL in `supabase/migrations/`.
- Never edit applied migrations. Add corrective migrations, including early dependency migrations when a clean replay reveals ordering problems.
- Verify migration prefixes are unique before merge and confirm the deployment run after merge.

## CI/CD and QA

A merge to `main` is not proof of production deployment. Check the deployment run, especially for migration or Edge Function changes.

- `deploy-functions.yml` deploys migrations and Edge Functions on pushes to `main`.
- Backend changes require the manual QA function deployment workflow where applicable.
- QA setup and environment details are documented in `LISTING_ASSISTANT_PRO_QA_SETUP.md`.

## Rebrand / infrastructure safety

This repository remains live and legacy until an explicit cutover approval.

The connected production Supabase project is shared with an unrelated CRM. Never assume a full schema export belongs only to this app.

Require explicit user approval before any production, DNS, provider-account, Stripe, eBay, Supabase, data-export, or destructive action.

Never place secrets, tokens, password hashes, or customer data in chat, source code, commits, or documentation.

## Git workflow

- Never push directly to `main`.
- Create a branch and open a PR.
- Preferred prefixes: `fix/`, `feat/`, `feature/`, `docs/`, `perf/`, `rebrand/`.
- Do not extract credentials from local credential stores.
- If GitHub CLI is unavailable, ask the user to authenticate interactively or provide a PR compare URL.

## Documentation Style

- Keep this file (`CLAUDE.md`) concise, actionable, and rule-oriented.
- Do not add long narratives, deep bug histories, incident logs, or specific PR/issue numbers.
- Distill new learnings into short, context-free bullet points to conserve token limits and maintain readability but also maintain effectiveness.
