# Rebrand Session Handoff

**As of:** 2026-09-02
**Repository:** `twinwicksllc/listing-assistant-pro`
**Session output:** PR #551, #552, #553 merged; `REBRAND_PHASE_1_TODO.md` updated and
committed this session; 71 remote + 29 local merged branches pruned; qa Edge Function
deploy confirmed green.

> **Note on this file's name.** This file predates Phase 1 and is rewritten in full each
> session rather than appended to — see the 2026-08-28 rewrite's own note for why. The
> filename is kept as-is since other documents reference it. Treat everything below as
> current; nothing before this rewrite is assumed still accurate unless repeated here.

## Read this first — what's actually left open

**Nothing from this session is blocking.** The qa environment is fully wired up and its
Edge Functions are confirmed live. Two verification items were explicitly deferred by the
owner to a later session ("I'll need to check ebay and stripe later" / "we'll table that
until tomorrow"):

1. **Sandbox eBay OAuth connect** — not yet tested end-to-end against `qa.listrassistr.com`.
   A sandbox test user was registered; the eBay Developer RuName/redirect-URL config
   (`https://qa.listrassistr.com/ebay/callback` for both accepted and declined) is set.
   Nobody has actually clicked through the connect flow yet.
2. **Test-mode Stripe checkout** — Stripe test-mode restricted key and webhook secret are
   set in the qa project's Edge Function secrets with the exact permission/event set the
   code needs. Nobody has run an actual checkout session against it yet.

Also still open, lower priority:

- **The signup-copy inconsistency in `listrassistr-official`** (noted in the 2026-08-28
  rewrite, unresolved since): the sign-up form's on-page text claims account creation
  "will open when the application shell is ready," but real Supabase auth records already
  exist from signing up anyway. Nobody has looked at the actual signup handler code to
  settle which is true. Doesn't block anything.
- **O-33** — review `listrassistr-official`'s existing content/branches against this
  repo's Phase 0 record. Needs the owner's repo access; this session has none.

Otherwise: every item opened or reopened this session is closed. See below.

## What happened this session, roughly in order

1. **Closed out Q-15/RB-08/RB-10 documentation** left half-finished by the prior
   (compacted) session — `REBRAND_PHASE_1_TODO.md` and `REBRAND_PHASE_1_RUNBOOKS.md` now
   correctly show all four RB-08 wiring items done (Vercel env vars scoped to the `qa`
   branch, backend Edge Function secrets, Supabase Auth URL config, `qa` DNS/domain
   assignment) and `P1-06` marked done.
2. **Discovered this repo's own Edge Functions had never been deployed to any
   ListrAssistr-related Supabase project** — `supabase/config.toml` and
   `deploy-functions.yml` only ever targeted the legacy/CRM-shared project
   (`wcednzaxmxwfiijzmjmx`). The owner approved reusing this repo's existing Edge
   Functions/migrations against the new `listrassistr-qa` project
   (`majmvgakczrpcwgxgulj`) rather than waiting on a separate build.
3. **Tried and abandoned local Supabase CLI use on the owner's Windows machine.**
   `npx supabase login` fails with `SELF_SIGNED_CERT_IN_CHAIN` (corporate TLS proxy,
   Node/npm-specific — the `DENO_TLS_CA_STORE=system` workaround doesn't apply). Worked
   around that via the standalone CLI binary, but `supabase link`/`migration repair` then
   failed with a generic `HttpClientError: Transport error` talking to
   `api.supabase.com` — confirmed NOT a proxy-config issue (direct access, and
   PowerShell's own `Invoke-WebRequest` reached the same URL fine) and diagnosed as a
   likely Go-on-Windows certificate-store gap specific to this machine. **Decision: gave
   up on local CLI use entirely** rather than keep debugging it.
4. **Added `.github/workflows/deploy-functions-qa.yml`** (`workflow_dispatch`-only,
   mirrors `deploy-functions.yml`'s steps, hardcoded to `majmvgakczrpcwgxgulj`) so
   deploys run on GitHub's runners instead, sidestepping the local network problem
   entirely. Merged via PR #551, bundled with the doc updates from step 1.
5. **Iteratively found and fixed four real migration-replay bugs**, one per workflow run
   — this was the bulk of the session. All four were latent defects that had simply never
   been exercised before, because no environment had ever replayed every migration from
   an empty database until now:
   - `20260318100000_free_tier_tracking.sql` ALTERs `public.subscriptions` two days
     before the migration that creates it. Fixed with a new earlier migration
     (`20260318050000_create_subscriptions_table_early.sql`), not by editing the
     original.
   - `20260327000000_generalize_category_mappings.sql` uses `gin_trgm_ops` before its
     own `CREATE EXTENSION IF NOT EXISTS pg_trgm` statement further down the same file.
     Same fix pattern: `20260326000000_enable_pg_trgm_early.sql`.
   - `20260516000000_expand_listing_images_bucket_for_video.sql` had a genuine syntax
     error — an orphaned `WHERE id = 'listing-media';` line with no attached statement,
     a copy-paste leftover. Fixed by deleting the dead line directly (a pure syntax
     error can't be routed around with an earlier migration).
   - `20260817010000_grant_execute_org_functions.sql` had a hard `RAISE EXCEPTION` guard
     refusing to run unless `public.accounts` (a real CRM table) existed — meant to stop
     it running against an unintended database, but the underlying `GRANT EXECUTE` on
     this app's own four org functions isn't actually CRM-conditional. The owner
     explicitly rejected faking a CRM table to keep the guard once that was explained;
     fixed by removing the guard entirely, making the grant unconditional.

   First three merged via PR #552 (`fix/qa-migration-replay-bugs`); the fourth via PR
   #553 (`fix/qa-org-function-grant-guard`). `CLAUDE.md`'s Database section now
   documents the first three (see its "migration history was never actually replayed
   from empty" paragraph) — worth adding a similar note for the fourth if it comes up
   again.

6. **Also fixed three Supabase Vault secret issues** along the way — Vault
   (`vault.secrets`) is a separate, project-scoped store from Edge Function Secrets, and
   `majmvgakczrpcwgxgulj` needed its own independent `project_url`/`service_role_key`/
   `cron_secret` entries for the `pg_cron` migrations to work. Found and fixed a typo
   (`secret_role_key` instead of `service_role_key`) via a direct
   `SELECT name FROM vault.secrets;` query.
7. **qa deploy workflow ran clean end-to-end** after all four fixes — Edge Functions are
   now visible and green in the `majmvgakczrpcwgxgulj` Supabase dashboard. Owner
   confirmed sign-up/sign-in against `qa.listrassistr.com` creates a real account in that
   project's own Auth Users, not production's.
8. **Pruned 71 remote + 29 local branches** that were fully merged into `main`, at the
   owner's request. Explicitly protected and never touched: anything with `qa` in the
   name (`feat/qa-env-setup`, `fix/qa-migration-replay-bugs`, `fix/qa-org-function-grant-guard`)
   and the two `backup/phase2-start-*`/`backup/phase3-start-*` snapshot branches (owner
   chose to keep these). One local branch (`fix/orphaned-media-cleanup`) needed `git
branch -D` since its two commits were squash-merged under different hashes — verified
   via `git branch --contains` that the content already exists on `main` (PR #500) before
   force-deleting.
9. **Deferred O-03/O-04** (`listrassister.com` mistype-domain re-check and the open AWS
   support case) to go-live, at the owner's explicit call — AWS support has been slow to
   respond and the mistype risk is judged low. Recorded in `REBRAND_PHASE_1_TODO.md`'s
   Section 4 (deferred-by-decision table) with that trigger.

## Gate status snapshot (Phase 1, plan §8)

| Gate  | Item                                    | Status                                                                                                                                                                                                                 |
| ----- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 | Domain in legal business entity         | Approved with recorded deviation                                                                                                                                                                                       |
| P1-02 | Registrar hardened                      | Evidence captured                                                                                                                                                                                                      |
| P1-03 | Legal approval of the name              | Approved                                                                                                                                                                                                               |
| P1-04 | Authoritative DNS documented            | In progress — inventory entry missing                                                                                                                                                                                  |
| P1-05 | DNSSEC enabled, DS chain verified       | Evidence captured                                                                                                                                                                                                      |
| P1-06 | Apex/`www`/`app`/`qa` resolving + certs | **Done.** All four hosts live, canonical, cert-verified. `qa` now points at its own fully-wired non-production Supabase project with Edge Functions deployed; sandbox eBay/Stripe checks still outstanding (see above) |
| P1-07 | Role mailboxes receiving                | Deferred                                                                                                                                                                                                               |
| P1-08 | Branded email authenticates             | Deferred                                                                                                                                                                                                               |
| P1-09 | DMARC review period completed           | Deferred                                                                                                                                                                                                               |
| P1-10 | Brand asset package produced            | Not started                                                                                                                                                                                                            |
| P1-11 | Design tokens pass WCAG AA              | Not started                                                                                                                                                                                                            |
| P1-12 | Asset package approved                  | Not started                                                                                                                                                                                                            |
| P1-13 | Phase 2 entry decision                  | Not started — DEC-0035 does not grant                                                                                                                                                                                  |

Full detail and evidence locations are in `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md`
(reference/evidence) and `REBRAND_PHASE_1_TODO.md` (action list, Section 5 is the
authoritative next-actions list).

## The other open document: `todo.md` (Category Resolver v2)

Unrelated work-stream, not touched this session, but the owner also asked about it —
recording status here so both are covered in one place. Phases 1–5 are fully implemented,
tested, and merged. What's left, per `todo.md` itself:

- **Phase 6** — promote Gate 4 (aspect satisfiability) from warn-only to enforcing.
  Deliberately not started; gated on reviewing accumulated `gate4Warnings` data for false
  positives first, not a coding task yet.
- The final wrap-up checklist item at the bottom of `todo.md` is deferred until Phase 6
  lands.
- Two long-flagged gaps, unresolved for several sessions now: no test infra exists for
  Deno HTTP handlers or for `analyze-item/index.ts` at all, and `resolverCore.test.ts`
  isn't wired into any CI workflow.

Nothing here is blocking anything else on the rebrand side.

## The findings that matter most beyond today

1. **No environment has ever replayed every migration from empty until this session** —
   production's schema predates several migrations that assumed something already
   existed out-of-band. If a fresh Supabase project is ever spun up again (a real
   ListrAssistr production project on `yqftpibxplachhwoclam` eventually, most obviously),
   expect to hit the same class of bug again for anything not yet exercised this way. The
   fix pattern is consistent: add a new earlier migration, don't edit an already-applied
   original — except for a genuine syntax error or an overly-narrow hard guard, where
   editing the original directly is correct instead.
2. **Three genuinely distinct Supabase-adjacent secret/config stores exist and are easy
   to conflate**: Edge Function Secrets (Deno runtime env vars), Supabase Vault
   (`vault.secrets`, used only by `pg_cron` SQL jobs), and Supabase Auth URL
   Configuration. None of these sync with each other, and each of the three current
   Supabase projects (`wcednzaxmxwfiijzmjmx` legacy prod, `yqftpibxplachhwoclam` intended
   ListrAssistr prod, `majmvgakczrpcwgxgulj` qa) needs its own independent setup of all
   three.
3. **Local Supabase CLI use is not viable on the owner's current machine/network** — Go's
   HTTP client fails talking to `api.supabase.com` specifically, for reasons distinct
   from the already-documented Node/npm TLS-proxy issue in `CLAUDE.md`. GitHub Actions
   (`deploy-functions-qa.yml`) is the working substitute; don't spend more time
   re-diagnosing the local failure unless it's specifically requested.
4. **A pre-push git hook runs a full `deno fmt`/`deno lint` pass on every single push**,
   including branch-delete pushes with no content change. One-branch-per-`git push
--delete` is far too slow for bulk pruning (2 minutes per ~9 branches, timed out
   mid-run) — batch multiple `:refs/heads/<branch>` refspecs into one `git push` instead
   so the hook only runs once.
5. **This repository still cannot write to `listrassistr-official`.** Unchanged from the
   last rewrite — still relevant since qa's frontend serves from that repo, not this one.

## Process lessons for whoever continues this

- **Auto-mode's permission classifier blocks bulk destructive git operations** (branch
  deletion, force-pushes) even after the user has already confirmed the scope via a
  question — expect one retry prompt per genuinely destructive command, not just per
  category of action.
- **Verify before deleting a "merged" local branch that shows `ahead N` of its own
  remote-tracking ref.** `git branch --merged` on the remote-tracking ref can say yes
  while the local branch still carries commits `git branch -d` will refuse — check
  `git branch --contains <sha>` against `main` to confirm the content already landed
  (e.g. via squash-merge) before reaching for `-D`.
- **Read the resume block skeptically, not just the item bodies** — still the standing
  lesson from the 2026-08-28 rewrite, unchanged.

## Next steps, cheapest and most decision-independent first

1. **Sandbox eBay OAuth connect test** and **test-mode Stripe checkout test** against
   `qa.listrassistr.com` — both explicitly deferred by the owner to next session. Once
   both pass, RB-08's end-to-end verification note can close and P1-06 is genuinely
   complete rather than "wired but unverified."
2. **The signup-copy inconsistency in `listrassistr-official`** — still unconfirmed
   whether the sign-up handler is actually wired to Supabase Auth or whether the "not
   open yet" UI text is accurate. Low stakes.
3. **O-33** — review `listrassistr-official`'s contents against this repo's Phase 0
   record. Needs owner repo access.
4. **Q-10 (brand direction)** — unlocks all of §8.3's asset-package work, the largest
   remaining block after email identity.
5. **Q-04 / Q-05 / Q-06** — the mailbox/email-identity decisions. Unlocks P1-07/08/09.
6. **Q-16** — whether plan §9/Phase 2 still describes the right strategy given a
   greenfield app is being built in `listrassistr-official` instead of a rebrand-in-place.
7. **DEC-0021 API key migration** — still deferred, trigger is Phase 2/3 entry or the
   first real customer, whichever comes first.
8. **O-03/O-04** (`listrassister.com` mistype domain) — deliberately deferred to go-live
   this session; only revisit then unless something changes (e.g. AWS support responds).

## Environment constraints that still apply

- **Local Supabase CLI is not usable on this machine/network** — use
  `deploy-functions-qa.yml` (GitHub Actions, `workflow_dispatch`) for any qa-project
  migration or function deploy instead of trying `supabase` locally again.
- **`npx prettier --write`/`--check` works directly in this session's environment** —
  same finding as 2026-08-28, still holds.
- **`gh` CLI not installed, no stored GitHub auth.** Hand the owner a prefilled compare
  URL to open PRs themselves.
- **No write access to `listrassistr-official`.** Draft content/code here if asked, and
  hand it to the owner to place in that repo directly.
- **`git config core.autocrlf=true`, no `.gitattributes`** — still makes the whole
  `supabase/functions/**` tree show as unformatted under `deno fmt --check` on this
  machine. Pre-existing, not a real regression.
- **A pre-push hook runs `deno fmt`/`deno lint` on every push** — batch multiple branch
  operations into one `git push` call where possible rather than looping one push per
  branch.

## Safe resume

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git status --short --branch
```

No open PRs as of this handoff. Working tree should be clean on `main` after this
session's commit. Start with the eBay/Stripe qa verification (item 1 above) if picking
up where the owner left off, or `REBRAND_PHASE_1_TODO.md` Section 5 for the full
prioritized rebrand queue.
