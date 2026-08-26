# Rebrand Phase 1 — Domain, DNS, and Email Record Checklist (Plan §8.1, §8.2)

**Product:** ListrAssistr
**Repository:** `twinwicksllc/listing-assistant-pro` (legacy; stays live per DEC-0003)
**Scope:** `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §8.1 and the DNS-resident
parts of §8.2. Repository code changes are §9/Phase 2 and out of scope here.
**Owner:** User (all registrar, DNS, Vercel, Resend, and legal actions)
**AI role:** Drafting, record shapes, verification procedure. No provider action.

## Gate status — read first

This document is **prepared, not authorized**. It commits nothing and spends
nothing. At the time of writing:

- `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md:6` records Phase 0 **Status: Open**.
- **P0-18 "Phase 1 entry decision"** — the gate whose evidence is a "Signed
  decision record, date, scope, conditions, unresolved accepted risks" and whose
  approval mode is "Explicit go/no-go" — is **Not started**.
- The decision log's highest entry is **DEC-0033**. There is no DEC-0034 or
  DEC-0035 recorded in this repository.
- P0-08 (storage), P0-13 (migration cohort), and P0-17 (exception disposition)
  are still **In progress**.

Nothing below requires that gate to be closed first, because everything below is
either a research task or a checklist to work from. **Section B onward involves
real spend, a legal-entity commitment, and an ICANN 60-day transfer lock** — run
those only once the Phase 1 entry decision exists as a written record, or once
the owner explicitly waives that sequencing.

DEC-0033 is consistent with domain registration being the correct next action: it
records the October 1, 2026 window as explicitly provisional _because_ "none of
Phases 1–6 have started (domain not yet registered)".

## Section A — Settle before spending money

| #   | Item                                                               | Why it is a pre-registration decision                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | Register under the **legal business entity**, not a personal login | Plan §8.1.1. Changing a registrant later triggers an ICANN 60-day transfer lock and can force a paid transfer. This is also the one chance to avoid repeating the existing pattern: the Vercel project sits under `tom-fenwicks-projects/`, and the Supabase project (`wcednzaxmxwfiijzmjmx`, `RankedCEO-CRM`) and Resend account are shared with the CRM behind one admin login (RBR-0024, RBR-0031). |
| A2  | Registrant/recovery email must **not** be `@listrassistr.com`      | Circular dependency. If the new zone or its mail is misconfigured, a recovery address inside it is unreachable. Use a mailbox on an already-working domain the business controls.                                                                                                                                                                                                                      |
| A3  | Trademark and naming-conflict research (Section A.1 below)         | Plan §8.1.3 requires recorded legal approval of the stylized spelling _before public launch_. Cheaper to learn now than after brand assets (§8.3) are produced.                                                                                                                                                                                                                                        |
| A4  | Decide defensive registrations                                     | `.com` is mandatory. Decide now whether to also take `.net`/`.co`/`.app` and the high-risk typo variants (`listrassister`, `listerassistr`, `listrasistr`). Cheap at registration, expensive to reclaim. Owner spend decision.                                                                                                                                                                         |
| A5  | Choose the authoritative DNS provider (Section C)                  | Plan §8.1.4. Must be decided before the domain is pointed anywhere, and it constrains DNSSEC (§8.1.8).                                                                                                                                                                                                                                                                                                 |
| A6  | Choose the **inbound** mailbox provider for role addresses         | Plan §8.2.1 needs `support`/`privacy`/`legal`/`security@`. Resend is **send-only** and does not receive mail, so this is a separate provider decision (Google Workspace, Microsoft 365, Fastmail, or registrar-level forwarding) that adds MX records to the zone.                                                                                                                                     |

### A.1 Trademark research checklist (research only — not legal advice)

This is a list of searches to run and hand to counsel. It is not a clearance
opinion, and I am not the sign-off in plan §8.1.3.

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

## Section B — Registrar hardening (plan §8.1.2)

Run immediately after registration, in this order.

- [ ] **Registrar transfer lock** on — confirm the domain status shows
      `clientTransferProhibited`.
- [ ] **MFA on the registrar account** — prefer WebAuthn/passkey or TOTP. Avoid
      SMS-only, which is the weakest link in domain-hijack incidents.
- [ ] **Auto-renew on**, with a payment method whose expiry is later than the
      next renewal date. A lapsed card is the most common cause of accidental
      domain loss.
- [ ] **Registration term** — consider multi-year to reduce renewal-failure
      surface.
- [ ] **Recovery contacts** set to A2's external address, and verified working by
      an actual test email.
- [ ] **Domain-expiry alerts** enabled at the registrar, plus an independent
      calendar reminder that does not depend on registrar email deliverability.
- [ ] **WHOIS/RDAP privacy** on, while keeping the underlying registrant data
      accurate — ICANN requires accuracy, and false data is itself a cancellation
      risk.
- [ ] **Registrar account separate from the DNS-provider account** if those are
      split (Section C), so one credential compromise does not yield both.
- [ ] **Document access and recovery** — add the registrar and DNS provider to
      `REBRAND_PHASE_0_SERVICE_INVENTORY.md` (names, account owner, recovery
      path, MFA method). Names and locations only; never secret values.

## Section C — DNS provider choice (plan §8.1.4)

Hard requirements, derived from the plan itself:

1. **DNSSEC support** — §8.1.8 requires it, with a verified DS chain.
2. **TTL control down to 300 seconds or lower** — §8.1.7.
3. **Reliable, fast propagation and an API/audit trail** for cutover work.
4. Ability to host Vercel apex + subdomain records and Resend's DKIM/SPF records
   in the same zone.

| Option                                                                        | Fits                                                                    | Watch out for                                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated DNS provider (e.g. Cloudflare) as authoritative, registrar separate | Free tier, sub-300s TTLs, one-click DNSSEC, good API and change history | One more account to secure with MFA; DNSSEC needs the DS record pasted at the registrar, so both accounts are in the critical path |
| Vercel DNS                                                                    | Simplest apex/`app` integration, records Vercel itself prescribes       | **Verify current DNSSEC support before committing** — do not assume it; if unsupported it fails requirement 1 outright             |
| Registrar-native DNS                                                          | Fewest moving parts, one account                                        | Often the weakest TTL granularity, API, and change auditing; DNSSEC support varies by registrar                                    |

Recommendation to decide on, not a decision: authoritative DNS at a provider that
demonstrably satisfies all four requirements, with the registrar as a separate
hardened account. Confirm requirement 1 in the provider's live documentation at
decision time rather than from this table.

Context: current production runs on `lister.teckstart.com`, a subdomain of an
existing domain, so this is the first apex-domain setup for this product.
`REBRAND_PHASE_0_SERVICE_INVENTORY.md` already flags the existing apex
arrangement as "an initial staging arrangement, not approval to connect".

## Section D — Record plan

**Rule, from plan §8.1.5 verbatim: "do not copy stale example IP addresses from
documentation."** Every value below is a placeholder. Take the real values from
the provider dashboard that issues them, at the time you configure them.

| Host / name                                  | Type         | Value                                                                     | TTL at setup | Source of truth  | Notes                                                                                                                                                                                               |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------- | ------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@` (apex)                                   | A            | `<value shown in Vercel → Project → Settings → Domains>`                  | 3600         | Vercel           | Drop to 300 per §8.1.7 before cutover, not now                                                                                                                                                      |
| `www`                                        | CNAME        | `<target shown by Vercel>`                                                | 3600         | Vercel           | Decide canonical host: apex-canonical with `www` redirecting, or the reverse. Pick one and keep it consistent with the app's own canonical URL and sitemap                                          |
| `app`                                        | CNAME        | `<target shown by Vercel>`                                                | 3600         | Vercel           | Plan §8.1.6                                                                                                                                                                                         |
| `qa`                                         | CNAME        | `<target shown by Vercel>`                                                | 3600         | Vercel           | Plan §8.1.6; maps to the Vercel Preview/QA environment                                                                                                                                              |
| `_vercel`                                    | TXT          | `<verification token from Vercel>`                                        | 3600         | Vercel           | Only if Vercel requests domain verification                                                                                                                                                         |
| `<selector>._domainkey`                      | CNAME or TXT | `<issued by Resend>`                                                      | 3600         | Resend           | Publish exactly what the Resend dashboard issues, including the selector subdomain. Record shape differs by account/region — do not template it                                                     |
| `send` (or Resend's stated return-path host) | TXT / MX     | `<issued by Resend>`                                                      | 3600         | Resend           | Custom return-path / MAIL FROM alignment, plan §8.2.4                                                                                                                                               |
| `@` (apex)                                   | TXT (SPF)    | `v=spf1 include:<resend-issued-include> ~all`                             | 3600         | Hand-built       | **Exactly one SPF TXT record per name.** Two SPF records is a permanent hard failure. Merge all senders into one string. Stay within the 10-DNS-lookup limit. Start `~all` (softfail), not `-all`   |
| `_dmarc`                                     | TXT          | `v=DMARC1; p=none; rua=mailto:<analyzer>; fo=1; adkim=r; aspf=r; pct=100` | 3600         | Hand-built       | Plan §8.2.3 mandates `p=none` **and a report-review period** before tightening. Start relaxed alignment (`r`) to avoid false failures during setup; tighten to `s` alongside the move to quarantine |
| `@` and/or mail host                         | MX           | `<issued by the A6 mailbox provider>`                                     | 3600         | Mailbox provider | Required for inbound `support`/`privacy`/`legal`/`security@`. Resend does not receive mail                                                                                                          |
| `@`                                          | CAA          | `0 issue "<CA used by Vercel>"`                                           | 3600         | Hand-built       | **Add only after certificates have issued.** A wrong CAA record silently blocks renewal. Optional but recommended                                                                                   |

### D.1 TTL sequencing (plan §8.1.7)

The 24-hour lead time is not a formality. Lowering a TTL only takes effect once
the _previous_ TTL has aged out of resolver caches, so a record sitting at 3600
needs at least that long before the 300 is authoritative everywhere.

- [ ] T-48h or earlier: drop TTL to 300 on the records that change at cutover
      (apex, `www`, `app`) — a full day of margin over the plan's 24h minimum.
- [ ] T-24h: confirm 300 is being served by multiple public resolvers (Section E).
- [ ] Cutover: repoint.
- [ ] Post-stabilization: raise back to 3600 and re-verify.

Leave DKIM/SPF/DMARC/MX at 3600 throughout — they do not change at cutover.

### D.2 DMARC staging

`p=none` is a measurement mode, not a finished state, and moving off it early is
how legitimate mail starts disappearing.

1. Publish `p=none` with `rua` pointing at a DMARC analyzer.
2. Collect **at least one full weekly reporting cycle**, and long enough to cover
   every legitimate sender: Resend product mail, the mailbox provider, and any
   Stripe/eBay/support tooling that sends as the domain.
3. Confirm every legitimate source shows SPF **and** DKIM alignment passing.
4. Only then move to `p=quarantine; pct=<ramp>`, ramping the percentage.
5. Only then consider `p=reject`, and tighten `adkim`/`aspf` to `s`.

## Section E — Verification procedure

Windows note: `dig` is not present by default. PowerShell equivalents given
first; use `dig` if you have WSL or BIND tools installed.

Query public resolvers explicitly — querying your own recursive resolver hides
propagation problems.

```powershell
# Apex and subdomains, against two independent public resolvers
Resolve-DnsName listrassistr.com      -Type A     -Server 1.1.1.1
Resolve-DnsName listrassistr.com      -Type A     -Server 8.8.8.8
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

## Section G — Boundary

I can draft, specify, and verify-by-procedure. I cannot and will not: register or
purchase anything, log into or click through registrar/DNS/Vercel/Resend
dashboards, provide legal clearance or sign-off, or produce the §8.3 vector
artwork. Per the standing rules, every production/provider/DNS change needs the
owner's explicit approval first, and no secret values appear in this repository.

## Section H — Open decisions blocking finalization

Answers to these turn the placeholders in Section D into real values.

1. Registrar and legal entity account to use (A1).
2. Authoritative DNS provider (A5/Section C), with DNSSEC support confirmed.
3. Defensive registrations: which additional TLDs and typo variants, if any (A4).
4. Inbound mailbox provider for the four role addresses (A6).
5. Canonical host: apex or `www`.
6. Resend path: dedicated account or shared-account upgrade (Section F).
7. DMARC `rua` analyzer destination address.
8. Whether the Phase 1 entry decision (P0-18) is recorded before Section B runs.

## Accepted risks carried into Phase 1

Recorded as-is, not reopened here:

- **RBR-0004** — no migration approval gate on `deploy-functions.yml`. Accepted
  2026-08-19, ratifying PEND-0005; mitigated by DEC-0014's fail-closed SQL guards
  instead.
- **RBR-0030** — Gemini cost-alert threshold inert at current spend (hardcoded
  50 USD/month against roughly 1.72 USD month-to-date).
- **RBR-0032** — Sentry is a no-op across the application; DEC-0025 directs
  building real error tracking in the ListrAssistr project rather than porting
  the stub.
- **Separate staging environment** — DEC-0005 requires separate staging and
  production environments and credentials; no ListrAssistr staging Supabase
  project exists yet. Tracked against DEC-0005 and DEC-0004. Note this is
  §9/Phase 2 infrastructure, not §8 scope, so it needs its own slot rather than
  being folded under this banner.
