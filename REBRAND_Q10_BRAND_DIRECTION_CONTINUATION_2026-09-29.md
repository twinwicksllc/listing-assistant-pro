# Q-10 Brand Direction — Continuation Brief

**Prepared:** 2026-09-28  
**Continue:** 2026-09-29  
**Product:** ListrAssistr  
**Authoritative tracker:** `REBRAND_PHASE_1_TODO.md` (Q-10)  
**Decision status (updated 2026-10-01): DECIDED as DEC-0041** (Clear Momentum; official pill and small `LA` logos; brand colors; dark-mode rule). Production artwork, the usage sheet, and final token measurement remain. The rest of this document is the history that led to it. Earlier status: brief confirmed by the owner 2026-09-29. On 2026-09-30, the owner approved the Clear Momentum destructive-color and optional card-shadow roles and designated the pill and favicon PNGs as the official logo files. PR #28 published those files with the palette/logo-placement study. The complete visual direction was then decided on 2026-10-01 as DEC-0041; what remains is production work (icons, social and email assets, usage sheet) and final token measurement.

## Purpose

Resume the guided Q-10 brand-direction interview without re-asking settled questions. This conversation used the `.claude` grilling skill: map decisions as a tree, ask only the current decision frontier, include a recommendation with each question, and wait for the owner's answer before continuing. Do not silently treat preferences as final approval.

## Settled Brief So Far

- **Audience:** all eBay sellers first. Coins/collectibles can demonstrate product depth, but should not make the brand appear to serve only collectors. Competitors emphasize high-volume sellers; that is not the target limitation.
- **Product promise:** make creating an optimized listing easier, including item identification from photos, a searchable title, a listing description, and price guidance. Position the complete seller outcome, not just "AI" or speed.
- **Primary tagline direction:** "Less effort. Smarter listings." is the current working preference. It is not approved final copy.
- **AI description:** owner likes "AI-powered". Pair it with concrete capabilities and make clear that the seller remains in control; do not imply identification or recommendations are infallible.
- **Name story:** owner wants the missing-E spelling idea to feature in a tagline or brand story, not necessarily as a standalone explanation. The spelling is unusual, so the full `ListrAssistr` wordmark must remain clear and memorable; an `LA` mark alone is insufficient.
- **Current logo assets (2026-09-30):** the owner-designated official files are `public/ListrAssistr Pill Logo.png` and `public/ListrAssistr Favicon Logo.png` in `listrassistr-official`. PR #28 places them in the palette study. Keep the earlier wrapped/interlocking `LA` concept as historical comparison context; do not describe it as the selected mark or replace the supplied files without owner direction.
- **Wordmark comparison:** test all three treatments: `ListrAssistr` mixed case, all caps with L and A subtly larger, and uniform all caps. Judge spelling clarity at normal/mobile sizes. L and A emphasis is a candidate, not a fixed rule.
- **Palette direction:** compare the Clear Momentum study with a crisper light-neutral alternative. The owner approved the color roles below on 2026-09-30; this does not select the complete visual direction.
- **Approved color roles (2026-09-30):** Restrained Crimson (`#C22938`) is the destructive-action color. Technical Cobalt (`#1D4ED8`) may be used for an optional subtle decorative shadow on cards/panels only; it is not a destructive or status color. Flat cards are also acceptable. Destructive states still need a clear label or icon, and final text/control pairings require WCAG AA verification.
- **Experience:** premium and approachable; precise is table-stakes. Desired feel is polished and time-saving, with expert credibility, not exclusive/high-end. The user should not think this is an ordinary eBay listing form or a thin AI wrapper.
- **Visual storytelling:** show real items becoming polished, searchable listings; demonstrate effort saved and pricing help beyond eBay's native listing flow.
- **Evidence:** seller's nearly 1,000 listings and gross sales of 10,886 over 90 days are not for the primary page. If used near a real example or founder proof point, label the figure as gross sales for a defined period, never profit or a customer outcome. Prefer a real workflow example to make clear a human is using and reviewing AI output.
- **Concepts and rights:** the current PNG concept is red/black `LA` over a wordmark on a textured white canvas; it cannot be the production asset by itself. The target repo's current implemented identity differs. Owner approved the product name under owner sign-off, not a counsel clearance opinion; trademark filing and broader searches are deferred. A standalone LA mark may merit a design-mark search. Do not use the potentially competitor-referencing "drop the E's" tagline without separately resolving Q-09.
- **Destination/scope:** finished §8.3 brand artifacts go into `listrassistr-official`; planning and decision records stay in this legacy repo during Phase 1 (DEC-0038). Q-10 does not authorize Phase 2 code changes or migration/cutover work (DEC-0035).

## Listing Comparison Video Decisions

