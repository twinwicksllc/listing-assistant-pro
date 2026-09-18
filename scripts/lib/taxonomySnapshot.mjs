/**
 * Shared helpers for scripts/replay-corpus.mjs and
 * scripts/refresh-taxonomy-snapshot.mjs -- both scripts validate the golden
 * corpus against a taxonomy category index (one frozen/committed, one live
 * from Supabase) and both need to know what leafCategoryGuard.ts's
 * KNOWN_PARENT_CATEGORY_IDS blocklist actually contains. Extracted here so a
 * bugfix to this logic doesn't require touching two files that had drifted
 * out of sync with no guarantee of staying that way (see todo.md).
 *
 * extractGuardBlocklist() deliberately reads leafCategoryGuard.ts as TEXT and
 * scrapes the Set literal by constant name -- it does NOT import the file.
 * Per CLAUDE.md: "Do not convert that Set literal into an import, rename it,
 * or move the file" -- both callers need this to keep working as a
 * text-scrape even if leafCategoryGuard.ts's other exports change shape.
 */

export function buildCategoryIndex(categories) {
  const byId = new Map();
  for (const cat of categories) {
    byId.set(String(cat.category_id), cat);
  }
  return byId;
}

export function extractGuardBlocklist(guardSrc) {
  // KNOWN_PARENT_CATEGORY_IDS is defined as `new Set<string>([ "id", // comment ... ])`.
  // Pull every quoted numeric-looking string literal between the Set([ ... ]) bounds.
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

export function isConfirmedNotShippable(id, categoryIndex) {
  const cat = categoryIndex.get(String(id));
  if (!cat) return true; // absent entirely from the live tree -- definitely not shippable
  return cat.is_leaf === false; // present but a rollup/branch node
}

export function isConfirmedLeaf(id, categoryIndex) {
  const cat = categoryIndex.get(String(id));
  return !!cat && cat.is_leaf === true;
}
