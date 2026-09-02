# Rebrand Phase 1 — Runbooks

**Product:** ListrAssistr
**Scope:** `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §8 only, per DEC-0035
**Status date:** 2026-08-27

Step-by-step procedures for the Phase 1 items the owner executes. Companion to:

- `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md` — reference, reasoning, record shapes
- `REBRAND_PHASE_1_TODO.md` — what is outstanding, with owners and priorities

Console navigation is described by label rather than exact path, because provider UIs
move. Where a step is version-sensitive it says so.

**Which system each runbook lives in**, since they are easy to conflate:

| Runbook      | System                                                                       |
| ------------ | ---------------------------------------------------------------------------- |
| RB-01, RB-02 | **Vercel** — project `listrassistr-official` → Domains                       |
| RB-03        | **AWS Route 53** — hosted zone, then Registered domains                      |
| RB-04        | The **live site**, plus optionally Supabase logs                             |
| RB-05        | **Supabase** dashboard — project `yqftpibxplachhwoclam`                      |
| RB-06        | **GitHub** — `twinwicksllc/listrassistr-official`                            |
| RB-07        | **This repository** — `REBRAND_PHASE_0_DECISION_LOG.md`, a markdown table    |
| RB-08        | **Supabase** dashboard (`majmvgakczrpcwgxgulj`) + **Vercel** env vars — done |
| RB-09        | **AWS** — IAM console, signed in as root for this one task                   |
| RB-10        | **Vercel** → Domains, then **AWS Route 53** — hosted zone                    |

**Status as of 2026-09-02.** **RB-01 to RB-07 are all complete**, RB-05 fully so as of
checklist A.17b; execution evidence is in A.7d, A.12, A.13, A.15, A.16 and A.17. **RB-09**
(IAM admin login) is **complete**. **RB-08** (qa environment) is now **complete** — the
non-production project (`listrassistr-qa`, `majmvgakczrpcwgxgulj`) exists, its Edge Function
secrets and Auth URL config are set, and the frontend env vars are scoped to the `qa`
branch in Vercel. **RB-10** is now also **complete** as a result — `app.listrassistr.com`
was already live and externally verified, and `qa.listrassistr.com` now resolves with a
valid certificate on the `qa` branch. **Verification, 2026-09-02: sign-up/sign-in against
`qa`'s own Supabase project confirmed working** — new account visible in
`majmvgakczrpcwgxgulj`'s Auth Users, not production's. Still outstanding: a sandbox eBay
OAuth connect (confirming `EBAY_ENVIRONMENT`/`EBAY_RUNAME` route to sandbox and the token
lands encrypted) and a test-mode Stripe checkout (confirming the webhook fires and
`subscriptions` updates).

---

## RB-01 — Make the apex canonical, `www` redirect (Q-14, O-34) — ✅ DONE 2026-08-27

**Goal:** `https://listrassistr.com` serves production; `https://www.listrassistr.com`
308-redirects to it. Matches plan §6.1 and the owner's decision of 2026-08-27.

**Risk: low.** Both hostnames already resolve to Vercel and already hold valid
certificates, so nothing new is issued and **no DNS change is needed** — only Vercel-side
behaviour changes.

**One way to get this wrong, so mind the order.** If you set `www → apex` while the apex
is still set to redirect to `www`, you create a **redirect loop** and both hostnames
break. Clearing the apex redirect first cannot loop: the worst case in between is a few
seconds where both hosts serve the same content, which is harmless.

### Steps

1. Vercel → project **`listrassistr-official`** → **Domains**.
2. Find **`listrassistr.com`** (currently shows `308 → www.listrassistr.com`). Click
   **Edit**.
3. **Remove the redirect** — set it to serve the production deployment rather than
   redirect. In Vercel's editor this is the "Redirect to" selector set back to no
   redirect.
4. Save. Confirm the row now reads **Production** and **Valid Configuration**.
   **Do not continue until it does.**
5. Now find **`www.listrassistr.com`** (currently **Production**). Click **Edit**.
6. Set **Redirect to → `listrassistr.com`**, status **308**.
7. Save. Confirm the row reads `308 → listrassistr.com` and Valid Configuration.

### Verify

