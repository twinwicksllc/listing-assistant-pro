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

| Fact                | Value                                                               | How confirmed                           |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| Domain              | `listrassistr.com` — **registered and live**                        | Owner + resolver query                  |
| Registrar           | **AWS Route 53 Domains**                                            | Owner                                   |
| Registration date   | **2026-08-06**                                                      | Owner                                   |
| Expiry              | **2027-08-06**, auto-renew on                                       | Owner                                   |
| Authoritative DNS   | **AWS Route 53** public hosted zone                                 | Owner + `NS` records are all `awsdns-*` |
| Currently serving   | A branded "Coming Soon" page at the apex                            | Owner screenshot                        |
| Other domains owned | `teckstart.com`, `twin-wicks.com` — separate projects, out of scope | Owner                                   |

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

| #   | Item                                                          | Disposition as of 2026-08-26                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Register under the **legal business entity**                  | **Cannot currently be satisfied — see A.2.** The AWS account and all four Route 53 contacts are the owner **as an individual**. Twin Wicks Digital Solutions is **not yet a registered entity**, deferred for the same reason as the trademark filing. Plan §8.1.1 requires a legal business account, so this gate is blocked on a decision, not on an action |
| A2  | Registrant/recovery email must **not** be `@listrassistr.com` | **Satisfied.** Recovery contacts are the owner plus `twinwicksllc@gmail.com` — both outside the new zone, so the circular-dependency failure mode is avoided                                                                                                                                                                                                  |
| A3  | Trademark and naming-conflict research (A.1 below)            | **Split — see A.1.** Owner defers _filing_; the _clearance search_ is still a §8.1.3 gate requirement and is unstarted                                                                                                                                                                                                                                        |
| A4  | Defensive registrations                                       | **Open, low urgency.** No variants owned. `listerassister` (with the letter e's) is taken by an unrelated realtor site and unavailable. Different market and Nice class, so low confusion risk, but it does mean that particular typo cannot be defensively held                                                                                              |
| A5  | Authoritative DNS provider                                    | **Settled: AWS Route 53.** Registrar and DNS are the same provider and the same AWS account. See Section C for the consequence                                                                                                                                                                                                                                |
| A6  | **Inbound** mailbox provider for role addresses               | **Open (Group 4, not yet answered).** Plan §8.2.1 needs `support`/`privacy`/`legal`/`security@`; §6.1 also names `alerts@`. Resend is **send-only** and does not receive mail, so this is a separate provider decision (Google Workspace, Microsoft 365, Fastmail, or registrar-level forwarding) that adds MX records to the zone                            |

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

**The single most important thing to establish first:** does the operator of
`listerassister.com` hold a **registered trademark**, and if so, in which class
and covering what services? Everything else follows from that answer. A domain
alone confers far weaker rights than a registration. Search their name and mark in
`tmsearch.uspto.gov` before spending effort anywhere else.

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

1. **The §8.1.1 entity gate** (A.2) — form the entity now, record the deviation
   with a revisit trigger, or rewrite the gate. Needs a DEC entry either way.
2. **What satisfies "legal has approved the name"** — owner-run search plus a
   recorded DEC entry, or counsel-run clearance (A.1a, P1-03).
3. **Whether the "drop the E's" tagline ships as written** (A.1c) — it is a good
   typo mnemonic but explicitly invokes a similar existing name, which cuts
   against the goods-and-services separation that is otherwise the strongest
   argument for coexistence.
4. **Defensive registrations** — any additional TLDs worth taking (A4). Low
   urgency; `listerassister.com` is unavailable regardless.

### Still open — Groups 3+ (not yet discussed)

5. **Which Vercel project** serves the coming-soon page — the existing
   `tom-fenwicks-projects/listing-assistant-pro`, or a separate one? Blocks the
   `app`/`qa` record targets.
6. Whether `qa` maps to a Vercel Preview environment or its own project.
7. **Canonical host**: apex or `www`. Plan §6.1 implies apex.
8. **Inbound mailbox provider** for the role addresses (A6).
9. **Which role-address set is authoritative** — §8.2.1's four including
   `security@`, or §6.1's four including `alerts@`, or all five.
10. **Resend path**: dedicated ListrAssistr account or shared-account upgrade
    (Section F).
11. **DMARC `rua` analyzer** destination address.
12. Whether the "Join the preview" form on the coming-soon page **sends email
    today**, and where "Sign in" points — both bear on §8.2 and on whether any
    sender already needs DMARC alignment.
13. **Which Supabase project the owner considers current**, and confirmation of
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

| ID    | Exit-gate requirement                                | Evidence needed                                                                 | Status                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01 | Domain registered in the legal business entity       | Registrar account owner, registration date, entity name                         | **Blocked on a decision** — registered 2026-08-06 via Route 53, but the AWS account and all four contacts are the owner as an **individual**, and Twin Wicks Digital Solutions is not a registered entity. §8.1.1 is unsatisfiable as written; see A.2 for the three options |
| P1-02 | Registrar hardened                                   | Section B checklist complete; MFA method; privacy state                         | **Evidence captured** — transfer lock, auto-renew, recovery contacts, expiry alerts, root MFA, and WHOIS privacy on all four contacts, all confirmed 2026-08-26. Remaining: service-inventory write-up, root-vs-IAM check, CAA (sequenced late)                              |
| P1-03 | Legal approval of the stylized spelling              | Recorded DEC entry per §8.1.3 with A.1b/A.1c search results                     | **Not started** — owner defers filing; clearance search still required. Gate wording pending the A.1a decision. A.1c flags the `listerassister.com` phonetic-similarity question as the priority item                                                                        |
| P1-04 | Authoritative DNS documented                         | Provider, account owner, recovery path, added to the service inventory          | **In progress** — provider confirmed (Route 53, verified via NS). Service-inventory entry not yet written                                                                                                                                                                    |
| P1-05 | DNSSEC enabled and DS chain verified                 | External validator output (Section E)                                           | **Not started** — no DNSKEY or DS present, confirmed 2026-08-26. Sequenced early per I.1                                                                                                                                                                                     |
| P1-06 | Vercel apex/`www`/`app`/`qa` resolving, certs issued | External resolver output; cert status                                           | **In progress** — apex and `www` live and verified. `app` and `qa` absent. Vercel project identity open (Group 3)                                                                                                                                                            |
| P1-07 | Role mailboxes receiving                             | Inbound test result for every address                                           | **Not started** — no MX present. Address set itself unresolved (four vs five, §8.2.1 vs §6.1)                                                                                                                                                                                |
| P1-08 | Branded email authenticates                          | Gmail/Outlook headers showing aligned SPF+DKIM+DMARC pass, `d=listrassistr.com` | **Not started** — no SPF, DKIM, or DMARC records present                                                                                                                                                                                                                     |
| P1-09 | DMARC report-review period completed                 | Analyzer reports covering every legitimate sender, over 2-4 weeks minimum       | **Not started** — 30-day target per D.2; longest fixed wait in the phase, clock not begun                                                                                                                                                                                    |
| P1-10 | Brand asset package produced                         | Full §8.3 deliverable list                                                      | **Not started**                                                                                                                                                                                                                                                              |
| P1-11 | Design tokens pass WCAG AA                           | Measured contrast ratios; confirmation red is never the sole state indicator    | **Not started**                                                                                                                                                                                                                                                              |
| P1-12 | Asset package approved                               | Owner sign-off, recorded as a DEC entry                                         | **Not started**                                                                                                                                                                                                                                                              |
| P1-13 | Phase 2 entry decision                               | Explicit go/no-go for plan §9, which DEC-0035 does **not** grant                | **Not started**                                                                                                                                                                                                                                                              |

Not part of §8's exit gate, tracked so it is not lost: the **staging-project
prerequisite** DEC-0035 places inside Phase 1. Now believed to be a _verify_ task —
`yqftpibxplachhwoclam` already exists per the service inventory. See "On the
staging prerequisite" above.
