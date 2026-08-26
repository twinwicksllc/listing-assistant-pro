# Rebrand Phase 1 — Domain, DNS, and Email Record Checklist (Plan §8.1, §8.2)

**Product:** ListrAssistr
**Repository:** `twinwicksllc/listing-assistant-pro` (legacy; stays live per DEC-0003)
**Scope:** Detailed checklists cover `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`
§8.1 and the DNS-resident parts of §8.2. Section J tracks the full §8 exit gate,
including §8.3 brand assets, so Phase 1 can be closed on evidence. Repository code
changes are §9/Phase 2 and out of scope here per DEC-0035.
**Owner:** User (all registrar, DNS, Vercel, Resend, and legal actions)
**AI role:** Drafting, record shapes, verification procedure. No provider action.

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

| Record                 | Type  | Value                                 | TTL    | State                                                                                                                                                      |
| ---------------------- | ----- | ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listrassistr.com`     | A     | `216.150.1.1`                         | 300    | Live — Vercel apex. **Leave as-is**; confirm against the Vercel dashboard for this project, not against documentation. See the external-verification table |
| `www.listrassistr.com` | CNAME | `2f1e3f86cb32a6a8.vercel-dns-016.com` | 300    | Live                                                                                                                                                       |
| `listrassistr.com`     | NS    | 4× `awsdns-*`                         | 172800 | Route 53 default, correct                                                                                                                                  |
| `listrassistr.com`     | SOA   | `ns-1068.awsdns-05.org`               | 900    | Route 53 default                                                                                                                                           |
| `app`                  | —     | —                                     | —      | **Absent** — required by §8.1.6                                                                                                                            |
| `qa`                   | —     | —                                     | —      | **Absent** — required by §8.1.6                                                                                                                            |
| TXT / SPF              | —     | —                                     | —      | **Absent**                                                                                                                                                 |
| MX                     | —     | —                                     | —      | **Absent**                                                                                                                                                 |
| `_dmarc`               | —     | —                                     | —      | **Absent**                                                                                                                                                 |
| DNSKEY / DS            | —     | —                                     | —      | **Absent** — DNSSEC not enabled                                                                                                                            |
| CAA                    | —     | —                                     | —      | **Absent**                                                                                                                                                 |

Two consequences worth stating plainly:

- **Email is entirely greenfield.** No MX, SPF, DKIM, DMARC, or CAA records exist,
  so nothing in §8.2 risks colliding with existing mail. This is the easy case.
- **The apex and `www` are already correct and already at TTL 300**, so §8.1.7's
  pre-cutover TTL drop is already satisfied. See D.1.

### Source-document corrections this surfaced

Recorded, not silently reconciled — correcting the source documents is the owner's
call.

| Document                                                    | Says                                                                                                 | Actually                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0033 (2026-08-19)     | "none of Phases 1–6 have started (domain not yet registered)"                                        | The domain was registered **2026-08-06**, 13 days before DEC-0033 was written. The broader point (no cutover date can be committed yet) still stands                                                                                                                                                                           |
| `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0035                  | Labels RBR-0003 as "no staging Supabase project yet"                                                 | RBR-0003's own row is "Function config has broad `verify_jwt = false` entries". The staging requirement traces to DEC-0005/DEC-0004                                                                                                                                                                                            |
| DEC-0035, same clause                                       | "no staging Supabase project yet"                                                                    | `REBRAND_PHASE_0_SERVICE_INVENTORY.md:22` records staging project `yqftpibxplachhwoclam`, owner-reported 2026-08-10, with Auth Site URL already set to `https://listrassistr.com`. Its row still says "Confirm owner, region, empty status, and project URL" — so the prerequisite is a **verify** task, not a **create** task |
| `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §8.2.1 vs §6.1 | §8.2.1 lists `support`/`privacy`/`legal`/`security`; §6.1 lists `support`/`privacy`/`legal`/`alerts` | Five distinct addresses across the two lists. Which set is authoritative is an open question (Group 4)                                                                                                                                                                                                                         |

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

| Host / name                                  | Type      | Value                                                                     | TTL at setup | Source of truth  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------- | ------------------------------------------------------------------------- | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@` (apex)                                   | A         | `216.150.1.1` — **live**                                                  | 300          | Vercel           | Already configured and serving. **Verify against Vercel's current recommended apex value** before treating as final; also check whether Vercel now prefers a Route 53 ALIAS at the apex                                                                                                                                                                                                                                                                                                                            |
| `www`                                        | CNAME     | `2f1e3f86cb32a6a8.vercel-dns-016.com` — **live**                          | 300          | Vercel           | Already configured. Canonical-host decision (apex vs `www`) still open — plan §6.1 implies apex = marketing, so apex-canonical with `www` redirecting                                                                                                                                                                                                                                                                                                                                                              |
| `app`                                        | CNAME     | `<target shown by Vercel>` — **absent, required**                         | 300          | Vercel           | Plan §8.1.6. The primary application hostname per plan §6.1                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `qa`                                         | CNAME     | `<target shown by Vercel>` — **absent, required**                         | 300          | Vercel           | Plan §8.1.6; maps to the Vercel Preview/QA environment                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `_vercel`                                    | TXT       | `<verification token from Vercel>`                                        | 3600         | Vercel           | Not currently present and apparently not needed — the apex already resolves and serves. Add only if Vercel asks when `app`/`qa` are attached                                                                                                                                                                                                                                                                                                                                                                       |
| `<selector>._domainkey`                      | TXT       | `<issued by Resend>`                                                      | 3600         | Resend           | Confirmed 2026-08-26 as a **TXT** record, not a CNAME. Publish exactly what the Resend dashboard issues, including the selector subdomain — do not template it                                                                                                                                                                                                                                                                                                                                                     |
| `send` (or Resend's stated return-path host) | TXT / MX  | `<issued by Resend>`                                                      | 3600         | Resend           | Custom return-path / MAIL FROM alignment, plan §8.2.4                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@` (apex)                                   | TXT (SPF) | `v=spf1 include:<resend-issued-include> ~all`                             | 3600         | Hand-built       | **Exactly one SPF TXT record per name.** Two SPF records is a permanent hard failure. Merge all senders into one string. Stay within the 10-DNS-lookup limit. Start `~all` (softfail), not `-all`                                                                                                                                                                                                                                                                                                                  |
| `_dmarc`                                     | TXT       | `v=DMARC1; p=none; rua=mailto:<analyzer>; fo=1; adkim=r; aspf=r; pct=100` | 3600         | Hand-built       | Plan §8.2.3 mandates `p=none` **and a report-review period** before tightening. Start relaxed alignment (`r`) to avoid false failures during setup; tighten to `s` alongside the move to quarantine                                                                                                                                                                                                                                                                                                                |
| `@` and/or mail host                         | MX        | `<issued by the A6 mailbox provider>`                                     | 3600         | Mailbox provider | Required for inbound `support`/`privacy`/`legal`/`security@`. Resend does not receive mail                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@`                                          | CAA       | `0 issue "<CA confirmed from the live cert>"`                             | 3600         | Hand-built       | **Add only after certificates have issued, and only once the real issuing CA is confirmed.** Documentation says Vercel uses Let's Encrypt and auto-creates this record — but no CAA exists in this zone, because Vercel can only manage CAA when Vercel manages the DNS. The issuing CA **cannot be read from the owner's workstation** (Zscaler TLS interception returns a corporate certificate); confirm externally via SSL Labs or a personal device first. A wrong value silently blocks issuance and renewal |

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

**Confirmed 2026-08-26: yes, a new dedicated Resend account is the recommendation.**
$0 versus $20/month, consistent with DEC-0027, and a sending reputation independent
of the CRM's.

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

**Recommendation: stay with Resend for Phase 1.** It is already integrated, the DX
is worth real time on a solo project, and the free tier covers current volume. The
grep result is what makes this low-stakes — if cost or volume ever argues for SES,
that switch is cheap and can happen whenever.

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
- [ ] If it is the built-in mailer, point Auth at the new Resend account's SMTP so
      auth mail sends from `listrassistr.com` and can align for DMARC.
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

- Its **SPF include** must be merged into the single apex SPF TXT record — still
  exactly one `v=spf1` record, per Section D.
- Its **DKIM** must be published and passing.
- Both senders must show alignment before moving off `p=none` (D.2).

So the mailbox decision is part of the §8.2 record set, not a separate errand — and
it is on the critical path for P1-07, P1-08, and the DMARC clock.

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

| ID    | Exit-gate requirement                                               | Evidence needed                                                                               | Status                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-01 | Domain registered in the legal business entity (deviation accepted) | Registrar account owner, registration date, entity name; recorded DEC entry for the deviation | **Approved with recorded deviation (2026-08-26)** — registered 2026-08-06 via Route 53 in the owner's individual account. §8.1.1 knowingly unmet; owner accepted option B in A.2 and is beginning LLC formation. Draft DEC text in A.2                                               |
| P1-02 | Registrar hardened                                                  | Section B checklist complete; MFA method; privacy state                                       | **Evidence captured** — transfer lock, auto-renew, recovery contacts, expiry alerts, root MFA, and WHOIS privacy on all four contacts, all confirmed 2026-08-26. Remaining: service-inventory write-up, root-vs-IAM check, CAA (sequenced late)                                      |
| P1-03 | Legal approval of the stylized spelling                             | Recorded DEC entry per §8.1.3                                                                 | **Approved (2026-08-26)** — owner approved the name `ListrAssistr` under A.1a option 1, owner sign-off rather than counsel clearance. Draft DEC-0037 text in A.1a records the basis and its stated limitations. Satisfies the "legal has approved the name" half of the §8 exit gate |
| P1-04 | Authoritative DNS documented                                        | Provider, account owner, recovery path, added to the service inventory                        | **In progress** — provider confirmed (Route 53, verified via NS). Service-inventory entry not yet written                                                                                                                                                                            |
| P1-05 | DNSSEC enabled and DS chain verified                                | External validator output (Section E)                                                         | **Not started** — no DNSKEY or DS present, confirmed 2026-08-26. Sequenced early per I.1                                                                                                                                                                                             |
| P1-06 | Vercel apex/`www`/`app`/`qa` resolving, certs issued                | External resolver output; cert status                                                         | **In progress** — apex and `www` live and verified. `app` and `qa` absent. Vercel project identity open (Group 3)                                                                                                                                                                    |
| P1-07 | Role mailboxes receiving                                            | Inbound test result for every address                                                         | **Not started** — no MX present. Address set itself unresolved (four vs five, §8.2.1 vs §6.1)                                                                                                                                                                                        |
| P1-08 | Branded email authenticates                                         | Gmail/Outlook headers showing aligned SPF+DKIM+DMARC pass, `d=listrassistr.com`               | **Not started** — no SPF, DKIM, or DMARC records present. Note F.3: the mail that must pass here is Supabase **Auth** mail, not the internal cost alert; verify the Auth SMTP setting                                                                                                |
| P1-09 | DMARC report-review period completed                                | Analyzer reports covering every legitimate sender, over 2-4 weeks minimum                     | **Not started** — 30-day target per D.2; longest fixed wait in the phase, clock not begun                                                                                                                                                                                            |
| P1-10 | Brand asset package produced                                        | Full §8.3 deliverable list                                                                    | **Not started**                                                                                                                                                                                                                                                                      |
| P1-11 | Design tokens pass WCAG AA                                          | Measured contrast ratios; confirmation red is never the sole state indicator                  | **Not started**                                                                                                                                                                                                                                                                      |
| P1-12 | Asset package approved                                              | Owner sign-off, recorded as a DEC entry                                                       | **Not started**                                                                                                                                                                                                                                                                      |
| P1-13 | Phase 2 entry decision                                              | Explicit go/no-go for plan §9, which DEC-0035 does **not** grant                              | **Not started**                                                                                                                                                                                                                                                                      |

Not part of §8's exit gate, tracked so it is not lost: the **staging-project
prerequisite** DEC-0035 places inside Phase 1. Now believed to be a _verify_ task —
`yqftpibxplachhwoclam` already exists per the service inventory. See "On the
staging prerequisite" above.
