#!/usr/bin/env node
/**
 * Golden-corpus replay harness (Category Resolver v2, Phase 3).
 *
 * Validates corpus/golden_corpus.json against the frozen taxonomy snapshot
 * in corpus/ebay_taxonomy_snapshot.json, and cross-checks
 * supabase/functions/_helpers/leafCategoryGuard.ts's KNOWN_PARENT_CATEGORY_IDS
 * blocklist so that every dead/forbidden id documented in the corpus is
 * actually enforced in production code.
 *
 * This is a STATIC / offline harness. It does not call the live
 * category-lookup edge function (that would require a running Supabase
 * instance + eBay credentials), so it cannot yet prove the *resolver
 * behavior* end-to-end. What it DOES prove, deterministically and
 * reproducibly, for every corpus case:
 *
 *   1. Every `expected_category_id` (and each sub_case's) is a REAL leaf
 *      in the frozen taxonomy snapshot (is_leaf === true). If the expected
 *      answer itself isn't a valid leaf, the corpus case is wrong.
 *   2. Every `forbidden_category_id` / `dead_category_id` is confirmed
 *      NOT ship-able: either entirely absent from the snapshot, or present
 *      but is_leaf === false (a rollup/branch node). `forbidden_wrong_answer_ids`
 *      (real leaves that would just be a wrong pick for that item, e.g.
 *      Washington Quarters for a Columbian Half Dollar) are checked only for
 *      being valid leaves, not for being blocklisted.
 *   3. For `must_not_regress` cases, the dead/forbidden ids are also
 *      present in leafCategoryGuard.ts's KNOWN_PARENT_CATEGORY_IDS set --
 *      i.e. the guard that runs in production actually blocks them, not
 *      just the corpus documenting that they're bad.
 *   4. For `quarantine_needs_review` cases, the currently-stored id is
 *      confirmed to still be a valid (if imprecise) leaf -- these are
 *      informational only and never fail the run.
 *
 * Usage:
 *   node scripts/replay-corpus.mjs
 *
 * Exit code 0 = all hard checks passed. Exit code 1 = at least one
 * hard-check failure (run details are printed to stdout).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildCategoryIndex,
  extractGuardBlocklist,
  isConfirmedLeaf,
  isConfirmedNotShippable,
} from "./lib/taxonomySnapshot.mjs";

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

function loadJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function main() {
  const corpus = loadJson(CORPUS_PATH);
  const snapshot = loadJson(SNAPSHOT_PATH);
  const guardSrc = readFileSync(GUARD_PATH, "utf8");

  const categoryIndex = buildCategoryIndex(snapshot.categories);
  const guardBlocklist = extractGuardBlocklist(guardSrc);

  console.log(`Loaded ${corpus.cases.length} corpus cases.`);
  console.log(
    `Loaded ${snapshot.categories.length} taxonomy rows from snapshot.`,
  );
  console.log(
    `Loaded ${guardBlocklist.size} ids from leafCategoryGuard.ts KNOWN_PARENT_CATEGORY_IDS.`,
  );
  console.log("");

  const failures = [];
  const infoNotes = [];

  function checkExpected(caseId, expectedId, label = "expected_category_id") {
    if (!expectedId) return;
    if (!isConfirmedLeaf(expectedId, categoryIndex)) {
      failures.push(
        `[${caseId}] ${label}=${expectedId} is NOT a confirmed live leaf in the taxonomy snapshot.`,
      );
    }
  }

  function checkForbidden(caseId, ids) {
    for (const id of ids || []) {
      if (!isConfirmedNotShippable(id, categoryIndex)) {
        failures.push(
          `[${caseId}] forbidden id ${id} is actually a confirmed LIVE LEAF in the snapshot -- ` +
            `this id should not be in forbidden_category_ids (or the snapshot is stale).`,
        );
      }
    }
  }

  // forbidden_wrong_answer_ids are real, valid leaves elsewhere in the tree
  // that would simply be the WRONG answer for this specific item (a plausible
  // mis-identification, not a dead/non-leaf id -- e.g. 39461 "Washington
  // Quarters" is a perfectly good leaf, just not for a Columbian Half
  // Dollar). We only sanity-check that the id really is a leaf (so the
  // corpus case is well-formed); we do NOT expect it in the guard blocklist,
  // since globally blocking a real leaf would break legitimate listings.
  function checkForbiddenWrongAnswer(caseId, ids) {
    for (const id of ids || []) {
      if (!isConfirmedLeaf(id, categoryIndex)) {
        failures.push(
          `[${caseId}] forbidden_wrong_answer_ids entry ${id} is NOT a confirmed live leaf -- ` +
            `it should either be moved to forbidden_category_ids or removed.`,
        );
      }
    }
  }

  // forbidden_junk_leaf_ids are the awkward middle case that neither field
  // above covers: ids that ARE live, active leaves (so checkForbidden would
  // reject them as "actually a confirmed LIVE LEAF") yet must never be shipped
  // for anything, so they are globally blocklisted -- 88433 "Everything Else >
  // Every Other Thing" and its parent 99. Unlike forbidden_wrong_answer_ids,
  // being wrong for THIS item is not the point; they are wrong for every item,
  // and production must actually block them. So we assert both halves: the id
  // is a real leaf (the case is well-formed and the snapshot is not stale) AND
  // it is present in KNOWN_PARENT_CATEGORY_IDS (the code really refuses it).
  //
  // Added 2026-09-15 after a sterling silver pendant was locked to 88433 by
  // analyze-item's grounded-category path, which verified leaf status and never
  // consulted the blocklist. The corpus had no way to express that failure.
  function checkForbiddenJunkLeaf(caseId, ids) {
    for (const id of ids || []) {
      if (!isConfirmedLeaf(id, categoryIndex)) {
        failures.push(
          `[${caseId}] forbidden_junk_leaf_ids entry ${id} is NOT a confirmed live leaf -- ` +
            `if it is dead or a rollup it belongs in forbidden_category_ids instead.`,
        );
      }
      if (!guardBlocklist.has(String(id))) {
        failures.push(
          `[${caseId}] forbidden_junk_leaf_ids entry ${id} is NOT present in ` +
            `leafCategoryGuard.ts's KNOWN_PARENT_CATEGORY_IDS -- production code does ` +
            `not actually refuse this junk catch-all.`,
        );
      }
    }
  }

  function checkGuardEnforcement(caseId, ids) {
    for (const id of ids || []) {
      if (!guardBlocklist.has(String(id))) {
        failures.push(
          `[${caseId}] dead/forbidden id ${id} is NOT present in leafCategoryGuard.ts's ` +
            `KNOWN_PARENT_CATEGORY_IDS -- production code does not actually block it.`,
        );
      }
    }
  }

  for (const c of corpus.cases) {
    switch (c.kind) {
      case "must_resolve": {
        if (c.expected_category_id) {
          checkExpected(c.id, c.expected_category_id);
        }
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
        checkForbiddenJunkLeaf(c.id, c.forbidden_junk_leaf_ids);
        break;
      }
      case "must_not_regress": {
        checkExpected(c.id, c.expected_category_id);
        checkForbidden(c.id, c.forbidden_category_ids);
        checkForbiddenWrongAnswer(c.id, c.forbidden_wrong_answer_ids);
        checkForbiddenJunkLeaf(c.id, c.forbidden_junk_leaf_ids);
        if (c.dead_category_id) {
          if (!isConfirmedNotShippable(c.dead_category_id, categoryIndex)) {
            failures.push(
              `[${c.id}] dead_category_id=${c.dead_category_id} is actually a confirmed LIVE LEAF ` +
                `in the snapshot -- this case's premise (that the id is dead) is false.`,
            );
          }
          checkGuardEnforcement(c.id, [c.dead_category_id]);
        }
        break;
      }
      case "must_confirm": {
        checkForbidden(c.id, c.forbidden_category_ids);
        infoNotes.push(
          `[${c.id}] must_confirm case -- cannot be validated statically (requires live ` +
            `resolver invocation); documented expected_outcome=${c.expected_outcome ?? "n/a"}.`,
        );
        break;
      }
      case "quarantine_needs_review": {
        if (c.ebay_category_id) {
          const leafOk = isConfirmedLeaf(c.ebay_category_id, categoryIndex);
          infoNotes.push(
            `[${c.id}] quarantine case -- stored id ${c.ebay_category_id} is ` +
              `${leafOk ? "a valid (if imprecise) leaf" : "NOT a valid leaf -- worth escalating to must_not_regress"}.`,
          );
        } else {
          infoNotes.push(
            `[${c.id}] quarantine case -- no single ebay_category_id to check (structural issue).`,
          );
        }
        break;
      }
      default:
        failures.push(`[${c.id}] unknown case kind: ${c.kind}`);
    }
  }

  if (infoNotes.length) {
    console.log("Informational (non-failing) notes:");
    for (const n of infoNotes) console.log("  - " + n);
    console.log("");
  }

  if (failures.length) {
    console.log(`FAILED: ${failures.length} hard-check failure(s):`);
    for (const f of failures) console.log("  ✗ " + f);
    console.log("");
    process.exitCode = 1;
  } else {
    console.log(
      `PASSED: all ${corpus.cases.length} corpus cases are consistent with the taxonomy snapshot ` +
        `and the leafCategoryGuard.ts blocklist.`,
    );
  }
}

main();
