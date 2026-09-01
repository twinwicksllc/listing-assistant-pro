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

- [x] Build corpus JSON from category_mappings_rows.csv (40 rows, corrected where wrong)
      — corpus/golden_corpus.json, 18 cases across must_resolve/must_not_regress/
      must_confirm/quarantine_needs_review. Audited all 41 raw data rows against
      the taxonomy cache; found 13 rows spanning 6 distinct dead/non-leaf category
      ids beyond the ones already fixed in PR #529.
- [x] Add Columbian Half Dollar case + Finding B dead-ID cases — cases 1-9
      (columbian-half-dollar-1893, us-commemorative-siblings, the 5
      dead-world-coin-* cases for 40196-40200, dead-world-coin-catchall-45243,
      world-coins-rollup-256-bug) plus a must_confirm case for the
      NEEDS_CONFIRMATION fix itself.
- [x] (bonus, discovered mid-Phase-3) found the SAME non-leaf-rollup bug class
      as 99/256/45243 in 5 more ids OUTSIDE the coins domain, all previously
      trusted as user_verified/approved: 19203 (Beanie Babies), 246 (Action
      Figures), 19209 (Stuffed Animals), 10986 (mislabeled Necklaces &
      Pendants id), 41111 (American Silver Eagle — taxonomy drift, had a
      recorded publish success before eBay retired the id). Added corpus
      cases for all 5 AND extended leafCategoryGuard.ts's
      KNOWN_PARENT_CATEGORY_IDS + added 7 new unit tests (24/24 passing,
      deno fmt/lint clean).
- [x] Build replay harness script — scripts/replay-corpus.mjs. Static/offline
      Node script: validates every corpus expected_category_id is a confirmed
      live leaf in the snapshot, every forbidden/dead id is confirmed
      non-shippable, and (for must_not_regress cases) cross-checks that
      leafCategoryGuard.ts's KNOWN_PARENT_CATEGORY_IDS actually contains each
      dead id — a static-analysis regression guard since it can't invoke the
      live edge function without a running Supabase instance. Distinguishes
      forbidden_category_ids (never shippable anywhere) from
      forbidden_wrong_answer_ids (valid leaves that are simply the wrong pick
      for a specific item, e.g. Washington Quarters 39461 for a Columbian
      Half Dollar). Caught a real gap on first run: dead World Coin ids
      40196-40200 had been pulled from the AI prompt allowlist in Phase 2 but
      never added to the guard's static blocklist — fixed.
- [x] Snapshot ebay_taxonomy_cache for deterministic replay —
      corpus/ebay_taxonomy_snapshot.json (15,116 rows, ~3.5MB, converted from
      ebay_taxonomy_cache_rows.csv with real JSON booleans for is_leaf).
- [x] Wire into CI — added `category-corpus-replay` job to
      .github/workflows/test.yml (runs leafCategoryGuard.test.ts +
      scripts/replay-corpus.mjs, no live credentials needed) and added it to
      the blocking test-summary gate alongside frontend-tests and
      functions-check.
