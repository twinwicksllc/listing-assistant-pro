# Category Resolver v2 — Golden Corpus (Phase 3)

Reference: `CATEGORY_RESOLVER_V2_IMPLEMENTATION_PLAN.md`

This directory contains the deterministic, offline test fixtures used to
guard against regressions in eBay category resolution (`category-lookup`,
`leafCategoryGuard.ts`, `suggestedCategories`, and the `analyze-item` AI
prompt's category allowlist).

## Files

- **`golden_corpus.json`** — the test cases themselves. Each case has a
  `kind`:
  - `must_resolve` — the resolver must land on `expected_category_id` (a
    confirmed live leaf) and must never surface anything in
    `forbidden_category_ids`.
  - `must_not_regress` — a previously-broken hardcoded/dead id
    (`dead_category_id`) must never resurface; `expected_category_id` is the
    confirmed-live replacement.
  - `must_confirm` — no candidate should be auto-shipped; the resolver must
    return `needsConfirmation`/`found: false` instead of guessing.
  - `quarantine_needs_review` — an existing mapping that is a valid leaf but
    is mislabeled, imprecise, or a redundant duplicate. Not a hard resolver
    bug; tracked here so Phase 5's hygiene-cron rewrite has a concrete
    worklist.

  Two different "forbidden" fields are used and mean different things:
  - `forbidden_category_ids` — ids that must **never** be shippable for any
    item, because they are dead/non-leaf/rollup nodes. The replay harness
    checks these are absent-or-non-leaf in the snapshot, and (for
    `must_not_regress` cases) that `leafCategoryGuard.ts` actually blocks
    them.
  - `forbidden_wrong_answer_ids` — ids that **are** valid leaves elsewhere in
    the tree, but would simply be the _wrong_ pick for that specific item
    (e.g. Washington Quarters `39461` for a Columbian Half Dollar). The
    harness only checks these are real leaves; it does not expect them to be
    globally blocklisted.

- **`ebay_taxonomy_snapshot.json`** — a frozen JSON export of the
  `ebay_taxonomy_cache` table (15,116 rows) at the time the corpus was
  written. Using a frozen snapshot instead of live DB/API calls means corpus
  results never change unless the snapshot is intentionally refreshed, so
  replay runs are 100% reproducible in CI and locally.

## Running the replay harness

```bash
node scripts/replay-corpus.mjs
```

This is a **static/offline** check — it does not invoke the live
`category-lookup` edge function (that would require a running Supabase
instance + eBay credentials). What it proves, deterministically:

1. Every `expected_category_id` (and each `sub_cases` entry) is a real leaf
   in the frozen snapshot.
2. Every `forbidden_category_id` / `dead_category_id` is confirmed
   non-shippable (absent from the snapshot, or present but `is_leaf: false`).
3. For `must_not_regress` cases, the dead/forbidden id is also present in
   `leafCategoryGuard.ts`'s `KNOWN_PARENT_CATEGORY_IDS` — i.e. the guard that
   runs in production actually blocks it, not just the corpus documenting
   that it's bad.
4. For `quarantine_needs_review` cases, the currently-stored id is checked
   for leaf validity and reported informationally (never fails the run).

Exit code `0` = all hard checks passed. Exit code `1` = at least one failure
(printed to stdout). This is wired into CI as the `category-corpus-replay`
job in `.github/workflows/test.yml` and is blocking.

## Refreshing the snapshot

If `ebay_taxonomy_cache` changes meaningfully (e.g. after a `sync-ebay-taxonomy`
run), re-export it and regenerate `ebay_taxonomy_snapshot.json` in the same
shape: `{ snapshot_meta: {...}, categories: [{ category_id, category_name,
breadcrumb, parent_category_id, is_leaf }, ...] }` with `is_leaf` as a real
JSON boolean. Re-run the harness afterward to confirm the corpus still holds.

## Adding a new case

1. Confirm the expected id against the live taxonomy cache (or snapshot).
2. Pick the right `kind` (see above).
3. Add the case to `cases` in `golden_corpus.json`.
4. Run `node scripts/replay-corpus.mjs` to confirm it's well-formed.
5. If it's a `must_not_regress` case, also add/confirm the dead id is in
   `leafCategoryGuard.ts`'s `KNOWN_PARENT_CATEGORY_IDS`, and add a matching
   unit test to `leafCategoryGuard.test.ts`.