These are related evidence/storytelling decisions, not a substitute for the Q-10 visual-direction approval.

- Compare an eBay-native workflow and the app workflow using the same physical item sequentially; end the first live listing before publishing the second, and confirm it is no longer purchasable to avoid duplicate live inventory. The owner may use a coin and a general item such as jewelry.
- Start both clocks with the first photo taken for that workflow and stop at publication, including each route's photo processing/selection and all seller review. Use comparable shooting conditions and disclose differences in the photo workflows; the owner confirmed this 2026-09-29.
- Show a natural eBay workflow, including the seller's normal choices, then optionally a separately timed quality-matching pass. Safety-critical accuracy and honest condition disclosures are required in both; do not call a naturally sparse listing "bad" or misrepresent work.
- Compare title/searchability, description (including "what it is / specs / why it matters"), item specifics, pricing research/recommendation, photos, seller corrections, time, and manual actions. Coin-specific claims such as rarity, mint/privy marks, mintage, and condition must be checked; never assert unsupported significance. The planned targeted-photo follow-up feature is not yet shipped and must not be shown as current.
- End with the listings side-by-side and state specifically what is better in the app version, where evidence supports it; acknowledge any native-flow advantage. Edge cases are rare; the owner prefers to decide how to handle a rerun if one occurs rather than set an advance rule. Preserve original test evidence and disclose any rerun and its reason; do not silently substitute a favorable take.
- Label results as two demonstrations, not an average or general speed claim. If using sped-up side-by-side footage, show uncut elapsed-time evidence/actual timings and identify that the same seller listed the same item sequentially.

## Known Source Artifacts

- Legacy concept: `public/listrassistr-logo.png` in this repo.
- Target concept: `public/listrassistr-logo.png` in `listrassistr-official`.
- Current official logo files and study (merged PR #28): `public/ListrAssistr Pill Logo.png`, `public/ListrAssistr Favicon Logo.png`, and `public/clear-momentum-palette-study.html` in `listrassistr-official`. The study route is `/clear-momentum-palette-study`.
- Target repo currently implements a different warm-paper/ink/muted-red/Georgia identity; inspect the current files before using it as the intended future design.
- Target app mark implementation: `src/components/BrandMark.tsx`; its styles are in `src/styles/index.css`.
- Launch/audience context: `LISTRASSISTR_LAUNCH_STRATEGY.md`.
- Q-10 and deliverable/status context: `REBRAND_PHASE_1_TODO.md`, `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md`, and §8.3 of `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`.

## Comparison Plan — Q-10 Still Open

1. Prepare a **comparison brief**, not a final asset package: use the settled audience, seller outcome, "AI-powered" supporting copy, and working "Less effort. Smarter listings." tagline. Keep the unusual full name legible and the seller in control. Use actual product behavior in the sample screen; do not depict the planned targeted-photo prompt as shipped.
2. Present complete mini-directions on the **same content and realistic sample screen**, using the owner-designated official pill/favicon files as the current logo assets. Show the wordmark, compact mark, palette, typography and a listing workflow screen with an item, searchable title, attributes, seller review, and price guidance. Compare the Clear Momentum palette with a crisp light-neutral option. Do not replace or generate logo artwork without owner direction.
3. Evaluate the owner-designated pill and favicon files at mobile-header and favicon sizes, on light/dark backgrounds and in monochrome. Rank full-name readability and one-glance spelling recall, trust, comfort in a working screen, accessibility/contrast, and distinctiveness. Treat the earlier wrapped mark as historical context, not the current selected logo. Record any requested changes **before** approving the complete Q-10 direction.
4. Only after the owner selects a direction and records a Q-10 decision: produce the §8.3 vector master, outlined-font export, wordmark/mark variants, icons, social and email assets, usage sheet, and accessible tokens; measure WCAG AA contrast and confirm color is not the only state indicator. Put new-product artifacts in `listrassistr-official` per DEC-0038; keep Phase 1 decisions in this repo. Phase 2 implementation still needs its own entry decision.
5. Plan the coin/general-item comparison video as **separate marketing evidence**, not a prerequisite to choosing the visual direction. Before recording, choose real items, verify item claims and condition, and agree on what "quality" measures. Publish the eBay listing first, end it and confirm it is not purchasable before publishing the app listing. Time both from the first photo through publication, preserve full recordings, separately label optional quality-matching work, and claim results only for the demonstrated items. Decide edge-case handling when encountered and disclose any rerun.

**Next review checkpoint:** complete the remaining visual-system comparison, gather any revisions, and record explicit Q-10 approval. The official pill/favicon files and palette study are recorded as delivered; this does not complete the §8.3 production package, final tokens, live-app rebrand, or migration.
