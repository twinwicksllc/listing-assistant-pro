# Category Resolver v2 — Implementation Plan

**Status:** Draft for review. Nothing in this document has been implemented yet.
**Author:** SuperNinja, based on live data pulled from this repo's own Supabase tables.
**Inputs used:** `ebay_taxonomy_cache_rows.csv` (15,116 rows, exported 2026-08-23), `category_mappings_rows.csv` (40 rows, exported 2026-08-23), and the current `main` branch at commit `d04a65c`.

---

## 0. Why this document exists

Every fix so far — PR #525 (leaf-only enforcement), #526 (schema fix), #527 (user-verified precedence + dynamic condition gate), #528 (clean query + tree-version tripwire) — has been a correct, well-tested patch to a single symptom. The 1893 Columbian Half Dollar incident (routed to category 99, "Everything Else") and the audit of `category_mappings` showed the same underlying shape every time: **the resolver ranks candidates before it knows any of them are viable, and when nothing viable survives, it publishes the best of the rejects anyway.**

This plan replaces that shape. It does not propose another patch. It proposes:

1. A **filter-then-rank** resolver with no numeric score.
2. A **explicit "ask the user" outcome** as a first-class result, not a failure mode.
3. Cron jobs sized to what the new resolver actually needs — one deleted, one rewritten, one new.
4. A **golden corpus + replay harness** so every future change is measurable instead of asserted.

Everything below is grounded in what the live data actually showed, not in assumptions about what it should show. Where I found something surprising, I've flagged it as a finding, with the evidence.

---

## 1. Findings from the live data (read this before the plan — it changes the plan)

### Finding A — `ebay_taxonomy_cache` is real and healthy

15,116 leaf categories, 15,111 marked `is_leaf=true`, freshly synced (`2026-08-23 03:11`). This table is exactly what the filter-then-rank resolver needs as its source of truth for "does this category exist and is it a leaf." **It does not need to be rebuilt — it needs to be used.** Nothing in the current resolver actually queries it as a leaf/exists check; the AI's tool schema uses a hardcoded list instead (see Finding B).

Five rows are `is_leaf=false` — all coin rollups (`11116` Coins & Paper Money root, `11945`/`11951`/`11956`/`11968` mid-tree nodes). These are correctly excluded already; they exist in the cache because `sync-ebay-taxonomy` records every node it visits, not just leaves, which is fine — the resolver just needs to filter on `is_leaf = true`.

### Finding B — the hardcoded AI category list is not just incomplete, parts of it are dead

I cross-referenced every ID hardcoded in `analyze-item/index.ts`'s tool-schema prompt against the live cache. Six are **completely absent from eBay's current tree**:

