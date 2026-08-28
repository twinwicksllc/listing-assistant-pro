# Rebrand Phase 1 — Domain, DNS, and Email Record Checklist (Plan §8.1, §8.2)

**Product:** ListrAssistr
**Repository:** `twinwicksllc/listing-assistant-pro` (legacy; stays live per DEC-0003)
**Scope:** Detailed checklists cover `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`
§8.1 and the DNS-resident parts of §8.2. Section J tracks the full §8 exit gate,
including §8.3 brand assets, so Phase 1 can be closed on evidence. Repository code
changes are §9/Phase 2 and out of scope here per DEC-0035.
**Owner:** User (all registrar, DNS, Vercel, Resend, and legal actions)
**AI role:** Drafting, record shapes, verification procedure. No provider action.
**Action list:** `REBRAND_PHASE_1_TODO.md` holds every open item with an owner and a
priority. **Procedures:** `REBRAND_PHASE_1_RUNBOOKS.md` holds the step-by-step execution
paths. This document is the reference behind both.

## Gate status — read first

**Phase 1 is approved.** Phase 0 closed 2026-08-25:

- `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` records **Status: Closed — Phase 0 exit
  and Phase 1 entry approved 2026-08-25 (DEC-0035)**.
- **P0-18 "Phase 1 entry decision"** is **Approved — GO (2026-08-25,
  DEC-0035)**, resolving P0-17 alongside it.
- **DEC-0034** approved the final migration cohort (4 of 9 profiles transfer;
  all QA-shaped profiles excluded, revising DEC-0029).

**What DEC-0035 authorizes, verbatim in scope:** plan §8 **only** — domain
acquisition/security, email identity, and brand asset production. Provider
dashboard and creative work, **not repository code**. §9 (Phase 2: repository
brand foundation) and beyond remain separately gated and are explicitly **not**
approved by DEC-0035.

**Conditions DEC-0035 carries forward unchanged**, and which therefore govern
every item in this document:

- `twinwicksllc/listing-assistant-pro` remains the live production application.
- No cutover, migration execution, or destructive production action is implied.
- All standing rules in `CLAUDE.md`'s rebrand section continue to apply
  throughout Phase 1 — secret handling, and **explicit owner approval before any
  production/provider/DNS/Stripe/eBay/Supabase change**.

That last condition is the operative one here: DEC-0035 approves _doing Phase 1_,
it does not pre-approve each individual provider action inside it. Every registrar
purchase, DNS write, and Resend change still needs the owner at the keyboard.

Sequencing note: DEC-0033 records the October 1, 2026 window as explicitly
provisional _because_ "none of Phases 1–6 have started (domain not yet
registered)". Domain registration is the item that unblocks re-assessing it.

## Confirmed state as of 2026-08-26

Owner-supplied 2026-08-26 (Route 53 console screenshots), independently verified
by DNS query from the owner's workstation the same day. This supersedes the
earlier draft's assumption that nothing had been registered yet.

| Fact                | Value                                                                                                                                                                                     | How confirmed                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Domain              | `listrassistr.com` — **registered and live**                                                                                                                                              | Owner + resolver query                  |
| Registrar           | **AWS Route 53 Domains**                                                                                                                                                                  | Owner                                   |
| Registration date   | **2026-08-06**                                                                                                                                                                            | Owner                                   |
| Expiry              | **2027-08-06**, auto-renew on                                                                                                                                                             | Owner                                   |
| Authoritative DNS   | **AWS Route 53** public hosted zone                                                                                                                                                       | Owner + `NS` records are all `awsdns-*` |
| Currently serving   | A branded "Coming Soon" page at the apex                                                                                                                                                  | Owner screenshot                        |
| Other domains owned | `teckstart.com`, `twin-wicks.com` — separate projects, out of scope                                                                                                                       | Owner                                   |
| Typo-defence domain | `listerassistr.com` — **acquired 2026-08-26**, own Route 53 zone, **confirmed configured as a redirect** to the canonical apex (A.1f). `listrassister.com` registration **failed** (A.1g) | Owner + resolver query                  |

### Verified zone contents

| Record                 | Type  | Value                                 | TTL    | State                                                                                                                                              |
| ---------------------- | ----- | ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listrassistr.com`     | A     | `216.150.1.1`                         | 300    | Live and **canonical** — serves production as of 2026-08-27 (A.7d). Value **leave as-is**; confirm against the Vercel dashboard, not documentation |
| `www.listrassistr.com` | CNAME | `2f1e3f86cb32a6a8.vercel-dns-016.com` | 300    | Live, and **308-redirects to the apex** as of 2026-08-27 (A.7d)                                                                                    |
| `listrassistr.com`     | NS    | 4× `awsdns-*`                         | 172800 | Route 53 default, correct                                                                                                                          |
| `listrassistr.com`     | SOA   | `ns-1068.awsdns-05.org`               | 900    | Route 53 default                                                                                                                                   |
| `app`                  | —     | —                                     | —      | **Absent** — required by §8.1.6                                                                                                                    |
| `qa`                   | —     | —                                     | —      | **Absent** — required by §8.1.6                                                                                                                    |
| TXT / SPF              | —     | —                                     | —      | **Absent**                                                                                                                                         |
| MX                     | —     | —                                     | —      | **Absent**                                                                                                                                         |
| `_dmarc`               | —     | —                                     | —      | **Absent**                                                                                                                                         |
| DNSKEY / DS            | —     | see A.12                              | 3600   | **Present — DNSSEC live and validating** as of 2026-08-27 (A.12)                                                                                   |
| CAA                    | —     | —                                     | —      | **Absent**                                                                                                                                         |

Two consequences worth stating plainly:

- **Email is entirely greenfield.** No MX, SPF, DKIM, DMARC, or CAA records exist,
  so nothing in §8.2 risks colliding with existing mail. This is the easy case.
- **The apex and `www` are already correct and already at TTL 300**, so §8.1.7's
  pre-cutover TTL drop is already satisfied. See D.1.

### Source-document corrections this surfaced

Recorded, not silently reconciled — correcting the source documents is the owner's
call.

| Document                                                                      | Says                                                                                                 | Actually                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0033 (2026-08-19)                       | "none of Phases 1–6 have started (domain not yet registered)"                                        | The domain was registered **2026-08-06**, 13 days before DEC-0033 was written. The broader point (no cutover date can be committed yet) still stands                                                                                                                                                                                                                          |
| `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0035                                    | Labels RBR-0003 as "no staging Supabase project yet"                                                 | RBR-0003's own row is "Function config has broad `verify_jwt = false` entries". The staging requirement traces to DEC-0005/DEC-0004                                                                                                                                                                                                                                           |
| DEC-0035, same clause — **REVERSED 2026-08-27, this row was wrong; see A.11** | "no staging Supabase project yet"                                                                    | **DEC-0035 was correct.** This row originally claimed the service inventory contradicted it by recording a staging project. The owner has since confirmed `yqftpibxplachhwoclam` is the intended **production** project, so there is no staging project and the **service inventory** carries the error, not DEC-0035. Kept rather than deleted so the reversal stays visible |
| `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §8.2.1 vs §6.1                   | §8.2.1 lists `support`/`privacy`/`legal`/`security`; §6.1 lists `support`/`privacy`/`legal`/`alerts` | Five distinct addresses across the two lists. Which set is authoritative is an open question (Group 4)                                                                                                                                                                                                                                                                        |

### External verification — results, 2026-08-26

Answers obtained from vendor documentation via a web-enabled research pass, then
assessed against the zone's observed state. **Three findings conflict with what
the live zone actually does, and one is technically impossible as stated.** Both
sources are recorded so the disagreement is visible rather than averaged away.

| Question                      | Research answer                                                                                                                                            | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel apex A value           | "Officially `76.76.21.21`; do not use `216.150.1.1`, it is flagged by security vendors"                                                                    | **Do not act on this.** `76.76.21.21` is Vercel's long-standing _generic documented_ value. The live zone serves `216.150.1.1` and works, and the `www` record is a _per-project_ target — a pattern consistent with Vercel now issuing project-specific values. Plan §8.1.5 resolves this directly: use what **Vercel's dashboard displays for this project**, not what any documentation says. The "flagged for abuse" reasoning is weak — that is true of any shared anycast IP, `76.76.21.21` included |
| Route 53 ALIAS at apex        | "AWS recommends an ALIAS record rather than a standard A record"                                                                                           | **Impossible as applied here.** Route 53 ALIAS targets are AWS-only — CloudFront, ELB, S3 website endpoints, API Gateway, Global Accelerator, or another record in the same zone. **Vercel is none of these, so a Route 53 ALIAS cannot point at Vercel.** The generic AWS advice is correct for AWS-hosted origins and a dead end for this stack. Keep the plain A record                                                                                                                                 |
| Subdomain CNAME target        | "`cname.vercel-dns.com`"                                                                                                                                   | Legacy generic value. The live `www` uses `2f1e3f86cb32a6a8.vercel-dns-016.com`, per-project. Take `app` and `qa` targets from the dashboard                                                                                                                                                                                                                                                                                                                                                               |
| CAA / issuing CA              | "Vercel automatically creates a CAA record for `letsencrypt.org`"                                                                                          | **Not happening here** — the zone has no CAA record. Vercel can only manage CAA when Vercel manages the DNS; with Route 53 external it cannot. So CAA is a manual add, and the CA must be confirmed before setting it (see below)                                                                                                                                                                                                                                                                          |
| Resend DKIM/SPF types         | DKIM as TXT; SPF as TXT, often `include:amazonses.com` since Resend runs on SES                                                                            | Plausible and consistent with Resend's architecture. **Still publish exactly what the Resend dashboard issues** — the include value may be Resend-specific rather than raw SES                                                                                                                                                                                                                                                                                                                             |
| Resend custom return-path     | Supported, default `send.yourdomain.tld`, not gated behind Enterprise                                                                                      | Accepted. Satisfies §8.2.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Resend free-tier domains**  | **1 verified domain**, 3,000 emails/month, 100/day cap. Second domain requires **Pro at $20/month** (10 domains, 50,000 emails)                            | Accepted, and it **confirms RBR-0031**. Materially changes the Section F recommendation — see F.1                                                                                                                                                                                                                                                                                                                                                                                                          |
| Route 53 DNSSEC DS publishing | **Manual.** Route 53 does _not_ auto-publish DS to the parent even when it is also the registrar. Copy Key tag, Algorithm, Digest into Registered domains  | Accepted, and it removes the hoped-for simplification in C.1. Raises the care required — see I.2                                                                                                                                                                                                                                                                                                                                                                                                           |
| DNSSEC rollback               | Delete DS at registrar **first**, wait out the parent DS TTL, **then** disable signing. Wrong order breaks the chain and the domain drops off the internet | Accepted and load-bearing. Captured as an explicit ordering in I.2                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Route 53 registrar settings   | Route 53 → Domains → Registered domains. Privacy per-contact; AWS recommends the same level on all four                                                    | Matches the owner's existing configuration — all four already on, which is what AWS recommends                                                                                                                                                                                                                                                                                                                                                                                                             |
| **ICANN 60-day lock**         | **Applies to cross-account transfers.** Triggered by registration **and by any change to WHOIS registrant name, email, or organization**                   | Accepted, and it creates a schedule conflict — see A.2a                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| USPTO tool                    | TESS retired 2023-11-30, replaced by `tmsearch.uspto.gov`; free; searching creates no public record                                                        | Confirms A.1a's reasoning. No change needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **DMARC `p=none` duration**   | M3AAWG: **minimum 2–4 weeks**, commonly **30–90 days** recommended                                                                                         | **Longer than this document previously assumed.** D.2 said "one full weekly reporting cycle," which was too short. Corrected in D.2 and Section I                                                                                                                                                                                                                                                                                                                                                          |

### The owner's workstation cannot verify external state

Measured directly 2026-08-26, and it generalises well beyond one record:

- **DNS is filtered.** Only `1.1.1.1` is reachable; `8.8.8.8`, `9.9.9.9`, `1.0.0.1`,
  and `208.67.222.222` all fail, including for `google.com`.
- **TLS is intercepted.** An HTTPS request to `listrassistr.com` from that machine
  returns a certificate issued by `ABBVIE-ZSCALER-SSLDE.ABBVIE.COM`, with subject
  organisation "Zscaler Inc." — not Vercel's certificate. The request itself
  returned 403 through the proxy.

Consequences for Phase 1, all of which land on gates in Section J:

- **The real issuing CA cannot be determined from that machine**, browser padlock
  included, because the padlock shows the interception certificate. This blocks
  setting a CAA record safely (P1-06, and B.1's CAA item) — a CAA record naming
  the wrong CA silently blocks issuance and renewal.
- **Certificate and DNSSEC validation must be done externally** — `dnsviz.net`,
  `dnschecker.org`, `whatsmydns.net`, or SSL Labs — or from a personal device
  (P1-05, P1-06).
- **Email header inspection** for SPF/DKIM/DMARC alignment should be done in a
  personal mailbox, not one behind corporate mail security that may rewrite or
  re-sign headers (P1-08).

Separately worth knowing rather than acting on: provider-dashboard work for this
project — registrar, Resend, Supabase, Stripe — currently passes through corporate
TLS inspection on that network. That is a reason to do credential-entering work
from a personal device, independent of any policy question.

## Tier 1 verification results — 2026-08-27

Owner-supplied, with a Vercel dashboard screenshot. Two of the answers turned out to
matter more than the questions did; those are in A.3 and A.4 below.

| Item          | Question                               | Result                                                                                                                                                                                                                            |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O-05**      | Registrant contact ICANN-verified?     | **Verified.** Closes the standing suspension risk to `listrassistr.com`                                                                                                                                                           |
| **O-01**      | Root vs IAM, and MFA method            | **Root MFA enabled** — passkey on laptop, biometrics on mobile. Strong: both are phishing-resistant WebAuthn factors, which is the recommended tier rather than TOTP or SMS                                                       |
| **O-03**      | `listrassister.com` error text         | Domain **is available**, but **AWS support says the account is restricted from registering new domains**. Anomalous: the same account registered `listerassistr.com` at essentially the same time. Owner has an open support case |
| **Q-01/Q-02** | Which Vercel project                   | **`tom-fenwicks-projects/listrassistr-official`** — see A.3. Not the legacy project                                                                                                                                               |
| **O-08**      | Supabase Auth SMTP on the live project | **No custom SMTP** on `wcednzaxmxwfiijzmjmx`. Confirms the F.3 hypothesis, with an important qualification in A.5                                                                                                                 |

### On the O-01 result

Passkey plus biometrics is better than what B.1 asked for. Both are WebAuthn
authenticators, so the account is protected by phishing-resistant factors rather than
TOTP codes or SMS. The remaining B.1 sub-question is unchanged and still worth a look:
whether day-to-day Route 53 work happens **as root**, or as an IAM principal that has
its own MFA. Root MFA does not help if root is also the daily driver.

### On the O-03 restriction

Worth raising explicitly in the open support case, because it is broader than one typo
domain: **does the restriction affect renewals and registrar operations on domains the
account already holds?** `listrassistr.com` renews 2027-08-06 with auto-renew on. A
restriction scoped to _new registrations_ should not touch a renewal, but that is worth
having in writing rather than assumed, since the alternative is discovering it at
renewal time. Cheap to ask while the case is already open.

## A.3 Q-01 answered — and the target repository is already live

**The coming-soon page is not served by the legacy project.** Confirmed from the Vercel
dashboard 2026-08-27:

| Field                 | Value                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| Vercel project        | **`tom-fenwicks-projects/listrassistr-official`**                                                      |
| Production deployment | `listrassistr-official-8n97xmnnm-tom-fenwicks-projects.vercel.app`                                     |
| Domains listed        | `www.listrassistr.com`, `listrassistr-official.vercel.app`                                             |
| Status                | Ready, created **2026-08-10**                                                                          |
| Source                | branch `main`, commit `a8d548a`, "Merge pull request #16 from twinwicksllc/docs/phase-0-target-status" |
| Active branches seen  | `docs/phase-0-target-status` (#16), `docs/staging-rollback-runbook` (#14)                              |
| Plan                  | Vercel **Pro**                                                                                         |

The commit subject and branch names are the important part: they are **not from this
repository**. This is the migration target repo, `twinwicksllc/listrassistr-official`
(DEC-0002), already existing, already deployed, already accumulating its own
documentation PRs.

**This is expected rather than a surprise, and it is in scope.** RBR-0011 was superseded
on 2026-08-19 when the owner confirmed the target repo exists, and its disposition says
in terms: "reviewing its actual contents (if any exist yet) is **Phase 1**." So
reviewing that repository is a Phase 1 task that had not yet been scheduled. Now it can
be.

It is also good news structurally: the ListrAssistr frontend is already separate from
the legacy application, so there is no entanglement to unpick later.

### A.3a Two things the screenshot leaves open

**1. The apex is not in the listed domains.** Only `www.listrassistr.com` appears, yet
DNS has an apex A record at `216.150.1.1` and the owner's earlier screenshot showed the
page rendering at `listrassistr.com` with no `www` in the address bar. Three
possibilities, and they have different consequences:

- The Overview widget truncates the domain list and the apex is attached normally.
- The apex is attached and **redirects to `www`** — which would make **`www` canonical**,
  contradicting plan §6.1's implication that the apex is the marketing site.
- The apex and `www` **both serve the same content** with no redirect — the split-canonical
  problem flagged in A.1f for the typo domain, now applying to the primary domain.

Needed: **Vercel → Domains** (left nav) for the full list, showing which domain is
primary and whether any redirect is configured. That single screen resolves Q-03 as well
as this.

**2. "1 Recommendation" on Deployment Settings.** Unread. Worth opening, because F.5's
apex-value question resolves to "use what the dashboard recommends" — and if Vercel is
recommending a different apex A value, that recommendation is where it would appear.

## A.4 Where Phase 1 documentation belongs — a control-document conflict

Raised because it implicates the two documents in this pair, and because the finding in
A.3 makes it concrete rather than theoretical.

`REBRAND_PHASE_0_IMPLEMENTATION.md` §2 "Repository Transition Control" states that until
cutover:

> New ListrAssistr creation, migration tooling, **brand work**, infrastructure
> configuration, and launch artifacts belong in `listrassistr-official`.

and

> Any code or document temporarily created in the current workspace must have a recorded
> destination and migration step before Phase 0 closes.

Both `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md` and `REBRAND_PHASE_1_TODO.md` were
created in **this** repository, after Phase 0 closed, and **neither has a recorded
destination**. Meanwhile A.3 shows the target repo is already running its own
documentation branches. That is the "parallel-development risk" RBR-0011 originally
named, re-emerging in a different form: two sets of rebrand documentation, in two
repositories, able to diverge silently.

**Three options, owner's decision:**

| Option                                                                                  | For                                                                                                                                                                                                                                           | Against                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **A. Phase 1 planning docs stay here; brand _artifacts_ go to `listrassistr-official`** | These documents cite DEC-, RBR-, and P0- identifiers on almost every page, and that record lives here. Moving them makes the cross-references dangle. §8.3 artifacts are genuinely new-product material and belong in the new repo regardless | Partially at odds with the control document's wording, which says "brand work" broadly                  |
| **B. Move Phase 1 docs to `listrassistr-official`**                                     | Literal compliance with the control document; keeps all go-forward material in one place                                                                                                                                                      | Breaks cross-references to the Phase 0 record; the decision log and exception log would still live here |
| **C. Keep here, with an explicit recorded destination and migration step**              | Satisfies the control document's actual requirement, which is a _recorded destination_, not immediate relocation. Lowest disruption                                                                                                           | Requires the record to actually be written, or it is option A with extra words                          |

Recommendation: **C**, naming the destination as `listrassistr-official` at cutover, with
§8.3 artefacts going there immediately as produced. That satisfies the control document
without breaking the cross-reference web while Phase 0's record still lives here.

Either way this needs a DEC entry, and it should be settled before more Phase 1
documentation accumulates in this repository.

## A.5 O-08 answered, with a qualification that matters

**No custom SMTP is configured on `wcednzaxmxwfiijzmjmx`.** So auth mail for the
**legacy** application currently goes through Supabase's built-in mailer, from a
Supabase-owned domain, rate-limited and not intended for production. That confirms F.3's
hypothesis for the legacy app.

**But that is not the project P1-08 depends on.** P1-08 requires branded mail
authenticating for **`listrassistr.com`**, and `wcednzaxmxwfiijzmjmx` is the shared
CRM/legacy project. The relevant project is whichever one **ListrAssistr** will actually
use — most likely the staging project `yqftpibxplachhwoclam`, or a new one not yet
created. So O-08's answer is useful migration context rather than a P1-08 input, and the
P1-08 question stays open until the ListrAssistr Supabase project is identified.

This connects directly to the still-unanswered staging-project questions and to Q-08
(whether the coming-soon page's "Sign in" link points anywhere yet). If nothing in
`listrassistr-official` talks to Supabase at all, then §8.2's auth-mail work has no
target yet, and SES configuration should wait for one rather than being pointed at the
legacy project.

## A.6 Setting up `qa` — and why to defer the record

Owner asked how a QA environment is set up, and noted nothing much is built in the
project yet, with no `app` or `qa` today.

**Three ways to do it on Vercel, in increasing isolation:**

| Approach                           | How                                                                                                                    | Trade-off                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Branch-assigned preview domain** | Create a long-lived branch (e.g. `qa`), then Vercel → Domains → add `qa.listrassistr.com` and assign it to that branch | Simplest, no second project. Preview-scoped environment variables apply to _all_ previews, not just that branch                      |
| **Custom environment**             | Vercel Pro supports named environments beyond production and preview, each with its own domain and variables           | Cleanest separation of variables. Verify availability and current behaviour against Vercel's live documentation before relying on it |
| **Separate Vercel project**        | Second project on the same repo, tracking a different branch                                                           | Strongest isolation, most overhead — two projects to configure and keep aligned                                                      |

Recommended: the **branch-assigned preview domain**, unless per-environment variables
turn out to matter, in which case a **custom environment** on Pro.

**The environment-variable point is the one that actually matters.** DEC-0005 requires
separate staging and production environments and credentials, so `qa.listrassistr.com`
must point at the **staging** Supabase project (`yqftpibxplachhwoclam`), never
production. With plain preview scope, every preview deployment would use staging — which
is arguably the correct default anyway, but it should be a deliberate choice rather than
a side effect.

### Revising the earlier advice on creating the records now

D.1 previously said to create `app` and `qa` at TTL 300 so they inherit the low TTL.
Given that nothing is built yet, that should be split:

- **`app.listrassistr.com` — create it now.** It will serve the coming-soon page, which
  is harmless, and it proves the DNS and certificate path end to end while the stakes are
  low. It also reserves the hostname.
- **`qa.listrassistr.com` — defer** until a branch or environment exists to assign it to.
  A record pointing at nothing proves nothing and only invites confusion.

Recorded honestly: this means **P1-06 cannot fully close yet**. §8.1.6's purpose is that
these hostnames work, and a hostname serving a placeholder demonstrates the DNS and cert
path but not the application. The gate should close when both serve their intended
content, not when the records merely exist.

## A.7 Q-03 resolved — apex is now canonical (both findings actioned)

**Resolved 2026-08-27. Jump to A.7d for the current, verified state.** This section
records the observation that prompted the change, and is kept because the two
misconfigurations it found are the reason RB-01 and RB-02 exist.

### A.7 (as observed, before the fix)

Vercel → Domains, captured 2026-08-27. All five entries showed Valid Configuration:

| Domain                             | Behaviour                                    |
| ---------------------------------- | -------------------------------------------- |
| `www.listrassistr.com`             | **Production** — the canonical host          |
| `listrassistr.com` (apex)          | **308 → `www.listrassistr.com`**             |
| `listrassistr-official.vercel.app` | **Production**                               |
| `listerassistr.com`                | **308 → `listrassistr-official.vercel.app`** |
| `www.listerassistr.com`            | **308 → `listrassistr-official.vercel.app`** |

So at that point **`www` was canonical and the apex redirected to it.** That answered
Q-03 and resolved A.3a's ambiguity: the Overview widget was not truncating — the apex
genuinely was a redirect rather than a serving domain. **This has since been flipped, see
A.7d.**

### A.7a This contradicts plan §6.1, and the divergence needs closing

Plan §6.1 specifies:

| Purpose        | Plan §6.1 target               | Actual                             |
| -------------- | ------------------------------ | ---------------------------------- |
| Marketing site | `https://listrassistr.com`     | **`https://www.listrassistr.com`** |
| Application    | `https://app.listrassistr.com` | Not yet created                    |
| QA/staging     | `https://qa.listrassistr.com`  | Not yet created                    |

