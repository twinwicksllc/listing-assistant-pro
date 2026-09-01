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

~~Deferred to a follow-up phase~~ — **both done, across later sessions
(this note was stale until 2026-09-01):** the three duplicate
parent/blocklist mechanisms were consolidated into
`leafCategoryGuard.ts`'s `KNOWN_PARENT_CATEGORY_IDS` (see the "consolidate
the duplicated parent-category blocklists" entry below), and the
hardcoded category-ID allowlist turned out to already be clean in
`analyze-item`'s tool-schema prompt — the actual stale list was
`domainPrompts.ts`'s `buildCoinBullionPrompt()`, found and fixed in the
"fix the stale/wrong-domain eBay coin-category IDs" entry, which also
cured the same disease in five more locations across two further
sessions.

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
- [x] Branch, commit, push, open PR; confirm CI green (`category-corpus-replay`
      and `format-and-lint` are the blocking ones here) — PR #547, merged 2026-08-31.

**Still deferred from Phase 4 (unchanged):** deleting the hardcoded
category-ID allowlist baked into `analyze-item`'s tool-schema AI prompt (plan
§2.2). That is the riskier half and still wants its own isolated validation
pass.

**Noted, not done:** `category-lookup/resolverCore.test.ts` (10 cases) is not
wired into any CI workflow, and the two blocklist scrapers are byte-for-byte
duplicate implementations. Both are real gaps deserving their own change.

## Follow-up: fix the stale/wrong-domain eBay coin-category IDs