From a personal device or phone hotspot — the corporate network intercepts TLS and
filters DNS, so it cannot see this correctly:

- `https://listrassistr.com` → **200**, serves the coming-soon page.
- `https://www.listrassistr.com` → **308**, `Location: https://listrassistr.com/`.
- No redirect loop: the browser should settle on the apex, not bounce.

Tell me when done and I will confirm the record state from here.

### Aftercare

- [ ] Nothing to change in Route 53 — the apex A record and `www` CNAME both already
      point at Vercel.
- [ ] **Good side effect:** `yqftpibxplachhwoclam`'s recorded Auth Site URL is already
      `https://listrassistr.com`, so choosing the apex makes that configuration correct
      as-is rather than needing a change (A.7b).
- [ ] Plan §6.1 already names the apex as the marketing site, so **no plan edit is
      needed** — this choice removes the divergence rather than requiring a document fix.

---

## RB-02 — Repoint the typo domains (O-35), and the `.vercel.app` alias (O-36) — ✅ DONE 2026-08-27

**Run after RB-01**, so the target host is final.

**Goal:** `listerassistr.com` and `www.listerassistr.com` redirect to
**`https://listrassistr.com`**, not to `listrassistr-official.vercel.app`.

### Steps

1. Vercel → **`listrassistr-official`** → **Domains**.
2. **`listerassistr.com`** → **Edit** → set **Redirect to → `listrassistr.com`**, 308.
   Save.
3. **`www.listerassistr.com`** → **Edit** → same target, 308. Save.
4. Confirm both rows read `308 → listrassistr.com` with Valid Configuration.

### Verify

`https://listerassistr.com` → 308 → `https://listrassistr.com/`. Same for the `www`
variant. External device again.

### O-36 — the `.vercel.app` alias: leave it

Reassessed and **downgraded to P3**. Redirecting a project's own generated production
alias is awkward in the dashboard, and the robust fix is host canonicalisation in the
application itself — middleware that 308s any non-canonical host to the canonical one.
That is application code in `listrassistr-official`, which is a separate scope question
and not worth opening for this.

Leaving it is the normal state for a Vercel project and carries no functional risk. Worth
revisiting when the real application ships and middleware exists anyway.

---

## RB-03 — Enable DNSSEC (O-02) and verify it (O-17) — ✅ DONE 2026-08-27

Full reasoning and the rollback ordering are in the checklist's **I.2**. This is the
condensed execution path. **Do this when you have 30 minutes to watch it**, not last thing
before closing the laptop.

**Why now:** only a coming-soon page sits behind the domain. A mistake today is an
embarrassment; the identical mistake after cutover is a customer outage.

### Stage 1 — Enable signing. Cannot break anything.

1. Route 53 → **Hosted zones** → **`listrassistr.com`** → **DNSSEC signing** tab →
   **Enable DNSSEC signing**.
2. **KSK name — mind the character set.** The field accepts only `_`, A-Z, a-z and 0-9:
   **hyphens and dots are rejected**, so the obvious `listrassistr-ksk` will not be
   accepted. Use **`listrassistr_ksk_1`**. The `_1` suffix is deliberate — KSK rotation
   later means adding a second key alongside the first, and `_2` is then self-evident.
3. **Choose "Create customer managed CMK", not the pre-selected "Choose customer managed
   CMK".** The page defaults to selecting an existing KMS key, but Route 53 DNSSEC needs a
   key with specific properties that an ordinary KMS key will not have:
   - **Asymmetric**, key spec **ECC_NIST_P256**, key usage **SIGN_VERIFY**
   - Located in **us-east-1** — Route 53 is anchored there for this purpose
   - A key policy granting `dnssec-route53.amazonaws.com` permission to use it

   Letting Route 53 create it produces all of the above correctly and removes the fiddliest
   failure mode in the procedure. Expect the key to appear in **us-east-1** even if you
   normally work in another region; that is required, not a mistake.

4. **Cost:** the "Additional charges apply" note refers to the KMS key, roughly **1 USD per
   month** plus negligible per-request charges at DNSSEC signing volumes. So DNSSEC here
   costs about a dollar a month. Worth confirming against current KMS pricing.