The plan says the apex is the marketing site. The deployment says `www` is. One of them
should change, and the choice is the owner's:

| Option                                               | What it takes                                                          | For                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Make the apex canonical** — matches plan §6.1   | Flip the Vercel config: apex becomes Production, `www` redirects to it | Plan and reality agree with no document edit. The already-recorded Supabase Auth Site URL (`https://listrassistr.com`) becomes correct as-is                                                                                                                                              |
| **B. Keep `www` canonical** — matches the deployment | Update plan §6.1 to name `www.listrassistr.com` as the marketing site  | No change to working configuration. **Genuine technical benefit:** cookies set on `www` do not ride along to `app.` and `qa.`, whereas apex cookies are sent to every subdomain. Marketing and analytics scripts on the marketing site therefore cannot leak cookies into the application |

Recommendation at the time was **B, keep `www`** — on the grounds that it already worked
and that cookies on `www` do not ride along to subdomains.

**Owner chose A, 2026-08-27: the apex is canonical.** Executed via RB-01 and verified in
A.7d. That resolves the divergence in the plan's favour, so **plan §6.1 needs no edit** —
it already names the apex as the marketing site. Option B's cookie-isolation benefit is
given up, which is worth noting rather than forgetting: any marketing or analytics script
that sets a cookie on the apex will have it sent to `app.` and `qa.` as well. Worth
remembering when analytics is added, not a reason to revisit.

### A.7b The auth consequence — this one is functional, not cosmetic

`REBRAND_PHASE_0_SERVICE_INVENTORY.md:76` records the staging Supabase project's
configuration as:

- Auth Site URL: `https://listrassistr.com` — **the apex**
- Allowed callback: `https://listrassistr.com/auth/callback` — **the apex**

**Resolved by the flip to apex-canonical (A.7d): that recorded configuration is now
correct as-is, and needs no change.** The reasoning is kept because it is the mechanism
to re-check whenever a hostname changes again.

While the apex was 308-redirecting to `www`, that configuration was inconsistent with the
deployment, and it is the kind of inconsistency that breaks sign-in rather than merely
looking untidy:

- Supabase's client libraries use **PKCE** by default, and the code verifier is held in
  browser storage **scoped to the origin**. A flow that begins on one origin and
  completes on another cannot read its own verifier.
- In practice a visitor never stays on the apex — they are redirected to `www`
  immediately — so the flow runs on `www` while the allow-list names only the apex.
  Either Supabase rejects the redirect, or it sends the browser to the apex which bounces
  back to `www`. Either way the origins disagree.

**Whichever canonical host is chosen, the Supabase Auth Site URL and the redirect
allow-list must match it exactly.** With apex-canonical chosen and the recorded Site URL
already `https://listrassistr.com`, they now match. Still to confirm against the live
project rather than the inventory record — RB-05 step 5.

### A.7c The typo domains redirect to the wrong target

**Fixed 2026-08-27 via RB-02 — both now 308 to `listrassistr.com`. See A.7d.**

As found, `listerassistr.com` and `www.listerassistr.com` both 308'd to
**`listrassistr-official.vercel.app`** — the Vercel technical hostname — rather than to
the brand domain.

The earlier confirmation that these "redirect rather than serve" was accurate, so A.1f's
main concerns stand closed. But the target is wrong on three counts:

1. **Brand.** Someone who mistypes lands on `listrassistr-official.vercel.app`, an
   internal-looking URL that is not the product name. That defeats the point of owning
   the typo domain.
2. **SEO.** A redirect chain should terminate at the canonical brand host. Pointing it at
   a `.vercel.app` alias splits signals and leaves that alias competing with the brand
   domain, since it is also configured as Production.
3. **Legal posture.** A.1f's argument was that redirecting to _your own brand_ is what
   makes owning a one-character variant of a live competitor's domain unambiguously
   defensive. "Redirects to my brand" is a materially cleaner story than "redirects to a
   technical hostname". The core defence — that it serves no content — holds either way,
   but this is free to fix.

- [ ] Repoint `listerassistr.com` and `www.listerassistr.com` to **`www.listrassistr.com`**
      (or whichever host A.7a settles on), not to the `.vercel.app` alias.
- [ ] Consider whether `listrassistr-official.vercel.app` should remain a Production
      domain, or redirect to the canonical host as well. Leaving a `.vercel.app` alias
      publicly serving production content is usually not what you want once a real domain
      exists.

### A.7d Current state — verified 2026-08-27 after RB-01 and RB-02

Vercel → Domains, second capture. All five entries show Valid Configuration:

| Domain                             | Behaviour                    | Change                                     |
| ---------------------------------- | ---------------------------- | ------------------------------------------ |
| `listrassistr.com` (apex)          | **Production** — canonical   | flipped from a 308 to `www`                |
| `www.listrassistr.com`             | **308 → `listrassistr.com`** | flipped from Production                    |
| `listerassistr.com`                | **308 → `listrassistr.com`** | repointed from the `.vercel.app` host      |
| `www.listerassistr.com`            | **308 → `listrassistr.com`** | repointed from the `.vercel.app` host      |
| `listrassistr-official.vercel.app` | **Production**               | unchanged, per RB-02's O-36 recommendation |

**All four intended changes are correct, and there is no redirect loop** — the apex
terminates the chain by serving content rather than redirecting onward, which is the
failure RB-01 warned about.

Every redirect now lands on the brand apex. Consequences, closing three earlier items:

- **Q-14 / Q-03 closed.** Canonical host is the apex, matching plan §6.1, so no plan edit.
- **O-35 closed.** A.7c's brand, SEO, and legal-posture objections are all addressed: the
  typo domains now terminate at the owner's own brand, which is the configuration A.1f's
  defensive-registration argument depends on.
- **A.7b closed.** The recorded Supabase Auth Site URL `https://listrassistr.com` matches
  the canonical host, so no auth reconfiguration is needed. Still worth confirming against
  the live project rather than the inventory (RB-05).

**Verification limits, recorded honestly.** This rests on the owner's dashboard
screenshot. Independent HTTP confirmation was attempted from the owner's workstation and
returned **403 on all four hostnames** — the Zscaler interception documented earlier, not
a fault in the configuration. DNS confirms both hostnames still resolve to Vercel, but DNS
cannot show redirect direction. A genuine external check of the 308 chain still wants a
personal device or an external tool, and is worth doing once for the record.

- [ ] Confirm from a personal device: apex returns 200, the other three return 308 to the
      apex, and no chain exceeds one hop.

## A.8 Q-13 decided — option C, with the destination recorded

**Owner decision 2026-08-27: option C.** Phase 1 planning documents stay in this
repository with a recorded destination; §8.3 artefacts go to `listrassistr-official` as
they are produced.