The Phase 4 deferral named "the hardcoded category-ID allowlist baked into
analyze-item's tool-schema AI prompt" as a follow-up. Investigating it found
that list (`analyze-item/index.ts`'s `categoryId` tool-schema description) was
already fixed in Phase 2 — the actual problem was a different, un-audited list
Finding B never looked at.

- [x] Found the real target: `_helpers/domainPrompts.ts`'s
      `buildCoinBullionPrompt()`, the text that actually reaches Gemini as the
      real system prompt for `coins_bullion` items whenever no deterministic
      category is locked. Confirmed via the Gemini call itself (`index.ts`:
      OpenAI-shim function calling, `categoryId` is a plain `string` with no
      `enum`) that this text is advisory only, not schema-enforced — so this
      prompt is the sole guidance, not a validated constraint.
- [x] Rewrote its `### CATEGORY IDs` block and every downstream mention
      (14 corrected IDs total): the Finding-B dead IDs (already fixed
      elsewhere but not here), plus two IDs that are worse than dead — LIVE
      leaves silently reassigned to a different domain (`40150` -> Action
      Figures, `40152` -> Go-Karts), plus `11116` (labeled "Lincoln Memorial"
      but is the domain ROOT, non-leaf). Every replacement verified against
      `corpus/ebay_taxonomy_snapshot.json`.
- [x] Found the same stale IDs duplicated in `src/lib/ebayCategoryMap.ts`, a
      frontend breadcrumb map `CategoryConfirmDialog.tsx` checks FIRST,
      short-circuiting before any live verification call — the most
      dangerous form of this bug, since a stale hit means "valid" is reported
      with no real check ever firing. Fixed the same 14+ IDs there (deleting
      wrong keys, adding correct ones), plus two bonus mislabels found during
      verification: `166680`/`166681` were labeled "Copper Bullion" but are
      actually Paper Money: World > Cambodia/Hong Kong.
- [x] Fixed `analyze-item/index.ts`'s `COINS_PAPER_MONEY_IDS` (the
      domain-mismatch check's membership set): removed 5 confirmed
      live-leaf-wrong-domain entries (four Action Figures variants + one
      Signs & Plaques) and added every new ID `domainPrompts.ts` now
      recommends, so a corrected AI pick isn't wrongly flagged as a mismatch.
      Left every merely-absent entry untouched, per `leafCategoryGuard.ts`'s
      own established precedent.
- [x] Deleted the dead `_promoteSystemPrompt` block (`index.ts`, ~80 lines) —
      built, never assigned to the real `systemPrompt`, referenced only via
      `void _promoteSystemPrompt;` to silence a lint warning. Confirmed dead
      by checking every reference to the identifier.
- [x] (found mid-implementation, same file/root-cause)
      `resolveDomainFallbackCategory()` — the deterministic fallback used
      when the Taxonomy API lookup fails or is suppressed — had the SAME bug,
      but as an ACTIVE ASSIGNMENT, not just a membership check:
      platinum/palladium items were being assigned `261070` (confirmed live
      leaf, but Action Figures Accessories, not Bullion), with no safety net
      catching it since it's a genuine leaf. Split into separate platinum
      (`34942`) / palladium (`34943`) leaves; fixed the dead `41111`
      (American Silver Eagle) -> `177653` and dead `39465` (named US silver
      dollar fallback) -> `176965`.
- [x] (found while running the test suite) Two test files duplicate
      `resolveDomainFallbackCategory()`'s logic locally rather than importing
      it (Deno edge functions aren't Node-importable), so they were asserting
      the OLD wrong IDs as correct — meaning they'd have provided zero
      regression protection and actively misled a future reader.
      `analyze-item-category-fallback.test.ts` and
      `analyze-item-graded-coin-routing.test.ts` both updated in step; the
      latter's `resolveGradedFriendlyWorldCoinCategory()` mirror was ALSO
      still using dead `256`, predating even the 2026-08-24 Finding-B fix.
- [x] Added two regression tests closing the blind spot Finding B never had
      a guard for (zero prior tests imported `domainPrompts.ts` or asserted
      on its content): `src/test/ebay-category-map-freshness.test.ts`
      (vitest, scoped to the Coins & Paper Money entries this pass actually
      audited — the file also covers Trading Cards/Jewelry/Electronics/
      Clothing/Books, which were spot-checked but not exhaustively audited)
      and `supabase/functions/_helpers/domainPrompts.test.ts` (Deno, extracts
      every `Label=ID` pair from the real
      `buildSystemPrompt("coins_bullion", ...)` output and cross-checks
      against the snapshot). Wired the Deno test into `category-corpus-replay`'s
      CI job alongside `leafCategoryGuard.test.ts`.
- [x] Verified: `npm run test` 118 -> 121, `deno test` on both guard suites
      (30/30, 2/2), `node scripts/replay-corpus.mjs` 18/18, `deno fmt`/`lint`
      clean across the whole `supabase/functions/` tree (84/81 files),
      `deno check` clean on `analyze-item/index.ts`, `npx eslint`/`npx tsc`
      clean on every touched frontend file.

**Confirmed NOT affected (checked, not assumed):** every other domain builder
in `domainPrompts.ts` (trading cards, jewelry, electronics, sneakers, auto
parts, luxury handbags, vintage clothing, general) has zero hardcoded
category IDs — confirmed by grep across the whole 931-line file. They rely
entirely on the live `categoryBlock()` injection, so this exact bug class
cannot occur there. The Category Resolver v2 rewrite (filter-then-rank, live
taxonomy checks) already protects every domain equally; today's fix closes a
legacy hole that happened to exist only in coins/bullion.

**New findings, deliberately NOT fixed here — same disease, different organs:**

1. `ebay-publish/publish-helpers.ts`'s `HARDCODED_COIN_CATEGORY_IDS`
   (~line 355-460, live in the publish pipeline via `publish-create-draft.ts`)
   has comments spanning dozens of entries that are flatly wrong — IDs for
   Dollars and Gold coins are all labeled "Dimes (variant N)", `41099` is
   labeled "Washington Quarters" but is Liberty Walking Half Dollar. The code
   only checks Set membership, not comments, so this doesn't break at
   runtime by itself, but it's a strong signal the membership needs the same
   audit.
2. `src/types/listing.ts`'s `COIN_CATEGORY_IDS`/`BULLION_CATEGORY_IDS` —
   module-private but consumed by exported `isBullionCategory()` and
   `deriveDomainFromCategory()`, imported by 10+ frontend
   components/hooks. Contains the same wrong-domain `261070` and the dead-ID
   family. This is user-facing: if a seller manually selects/types category
   `261070`, the UI would incorrectly show coin/bullion fields (Grade,
   precious-metal weight) for what's actually an Action Figures Accessories
   listing.
3. `supabase/functions/_helpers/suggestedCategories.ts` — a server-side
   breadcrumb map imported by `analyze-item`, `category-lookup/resolverCore.ts`,
   and `leafCategoryGuard.ts`. Its own header explicitly says "no hardcoded
   maps — ever" (breadcrumbs should come from `ebay_taxonomy_cache` /
   `category_mappings` / the live API), yet it contains the same
   `41111`/`261070`/etc. stale entries — contradicting its own design intent.
   Possibly the oldest instance of this pattern, and a plausible source the
   others were copied from.

Each of these three is a genuinely separate file/subsystem from what this
pass touched, with its own blast radius — flagged for a dedicated pass each,
same treatment as `HARDCODED_COIN_CATEGORY_IDS` above.

## Follow-up: cure the disease in the three flagged instances

The previous entry flagged three more locations sharing the same
stale/wrong-domain coin-category-ID disease as separate, unfixed follow-ups.
This entry cures those three, using the same verified replacement table.

- [x] **`ebay-publish/publish-helpers.ts`** — removed 7 confirmed
      live-leaf-wrong-domain IDs from `HARDCODED_COIN_CATEGORY_IDS`
      (`40150`/`40152` silently reassigned to Action Figures/Go-Karts;
      `261064`/`261068`-`261071` to Toys & Hobbies/Collectibles). Found and
      fixed a **4th bug class** not in the original flag: `532`/`173685`
      (real coin leaves) were also wrongly in `HARDCODED_BULLION_CATEGORY_IDS`
      — moved back to the coin set, since bullion is checked first and was
      silently winning; `3360` (real bullion leaf) was missing from the
      bullion set entirely, added. Removed a regex catch-all in
      `detectCategoryTreeSync` (`/^261[0-9]{3}$/` → `"bullion"`) that
      classified **any** ID in that whole numeric range as bullion — a
      broader, open-ended version of the same landmine, not fixed by
      correcting the Set alone. Also removed `182` from
      `HARDCODED_COLLECTIBLE_CATEGORY_IDS` (confirmed live leaf, Computer
      Software, not LEGO) while spot-checking that Set per the same
      classification function. Corrected every wrong inline comment using
      verified live labels, and backfilled the same corrected replacement
      IDs already added elsewhere, so this fallback-of-a-fallback still
      recognizes a listing's corrected category if the DB/breadcrumb lookup
      is ever unavailable. Added `publish-helpers.test.ts` (none existed —
      confirmed zero test coverage for this entire classification path).
- [x] **`src/types/listing.ts`** — removed the same 7 wrong-domain IDs from
      `COIN_CATEGORY_IDS`/`BULLION_CATEGORY_IDS`, plus two IDs (`11956`,
      `11116`) that violated the file's own stated "leaf-only" invariant
      with no such justification. Corrected that header comment to name the
      5 legitimate June-2026-mandate parent markers as the deliberate
      exception. This is the highest-severity of the three: a wrong
      classification here makes `isCoinConditionDetailRequired()` return
      `true` for a non-coin item, which **hard-blocks publish**
      (`useAnalyzePublish.ts`) until the seller fills in a nonsensical
      Grade/PCGS field. Backfilled the same corrected replacement IDs.
      Exported the three sets (were module-private) and added
      `listing-category-classification-freshness.test.ts` — zero test
      coverage existed for the dangerous IDs or for `TRADING_CARD_CATEGORY_IDS`
      at all.
- [x] **`_helpers/suggestedCategories.ts`** — different treatment from the
      other two: this map (`_LEGACY_BOOTSTRAP_BREADCRUMBS`) explicitly says
      "DO NOT ADD NEW ENTRIES — run the sync job instead," so dangerous
      entries were **deleted**, not corrected — a deleted entry makes Tier 4
      return `null` (the caller renders a visible "Category #<id>"
      placeholder) instead of a confidently wrong breadcrumb, consistent
      with the file's own stated intent to shrink. Removed 10 confirmed
      wrong-domain-live entries — 3 more than the coin-specific ones already
      known, since this map spans every domain: `182` (labeled LEGO, is
      Computer Software), `15709` (labeled T-Shirts, is Men's Athletic
      Shoes), `40` (labeled Autographs, is Gas & Oil Collectibles). Did
      **not** backfill new entries, per the file's own policy. Exported the
      map (was module-private) purely for testability and extended the
      existing `suggestedCategories.test.ts` with both a known-IDs check and
      a full snapshot sweep.
- [x] **Correction to the previous entry's own speculation:** git history
      (`git log --follow` on both files) resolves which file is the
      original — `src/lib/ebayCategoryMap.ts` (created 2026-03-10) is the
      source; `suggestedCategories.ts`'s map was copy-pasted from it six days
      later (commit `35e1c51`'s own message: "mirrors the frontend
      ebayCategoryMap.ts"), not the other way around as guessed.
- [x] **Correction to the previous entry's claimed importers:** only
      `analyze-item/index.ts` actually imports `suggestedCategories.ts`.
      `category-lookup/resolverCore.ts` and `leafCategoryGuard.ts`'s
      `suggestedCategories` hits are a comment-only architectural comparison
      and a reference to the unrelated `listing.suggestedCategories` data
      field, respectively — not imports of the module. Checked both in this
      pass; neither needed a fix.
- [x] Verified: `npm run test` 121 -> 126, 4 Deno test files (30/2/10/8,
      all pass), `node scripts/replay-corpus.mjs` 18/18 (unaffected),
      `deno fmt`/`lint` clean across the whole `supabase/functions/` tree
      (85/82 files), `deno check` clean on every touched backend file,
      `npx eslint`/`npx tsc` clean on every touched frontend file.

**Still flagged, not fixed — same disease, different vertical:**

- `HARDCODED_TRADING_CARD_CATEGORY_IDS` (`publish-helpers.ts`) and
  `TRADING_CARD_CATEGORY_IDS` (`listing.ts`) are byte-for-byte identical and
  share their own staleness — a shell-script comment already documents
  `19107` as stale with known live replacement `183050`, not in either set.
  Trading cards, not coins/bullion — needs its own taxonomy verification
  pass.
- **The DB-persistence path** (`analyze-item/index.ts` ~line 2779-2804):
  auto-persists `listing.suggestedCategories[0]`'s breadcrumb into
  `category_mappings`, which is itself Tier 2 of `suggestedCategories.ts`'s
  own lookup order — so a stale Tier-4-sourced label could in principle
  become self-perpetuating in the DB. Touches write/persistence behavior, a
  different risk category from correcting a data table.

## Follow-up: trading-card IDs, and the category-lookup persist auth bug

Two smaller items flagged in the previous entry. Investigating both turned
up more than described.

**Trading cards** (`HARDCODED_TRADING_CARD_CATEGORY_IDS`/
`TRADING_CARD_CATEGORY_IDS`, byte-identical across `publish-helpers.ts`
and `listing.ts`) — lower severity than coins: no dangerous wrong-domain
IDs found, no publish-blocking mechanism exists for trading cards
anywhere.

- [x] `19107` (dead) replaced with its live equivalent `183050`
      (Collectibles > Non-Sport Trading Cards > Trading Card Singles,
      already used correctly in analyze-item's AI prompt — only these two
      fallback Sets were stale) in both Sets, plus the corresponding
      `CATEGORY_ASPECT_RULES` key in `publish-helpers.ts` (a separate
      dictionary keyed by category ID — the Set fix alone wouldn't have
      reattached the aspect rule to the ID that's actually live).
- [x] Corrected wrong labels: `183454`/`2536` were commented
      "Pokémon Trading Card Games"/"Magic: The Gathering" — the live
      taxonomy has no per-game leaf at all (game is an item aspect, not a
      category); `183454` is the one generic CCG-any-game leaf, `2536` is
      the CCG parent category itself. `64482`'s comment ("Baseball Cards")
      was corrected to note it's absent from the live tree and its only
      two live children (Autographs-Reprints, Wholesale Lots) aren't
      trading cards either — its real identity is unconfirmed.
- [x] Closed the loop on a second, separate list found during
      investigation: `src/lib/ebayCategoryMap.ts`'s own "Trading Cards"
      section had the identical sport-mislabeling bug on `261328`-`261332`
      (labeled Baseball/Football/Basketball/Hockey/Soccer Cards — actually
      generic format leaves: Singles/Lots/Sets/Sealed Packs/Sealed Boxes)
      plus `183454` (same Pokémon mislabel) — already found and explicitly
      flagged as "deliberately not touched" in a comment in that file's
      own freshness test last session. Fixed now; that test's comment and
      scope updated to match, with a new narrowly-scoped assertion for the
      exact 6 IDs (not a broader Toys-&-Hobbies-wide audit, which hasn't
      been done).
- [x] Added test coverage — zero existed for either Set, `CATEGORY_ASPECT_RULES`'s
      card entries, or `EBAY_CATEGORY_BREADCRUMBS`'s trading-card block
      before this.

**The DB-persistence follow-up turned out to be a different, more
consequential bug than described**, not just "a stale label might leak."
`category-lookup/index.ts`'s `"store"` action has its own inner auth check
(raw header → `supabase.auth.getUser(token)`) that ignores the
already-correct service-role detection its own top-level
`requireUserOrServiceRole(req)` call already computed (confirmed via grep:
`auth.userId`/`auth.isServiceRole` were referenced nowhere else in the
file). Since `analyze-item`'s auto-persist call always sends the
service-role key as Bearer, and reaching this action's body at all
requires already having passed the top-level guard (which requires a
Bearer token to exist), the original `if (authHeader) {...} // else: no
auth — internal auto-save` branching was based on a condition that could
never be true — the gated `safePersistMapping` path has been unreachable
dead code since `requireUserOrServiceRole` was introduced. This
codebase's own `authGuard.ts` explicitly special-cases the service-role
key elsewhere specifically because calling `getUser()` on it doesn't
work, which is strong corroborating evidence (not verified via live
execution) that every "ai_auto" persist attempt from `analyze-item` has
silently 401'd.

- [x] Fixed: the `"store"` action now branches on `auth.userId` (already
      verified once at the top of `handleRequest`, in scope throughout —
      no function boundary between them) instead of re-deriving auth from
      the raw header. Real user sessions keep identical behavior (same
      admin/non-admin upsert logic, just correctly reachable); service-role
      callers now correctly route into the gated `safePersistMapping` path
      instead of 401ing.
- [x] **Correction made mid-fix**: fixing the auth routing does **not**
      actually unlock any new writes today, contrary to what this entry
      first assumed. `analyze-item`'s call never sends a confidence value,
      and the `"store"` action's fallback branch hardcodes `confidence: 75`
      — always below `AUTO_PERSIST_MIN_CONFIDENCE` (85) — so Gate 1 in
      `safePersistMapping` rejects every call from this path regardless of
      auth. That gate reads as a deliberate "never trust a bare AI guess"
      design choice, not a bug, and wasn't touched. The auth fix is still
      correct and worth having on its own merits (right HTTP semantics,
      right routing, matters for any other service-role caller of
      `"store"`) — it just doesn't change today's actual write behavior.
- [x] Added tier provenance to `suggestedCategories.ts` anyway, as
      cheap defense-in-depth rather than an active-risk fix (given the
      confidence gate above): `lookupBreadcrumb` now returns
      `{ breadcrumb, tier: 1|2|3|4 }` instead of a bare string (4 existing
      return points, each already knew its own tier — no restructuring),
      and `buildSuggestedCategories` threads a `fromLegacyBootstrap`
      (`tier === 4`) field onto every suggestion. `analyze-item`'s
      auto-persist block now skips the `"store"` call entirely when the
      primary suggestion is `fromLegacyBootstrap` — so if the confidence
      gate above ever loosens, this stays true without anyone having to
      remember to add it then.
- [x] **No test coverage added for the `"store"` action auth fix itself or
      for `analyze-item`'s skip-guard** — confirmed no test infra exists
      for either (no dedicated test file for `category-lookup`'s HTTP
      handler needing a live Supabase instance, and zero `.test.ts` files
      exist for `analyze-item/index.ts` at all). Flagging this gap
      explicitly rather than skipping the disclosure. The tier-provenance
      piece itself is tested (`suggested-categories.test.ts`).
- [x] Verified: `npm run test` 126 -> 131, all 4 Deno test files green
      (30/2/10/11), `node scripts/replay-corpus.mjs` 18/18 (unaffected),
      `deno fmt`/`lint` clean across the whole `supabase/functions/` tree,
      `deno check` clean on every touched backend file, `npx eslint`/`npx tsc`
      clean on every touched frontend file.

**Still open:** building test infrastructure for Deno HTTP handlers or for
`analyze-item/index.ts` — a real, now twice-noted gap, but a much larger
undertaking than either of these passes, and not something to improvise
as a side effect of one fix.

## Wrap-up (Phase 1+2 checkpoint)

- [x] Push branch feat/category-resolver-v2-phase1-2, open PR
      (https://github.com/twinwicksllc/listing-assistant-pro/pull/529)
- [x] Monitor CI — all checks green (format-and-lint, Edge Functions Check,
      Frontend Tests, E2E Smoke Tests, Integration Tests, Test Summary)
- [x] Report back with links + deploy notes (see PR description; migration
      auto-applies via the Supabase migration pipeline on merge — no manual step)
- [ ] Full project wrap-up (push/PR/monitor/report) deferred until Phases
      3-6 are also implemented, per the original plan sequencing