5. Click **Create KSK and enable signing**, and wait for it to report enabled.

**Record afterwards:** the **KSK name** and the KMS key **alias**. Deliberately not the
full key ARN — an ARN embeds the AWS account id, which adds nothing to this record and
should not be published in the repository.

**On AWS's own warning.** The page cautions that completing the steps out of order can make
the domain unavailable. That is the same hazard this runbook is built around, and Route 53
itself splits the flow at the same place: enabling signing here, then a separate
"establish chain of trust" step that supplies the DS values. The Stage 1/Stage 2
checkpoint below sits exactly on that boundary, so pausing there follows AWS's sequence
rather than departing from it.

**Why this is safe:** validating resolvers only validate a zone if the **parent** (`.com`)
publishes a DS record. Until you publish the DS, the signatures are ignored entirely.

6. **Stop here and tell me.** Route 53 will offer an "establish chain of trust" step
   showing the DS values — **do not complete it yet.** I will confirm the DNSKEY is live and
   well-formed first. This checkpoint is the whole point of splitting the runbook.

### Stage 2 — Publish the DS. This is the part with teeth.

7. Still on the **DNSSEC signing** tab, view the key and note four values: **Key tag**,
   **Signing algorithm**, **Digest algorithm**, **Digest**.
8. Route 53 → **Domains → Registered domains** → **`listrassistr.com`** → **DNSSEC keys**
   → **Add key**.
9. Enter the four values exactly. Double-check the **Key tag** matches before saving —
   registrar and zone are the same console here, which is why transcription risk is low.
10. Save.

### Verify immediately

11. Open **`dnsviz.net/d/listrassistr.com/analyze`** from a personal device. You want a
    complete, unbroken chain from the `.com` parent down, with no red errors.
12. Tell me and I will independently confirm DNSKEY and DS from here.

**Abort condition:** if dnsviz shows a broken chain, **delete the DS record at the
registrar immediately**. The sooner it goes, the fewer resolvers have cached it.

**Honest caveat:** a wrong DS makes the domain resolve **nowhere** for validating
resolvers, and recovery is governed by the parent DS TTL — commonly **24 hours** for
`.com`. That is the exposure window, and it is why this belongs on today's list rather
than a post-cutover one.

**Rollback, if you ever need to disable DNSSEC later — order matters more than anything
else here:** delete the DS at the registrar → **wait out the parent DS TTL** → only then
disable signing in the hosted zone. Reversing that leaves resolvers holding a DS for an
unsigned zone, which is the failure above.

---

## RB-04 — Find out what "Sign in" and "Join the preview" actually do (Q-08) — ✅ DONE 2026-08-27

Three ways, cheapest first. Any one of them answers it.

### Option A — Just click it (2 minutes)

1. Open `https://listrassistr.com` in your normal browser.
2. Click **Sign in**. Note the URL you land on. Possibilities and what each means:
   - A `supabase.co` URL, or a page that calls Supabase → the coming-soon page is wired to
     a Supabase project, and **which one matters for P1-08**.
   - A `#` or dead link → placeholder, nothing wired. Simplest outcome.
   - An external service → note which.
3. Submit **Join the preview** with an address you control. Wait a few minutes.
   - Mail arrives → something is sending. **Note the `From` address and open the raw
     headers** to see the sending domain. That is an existing sender that will need
     DMARC alignment.
   - Nothing arrives → either it stores without sending, or it is a placeholder.

### Option B — Read the source

In `listrassistr-official`, search for the button text and follow the handler. Look for
`supabase`, `createClient`, `fetch(`, `action=`, or `mailto:`.

### Option C — Check the logs

Supabase → `yqftpibxplachhwoclam` → **Logs / Auth logs**. Any sign-in attempts recorded
means the page reaches that project. An empty log after you clicked in Option A is itself
an answer.

**Report:** where Sign in goes, whether any mail arrives, and the `From` domain if it does.

---

## RB-05 — Verify the production Supabase project (O-37, revised) — ✅ DONE 2026-08-27

**Completed.** A.15 captured identity, region, auth URLs, sign-up state and key formats; A.17a
corrected the organisation finding and A.17b answered the schema question, which were the two
follow-ups this runbook was left open for.