- [x] (follow-up, user question: "shouldn't we use the live Supabase table
      since it refreshes weekly?") Added scripts/refresh-taxonomy-snapshot.mjs + a new `refresh-taxonomy-snapshot` job in
      .github/workflows/category-taxonomy-sync.yml that runs right after the
      weekly sync-ebay-taxonomy cron: fetches the live ebay_taxonomy_cache via
      Supabase REST (reusing the already-configured SUPABASE_URL /
      SUPABASE_SERVICE_KEY secrets), re-validates the golden corpus against
      that live data (failing loudly if eBay broke a documented guarantee),
      diffs it against the committed snapshot (added/removed/renamed/
      leaf-flipped categories), and opens a PR with the refreshed snapshot
      when drift is detected. Keeps the CI replay harness reproducible
      (frozen snapshot) while ensuring it never silently drifts from the
      real weekly-refreshed table. Tested locally against a mock REST server
      in both clean and drift scenarios (exit 0 / exit 1 respectively).

## Phase 4 — Filter-then-rank resolver rewrite

- [x] Design gate functions (leaf/active/condition/aspects) in category-lookup
      — checkLeafActiveCacheFirst() (gates 1+2, cache-first against
      ebay_taxonomy_cache with CACHE_STALE_DAYS=7 freshness, live fallback via
      the existing verifyCategoryLeafActive()), fetchCategoryConditionIds()/
      checkConditionGate() (gate 3, duplicated — not imported, cross-function
      imports aren't possible — from ebay-publish's categoryAcceptsCondition()
      pattern, reusing the already-obtained eBay app token; made
      payload-optional via a new `conditionId` lookup-request field since no
      caller currently supplies one), checkAspectSatisfiability() (gate 4,
      required-aspect token-overlap heuristic against getItemAspectsForCategory).
      All wired together per-candidate via gateCandidate().
- [x] Remove computeEffectiveScore + weights + thresholds — deleted
      LookupCandidate interface, computeEffectiveScore(), isGenericItemType(),
      SOURCE_WEIGHTS/nonLeafPenalty/genericPenalty/ambiguityPenalty,
      DETERMINISTIC_LOCK_THRESHOLD, and the `winner = allCandidates[0]`
      fallback from category-lookup/index.ts. Re-added only a minimal
      non-scoring computeTokenOverlap() used purely as a candidate-gathering
      filter (FUZZY_MIN_TOKEN_OVERLAP), never as a score input.
- [x] Implement precedence-based winner selection incl. NEEDS_CONFIRMATION —
      resolverCore.ts (pure, dependency-free selectWinner(): Layer 2
      precedence [user_verified > eBay #1 survivor > NEEDS_CONFIRMATION] +
      Layer 3 agreement/subtree-separation check) wired into the fully
      rewritten `action === "lookup"` handler in index.ts, which now gathers
      candidates from 4 sources (user_verified/db_exact DB rows, eBay
      getCategorySuggestions, DB fuzzy match, Gemini fallback), gates every
      one, and hands off to selectWinner() — no arithmetic anywhere in the
      decision path.
- [x] Gate 4 (aspect satisfiability) in warn-only mode — checkAspectSatisfiability()
      collects warnings into `gate4Warnings` on each GatedCandidate without
      ever causing a drop, gated behind a `GATE4_ENFORCE` env flag for a
      future promotion to enforcing (tracked as Phase 6).
- [x] Validate against corpus at each step — scripts/replay-corpus.mjs
      re-run and confirmed green (18/18 cases) after the rewrite; this is a
      static/offline check of the taxonomy snapshot + leafCategoryGuard.ts
      blocklist and does not itself exercise the live gate/resolver code
      paths (those require a running Supabase + eBay credentials, out of
      scope for this repo's local sandbox — covered instead by
      resolverCore.test.ts's 10 unit tests over the pure decision logic).
- [x] Tests + CI green — resolverCore.test.ts (10/10, deno test), rewrote
      src/test/ebay-category-finder.test.ts to import and test the ACTUAL
      production resolverCore.ts module (previously it duplicated the old
      score-based logic locally, which would have silently kept "passing"
      after the logic it was meant to guard was deleted from production).
      Full local CI-equivalent suite run and green: `deno fmt --check
supabase/functions/` (84 files), `deno lint --config
supabase/functions/deno.json supabase/functions/` (81 files), `deno
check` on category-lookup/*.ts and analyze-item/index.ts, `deno test`
      on resolverCore.test.ts (10/10) and leafCategoryGuard.test.ts (24/24),
      `npm run test` (118/118 across 13 files), `npx tsc --noEmit`, `npx
eslint src/ --max-warnings 0`, `node scripts/replay-corpus.mjs`
      (18/18). Also updated analyze-item/index.ts's two category-lookup
      consumer sites (pre-lookup + post-lookup) to drop all
      effectiveScore/confidence/score references, since `found: true` now
      already implies every gate + precedence/agreement check passed —
      confirmed CategoryConfirmDialog.tsx's separate `action: "verify"` path
      is unaffected.

Deferred to a follow-up phase (not blocking Phase 4, tracked for later —
same pattern as Phase 6's gate-4-enforcement deferral): deleting the
hardcoded category-ID allowlist baked into analyze-item's tool-schema AI
prompt (plan §2.2), and consolidating the three duplicate parent/blocklist
mechanisms (leafCategoryGuard.ts's KNOWN_PARENT_CATEGORY_IDS,
category-lookup's BLOCKED_PARENT_CATEGORIES, analyze-item's inline
COINS_PAPER_MONEY_IDS/KNOWN_WRONG_DOMAIN_FOR_COINS/KNOWN_PARENT_CATEGORIES).
Both are higher-risk, AI-prompt-adjacent changes that deserve their own
isolated validation pass rather than being bundled into the resolver
rewrite itself.

## Phase 5 — Harden crons

- [x] sync-ebay-taxonomy: drift-diff logging (which IDs disappeared) + staleness
      health check — diffs the newly-walked leaf set against the previous
      ebay_taxonomy_cache leaf set every run, logs a warning with a sample of
      disappeared IDs (Finding B's bug class, now caught automatically
      instead of by hand), and reports `disappearedLeafCount`/
      `disappearedLeafSample`/`staleRowCount` (rows not synced in >8 days) in
      the JSON response for visibility without a manual query.
- [x] category-hygiene-cron rewrite: dedup by precedence, rot detection, drop
      decay/expiry — migration 20260825000000_category_hygiene_precedence_rewrite.sql
      rewrites find_duplicate_mappings() to a precedence rule (user_verified >
      most-recently-published > most-recently-updated, no arithmetic) and adds
      find_rotted_mappings() (approved rows whose ebay_category_id is no
      longer a live leaf in ebay_taxonomy_cache, flagged `needs_review` — a new
      allowed status value — rather than silently rejected). Removed the two
      score-dependent duties (decay effective_score by 5/90d; expire at
      score<=10) from category-hygiene-cron/index.ts entirely, since
      effective_score is no longer part of the live decision path after Phase 4. Job was already scheduled in Phase 1 (20260824000000_schedule_category_hygiene_cron_properly.sql,
      weekly Sun 04:11 UTC) — no scheduling changes needed this phase.
      Verified: `deno check`/`deno fmt --check`/`deno lint` clean on both
      files and across the whole supabase/functions/ tree (82 fmt / 79 lint),
      `npm run test` (117/117), `node scripts/replay-corpus.mjs` (18/18,
      unaffected — no test coverage exists for these two cron functions,
      consistent with the rest of the codebase).

## Phase 6 — Promote gate 4 to enforcing (deferred / follow-up, not this pass)

## Follow-up: capture eBay response body in verifyCategoryLeafActive

Per user request (2026-08-31): the `verify` action's `verifyCategoryLeafActive()`
helper only logs the HTTP status code on the `!resp.ok` branch, not eBay's
response body. User wants the actual eBay error message captured so failed
override-attempts are diagnosable from the function logs alone.

- [x] 1. Edit `verifyCategoryLeafActive` in `supabase/functions/category-lookup/index.ts`
      (lines ~483-494): on the `!resp.ok` branch, read `resp.text()` and include
      `respText.slice(0, 200)` in the `console.warn`. Keep the 404 special-case
      (clean miss, no body needed). Keep the pessimistic return unchanged.
- [x] 2. Verify locally: `deno fmt --check` (84 files clean), `deno lint` clean,
      `deno check` clean, `prettier --check todo.md` clean (format-and-lint parity)
- [x] 3. Branch off `main`, commit, push via x-access-token, open PR
      (PR #546, merged 2026-08-30)
- [x] 4. Confirm CI green (format-and-lint + Edge Functions Check are the
      blocking ones for a functions-only change) — merged green

## Follow-up: consolidate the duplicated parent-category blocklists

The other half of Phase 4's deferral (the AI-prompt allowlist half is still
open — see below). Same concept was implemented four times, and the Phase 2/3
fixes had only ever landed in one of them, so the other call sites were still
persisting/selecting categories the guard was written to refuse.

- [x] Made `leafCategoryGuard.ts`'s `KNOWN_PARENT_CATEGORY_IDS` the single
      source of truth. It was already a strict superset of the other copies
      (38 ids), so consolidating widened coverage at the two live call sites
      rather than narrowing it: category-lookup's persist gate went 16 -> 35
      ids, analyze-item's override 14 -> 35. That is what propagates 99, 256,
      45243, the dead World Coin ids and the Phase 3 audit ids to those paths
      for the first time.
- [x] `category-lookup/index.ts` — deleted `BLOCKED_PARENT_CATEGORIES` (16
      ids); gate 0 of `safePersistMapping` now calls
      `isKnownParentCategoryId()`. Added the guard import (this function did
      not import the guard before).
- [x] `analyze-item/index.ts` — deleted the inline `KNOWN_PARENT_CATEGORIES`
      (14 ids), which was declared _inside a function body_ and re-allocated
      on every invocation; `aiCategoryIsParent` now calls the shared
      predicate. Extended the existing `leafCategoryGuard.ts` import rather
      than adding a line.
- [x] Deleted `_helpers/categoryResolution.ts` (180 lines) — it held a fourth
      copy of the list plus duplicate `COINS_PAPER_MONEY_IDS` /
      `KNOWN_WRONG_DOMAIN_FOR_COINS`, and was **dead code**: nothing in the
      repo imported it. Created by the 2026-04-19 "extract category
      resolution policy helpers" refactor (`c275b85`) and never wired up, so
      the inline copies stayed live for ~4 months.
- [x] Fixed three real false positives found while auditing the merged list
      against `corpus/ebay_taxonomy_snapshot.json`. Each was a **live leaf**
      being blocked, and each carried a comment that misidentified it — which
      is how they were added in the first place: - `3390` annotated "Coins: World > Africa (rollup)", actually
      `Coins & Paper Money > Coins: World > Europe > Ireland`. Irish
      coins could not resolve at all, in the app's primary vertical. - `20713` annotated "Home & Garden" (in all three copies), actually
      `Home & Garden > ... > Refrigerators`. The H&G root is 11700. - `139971` annotated "Video Games & Consoles", actually
      `Video Games & Consoles > Video Game Consoles`. Parent is 1249.
      None of the three appear in the golden corpus, so no recorded
      regression guarantee was weakened.
- [x] Kept `88433` blocked, and corrected its comment. It is also a live leaf
      and its old label ("Coins: US > Dimes") was wrong, but it is
      `Everything Else > Every Other Thing` — the same junk-catch-all family
      as 99, whose selection caused the Columbian Half Dollar incident. The
      pre-existing frontend suite `src/test/leaf-category-guard.test.ts`
      describes it as "the rollup category seen in the reported coin scans",
      i.e. it was observed leaking into real scans, so the block is correct
      on the merits even though the reason recorded for it was not.
- [x] Hardened the guard's header against the CI coupling: two scripts
      (`scripts/replay-corpus.mjs`, `scripts/refresh-taxonomy-snapshot.mjs`)
      read this file as _text_, locating ids by constant name then scraping
      the Set-literal bounds. Added an explicit warning not to convert the
      literal to an import, rename it, or move the file. Worth knowing: the
      first draft of that warning _itself_ broke the scrape to 0 ids by
      repeating the constant name and bracket tokens above the real
      declaration — the note is now phrased to avoid that.
- [x] Tests — 6 new cases in `_helpers/leafCategoryGuard.test.ts` (24 -> 30):
      the three unblocked leaves asserted individually, 88433 asserted still
      blocked with the reason in the test name, and two coverage-guarantee
      tests pinning every id the deleted copies used to block so a future
      edit cannot silently narrow either call site.
- [x] Verified: `deno test` leafCategoryGuard.test.ts (30/30),
      `node scripts/replay-corpus.mjs` (18/18), scrape re-check yields 35
      ids, `deno fmt --check` (83 files) and `deno lint` (80) clean,
      `deno check` clean on category-lookup and analyze-item,
      `npm run test` (118/118 — includes the frontend guard suite, which
      imports the real module rather than duplicating the list).
- [ ] Branch, commit, push, open PR; confirm CI green (`category-corpus-replay`
      and `format-and-lint` are the blocking ones here).

**Still deferred from Phase 4 (unchanged):** deleting the hardcoded
category-ID allowlist baked into `analyze-item`'s tool-schema AI prompt (plan
§2.2). That is the riskier half and still wants its own isolated validation
pass.

**Noted, not done:** `category-lookup/resolverCore.test.ts` (10 cases) is not
wired into any CI workflow, and the two blocklist scrapers are byte-for-byte
duplicate implementations. Both are real gaps deserving their own change.

## Wrap-up (Phase 1+2 checkpoint)

- [x] Push branch feat/category-resolver-v2-phase1-2, open PR
      (https://github.com/twinwicksllc/listing-assistant-pro/pull/529)
- [x] Monitor CI — all checks green (format-and-lint, Edge Functions Check,
      Frontend Tests, E2E Smoke Tests, Integration Tests, Test Summary)
- [x] Report back with links + deploy notes (see PR description; migration
      auto-applies via the Supabase migration pipeline on merge — no manual step)
- [ ] Full project wrap-up (push/PR/monitor/report) deferred until Phases
      3-6 are also implemented, per the original plan sequencing
