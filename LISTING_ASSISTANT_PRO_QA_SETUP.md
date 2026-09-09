# listing-assistant-pro QA environment

**Status date:** 2026-09-08

This app (`lister.teckstart.com`, repo `twinwicksllc/listing-assistant-pro`) has
never had a QA environment — confirmed in
`REBRAND_PHASE_0_SERVICE_INVENTORY.md`: "No separate QA/staging URL currently
live for this app." Its E2E workflows have always run against repo-level
secrets that point at **production** (`yqftpibxplachhwoclam`), and
`QA_BASE_URL` was never set, so the weekly full-lifecycle suite silently fell
back to testing a local `npm run dev` build instead of a real deployment —
confirmed directly in a 2026-09-08 run log (`BASE_URL:` blank, tests hitting
`localhost:8080`).

This is a separate, independent effort from the `listrassistr-official`
rebrand's own QA setup (RB-08 in `REBRAND_PHASE_1_RUNBOOKS.md`) — that one
built a QA environment for the future greenfield app. This doc is for **this**
app, the one real customers use today.

## What backend this app's QA reuses, and why

Rather than stand up a third Supabase project, this app's QA environment
reuses **`listrassistr-qa`** (project ref `majmvgakczrpcwgxgulj`) — the
non-production project RB-08 already created and wired (Edge Function
secrets, Auth URL config). `deploy-functions-qa.yml` in this repo already
deploys this app's own Edge Function code to that project, so the backend
half of this app's QA environment already existed; only the frontend half
(a deployed QA build actually pointing at it) was missing. Reusing it means
none of that wiring has to be redone when this app's frontend eventually
migrates to `listrassistr-official`.

**Scope note:** `majmvgakczrpcwgxgulj` is now shared QA infrastructure
between this app and the future ListrAssistr frontend. Both write to the
same non-production database. Keep test data recognizable (the existing
`qa0000000000test@test.sovereignlistingsuite.com` / `qa<timestamp>test@...`
email patterns already do this) and never point either app's QA config at
production.

## Owner setup (done once, in provider dashboards)

This session has no Vercel CLI/auth and cannot do these steps. Mirrors the
pattern already documented in `REBRAND_PHASE_1_RUNBOOKS.md`'s RB-08 §1 for
the other repo.

