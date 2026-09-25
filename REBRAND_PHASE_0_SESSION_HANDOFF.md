# Rebrand Session Handoff

**As of:** 2026-09-25 (substantive state last changed 2026-09-08)
**Repository:** `twinwicksllc/listing-assistant-pro`
**Session output:** PRs #556, #557, #558, #559, #560, #561 merged (6 total), 0 open

> **Update 2026-09-25.** No rebrand progress since 2026-09-08 (the only rebrand-doc change
> was the FYI design audit, Section 5b of `REBRAND_PHASE_1_TODO.md`, PR #622). Everything
> below is still current. Open owner items: **O-10** (SES setup) and **O-12** (Forward Email
> setup + MX records); owner decisions outstanding: **Q-06**, **Q-16**, **Q-10**.

> **Note on this file's name.** Rewritten in full again today rather than appended to,
> per this file's own established convention (see the previous rewrite's note, now
> superseded). Treat everything below as current and everything before today's rewrite
> as gone, except where a prior handoff's content is restated here because it's still
> relevant (the signup-copy inconsistency, still unresolved, carried forward below).

## Read this first — what's actually left open

Nothing from today is blocking, and nothing is broken. Two things worth knowing before
continuing:

1. **The signup-copy inconsistency from the 2026-08-28 handoff is still unresolved.**
   `listrassistr-official`'s sign-up form still claims account creation "will open when
   the application shell is ready," but real Supabase auth records exist from testing.
   Nobody has looked at the actual signup handler code to settle which is true. Low
   stakes, carried forward again, not touched this session.
2. **Q-10 (brand direction) is explicitly on hold.** The owner is having a larger
   brand-direction discussion in another session. **Do not restart or duplicate that
   discussion here** — wait for the owner to bring a decision back to this thread. This
   is the single largest remaining unlock (all of §8.3's token/asset-package work), so
   it's worth flagging prominently rather than letting a future session re-open it.

Otherwise: everything opened or reopened today is closed, and today's work also
confirmed (for the first time) that this app's own QA E2E suite is now catching real
issues automatically — see below.

## What happened today, roughly in order

This session had two largely independent threads: (A) building this app's own QA
environment from scratch, and (B) closing out several open Phase 1 rebrand decisions.
They're unrelated except that both touch `majmvgakczrpcwgxgulj` (see thread A).

### Thread A — `listing-assistant-pro` finally has a working QA environment

1. **Diagnosed why this app's E2E suite had never actually tested a real deployment.**
   `e2e-pr-smoke.yml`/`e2e-full-lifecycle.yml` had always run against repo-level secrets
   pointing at production, and `QA_BASE_URL` was never set, so the weekly full-lifecycle
   suite silently fell back to testing `localhost:8080` via Playwright's `webServer`
   config — confirmed directly in a run log (`BASE_URL:` blank).
2. **Decided the architecture** (user confirmed via AskUserQuestion): reuse the existing
   `listrassistr-qa` Supabase project (`majmvgakczrpcwgxgulj`, already built for the
   future `listrassistr-official` frontend) as this app's QA backend too, rather than
   stand up a third project. New Vercel `qa` branch/preview deployment as the frontend.
3. **PR #556**: wired `e2e-pr-smoke.yml`/`e2e-full-lifecycle.yml` to `environment: QA`,
   added a loud failure guard if `QA_BASE_URL` is unset, wrote
   `LISTING_ASSISTANT_PRO_QA_SETUP.md` as the setup runbook. Owner did the actual
   Vercel/GitHub dashboard work (env vars, secrets) over several back-and-forth turns.
4. **PR #557**: Vercel's own auto-opened draft PR for the new `qa` branch (bot-generated,
   just a trigger commit). Already merged, nothing to do with it.
