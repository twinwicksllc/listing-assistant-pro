# Q-10 Brand Direction — Continuation Brief

**Prepared:** 2026-09-28  
**Continue:** 2026-09-29  
**Product:** ListrAssistr  
**Authoritative tracker:** `REBRAND_PHASE_1_TODO.md` (Q-10)  
**Decision status:** Open. No visual direction, logo, tagline, or asset package has been approved. Do not begin production work until the owner confirms the shared understanding and makes the Q-10 decision.

## Purpose

Resume the guided Q-10 brand-direction interview without re-asking settled questions. This conversation used the `.claude` grilling skill: map decisions as a tree, ask only the current decision frontier, include a recommendation with each question, and wait for the owner's answer before continuing. Do not silently treat preferences as final approval.

## Settled Brief So Far

- **Audience:** all eBay sellers first. Coins/collectibles can demonstrate product depth, but should not make the brand appear to serve only collectors. Competitors emphasize high-volume sellers; that is not the target limitation.
- **Product promise:** make creating an optimized listing easier, including item identification from photos, a searchable title, a listing description, and price guidance. Position the complete seller outcome, not just "AI" or speed.
- **Primary tagline direction:** "Less effort. Smarter listings." is the current working preference. It is not approved final copy.
- **AI description:** owner likes "AI-powered". Pair it with concrete capabilities and make clear that the seller remains in control; do not imply identification or recommendations are infallible.
- **Name story:** owner wants the missing-E spelling idea to feature in a tagline or brand story, not necessarily as a standalone explanation. The spelling is unusual, so the full `ListrAssistr` wordmark must remain clear and memorable; an `LA` mark alone is insufficient.
- **Logo preference:** current concept's wrapped/interlocking `LA` is liked because it feels like one ribbon/brush stroke. Owner is open to redesigns and wants the current concept kept available as one comparison candidate, not as a fixed constraint.
- **Wordmark comparison:** test all three treatments: `ListrAssistr` mixed case, all caps with L and A subtly larger, and uniform all caps. Judge spelling clarity at normal/mobile sizes. L and A emphasis is a candidate, not a fixed rule.
- **Palette direction:** explore a softer off-white base with bold crimson and black as accents, alongside a crisper light-neutral alternative. The owner is open to the recommendation after seeing the comparison.
- **Experience:** premium and approachable; precise is table-stakes. Desired feel is polished and time-saving, with expert credibility, not exclusive/high-end. The user should not think this is an ordinary eBay listing form or a thin AI wrapper.
- **Visual storytelling:** show real items becoming polished, searchable listings; demonstrate effort saved and pricing help beyond eBay's native listing flow.
- **Evidence:** seller's nearly 1,000 listings and gross sales of 10,886 over 90 days are not for the primary page. If used near a real example or founder proof point, label the figure as gross sales for a defined period, never profit or a customer outcome. Prefer a real workflow example to make clear a human is using and reviewing AI output.
- **Concepts and rights:** the current PNG concept is red/black `LA` over a wordmark on a textured white canvas; it cannot be the production asset by itself. The target repo's current implemented identity differs. Owner approved the product name under owner sign-off, not a counsel clearance opinion; trademark filing and broader searches are deferred. A standalone LA mark may merit a design-mark search. Do not use the potentially competitor-referencing "drop the E's" tagline without separately resolving Q-09.
- **Destination/scope:** finished §8.3 brand artifacts go into `listrassistr-official`; planning and decision records stay in this legacy repo during Phase 1 (DEC-0038). Q-10 does not authorize Phase 2 code changes or migration/cutover work (DEC-0035).

## Listing Comparison Video Decisions

These are related evidence/storytelling decisions, not a substitute for the Q-10 visual-direction approval.

- Compare an eBay-native workflow and the app workflow using the same physical item sequentially; end the first live listing before publishing the second, and confirm it is no longer purchasable to avoid duplicate live inventory. The owner may use a coin and a general item such as jewelry.
- Start both clocks from equivalent photo-workflow points: the first photo taken in the app versus starting photo selection in eBay was the owner's initial proposal; the round then recommended capture-to-publish for both with the same photo-taking conditions. This start-point detail still needs explicit owner confirmation because the app has photo optimization while the native route starts from selected photos.
- Show a natural eBay workflow, including the seller's normal choices, then optionally a separately timed quality-matching pass. Safety-critical accuracy and honest condition disclosures are required in both; do not call a naturally sparse listing "bad" or misrepresent work.
- Compare title/searchability, description (including "what it is / specs / why it matters"), item specifics, pricing research/recommendation, photos, seller corrections, time, and manual actions. Coin-specific claims such as rarity, mint/privy marks, mintage, and condition must be checked; never assert unsupported significance. The planned targeted-photo follow-up feature is not yet shipped and must not be shown as current.
- End with the listings side-by-side and state specifically what is better in the app version, where evidence supports it; acknowledge any native-flow advantage. If a meaningful edge case reveals a product weakness, retain it as testing evidence. Any rerun must be disclosed and explained, not silently substituted.
- Label results as two demonstrations, not an average or general speed claim. If using sped-up side-by-side footage, show uncut elapsed-time evidence/actual timings and identify that the same seller listed the same item sequentially.

## Known Source Artifacts

- Legacy concept: `public/listrassistr-logo.png` in this repo.
- Target concept: `public/listrassistr-logo.png` in `listrassistr-official`.
- Target repo currently implements a different warm-paper/ink/muted-red/Georgia identity; inspect the current files before using it as the intended future design.
- Target app mark implementation: `src/components/BrandMark.tsx`; its styles are in `src/styles/index.css`.
- Launch/audience context: `LISTRASSISTR_LAUNCH_STRATEGY.md`.
- Q-10 and deliverable/status context: `REBRAND_PHASE_1_TODO.md`, `REBRAND_PHASE_1_DOMAIN_AND_DNS_CHECKLIST.md`, and §8.3 of `LISTRASSISTR_REBRAND_AND_MIGRATION_PLAN.md`.

## Tomorrow's First Decision Round

Ask the unresolved frontier question about the comparison protocol, with a recommendation, then wait:

1. **Clock start:** confirm whether both workflows are timed capture-to-publish from equivalent photo conditions, or whether the demonstration should separate photo optimization from listing work. Recommendation: capture comparable photos in both workflows and include each route's photo processing/selection through publication, while labeling the different actions transparently.
2. **Rerun rule:** define what counts as an edge case that justifies rerunning, how many attempts are allowed, and how every attempt/result will be disclosed. Recommendation: never replace a disappointing valid run; rerun only after a documented technical failure or an item that cannot be listed safely, retain all attempts, and disclose the selection rule/results.

Then recap all settled choices and ask the owner to confirm that the brief is accurate. Only after confirmation, prepare complete mini-directions for comparison: full wordmark, compact/small mark, palette, typography, and a realistic sample workflow screen. Include the current concept unchanged as one candidate. Do not edit the production app or start final asset production until the owner approves Q-10.
