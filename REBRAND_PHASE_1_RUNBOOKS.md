# Rebrand Phase 1 — Runbooks

**Product:** ListrAssistr
**Scope:** `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §8 only, per DEC-0035
**Status date:** 2026-08-27

Step-by-step procedures for the Phase 1 items the owner executes. Companion to:

- `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md` — reference, reasoning, record shapes
- `REBRAND_PHASE_1_TODO.md` — what is outstanding, with owners and priorities

Console navigation is described by label rather than exact path, because provider UIs
move. Where a step is version-sensitive it says so.

**RB-01 to RB-04 are complete** (2026-08-27; verified in checklist A.7d and A.12).
Remaining: **RB-04** what the buttons do, **RB-05** verify the production Supabase project,
**RB-06** target-repo staleness audit, **RB-07** place the DEC entries, **RB-08** qa —
blocked pending a Phase 3 gate.

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

## RB-05 — Verify the production Supabase project (O-37, revised)

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

**Report:** name, region, project URL, organisation, empty or not, Site URL, allow-list,
key format. **No key values, ever.**

---

## RB-06 — Review the target repository (O-33)

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

I have no access to that repository, so this needs you — or read access granted. Either
way, send me the file list and I will tell you which items conflict with the Phase 0
record and draft the corrections.

---

## RB-07 — Place the three DEC entries (T-14, O-22)

Draft text already exists in the checklist:

| Entry        | Subject                                                        | Where the draft lives |
| ------------ | -------------------------------------------------------------- | --------------------- |
| **DEC-0036** | §8.1.1 entity deviation accepted, revisit at Stripe onboarding | checklist A.2         |
| **DEC-0037** | Name `ListrAssistr` approved under owner sign-off              | checklist A.1a        |
| **DEC-0038** | Phase 1 document location — option C, destination recorded     | checklist A.8         |

1. Open `REBRAND_PHASE_0_DECISION_LOG.md`.
2. Append the three rows, following the existing column format.
3. Confirm the highest DEC id becomes **DEC-0038**.

Or say the word and I will do it as a PR — it is a mechanical edit to a document you own,
so I have not touched it unasked.

---

## RB-08 — The qa environment: blocked, and it needs a Phase 3 gate

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

### Draft Phase 3 entry decision, so the gate is a one-line approval

> **DEC-00xx** — Approves entry to plan §10, Phase 3: New Supabase Projects, **scoped to
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

### What I will draft once that gate exists

- The full **environment-variable matrix** — which variable belongs to which environment
  and which project it points at. Names and destinations only, never values.
- The exact **Supabase Auth URL configuration** for the qa project, including `localhost`
  for development.
- The **`qa` DNS record row** for the checklist's Section D, once the Vercel target exists.
- The **Vercel branch-and-domain assignment** steps from A.6.