| ID      | Hardcoded as                  | Status in live tree                                                                                                                                                                                          |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `40196` | Canada (World Coins)          | **Does not exist.** Canada now has its own top-level `Coins: Canada` branch (IDs `3378`–`3389`, `536`, `149938`–`149940`, `173610`–`173611`) — a completely different structure than "World Coins > Canada." |
| `40197` | Mexico (World Coins)          | **Does not exist as this ID.** Mexico is `Coins: World > North & Central America > Mexico > <era>` — six separate era-based leaves (`173629`–`173646`), no single flat "Mexico" leaf.                        |
| `40198` | Great Britain (World Coins)   | **Does not exist as this ID.** GB is now 13 denomination-based leaves under `Coins: World > Europe > UK (Great Britain) > *` (Penny, Shilling, Crown, Gold, etc.)                                            |
| `40199` | Australia (World Coins)       | **Does not exist as this ID.** Australia is `Coins: World > Australia & Oceania > Australia > *`, split into Gold/Decimal/Proof Sets/Commemorative/Collections/Other.                                        |
| `40200` | Germany (World Coins)         | **Does not exist as this ID.** Germany is now 6 era-based leaves (Empire, Weimar, Third Reich, West/Unified, East, German States).                                                                           |
| `45243` | "Other World Coins" catch-all | **Does not exist.** This is the exact category every prior fix (#527's graded-coin reroute, `leafCategoryGuard`'s blocklist) was built to route _around_. It isn't just problematic — it's gone.             |

This is not a case of "the AI picked a bad category." **The AI was instructed to use category IDs that eBay retired at some point before this sync**, and the entire "graded world coin" workaround from PR #527 (`GRADED_UNFRIENDLY_WORLD_PARENTS = new Set(["45243"])`) has been defending against a category that no longer exists in the live tree. It's not that the ID stopped accepting graded coins — the ID appears to be gone entirely. (I can't tell from this export _when_ it disappeared, only that it's absent from today's sync. If `sync-ebay-taxonomy` has been running weekly as intended, the drift-detection warning from PR #528 should have logged this the week it changed — worth checking Supabase function logs for a `CATEGORY TREE VERSION CHANGED` line.)

Cross-checking `leafCategoryGuard.ts`'s `KNOWN_PARENT_CATEGORY_IDS` blocklist against the same cache: **20 of its 33 IDs are also absent from the live tree** (`11118`, `253`, `256`, `550`, `631`, `64482`, and 15 others). These aren't necessarily wrong to block — some may correctly be non-leaf parents that simply weren't touched by this sync's DFS walk if they have no children anymore — but it means this list, like the AI prompt list, has not been kept in sync with reality and nobody can currently tell which entries are still meaningful.

**Implication for the plan:** any hardcoded category ID anywhere in this codebase is a liability with a demonstrated, dated failure, not a hypothetical one. The plan below treats `ebay_taxonomy_cache` as the only source of truth for "does this category exist," and treats every hardcoded ID list as a migration target to be deleted, not extended.

### Finding C — `category_mappings` confirms the learning loop is broken, not just slow

(Carried forward from the earlier audit, restated briefly since it directly shapes §4 below.) 96 recorded publish successes, 0 recorded failures, across 40 rows — while the user was independently reporting category errors the same week. 11 of those 40 rows are `ai_auto` guesses that reached `approved` status on a single successful publish, with no human ever reviewing them. 17 of 40 are year-locked duplicates of concepts that already have a generic, verified row (e.g., `1921 morgan silver dollar` alongside the already-`user_verified` `morgan dollar`). Three sports-card rows are mislabeled (`Basketball Cards` for Donruss/Upper Deck _baseball_; one row's own stored name is the placeholder string `"Category #183437"`, meaning the code that wrote it did not know what that category was).

### Finding D — `category-hygiene-cron` was never scheduled from pg_cron (but see the correction below)

Confirmed by reading every migration that calls `cron.schedule()`: only `sync-ebay-taxonomy-weekly`, `invoke-cost-alert-cron-daily`, `cleanup-media-retention-daily`, `inventory-sync-every-15min`, and `competitor-prices-refresh-cursor-5min` are actually scheduled. The migration meant to schedule `category-hygiene-cron` (`20260331000000_schedule_category_hygiene_cron.sql`) creates a log table and leaves the actual scheduling as a comment with three unexecuted options. `category_hygiene_log` should be empty — that's the one-query way to confirm this before touching anything.

**Correction (2026-08-24), after Phase 1 shipped.** The scan above only looked at
`cron.schedule()` calls in migrations, and that was too narrow a search: it missed
`.github/workflows/category-taxonomy-sync.yml`, which has been POSTing
`category-hygiene-cron` (and `sync-ebay-taxonomy`) on a weekly GitHub Actions
`schedule:` trigger since commit `bb938ee`, 2026-07-18 — whose subject line is
"fix: actually schedule the weekly eBay category taxonomy sync + hygiene cron."
It authenticates with `SUPABASE_SERVICE_KEY`, which `requireCronSecret()` accepts,
so it was not failing auth. **The function has been running; it just was not
running from pg_cron.**

This was then confirmed directly against production: `category_hygiene_log` holds
six rows, one per week from 2026-07-19 to 2026-08-23, every one `status = success`
— i.e. starting the week after `bb938ee` landed the GitHub Actions schedule. The
claim that the job "has never run" is false. Reassuringly, the two score-based
duties that Phase 5 deleted were no-ops in every logged run (`"expired": 0`,
`"audit_cleaned": 0`), so removing them destroyed no behaviour that was actually
doing work.

**One open question from those logs.** The first three runs are timestamped
`03:11:23`, `03:11:16`, and `03:11:19` — three consecutive weeks agreeing to within
seven seconds — then the last three move to `02:47`, `02:31`, `02:33`. The later,
jittery times are what a 02:00 UTC GitHub Actions schedule looks like (Actions cron
drifts by tens of minutes under queue load). The earlier seconds-precise cluster at
exactly `03:11` is not, and `03:11` happens to be `sync-ebay-taxonomy-weekly`'s
pg_cron slot. No migration and no Edge Function in this repo posts
`category-hygiene-cron` at that time, so if those three runs were not unusually
consistent Actions jitter, the remaining explanation is a **pg_cron job created by
hand in the Supabase Dashboard** — which `20260331000000_schedule_category_hygiene_cron.sql`
explicitly offered as "Option 1" and which would be invisible to this repo.
Settle it with `SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;`
before assuming pg_cron is now the only scheduler; if a Dashboard-created job
exists, it needs unscheduling too.

The narrow conclusion Phase 1 acted on — that no `cron.schedule()` call existed —
was correct, and scheduling the job from pg_cron is still the right end state.
But because the GitHub Actions schedule was left in place alongside it, the job
became **double-scheduled**: GitHub Actions at Sunday 02:00 UTC and pg_cron at
Sunday 04:11 UTC. That was actively harmful rather than merely wasteful, because
pg_cron's 04:11 slot was chosen specifically to land after the 03:11 taxonomy
sync so Phase 5's rot detection reads a fresh `ebay_taxonomy_cache`; the 02:00
run evaluated `find_rotted_mappings()` against a week-old cache and could flag
rows `needs_review` on stale evidence. (`sync-ebay-taxonomy` was likewise
double-invoked, 03:00 via Actions and 03:11 via pg_cron — a full-tree eBay pull
twice, 11 minutes apart.)

Fixed by making pg_cron the single scheduler: both jobs in
`category-taxonomy-sync.yml` are now `workflow_dispatch`-only, leaving the
weekly golden-corpus snapshot refresh as that workflow's only scheduled job.

**Method note worth carrying forward:** "is this job scheduled?" is not answerable
from `supabase/migrations/` alone in this repo. Cron-shaped work lives in at least
two places — pg_cron migrations and `.github/workflows/*.yml` — so both need
checking before concluding a function is dormant.

---

## 2. The new resolver: filter-then-rank, no score

### 2.1 Data flow (replaces `category-lookup/index.ts`'s current winner-selection block)

```
                         ┌─────────────────────────┐
                         │   Layer 0: Identity      │
                         │   UPC/EAN/ISBN/catalog   │──── match? ──► DONE (fact, not guess)
                         └───────────┬─────────────┘
                                     │ no match
                         ┌───────────▼─────────────┐
                         │  Gather candidates from: │
                         │  - user_verified mapping │
                         │  - eBay getCategorySugg. │
                         │  - db_exact mapping      │
                         │  - Gemini's categoryQuery │
                         │    guess (as ONE more    │
                         │    candidate, not oracle)│
                         └───────────┬─────────────┘
                                     │
                         ┌───────────▼─────────────┐
                         │  Layer 1: HARD GATES     │
                         │  (query ebay_taxonomy_   │
                         │   cache + live policy    │
                         │   APIs; ALL must pass)   │
                         │                          │
                         │  1. Exists in cache AND  │
                         │     is_leaf = true       │
                         │  2. Category is ACTIVE   │
                         │     (not just cached —   │
                         │     live check, cache    │
                         │     may be ≤7 days stale)│
                         │  3. Accepts this item's  │
                         │     condition            │
                         │     (getItemConditionPolicies)│
                         │  4. Required aspects are │
                         │     satisfiable from     │
                         │     what we know about   │
                         │     the item             │
                         │                          │
                         │  Anything failing ANY    │
                         │  gate is DROPPED, not    │
                         │  demoted or scored down. │
                         └───────────┬─────────────┘
                                     │ survivors only
                         ┌───────────▼─────────────┐
                         │  Layer 2: PRECEDENCE     │
                         │  (first match wins, no   │
                         │   arithmetic)            │
                         │                          │
                         │  1. user_verified survivor│──► DONE, locked
                         │  2. identity/catalog match│──► DONE, locked
                         │  3. eBay rank #1 survivor │──► candidate for Layer 3
                         │  4. no survivors          │──► NEEDS_CONFIRMATION
                         └───────────┬─────────────┘
                                     │ (case 3 only)
                         ┌───────────▼─────────────┐
                         │  Layer 3: AGREEMENT      │
                         │  CHECK (routing, not     │
                         │  scoring)                │
                         │                          │
                         │  - Do ≥2 independent     │
                         │    sources agree on the  │
                         │    same leaf?            │
                         │  - Is eBay's #1 clearly  │
                         │    separated from #2     │
                         │    (different subtree)?  │
                         │                          │
                         │  BOTH yes → auto-publish │
                         │  EITHER no → NEEDS_CONFIRMATION│
                         └──────────────────────────┘
```

`NEEDS_CONFIRMATION` is a **result**, returned to the frontend with the top 2–3 surviving candidates (breadcrumbs, not raw IDs) for a one-tap choice — the same UX pattern already agreed for condition confirmation ("Gemini can guess a condition, user can use drop down to validate"). It is never silently resolved by picking `allCandidates[0]`.

### 2.2 What gets deleted

- `computeEffectiveScore()` and every weight constant (`db_exact_user_verified: 15`, `ebay_api: 12`, etc.)
- `nonLeafPenalty`, `genericPenalty`, `ambiguityPenalty`
- `DETERMINISTIC_LOCK_THRESHOLD = 92`
- The `winner = allCandidates[0]` unconditional fallback (this is the exact line that put the Columbian Half in category 99)
- The hardcoded hierarchical coin/bullion/collectibles ID list inside the `analyze-item` tool-schema prompt (Finding B says this must go regardless of the resolver rewrite — it contains dead IDs today)
- `KNOWN_PARENT_CATEGORY_IDS` static list in `leafCategoryGuard.ts` — replaced by a live `is_leaf` lookup against `ebay_taxonomy_cache`, which Finding B shows is already more current than the static list

### 2.3 What's kept

- `verifyCategoryLeafActive()` — becomes gate 1+2, called against the cache first (fast path) with a live API fallback only when the cache row is missing or older than 7 days
- `categoryAcceptsCondition()` from PR #527 — this **is** gate 3, already built correctly, additive and fail-safe
- The `categoryQuery` clean-phrase extraction from PR #528 — still the right input to send to eBay's suggestion endpoint, unchanged
- `getItemAspectsForCategory` — currently called only for populating the UI's specifics form; promoted to also be gate 4's data source

### 2.4 New: gate 4, required-aspect satisfiability

This is the one genuinely new gate, not a rewrite of something existing. Rationale: if eBay says a category requires `Composition` and `Year` and the analysis has produced neither, that is evidence the category is wrong, not merely a form-filling problem to solve after the fact. Implementation is deliberately conservative for v1 — only _required_ (not recommended) aspects are checked, and the check is "do we have a plausible value from identification, Gemini's structured output, or OCR," not an exact match. Over-rejecting here is a known risk (see §5), so this gate ships behind a flag that defaults to _warn, don't drop_ for the first two weeks (see §6, Phase 3).

---

## 3. Cron jobs — what's needed to keep this running

Three jobs, one deleted, two kept/changed size. This directly answers "does the new methodology still need the cron" — for two of the three duties currently living in cron jobs, no; for the third, yes and it's the most important one.

### 3.1 `sync-ebay-taxonomy` — **keep, unchanged in cadence, becomes load-bearing**

Currently this job populates `ebay_taxonomy_cache` and `ebay_taxonomy_meta` (PR #528). Today it's advisory — nothing reads `ebay_taxonomy_cache` at request time. **Under the new resolver, it becomes the primary source of truth for gate 1 (leaf existence).** This raises its importance from "nice to have, replaces hardcoded maps" to "if this table is stale, gate 1 makes wrong decisions."

Given Finding B — that hardcoded IDs can silently go dead between syncs — I'd tighten this job rather than leave it as-is:

- **Keep weekly cadence** (`11 3 * * 0`), that's a reasonable balance against eBay's rate limits for a full-tree pull.
- **Add:** on tree-version change (already detected and logged per PR #528), also **diff the old and new ID sets** and log which IDs disappeared. This turns the Finding B discovery from "found by an AI agent reading two CSVs by hand" into "logged automatically the week it happened." Cheap to add — the full tree is already in memory during the sync.
- **Add:** expose `SELECT COUNT(*) FROM ebay_taxonomy_cache WHERE synced_at < NOW() - INTERVAL '8 days'` as a health-check value in the function's JSON response, so staleness is visible without a manual query.

### 3.2 `category-hygiene-cron` — **rewrite, shrink, and actually schedule it**

Two of its four current jobs are score-dependent and disappear with the resolver rewrite:

- ~~Decay `effective_score` by 5 after 90 days~~ — no score to decay.
- ~~Expire rows with `effective_score ≤ 10`~~ — no score to threshold against.

Two are independent of scoring and are kept, with dedup's logic changed:

- **Dedup**, changed from "keep highest `effective_score`" to **"keep the `user_verified` row if one exists among the duplicates; otherwise keep the most recently successfully-published row; reject the rest."** This is a precedence rule, not a score comparison — consistent with §2's "no arithmetic" principle.
- **Audit cleanup** (`lookup_decisions` older than 180 days) — unchanged, this was never score-related.

One entirely new job, replacing the two deleted ones as the thing that actually keeps `category_mappings` healthy under the new model:

- **Rot detection.** Weekly, find `category_mappings` rows whose `ebay_category_id` is no longer `is_leaf = true` in the (now-current) `ebay_taxonomy_cache` — i.e., the exact Finding B scenario, but for entries in _our own_ table instead of the AI prompt. Flag these `status = 'needs_review'` rather than silently rejecting them, since a human should confirm the replacement.

And critically: **this job must actually be wired to `cron.schedule()`** this time (Finding D). Same pattern as the five jobs that do work correctly — I'd follow `20260818030000_schedule_inventory_sync_cron.sql` as the template, since it's the most recently written and already handles the vault-secret auth pattern correctly.

### 3.3 New: `category-corpus-replay` — **not a production cron, a CI/manual job**

Not scheduled against production data. Runs the resolver against the golden corpus (§4) either in CI on every PR touching `category-lookup` or `analyze-item`, or manually via a script. This is what makes "did this change help or hurt" answerable instead of asserted. Detailed in §4.

### 3.4 Net effect on cron surface area

| Job                      | Before                                             | After                                                                   |
| ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `sync-ebay-taxonomy`     | Runs weekly, output mostly unused                  | Runs weekly, output load-bearing (gate 1) + drift-diff logging          |
| `category-hygiene-cron`  | Written, never scheduled, 4 duties (2 score-based) | Scheduled, 3 duties (dedup by precedence, audit cleanup, rot detection) |
| `category-corpus-replay` | Doesn't exist                                      | New, CI-triggered, not a production cron                                |

So: **one cron shrinks and finally gets turned on, one cron gains importance it didn't earn before, one "cron" is really a CI check.** No net increase in scheduled production jobs.

---

## 4. The golden corpus + replay harness

### 4.1 Seed data (already in hand, zero new collection work)

- All 40 rows from `category_mappings_rows.csv`, each converted to a corpus case: `{ input: item_type_normalized, expected: ebay_category_id, note: why this is a good test }`. The 3 known-wrong sports-card rows and the `1942 mercury dime → bullion` misroute become **regression cases with the corrected expected value**, not cases that assert the current wrong behavior.
- The 1893 Columbian Half Dollar (from the two screenshots), expected = `179531` ("Silver (1892-1954)" under `Coins & Paper Money > Coins: US > Commemorative`, confirmed present and correctly a leaf in the live cache — corrected during implementation; `39461` was misidentified earlier and is actually Washington Quarters (1932-98), not a Half Dollar/Commemorative category at all).
- One case per Finding B dead ID, e.g. "graded Canadian coin" expected to resolve into the real `Coins: Canada` branch, not the retired `40196`.

That's roughly 45 cases before any deliberate new authoring — enough to catch a real regression, not enough to claim coverage. Growing this corpus from real user corrections going forward (§4.3) is what makes it converge over time.

### 4.2 Harness mechanics

A script (`scripts/category-corpus-replay.ts`, Deno) that:

1. Loads the corpus JSON.
2. Calls the resolver's core function directly (in-process, not over HTTP) against a snapshotted copy of `ebay_taxonomy_cache` — snapshotted so replay results don't silently change when the live table syncs mid-comparison.
3. For each case, records: resolved category, whether it matches expected, and — critically — **which gate rejected each candidate that didn't survive**, so a regression shows _why_, not just _that_.
4. Diffs against the previous run's output (checked into `outputs/corpus-baseline.json`), printing exactly "fixed: X, broke: Y" with case names for each.
5. Exit code non-zero if any previously-passing case regresses, for CI gating.

### 4.3 Keeping the corpus alive (this is the part that's easy to let rot)

- Every time a human corrects a category in the UI (the `user_verified` write path), the corrected case is appended to the corpus automatically, not just to `category_mappings`. This is a small addition to the same write path already planned in the "learning loop fix" discussed earlier.
- The rot-detection cron job (§3.2) treats any corpus case whose expected category fails gate 1 the same way it treats `category_mappings` rows — flags it, doesn't silently keep it, since Finding B proves "confirmed correct once" has an expiry date.

---

## 5. Known risks and honest limitations

**I could not verify the live tree against eBay's authoritative API in this sandbox** — eBay returns HTTP 403 to unauthenticated scraping (confirmed by testing all 25 distinct IDs from `category_mappings` earlier in this conversation). Everything in Finding B is a comparison between the codebase's hardcoded lists and the **exported cache table**, not a live eBay call. If the export itself is stale or the sync had a partial failure that week, some "missing" IDs could be a cache gap rather than a genuine eBay retirement. The tree-version-diff logging proposed in §3.1 is partly there to make this distinction visible going forward; for right now, I'd treat Finding B as "these IDs need live re-verification before deletion," not as certain.

**Gate 4 (required-aspect satisfiability) is the riskiest new piece.** It's plausible but untested that this gate could over-reject in the corpus's early days simply because identification data is incomplete for reasons unrelated to category correctness (e.g., a coin's mint mark wasn't visible in the photo). That's why §2.4 specifies it ships in warn-only mode first — logged as a signal, not enforced as a rejection, until the corpus shows it isn't producing false positives.

**The precedence rule for dedup ("keep user_verified, else most recent success") is a judgment call**, not something I can prove is better than a score from the data alone — it's consistent with the "no arithmetic" principle but if two _different_ human corrections genuinely conflict (rare, but the 40-row table already has near-misses), this rule needs a tie-break that this plan doesn't fully specify yet. I'd rather flag that gap now than paper over it with a plausible-sounding number.

**This plan does not re-litigate whether Gemini should ever choose a category directly.** Per the earlier architecture discussion, it shouldn't — Gemini's `categoryQuery` output is one candidate signal among several, never an oracle. That's preserved here; I'm calling it out because it would be an easy detail to lose in a large rewrite.

---

## 6. Suggested phasing (not a timeline commitment, just dependency order)

1. **Schedule `category-hygiene-cron` properly** (Finding D fix) — zero resolver risk, unblocks visibility into whether dedup/cleanup even help before the bigger rewrite.
2. **Tourniquet the Columbian-half class of bug**: add `179531`/`179532`/`179533`/`179534`/`529` (the real US Commemorative leaves, confirmed live), remove `45243` and the five dead World Coins IDs from the AI prompt now that Finding B is confirmed, replace them with the correct live per-country leaf sets, replace `winner = allCandidates[0]` with `NEEDS_CONFIRMATION`. Small, immediately reduces live risk, doesn't require the full rewrite.
3. **Build the corpus + replay harness** using the 45 seed cases — before touching the resolver's internals further, so the next change is measurable.
4. **Filter-then-rank resolver rewrite** (§2), gates 1–3 enforced, gate 4 in warn-only mode, validated against the corpus at every step.
5. **`sync-ebay-taxonomy` hardening** (drift-diff logging, staleness health check) and **`category-hygiene-cron` rewrite** (dedup-by-precedence, rot detection) — these depend on the resolver's shape being settled so dedup precedence rules match what the resolver actually produces.
6. **Promote gate 4 to enforcing**, once the corpus shows two weeks of warn-only data with no false-positive pattern.

This is a plan for review, not a commitment to build all six phases in one sitting — happy to scope any single phase into its own PR-sized piece of work on your go-ahead.
