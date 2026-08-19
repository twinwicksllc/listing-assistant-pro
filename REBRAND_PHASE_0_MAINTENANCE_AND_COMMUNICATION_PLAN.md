# Phase 0 Maintenance & Communication Plan (P0-14)

**Status:** Drafted 2026-08-19. Target window is provisional — see caveat below — not yet a customer-facing commitment.

Resolves P0-14 (`REBRAND_PHASE_0_CLOSURE_CHECKLIST.md`): window, notice schedule, support contact, freeze rules, and customer impact. This is Phase 0 item 9 in `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §7 ("Define the maintenance window, customer notice schedule, go/no-go meeting, and rollback decision deadline"), which in turn unblocks P0-15's one remaining open piece (the rollback decision deadline, per DEC-0031) and P0-18 (the actual Phase 1 entry decision).

## Target window

**October 1, 2026** (target maintenance window date; exact start time TBD once the maintenance window mechanics in `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §14.2 are staged).

**Caveat — this is provisional, not committed:** what this repository's Phase 0 work covers is one of nine total phases (0–8) in the master migration plan. Phases 1–6 (domain registration, brand asset production, repository rebrand, new Supabase project setup, cohort-based data/auth migration with a rehearsal, and external-integration/DNS re-pointing) have not started as of this writing — `listrassistr.com` is not yet registered (§8.1). The plan's own go/no-go thresholds (§14.4) require a completed migration rehearsal with a clean exception report before the cutover window is scheduled for real, and that rehearsal cannot happen until Phases 3–4 exist. **Do not send the customer notice below until Phases 1–6 show real, verified progress** — recommend revisiting this date once a new Supabase project exists and a first rehearsal has run.

## Notice schedule

- **T-7 days** (September 24, 2026, if the window holds): email to all users covering the new name/domain, maintenance window, sign-in requirement, support contact, and how to recognize legitimate emails from this migration (per §14.1, step 1).
- **T-1 day** (September 30, 2026): reminder email, same content, shorter.

## Support contact

`support@twinwicksllc.com` — published in both notice emails and on any maintenance-mode status page shown during the cutover window.

## Freeze rules

Two distinct freezes, different scope and duration — don't conflate them:

1. **Architectural-change moratorium (pre-window):** 24 hours before the maintenance window opens, no schema changes or architectural changes land that aren't part of the migration itself. In practice, Phase 0's own working style (small, single-purpose PRs merged promptly) means most of this freeze should already be true by habit before the window even starts.
2. **Write freeze (during the window, per §14.2 — already specified by the master plan, not new here):** the old app goes into maintenance mode with writes blocked at both UI and backend layers. Cron jobs, webhook mutations, publish jobs, and background workers are paused or queued for the duration. This directly answers the "do we need to ban new listings/signups" question — yes, but it's a maintenance-window action lasting hours, not a weeks-long freeze on user activity.

## Customer impact

Expect all of the following during the actual cutover window:

- **Downtime** for the duration of the maintenance window (old app shows maintenance mode; new app isn't enabled until the reconciliation checks in §14.2 step 8 pass).
- **Re-authentication required.** Auth is exported/imported to a new Supabase project (§10, §11.2) — sessions do not carry over.
- **eBay reconnection should NOT be required**, contingent on one dependency worth tracking now: `EBAY_TOKEN_ENCRYPTION_KEY` (RBR-0020) must be carried over to the new Supabase project's Edge Function secrets, or the migrated encrypted tokens will fail to decrypt. Add this explicitly to the Phase 4/5 data-migration checklist.
- **Domain change**, with permanent redirects preserved from confirmed legacy hostnames (path/query preserved, except sensitive OAuth parameters — §14.2 step 13).
- **Mandatory smoke-test verification** before the new app is unlocked for general use (§14.3): sign-in, existing drafts/images/profiles/subscription state, eBay token refresh/policies/listing retrieval, Stripe checkout/portal/webhook, and old-URL redirects.

## Cross-references

- `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md` §14 (cutover runbook), §15 (rollback plan)
- `REBRAND_PHASE_0_DECISION_LOG.md` DEC-0031 (P0-15 rollback plan cross-reference — its remaining open item, the decision deadline, can now be set relative to this window)
- `REBRAND_PHASE_0_CLOSURE_CHECKLIST.md` P0-14, P0-15, P0-18
