# Deep dive: analyze-item category assignment logic

## Goal
Find why the AI/analyze pipeline assigns non-leaf / graded-unfriendly categories
(e.g. 45243 "Coins: World") instead of correct leaf categories, for BOTH world
and US coins. Fix at the source so the publish-time reroute (PR #417) becomes
a pure safety net, not the primary fix.

## Investigation — COMPLETE
- [x] Map out analyze-item/index.ts structure (Pass-1 classification, category
      selection/prompting, taxonomy lookups)
- [x] Find where ebayCategoryId is chosen/suggested for coins
- [x] Determine: is 45243 a genuine eBay LEAF or a parent? Confirmed PARENT
      (per PR #417 investigation — rejects Graded/2750 condition)
- [x] Check how graded vs raw signal flows into category selection —
      CONFIRMED: slabOcrResult.isSlabbed/grader IS computed early but NEVER
      consulted by any category-selection code path (only feeds itemSpecifics)
- [x] Identify 3 concrete root-cause spots that hardcode 45243 with zero
      graded-awareness:
      1. AI tool-schema categoryId description (line ~1632) — explicitly
         instructs Gemini "any NGC/PCGS/ANACS-certified coin from non-US mint
         = ALWAYS use World Coins (45243...)" and "always default to 45243"
      2. resolveDomainFallbackCategory() (line 140) — metal-unknown fallback
         hardcodes 45243, ignoring slabOcrResult
      3. "DOMAIN-MISMATCH SAFETY" block (line ~2238) — force-sets 45243 with
         no graded check

## Fix
- [x] Add isLikelyGradedCoin() + resolveGradedFriendlyWorldCoinCategory()
      shared helpers in analyze-item/index.ts
- [x] Update AI tool-schema prompt so graded/certified world coins route to
      256 (Coins: World leaf) / 3392 (South Pacific) / country IDs instead of
      45243; keep 45243 only for genuinely raw/ungraded world coins
- [x] Make resolveDomainFallbackCategory() graded-aware (accept slabOcrResult)
- [x] Make DOMAIN-MISMATCH SAFETY block graded-aware
- [x] Add/extend tests (analyze-item graded world coin category test)
- [x] deno fmt / deno check / tsc / vitest / vite build all pass
- [x] Commit, push, open PR
- [x] Confirm CI green
