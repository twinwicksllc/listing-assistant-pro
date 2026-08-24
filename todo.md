# Category Resolver v2 — Implementation Todo

Reference: CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md

## Phase 1 — Schedule category-hygiene-cron properly

- [x] Write migration to actually call cron.schedule() for category-hygiene-cron
- [x] Verify against pattern used in 20260818030000_schedule_inventory_sync_cron.sql
- [x] Test locally / verify migration syntax (dollar-quote structure diffed clean against working template)
- [x] (bonus hardening) add requireCronSecret auth guard to category-hygiene-cron/index.ts (previously had none) + deno check/fmt/lint clean

## Phase 2 — Tourniquet: fix dead category IDs + Columbian-half class of bug

- [x] Add US Commemorative leaves (179531/179532/179533/179534/529) to AI prompt allowlist
      (corrected from an earlier wrong assumption that 39461 was this leaf — 39461 is
      actually "Washington Quarters"; confirmed live via taxonomy cache cross-reference)
- [x] Remove 45243 and 40196-40200 (confirmed dead) from AI prompt
- [x] Replace with live Coins:Canada / Mexico / UK / Australia / Germany / China / Japan
      leaf IDs from cache
- [x] Block category 99 in leafCategoryGuard (root cause of the Columbian Half Dollar bug)
- [x] Replace `winner = allCandidates[0]` fallback with NEEDS_CONFIRMATION result
      (category-lookup/index.ts: winner stays null, response carries
      `needsConfirmation: true` + per-candidate `verifiedLeaf`)
- [x] Update leafCategoryGuard KNOWN_PARENT_CATEGORY_IDS sanity (note stale ones;
      13/33 still live, 20 absent from cache — pruning deferred to Phase 4)
- [x] (bonus fix, discovered mid-Phase-2) category 256 ("Coins: World" rollup) is ALSO
      a non-leaf, confirmed absent from the live cache as its own leaf row — it was being
      used as the "graded-friendly World Coins safe default" throughout
      analyze-item/index.ts, ebay-publish/publish-helpers.ts and
      ebay-publish/publish-create-draft.ts. Replaced all _assignment_ sites with the
      confirmed-live leaf 257 ("Other Coins of the World"); left 256 in blocklists /
      aspect-maps as defense-in-depth for legacy data.
- [x] Write/update tests — added supabase/functions/_helpers/leafCategoryGuard.test.ts
      (16 new unit tests covering the 99/256/45243 blocklist, 257/179531 confirmed-leaf
      pass-through, enforceLeafCategory candidate/coin-text reselection, and
      inferUsCoinLeafFromText series disambiguation). All existing tests
      (suggestedCategories.test.ts) still pass unmodified.
- [x] Traced analyze-item/index.ts's three category-lookup call sites (pre-lookup ~L966,
      verify ~L2160, post-lookup ~L2266) — all three already handle `found:false` /
      `topCandidates` / `isLeaf===false` safely by falling through to alternatives or
      AI judgement; no caller-side changes required for the new NEEDS_CONFIRMATION shape.
- [x] Run full test suite + deno checks — `deno fmt --check supabase/functions/` (81
      files, clean), `deno lint --config supabase/functions/deno.json supabase/functions/`
      (78 files, clean), `deno test` on suggestedCategories.test.ts (8/8 pass) and new
      leafCategoryGuard.test.ts (16/16 pass). `deno check` on analyze-item/index.ts fails
      only on a pre-existing sandbox limitation (npm:@supabase/supabase-js not installed
      locally) confirmed present on main before any of this session's edits — not a
      regression; all other touched files pass `deno check` cleanly.

## Phase 3 — Golden corpus + replay harness

- [ ] Build corpus JSON from category_mappings_rows.csv (40 rows, corrected where wrong)
- [ ] Add Columbian Half Dollar case + Finding B dead-ID cases
- [ ] Build replay harness script
- [ ] Snapshot ebay_taxonomy_cache for deterministic replay
- [ ] Wire into CI (or document manual invocation)

## Phase 4 — Filter-then-rank resolver rewrite

- [ ] Design gate functions (leaf/active/condition/aspects) in category-lookup
- [ ] Remove computeEffectiveScore + weights + thresholds
- [ ] Implement precedence-based winner selection incl. NEEDS_CONFIRMATION
- [ ] Gate 4 (aspect satisfiability) in warn-only mode
- [ ] Validate against corpus at each step
- [ ] Tests + CI green

## Phase 5 — Harden crons

- [ ] sync-ebay-taxonomy: drift-diff logging (which IDs disappeared) + staleness health check
- [ ] category-hygiene-cron rewrite: dedup by precedence, rot detection, drop decay/expiry

## Phase 6 — Promote gate 4 to enforcing (deferred / follow-up, not this pass)

## Wrap-up (Phase 1+2 checkpoint)

- [x] Push branch feat/category-resolver-v2-phase1-2, open PR
      (https://github.com/twinwicksllc/listing-assistant-pro/pull/529)
- [x] Monitor CI — all checks green (format-and-lint, Edge Functions Check,
      Frontend Tests, E2E Smoke Tests, Integration Tests, Test Summary)
- [x] Report back with links + deploy notes (see PR description; migration
      auto-applies via the Supabase migration pipeline on merge — no manual step)
- [ ] Full project wrap-up (push/PR/monitor/report) deferred until Phases
      3-6 are also implemented, per the original plan sequencing