1. **Vercel** (`tom-fenwicks-projects/listing-assistant-pro` project):
   - Create a `qa` branch (if one doesn't already exist from a deploy).
   - Add branch-scoped environment variables, targeting the `qa` branch
     specifically (not the default Preview scope):
     | Variable                        | Value                                                                                   |
     | ------------------------------- | --------------------------------------------------------------------------------------- |
     | `VITE_SUPABASE_PROJECT_ID`      | `majmvgakczrpcwgxgulj`                                                                  |
     | `VITE_SUPABASE_URL`             | `https://majmvgakczrpcwgxgulj.supabase.co`                                              |
     | `VITE_SUPABASE_PUBLISHABLE_KEY` | `majmvgakczrpcwgxgulj`'s own anon/publishable key (Supabase dashboard → Settings → API) |
   - Note the URL Vercel assigns the `qa` branch (a
     `listing-assistant-pro-qa-*.vercel.app`-style preview URL, unless a
     custom subdomain is added later) — this becomes `QA_BASE_URL` below.

2. **GitHub** (`twinwicksllc/listing-assistant-pro` repo) — the `QA`
   environment already exists (created 2026-09-02 for
   `deploy-functions-qa.yml`) but currently has **zero secrets**. Add:

   | Secret                 | Value                                      |
   | ---------------------- | ------------------------------------------ |
   | `SUPABASE_URL`         | `https://majmvgakczrpcwgxgulj.supabase.co` |
   | `SUPABASE_ANON_KEY`    | `majmvgakczrpcwgxgulj`'s anon key          |
   | `SUPABASE_SERVICE_KEY` | `majmvgakczrpcwgxgulj`'s service-role key  |

   These are separate from the repo-level secrets of the same name, which
   stay pointed at production for anything else that still needs them
   (`e2e-pr-smoke.yml`'s localhost-fallback smoke runs, before this change,
   used those — now both E2E workflows declare `environment: QA` and pull
   from this set instead).

3. **Repo secret** `QA_BASE_URL` — set to the `qa` branch URL from step 1.
   `e2e-full-lifecycle.yml` now fails loudly (rather than silently testing
   localhost) if this is unset. In practice this is a Vercel-issued preview
   alias like `https://listing-assistant-pro-git-qa-tom-fenwicks-projects.vercel.app`
   — Vercel's GitHub integration auto-opens a draft PR the first time a
   non-`main`/`develop` branch is pushed and posts this URL as a PR comment;
   check there if you don't already have it.

4. **Vercel Deployment Protection bypass — required, found 2026-09-08.**
   Vercel puts an SSO login wall in front of every Preview deployment by
   default (including `qa`), which silently redirects Playwright's headless
   browser to `vercel.com/login` on every request — every E2E test failed
   with "Login form not found" until this was added. Vercel → Project
   Settings → **Deployment Protection** → **Protection Bypass for
   Automation** → generate a secret. Add it as GitHub QA environment secret
   `VERCEL_AUTOMATION_BYPASS_SECRET`. `playwright.config.ts` sends it as an
   `x-vercel-protection-bypass` header on every request when the env var is
   set — public visitors are unaffected, only requests carrying this header
   skip the wall.

5. **Confirm QA is caught up to `main`** — `deploy-functions-qa.yml` is
   manual-only (`workflow_dispatch`) by design (see its own header comment).
   Trigger it after any backend change lands on `main` that QA should
   reflect, or before relying on a QA test run to validate one.

## Remember to do this for `listrassistr-official` too

This same Vercel Deployment Protection wall almost certainly also blocks any
automated testing against `qa.listrassistr.com` — that project's Preview
deployments are subject to the identical default. Nothing in
`REBRAND_PHASE_1_RUNBOOKS.md`'s RB-08 mentions checking or disabling it, and
that repo has no E2E suite yet to have surfaced the problem the way this
one did. Flagged here so it isn't rediscovered the hard way — check
Deployment Protection settings on the `listrassistr-official` Vercel project
before wiring up any automated testing against `qa.listrassistr.com`.

## What changed in this repo (2026-09-08)

- `.github/workflows/e2e-pr-smoke.yml` and
  `.github/workflows/e2e-full-lifecycle.yml` now declare `environment: QA`,
  so they pull Supabase credentials from the QA environment secrets above
  instead of the repo-level (production) ones.
- `e2e-full-lifecycle.yml` now fails explicitly if `QA_BASE_URL` is unset,
  instead of silently falling back to a local dev build via Playwright's
  `webServer` config.
- `e2e-pr-smoke.yml` keeps its existing `BASE_URL || 'http://localhost:8080'`
  fallback — smoke tests are meant to be fast and don't need a live QA
  deploy, so this is intentional, not a bug.

## Status: confirmed working end-to-end (2026-09-08)

- [x] Owner completed the Vercel/GitHub setup above.
- [x] `deploy-functions-qa.yml` confirmed current with `main` (last
      successful run at commit `085cf8a`, which already includes the
      `create-checkout` env-aware-price fix from PR #554; no `supabase/`
      changes have landed on `main` since).
- [x] `e2e-pr-smoke.yml` green against the real `qa` deployment (PR #558) —
      required a Vercel Deployment Protection bypass fix (see step 4 above)
      and a Playwright `login()` helper fix
      (`Locator.isVisible({ timeout })` doesn't poll; switched to
      `waitFor({ state: "visible" })`) that only surfaced once tests ran
      against a real network deployment instead of localhost.
- [x] Manually ran `e2e-full-lifecycle.yml` (`workflow_dispatch`, run 34292767199) — all 6 tests passed in 22.7s against the real `qa`
      deployment; `BASE_URL` resolved (the "Verify QA_BASE_URL is set" guard
      didn't fire) and `SUPABASE_URL` came from the QA environment secrets.
- [x] Owner spot-checked `majmvgakczrpcwgxgulj`'s `auth.users` table —
      QA test user's last login matched the run time, confirming test
      traffic reached this project, not production.

## Known gap: `full-lifecycle.spec.ts` doesn't exercise generate/publish

The owner's dashboard check above also found `public.drafts` empty on
`majmvgakczrpcwgxgulj` after a passing run. This is expected, not a bug in
the QA wiring: despite its name, the "upload coin → generate → publish →
verify on ebay" test (`e2e/tests/full-lifecycle.spec.ts:14`) only uploads a
photo and clicks "Process Now", then asserts the URL changed — it never
calls the `generateListing()`/`publishListing()` helpers already defined in
`e2e/fixtures/helpers.ts`, and asserts nothing about a `drafts` row. Same
shape for the "electronics listing" test. Deepening these tests to actually
exercise the AI analysis pipeline and eBay publish flow, and assert a draft
lands in the database, is real but separate follow-up work — noted here so
it isn't mistaken for a QA environment problem.
