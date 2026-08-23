# Fix: Leaf-only eBay category selection + aspect refresh on category change

## Root Causes Identified

- [x] Bug A: leaf validation reselect has no final guard — non-leaf still ships
- [x] Bug B: `verify` errors swallowed by non-blocking try/catch
- [x] Bug C: aspects hook ref set before await, never rolled back -> no retry
- [x] Bug D: aspects hook bails when aspects=[] leaving metadata null
- [x] Bug E: `currentEbayMetadata` in deps causes effect churn
- [x] Bug F: no user-visible signal that category is a parent

## Fixes

- [x] Add shared leaf-guard helper w/ coin-aware fallbacks (IDs verified live)
- [x] Enforce leaf-only in analyze-item before metadata resync
- [x] Add `isLeaf` to aspects response
- [x] Rewrite useAnalyzeCategoryAspects: retry, prune, warn
- [x] Warn user when category is a parent

## Delivery

- [x] 19 new tests; full suite 88/88 passing
- [x] Typecheck unchanged (271 pre-existing)
- [x] PR #525 opened

## CI fix-up (deno fmt failure + broader pre-existing checks audit)

- [x] `deno fmt --check supabase/functions/` failed on `leafCategoryGuard.ts`
      (multi-line ternary) — fixed with `deno fmt` (Deno 1.46.3, matches
      lockfile); re-checked: `Checked 82 files`, 0 errors
- [x] `deno lint --config supabase/functions/deno.json supabase/functions/` —
      `Checked 79 files`, 0 errors (no pre-existing issues)
- [x] `npm run format:check` (Prettier) — found 2 PR files needing
      reformatting (`useAnalyzeCategoryAspects.ts`,
      `leaf-category-guard.test.ts`); fixed with `prettier --write`; rest of
      tracked repo already clean
- [x] `npx eslint src/ --max-warnings 0` — 0 errors/warnings
- [x] `npx tsc --noEmit` (exact CI command, uses project references) — 0
      errors. Note: the "271" figure only appears when running
      `tsc -p tsconfig.app.json` directly (bypasses project-reference
      resolution); CI does not invoke it that way, so it is not a blocking
      regression. Left untouched per scope (large pre-existing app + Deno
      global-type noise, not introduced by this PR).
- [x] `npm run test` (vitest) — 88/88 passing
- [x] `npm run build` — succeeds
- [x] Restored stray deletions of unrelated config files from git index
- [x] Committed + pushed fmt/format fixes to
      `fix/leaf-only-category-and-aspect-refresh` (updates PR #525)