**Revised 2026-08-27** following the owner's correction that `yqftpibxplachhwoclam` is the
future **production** project — not staging, not qa. See checklist A.11.

**Goal:** confirm the four facts its service-inventory row has asked for since 2026-08-10.

1. Supabase → project **`yqftpibxplachhwoclam`**.
2. **Settings → General.** Record the **project name**, **region**, and **project URL**.
3. **Owner/organisation:** note which Supabase organisation it belongs to, and whether it
   sits under the shared CRM admin login or a separate one. This matters because RBR-0024
   flags the shared login, and DEC-0004 wants a ListrAssistr-only project.
4. **Is it empty?** Table Editor, or SQL editor → count rows in any user-facing table. What
   we need to know is whether **any production or customer data has reached it**.
5. **Authentication → URL Configuration.** Record the **Site URL** and the **Redirect
   allow-list**. Expected to be `https://listrassistr.com` — which RB-01 makes correct.
6. **API keys — format only, never values.** Note whether the project uses legacy JWT keys
   or the newer `sb_publishable_` / `sb_secret_` format, per DEC-0021.

### Reporting template — fill in rather than screenshotting

**Why a template rather than a screenshot.** The Supabase **API** page displays the
`service_role` key, which is a full-access credential that bypasses RLS. That page should
never be screenshotted. A template with only safe slots removes the need to judge what to
crop.

```
PROJECT IDENTITY          Project Settings (gear) → General
  Project name:
  Region:
  Organization name:
  Plan tier:

AUTH URLS                 Authentication → URL Configuration
  Site URL:
  Redirect URLs (list all):

SIGN-UP POLICY            Authentication → Sign In / Providers → Email
  "Allow new users to sign up":     enabled / disabled
  "Confirm email" required:         yes / no

CONTENTS                  Table Editor  +  Authentication → Users
  Table names present (names only):
  Number of users in auth:

KEY FORMAT ONLY           Project Settings → API  (or "API Keys")
  Tick what you SEE - do not copy any value:
    [ ] legacy pair: "anon" and "service_role"  (JWT-style, begin eyJ...)
    [ ] new pair:    "publishable" and "secret" (begin sb_publishable_ / sb_secret_)
    [ ] both present
```

**Safe to report:** names, region, organisation, URLs, table names, counts, toggle states,
and which key _format_ is in use.

**Never report:** any key value, the JWT secret, the database password, or a connection
string containing one. DEC-0021 only needs the format, never the keys.

Two slots are newer than the original RB-05 list, both consequences of A.13: the **sign-up
toggle**, because public sign-up is open on the production-intended project, and a **user
count** rather than an empty yes/no, because the owner's test account means the honest
answer is now a number.

---

## RB-06 — Review the target repository (O-33) — ✅ DONE 2026-08-27

RBR-0011's disposition makes this an explicit Phase 1 task. The owner has since noted the
repo is likely "wildly out of date", which changes the goal: this is a **staleness audit**,
not a conflict reconciliation.

