#!/usr/bin/env node
/**
 * Golden-corpus LIVE drift check + snapshot refresher (Category Resolver v2,
 * Phase 3/5 follow-up).
 *
 * scripts/replay-corpus.mjs validates the corpus against a frozen,
 * committed copy of the taxonomy (corpus/ebay_taxonomy_snapshot.json), which
 * is deliberately reproducible but goes stale the moment
 * sync-ebay-taxonomy-weekly refreshes the real ebay_taxonomy_cache table
 * (renames, removals, new leaves). This script closes that gap:
 *
 *   1. Pulls the CURRENT ebay_taxonomy_cache table straight from Supabase's
 *      REST API (paginated) using SUPABASE_URL + SUPABASE_SERVICE_KEY.
 *   2. Runs the exact same corpus validation logic as replay-corpus.mjs,
 *      but against this live data instead of the committed snapshot.
 *   3. Diffs the live data against the committed snapshot file and reports
 *      what changed (renamed categories, ids that disappeared, leaf-status
 *      flips, brand new rows).
 *   4. Writes the refreshed snapshot to corpus/ebay_taxonomy_snapshot.json
 *      (over the previous committed copy) so a follow-up `git diff` /
 *      PR shows exactly what drifted.
 *
 * Intended to run in CI (see .github/workflows/category-taxonomy-sync.yml)
 * immediately after sync-ebay-taxonomy-weekly completes, using the same
 * SUPABASE_URL / SUPABASE_SERVICE_KEY secrets already configured for that
 * workflow. Exits non-zero if any corpus case now fails against live data
 * (a real regression eBay introduced), which is distinct from -- and more
 * urgent than -- the snapshot simply being out of date.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/refresh-taxonomy-snapshot.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CORPUS_PATH = path.join(ROOT, "corpus", "golden_corpus.json");
const SNAPSHOT_PATH = path.join(ROOT, "corpus", "ebay_taxonomy_snapshot.json");
const GUARD_PATH = path.join(
  ROOT,
  "supabase",
  "functions",
  "_helpers",
  "leafCategoryGuard.ts",
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error(
    "FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars are required.",
  );
  process.exit(2);
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

async function fetchAllCategories() {
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/ebay_taxonomy_cache` +
      `?select=category_id,category_name,breadcrumb,parent_category_id,is_leaf` +
      `&order=category_id.asc` +
      `&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Supabase REST fetch failed (offset=${offset}): ${res.status} ${res.statusText} -- ${body}`,
      );
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

function buildCategoryIndex(categories) {
  const byId = new Map();
  for (const cat of categories) {
    byId.set(String(cat.category_id), cat);
  }
  return byId;
}

function extractGuardBlocklist(guardSrc) {
  const start = guardSrc.indexOf("KNOWN_PARENT_CATEGORY_IDS");
  if (start === -1) {
    throw new Error(
      "KNOWN_PARENT_CATEGORY_IDS not found in leafCategoryGuard.ts",
    );
  }
  const openParen = guardSrc.indexOf("([", start);
  const closeParen = guardSrc.indexOf("]);", openParen);
  if (openParen === -1 || closeParen === -1) {
    throw new Error(
      "Could not locate KNOWN_PARENT_CATEGORY_IDS Set([...]) bounds",
    );
  }
  const body = guardSrc.slice(openParen, closeParen);
  const ids = new Set();
  for (const m of body.matchAll(/"(\d+)"/g)) {
    ids.add(m[1]);
  }
  return ids;
}

function isConfirmedNotShippable(id, categoryIndex) {
  const cat = categoryIndex.get(String(id));
  if (!cat) return true;
  return cat.is_leaf === false;
}

function isConfirmedLeaf(id, categoryIndex) {
  const cat = categoryIndex.get(String(id));
  return !!cat && cat.is_leaf === true;
}

function validateCorpus(corpus, categoryIndex, guardBlocklist) {
  const failures = [];

  function checkExpected(caseId, expectedId, label = "expected_category_id") {
    if (!expectedId) return;
    if (!isConfirmedLeaf(expectedId, categoryIndex)) {
      failures.push(
        `[${caseId}] ${label}=${expectedId} is NOT a confirmed live leaf against the CURRENT ` +
          `Supabase table -- eBay may have renamed/removed/demoted this category.`,
      );
    }
  }

  function checkForbidden(caseId, ids) {
    for (const id of ids || []) {
      if (!isConfirmedNotShippable(id, categoryIndex)) {
        failures.push(
          `[${caseId}] forbidden id ${id} is now a confirmed LIVE LEAF against the CURRENT ` +
            `Supabase table -- eBay may have reinstated this category as a real leaf; the ` +
            `must_not_regress case (and leafCategoryGuard.ts's blocklist) should be re-reviewed.`,
        );
      }
    }
  }

  function checkForbiddenWrongAnswer(caseId, ids) {
    for (const id of ids || []) {
      if (!isConfirmedLeaf(id, categoryIndex)) {
        failures.push(
          `[${caseId}] forbidden_wrong_answer_ids entry ${id} is no longer a confirmed live leaf.`,
        );
      }
    }
  }

  function checkGuardEnforcement(caseId, ids) {
    for (const id of ids || []) {
      if (!guardBlocklist.has(String(id))) {
        failures.push(
          `[${caseId}] dead/forbidden id ${id} is NOT present in leafCategoryGuard.ts's ` +
            `KNOWN_PARENT_CATEGORY_IDS.`,
        );
      }
    }
  }

  for (const c of corpus.cases) {
    switch (c.kind) {
      case "must_resolve": {
        if (c.expected_category_id) checkExpected(c.id, c.expected_category_id);
        if (Array.isArray(c.sub_cases)) {
          for (const sc of c.sub_cases) {
            checkExpected(
              c.id,
              sc.expected_category_id,
              "sub_case.expected_category_id",
            );
          }
        }
        checkForbidden(c.id, c.forbidden_category_ids);
        checkForbiddenWrongAnswer(c.id, c.forbidden_wrong_answer_ids);
        break;
      }
      case "must_not_regress": {
        checkExpected(c.id, c.expected_category_id);
        checkForbidden(c.id, c.forbidden_category_ids);
        checkForbiddenWrongAnswer(c.id, c.forbidden_wrong_answer_ids);
        if (c.dead_category_id) {
          if (!isConfirmedNotShippable(c.dead_category_id, categoryIndex)) {
            failures.push(
              `[${c.id}] dead_category_id=${c.dead_category_id} is now a confirmed LIVE LEAF ` +
                `against the CURRENT Supabase table.`,
            );
          }
          checkGuardEnforcement(c.id, [c.dead_category_id]);
        }
        break;
      }
      case "must_confirm":
      case "quarantine_needs_review":
        // Not statically checkable / informational-only, same as replay-corpus.mjs.
        break;
      default:
        failures.push(`[${c.id}] unknown case kind: ${c.kind}`);
    }
  }

  return failures;
}

function diffSnapshots(oldSnap, newCategories) {
  const oldIndex = buildCategoryIndex(oldSnap.categories);
  const newIndex = buildCategoryIndex(newCategories);

  const added = [];
  const removed = [];
  const renamed = [];
  const leafFlipped = [];

  for (const [id, cat] of newIndex) {
    if (!oldIndex.has(id)) {
      added.push({ id, name: cat.category_name });
    }
  }
  for (const [id, cat] of oldIndex) {
    const nowCat = newIndex.get(id);
    if (!nowCat) {
      removed.push({ id, name: cat.category_name });
      continue;
    }
    if (nowCat.category_name !== cat.category_name) {
      renamed.push({ id, from: cat.category_name, to: nowCat.category_name });
    }
    if (nowCat.is_leaf !== cat.is_leaf) {
      leafFlipped.push({
        id,
        from: cat.is_leaf,
        to: nowCat.is_leaf,
        name: cat.category_name,
      });
    }
  }

  return { added, removed, renamed, leafFlipped };
}

async function main() {
  console.log(`Fetching live ebay_taxonomy_cache from ${SUPABASE_URL} ...`);
  const liveCategories = await fetchAllCategories();
  console.log(`Fetched ${liveCategories.length} rows.`);

  const corpus = loadJson(CORPUS_PATH);
  const oldSnapshot = loadJson(SNAPSHOT_PATH);
  const guardSrc = readFileSync(GUARD_PATH, "utf8");
  const guardBlocklist = extractGuardBlocklist(guardSrc);
  const liveIndex = buildCategoryIndex(liveCategories);

  console.log("");
  console.log("=== Diff vs. committed snapshot ===");
  const diff = diffSnapshots(oldSnapshot, liveCategories);
  console.log(`Added:        ${diff.added.length}`);
  console.log(`Removed:      ${diff.removed.length}`);
  console.log(`Renamed:      ${diff.renamed.length}`);
  console.log(`Leaf-flipped: ${diff.leafFlipped.length}`);
  if (diff.removed.length) {
    console.log("");
    console.log("Removed categories (first 20):");
    for (const r of diff.removed.slice(0, 20))
      console.log(`  - ${r.id}: ${r.name}`);
  }
  if (diff.renamed.length) {
    console.log("");
    console.log("Renamed categories (first 20):");
    for (const r of diff.renamed.slice(0, 20)) {
      console.log(`  - ${r.id}: "${r.from}" -> "${r.to}"`);
    }
  }
  if (diff.leafFlipped.length) {
    console.log("");
    console.log("Leaf-status flips (first 20):");
    for (const r of diff.leafFlipped.slice(0, 20)) {
      console.log(`  - ${r.id} (${r.name}): is_leaf ${r.from} -> ${r.to}`);
    }
  }

  console.log("");
  console.log("=== Validating golden corpus against LIVE data ===");
  const failures = validateCorpus(corpus, liveIndex, guardBlocklist);
  if (failures.length) {
    console.log(
      `FAILED: ${failures.length} corpus case(s) broke against live data:`,
    );
    for (const f of failures) console.log("  ✗ " + f);
  } else {
    console.log(
      `PASSED: all ${corpus.cases.length} corpus cases still hold against live data.`,
    );
  }

  console.log("");
  console.log("=== Refreshing corpus/ebay_taxonomy_snapshot.json ===");
  const newSnapshot = {
    snapshot_meta: {
      source: "ebay_taxonomy_cache (live Supabase REST fetch)",
      synced_at: new Date().toISOString(),
      row_count: liveCategories.length,
      purpose:
        "Deterministic snapshot for the Phase 3 golden-corpus replay harness. " +
        "Refreshed automatically by scripts/refresh-taxonomy-snapshot.mjs after " +
        "each sync-ebay-taxonomy-weekly run.",
    },
    categories: liveCategories.map((c) => ({
      category_id: String(c.category_id),
      category_name: c.category_name,
      breadcrumb: c.breadcrumb,
      parent_category_id: c.parent_category_id
        ? String(c.parent_category_id)
        : null,
      is_leaf: c.is_leaf === true,
    })),
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(newSnapshot, null, 2) + "\n");
  console.log(
    `Wrote ${newSnapshot.categories.length} rows to ${SNAPSHOT_PATH}`,
  );

  const hasDrift =
    diff.added.length ||
    diff.removed.length ||
    diff.renamed.length ||
    diff.leafFlipped.length;

  if (failures.length) {
    console.log("");
    console.log("Exiting non-zero: live data broke a golden-corpus guarantee.");
    process.exitCode = 1;
  } else if (hasDrift) {
    console.log("");
    console.log(
      "No corpus failures, but the live taxonomy has drifted from the committed snapshot. " +
        "The snapshot file has been refreshed on disk -- commit it (CI wraps this in a PR).",
    );
    process.exitCode = 0;
  } else {
    console.log("");
    console.log("No drift detected. Snapshot is already up to date.");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