5. **Found and fixed two real, previously-hidden bugs** — this is the concrete proof the
   new QA environment already earned its cost:
   - **Vercel Deployment Protection SSO wall** blocked all automated test traffic to the
     `qa` Preview deployment (every test failed with "Login form not found at
     `vercel.com/login`"). Fixed with a Protection Bypass for Automation secret, sent as
     an `x-vercel-protection-bypass` header (`playwright.config.ts`, PR #558).
   - **`e2e/fixtures/helpers.ts`'s `login()` used `Locator.isVisible({ timeout })`**,
     which does not actually poll (only `waitFor()`/`expect().toBeVisible()` do). This
     had been silently masked for the suite's entire lifetime because it only ever ran
     against a fast local dev server; against a real network deployment the check could
     fire before the page finished rendering. Fixed by switching to `waitFor()` (PR #558).
6. **Found a second, unrelated bug while verifying**: `.github/workflows/test.yml` had
   its own **separate, always-green** `e2e-smoke-tests` job — same display name as the
   real one in `e2e-pr-smoke.yml` (causing two identically-named "E2E Smoke Tests" rows
   in PR checks), never wired to `QA_BASE_URL`, so it silently failed against localhost
   on every run — but `continue-on-error: true` plus a non-blocking carve-out in
   `test-summary` made it always report green. **Removed entirely** (PR #559) rather than
   fixed forward, since `e2e-pr-smoke.yml` already covers this and the duplicate added
   nothing but false confidence.
7. **PR #559 also merged.** Confirmed end-to-end: `e2e-pr-smoke.yml`'s 4 smoke tests and
   `e2e-full-lifecycle.yml`'s 6 tests both pass cleanly (no retries) against the real `qa`
   deployment. Owner spot-checked `majmvgakczrpcwgxgulj`'s `auth.users` table — the QA
   test user's last login timestamp matched the run, confirming test traffic actually
   reached that project, not production.
8. **One real, documented test-coverage gap found in the process, not fixed**: despite
   its name, `full-lifecycle.spec.ts`'s "upload coin → generate → publish → verify on
   ebay" test only uploads a photo and clicks "Process Now" — it never calls the
   `generateListing()`/`publishListing()` helpers already defined in `helpers.ts`, and
   asserts nothing about a `drafts` row actually being created. `public.drafts` was
   empty on `majmvgakczrpcwgxgulj` after a passing run, which is why this was caught.
   Documented in `LISTING_ASSISTANT_PRO_QA_SETUP.md` as a known gap, not fixed this
   session — deepening these tests is real, separate follow-up work.
9. **Deferred, don't start yet**: applying the same Vercel Protection Bypass fix to
   `listrassistr-official`'s `qa.listrassistr.com`. That repo has **no E2E suite, no
   Playwright dependency, no `QA` GitHub environment secrets, and no CI workflow beyond a
   branch-sync job** — confirmed by direct inspection, not assumed. Adding just the bypass
   secret there now would be inert (nothing generates automated traffic against it yet).
   Building real E2E infrastructure there first is comparable in size to everything done
   in thread A above — a full session's work, not a quick add-on. Recorded in memory
   (`project_vercel_protection_bypass_needed_for_qa.md`) with this finding, and the
   owner explicitly deferred it (2026-09-08) rather than build scaffolding with no
   near-term payoff.

### Thread B — Phase 1 rebrand: source-doc corrections and two owner decisions

10. **Q-12 approved and executed same-day (PR #560).** Four known-stale/incorrect lines,
    already diagnosed in `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md` but never folded
    back into the source documents, corrected with dated in-place notes (this repo's
    established convention — visible correction, not silent rewrite): DEC-0033's "domain
    not yet registered" (it was registered 2026-08-06, 13 days before that entry was
    written); DEC-0035's mislabeled RBR-0003 reference; the service inventory's stale
    "New staging Supabase" row (relabeled to production, dev callback port corrected
    `3000`→`5173`, region/org/plan facts added); and the plan's §8.2.1-vs-§6.1
    role-address conflict (documented at both locations, left unresolved pending Q-04
    at the time — see next item).
11. **Q-04/Q-05 decided in conversation, recorded as DEC-0040 (PR #561, stacked on
    #560).** Role-address set: `support`/`privacy`/`legal`/`alerts` (plan §6.1's set,
    not §8.2.1's `security` — `alerts@` already has code precedent via
    `cost-alert-cron`, nothing references `security@`). Mailbox provider: **Forward
    Email**, chosen over Google Workspace and ImprovMX specifically because its own SMTP
    sending avoids the DMARC-alignment weak spot the checklist (F.4) flagged for
    Gmail-relayed replies, at free/open-source cost. Unlocks O-10 (SES setup), O-12
    (mailbox provider setup + MX records), T-07/T-08 (SPF/DMARC record strings), and the
    P1-07/08/09 email-identity gates — **none of that provider-dashboard work has
    started yet**, it's just unblocked now.
12. **A real merge-sequencing lesson from building PR #561**: it was drafted against
    `main` first, which meant it silently reverted PR #560's still-unmerged RBR-0003
    correction wherever git's auto-merge picked the wrong side of an overlapping hunk
    (not flagged as a conflict, since only _some_ of the overlapping lines conflicted).
    Caught by diffing the finished branch against `main` before pushing, not by the merge
    tooling itself. Fixed by rebasing PR #561 onto PR #560's branch instead of `main`, so
    it only carried the true net-new diff. **Lesson for future stacked-PR work in this
    repo:** when two PRs touch the same long table/row-based document, diff the finished
    branch against the _other open PR's branch_, not just against `main`, before trusting
    an auto-merge resolved cleanly — a clean rebase/merge with no conflict markers is not
    proof that every line survived correctly.
13. **A separate GitHub Copilot Autofix commit landed on PR #560's branch mid-session**
    (a legitimate one-line cross-reference cleanup in `REBRAND_PHASE_1_TODO.md`, adding
    "T-15" to a "Depends on" column) — confirmed benign by inspection, not something this
    session created. Matches the known pattern in memory
    (`project_copilot_autofix_on_prs.md`): this repo's Copilot Code Review can commit
    directly onto open PR branches; review and accept rather than being alarmed by it.

### Also touched this session, not part of either thread

14. **User's team added `LISTRASSISTR_LAUNCH_STRATEGY.md`** (committed 2026-09-08,
    `6036192`, before this session started) — a full launch/marketing/positioning
    strategy referencing a competitor ("ListEasier"). Part 1 proposes adopting six of
    their ideas; three are real engineering work (a $14.99/100 one-time credit-pack
    purchase system, relaxed multi-account eBay limits, catalog backup/restore). A
    feasibility pass against the actual codebase found the doc **understates effort on
    two of the three**:
    - **Credits**: Medium-Large. Billing today is 100% subscription
      (`create-checkout` hardcodes `mode: "subscription"`; the webhook never handles a
      one-time payment). Usage limits are enforced by counting rows in a time window,
      not a balance ledger — credits need a real new ledger table with decrement-on-use,
      not a reuse of what exists.
    - **Multi-account eBay support**: **Large**. eBay tokens live as flat columns
      directly on `profiles` — a single-row-per-user assumption baked into the schema
      itself, not a join table, touched by 11+ Edge Functions. This is schema surgery
      (a new `ebay_accounts` table, rewriting every call site to resolve "which account
      applies here"), not a tier-flag relaxation.
    - **Backup/restore ("ListVault")**: **Large**. The launch doc's claimed "existing
      ingredients" (`inventory-sync-cron`/`user_active_listings`) only store
      `listing_id, title, price, category_id` — a price cache, not backup-fidelity
      content (no images, description, item specifics, condition). No
      re-list-from-stored-data path exists anywhere in the codebase. Real backup/restore
      also has to survive eBay category/policy staleness, which per `CLAUDE.md` is a
      recurring, painful bug class already found repeatedly in this exact codebase.
    - **Recommendation given to the owner, not yet acted on**: don't build any of the
      three before the `listrassistr-official` migration — they're all real
      architecture changes to the eBay integration surface, expensive to build twice
      (here, then re-port). The launch doc's cheaper items (positioning copy, pricing
      page math, legal-page checklist, in-app brand cleanup) are pure marketing/copy
      work, not blocked by the migration question, and can proceed independently
      whenever the owner wants.

## Gate status snapshot (Phase 1, plan §8)

| Gate  | Item                                    | Status                                                                                                                                           |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-01 | Domain in legal business entity         | Approved with recorded deviation                                                                                                                 |
| P1-02 | Registrar hardened                      | Evidence captured                                                                                                                                |
| P1-03 | Legal approval of the name              | Approved                                                                                                                                         |
| P1-04 | Authoritative DNS documented            | In progress — inventory entry missing                                                                                                            |
| P1-05 | DNSSEC enabled, DS chain verified       | Evidence captured                                                                                                                                |
| P1-06 | Apex/`www`/`app`/`qa` resolving + certs | **Done** — all four live, canonical, cert-verified; `qa` points at its own non-production Supabase project (`majmvgakczrpcwgxgulj`), fully wired |
| P1-07 | Role mailboxes receiving                | Unblocked by DEC-0040 (Q-04/Q-05 decided) — provider-dashboard setup (O-10/O-12) not started yet                                                 |
| P1-08 | Branded email authenticates             | Same as P1-07                                                                                                                                    |
| P1-09 | DMARC review period completed           | Blocked on Q-06 (`rua` destination) plus the P1-07/08 setup work                                                                                 |
| P1-10 | Brand asset package produced            | Not started — blocked on Q-10, on hold in another session                                                                                        |
| P1-11 | Design tokens pass WCAG AA              | Not started — same block                                                                                                                         |
| P1-12 | Asset package approved                  | Not started — same block                                                                                                                         |
| P1-13 | Phase 2 entry decision                  | Not started — DEC-0035 does not grant                                                                                                            |

Full detail and evidence locations are in `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md`
(reference/evidence) and `REBRAND_PHASE_1_TODO.md` (action list, Section 5 is the
authoritative next-actions list — already updated today, don't re-summarize it here).

## The findings that matter most beyond today

1. **The QA environment is now a real signal, not a rubber stamp.** It found two genuine
   bugs (Vercel's SSO wall, the `isVisible` polling bug) in its very first real run, plus
   a third unrelated always-green CI job elsewhere in the repo. This validates the
   original goal stated at the start of this session ("find issues automatically going
   forward") — the environment is doing exactly that, immediately.
2. **A clean git rebase/merge with no conflict markers is not proof every line survived
   correctly**, when two branches touch the same long table-formatted document (see
   thread B, item 12 above). Always diff the finished branch against the _other_ branch
   before trusting it, not just check for the absence of `<<<<<<<` markers.
3. **`listrassistr-official`'s CI/testing maturity is much lower than this repo's** —
   confirmed by direct inspection this session (no Playwright, no E2E, no QA environment
   secrets, only a branch-sync workflow). Don't assume parity between the two repos when
   planning follow-on work; check each one's actual state before estimating effort there.
4. **The competitor-feature sizing (thread B/14) is a real input for a future planning
   session, not a decision.** The owner hasn't yet decided whether/when to build any of
   the three larger ListEasier-inspired features — this session only sized them and gave
   a timing recommendation (wait for migration). Don't treat the recommendation as
   already-approved scope.

## Process lessons for whoever continues this

- **Diff stacked PR branches against each other, not just against `main`**, before
  pushing — see the RBR-0003 near-miss in thread B.
- **A "cancelled" CI run status is not a failure and not a pass — it's no signal at
  all.** GitHub Actions' `concurrency: cancel-in-progress: true` cancels an in-flight run
  whenever a new push lands on the same branch; don't report on a cancelled run's
  outcome, wait for the run that actually supersedes it to complete.
- **Two CI jobs can share a display name across different workflow files** and look like
  duplicates or retries in the PR checks list when they're actually two entirely
  different jobs with different wiring, different auth, and different reliability. If a
  "the same check is failing and passing" situation looks confusing in the checks list,
  check which _workflow file_ each row actually belongs to before assuming it's the same
  job retrying.
- **Playwright's `Locator.isVisible({ timeout })` does not poll** — this is a real,
  well-known gotcha, not specific to this repo. Only `waitFor({ state })` and
  `expect(locator).toBeVisible({ timeout })` actually retry. Grep for this pattern if
  writing new E2E helpers here.
- **When a memory or a launch/strategy doc names a specific file, function, or existing
  "ingredient" as reusable, verify it against the actual code before repeating the
  claim** — the launch strategy doc's claim about `inventory-sync-cron`/
  `user_active_listings` being reusable backup ingredients didn't hold up under a real
  read of what that table actually stores.

## Next steps, cheapest and most decision-independent first

1. **Owner-side, no decision needed:** O-10 (SES setup) and O-12 (Forward Email setup +
   MX records) — both unblocked by DEC-0040, both provider-dashboard work only the owner
   can do. See `REBRAND_PHASE_1_TODO.md` Section 2b for the step list.
2. **Owner-side, no decision needed:** trigger `deploy-functions-qa.yml`
   (`workflow_dispatch`) the next time a backend change lands on `main`, to keep
   `majmvgakczrpcwgxgulj` current — it's manual-only by design. As of this handoff it's
   already current with `main` (checked directly, no `supabase/` changes since its last
   successful run).
3. **Q-06** — DMARC `rua` destination. Must be an analyzer service or a real
   `@listrassistr.com` address; a `gmail.com` address silently fails. Small decision,
   unlocks O-14 and P1-09's 30-day clock.
4. **Q-16** — whether plan §9/Phase 2 still describes the right strategy now that a
   greenfield app is being built in `listrassistr-official` instead of a
   rebrand-in-place. Owner-level call, not urgent.
5. **When Q-10 resolves** (owner-driven, in another session — do not chase this): it
   unlocks all of §8.3's brand-asset/token work, the largest remaining Phase 1 block.
6. **The signup-copy inconsistency** (carried forward from 2026-08-28, still
   unresolved) — confirm in `listrassistr-official`'s code whether the sign-up handler
   is actually wired to Supabase Auth, or whether the UI's "not open yet" text is
   accurate. Low stakes, cheap to check whenever convenient.
7. **`full-lifecycle.spec.ts`'s test-coverage gap** (thread A, item 8) — deepen the
   coin/electronics tests to actually call `generateListing()`/`publishListing()` and
   assert a `drafts` row appears. Real work, not urgent — the QA environment itself is
   proven working without this.
8. **The three ListEasier-inspired features** (thread B/14) — no action expected before
   the `listrassistr-official` migration decision. Revisit sizing if the owner wants to
   move on any of them sooner.
9. **`listrassistr-official`'s missing E2E/Vercel-bypass setup** (thread A, item 9) —
   deferred, revisit only once that repo has (or is getting) a real E2E suite worth
   protecting.
10. **O-04 / O-03** — re-check `listrassister.com` availability and chase the AWS
    support case, only if/when that domain is still wanted. Owner is already working
    with AWS support on the underlying restriction; not blocking anything.

## Environment constraints that still apply

- **`gh` CLI IS installed and authenticated in this specific environment** (confirmed
  `gh auth status`: logged in as `twinwicksllc`, scopes `gist, read:org, repo,
workflow`) — this can create/merge PRs, trigger workflows, query the GitHub API
  directly. This contrasts with `CLAUDE.md`'s general note that `gh` may not be
  available in all sandboxes, and with the 2026-08-28 handoff's note that it wasn't
  available then. Don't assume either way in a fresh session — run `gh auth status`
  first.
- **This session has both repos cloned as sibling directories** and can read/write
  `listrassistr-official` directly (confirmed this session by inspecting its
  `.github/workflows/`, `package.json`, and `src/integrations/supabase/` directly) —
  contrasts with the 2026-08-28 handoff's "no write access" note. Verify with `ls
../listrassistr-official` at the start of a fresh session rather than assuming either
  way.
- **Never request, print, or write secret values into chat, commits, or docs** — only
  names/locations. This was followed throughout; e.g. Supabase key-type confusion during
  QA setup was resolved by asking the owner to re-verify and re-paste directly into the
  GitHub dashboard, never by asking for the value itself.
- **`git config core.autocrlf=true`, no `.gitattributes`** — makes the whole
  `supabase/functions/**` tree show as unformatted under `deno fmt --check` on this
  machine. Pre-existing, not a real regression; don't try to fix it repo-wide.

## Safe resume

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
gh auth status
```

No open PRs as of this handoff (confirmed via `gh pr list --state open`). Working tree
is clean. Start with `REBRAND_PHASE_1_TODO.md` Section 5 for the full prioritized Phase 1
queue, or `LISTING_ASSISTANT_PRO_QA_SETUP.md` for the QA-environment thread's current
state and its one remaining documented gap (full-lifecycle test coverage). Do not start
or continue the Q-10 brand-direction discussion — that's explicitly running in a
different session.