1. List what is actually in `twinwicksllc/listrassistr-official` — top-level files and
   directories, and the merged PRs (#14 and #16 are known).
2. For each document, decide **keep / update / delete**. Anything describing Phase 0 state
   is superseded by this repo's `REBRAND_PHASE_0_*` record, which is authoritative.
3. Flag anything that **contradicts** the current record rather than merely lagging it —
   contradictions are what cause harm; staleness alone is just noise.
4. Note whether the repo contains any **application code** yet, or only docs and scaffolding.

I have no access to that repository, so this needs you — or read access granted.

### Reporting template

Browser only, no clone needed: `github.com/twinwicksllc/listrassistr-official`

```
  Root files and folders (names only):
  Contents of docs/ if it exists:
  Branch list:
  Application code present?  (is there a package.json / src/ ?)   yes / no
  PR #14 - title + which files it changed:
  PR #16 - title + which files it changed:
  Anything secret-shaped committed? (.env, *.pem, keys pasted in code)
      -> say IF and WHERE only. Do not paste contents.
```

For the PRs, the **Files changed** tab is enough — filenames alone serve the purpose, since
this is a staleness and contradiction audit rather than a read of the prose.

That last line is not a formality: if a `.env` or key-shaped file _is_ committed there, it is
a finding to handle deliberately, not something to paste into a chat or a commit message.

---

## RB-07 — Place the three DEC entries (T-14, O-22) — ✅ DONE 2026-08-27

Draft text already exists in the checklist:

| Entry        | Subject                                                        | Where the draft lives |
| ------------ | -------------------------------------------------------------- | --------------------- |
| **DEC-0036** | §8.1.1 entity deviation accepted, revisit at Stripe onboarding | checklist A.2         |
| **DEC-0037** | Name `ListrAssistr` approved under owner sign-off              | checklist A.1a        |
| **DEC-0038** | Phase 1 document location — option C, destination recorded     | checklist A.8         |

1. Open `REBRAND_PHASE_0_DECISION_LOG.md`.
2. Append the three rows, following the existing column format.
3. Confirm the highest DEC id becomes **DEC-0038**.

**Done 2026-08-27** in commit `adee295`, on the owner's say-so — all three rows are in the
decision log and DEC-0038 is the highest id.

---

## RB-08 — The qa environment: fully wired up 2026-09-02

**Closed 2026-09-01: the Phase 3 entry gate below is approved as DEC-0039** (owner: "1.
approved", recorded in `REBRAND_PHASE_0_DECISION_LOG.md`). Scope is exactly what the draft
below describes — creating the non-production Supabase project only. Data migration,
cutover, and repository code changes remain explicitly out of scope. What follows is the
original blocked-state analysis (kept for the rationale) plus, at the bottom, the now-actionable
follow-on work.

**This changed materially with the A.11 correction.** The earlier plan assumed
`yqftpibxplachhwoclam` was the staging/qa project, so qa looked like a configuration task
inside Phase 1. With it confirmed as the **production** project:

- There is **no staging project and no qa project**.
- **DEC-0005** requires separate staging and production environments and credentials, so
  this is a real gap, not a nicety.
- Plan **§6.2** names `listrassistr-production` and `listrassistr-staging` as the target.
- Creating a new Supabase project is plan **§10 — Phase 3**, which **DEC-0035 does not
  authorise**.

Confirmed also: `qa.listrassistr.com` does not exist, and there is no DNS record for it.
That matches what I measured — NXDOMAIN, no delegation.

### So the honest answer

The qa DNS record is Phase 1 work, but **a DNS record pointing at a non-existent
environment is worthless**, and the environment behind it is Phase 3. Doing it under the
Phase 1 banner would be exactly the scope drift the to-do's Section 6 exists to prevent.

**Recommended: leave qa alone until a Phase 3 entry decision exists.** It blocks nothing
in Phase 1 — no §8 exit-gate item depends on qa existing, only on the record existing, and
that record should follow the environment rather than precede it.

### Phase 3 entry decision — approved as DEC-0039, 2026-09-01

> **DEC-0039** — Approves entry to plan §10, Phase 3: New Supabase Projects, **scoped to
> creating the non-production environment only**. Rationale: `yqftpibxplachhwoclam` is
> confirmed as the intended **production** project (A.11), so DEC-0005's requirement for
> separate staging and production environments is currently unmet, and Phase 1's
> `qa.listrassistr.com` record (§8.1.6) has no environment to point at. Scope: create one
> non-production Supabase project per §6.2's naming, configure its Auth URL
> configuration for `qa.listrassistr.com`, and assign environment variables separately
> from production. **Explicitly not approved by this decision:** any data migration
> (§11/Phase 4), any production cutover (§14), and any repository code change (§9/Phase
> 2). Conditions: no production data reaches the non-production project, and the shared
> CRM admin login is not reused for it (RBR-0024, DEC-0004).

### Done 2026-09-01 — the non-production project exists

Owner created it: **`listrassistr-qa`**, project ref **`majmvgakczrpcwgxgulj`**, pointed at
the existing `listrassistr-official` GitHub repo (confirming Q-15's answer — no second repo).
This satisfies DEC-0039's scope exactly (project creation only) and, together with A.17b's
"no schema, no customer data" finding on `yqftpibxplachhwoclam`, means DEC-0005's
separate-staging-and-production requirement is now satisfiable rather than blocked.

### Done 2026-09-02 — all four items below are wired up

Vercel env vars scoped to the `qa` branch, all backend Edge Function secrets set on
`majmvgakczrpcwgxgulj` (including a **new, separate Sentry project** for QA error tracking
rather than sharing production's DSN — a better outcome than this runbook's own
"owner's call" framing below implied was likely), the Supabase Auth URL configuration, the
`qa` branch/domain/DNS in Vercel and Route 53 (confirmed **Valid Configuration** with a
certificate issued). What follows is kept as the reference record of exactly what was set
and why, not a still-open checklist.

### 1. Environment-variable matrix (names/destinations only, never values)

**Vercel — frontend, `.env.example`'s three `VITE_SUPABASE_*` vars, scoped per branch:**

| Variable                        | Production (main branch)                   | `qa` branch                                |
| ------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `VITE_SUPABASE_PROJECT_ID`      | `yqftpibxplachhwoclam`                     | `majmvgakczrpcwgxgulj`                     |
| `VITE_SUPABASE_URL`             | `https://yqftpibxplachhwoclam.supabase.co` | `https://majmvgakczrpcwgxgulj.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | production project's anon/publishable key  | qa project's own anon/publishable key      |

Vercel supports per-branch env var scoping (Project → Settings → Environment Variables →
add the `qa` branch as a target alongside/instead of the default Preview scope) — this is
what actually makes the `qa` branch/domain point at the new project instead of silently
inheriting production's values via the default Preview environment.

**Supabase Edge Function secrets — set separately on `majmvgakczrpcwgxgulj`** (`supabase
secrets set --project-ref majmvgakczrpcwgxgulj`, or the dashboard's Edge Functions →
Secrets page). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
auto-injected per-project by Supabase at runtime — nothing to set for those three. Everything
else the functions read via `Deno.env.get(...)` needs its own qa-appropriate value, distinct
from production's:

| Variable                                                                                                                                                                   | Note                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` / `EBAY_RUNAME` / `EBAY_REDIRECT_URI`                                                                                              | Use eBay's **sandbox** app credentials, not the production app                                                                                              |
| `EBAY_ENVIRONMENT`                                                                                                                                                         | Set to whichever value `ebay-publish/constants.ts` uses for sandbox — grep it before setting, don't guess                                                   |
| `EBAY_TOKEN_ENCRYPTION_KEY`                                                                                                                                                | Generate a **new** key, never reuse production's                                                                                                            |
| `GEMINI_API_KEY`                                                                                                                                                           | Own key, or a shared key with its own budget/quota if the owner prefers                                                                                     |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`                                                                                                                              | Use Stripe **test-mode** keys                                                                                                                               |
| `RESEND_API_KEY`, `SENTRY_DSN`, `CRON_SECRET`, `DATABASE_URL`                                                                                                              | Own values; `DATABASE_URL` in particular must point at `majmvgakczrpcwgxgulj`, never production                                                             |
| `APP_URL`                                                                                                                                                                  | `https://qa.listrassistr.com`                                                                                                                               |
| `ENVIRONMENT`                                                                                                                                                              | Whatever this app's code checks for a non-production branch (grep `Deno.env.get("ENVIRONMENT")` before setting — don't invent a value it doesn't recognize) |
| `GEMINI_EMBEDDING_MODEL` / `GEMINI_FAST_MODEL` / `GEMINI_HEAVY_MODEL` / `CATEGORY_GATE4_ENFORCE` / `NEW_OPENAI_API_KEY` / `OPENAI_PROXY_URL` / `VIDEO_FRAME_EXTRACT_DEBUG` | Not secrets tied to an environment — can likely be copied from production as-is, owner's call                                                               |

### 2. Supabase Auth URL configuration — on `majmvgakczrpcwgxgulj` — ✅ done

Dashboard → Authentication → URL Configuration:

- **Site URL:** `https://qa.listrassistr.com`
- **Redirect URLs:** `https://qa.listrassistr.com/**` and `http://localhost:5173/**` (the
  dev port confirmed in T-15, not the stale `3000` the service inventory had recorded)

### 3. `qa` DNS record — checklist Section D — ✅ done

Added per RB-10's `app` sequencing (add the domain in Vercel first, then use the CNAME
target it displays). Vercel's Domains page confirms **Valid Configuration** with a
certificate issued for `qa.listrassistr.com`.

### 4. Vercel branch-and-domain assignment — ✅ done

Per RB-10's `qa.listrassistr.com` checklist (steps 1–4 there): the `qa` branch exists,
`qa.listrassistr.com` is assigned to it (not Production), and a deploy from that branch
shows green. RB-10 step 4's original note — "that project does not exist yet (Q-15) ...
`qa` will share the production project" — is superseded; `qa` now uses its own
branch-scoped env vars from §1, not production's.

---

## RB-09 — Stop using root: create an IAM admin login (O-01) — ✅ DONE 2026-08-28

**Completed.** IAM user `twinwicksllc` (named for the account rather than a person, per the
owner's choice — functionally equivalent) has MFA, belongs only to the Administrator group and
is its only member, and carries `AdministratorAccess`. Account alias is set. Billing visibility
for IAM users is enabled. Root confirmed to have no access keys. The prior user `tom_owner` was
removed — verified safe first, since twin-wicks.com's SES sending uses a separate dedicated
`twin-wicks-smtp-user`, not `tom_owner`.

Asked for by the owner 2026-08-27, who confirmed they normally sign in as root.

**Why this matters more now than it did last week.** Root MFA is already on, which is the
important half. But that single account now controls the domain registration, the
authoritative DNS zone, **and** the KMS key backing DNSSEC — where losing access takes the
domain dark for validating resolvers (A.12). Root should be the account you almost never use.

**On least privilege, honestly:** `AdministratorAccess` is not least-privilege, and for a
larger team the right answer would be scoped policies. For a solo operator, an IAM admin with
MFA is a large improvement over daily root use, and scoping can come later. Do not let the
perfect version block the useful one.

### Steps

1. Sign in as **root**. This is one of the few tasks root is for.
2. **IAM → Users → Create user.** Name it for a person, e.g. `tom-admin`.
3. Tick **Provide user access to the AWS Management Console**, and set a password. Uncheck
   "users must create a new password" if you are setting your own.
4. **Permissions → Attach policies directly → `AdministratorAccess`.**
5. Create the user.
6. **Enable MFA on the new user** — IAM → Users → `tom-admin` → **Security credentials** →
   Multi-factor authentication → Assign MFA device. Use a passkey or TOTP, same as root.
   **Do not skip this.** An admin IAM user without MFA is worse than root with MFA.
7. **Optional but worth it — set an account alias.** IAM dashboard → Account Alias → Create.
   Turns the sign-in URL into `https://<alias>.signin.aws.amazon.com/console`, which is much
   easier than remembering the 12-digit account id.
8. **Enable billing visibility for IAM users**, or you will end up back in root to check the
   bill. As root: **Account → IAM user and role access to Billing information → Edit →
   Activate.** This is a root-only setting, so do it while you are here.
9. Sign out. Sign back in as `tom-admin` and confirm you can reach Route 53, KMS, and Billing.

### Afterwards

- [x] Use `twinwicksllc` for all routine work — Route 53, SES when it happens, everything.
- [x] **Check root has no access keys.** IAM → Security credentials while signed in as root.
      Root access keys should not exist at all; delete any that do. — confirmed none exist.
- [ ] Keep root's MFA and recovery contacts current, and reserve root for the handful of
      things that require it: closing the account, changing support plan, some billing
      settings, and the step 8 toggle above.
- [ ] Record in the service inventory that day-to-day access is via an IAM principal with
      MFA. Names and methods only, never credentials.

---

## RB-10 — Create the `app` and `qa` subdomains (O-06) — ✅ BOTH DONE, `qa` 2026-09-02

**`app.listrassistr.com` completed and externally verified 2026-08-28.** CNAME resolves
consistently across five resolvers to `2f1e3f86cb32a6a8.vercel-dns-016.com`; Let's Encrypt
issued a certificate (CN=YR2, single SAN `app.listrassistr.com`, valid 28 Aug 2026 –
26 Nov 2026); the site answers HTTP/2 200 with no redirects; `www` and the apex resolve as
expected and point at the same Vercel project; DNSSEC is signed end-to-end with RRSIG/NSEC
validating correctly on in-zone records.

**Resolved 2026-08-28.** A first external check described the page as a working application
interface, which read as the opposite of this runbook's prediction. A same-day, deeper follow-up
check resolved it: `app.listrassistr.com` and the apex both serve an identical "COMING SOON"
holding page — no functionality behind login/signup, no backend API on any `/api/*` path
(each returns the SPA HTML shell, not JSON), and `/dashboard`/`/listings` both 404 rather than
rendering a guarded view. The prediction below was correct. Full evidence in A.18b.

One loose end worth naming, not blocking anything: the signup form's own on-page text says
account creation "will open when the application shell is ready," yet the owner already holds
a real Supabase auth record from an earlier signup. Either the copy is stale or signup quietly
works despite what it says — worth a look when convenient, but it doesn't change Q-17.

`qa.listrassistr.com` completed 2026-09-02 — `qa` branch created, domain assigned to it in
Vercel (not Production), CNAME added in Route 53, and the domain row shows Valid
Configuration with a certificate issued. Full detail in **RB-08**, which also covers the
non-production Supabase project it now points at.

Owner decided 2026-08-27: **`app` and `qa` should be subdomains, not paths.** That matches
plan §6.1's two-host target, and it supersedes A.14's recommendation to defer — deferral was
advice on the assumption the path layout would stand, and the owner has chosen otherwise.

**One thing to be clear-eyed about before starting.** The application currently lives at
`listrassistr.com/app/*`, and marketing at `/`. Both come from the same Vercel deployment. So
adding `app.listrassistr.com` today was expected to give a working hostname that **serves the
marketing page at its root**, until host-based routing exists in the application. **Confirmed
correct — see the resolution noted at the top of this runbook.**

That interim state is harmless pre-launch, and there is a real argument for doing it now: it
proves the DNS and certificate path, reserves the hostname, and means nothing DNS-shaped is on
the critical path later. Just do it knowing what it will show.

**DNSSEC is not a complication.** Route 53 signs new records in a signed zone automatically —
adding records needs no special handling now that A.12's chain is live.

### `app.listrassistr.com` — can be done now

1. Vercel → project **`listrassistr-official`** → **Domains** → **Add**.
2. Enter `app.listrassistr.com`. Choose to serve production, **not** a redirect.
3. Vercel will display the DNS record it wants — a **CNAME** to a per-project target.
   **Use exactly what it shows**, per §8.1.5; do not reuse the `www` target from memory.
4. Route 53 → hosted zone `listrassistr.com` → **Create record**:
   - Record name: `app`
   - Type: **CNAME**
   - Value: the target Vercel displayed
   - **TTL: 300**
5. Back in Vercel, wait for **Valid Configuration** and for the certificate to issue.
6. ✅ Done — resolution, certificate chain, and DNSSEC all verified 2026-08-28 (evidence above).

### `qa.listrassistr.com` — needs one thing first

`qa` should track a branch, not production, or it is just a second production hostname with a
misleading name. So:

1. **Create a long-lived branch** in `listrassistr-official` — `qa` is the obvious name.
2. Vercel → **Domains** → **Add** `qa.listrassistr.com`, and **assign it to that branch**
   rather than to production.
3. Add the CNAME Vercel displays in Route 53, again at **TTL 300**.
4. **Superseded 2026-09-01.** This step originally said the non-production project didn't
   exist yet and `qa` would have to share production's in the meantime. It now exists —
   `listrassistr-qa`, ref `majmvgakczrpcwgxgulj` — so skip the interim sharing and go
   straight to branch-scoped env vars pointing at it. Full variable list in **RB-08**.

### What still needs application work

Neither hostname behaves correctly until the app routes by host:

- `app.listrassistr.com` → serve the authenticated product at `/`, not marketing.
- `listrassistr.com` → serve marketing, and ideally redirect `/app/*` to the new host so old
  links keep working.

That is code in `listrassistr-official`, and it is what makes P1-06 genuinely closable rather
than technically satisfied. Worth drafting the routing approach together when you are ready.