**CORRECTED 2026-08-27 — see A.16.** Owner reported **no parallel development**, nothing
beyond initial setup pushed to `listrassistr-official`. RB-06 found **40 commits across 16
merged PRs**, a full application foundation, and **three forked copies of governance
documents maintained here** — including the master plan and the control document. The
assessment below was wrong and the conclusion it supported needs the revision in A.16.
Original text, kept visible: Recorded with one
observation rather than a contradiction: the Vercel deployment is built from commit
`a8d548a`, "Merge pull request #16 from twinwicksllc/docs/phase-0-target-status", and
branches `docs/phase-0-target-status` (#16) and `docs/staging-rollback-runbook` (#14) are
visible. Those are reasonably described as initial setup, but they are **documents**, and
two of them sound like they overlap this repository's Phase 0 record. O-33's review should
confirm they do not conflict with `REBRAND_PHASE_0_*` here — the divergence risk is low
given the volume, not zero.

Draft DEC entry, companion to DEC-0036 and DEC-0037:

> **DEC-0038** — Resolves the `REBRAND_PHASE_0_IMPLEMENTATION.md` §2 requirement that any
> document created in the legacy workspace have a recorded destination. **Phase 1 planning
> documents — `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md` and
> `REBRAND_PHASE_1_TODO.md` — remain in `twinwicksllc/listing-assistant-pro` for the
> duration of Phase 1**, because they cross-reference the DEC-, RBR-, and P0- identifier
> record that lives there. **Recorded destination: `twinwicksllc/listrassistr-official`,
> migrated at cutover** alongside the Phase 0 record they depend on. **§8.3 brand
> artefacts are exempt and go to `listrassistr-official` immediately as produced**, per
> §2's "brand work and launch artifacts" clause. Reviewed 2026-08-27; owner confirmed no
> parallel development beyond initial setup in the target repository.

## A.9 The qa environment — what is in scope, and what is not

Owner confirmed `qa.listrassistr.com` as the preferred QA hostname, with
`app.listrassistr.com` or similar for the live application, and noted that a separate
Supabase project for qa is **not** set up.

**Scope check first, because this request spans three phases.** Verified against the plan's
own structure:

| Work                                     | Plan section | Phase       | Authorised by DEC-0035? |
| ---------------------------------------- | ------------ | ----------- | ----------------------- |
| The `qa` **DNS record**                  | §8.1.6       | **Phase 1** | **Yes**                 |
| Creating a **new Supabase project**      | §10          | **Phase 3** | **No**                  |
| Wiring **Vercel environments and CI/CD** | §13          | **Phase 6** | **No**                  |

So the DNS record is in scope and the environment behind it is not. That is not a reason
to stop — but standing up a qa Supabase project and wiring Vercel environment variables
is Phase 3 and Phase 6 work, and doing it under the Phase 1 banner would be exactly the
scope drift Section 6 of the to-do exists to prevent.

### A.9a A project may already exist — check before creating

`REBRAND_PHASE_0_SERVICE_INVENTORY.md:22` and lines 74-79 record, owner-reported
2026-08-10:

- Staging project ref **`yqftpibxplachhwoclam`**
- Auth Site URL `https://listrassistr.com`
- Allowed callbacks `https://listrassistr.com/auth/callback` and
  `http://localhost:3000/auth/callback`
- **Planned dedicated QA hostname: `https://qa.listrassistr.com`**

That last line means this project was **already intended as the QA project**. So the
question is not "create one" but "does the one from 2026-08-10 still exist and is it
usable":

- **If it exists and is empty** → qa is a **verify and configure** task, which sits inside
  the staging prerequisite DEC-0035 already pulled into Phase 1. In scope.
- **If it is gone or unusable** → creating a replacement is **§10/Phase 3** work and needs
  its own gate, not a Phase 1 side effect.

This is the same discrepancy recorded earlier — DEC-0035 describing the staging project as
not existing while the inventory records one — now with a concrete consequence.

Note also that its recorded Auth Site URL is wrong for a QA project on two counts: it
names the **apex**, which now redirects (A.7b), and it names the **production** host rather
than `qa.listrassistr.com`. Both need correcting whenever it is configured.

### A.9b Split of work

**Owner, and only owner:**

- [ ] Confirm whether `yqftpibxplachhwoclam` still exists, its region, whether it is empty,
      and its project URL. These are the four items its inventory row has always asked for.
- [ ] Decide, once that is known, whether qa proceeds as configuration (in scope) or needs
      a Phase 3 gate (not in scope).
- [ ] Create the long-lived `qa` branch in `listrassistr-official`, if the
      branch-assigned-domain approach from A.6 is used.
- [ ] Assign `qa.listrassistr.com` in Vercel once that branch exists, and create the DNS
      record at that point rather than in advance.
- [ ] Set the environment variables. Never share their values here.

**What I can do, and will once the above is answered:**

- [ ] Draft the full **environment-variable matrix** — which variable belongs to which
      environment, and which Supabase project each points at, with production and qa kept
      separate per DEC-0005. Names and destinations only, never values.
- [ ] Draft the **exact Supabase Auth configuration** for the qa project: Site URL,
      redirect allow-list including `localhost` for development, and the corrections
      A.7b requires.
- [ ] Draft the `qa` DNS record row for Section D once the Vercel target is known.
- [ ] Draft the **Phase 3 entry decision** if it turns out one is needed, so the gate is a
      one-line approval rather than a drafting exercise.
- [ ] Note the **DEC-0021 key-format** question against whichever project is used — legacy
      JWT versus `sb_publishable_`/`sb_secret_` — as a fact to check rather than a value to
      record.

## A.10 O-08 follow-up — which Supabase project was checked?

Owner reports SMTP is also not configured "in the new project (`listrassistr-official`)".
Recorded with a clarification needed: `listrassistr-official` is the **GitHub and Vercel**
project. SMTP is a **Supabase** setting, so the check must have been against a Supabase
project — most likely `yqftpibxplachhwoclam`, but possibly a different one.

Worth pinning down, because A.5's open question is precisely _which_ Supabase project
ListrAssistr will use. If the answer is `yqftpibxplachhwoclam`, then that project is
simultaneously the staging project, the intended qa project, and the one whose auth mail
matters for P1-08 — which would be worth knowing explicitly rather than by inference.

- [ ] Confirm which Supabase project ref was checked for SMTP, and which project
      `listrassistr-official` is wired to today, if any.

## A.11 Correction — `yqftpibxplachhwoclam` is the production project, not staging

**Owner correction 2026-08-27:** `yqftpibxplachhwoclam` is **the official Supabase project
for ListrAssistr — the future official production project. Not staging, not qa.**

This supersedes A.9a and reverses an earlier finding in this document. Recorded plainly
because the earlier version was wrong in a way that changed advice.

### What the source documents say, and which is wrong

| Source                                     | Says                                                                                                                                                | Status                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `REBRAND_PHASE_0_SERVICE_INVENTORY.md:22`  | "New staging Supabase … Initial staging; no production data approved"                                                                               | **Wrong**, or superseded by a change of intent since 2026-08-10                  |
| Same file, lines 74-79                     | "Initial staging confirmation … New staging project ref: `yqftpibxplachhwoclam`" and "Planned dedicated QA hostname: `https://qa.listrassistr.com`" | **Wrong** for this project — the QA-hostname line in particular is misattributed |
| `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0035 | RBR-0003 described as "no staging Supabase project yet"                                                                                             | **Correct after all**                                                            |

**So an earlier entry in this document's own corrections table was itself mistaken.** It
recorded DEC-0035's "no staging Supabase project yet" as contradicted by the service
inventory. With `yqftpibxplachhwoclam` confirmed as production, **DEC-0035 was accurate and
the service inventory carries the error.** The correction runs the opposite way to how it
was first written.

That is worth stating rather than quietly amending, because the earlier reading produced
concrete bad advice: A.9a concluded qa was a "verify and configure" task inside Phase 1
scope. It is not. See RB-08.

### What actually follows

1. **There is no staging project and no qa project.** Not a mislabelled one — none.
2. **DEC-0005 is currently unmet.** It requires separate staging and production
   environments and credentials. Plan §6.2 names `listrassistr-production` and
   `listrassistr-staging` as the target shape.
3. **Creating one is plan §10, Phase 3**, which DEC-0035 does not authorise. So qa needs
   its own gate — drafted in RB-08 — rather than being absorbed into Phase 1.
4. **`qa.listrassistr.com` does not exist**, and neither does a DNS record for it. Owner
   recollection confirmed by measurement: NXDOMAIN, no delegation.
5. **One thing improves.** `yqftpibxplachhwoclam`'s recorded Auth Site URL is
   `https://listrassistr.com`. For a _staging_ project that was wrong twice over — pointing
   at the apex, and at the production host. For the **production** project pointed at an
   **apex-canonical** deployment, it is simply correct. RB-01 makes it so.

### Still open on this project

Its inventory row has asked for four confirmations since 2026-08-10 and none has been
supplied. Those are unchanged in substance but now matter more, because this is the
production project rather than a scratch environment: **owner/organisation, region, empty
state, and project URL.** RB-05 is the procedure.

Also unchanged: **no SMTP is configured anywhere for this application** (owner, 2026-08-27),
so P1-08's "branded email authenticates" has no sender yet on any project. That closes
O-38's ambiguity — the answer is "nowhere", not "a project I have not named".

### Documents needing correction as a result

- [ ] `REBRAND_PHASE_0_SERVICE_INVENTORY.md` — relabel `yqftpibxplachhwoclam` from staging
      to **intended production**, and remove or reattribute the "Planned dedicated QA
      hostname" line.
- [ ] The same file's "Initial staging confirmation" heading and its
      "no production data approved" note, which now describe something that does not exist.
- [ ] This document's earlier corrections table, amended above rather than rewritten, so the
      reversal stays visible.

## A.12 DNSSEC complete and validating — plan §8.1.8 satisfied (2026-08-27)

RB-03 executed by the owner. **The chain of trust is live and independently verified.**
This closes O-02, O-17, and **P1-05**.

### What was created

| Item                     | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| KSK name (Route 53)      | `listrassistr_ksk_1`                                               |
| KMS backing key          | Route 53-created customer-managed key, **us-east-1**               |
| Algorithm                | **13** — ECDSAP256SHA256                                           |
| DNSKEY records published | **2** — ZSK (flags 256, tag 43388) and KSK (flags 257, tag 10716)  |
| DS at the `.com` parent  | KeyTag **10716**, Alg **13**, DigestType **2**                     |
| DS digest                | `E59E9D7FE7C9BDB9D91A245EDCA2AFE29DCE2B717D52C2298E673B79BE06BAAA` |
| Registrar status         | DNSSEC status **Configured**; transfer lock On; auto-renew On      |

### Verification evidence

The DS digest was **computed independently from the published DNSKEY before the DS was
submitted**, per RFC 4034 §5.1.4 — `sha256(canonical owner name ‖ DNSKEY RDATA)` — and the
value Route 53 derived from the pasted public key matched it exactly. That is what confirms
clean transcription: a single wrong character in the base64 public key would have produced a
completely different digest.

| Check                                                                  | Result                                  |
| ---------------------------------------------------------------------- | --------------------------------------- |
| Console Key tag equals computed KSK tag                                | **10716 = 10716** ✓                     |
| Console digest equals independently computed digest                    | **exact match**, 64 hex chars ✓         |
| DS published in the `.com` parent zone                                 | **present**, all three fields correct ✓ |
| DS KeyTag references the KSK, not the ZSK                              | ✓                                       |
| Apex, `www`, and the typo domain resolve through a validating resolver | ✓                                       |

**The control test is what makes this proof rather than inference.** "It still resolves" is
weak evidence on its own, because a non-validating resolver returns answers regardless. So a
domain with a deliberately broken chain was queried against the same resolver:

| Domain              | Result via `1.1.1.1` | Meaning                        |
| ------------------- | -------------------- | ------------------------------ |
| `dnssec-failed.org` | **SERVFAIL**         | The resolver **is** validating |
| `listrassistr.com`  | **Answers normally** | Our chain validates against it |

A resolver that rejects a knowingly-broken chain and accepts ours has validated ours. The
DS/DNSKEY pair is therefore correct at the parent, not merely present.

### Third-party confirmation — `dnsviz.net`, 2026-08-27

Run by the owner after the DS went live. The graph shows a **complete, continuous chain of
trust** with no errors or warnings, and every key tag matches the values computed here
independently.

| Zone                                   | Keys shown                                                                   | Signed onward                        |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| Root `.` (17:47 UTC capture)           | DNSKEY alg 8, id **20326** (trust anchor), plus id 57780 and 38696, 2048-bit | DS digest alg 2 → `com`              |
| `com` (16:24 UTC capture)              | DNSKEY alg 13, id **19718** and id **41446**, 512-bit                        | DS digest alg 2 → `listrassistr.com` |
| `listrassistr.com` (17:31 UTC capture) | DNSKEY alg 13, id **10716** (KSK) and id **43388** (ZSK), 512-bit            | Signs `A`, `NS`, and `SOA`           |

Two things worth drawing out:

- **The key tags match exactly what was computed before the DS was submitted** — 10716 for
  the KSK and 43388 for the ZSK. Three independent sources now agree: the values derived
  here from the published DNSKEY, the values Route 53 derived from the pasted public key, and
  the values dnsviz reads from the live chain.
- **The chain is unbroken from the root trust anchor down**, with each level's DS
  authenticating the next. Nothing in the graph is flagged, which in dnsviz's rendering means
  no errors and no warnings anywhere in the delegation path.

That upgrades O-17 from "verified by reasoning and a control test" to "verified by an
independent third-party validator as well", which is the strongest form the evidence for
P1-05 can take.

### Residual notes

- **The KMS key must not be deleted, disabled, or have its policy changed.** Route 53 warned
  about this at creation time, and it is now load-bearing: if Route 53 loses access to that
  key, signing breaks — and with a DS published at the parent, that means the domain goes
  dark for validating resolvers. Deletion carries a 7-30 day waiting period, but **disabling
  takes effect immediately**. That key is not a candidate for any future AWS housekeeping.
- **Rollback ordering, if DNSSEC is ever removed:** delete the DS at the registrar → wait out
  the parent DS TTL → only then disable signing in the hosted zone. Reversing that leaves
  resolvers holding a DS for an unsigned zone, which is the same domain-goes-dark failure.
  Recorded in I.2 and unchanged.
- ~~`dnsviz.net` is still worth running once~~ — **done, see above.** The chain validates
  cleanly from the root trust anchor with no errors or warnings.
- Route 53 reported the registry submission as "in progress, you will receive an email when
  it is done". By the time it was checked, the DS was **already live at the parent**, so that
  email is confirmation rather than something to wait on.

### Why this was worth doing now

I.1's blast-radius argument held. Only a coming-soon page sat behind the domain during a
procedure whose failure mode is the domain resolving **nowhere** for up to the parent DS TTL —
commonly around 24 hours for `.com`. The same operation after cutover would have been a
customer-facing outage risk instead of an embarrassment. It is now done, verified, and will
simply be true when the application ships.

## A.13 RB-04 results — the auth flow is live, and P1-08 is now precisely diagnosed

Owner executed RB-04 on 2026-08-27. This answers Q-08 and closes the last of A.5's open
questions.

### What was found

| Observation                                                                            | What it establishes                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sign-up screen asks for **email and password**                                         | A real auth flow, not a placeholder                                                                                   |
| **"Forgot password" produced no email**                                                | **Expected behaviour, not a fault** — see below                                                                       |
| **"Create Account" succeeded** and sent a confirmation                                 | The email path works                                                                                                  |
| Sender was **`noreply@mail.app.supabase.io`**                                          | Supabase's **built-in shared mailer**. Confirms no custom SMTP, and this is why P1-08 is unmet                        |
| Verify link pointed at **`https://yqftpibxplachhwoclam.supabase.co/auth/v1/verify?…`** | **The application is wired to `yqftpibxplachhwoclam`** — the project the owner identified as future production (A.11) |
| The link's `redirect_to` was **`https://listrassistr.com/`**                           | The apex — which RB-01 made canonical. See below                                                                      |
| UI copy read **"Check your _staging_ email to access your account"**                   | Minor, but the production-intended project is showing staging wording                                                 |

### "Forgot password" sending nothing is correct

Worth stating plainly, because it is easy to misread as a broken email path and chase the
wrong problem. The owner also noted no users existed yet — and Supabase deliberately does
**not** send a reset email for an address with no account, because doing so would confirm
whether an address is registered. That is anti-account-enumeration behaviour working as
designed.

"Create Account" then sent mail because it created a user and issued a confirmation. The two
results are consistent, and together they show the mail path is functioning.

Related, worth knowing before the next test: Supabase's built-in mailer is **rate-limited to
a small number of messages per hour**. A future "no email arrived" is at least as likely to
be that limit as a misconfiguration.

### This validates the RB-01 decision, concretely

The verify link carries `redirect_to=https://listrassistr.com/` — the **apex**. RB-01 made
the apex the serving host, so that redirect now lands on content directly.

Had `www` been kept canonical (the option originally recommended in A.7a), this link would
have 308'd from the apex to `www` **mid-authentication**, which is exactly the PKCE
origin-mismatch failure A.7b described: the code verifier is stored per-origin, so a flow
that starts on one host and completes on another cannot read its own state. The owner's
choice of apex-canonical avoided that, and this is the evidence rather than the theory.

### P1-08 is now exactly scoped

Auth mail sends from `mail.app.supabase.io`, a Supabase-owned domain. So the DKIM `d=` can
never be `listrassistr.com`, and **DMARC alignment is impossible while the built-in mailer
is in use** — no DNS record can fix that. P1-08 requires "Gmail/Outlook headers showing
aligned SPF+DKIM+DMARC pass, `d=listrassistr.com`".

The remedy is exactly what F.3 and F.5 anticipated, and needs no repository change:

1. Configure **SES** (F.5) and verify `listrassistr.com` as a sending identity.
2. Point **Supabase Auth → SMTP** at SES, on the `yqftpibxplachhwoclam` project.
3. Set the auth `From` to an address at `listrassistr.com` — still undecided, `no-reply@` or
   `accounts@` (Q-07).
4. Publish SPF and DKIM, then DMARC at `p=none`, and run the review period.

All of that is Supabase and AWS dashboard work, so it sits inside §8.2 and is authorised.
It remains **deferred by owner decision** (F.6), and this finding does not change that — it
sharpens what "done" looks like.

### Two things worth a deliberate decision

**1. Sign-up appears to be open on the future production project.** A public "Coming Soon"
page with a working Create Account flow means anyone who finds it can create an account in
the project intended to become production. That may be the intent — an early-access list —
but it should be a choice rather than a side effect. Supabase exposes a **disable signups**
setting under Auth, and there is also the option of leaving it open but requiring
confirmation, which is already the case.

**2. The project is no longer empty.** RB-05's "is it empty" check now has a partial answer:
it contains at least one test user, created 2026-08-27. Not a problem, but worth recording
so that:

- "no production data has reached it" is understood as "no _customer_ data", not "no rows";
- the test account is not later mistaken for a migrated user from DEC-0034's cohort;
- someone remembers to remove it before launch if a clean production user table is wanted.

### On the token in the shared link

The verify URL the owner pasted contained a single-use signup confirmation token. **It is
deliberately not recorded here or anywhere in this repository**, per the standing rule on
secret values. It is low-risk — single-use, scoped to the owner's own test account on a
project holding no customer data — but if it has not been consumed, completing or discarding
that signup closes it out.

## A.14 The application surface — and a revision to the `app` record advice

Second capture, 2026-08-27: the owner signed in and reached **`listrassistr.com/app/settings`**.

### The app lives on a path, not a subdomain

| Plan §6.1 target                              | Actual today                         |
| --------------------------------------------- | ------------------------------------ |
| Application at `https://app.listrassistr.com` | **`https://listrassistr.com/app/…`** |

Plan §6.1 anticipated something like this, and it is worth quoting because it is nearly the
current arrangement:

> If marketing and app remain in the same Vite deployment for launch, route the apex to
> `/landing` and the app subdomain to the authenticated product. Preserve the two-host target
> in configuration so a dedicated marketing site can be split later without changing the
> application identity again.

So a single deployment serving both was contemplated. What exists is a **path-based** split
(`/` marketing, `/app/*` product) rather than the **host-based** split the plan describes.
`app.listrassistr.com` does not exist, which matches the DNS measurements.

### This revises the O-06 advice, for the second time

A.6 previously concluded: create `app.listrassistr.com` now, because it would serve the
coming-soon page harmlessly while proving the DNS and certificate path. **That is no longer
the right call**, now that the app's location is known.

Adding `app.listrassistr.com` to the Vercel project would serve the _same_ deployment, so
`app.listrassistr.com/` would land on the **marketing page**, not the application. A hostname
named `app` that shows marketing is worse than no hostname at all — it invites exactly the
confusion the two-host target exists to prevent.

Making it behave correctly needs one of:

- **Host-based routing** — middleware that serves the application when the host is `app.`,
  and marketing otherwise. This is what §6.1 actually describes.
- **A path rewrite** — `app.listrassistr.com/*` → `/app/*`. Note a Vercel _domain redirect_
  cannot do this; it redirects host to host, so this also needs application-level routing.

Either is **application code in `listrassistr-official`**, which is a separate scope question
from §8.

**Recommendation: defer `app.listrassistr.com` until that routing exists.** It is not needed
for anything in Phase 1 — no §8 exit-gate item depends on it beyond §8.1.6 asking for the
record, and a record pointing at the wrong content satisfies the letter while defeating the
purpose. Recorded so P1-06 closes on the app actually being reachable at its intended host,
not on a hostname existing.

That makes both remaining §8.1.6 records — `app` and `qa` — deferred for the same underlying
reason: **the DNS is ready before the things it should point at.**

### Other observations from the app surface

Recorded because they were visible, with scope stated rather than assumed. All three are
application concerns in `listrassistr-official`, not §8 work.

- **"Staging" appears twice in customer-facing copy** — "Check your _staging_ email to access
  your account", and "Account preferences will be available here in a later _staging_ slice."
  The public brand domain, on the production-intended project, is telling visitors about
  staging. Cosmetic, but it is the kind of thing that reads as unfinished to an early-access
  visitor.
- **The header shows "Sign in" and "Create account" while signed in**, alongside the
  signed-in email and a Sign out button. The header is not reflecting auth state.
- **Sign-up is confirmed open**, and there is now a real signed-in account
  (`twinwicksllc@gmail.com`) on the future production project. That firms up A.13's point:
  whether public sign-up stays open before launch deserves to be a decision.

### One thing worth checking now, because it interacts with a deferred item

The footer carries **Terms** and **Privacy** links. If either page already cites contact
addresses at `listrassistr.com` — `privacy@`, `legal@`, or `support@` — then **those
addresses are unreachable today**, because the zone has no MX records at all (Section D).

That matters more than it sounds. Privacy and legal pages are exactly where a data-subject
request, a takedown notice, or an abuse report gets sent, and a published address that
silently discards mail is worse than publishing no address. It would also make P1-07 ("role
mailboxes receiving") a live gap rather than a deferred nicety.

- [ ] Open the Terms and Privacy pages and check whether any `@listrassistr.com` address is
      published. If one is, the mailbox work (F.4, currently deferred) should be reconsidered
      as pre-launch rather than deferred — or the pages should point somewhere reachable in
      the meantime.

## A.15 RB-05 results — the production Supabase project, verified

Owner completed the RB-05 template on 2026-08-27. First confirmation of this project's
configuration since it was owner-reported on 2026-08-10.

| Field           | Value                                                                                                                                                      | Note                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project name    | **`listrassistr-official`**                                                                                                                                | Matches the Vercel project and target repo naming                                                                                                                           |
| Project ref     | `yqftpibxplachhwoclam`                                                                                                                                     | As recorded                                                                                                                                                                 |
| Region          | **`us-east-2`**                                                                                                                                            | Newly established; settles an open F.5 item, see below                                                                                                                      |
| Organisation    | **`twinwicksllc's Org`**                                                                                                                                   | **CORRECTED — see A.17a.** Recorded here as separate from the CRM org; it is not. It is the owner's single org holding every app, so RBR-0024's shared-login concern stands |
| Plan            | **Pro**                                                                                                                                                    | Paid tier, already being incurred pre-launch                                                                                                                                |
| Auth Site URL   | **`https://listrassistr.com`**                                                                                                                             | The apex — correct after RB-01                                                                                                                                              |
| Redirect URLs   | `https://listrassistr.com/auth/callback`, `https://listrassistr.com/auth/reset`, `http://localhost:5173/auth/reset`, `http://localhost:5173/auth/callback` | All apex, no `www` variants — see below                                                                                                                                     |
| Sign-up         | **Enabled**                                                                                                                                                | Public sign-up open on the production-intended project (A.13)                                                                                                               |
| Confirm email   | **Required**                                                                                                                                               | Reasonable mitigation while sign-up is open                                                                                                                                 |
| Users           | **2**, both the owner's                                                                                                                                    | So "empty" honestly means _no customer data_, not _no rows_                                                                                                                 |
| API key format  | **Both** legacy `anon`/`service_role` **and** new `sb_publishable_`/`sb_secret_`                                                                           | Live DEC-0021 finding, see below                                                                                                                                            |
| `public` schema | **No tables — confirmed by query**                                                                                                                         | **Settled in A.17b:** all 35 tables are Supabase system tables, so no application schema exists                                                                             |

### The organisation is separate — but that is not the same as a separate login

`twinwicksllc's Org` rather than the shared CRM organisation goes a long way toward
**DEC-0004**'s requirement for a ListrAssistr-only project.

Worth keeping the distinction sharp though: **an organisation is not a login.** Supabase
allows one user account to own several organisations, and **RBR-0024**'s concern was the
shared _admin account_, not the org boundary. If both orgs sit under the same Supabase user,
that exception is unaddressed rather than resolved — different orgs, one credential.

- [ ] Confirm whether the ListrAssistr org is owned by a **separate Supabase login**, or the
      same account that administers the CRM org.

### Every redirect URL is on the apex — RB-01 paying off a third time

All four entries use `listrassistr.com`, with no `www` variants. That is correct **because**
RB-01 made the apex canonical. Had `www` been kept — the option originally recommended in
A.7a — all four would have needed rewriting, and both the callback and the password-reset
flow would have broken on the PKCE origin mismatch described in A.7b.

Three separate confirmations now: the signup verify link's `redirect_to` (A.13), the Auth
Site URL, and this allow-list.

### `us-east-2` settles the SES region question

F.5 left "pick an SES region and record it" open. With Supabase in **`us-east-2`**, the
recommendation is **SES in `us-east-2`** as well.

The technical stakes are low — email latency is irrelevant here — but **SES verified
identities and sandbox status are per-region**, so an identity verified in the wrong region
looks like a verification failure. Picking one region and recording it avoids that.

Note this does **not** conflict with DNSSEC: the KMS key backing the KSK is pinned to
`us-east-1` because Route 53 requires it there (A.12). Two regions, each forced or chosen for
its own reason, both recorded.

### `localhost:5173` in a production project's allow-list

Not a meaningful attack surface on its own — `localhost` resolves to the visitor's own
machine, so there is little for an attacker to gain. But it is a **symptom of the underlying
gap**: development and production share one Supabase project, which is exactly what
**DEC-0005** exists to prevent. It resolves when a non-production project exists (Q-15,
RB-08), at which point the localhost entries belong there rather than here.

Also a small inventory drift: `REBRAND_PHASE_0_SERVICE_INVENTORY.md` records the dev callback
as `localhost:3000`. It is **5173** — Vite's default port. Another line for the T-15
corrections.

### Both API key formats are active — DEC-0021 is available, not blocked

The project exposes the legacy `anon`/`service_role` pair **and** the newer
`sb_publishable_`/`sb_secret_` pair, so it sits in Supabase's transition state.

DEC-0021 deferred this migration until the product runs in its ListrAssistr state, and that
deferral remains sensible. What is now known is that the migration is **available whenever
wanted rather than gated on anything**. Two notes for when it happens:

- Whichever pair the application actually uses determines the order of work — the app must be
  switched before the old pair is withdrawn.
- **The legacy pair should be revoked once migrated, not left active.** Two live credential
  sets is twice the surface for no benefit.

### The schema question is not yet settled

The owner reported "a lot of" tables in the schema browser but **no tables in `public`**.
Those are almost certainly Supabase's own system schemas — `auth`, `storage`, `realtime`,
`vault`, `extensions`, `supabase_migrations`, and similar — which ship with **every** project
and are not application tables.

If `public` is genuinely empty, this project has **no application schema at all** and is
therefore **not** a copy of the legacy project's structure. That matters for the migration
picture, so it is worth confirming rather than inferring. Two read-only queries were supplied
for the SQL Editor:

- `information_schema.tables` grouped by schema, with names — shows whether `public` holds
  anything and what the system schemas contain.
- `pg_stat_user_tables` with `n_live_tup` — shows which user tables hold rows at all.

Both return schema and table **names** plus row counts, never row contents.

- [ ] Run both and report, so "is it empty" has a definitive answer rather than an impression.

## A.16 RB-06 results — the target repo is substantial, and three governance documents are forked

Owner completed the RB-06 template on 2026-08-27. This is the most consequential finding in
Phase 1 so far, and it needs stating rather than filing.

### It is not "initial setup"

**40 commits across 16 merged pull requests**, on 13 branches, with a complete Vite / React /
TypeScript foundation:

| Category          | Contents                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Application       | `src/` ("feat: add authenticated staging shell"), `public/`, `index.html`                                                            |
| Build and tooling | `package.json`, `package-lock.json`, `vite.config.ts`, three `tsconfig` files, `eslint.config.js`, `.prettierrc.json`, `vercel.json` |
| Tests             | `vitest.config.ts`                                                                                                                   |
| Environment       | `.env.example` ("Prepare staging Supabase environment contract"), `.gitignore`                                                       |
| Docs              | `docs/` with six files, plus three root-level documents — see below                                                                  |

Branch names show the shape of the work: `feat/listrassistr-app-foundation`,
`docs/staging-auth-verification`, `docs/password-recovery-verification`,
`docs/session-lifecycle-hardening`, `docs/auth-boundary-hardening`,
`feat/accessibility-staging-plan`.

The owner's earlier characterisation — "other than the initial setup I haven't pushed
anything" — understates this considerably, and that is worth correcting in the record rather
than letting the earlier note stand. A.8 recorded "no parallel development" on that basis;
**that assessment was wrong**, and the correction follows.

### Three governance documents are forked, including two that define scope

The target repo's root holds copies of documents that are **actively maintained in this
repository**:

| Document in `listrassistr-official`          | Last touched there                       | Status here                                                                                            |
| -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` | "Add files via upload", ~2 weeks ago     | **The master plan.** Actively referenced; every scope decision in Phase 1 cites its section numbers    |
| `REBRAND_PHASE_0_IMPLEMENTATION.md`          | "docs: add phase 0 non secret inventory" | **The control document.** Its §2 is what defines where work belongs and requires recorded destinations |
| `REBRAND_PHASE_0_REPOSITORY_DISCOVERY.md`    | "Add files via upload"                   | Maintained here                                                                                        |

**This is RBR-0011's parallel-development risk realised, not hypothetical.** And it is worse
than ordinary staleness for a specific reason: two of the three are the documents that
_govern_ the work.

- There are now **two copies of the master plan**. Phase 1 scope has been gated throughout on
  "§8 only, per DEC-0035" — and §8 in one copy need not say what §8 says in the other.
- There are **two copies of the control document** whose §2 dictates where brand work and
  launch artefacts belong. Two copies can disagree about their own authority.

Meanwhile this repository's copies have moved substantially in those two weeks: Phase 0
closed, DEC-0034 and DEC-0035 were added, and the exception log grew to RBR-0036. So the
forks are behind by exactly the period in which the governing decisions were made.

**Recommendation: delete the three copies in `listrassistr-official`, do not sync them.**

Syncing creates an obligation to keep syncing, and it will drift again. DEC-0038 already
decided (option C) that planning documents live here until cutover, with a recorded
destination. Deleting the forks and replacing them with a single README pointer — "rebrand
planning and the Phase 0 record live in `twinwicksllc/listing-assistant-pro` until cutover;
see DEC-0038" — makes that decision true in both repositories instead of only in this one.

The `docs/` folder is a different case and should not be deleted wholesale; see below.

### The plan describes a strategy that is not the one being executed

Checked rather than assumed, and this is the finding with the longest reach.

**Plan §9, "Phase 2: Repository Brand Foundation", is about _this_ repository.** It names
specific legacy files:

- `src/assets/teckstart-logo.png`
- `src/v2/components/SideNav.tsx`
- `src/pages/LandingPage.tsx`, `LoginPage.tsx`, `SignupPage.tsx`, `ForgotPasswordPage.tsx`,
  `ResetPasswordPage.tsx`, `AuthCallbackPage.tsx`, `TermsPage.tsx`

So the plan's strategy is **rebrand the legacy application in place, then migrate it**. What
is actually happening is **a greenfield application being built in a new repository**, with
the legacy app left alone until cutover.

Those are different strategies, and the plan does not describe the second one:

|                      | Plan's model (§9)            | What is happening                        |
| -------------------- | ---------------------------- | ---------------------------------------- |
| The ListrAssistr app | The legacy `src/`, rebranded | A new `src/` in `listrassistr-official`  |
| Legacy repo's fate   | Becomes ListrAssistr         | Retired at cutover                       |
| Phase 2's content    | Rebranding legacy surfaces   | Largely moot if legacy is being replaced |

This is an owner-level strategic question, not something to resolve here. But it has concrete
consequences worth recording:

1. **Phase 2 as written may be unnecessary.** Rebranding surfaces on an application that is
   being replaced is effort spent on something due for retirement — unless the legacy app must
   look rebranded during a transition period, which is a real possibility and a reason to keep
   some of §9.
2. **The phase numbering that Phase 1 scope decisions rely on still holds**, because those
   were about §8, §10 and §13, none of which changes. RB-08's "Supabase projects are Phase 3"
   reasoning is unaffected.
3. **The plan itself may need revision**, which is a larger correction than the individual
   document fixes logged in T-15 so far. Recorded as a question rather than actioned.

### The "staging" thread, now fully explained

Several loose observations turn out to be one thing:

| Observation                                                                                                                                 | Where                         |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Three documents named `STAGING_AUTHENTICATION_PLAN`, `STAGING_AUTH_EVIDENCE`, `STAGING_ROLLBACK_RUNBOOK`                                    | `listrassistr-official/docs/` |
| Branches `docs/staging-auth-verification`, `docs/staging-rollback-runbook`, `docs/staging-auth-evidence`, `feat/accessibility-staging-plan` | Same repo                     |
| Commit "feat: add authenticated **staging** shell"                                                                                          | Same repo                     |
| `.env.example` — "Prepare **staging** Supabase environment contract"                                                                        | Same repo                     |
| UI copy: "Check your **staging** email", "a later **staging** slice"                                                                        | The live site (A.13, A.14)    |
| Service inventory labelling `yqftpibxplachhwoclam` as "New **staging** Supabase"                                                            | This repo                     |

**The entire body of work was built on the premise that this project and this app were
staging.** A.11 recorded the owner's correction that `yqftpibxplachhwoclam` is the intended
**production** project — and that redesignation has not propagated to the code, the copy, the
branch names, or the documentation.

So A.11 was not a one-line label fix. It reframes a substantial amount of existing work, and
it explains every "staging" artefact seen so far as a single coherent cause rather than
scattered untidiness. Nothing here is broken by it — but anyone reading those documents will
be reading about a staging environment that is now production.

### The secret-shaped files are very likely fine

Reported: `.env.example`, `src/config/env.ts`, `src/vite-env.d.ts`. All three are the
**expected names for safe files**, and the presence of a `.gitignore` is a good sign:

- **`.env.example`** — committed deliberately by convention, holding placeholder keys so
  others know which variables are needed. Correct practice.
- **`src/config/env.ts`** — almost certainly reads `import.meta.env.*` and validates it.
  Reading configuration is not storing it.
- **`src/vite-env.d.ts`** — TypeScript declarations for Vite's env types. Contains type
  information only; it cannot hold a value.

One thing genuinely worth thirty seconds, because it is a common and quiet mistake: people
sometimes create `.env.example` by copying a working `.env` and forget to scrub the values.

- [ ] Open `.env.example` and confirm every value is a placeholder — empty, `xxx`,
      `your-key-here` — and not a real key.
- [ ] Confirm `.gitignore` actually lists `.env`, so a real one cannot be committed later.
- [ ] Confirm `src/config/env.ts` reads from the environment rather than hardcoding any
      fallback value.

If all three hold, there is nothing to do. If `.env.example` holds a real Supabase key, that
key should be rotated rather than merely deleted from the file, since git history keeps it.

### What to do with `docs/`

Unlike the three forked root documents, these six are **native to that repository** and should
be assessed individually rather than deleted:

| File                              | Overlaps                                    | Likely disposition                                                            |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `PHASE_0_NON_SECRET_INVENTORY.md` | `REBRAND_PHASE_0_SERVICE_INVENTORY.md` here | Reconcile — two inventories of the same estate will diverge                   |
| `PHASE_0_TARGET_STATUS.md`        | The closure checklist here                  | Likely superseded; Phase 0 is closed                                          |
| `SESSION_HANDOFF.md`              | `REBRAND_PHASE_0_SESSION_HANDOFF.md` here   | Reconcile or retire                                                           |
| `STAGING_AUTHENTICATION_PLAN.md`  | Nothing here                                | **Keep** — genuinely new, but retitle given the staging/production correction |
| `STAGING_AUTH_EVIDENCE.md`        | Nothing here                                | **Keep** — evidence is worth preserving; note the premise                     |
| `STAGING_ROLLBACK_RUNBOOK.md`     | Partially, DEC-0015's rollback plan         | **Keep**, cross-reference                                                     |

I have no access to read these, so this is a disposition guess from filenames. Sending me the
contents of the three overlapping ones — or granting read access — would let me say which
statements actually conflict with the Phase 0 record rather than which titles look similar.

## A.17 O-39 to O-41 — the production project is genuinely empty, and an org correction

### A.17a Correction: the Supabase org is _not_ separate (O-40)

**Owner clarification 2026-08-27: `yqftpibxplachhwoclam` is a different _project_ under the
same Supabase _organisation_ as all the owner's other apps** — including the CRM.

**A.15 got this wrong.** It recorded the organisation as "separate from the shared CRM org —
good", inferring separation from the name `twinwicksllc's Org`. That inference was
unjustified: the name describes the owner's general organisation, not a ListrAssistr-specific
one. Corrected here rather than amended silently, since it changed an assessment.

What actually holds:

| Requirement                                             | Status                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **DEC-0004** — a ListrAssistr-only Supabase **project** | **Satisfied.** `yqftpibxplachhwoclam` is dedicated to ListrAssistr                        |
| **RBR-0024** — shared admin **login**                   | **Unaddressed**, and now confirmed at organisation level. One org, one account, every app |
| **DEC-0005** — separate staging and production          | **Unmet.** No non-production project exists                                               |

Two consequences worth recording:

- **Blast radius.** A compromise of that single Supabase login reaches the CRM project and the
  ListrAssistr project together. That is precisely RBR-0024's concern, and having a separate
  project does not reduce it.
- **The Pro plan is probably org-level.** Supabase bills its paid tiers per organisation, so
  the Pro plan reported in A.15 likely covers the whole org rather than being a ListrAssistr
  cost. Worth knowing before attributing that spend to this product.

Nothing here needs immediate action — RBR-0024 is an accepted exception, and DEC-0005 is
tracked at Q-15. But A.15's "good news" framing was overstated and the record should not
carry it.

### A.17b The production project has no application schema at all (O-39)

Both queries were run. The result is unambiguous and it settles A.15's open question.

**35 tables exist, and every single one is a Supabase system table:**

| Schema       | Tables | What it is                                                                              |
| ------------ | ------ | --------------------------------------------------------------------------------------- |
| `auth`       | 23     | Supabase Auth internals — `users`, `sessions`, `identities`, MFA, SAML, OAuth, WebAuthn |
| `storage`    | 8      | Supabase Storage internals — `buckets`, `objects`, multipart upload bookkeeping         |
| `realtime`   | 3      | Supabase Realtime internals                                                             |
| `vault`      | 1      | `secrets`                                                                               |
| **`public`** | **0**  | **Returned no rows at all — the application schema does not exist**                     |

Row counts confirm it independently:

- The only tables with data are Supabase's own migration bookkeeping — `realtime.schema_migrations` 81, `auth.schema_migrations` 77, `storage.migrations` 65.
- `auth.users` **2**, with `identities`, `sessions`, `refresh_tokens` and `mfa_amr_claims` also at 2 — the owner's two test accounts, consistently.
- **Everything else is zero.** No storage buckets, no objects, no vault secrets, no realtime subscriptions.

**So the hypothesis in A.15 was right: the "lot of tables" was Supabase internals.** This
project is not a copy of the legacy schema. It is a clean, empty project running Supabase
Auth and nothing else — which matches the target repo's "authenticated staging shell" commit
exactly. Auth works; there are no features behind it yet.

Four things follow:

1. **No data migration has begun.** Contrast the legacy project's `listing-images` bucket at
   4,735 objects / 1,274 MB (RBR-0026): here storage holds **zero buckets**. Phase 4 (§11) is
   genuinely untouched.
2. **DEC-0034's migration cohort has nowhere to land.** Moving 4 of 9 profiles requires a
   `profiles` table, which does not exist. Schema creation must precede data migration —
   §10 then §11, in that order.
3. **It is a clean slate, which is an advantage.** RLS policies, key format, and table design
   can all be got right from the start rather than inherited. Worth noting given RBR-0027's
   findings about owner-check gaps in the legacy project's storage policies — those mistakes
   need not be repeated here.
4. **"Is it empty" now has a precise answer** for the record: _no application schema, no
   customer data, no storage; two owner test accounts in `auth.users`._

### A.17c Terms and Privacy are empty pages (O-41)

Owner confirmed the footer links resolve, but **both pages contain only a title and no
content.**

**The risk A.14 flagged does not exist** — no `@listrassistr.com` address is published, so
nothing is silently discarding legal or privacy mail. That specific concern is closed, and the
mailbox work stays deferred.

**A different and arguably more real issue takes its place.** The live public site has:

- **open sign-up** collecting email addresses and passwords (A.15: enabled),
- **two accounts already created**, and
- **no privacy policy and no terms**, while linking to both as though they exist.

Collecting personal data without a privacy notice is the kind of gap that is cheap to close
now and awkward to explain later, and a footer link to an empty page reads worse than no link
at all — it suggests either something broken or something withheld.

This is not a §8 item and not a blocker for any Phase 1 gate. But it is an owner decision that
currently exists by default rather than by choice, and there are two straightforward ways to
make it deliberate:

- **Disable public sign-up** until the pages have content — Supabase's Auth settings expose
  this directly, and it also addresses the A.13 question of whether open sign-up on the
  production-intended project is intended.
- **Or publish minimal content** on both pages before leaving sign-up open.

Note the forward dependency: whenever a real privacy policy is written, it will need a contact
address. That is normally `privacy@listrassistr.com` — which does not exist yet, and has no MX
record. So the mailbox work (F.4) returns as a **dependency of the privacy policy**, not of the
empty page. Sequencing to remember rather than act on now.

### A.17d Forward reminder — DEC-0021 key migration (owner requested)

The owner asked to be reminded in a later phase to check which API keys are in use and remove
the legacy pair. Recorded here and in the to-do's deferred table so it survives this session.

**What to do, when the trigger arrives:**

1. Confirm which pair the application actually uses — legacy `anon`/`service_role`, or
   `sb_publishable_`/`sb_secret_`. Both are currently active on `yqftpibxplachhwoclam` (A.15).
2. Migrate the application to the newer pair if it is not already on it.
3. **Then** revoke the legacy pair. Order matters: revoking first breaks the app.
4. Confirm nothing else references the old keys — Vercel environment variables, any Edge
   Function secrets, local `.env` files, and the `.env.example` template in the target repo.

**Trigger:** at Phase 2 or Phase 3 entry, whichever comes first, and in any case **before the
first real customer uses the product** — a key rotation is far cheaper with two test accounts
than with live users holding sessions.

**Why it matters rather than being housekeeping:** two live credential sets is twice the
surface for no benefit, and the legacy `service_role` key in particular bypasses RLS entirely.
Leaving a second unused full-access credential active is the kind of thing that is invisible
until it is not.

## A.18 RB-09 and RB-10 results — IAM admin login created, `app.listrassistr.com` live

### A.18a RB-09 — IAM admin login (O-01), done 2026-08-28

IAM user `twinwicksllc` has MFA, belongs only to the Administrator group and is that group's
only member, and carries `AdministratorAccess`. Account alias is set. Billing visibility for
IAM users is enabled. Root confirmed to have no access keys. The prior user `tom_owner` was
removed after confirming it is not what backs twin-wicks.com's SES sending — that uses a
separate dedicated `twin-wicks-smtp-user`, unaffected by the removal.

### A.18b RB-10 — `app.listrassistr.com` (O-06), done and externally verified 2026-08-28

Vercel `listrassistr-official` → Domains → `app.listrassistr.com`, with the matching Route 53
CNAME per RB-10's steps. External verification (from a web-enabled session, since this
environment could not resolve or fetch the hostname directly — see RB-10 for why) confirmed:

- **DNS:** CNAME resolves consistently across five resolvers to
  `2f1e3f86cb32a6a8.vercel-dns-016.com`, matching the target Vercel displayed. That target
  resolves to Vercel's anycast addresses (`216.150.1.193` / `216.150.16.193`). No `AAAA` record.
- **Certificate:** Let's Encrypt issued, CN=YR2, single SAN `app.listrassistr.com`, valid
  28 Aug 2026 – 26 Nov 2026. Chain verifies; no mismatch.
- **HTTP:** HTTP/2 200, no redirects, served by Vercel. HSTS present. Other common security
  headers (CSP, X-Content-Type-Options, etc.) are absent — a hardening opportunity, not a fault.
- **Reference points:** `www`'s CNAME and the apex A record (`216.150.1.1`) match exactly, and
  `app` points at the same Vercel project as both.
- **DNSSEC:** the zone is signed (Route 53, ECDSA P-256), the DS record is published at the
  `.com` registry, DNSKEY is present, the `app` CNAME carries a valid RRSIG, and NSEC denial
  works. The AD bit is correctly unset on the full `app`/`www` A answer, because the CNAME
  terminates in Vercel's own unsigned `vercel-dns-016.com` zone — that is expected validator
  behavior for a CNAME into an unsigned zone, not a defect in this zone.

**Open question this verification raised, not yet resolved.** RB-10 predicted that
`app.listrassistr.com` would serve the marketing page at its root until the application adds
host-based routing (see A.14 and RB-10). The external check instead described the page as a
real application interface — "the ListrAssistr listing workspace" — rather than marketing. That
is the opposite of the prediction, and it has **not** been confirmed by reading the actual
routing code in `listrassistr-official`, only observed externally. It also noted `/api/health`
returns 200 with a body that looks like the SPA shell, which is worth confirming as a genuine
endpoint versus the SPA's catch-all route.

Two readings are both plausible and neither is confirmed:

1. Host-based routing already shipped in `listrassistr-official` — in which case this closes
   part of what RB-10's "what still needs application work" section called out, and the finding
   is good news.
2. The external checker saw a login/signup page — consistent with the owner's own description
   of the app as "just a login page and somewhere for people to sign up for updates" — and
   described that as "an application interface" without being able to see past the
   unauthenticated shell to know whether it is actually the listing workspace.

**Why this is worth resolving rather than filing away:** A.17b's finding that
`yqftpibxplachhwoclam` has no application schema and no customer data is a dated observation,
not a standing one (see the to-do's time-sensitive dependency note), and it underwrites both
`qa` sharing the production project and open sign-up staying acceptable (Q-17). If the
application is materially more built out than believed, that is a reason to re-verify A.17b
directly rather than continuing to rely on it.

`qa.listrassistr.com` is unstarted — it still needs the branch prerequisite in RB-10 before it
can be created.

## Section A — Pre-registration decisions, and their disposition

Written before the domain's status was known. Most are now settled by events —
the domain was registered 2026-08-06. Kept rather than deleted so the reasoning
behind each is on the record, with disposition stated.

| #   | Item                                                          | Disposition as of 2026-08-26                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Register under the **legal business entity**                  | **Deviation accepted 2026-08-26, LLC formation underway — see A.2.** The AWS account and all four Route 53 contacts are the owner **as an individual**. Twin Wicks Digital Solutions is **not yet a registered entity**, deferred for the same reason as the trademark filing. Plan §8.1.1 requires a legal business account, so this gate is blocked on a decision, not on an action |
| A2  | Registrant/recovery email must **not** be `@listrassistr.com` | **Satisfied.** Recovery contacts are the owner plus `twinwicksllc@gmail.com` — both outside the new zone, so the circular-dependency failure mode is avoided                                                                                                                                                                                                                          |
| A3  | Trademark and naming-conflict research (A.1 below)            | **Name approved by the owner 2026-08-26 (A.1a, option 1).** Filing still deferred. Basis was the `listerassister` search: dead/abandoned 2014, never registered (A.1c). Wider A.1b search list and the TSDR Office action (A.1h) remain open but are no longer gating                                                                                                                 |
| A4  | Defensive registrations                                       | **Resolved into a recommendation — see A.1e.** No variants owned. `listerassister.com` is taken by a live business and must not be pursued (A.1d). All nine other checked variants appear unregistered; the two worth taking are `listerassistr.com` and `listrassister.com`                                                                                                          |
| A5  | Authoritative DNS provider                                    | **Settled: AWS Route 53.** Registrar and DNS are the same provider and the same AWS account. See Section C for the consequence                                                                                                                                                                                                                                                        |
| A6  | **Inbound** mailbox provider for role addresses               | **Open, with a recommendation — see F.4.** Resend is **send-only**. A free `@gmail.com` account **cannot** receive domain mail, so forwarding or a real mailbox provider is required. Recommended: **Google Workspace, one seat, role addresses as free aliases**. Also unresolved: which role-address set is authoritative, plus a `From` address for auth mail (F.3)                |

### A.2 The §8.1.1 entity gate cannot be met yet — owner decision required

Plan §8.1.1: "Register `listrassistr.com` in the legal business account, not a
personal account." Confirmed 2026-08-26: the AWS account is the owner's
**individual** account, all four Route 53 contacts (Registrant, Admin, Tech,
Billing) resolve to the owner personally, and **Twin Wicks Digital Solutions is
not a registered entity** — deferred on the same reasoning as the trademark filing.

This is not a misconfiguration to fix. There is no business account to register
into, so §8.1.1 is unsatisfiable until an entity exists. Recording it as an
explicit decision point rather than leaving the gate silently failing.

**Three connected facts the owner should weigh, none of which is legal advice:**

1. **The name is already in public use.** The live coming-soon page footer reads
   "ListrAssistr is a product of Twin Wicks Digital Solutions", the GitHub org is
   `twinwicksllc`, and the repository's git author is "Twin Wicks Digital
   Solutions". `twinwicksllc` also asserts "LLC" specifically. Trading under a
   business name that is not registered is commonly regulated at the state level
   via DBA / fictitious-business-name filing, and asserting "LLC" for an entity
   that does not exist is a distinct issue from an unregistered trade name. Worth
   checking against the owner's state rules before launch, independently of §8.1.1.
2. **Stripe will force the question.** DEC-0027 commits ListrAssistr to its own
   dedicated Stripe account. Stripe onboarding requires either a registered entity
   or an individual/sole-proprietor registration, and the answer given there
   determines what appears on customer card statements and receipts. Deciding the
   entity question at Stripe onboarding, under launch pressure, is worse than
   deciding it now.
3. **Moving the domain later is possible but not free.** If an entity is formed
   later and the domain should move to its AWS account, that is an
   AWS-account-to-AWS-account transfer. Whether the ICANN 60-day post-registration
   lock applies to that path is a queued verification item; the domain was
   registered 2026-08-06, so any such lock would lapse around 2026-10-05 anyway.

**Options:**

| Option                                                                      | Effect on §8.1.1    | Notes                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Form the entity now**, then move the AWS account or the domain into it | Satisfied           | Highest effort; also resolves facts 1 and 2 at once. Cost and timeline are state-dependent                                                                                                                           |
| **B. Accept the deviation, record it, revisit before launch**               | Deviation, recorded | Proportionate to a pre-revenue product. Requires a DEC entry stating the gate is knowingly unmet and naming the trigger for revisiting — most naturally "before Stripe onboarding" or "before first paying customer" |
| **C. Treat individual ownership as permanently sufficient**                 | Gate rewritten      | Only coherent if the product will genuinely operate as a sole proprietorship. Conflicts with the existing public "Twin Wicks Digital Solutions" and `twinwicksllc` branding                                          |

Recommendation: **Option B**, with the revisit trigger set at Stripe onboarding,
since that is the point where the entity question stops being deferrable. This
keeps Phase 1 moving without pretending the gate is met. Owner's call, and it needs
a DEC entry either way — tracked as P1-01 in Section J.

**Owner decision, 2026-08-26: Option B accepted** — the §8.1.1 deviation is
recorded and revisited later, and the owner is **beginning LLC formation** in
parallel. So this is effectively B trending toward A rather than B indefinitely.

Draft DEC entry text, for the owner to place in
`REBRAND_PHASE_0_DECISION_LOG.md` if they want it in the formal record:

> **DEC-0036** — Plan §8.1.1 requires the domain to be registered in a legal
> business account. `listrassistr.com` is registered in the owner's **individual**
> AWS account, with all four Route 53 contacts resolving to the owner personally,
> because Twin Wicks Digital Solutions is not yet a registered entity. **The
> deviation is knowingly accepted and recorded**, not treated as satisfied. LLC
> formation is being explored as of 2026-08-26. Revisit trigger: **before Stripe
> onboarding** for the dedicated ListrAssistr Stripe account (DEC-0027), since
> that is the point at which the entity question stops being deferrable.
> Constraint recorded alongside it: changing the Route 53 registrant
> organisation/name re-triggers a fresh ICANN 60-day transfer lock, so the entity
> change and any account move must be sequenced deliberately and well away from a
> cutover window (see A.2a).

**One sequencing warning now that LLC formation is live.** When the entity exists
and the Route 53 registrant organisation is updated, that change **re-triggers the
60-day lock** (A.2a). So:

- Doing it **now**, while nothing depends on the domain moving, costs nothing.
- Doing it **near cutover** injects 60 days into the critical path.

If the LLC is going to happen, front-load it.

**Owner status 2026-08-26: the registration has _not_ been changed, deliberately.**
The owner was advised to wait until the LLC is actually formed, so that a
registrant-validation cycle is not started against a company that does not yet exist.

**That advice is correct, on two independent grounds:**

1. **ICANN registrant validation can suspend the domain.** Changing registrant name,
   email, or organisation triggers a verification cycle, and failure to complete it
   within the allowed window can suspend the domain. Starting that cycle against an
   entity that cannot be validated is an unnecessary risk to a domain that is
   currently working.
2. **ICANN requires registrant data to be accurate.** Section B already records that
   false registrant data is itself a cancellation risk. Entering "Twin Wicks Digital
   Solutions LLC" as the registrant organisation before that entity legally exists
   would be inaccurate data, and asserting "LLC" specifically compounds it.

**This refines rather than contradicts the front-loading advice above.** The sequence
is: **form the LLC first, then update the registrant** — not both at once, and not the
registrant change first. What should be front-loaded is the _formation_; the registrant
change follows it.

**And it changes the shape of the lock, favourably.** Because the registrant change
has not happened, no new 60-day lock has started. A future one will begin whenever the
registrant organisation is updated — so the lock clock is tied to LLC formation, not to
today. Combined with the same-account decision in F.6, this matters much less than it
did: the 60-day lock is a **transfer** lock, and with no account move planned there is
nothing for it to block. It would only bite if a registrar or account move later became
necessary.

Recorded as O-21 and its follow-on registrant-change step in
`REBRAND_PHASE_1_TODO.md`.

### A.2a The 60-day lock collides with DEC-0033's provisional window

Confirmed 2026-08-26: the ICANN 60-day lock **does** apply to AWS
account-to-account domain transfers, and it is triggered both by initial
registration **and by any change to WHOIS registrant name, email, or
organisation**.

Two consequences that were not visible before:

**1. The lock does not lapse until roughly 2026-10-05.** Registered 2026-08-06,
plus 60 days. DEC-0033's provisional maintenance window is **2026-10-01**. So:

> If the domain is to sit in a business AWS account **before** cutover, an
> October 1 window is not achievable. The lock outlasts it by about four days.

DEC-0033 already records October 1 as provisional and not a customer commitment,
so nothing is broken — but this is now a concrete constraint on it rather than a
general caution. Three ways it resolves, all owner decisions:

- Cut over with the domain in the individual account, and move it afterwards.
- Slip the window past 2026-10-05.
- Do not move the domain at all, consistent with option C in A.2.

**2. Forming the entity re-triggers the lock.** Changing the registrant
organisation or name to a newly formed entity starts a **fresh** 60-day lock. So
"form the entity, then move the domain to its account" is a two-step sequence with
a 60-day gap in the middle unless both are done as one operation.

Practical implication: if the entity is going to be formed at all, doing it
**early in Phase 1** costs almost nothing, whereas doing it near cutover injects a
60-day delay into the critical path at the worst possible moment. This strengthens
option A in A.2 relative to how it looked before this was confirmed — not decisive,
but the cost ordering has changed.

### A.1 Trademark research checklist (research only — not legal advice)

### A.1a Owner decision: search now, file later

**Owner position, 2026-08-26: trademark _filing_ is deferred until the product is
live and has users.** Stated reasoning: a previous application for a different
project failed, and the owner still receives spam email and texts generated from
that expired mark.

That reasoning is sound on its own terms. USPTO applications are **public
records**, and the trademark-solicitation spam industry scrapes them — deferring a
filing genuinely defers that consequence, and filing early for a product with no
users buys little.

**Recorded as a distinct point: the clearance _search_ is a different action from
the _filing_, and plan §8.1.3 requires the search, not the filing.** §8.1.3 says
"Check trademark and naming conflicts before public launch." Searching:

- creates **no public record**, so it generates none of the spam that motivated
  the deferral;
- costs nothing and is DIY-able;
- is the step that protects against the expensive failure mode — discovering a
  conflicting mark _after_ launch, after §8.3's full asset package is produced,
  after the domain is public, and after customers know the name. At that point the
  remedy is renaming the product.

So the recommendation is to **decouple**: run the search now, defer the filing as
the owner decided. The deferral costs little; skipping the search is what carries
the asymmetric risk.

**Open decision for the owner.** Plan §8's exit gate requires "legal has approved
the name," and §8.1.3 requires "Record legal approval of the stylized spelling."
Which satisfies that gate here?

1. **Owner-run search plus a recorded DEC entry** — proportionate to a
   pre-revenue product, consistent with deferring the filing, no cost.
2. **Counsel-run clearance opinion** — stronger, costs money, and is the
   conventional reading of "legal has approved."

Tracked as P1-03 in Section J. The gate wording will follow whichever is chosen.

**Owner decision, 2026-08-26: option 1 — the name `ListrAssistr` is approved.**
The owner is the named legal/support decision-maker for this project under DEC-0008,
so this is their call to make and it is recorded as made.

Recording the evidentiary basis accurately, because that is the whole purpose of a
recorded approval — someone reading this later needs to see what backed it:

- **What the approval rests on:** the USPTO wordmark search for `listerassister`
  (A.1c), which established that the one known near-identical name has **no live
  registration** — dead and abandoned 2014, never registered, never published.
  That was the highest-value single search, and it came back favourable.
- **What it does not yet rest on:** the remaining items in A.1b — the phonetic
  family, the `LISTR*`/`*ASSISTR` prefix and suffix families in Classes 9/35/42,
  state registrations, common-law use in the eBay seller-tool market, and the
  TSDR Office action (A.1h). None of these has been run.
- **What it explicitly is not:** a counsel-run clearance opinion. Option 2 was
  available and not chosen.

That is a legitimate, proportionate decision for a pre-revenue product with the
filing deferred — and it is not the same thing as a clearance opinion, so the record
says so plainly rather than implying more diligence than was done. The owner can
close the remaining A.1b searches at any point and amend the record; nothing about
this approval blocks §8.3 from proceeding now.

Draft DEC entry text, companion to DEC-0036 in A.2:

> **DEC-0037** — Resolves plan §8.1.3 and the "legal has approved the name" half of
> the §8 exit gate. **The product name `ListrAssistr` and its stylized spelling are
> approved by the owner**, 2026-08-26, under option 1 of this checklist's A.1a:
> owner-run search plus a recorded decision, rather than a counsel-run clearance
> opinion. Basis: USPTO wordmark search for the nearest known name,
> `LISTERASSISTER` (serial 86189022), returned **DEAD/ABANDONED 2014-12-12, never
> registered, never published, no assignments**, in Classes 035/041 covering
> online advertising, marketing, and photography — a services business, where
> ListrAssistr is Class 42 software. Accepted limitations, recorded rather than
> resolved: the wider search list in A.1b was not completed, the other party may
> hold geographically limited common-law rights from claimed use since 2008, and
> trademark **filing** remains deferred per A.1a. Revisit if a conflicting use
> surfaces, or when a filing is actually made.

**Precision note on wording.** The gate is about the **name/mark** `ListrAssistr`,
not the domain `listrassistr.com`. They are separate things — A.1d covers why —
and the DEC text above is worded against the mark deliberately.

### A.1b The searches themselves

This is a list of searches to run — and to hand to counsel if option 2 is chosen.
It is not a clearance opinion, and I am not the sign-off in plan §8.1.3.

- [ ] **USPTO federal marks** — search at `tmsearch.uspto.gov` (the tool that
      replaced TESS). Search the literal string, and separately search phonetic
      and spelling variants: `listrassistr`, `lister assistr`, `listr assist`,
      `list assist`, `listing assistant`.
- [ ] **Likely Nice classes for counsel to review** — 42 (SaaS / software as a
      service), 35 (advertising, business services, online marketplace/listing
      services), and 9 if a downloadable app or installable PWA ever ships.
- [ ] **State-level registrations** in the entity's state of formation, plus any
      state with substantial customer concentration.
- [ ] **Common-law use** — web search, eBay/Etsy/Amazon seller-tool directories,
      Shopify and eBay app marketplaces, GitHub, Product Hunt, app stores.
- [ ] **International**, if selling or marketing outside the US: EUIPO eSearch
      and WIPO Global Brand Database. eBay sellers are frequently cross-border,
      so do not skip this by default.
- [ ] **Handle availability** for the same string on X, Instagram, LinkedIn,
      YouTube, Reddit, and the eBay seller-community forums.
- [ ] **Record the outcome** — plan §8.1.3 requires recorded legal approval of
      the stylized spelling. Add it to the decision log as its own DEC entry.

Note for counsel, not a conclusion: `ListrAssistr` is a coined, deliberately
misspelled mark, which generally helps distinctiveness. It does **not** by itself
clear a confusingly-similar prior mark, and `list`/`lister`/`listr` is a crowded
field in e-commerce seller tooling. Treat the crowding as the main risk to check.

### A.1c What to actually look for — the `listerassister.com` question

Not legal advice. This is a research plan and a flag on one specific fact pattern.

**Answered 2026-08-26 — and the answer is favourable.** USPTO search for
`listerassister` returns exactly one record:

| Field                   | Value                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Mark                    | **LISTERASSISTER** (standard characters, service mark)                                           |
| Serial                  | 86189022                                                                                         |
| Filed                   | 2014-02-10                                                                                       |
| **Status**              | **DEAD / ABANDONED**, 2014-12-12                                                                 |
| Case status             | "Abandoned because the applicant failed to respond or filed a late response to an Office action" |
| **Registration number** | **N/A — never registered**                                                                       |
| **Publication date**    | **N/A — never published**                                                                        |
| Classes                 | **035** (on-line advertising and marketing services), **041** (photography)                      |
| Claimed first use       | 2008-10-01, both classes                                                                         |
| Owner                   | Lister Assister, **sole proprietorship**, Phoenix, Arizona                                       |
| Assignments             | None                                                                                             |
| Related properties      | None                                                                                             |

**What this removes.** There is **no federal registration** to conflict with — the
application died at the Office-action stage twelve years ago, never reached
publication, and was never assigned to anyone. So there is no registered mark
barring `LISTRASSISTR`, and no nationwide constructive notice attaching to
`LISTERASSISTER`. The risk this section was written to flag is substantially lower
than it looked.

**What it does not remove — two things.**

1. **An abandoned application is not abandoned rights.** US trademark rights arise
   from **use**, not registration. The application claimed continuous use from
   2008, and the business appears to still be operating. That supports
   **common-law rights**, which are real but **geographically limited to the
   area where the mark is actually used** — on this record, Arizona and wherever
   else they demonstrably trade. Far weaker than a registration, not nothing.
2. **The Office action itself is unread, and it is the highest-value thing left to
   look at.** Click **View in TSDR** on that record and read why the examiner
   objected. Two possibilities, both directly useful:
   - **Refused as merely descriptive.** "Lister Assister" describes
     listing-assistance services, and USPTO frequently refuses phonetic
     misspellings of descriptive terms on the same basis — examiners look through
     the respelling. If that is what happened, it is a direct signal about whether
     `LISTRASSISTR` is registrable when the owner eventually files, independent of
     this other party entirely.
   - **Refused over a prior conflicting mark.** If so, **that** mark is a bigger
     concern than this dead application, and it needs to be identified and
     assessed.

   Either way it is free information behind one click, and it is the single best
   next step in this whole section.

**On the services comparison, now that the classes are known.** Classes 035 and
041 covering online advertising/marketing plus photography, from a sole proprietor,
reads as a done-for-you real-estate listing marketing and photography service — not
software. ListrAssistr is SaaS, which is **Class 42**, with plausible adjacency in 035. So the goods-and-services separation is real and better than assumed: a
service business versus a software product, different customers, different channels.
There is genuine 035 adjacency and both involve "listings", so it is a strong
argument rather than a total absence of overlap.

**Why the spelling difference protects you less than it appears to.** Trademark
similarity analysis weighs **sound**, not just spelling — marks that are
phonetically equivalent are routinely treated as similar even when spelled
differently. "Lister Assister" and "ListrAssistr" are, spoken aloud,
indistinguishable. Dropping the E's changes the visual mark and the domain string;
it does not change the pronunciation at all. So the vowel-dropping should be
understood as a **domain-collision and memorability device, not a legal
distinction**.

**What genuinely helps you here** is the other half of the test: similarity of
goods and services. A home/real-estate listing platform and an eBay reseller
listing tool serve different customers through different channels. That is a real
argument for coexistence, and it is probably the strongest fact in your favour.
Worth noting honestly that it is not as strong as it first sounds — both are
"listing" software, both plausibly sit in Class 42, and "listing platform" is the
shared descriptor — so it is an argument, not a slam dunk.

**One flag on the slogan.** A tagline built on "drop the E's" is a good mnemonic
for typo-recovery, and that instinct is sound. But it also does two things worth
weighing before it goes to print:

- It **explicitly invokes the other name** in customers' minds, which works
  against the goods-and-services separation that is otherwise your best argument.
- In a dispute, intent is one of the confusion factors. Marketing material that
  instructs customers to derive your name by respelling a similar existing name is
  the kind of thing that gets quoted back. It reads as awareness of the other mark.

None of that makes the slogan unusable — the markets really are different, and
plenty of brands lean on deliberate misspellings. But it is the one item on this
page worth putting in front of counsel specifically, rather than deciding alone.
A tagline that teaches the spelling without referencing the other name
("no E's, all listings" style, or anything phrased around your own mark rather
than theirs) gets the same typo-recovery benefit without the evidentiary downside.

**Concrete search list, in priority order:**

- [ ] `listerassister` / "Lister Assister" as a **mark** in `tmsearch.uspto.gov` —
      registered, pending, abandoned, or nothing. Note class and services text.
- [ ] The same operator's business name at state level, and whether they assert
      ™ or ® anywhere on their site.
- [ ] **Phonetic family**, all treated as similar until shown otherwise:
      `listrassistr`, `lister assister`, `listr assist`, `list assist`,
      `listassist`, `listing assistant`, `listing assist`.
- [ ] **Prefix/suffix families**: marks beginning `LISTR`, and marks ending
      `ASSISTR`/`ASSIST` in Classes 9, 35, and 42. This shows how crowded the
      field is, which affects how much protection your own mark could ever get.
- [ ] **Class 42 and Class 35** specifically, since those are where a conflict
      would actually bite; Class 9 if a downloadable app or installable PWA ships.
- [ ] **Design mark** search if the `LA` monogram will be used as a logo in its
      own right, not just alongside the wordmark.
- [ ] **Common-law use** in your actual market: eBay/Etsy/Amazon seller-tool
      directories, the eBay app marketplace, Shopify app store, Product Hunt,
      GitHub, app stores. A competitor with unregistered but established use in
      _your_ niche is a more practical threat than a registered mark in real estate.
- [ ] **Live commercial use** of `listrassistr` in any spelling by anyone else.
- [ ] **Record findings with screenshots and dates** into a DEC entry, per §8.1.3.
      Even under option 1 in A.1a, contemporaneous evidence of a good-faith search
      is worth more than a recollection later.

### A.1d Can `listerassister.com` be acquired? No — and it should not be pursued

Asked by the owner 2026-08-26 on the basis that the trademark is dead. **The
trademark status and the domain's availability are unrelated systems**, so the dead
mark does not free the domain:

- Domain registration is a first-come-first-served contract with a registrar. It
  has no connection to USPTO status. A mark can be dead while its domain stays
  registered indefinitely, and a domain can be registered by someone with no mark
  at all.
- **`listerassister.com` is registered and live.** Verified by DNS 2026-08-26:
  resolves to `20.40.24.37`, delegated to `ns27.domaincontrol.com` (GoDaddy). The
  only route to it would be buying it from the current owner — a private
  negotiation for the operating domain of a running business.

**And pursuing it would create the risk this whole section exists to avoid.**
Acquiring a domain that matches another operating business's name, while running an
adjacent "listing" product and marketing a tagline that instructs customers to
respell that name, is close to the textbook fact pattern for a **UDRP complaint or
an ACPA cybersquatting claim**. Two things make that worse rather than better here:

- UDRP explicitly accepts **unregistered/common-law** marks as a basis for a
  complaint, so the dead application is no shield — the continuous-use claim from
  2008 is what would be asserted.
- Intent is a factor, and deliberately acquiring the confusingly-similar domain is
  the strongest possible evidence of it.

So: the dead mark is good news for **using your own name**, and no basis at all for
**taking theirs**.

### A.1e What to register instead — all the useful variants are free

The actual goal is typo recovery, and that does not require anyone else's domain.
Checked by DNS 2026-08-26 — **no NS delegation, so almost certainly unregistered**
(confirm at the registrar, which is authoritative, before assuming):

| Domain                                      | Status 2026-08-26                    | Value as a typo catcher                                                       |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `listerassistr.com`                         | **ACQUIRED and configured** by owner | **High** — first E restored only. The most likely misfire from "drop the E's" |
| `listrassister.com`                         | **Registration failed** — see A.1g   | **High** — second E restored only. The other half-corrected spelling          |
| `listrasistr.com`                           | Appeared unregistered                | Medium — dropped S                                                            |
| `listassistr.com`                           | Appeared unregistered                | Medium — dropped the `r` from `listr`                                         |
| `listrassist.com`                           | Appeared unregistered                | Medium — dropped trailing `r`                                                 |
| `listrassistr.net` / `.co` / `.app` / `.io` | Appeared unregistered                | Low-medium — brand defence rather than typo defence                           |
| `listerassister.com`                        | **Taken** — live business            | Not available, and see A.1d                                                   |

Original recommendation was to register both high-value variants and redirect both
to the apex — the two spellings a customer working from memory of a "drop the E's"
instruction will actually produce, at roughly the price of a coffee each per year,
and unlike `listerassister.com` belonging to nobody else. One is done; the other
failed.

### A.1f `listerassistr.com` — verified live and confirmed as a redirect

Confirmed by DNS 2026-08-26:

| Record                        | Value                                          | Note                                                                                                                       |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `listerassistr.com` NS        | `ns-277.awsdns-34.com` + 3 more                | Its **own** Route 53 hosted zone, separate from `listrassistr.com`'s                                                       |
| `listerassistr.com` A         | `216.150.1.1`, TTL 300                         | Same Vercel apex value as the main domain                                                                                  |
| `www.listerassistr.com` CNAME | `2f1e3f86cb32a6a8.vercel-dns-016.com`, TTL 300 | **The same per-project Vercel target as `www.listrassistr.com`** — so both domains are attached to the same Vercel project |

**The open question DNS cannot answer: does it _redirect_, or does it _serve_ the
same site?** Both configurations produce exactly the DNS above; the difference is a
Vercel-side setting. An HTTP check from the owner's workstation returned 403 for
both hostnames — the same Zscaler interception documented earlier — so this must be
confirmed in the Vercel dashboard or from a personal device.

**It should be a redirect** (Vercel offers a "Redirect to" option when adding a
domain; a 308 to `https://listrassistr.com` is the intent). Three reasons, in
increasing order of importance:

1. **SEO.** Two hostnames serving identical content splits ranking signals unless
   canonical tags are exactly right. A redirect makes the question moot.
2. **Brand.** If the typo domain serves the full site, it stops being a funnel and
   becomes a second legitimate address — people bookmark it, share it, cite it. That
   perpetuates the "which spelling is it?" ambiguity that owning one canonical
   domain is meant to end.
3. **Authentication, and this one is functional rather than cosmetic.** The staging
   Supabase project records Auth Site URL `https://listrassistr.com` and callback
   `https://listrassistr.com/auth/callback`
   (`REBRAND_PHASE_0_SERVICE_INVENTORY.md:76`). The coming-soon page already has a
   **Sign in** link. If `listerassistr.com` serves the app rather than redirecting,
   a user who signs in from that origin hits a callback on a different host than
   they started on — cookies scoped to the wrong domain, and a redirect URI that
   does not match the allow-list. Sign-in breaks, or behaves unpredictably. A
   redirect at the edge means only one origin ever reaches the app, and the existing
   Supabase configuration stays correct without adding a second allowed origin.

- [x] **Confirmed by owner 2026-08-26: configured as a redirect, not serving from
      this domain.** All three concerns below are therefore closed — SEO signals are
      not split, the typo domain stays a funnel rather than a second address, and
      only one origin ever reaches the app so the existing Supabase auth
      configuration remains correct.
- [ ] Optional, low priority: re-verify externally after any Vercel domain change,
      since the workstation cannot see past its proxy.

**A fourth reason, not flagged clearly enough when this domain was recommended.**
`listerassistr.com` sits **one character** from `listerassister.com`, the live
business in A.1c/A.1d — it is that name minus the final `e`. Viewed in isolation,
owning a one-character variant of another business's domain is the typosquatting
pattern. Viewed accurately, it is also a one-character variant of the owner's _own_
mark (`listrassistr` plus one `e`), which is why it was recommended: it sits
between the two names.

What determines which reading applies is **what it does**:

- **Redirecting to `listrassistr.com`** makes it unambiguously defensive — a
  variant of the owner's own mark, funnelling to the owner's own brand. Normal,
  routine, easy to explain.
- **Serving content, or ever pointing anywhere else**, is where the
  one-letter-from-their-domain fact becomes the weak point in any dispute.

Mitigating facts remain strong: the other party holds **no registration**, the
markets differ, and the variant is equally derived from the owner's own name. But
the redirect is what keeps that posture clean, which makes it worth doing promptly
rather than eventually. The same reasoning applies to `listrassister.com` if that
registration is retried successfully.

### A.1g `listrassister.com` — registration failed, and NXDOMAIN does not mean free

Confirmed by DNS 2026-08-26: `listrassister.com` returns **NXDOMAIN** with no NS,
no A, no CNAME. So the registration did not complete.

**Correcting an over-read of the earlier check, including mine.** A.1e's "no NS
delegation, so almost certainly unregistered" was hedged, and this is exactly why:
**a domain can be registered with no nameserver delegation at all**, in which case
it returns NXDOMAIN and looks identical to an unregistered domain. DNS cannot
distinguish the two. Only the registrar's availability check or a WHOIS/RDAP lookup
is authoritative.

So the failure has more than one possible cause, and the error text determines which:

| Likely cause                      | How it shows                                                          | Fix                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient registrar/AWS error     | Generic failure, no specific reason                                   | Retry                                                                                                                                                 |
| **Someone else registered it**    | "unavailable" / "already registered"                                  | None — reassess whether the variant is still worth chasing                                                                                            |
| Registry-reserved or premium name | Priced far above normal, or "not available for registration"          | Owner decision on cost                                                                                                                                |
| **Registrant email not verified** | Registration accepted then suspended, or blocked pending verification | ICANN requires registrant contact verification; complete the emailed verification. Worth checking regardless, since it can suspend an existing domain |
| Payment method declined           | Billing error                                                         | Fix the card on the AWS account                                                                                                                       |
| Route 53 per-account domain limit | Quota error                                                           | Request a limit increase                                                                                                                              |

- [ ] Capture the **exact error text** from Route 53 — it distinguishes "retry this"
      from "this is gone."
- [ ] Re-check availability authoritatively via the Route 53 domain search or
      WHOIS/RDAP, not DNS.
- [ ] Confirm the registrant contact on the **existing** domains is verified, since
      an unverified contact is a live risk to `listrassistr.com` itself, not just to
      a new registration.

Priority note: `listrassister.com` is worth a retry, but it is **defence in depth,
not a blocker**. The higher-value half of the pair is already secured, and A.1c's
tagline rewording would reduce the need for either.

### A.1h TSDR — what it is and how to pull the Office action

**TSDR is Trademark Status and Document Retrieval**, at `tsdr.uspto.gov`. Same
agency as the search tool, different job:

- `tmsearch.uspto.gov` shows the **record summary** — the fields in the screenshots
  already captured: status, classes, owner, dates.
- **TSDR holds the actual documents and correspondence** for that file — the
  examiner's letters, the applicant's responses, specimens, the full prosecution
  history. It is where the _reason_ for something lives, rather than the fact of it.

For `LISTERASSISTER`, the record says only "abandoned because the applicant failed
to respond … to an Office action." TSDR holds **the Office action itself**, which
says what the examiner actually objected to.

**Steps:**

1. Click **View in TSDR** on the record already open, or go to `tsdr.uspto.gov`.
2. Select **Serial Number**, enter **86189022**, search.
3. Open the **Documents** tab (some views call it Document Retrieval). The
   **Prosecution History**/Status tab lists the same events chronologically and is
   often the easier way to find the date.
4. Look for a document from **mid-2014** — filing was 2014-02-10 and abandonment
   2014-12-12, and Office actions typically issue a few months after filing, with
   six months allowed to respond. It will be labelled something like
   **"Offc Action Outgoing"**, **"Non-Final Office Action"**, or similar.
5. Open the PDF and read the refusal section.

**What you are looking for, and what each answer means:**

| If the Office action cites                                                              | It means                                                                                                                                                                                                                | Relevance now                                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section 2(e)(1)** / "merely descriptive"                                              | The examiner thought "Lister Assister" merely describes listing-assistance services. Examiners routinely look **through** phonetic respellings, so a coined misspelling of a descriptive term can draw the same refusal | **Forward-looking only.** It is a signal about whether `LISTRASSISTR` would be registrable whenever a filing is actually made — and filing is deferred, so it changes nothing today |
| **Section 2(d)** / "likelihood of confusion"                                            | It was refused over a **prior existing mark**, which the Office action will name with its serial or registration number                                                                                                 | **The one that matters.** That cited mark may be live, and would be a more relevant conflict than the dead application. Worth identifying                                           |
| A technicality — specimen defect, identification-of-goods wording, a disclaimer request | The application died on paperwork, not on the merits of the name                                                                                                                                                        | Tells you little, which is itself useful — it means no examiner ever questioned the name                                                                                            |

**Priority, honestly stated:** now that the name is approved (A.1a), this is
**informational rather than gating**. It costs about ten minutes and the realistic
upside is scenario 2 — discovering a live cited mark nobody has looked at yet. If it
turns out to be scenario 1 or 3, it simply confirms the current position. Worth doing
before any eventual filing; not worth blocking §8.3 on.

Note the interaction with A.1c: the two half-corrected spellings only exist as
likely typos _because_ of the "drop the E's" framing. If that tagline is reworded
to reference `ListrAssistr` directly rather than the other spelling, the typo
pressure drops and these become ordinary cheap brand defence rather than a
necessity.

## Section B — Registrar hardening (plan §8.1.2)

Current state per owner report 2026-08-26. Most of this is already done.

| Control                          | State                                      | Action                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer lock                    | **On**                                     | None                                                                                                                                                                                                              |
| Auto-renew                       | **On**                                     | Confirm the payment method's own expiry is later than 2027-08-06 — a lapsed card is the most common cause of accidental domain loss                                                                               |
| Recovery contacts                | **Set** — owner + `twinwicksllc@gmail.com` | Send one real test message to each to confirm both are actually reachable                                                                                                                                         |
| Expiry alerts                    | **On**                                     | Add an independent calendar reminder that does not depend on registrar email deliverability                                                                                                                       |
| **MFA on the AWS root account**  | **On**                                     | Confirmed by owner 2026-08-26. An earlier draft of this document recorded it as off; that was a misread of an ambiguously-worded question about "registrar MFA" and is corrected here                             |
| WHOIS/RDAP privacy               | **On for all four contacts**               | Registrant, Admin, Tech, and Billing all resolve to the owner as an individual, all with privacy protection enabled. ICANN accuracy is satisfied — the underlying data is real, merely shielded from public WHOIS |
| Registration term                | 1 year (2026-08-06 → 2027-08-06)           | Optional: extend to multi-year to reduce renewal-failure surface                                                                                                                                                  |
| Registrar/DNS account separation | **Not applicable**                         | Both are Route 53 in the same AWS account. The original mitigation does not exist here; see B.1                                                                                                                   |
| Documented access and recovery   | **Not done**                               | Add Route 53 (registrar + DNS) to `REBRAND_PHASE_0_SERVICE_INVENTORY.md`: account owner, recovery path, MFA method. Names and locations only, never secret values                                                 |

Section B is in good shape. Transfer lock, auto-renew, recovery contacts, expiry
alerts, root MFA, and WHOIS privacy are all in place. Only the service-inventory
write-up and the two optional items below remain.

### B.1 The consolidation tradeoff, and what remains

The original draft's mitigation for registrar compromise was "keep the registrar
account separate from the DNS-provider account, so one credential compromise does
not yield both." **That mitigation does not exist in this setup** — Route 53 is
both, in one AWS account. So the whole mitigation rests on that single account
being hard to get into, which is why root MFA being on matters as much as it does.

For the record, what someone inside that account could do — transfer lock and
auto-renew notwithstanding, since neither constrains an insider:

- Repoint `app.listrassistr.com` to infrastructure they control.
- Obtain valid TLS certificates via DNS validation. The zone has **no CAA
  record**, so nothing currently restricts which CA will issue for this domain.
- Publish their own SPF and DKIM records and send authenticated mail as the
  domain — precisely the trust §8.2 is being built to establish.

Transfer lock prevents the domain being moved _away_. It does nothing about
someone operating it in place. With root MFA on, the realistic residual risks are
credential reuse on a non-root principal and the missing CAA record.

Remaining, both minor:

- [ ] **Confirm day-to-day work does not use the root user.** Root MFA protects
      root; it does not help if routine console work happens as root anyway, or if
      an IAM user with Route 53 write access has no MFA of its own. Ideal state:
      root locked away with MFA, daily work via an IAM principal that also has MFA.
- [ ] **CAA record** — restricts which CA may issue for the domain, closing the
      second bullet above. Sequenced deliberately **after** certificates issue
      (Section I step 11), because a wrong CAA value silently blocks issuance and
      renewal.
- [ ] Record the MFA method (not the secret) in the service inventory.

## Section C — DNS provider (plan §8.1.4) — settled

**Decided by events: AWS Route 53**, both registrar and authoritative DNS, in one
AWS account. This is no longer an open choice; what follows is the requirements
check against what Route 53 actually gives, plus the one structural consequence.

| Requirement (from the plan)                      | Route 53 | Note                                                                                                                                  |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **DNSSEC support** (§8.1.8)                      | Yes      | Supported for public hosted zones. Not yet enabled — no DNSKEY or DS present. Exact enablement steps queued for external verification |
| **TTL control to 300s or lower** (§8.1.7)        | Yes      | Apex and `www` are already at 300                                                                                                     |
| **Propagation, API, audit trail**                | Yes      | Route 53 changes propagate quickly; CloudTrail gives the audit trail, if enabled                                                      |
| **Can host Vercel + Resend records in one zone** | Yes      | Currently hosting the Vercel apex A and `www` CNAME                                                                                   |

All four requirements are met, so there is no reason to move DNS elsewhere. Plan
§8.1.4's second half — "document access/recovery" — is still outstanding and is
tracked in Section B.

### C.1 Structural consequence of the consolidation

Registrar and DNS being one account is convenient and entirely defensible, but it
removes the two-account separation the original draft assumed as a mitigation.
Recorded here so the tradeoff is explicit rather than accidental:

- **Single point of compromise.** Covered in B.1. AWS account MFA is the mitigation.
- **DNSSEC is simpler.** When the domain is registered at Route 53 _and_ the zone
  is hosted there, Route 53 may publish the DS record to the parent itself rather
  than requiring a manual paste. Queued for verification; if true, it materially
  lowers the risk of a botched DS chain, which is the main hazard in §8.1.8.
- **No cross-provider TTL mismatch** to reason about during cutover.

Context worth keeping: production still runs on `lister.teckstart.com`, a
subdomain of a different domain, and per plan §14 that hostname must eventually
redirect permanently to `app.listrassistr.com`. `listrassistr.com` is a genuinely
new apex, not a re-pointing of an existing one, which is why the zone is nearly
empty and why §8.2's email work has no legacy records to preserve.

## Section D — Record plan

**Rule, from plan §8.1.5 verbatim: "do not copy stale example IP addresses from
documentation."** Values shown as **live** below are the zone's actual observed
contents as of 2026-08-26, not examples. Everything still in `<angle brackets>` is
a placeholder — take those from the provider dashboard that issues them, at the
time you configure them.

Note that §8.1.5's rule cuts both ways here: `216.150.1.1` is recorded because it
is what the zone genuinely serves, but that is evidence it _works_, not evidence it
is what Vercel currently recommends.

**Resolved 2026-08-26, and it is a good illustration of why §8.1.5 is worded the
way it is.** A documentation search returned `76.76.21.21` as the "official" apex
value along with advice not to use `216.150.1.1`. That advice was **not acted on**:
`76.76.21.21` is Vercel's older generic value, while this zone carries
`216.150.1.1` at the apex and a _per-project_ `www` target — the signature of
Vercel issuing project-specific values. Changing a working apex record on the
strength of generic documentation is precisely the failure §8.1.5 prohibits.

The authority is **the Vercel dashboard for this project**, and that is where the
`app` and `qa` targets should come from too. Related: a Route 53 **ALIAS** record
cannot be used here at all — alias targets are AWS-only, and Vercel is not among
them — so the plain A record is correct, not a workaround.

| Host / name                                  | Type      | Value                                                                         | TTL at setup | Source of truth  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------- | ----------------------------------------------------------------------------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@` (apex)                                   | A         | `216.150.1.1` — **live**                                                      | 300          | Vercel           | Already configured and serving. **Verify against Vercel's current recommended apex value** before treating as final; also check whether Vercel now prefers a Route 53 ALIAS at the apex                                                                                                                                                                                                                                                                                                                            |
| `www`                                        | CNAME     | `2f1e3f86cb32a6a8.vercel-dns-016.com` — **live**                              | 300          | Vercel           | Already configured. Canonical-host decision (apex vs `www`) still open — plan §6.1 implies apex = marketing, so apex-canonical with `www` redirecting                                                                                                                                                                                                                                                                                                                                                              |
| `app`                                        | CNAME     | `<target shown by Vercel>` — **absent, required**                             | 300          | Vercel           | Plan §8.1.6. The primary application hostname per plan §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `qa`                                         | CNAME     | `<target shown by Vercel>` — **absent, required**                             | 300          | Vercel           | Plan §8.1.6; maps to the Vercel Preview/QA environment                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `_vercel`                                    | TXT       | `<verification token from Vercel>`                                            | 3600         | Vercel           | Not currently present and apparently not needed — the apex already resolves and serves. Add only if Vercel asks when `app`/`qa` are attached                                                                                                                                                                                                                                                                                                                                                                       |
| `<selector>._domainkey`                      | TXT       | `<issued by Resend>`                                                          | 3600         | Resend           | Confirmed 2026-08-26 as a **TXT** record, not a CNAME. Publish exactly what the Resend dashboard issues, including the selector subdomain — do not template it                                                                                                                                                                                                                                                                                                                                                     |
| `send` (or Resend's stated return-path host) | TXT / MX  | `<issued by Resend>`                                                          | 3600         | Resend           | Custom return-path / MAIL FROM alignment, plan §8.2.4                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@` (apex)                                   | TXT (SPF) | `v=spf1 include:<ses-issued-include> include:<mailbox-provider-include> ~all` | 3600         | Hand-built       | **Exactly one SPF TXT record per name.** Two SPF records is a permanent hard failure. Merge all senders into one string. Stay within the 10-DNS-lookup limit. Start `~all` (softfail), not `-all`                                                                                                                                                                                                                                                                                                                  |
| `_dmarc`                                     | TXT       | `v=DMARC1; p=none; rua=mailto:<analyzer>; fo=1; adkim=r; aspf=r; pct=100`     | 3600         | Hand-built       | Plan §8.2.3 mandates `p=none` **and a report-review period** before tightening. Start relaxed alignment (`r`) to avoid false failures during setup; tighten to `s` alongside the move to quarantine                                                                                                                                                                                                                                                                                                                |
| `@` and/or mail host                         | MX        | `<issued by the A6 mailbox provider>`                                         | 3600         | Mailbox provider | Required for inbound `support`/`privacy`/`legal`/`security@`. Resend does not receive mail                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@`                                          | CAA       | `0 issue "<CA confirmed from the live cert>"`                                 | 3600         | Hand-built       | **Add only after certificates have issued, and only once the real issuing CA is confirmed.** Documentation says Vercel uses Let's Encrypt and auto-creates this record — but no CAA exists in this zone, because Vercel can only manage CAA when Vercel manages the DNS. The issuing CA **cannot be read from the owner's workstation** (Zscaler TLS interception returns a corporate certificate); confirm externally via SSL Labs or a personal device first. A wrong value silently blocks issuance and renewal |

### D.1 TTL sequencing (plan §8.1.7)

**Already satisfied for the records that exist.** Apex and `www` are both serving
TTL 300 today, so §8.1.7's "set TTL to 300 at least 24 hours before cutover" needs
no action for them. Only the second half of §8.1.7 — "raise it after
stabilization" — remains, and that is post-cutover work.

Why the lead time exists, for whoever runs the cutover: lowering a TTL only takes
effect once the _previous_ TTL has aged out of resolver caches, so a record sitting
at 3600 needs roughly that long before the 300 is authoritative everywhere. Since
these records have been at 300 since creation, there is no cached longer value to
wait out.

- [x] Cutover-relevant records at TTL 300 — apex and `www`, verified 2026-08-26.
- [ ] Create `app` and `qa` **at TTL 300** so they inherit the same property
      rather than needing a later drop.
- [ ] T-24h before cutover: re-confirm 300 is being served (Section E).
- [ ] Cutover: repoint.
- [ ] Post-stabilization: raise to 3600 and re-verify, per §8.1.7.

Create DKIM/SPF/DMARC/MX at 3600 — they do not change at cutover, and a longer TTL
reduces lookup load on mail paths. `NS` stays at Route 53's 172800 default; there
is no reason to lower it unless the nameservers themselves are changing.

### D.2 DMARC staging

`p=none` is a measurement mode, not a finished state, and moving off it early is
how legitimate mail starts disappearing.

1. Publish `p=none` with `rua` pointing at a DMARC analyzer.
2. **Collect for 2–4 weeks minimum; 30 days is the realistic target.** Corrected
   2026-08-26 — an earlier revision of this document said "one full weekly
   reporting cycle", which is shorter than guidance supports. M3AAWG and the major
   inbox providers treat `p=none` as a measurement phase with a **2–4 week
   floor**, and commonly recommend **30–90 days** depending on how many systems
   send as the domain. The period must in any case be long enough to cover every
   legitimate sender: Resend product mail, the mailbox provider, and any
   Stripe/eBay/support tooling.
3. Confirm every legitimate source shows SPF **and** DKIM alignment passing.
4. Only then move to `p=quarantine; pct=<ramp>`, ramping the percentage.
5. Only then consider `p=reject`, and tighten `adkim`/`aspf` to `s`.

Do not sit at `p=none` indefinitely either — Gmail and Yahoo apply increasingly
strict expectations to bulk senders, so `p=none` is a transitional state in both
directions.

**Schedule consequence.** At a 30-day floor, publishing DMARC today puts
`p=quarantine` in reach around late September. Publishing it a month from now puts
it past any October cutover. This is the single longest fixed wait in Phase 1 and
it is gated only on the Resend account decision (F.1) — which makes that decision
more time-sensitive than its size suggests.

## Section E — Verification procedure

Windows note: `dig` is not present by default. PowerShell equivalents given
first; use `dig` if you have WSL or BIND tools installed.

### E.0 Resolver constraint on the owner's workstation

**Measured 2026-08-26: the owner's network blocks outbound DNS to every public
resolver tested except `1.1.1.1`.** `8.8.8.8`, `9.9.9.9`, `1.0.0.1`, and
`208.67.222.222` all fail — and they fail for `google.com` too, which proves it is
egress filtering rather than anything wrong with the zone. The corporate default
resolver works and agrees with `1.1.1.1`.

Consequence: **the "query two independent public resolvers" check cannot be
completed from that machine.** Two resolvers that both sit behind the same
corporate egress are not independent for propagation purposes. Substitute one of:

- A **web-based DNS checker** that queries from outside the network entirely
  (`dnschecker.org`, `whatsmydns.net`, or MX Toolbox for mail records). This is
  the practical option and gives a genuinely external, multi-region view.
- The same PowerShell commands run from a **phone hotspot or home network**.
- `dnsviz.net` specifically for the DNSSEC chain, which must be validated
  externally regardless.

The commands below still work against `1.1.1.1` and the corporate resolver, and are
worth running for the fast local check — just do not treat agreement between those
two as propagation confirmation.

```powershell
# Apex and subdomains. 1.1.1.1 is the only public resolver reachable from the
# owner's network; pair it with a web-based checker for the external view.
Resolve-DnsName listrassistr.com      -Type A     -Server 1.1.1.1
Resolve-DnsName listrassistr.com      -Type A                      # corporate resolver
Resolve-DnsName app.listrassistr.com  -Type CNAME -Server 1.1.1.1
Resolve-DnsName qa.listrassistr.com   -Type CNAME -Server 1.1.1.1

# Email authentication
Resolve-DnsName listrassistr.com        -Type TXT -Server 1.1.1.1   # expect exactly ONE v=spf1
Resolve-DnsName _dmarc.listrassistr.com -Type TXT -Server 1.1.1.1
Resolve-DnsName listrassistr.com        -Type MX  -Server 1.1.1.1

# DNSSEC
Resolve-DnsName listrassistr.com -Type DNSKEY -Server 1.1.1.1
Resolve-DnsName listrassistr.com -Type DS     -Server 1.1.1.1
Resolve-DnsName listrassistr.com -DnssecOk    -Server 1.1.1.1
```

```bash
# dig equivalents
dig +short listrassistr.com A @1.1.1.1
dig +short listrassistr.com TXT @1.1.1.1
dig +short _dmarc.listrassistr.com TXT @1.1.1.1
dig +dnssec listrassistr.com @1.1.1.1
dig listrassistr.com DS @1.1.1.1
```

Checks to pass:

- [ ] Apex, `www`, `app`, `qa` all resolve to the Vercel-issued targets from at
      least two independent public resolvers.
- [ ] **Exactly one** `v=spf1` TXT record is returned for the apex.
- [ ] `_dmarc` returns a single valid `v=DMARC1` record with a reachable `rua`.
- [ ] DKIM resolves at the exact selector Resend issued.
- [ ] TTL values match intent — observe the countdown across repeat queries.
- [ ] **DNSSEC DS chain validates** (plan §8.1.8): the DS record at the registrar
      matches the DNSKEY at the DNS provider. Verify with an external validator
      (`dnsviz.net`, or Verisign's DNSSEC debugger) — a self-consistent-looking
      pair can still be a broken chain, and a bad DS record makes the domain
      resolve nowhere for validating resolvers.
- [ ] HTTPS certificates issued for apex, `app`, and `qa`; no mixed-content or
      redirect loop between apex and `www`.

### E.1 Email deliverability tests (plan §8.2.5)

- [ ] Test send to **Gmail** — open "Show original" and confirm `SPF: PASS`,
      `DKIM: PASS`, `DMARC: PASS`, and that the DKIM `d=` domain is
      `listrassistr.com`, not a provider-shared domain (that is the alignment
      check, and it is the one people miss).
- [ ] Test send to **Outlook/Microsoft 365** — confirm headers and that the
      message is not foldered as junk.
- [ ] Test send to a **DMARC/deliverability analyzer** (mail-tester.com,
      dmarcian, Postmark's tool, or equivalent).
- [ ] **Inbound test** to each role mailbox: `support`, `privacy`, `legal`,
      `security@listrassistr.com`. Confirm delivery _and_ that a reply comes from
      the correct address.
- [ ] Confirm reply-to handling, link rendering, and — for any marketing-class
      mail — unsubscribe headers per plan §8.2.5.

## Section F — Forward dependency worth resolving during 8.1

**The Resend step in §8.2.2 has a known cost blocker, and it affects which
account issues the DKIM values that go into the zone specified in Section D.**

RBR-0031 established that the shared Resend account has only `rankedceo.com`
verified, and that adding a second sending domain requires a paid plan tier.
DEC-0024 worked around this for the internal cost alert by sending from the
existing CRM domain rather than verifying a second one — acceptable for an
internal alert, but not for customer-facing ListrAssistr mail.

Two paths, owner's decision:

1. **A dedicated ListrAssistr Resend account.** Consistent with DEC-0027, which
   already set the precedent of a dedicated Stripe account for ListrAssistr
   rather than splitting shared CRM infrastructure. Also avoids inheriting the
   CRM's sending reputation.
2. **Upgrade the shared account** and add `listrassistr.com` as a second domain.
   Cheaper in effort, but keeps customer-facing mail behind the shared CRM login
   that RBR-0024 already flags.

Worth settling during 8.1 rather than at 8.2, because the answer determines the
DKIM selector and SPF include that go into the zone.

### F.1 Confirmed pricing changes the recommendation

Verified 2026-08-26, confirming RBR-0031:

|                          | Free tier | Pro           |
| ------------------------ | --------- | ------------- |
| Verified sending domains | **1**     | 10            |
| Monthly volume           | 3,000     | 50,000        |
| Daily cap                | 100       | —             |
| Cost                     | $0        | **$20/month** |

The shared account's single free-tier domain slot is **already consumed by
`rankedceo.com`**. So the two options are not equally priced, which was not obvious
before:

- **Option 1, dedicated ListrAssistr Resend account: $0.** It gets its own free
  tier and its own single domain slot, which `listrassistr.com` occupies.
- **Option 2, upgrade the shared account: $20/month**, ongoing.

Option 1 was already the better answer on the DEC-0027 precedent and on not
inheriting the CRM's sending reputation. It is now also the cheaper one, which
makes the recommendation fairly clear.

**Two honest caveats before treating $0 as settled:**

1. **Check Resend's terms on multiple free accounts.** A genuinely separate
   business product with separate infrastructure, billing, and reputation is a
   legitimate second account rather than an attempt to avoid a paid tier — but the
   terms are worth reading rather than assumed, and $20/month is not a large sum to
   pay for being unambiguously in the clear.
2. **The free tier's caps may not fit.** 3,000 emails/month and **100/day** is the
   real constraint, not the domain count. Transactional mail for a small user base
   fits easily; password resets plus notifications plus any digest or marketing
   send can reach 100/day faster than expected, and hitting a daily cap fails
   customer-visible mail. Worth sizing against expected volume before committing,
   because migrating sending domains later means re-verifying DNS and warming a new
   reputation.

Either way, this stays an owner decision — it is a provider account and a spend
commitment.

**Superseded 2026-08-26 — see F.5.** This was confirmed as "yes, a new dedicated
Resend account" earlier the same day, on $0-versus-$20 grounds. The owner then chose
to pursue **SES**, which carries auth mail without needing any Resend domain at all.
So no Resend account is required right now. The pricing analysis above stays on the
record for whenever `alerts@listrassistr.com` is wired in Phase 2.

### F.2 Is Resend the right provider at all? Lock-in is almost nil

Asked by the owner 2026-08-26. Resend is **not** an industry standard — it is the
modern developer-experience pick, and it is a layer **on top of Amazon SES**. The
long-standing incumbents are SendGrid, Mailgun, and SES itself.

**The switching cost is far lower than expected.** Verified by grep 2026-08-26:
Resend appears in **exactly one file** — `supabase/functions/cost-alert-cron/index.ts`,
one `fetch` to `api.resend.com/emails` at line 130, sending one internal admin alert
from `alerts@rankedceo.com` (line 143). No other sender exists anywhere in the
repository. So the provider is not a load-bearing architectural choice here; changing
it is roughly a ten-line edit.

| Option                 | Fits                                                                                                                                                                          | Against                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resend** (stay)      | Already wired; good DX for a solo operator; free tier covers current volume; SMTP available for Supabase Auth                                                                 | A reseller margin over SES; free tier caps at 3,000/month and 100/day                                                                                                      |
| **Amazon SES**         | **Same delivery infrastructure Resend resells**, at a fraction of the cost and no monthly fee. Already an AWS shop — Route 53 is here, so one vendor, one bill, one IAM story | Rawest DX: you handle bounce/complaint webhooks via SNS, your own suppression list, and you must request exit from the SES sandbox before sending to unverified recipients |
| **Postmark**           | Strongest transactional deliverability reputation; excellent logs                                                                                                             | Costs more; strict separation of transactional and marketing mail                                                                                                          |
| **SendGrid / Mailgun** | Long-established, huge scale                                                                                                                                                  | Shared-IP reputation on lower tiers is a known deliverability risk                                                                                                         |

**Recommendation as first written: stay with Resend for Phase 1** — already
integrated, good DX, free tier covers volume, and the one-file grep makes any later
switch cheap.

**Withdrawn 2026-08-26 — see F.5.** The "already integrated" argument does not
survive inspection: the single Resend call sends from `alerts@rankedceo.com`, a
different domain, so it carries no customer mail and appears nowhere in this zone's
records. Combined with the owner's preference for AWS and the fact that Supabase
Auth SMTP needs no code change, SES is the better fit. F.5 has the analysis.

Worth stating the honest alternative: consolidating on **SES** from the start is
defensible, given everything else is already AWS. The trade is DX and
bounce-handling work against per-email cost, and at 3,000 emails/month the cost
difference is negligible — so DX should win for now.

**Scope note:** changing provider touches `cost-alert-cron`, which is repository
code and therefore §9/Phase 2, **not** authorised by DEC-0035. Publishing a
provider's DNS records is §8.2 and is in scope. The reason the decision still
belongs in Phase 1 is that the DKIM/SPF records are provider-specific — choosing
later means republishing records and restarting DMARC alignment work.

### F.3 The customer-facing mail path is not Resend — verify Supabase Auth SMTP

This matters more than the provider question, and it was not previously captured.

Established by inspection 2026-08-26: `supabase/config.toml` contains **only**
`project_id` and `[functions.*]` `verify_jwt` blocks — there is **no `[auth]`
section and no SMTP configuration anywhere in the repository**, and Resend is called
only from `cost-alert-cron`. So nothing in this repo sends customer-facing mail.

That means **signup confirmations, password resets, and magic links are being sent
by whatever the live Supabase project's Auth settings specify** — a dashboard
setting this repository cannot see. Two possibilities:

- **Custom SMTP already configured** in the dashboard → fine, but it needs to be
  identified and included in the SPF/DKIM/DMARC record set.
- **Supabase's built-in mailer** (the default) → it sends from a Supabase-owned
  domain, so it is **not DMARC-aligned with `listrassistr.com`**, and it is
  explicitly rate-limited and not intended for production volume.

**Why this is an exit-gate issue.** P1-08 is "branded email authenticates —
Gmail/Outlook headers showing aligned SPF+DKIM+DMARC pass, `d=listrassistr.com`".
Auth email is the mail customers actually receive; the internal cost alert is not.
Fixing only `cost-alert-cron` would leave the gate unmet in the way that matters.

**Good news on scope:** Supabase Auth SMTP is a **project dashboard setting**, not
repository code, so configuring it sits inside §8.2 and is authorised under
DEC-0035.

- [ ] Check the live Supabase project → Authentication → SMTP settings. Record
      whether custom SMTP is set, and if so, which provider. Names only, never the
      credential.
- [ ] If it is the built-in mailer, point Auth at **SES SMTP** (F.5) so auth mail
      sends from `listrassistr.com` and can align for DMARC. This is a dashboard
      change, not a code change.
- [ ] Decide the `From` address for auth mail — plan §6.1's set does not name one;
      something like `no-reply@` or `accounts@` is conventional and should be added
      to the address list in A6/F.4.
- [ ] Do the same check for the **staging** project (`yqftpibxplachhwoclam`), so test
      signups do not send from an unaligned or production sender.

### F.4 Inbound role mailboxes — a free Gmail account cannot receive domain mail

Asked by the owner 2026-08-26 ("create a Gmail to be aliased as
@listrassistr.com"). The instinct is right but one mechanism does not exist, and it
is the crux:

**A free `@gmail.com` account cannot receive mail addressed to your domain.** There
is no way to point `listrassistr.com`'s MX records at a personal Gmail mailbox.
Gmail's "Send mail as" only affects the **From** address on outbound mail; it does
nothing for inbound. So something else must accept the mail first.

| Option                                                   | Cost                                                | Notes                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Workspace** (Business Starter)                  | ~$7/user/month                                      | Real mailboxes on the domain, with proper domain DKIM. **Crucially: one paid seat carries around 30 free aliases**, so a single mailbox can hold `support@`, `privacy@`, `legal@`, `security@`, and `alerts@`, all landing in one inbox with send-as for each. One human, one seat, five role addresses                                           |
| **Microsoft 365 Business Basic**                         | Similar                                             | Equivalent capability; shared mailboxes included with a license                                                                                                                                                                                                                                                                                   |
| **Forwarding service** — ImprovMX, Forward Email, Migadu | Free to a few $/month                               | Forwards role addresses to a personal Gmail. Cheapest path. **Weak spot is replies:** replying via free Gmail's "send mail as" typically routes through Google's infrastructure and can fail DMARC alignment or render as "via gmail.com" — unprofessional, and an alignment problem for §8.2. Doing it properly needs the forwarder's SMTP relay |
| **Zoho Mail**                                            | Free tier historically available for custom domains | Budget option; verify current terms, they have changed                                                                                                                                                                                                                                                                                            |
| **AWS-native**                                           | —                                                   | **Route 53 offers no email forwarding.** AWS inbound mail means SES receiving, which is region-limited and needs S3/Lambda or WorkMail. More work than four aliases justify                                                                                                                                                                       |
| Cloudflare Email Routing                                 | Free                                                | Frequently recommended, but **requires Cloudflare to be the DNS provider**. DNS is Route 53 here, so it is not available without moving DNS                                                                                                                                                                                                       |

**Recommendation: Google Workspace, one seat, role addresses as free aliases.** Two
reasons beyond convenience:

1. **`security@` and `privacy@` will receive consequential mail** — vulnerability
   reports, GDPR/CCPA data-subject requests, abuse notices. Silently losing one to a
   forwarder misconfiguration costs far more than the monthly seat.
2. **A clean reply path with real domain DKIM removes a DMARC alignment problem**
   rather than adding one.

**The interaction with Section D, which is the Phase 1 consequence.** Whichever is
chosen becomes a **second legitimate sender** alongside Resend. That means:

- Its **SPF include** must be merged into the single apex SPF TXT record, alongside
  SES's include — still exactly one `v=spf1` record, per Section D.
- Its **DKIM** must be published and passing.
- Both senders must show alignment before moving off `p=none` (D.2).

So the mailbox decision is part of the §8.2 record set, not a separate errand — and
it is on the critical path for P1-07, P1-08, and the DMARC clock.

### F.5 SES in practice — revises F.2's recommendation

Owner stated a preference for staying on AWS, 2026-08-26. On re-examination that
is better supported than F.2 allowed, because F.2's main argument for Resend —
"it is already wired" — turns out not to apply to the mail that matters.

**Why the existing integration is not an argument.** `cost-alert-cron/index.ts:143`
sends from `alerts@rankedceo.com`, per DEC-0024. A **different domain**. So the
existing Resend wiring:

- does not carry any customer-facing mail, and
- does not appear in `listrassistr.com`'s SPF or DKIM at all.

It is an internal admin alert on the CRM's domain. Keeping it has no bearing on
ListrAssistr's email identity, and moving it is a §9/Phase 2 code change either way.

**The decisive point: SES can carry auth mail with zero code change.** Supabase Auth
takes **SMTP credentials in the project dashboard** (F.3). SES exposes an SMTP
endpoint. So pointing customer-facing auth mail at SES is a dashboard configuration,
inside §8.2 and authorised by DEC-0035 — no repository change, no Phase 2 gate.

That produces a clean split:

| Mail                                     | Sender                    | Domain             | Scope                               |
| ---------------------------------------- | ------------------------- | ------------------ | ----------------------------------- |
| Auth: signup, password reset, magic link | **SES via Supabase SMTP** | `listrassistr.com` | §8.2, dashboard only                |
| Role mailboxes: `support@` etc.          | Mailbox provider (F.4)    | `listrassistr.com` | §8.2                                |
| Internal Gemini cost alert               | Resend, unchanged         | `rankedceo.com`    | §9 to move; irrelevant to this zone |

**Consequence: the Resend account decision in F.1 may be moot for now.** If SES
carries auth mail, no second Resend domain is needed, so neither the $0 dedicated
account nor the $20/month upgrade is required yet. F.1 stays on the record for
whenever `alerts@listrassistr.com` is wired up in Phase 2.

#### How much harder is SES, honestly

Five things Resend does for you that SES does not. Only two are real work at this
scale.

| Area                          | SES burden                                                                                   | Real impact here                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sandbox exit**              | One-time written request                                                                     | Minor, see below                                                                                                                                                                                                |
| **Observability**             | No send-log UI. CloudWatch metrics plus whatever you build                                   | **The one you will actually feel.** See below                                                                                                                                                                   |
| **Bounce/complaint handling** | You own it. AWS enforces roughly <5% bounce and <0.1% complaint or sending goes under review | Largely mitigated — SES has an **account-level suppression list** that handles bounces and complaints automatically. Much less work than the folklore suggests, and at current volume bounces will be near zero |
| **DKIM setup**                | Easy DKIM issues 3 CNAMEs                                                                    | **Easier than Resend here.** The zone is in the same AWS account, so SES can write its own DKIM records straight into Route 53 rather than you copying values across                                            |
| **Templating**                | Primitive versus React Email                                                                 | Irrelevant — Supabase Auth owns these templates                                                                                                                                                                 |

**Sandbox exit.** New SES accounts start restricted: you can only send to verified
addresses, on a low daily quota. Exit is a support case — "Request production
access" — and it is judged, not automatic. It is routine to get approved for
legitimate transactional mail, and turnaround is typically a day or two. What gets
approvals is a specific answer rather than a vague one:

- **Use case:** transactional only — account confirmation, password reset, magic
  link, sent to users who created their own account. No marketing, no purchased lists.
- **Bounce/complaint handling:** state that you use the SES account-level suppression
  list, and that you will monitor via CloudWatch and act on the reputation dashboard.
- **Unsubscribe:** note that transactional auth mail is not marketing, and that any
  future marketing mail would carry unsubscribe handling.
- **Volume:** give a real figure. Small honest numbers are fine and easier to approve
  than inflated ones.

Worth writing rather than improvising. Vague answers are the common reason for a
first refusal, and a refusal is recoverable — you reply with more detail.

**Observability is the real cost.** When a customer says "I never got the reset
email", Resend shows you a send log in a UI. SES gives you CloudWatch metrics and
nothing per-message unless you set it up. Mitigation, worth doing on day one rather
than during an incident:

- Create a **Configuration Set** and attach **event destinations** for send, delivery,
  bounce, and complaint.
- Point them at CloudWatch for metrics, and optionally SNS for anything you want to
  react to.
- Check the **reputation dashboard** occasionally — it is where a problem shows up
  before AWS emails you about it.

#### Recommendation, revised

**SES is a sound choice, and F.2's preference for Resend is withdrawn as applied to
this decision.** The reasons that tip it:

- Auth mail needs **no code change** — dashboard SMTP either way.
- DKIM is **less** work than Resend, because the hosted zone is in the same account.
- One vendor, one bill, one IAM story, consistent with A5/Section C already being AWS.
- No 100/day free-tier cliff; cost is roughly \$0.10 per thousand emails.
- Suppression is handled account-level, so the classic SES objection mostly does not
  apply at this volume.

The honest cost is **observability**, and it is a genuine ongoing difference rather
than a one-time hurdle. Setting up the configuration set and event destinations at
the start is what keeps it from biting.

#### Steps

- [ ] Pick an SES **region** and record it — SES is regional and the SMTP endpoint is
      region-specific. Keep it consistent with anything else regional.
- [ ] Verify `listrassistr.com` as a sending identity; use **Easy DKIM** and let SES
      publish the three CNAMEs into the Route 53 hosted zone directly.
- [ ] Publish the SPF include SES specifies for the apex — still **exactly one**
      `v=spf1` record, merged with the mailbox provider's include (Section D).
- [ ] Configure a **custom MAIL FROM** subdomain if strict DMARC alignment on the
      return-path is wanted (§8.2.4).
- [ ] Create a **Configuration Set** with event destinations before sending real mail.
- [ ] Generate **SMTP credentials** from IAM and enter them in Supabase → Auth → SMTP.
      Never record the credential here; note only that it is set.
- [ ] Set the auth `From` address — plan §6.1 names no such address; `no-reply@` or
      `accounts@` is conventional.
- [ ] **Request production access** (sandbox exit) using the answers above.
- [ ] Repeat the SMTP configuration for the **staging** project so test signups do not
      send through the production identity.

#### To verify before acting

Consistent with how the Vercel apex value was handled, these are version-sensitive
and should be confirmed against live AWS documentation rather than taken from here:

- Current sandbox limits — daily send quota and per-second rate.
- Current sandbox-exit request flow and expected turnaround.
- Whether the account-level suppression list is on by default, and its exact scope.
- Current per-email pricing and whether any free tier applies from EC2/Lambda origins.
- Whether SES can still write Easy DKIM records into a same-account Route 53 zone
  automatically.

### F.6 Deferred — SES setup, and what actually gates it

Owner decision 2026-08-26: **SES setup is deferred**, on the stated grounds that
upstream dependencies are not ready — LLC formation, a new Gmail account, email
aliasing, and possible Google Workspace setup.

Deferring is reasonable. But the dependency graph is not quite what it looks like,
and getting it right changes what has to wait for what.

#### It stays a Phase 1 item

To be precise about scope rather than quietly redefining it: email identity is
**§8.2**, which DEC-0035 explicitly authorised, and two §8 exit-gate items depend on
it — **P1-08** "branded email authenticates" and **P1-09** the DMARC report-review
period. So this is not work moving _out_ of Phase 1; it is work sequenced _later
within_ Phase 1.

The practical consequence: **Phase 1 cannot close until this is done.** That is fine
— §8.3 brand assets are also outstanding, so Phase 1 was never closing this week —
but it belongs on the record as a deliberate deferral rather than an omission. Moving
§8.2 out of Phase 1 would need its own owner decision, and that is not what has been
decided here.

#### What does not gate SES

Three of the four stated dependencies do not block it:

| Stated dependency      | Actually blocks SES?                                | Why                                                                                                               |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| New Gmail account      | **No**                                              | Independent. SES is _outbound_ sending; a Gmail account is _inbound_ mail. Neither needs the other to exist       |
| Email aliasing         | **No**                                              | Same reason — aliases are a receiving concern                                                                     |
| Google Workspace setup | **No**                                              | Independent of SES. They meet only in the SPF record and in DMARC alignment, and neither blocks the other's setup |
| LLC formation          | **Indirectly, via one narrow question** — see below | Not the LLC itself                                                                                                |

The two tracks touch only at the end: SES and the mailbox provider each need their
SPF include merged into the **single** apex SPF TXT record, and both must show
alignment before leaving `p=none`. Doing them close together saves one record edit.
That is a convenience, not a dependency.

#### The one thing that actually gates it, which was not on the list

**Will this AWS account remain the ListrAssistr AWS account?**

SES resources — domain verification, Easy DKIM, configuration sets, and critically
the **sandbox exit** — are **per-AWS-account**. So:

| Path                                                                                   | Effect on SES work                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Keep this AWS account**, updating its ownership and billing details to the LLC later | SES work **persists**. Safe to do now                                                                              |
| **Create a new AWS account** for the LLC and move the domain into it                   | SES verification, DKIM, config sets, and **a fresh sandbox-exit request** all have to be redone in the new account |

The sandbox exit is the part that makes redoing it genuinely annoying — it is a
judged support request with a turnaround, not a button.

**This is answerable without deciding anything about the LLC.** The question is not
"what entity structure" but the much narrower "does this AWS account stay, or does a
new one get created". That single answer unblocks SES:

- **Account stays** → SES can proceed whenever, independent of LLC timing, Gmail,
  aliases, or Workspace.
- **New account planned** → deferring SES is correct, and it should wait until that
  account exists. Note A.2a: the ICANN 60-day lock runs to roughly **2026-10-05**, so
  a domain move cannot complete before then anyway.

**Answered by the owner 2026-08-26: the same AWS account will be kept.**

So SES work **persists** and there is no risk of redoing verification, DKIM,
configuration sets, or the sandbox exit. **SES is unblocked**, independent of LLC
timing, Gmail, aliases, or Workspace. When the LLC exists, the account's ownership and
billing details are updated in place rather than a new account being created — which
also means A.2a's domain-move scenario may never arise.

One thing that still applies from A.2a: changing the Route 53 **registrant
organisation or name** re-triggers a fresh ICANN 60-day lock. That is a registrant-data
change, not an account change, so it is unaffected by this answer and remains a reason
to front-load the LLC paperwork rather than do it near a cutover.

Recorded as the actual blocker in Section H.

#### Genuinely unblocked right now, for whenever there is appetite

None of this depends on the LLC, the AWS account question, Gmail, aliases, or
Workspace:

- **DNSSEC** (§8.1.8, I.2). Zero dependencies, and I.1's blast-radius argument still
  favours doing it while only a coming-soon page sits behind the domain.
- **The `listrassister.com` error text** (A.1g), plus confirming the registrant
  contact is ICANN-verified — the latter is a standing risk to `listrassistr.com`
  itself, not just to a new registration.
- **The TSDR Office action** (A.1h). Informational, roughly ten minutes.
- **Placing the DEC-0036 and DEC-0037 drafts** into the decision log.
- **Publishing DMARC at `p=none`** — with one caveat below.

#### DMARC can be published early, but `rua` cannot point at a Gmail address

Worth flagging now because it interacts with the deferral, and it reliably catches
people out.

A DMARC `rua` address at a **different domain** from the one publishing the record
requires that other domain to publish an authorisation record — roughly
`listrassistr.com._report._dmarc.<their-domain> TXT "v=DMARC1"`. You cannot make
`gmail.com` publish that. So:

- `rua=mailto:someone@gmail.com` → **reports will not be delivered.**
- `rua=mailto:...@listrassistr.com` → works, but needs a mailbox, which is deferred.
- **A DMARC analyzer service** → works, and is built for exactly this: it issues an
  address on its own domain and handles the external-destination authorisation.

So the analyzer route allows DMARC to be published **before** any mailbox exists.
Value of publishing early at `p=none`: it is a single reversible TXT record, it starts
catching unauthorised senders immediately, and data begins accumulating the moment
SES or Workspace comes online rather than starting from zero at that point.

Recorded as available, not urged — the meaningful part of the 30-day window still
needs real senders live.

## Section G — Boundary

I can draft, specify, and verify-by-procedure. I cannot and will not: register or
purchase anything, log into or click through registrar/DNS/Vercel/Resend
dashboards, provide legal clearance or sign-off, or produce the §8.3 vector
artwork. Per the standing rules, every production/provider/DNS change needs the
owner's explicit approval first, and no secret values appear in this repository.

## Section H — Open decisions blocking finalization

Updated 2026-08-26. Groups 1 and 2 (domain, DNS) are answered; Groups 3+ (Vercel,
email, Supabase, brand) are not yet.

### Closed by owner answers 2026-08-26

- ~~Registrar and DNS provider~~ — **AWS Route 53** for both (A5, Section C).
- ~~Whether the domain is registered~~ — **yes, 2026-08-06** (Confirmed state).
- ~~Existing zone contents to preserve~~ — **none that conflict**; email is
  greenfield.

### Also closed by owner answers 2026-08-26

- ~~AWS root MFA state~~ — **on**. An earlier draft recorded it off in error.
- ~~WHOIS privacy state~~ — **on for all four contacts** (Registrant, Admin,
  Tech, Billing), all resolving to the owner as an individual.
- ~~Is the AWS account the business entity~~ — **no, it is individual**, and the
  entity does not exist yet. Answered, but it opens the decision below.

### Still open — Groups 1 and 2

1. ~~**The §8.1.1 entity gate**~~ — **decided 2026-08-26**: deviation accepted and
   recorded, LLC formation beginning (A.2). Remaining sub-task: place the draft
   DEC-0036 text into the decision log if it should be in the formal record.
2. ~~**What satisfies "legal has approved the name"**~~ — **decided 2026-08-26**:
   option 1, owner sign-off. The name `ListrAssistr` is approved (A.1a). Remaining
   sub-task: place the draft DEC-0037 text into the decision log.
3. **Whether the "drop the E's" tagline ships as written** (A.1c) — it is a good
   typo mnemonic but explicitly invokes a similar existing name, which cuts
   against the goods-and-services separation that is otherwise the strongest
   argument for coexistence.
4. ~~**Defensive registrations**~~ — **acted on 2026-08-26**: `listerassistr.com`
   acquired and configured; `listrassister.com` failed. Two follow-ups remain:
   **confirm `listerassistr.com` is a redirect, not a second serving domain**
   (A.1f), and capture the exact `listrassister.com` error text (A.1g).
5. **Read the LISTERASSISTER Office action in TSDR** (A.1c) — free, and it either
   flags descriptiveness risk for `LISTRASSISTR` itself or identifies a prior mark
   that matters more than the dead one.

### Still open — Groups 3+ (not yet discussed)

5. **Which Vercel project** serves the coming-soon page — the existing
   `tom-fenwicks-projects/listing-assistant-pro`, or a separate one? Blocks the
   `app`/`qa` record targets.
6. Whether `qa` maps to a Vercel Preview environment or its own project.
7. **Canonical host**: apex or `www`. Plan §6.1 implies apex.
8. **Inbound mailbox provider** for the role addresses (A6/F.4) — recommendation is
   Google Workspace with aliases; a free Gmail cannot receive domain mail.
9. **Which role-address set is authoritative** — §8.2.1's four including
   `security@`, or §6.1's four including `alerts@`, or all five.
10. ~~**Resend path**~~ — **confirmed 2026-08-26**: new dedicated Resend account
    ($0 versus $20/month). The provider itself was reviewed in F.2 and Resend is
    retained; lock-in is one file, so revisiting later is cheap.
11. **Supabase Auth SMTP** (F.3) — verify whether custom SMTP is configured on the
    live and staging projects. If it is the built-in mailer, customer-facing auth
    mail is not aligned with the domain and P1-08 cannot be met.
    (Section F).
12. **DMARC `rua` analyzer** destination address.
13. Whether the "Join the preview" form on the coming-soon page **sends email
    today**, and where "Sign in" points — both bear on §8.2 and on whether any
    sender already needs DMARC alignment.
14. **Which Supabase project the owner considers current**, and confirmation of
    the four unverified facts about `yqftpibxplachhwoclam`.

## Accepted risks carried into Phase 1

DEC-0035 names these explicitly as carried forward and **not reopened by that
approval**. Recorded here as-is, for reference only.

- **RBR-0004** — no migration approval gate on `deploy-functions.yml`. Accepted,
  and reaffirmed 2026-08-25 per RBR-0034; mitigated by DEC-0014's fail-closed SQL
  guards instead of a gate.
- **RBR-0003** — the staging-environment prerequisite. DEC-0035 labels this "no
  staging Supabase project yet — tracked as a Phase 1 prerequisite, worth
  addressing early in Phase 1 rather than deferring further." **Label
  discrepancy worth fixing in the source docs:** RBR-0003's own row in
  `REBRAND_PHASE_0_EXCEPTION_LOG.md` is "Function config has broad
  `verify_jwt = false` entries" (partially resolved, PR #462), which is a
  different finding. The staging requirement itself traces to **DEC-0005**
  (separate staging/production environments and credentials) and **DEC-0004**
  (ListrAssistr-only Supabase project). Anyone chasing "the staging prerequisite"
  via RBR-0003 will land on the wrong row.
- **RBR-0030** — Gemini cost-alert threshold inert at current spend (hardcoded
  50 USD/month against roughly 1.72 USD month-to-date).
- **RBR-0032** — Sentry gap; DEC-0025 directs building real error tracking in the
  ListrAssistr project rather than porting the existing no-op stub.
- **RBR-0036** — eBay Developer API call-volume re-check, deferred to a later
  phase. The 2026-08-17 measurement (50 of 5,000 daily calls) predates
  `competitor-prices-cron`'s current `*/5 * * * *` cadence, so it is stale rather
  than wrong. No due date.
- **P0-08 remaining storage-migration-path workstream** — roughly 190 objects,
  recorded as non-urgent.

### On the staging prerequisite

DEC-0035 puts this inside Phase 1 rather than deferring it, and a staging Supabase
project is provider-dashboard work, not repository code, so it sits inside the
approved scope even though plan §8's own text does not mention it.

It is genuinely independent of everything else in this document — no DNS record,
domain, or brand asset depends on it — so it parallelizes cleanly rather than
blocking.

**It is probably a verify task, not a create task.**
`REBRAND_PHASE_0_SERVICE_INVENTORY.md:22` and line 76 record staging project
`yqftpibxplachhwoclam`, owner-reported 2026-08-10, with Supabase Auth Site URL
already set to `https://listrassistr.com` and a callback at
`https://listrassistr.com/auth/callback`. That timing is coherent with the domain
having been registered 2026-08-06. Its inventory row still carries the unmet
verification note "Confirm owner, region, empty status, and project URL", and the
surrounding text warns the apex arrangement is "an initial staging arrangement,
not approval to connect production data or legacy credentials."

So the four open items are the ones its own row already names:

- [ ] Confirm the project **owner** — is it the shared CRM admin login, or separate?
- [ ] Confirm **region**.
- [ ] Confirm it is still **empty** — no production data has reached it.
- [ ] Confirm the **project URL**, and whether the Auth Site URL is still pointed
      at `https://listrassistr.com`.

Two further notes for when it is picked up:

- It needs its own decision record and its own slot; it should not be folded under
  the §8.1/§8.2 banner or treated as satisfied by this checklist.
- Per DEC-0021, the Supabase legacy-JWT-to-`sb_*`-key migration is deferred until
  the product is running in its ListrAssistr state, so this project should end up
  consistent with whichever key format the migration target will use. Since it
  already exists, that becomes a "check which format it is on" question rather
  than a choice made at creation time.

## Section I — Critical path and sequencing

DNS and email verification run on their own clocks; the trademark research and
brand production run on yours. These are the dependencies that actually matter,
so the slow clocks start first.

Revised 2026-08-26 now that registration, delegation, and the apex/`www` records
are already done. Steps 1–4 of the original ordering are complete; what remains
reorders around two facts: **DNSSEC is safer to do now than later**, and the
**DMARC review period is the longest fixed wait**, so it should start early.

| Order | Item                                                                        | Gated on                                | Clock                                                                                                                                           |
| ----- | --------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| —     | ~~Register domain; delegate DNS; apex + `www` records~~                     | —                                       | **Done** 2026-08-06 to 2026-08-26                                                                                                               |
| —     | ~~Registrar hardening: transfer lock, auto-renew, root MFA, WHOIS privacy~~ | —                                       | **Done** — confirmed 2026-08-26 (Section B)                                                                                                     |
| 1     | **Trademark clearance search** (A.1a–A.1c)                                  | Nothing                                 | Hours if owner-run, days to weeks via counsel. The only item that can invalidate the name, so everything in §8.3 stays at risk until it is done |
| 2     | **Entity decision** (A.2) — form now, or record the §8.1.1 deviation        | Nothing                                 | Your decision; needs a DEC entry either way. Resurfaces at Stripe onboarding regardless                                                         |
| 3     | Confirm daily AWS work is not done as root; note MFA on the IAM principal   | Nothing                                 | Your check, minutes                                                                                                                             |
| 4     | **Enable DNSSEC, verify DS chain** (§8.1.8)                                 | Nothing                                 | Hours plus AWS-mandated TTL waits. **Do it now, not after cutover** — see I.1                                                                   |
| 5     | Resend account decision (Section F), then publish DKIM/SPF                  | Nothing                                 | Your decision, then minutes to publish                                                                                                          |
| 6     | **Publish DMARC at `p=none` with `rua`**                                    | 5                                       | Immediate — and it starts the step-9 clock, so do not let it wait on anything else                                                              |
| 7     | Create `app` and `qa` records at TTL 300; certs issue                       | Vercel project identity (Group 3, open) | Minutes to hours                                                                                                                                |
| 8     | Mailbox provider (A6) + MX; role mailboxes live                             | Group 4 decisions                       | Provider-dependent                                                                                                                              |
| 9     | Deliverability tests to Gmail/Outlook/analyzer (§8.2.5, E.1)                | 5, 6, 8                                 | Immediate, but feeds 10                                                                                                                         |
| 10    | **DMARC report-review period** before tightening (§8.2.3, D.2)              | 6, 9                                    | **2-4 weeks minimum, 30 days realistic.** Longest fixed wait in Phase 1; gated only on item 5                                                   |
| 11    | CAA record                                                                  | 7                                       | After certs issue, never before                                                                                                                 |
| 12    | §8.3 brand asset production                                                 | 2 (name cleared)                        | Your creative timeline                                                                                                                          |
| 13    | Post-stabilization TTL raise (D.1)                                          | Cutover                                 | Post-cutover, not Phase 1                                                                                                                       |

Items 1, 2, 3, 5, and 6 are all unblocked right now and independent of each other.
Starting 6 early is worth more than it looks, because it is what starts the only
multi-week clock in the phase.

### I.1 Why DNSSEC should happen now

A botched DS record makes the domain resolve **nowhere** for validating resolvers —
not degraded, absent. That is the main hazard in §8.1.8 and the reason it is easy
to keep postponing.

The blast radius is the argument for doing it immediately:

- **Today**, the only thing behind `listrassistr.com` is a coming-soon page. A
  broken chain is an embarrassment.
- **After cutover**, it is the live application with paying customers on it. The
  same mistake is an outage.

Route 53 also enforces waiting periods tied to TTL expiry between enablement
steps, so this is not an operation to attempt under cutover time pressure. Doing
it now, verifying externally via `dnsviz.net`, and leaving it verified for weeks
before anything depends on it is strictly better than doing it late.

No blocking dependency — root MFA is already on, so the account holding the zone's
future cryptographic trust anchor is already protected.

### I.2 DNSSEC on Route 53 — the DS step is manual

Confirmed 2026-08-26, and it removes the simplification C.1 had hoped for:
**Route 53 does not publish the DS record to the parent zone automatically, even
though the domain is also registered at Route 53.** The KSK/ZSK are generated in
the hosted zone; the DS must then be entered by hand in Registered domains.

That makes this a two-system operation with a hand-copied cryptographic value in
the middle, which is exactly where it goes wrong.

**Enable, in order:**

- [ ] Confirm current TTLs are low before starting. Apex and `www` are already at
      300, which is what AWS recommends for this operation.
- [ ] Route 53 → hosted zone `listrassistr.com` → **DNSSEC signing** tab → enable
      signing. This creates a KSK (backed by a KMS key) and a ZSK.
- [ ] Copy the **Key tag**, **Signing algorithm**, **Digest algorithm**, and
      **Digest** exactly as shown.
- [ ] Route 53 → **Domains → Registered domains** → `listrassistr.com` → add the
      **DS record** using those four values.
- [ ] **Verify externally before trusting it** — `dnsviz.net` for the full chain,
      not the local machine (its DNS is filtered and its TLS is intercepted; see
      the workstation section above). The chain must validate from the `.com`
      parent down.
- [ ] Only after external validation shows a complete chain, treat P1-05 as met.

**Rollback, and the order matters more than anything else on this page:**

1. Delete the **DS record at the registrar** first.
2. **Wait for the parent DS TTL to expire.** This TTL is set by the `.com`
   registry, not by you, so it cannot be shortened in advance — check what TTL the
   published DS actually carries and wait past it.
3. **Only then** disable DNSSEC signing in the hosted zone.

Doing that sequence in the wrong order — disabling signing while the parent still
publishes a DS — leaves validating resolvers holding a DS for a zone that no longer
signs. They will treat every answer as bogus, and **the domain resolves nowhere**.
Not slow, not degraded: absent. This is the failure mode that makes I.1's
blast-radius argument worth acting on, since a coming-soon page is a far cheaper
place to learn this than a live application.

## Section J — Plan §8 exit-gate tracking

Plan §8's stated exit gate: "Domain ownership is secure, legal has approved the
name, branded email can authenticate, and the asset package is approved."

Mirrors the Phase 0 closure-checklist format so Phase 1 can be closed on evidence
rather than recollection. Statuses: `Not started`, `In progress`,
`Evidence captured`, `Reviewed`, `Approved`, `Blocked`.

| ID    | Exit-gate requirement                                               | Evidence needed                                                                               | Status                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 | Domain registered in the legal business entity (deviation accepted) | Registrar account owner, registration date, entity name; recorded DEC entry for the deviation | **Approved with recorded deviation (2026-08-26)** — registered 2026-08-06 via Route 53 in the owner's individual account. §8.1.1 knowingly unmet; owner accepted option B in A.2 and is beginning LLC formation. Draft DEC text in A.2                                                                                                         |
| P1-02 | Registrar hardened                                                  | Section B checklist complete; MFA method; privacy state                                       | **Evidence captured** — transfer lock, auto-renew, recovery contacts, expiry alerts, root MFA, and WHOIS privacy on all four contacts, all confirmed 2026-08-26. Remaining: service-inventory write-up, root-vs-IAM check, CAA (sequenced late)                                                                                                |
| P1-03 | Legal approval of the stylized spelling                             | Recorded DEC entry per §8.1.3                                                                 | **Approved (2026-08-26)** — owner approved the name `ListrAssistr` under A.1a option 1, owner sign-off rather than counsel clearance. Draft DEC-0037 text in A.1a records the basis and its stated limitations. Satisfies the "legal has approved the name" half of the §8 exit gate                                                           |
| P1-04 | Authoritative DNS documented                                        | Provider, account owner, recovery path, added to the service inventory                        | **In progress** — provider confirmed (Route 53, verified via NS). Service-inventory entry not yet written                                                                                                                                                                                                                                      |
| P1-05 | DNSSEC enabled and DS chain verified                                | External validator output (Section E)                                                         | **Evidence captured (2026-08-27)** — KSK `listrassistr_ksk_1`, alg 13, DS keytag 10716 live at the `.com` parent, digest matching one computed independently before submission. Chain confirmed by `dnsviz.net` root→com→listrassistr.com with no errors or warnings, and validation proved by control test against `dnssec-failed.org` (A.12) |
| P1-06 | Vercel apex/`www`/`app`/`qa` resolving, certs issued                | External resolver output; cert status                                                         | **In progress** — apex and `www` live and verified. `app` and `qa` absent. Vercel project identity open (Group 3)                                                                                                                                                                                                                              |
| P1-07 | Role mailboxes receiving                                            | Inbound test result for every address                                                         | **Deferred (owner, 2026-08-26)** — no MX present. Mailbox provider decision not started (F.4/F.6). Address set also unresolved: §8.2.1 vs §6.1                                                                                                                                                                                                 |
| P1-08 | Branded email authenticates                                         | Gmail/Outlook headers showing aligned SPF+DKIM+DMARC pass, `d=listrassistr.com`               | **Deferred (owner, 2026-08-26)** — no SPF, DKIM, or DMARC records present. Blocked on the AWS-account question in F.6, not on the LLC. Note F.3: the mail that must pass here is Supabase Auth mail, not the internal cost alert                                                                                                               |
| P1-09 | DMARC report-review period completed                                | Analyzer reports covering every legitimate sender, over 2-4 weeks minimum                     | **Deferred (owner, 2026-08-26)** — 30-day target per D.2, clock not begun. The `p=none` record itself can be published early via an analyzer `rua` (F.6); the meaningful window still needs live senders                                                                                                                                       |
| P1-10 | Brand asset package produced                                        | Full §8.3 deliverable list                                                                    | **Not started**                                                                                                                                                                                                                                                                                                                                |
| P1-11 | Design tokens pass WCAG AA                                          | Measured contrast ratios; confirmation red is never the sole state indicator                  | **Not started**                                                                                                                                                                                                                                                                                                                                |
| P1-12 | Asset package approved                                              | Owner sign-off, recorded as a DEC entry                                                       | **Not started**                                                                                                                                                                                                                                                                                                                                |
| P1-13 | Phase 2 entry decision                                              | Explicit go/no-go for plan §9, which DEC-0035 does **not** grant                              | **Not started**                                                                                                                                                                                                                                                                                                                                |

Not part of §8's exit gate, tracked so it is not lost: the **staging-project
prerequisite** DEC-0035 places inside Phase 1. Now believed to be a _verify_ task —
`yqftpibxplachhwoclam` already exists per the service inventory. See "On the
staging prerequisite" above.
