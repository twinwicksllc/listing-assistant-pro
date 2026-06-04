# STATE.md — listing-assistant-pro

> **Purpose:** Single source of truth for the current phase, open work, and known blockers. Update this file at the start and end of every AI-assisted session.

---

## Current Phase

**Production Stabilization + Stripe Payment Integration**

- App is live at [listing-assistant-pro.vercel.app](https://listing-assistant-pro.vercel.app)
- eBay publish pipeline is stable after recent hotfixes (PRs #360–#362)
- Deploy workflow is fixed and no longer blocks on `supabase db push`
- Next major milestone: Stripe billing tiers fully wired + landing page updated with annual pricing

---

## Recently Merged (last 5 PRs)

| PR | Title | Merged |
|----|-------|--------|
| #362 | fix(ebay-publish): add Certification aspect for category 3360 + coin-condition bridge | 2026-06-03 |
| #361 | ci: fix migration step hanging at 'Initialising login role' | 2026-06-03 |
| #360 | fix(ebay-publish): proof set condition descriptor fix + IDOR hardening | 2026-06-02 |
| #359 | (prior work — see git log) | — |

---

## Open Pull Requests

_None currently open._

---

## In Progress / Planned

### 1. Stripe Payment Integration
- [ ] Wire 3 pricing tiers into Stripe Products/Prices:
  - Starter: $19/mo or $190/yr
  - Pro: $49/mo or $490/yr
  - Shop: $99/mo or $990/yr
- [ ] Update landing page to display monthly + annual toggle
- [ ] Test checkout + webhook flow end-to-end
- Edge function: `supabase/functions/create-checkout/`, `supabase/functions/stripe-webhook/`

### 2. Large-File Splitting (Code Maintainability)
- [ ] Split `supabase/functions/ebay-publish/index.ts` (~5100 lines) into modules
  - Pattern established by PRs #110/#111 (generate-initial-site split)
  - Priority sub-modules: aspect-builder, condition-descriptors, oauth-token, draft-builder
- [ ] Split `email-templates.ts`
- [ ] Split `audit-engine.ts`
- [ ] Split `serper.ts`
- [ ] Split `pagespeed.ts`

### 3. Outstanding Code Review Findings (from PR #360 session)
- [ ] Quantity mismatch between draft creation and inventory update
- [ ] OAuth token leakage in logs (token value appearing in console.log)
- [ ] `isGrainBar()` false-positive risk on multi-word titles containing "grain"
- [ ] `markdownToHtml` early-exit drops content after first `---` separator
- [ ] `sanitizeDescription` over-stripping: removes valid HTML attributes

---

## Known Blockers / Watchlist

- **DB migrations in CI:** `supabase db push` cannot establish a direct PostgreSQL connection in GitHub Actions (no `SUPABASE_DB_URL` secret). Migration step runs with `continue-on-error: true` + `timeout-minutes: 2`. Schema changes must be applied manually via Supabase dashboard or CLI outside of CI.
- **Category aspect gaps:** Categories 178906 (Gold Bars) and 39489 (Silver Bars) have empty `required` + `defaults` in `CATEGORY_ASPECT_RULES`. They may trigger errorId 25002 if eBay adds `Certification` as required for those categories. Watch eBay policy updates.
- **`ebay-publish` file size:** At ~5100 lines it is approaching the point where AI context windows can't hold the full file. Splitting is a priority before the next major feature addition.

---

## Architecture Snapshot

See [`CONTEXT.md`](CONTEXT.md) for the full architecture reference.

---

_Last updated: 2026-06-04_
