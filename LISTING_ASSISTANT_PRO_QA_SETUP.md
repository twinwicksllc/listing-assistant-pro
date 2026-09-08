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
   localhost) if this is unset.

4. **Confirm QA is caught up to `main`** — `deploy-functions-qa.yml` is
   manual-only (`workflow_dispatch`) by design (see its own header comment).
   Trigger it after any backend change lands on `main` that QA should
   reflect, or before relying on a QA test run to validate one.

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

## Next steps

- [ ] Owner completes the Vercel/GitHub setup above.
- [ ] Trigger `deploy-functions-qa.yml` to make sure QA's Edge Functions
      reflect current `main` (in particular the `create-checkout`
      env-aware-price fix merged 2026-09-03, PR #554).
- [ ] Manually run `e2e-full-lifecycle.yml` (`workflow_dispatch`) and confirm
      from the log that `BASE_URL` resolves to the real `qa` branch URL, and
      that the test user lands in `majmvgakczrpcwgxgulj`'s `auth.users`, not
      production's.
- [ ] Spot-check `majmvgakczrpcwgxgulj`'s `drafts`/`auth.users` tables after
      a run to confirm QA data lands there, not in production.
