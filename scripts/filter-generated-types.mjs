// One-off filter: the linked Supabase project is shared production infra
// between this listing app and an unrelated CRM/WaaS product (see CLAUDE.md
// "Rebrand & migration" section). `supabase gen types` pulls the whole public
// schema, so this strips every table/view/function/enum this repo's own
// migrations don't own before the result is committed.
// Run: node scripts/filter-generated-types.mjs <input> <output>
import { readFileSync, writeFileSync } from "node:fs";

const ALLOWED_TABLES = new Set([
  "category_aspects_cache",
  "category_hygiene_log",
  "category_mappings",
  "competitor_prices",
  "cost_alerts",
  "drafts",
  "ebay_taxonomy_cache",
  "ebay_taxonomy_meta",
  "gemini_usage",
  "knowledge_base",
  "listing_cogs",
  "listing_financials",
  "lookup_decisions",
  "market_price_history",
  "market_watches",
  "optimization_history",
  "org_invitations",
  "org_members",
  "organizations",
  "profiles",
  "reprice_rules",
  "spot_price_cache",
  "subscriptions",
  "support_tickets",
  "test_items",
  "usage_tracking",
  "user_active_listings",
]);

const ALLOWED_VIEWS = new Set(["domain_quality_metrics"]);

const ALLOWED_FUNCTIONS = new Set([
  "accept_invitation",
  "find_duplicate_mappings",
  "find_rotted_mappings",
  "get_free_tier_window_start",
  "get_next_competitor_price_batch",
  "get_user_org_id",
  "get_users_for_inventory_sync",
  "handle_new_user",
  "increment_sku_sequence",
  "is_org_member",
  "is_org_owner",
  "match_knowledge_base",
  "set_ebay_taxonomy_cache_updated_at",
  "set_ebay_taxonomy_meta_updated_at",
  "set_listing_cogs_updated_at",
  "set_listing_financials_updated_at",
  "set_market_watches_updated_at",
  "set_updated_at",
]);

const ALLOWED_ENUMS = new Set(["org_role"]);

const [inputPath, outputPath] = process.argv.slice(2);
const lines = readFileSync(inputPath, "utf8").split("\n");

function findLine(from, exact) {
  for (let i = from; i < lines.length; i++) {
    if (lines[i] === exact) return i;
  }
  throw new Error(`line not found: ${exact} (searching from ${from})`);
}

function findLineMatching(from, re) {
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  throw new Error(`no line matching ${re} (searching from ${from})`);
}

function filterSection(sectionStart, allowed, label) {
  // sectionStart points at e.g. "    Tables: {" (4-space indent).
  // The section ends with "    };" (type literal) or "    }," / "    }" (object literal).
  const sectionEnd = findLineMatching(sectionStart + 1, /^    \}[;,]?$/);
  const kept = [];
  let i = sectionStart + 1;
  let removed = [];
  while (i < sectionEnd) {
    const m = lines[i].match(/^      ([A-Za-z_][A-Za-z0-9_]*):/);
    if (!m) {
      throw new Error(`unexpected line in ${label} section: ${lines[i]}`);
    }
    const name = m[1];
    let j = i + 1;
    while (j < sectionEnd && !/^      [A-Za-z_][A-Za-z0-9_]*:/.test(lines[j])) {
      j++;
    }
    if (allowed.has(name)) {
      kept.push(...lines.slice(i, j));
    } else {
      removed.push(name);
    }
    i = j;
  }
  console.error(`${label}: kept ${allowed.size}, dropped ${removed.length}`);
  return { kept, sectionEnd, removedCount: removed.length };
}

const publicStart = findLine(0, "  public: {");

const tablesStart = findLine(publicStart, "    Tables: {");
const tablesRes = filterSection(tablesStart, ALLOWED_TABLES, "Tables");

const viewsStart = findLine(tablesRes.sectionEnd, "    Views: {");
const viewsRes = filterSection(viewsStart, ALLOWED_VIEWS, "Views");

const functionsStart = findLine(viewsRes.sectionEnd, "    Functions: {");
const functionsRes = filterSection(functionsStart, ALLOWED_FUNCTIONS, "Functions");

const enumsStart = findLine(functionsRes.sectionEnd, "    Enums: {");
const enumsRes = filterSection(enumsStart, ALLOWED_ENUMS, "Enums");

// `export const Constants = { public: { Enums: {...} } }` at the tail
// duplicates the same enum list as runtime arrays -- filter it too.
const constantsPublicStart = findLine(enumsRes.sectionEnd, "  public: {");
const constantsEnumsStart = findLine(constantsPublicStart, "    Enums: {");
const constantsEnumsRes = filterSection(
  constantsEnumsStart,
  ALLOWED_ENUMS,
  "Constants.Enums",
);

const out = [
  ...lines.slice(0, tablesStart + 1),
  ...tablesRes.kept,
  ...lines.slice(tablesRes.sectionEnd, viewsStart + 1),
  ...viewsRes.kept,
  ...lines.slice(viewsRes.sectionEnd, functionsStart + 1),
  ...functionsRes.kept,
  ...lines.slice(functionsRes.sectionEnd, enumsStart + 1),
  ...enumsRes.kept,
  ...lines.slice(enumsRes.sectionEnd, constantsEnumsStart + 1),
  ...constantsEnumsRes.kept,
  ...lines.slice(constantsEnumsRes.sectionEnd),
];

writeFileSync(outputPath, out.join("\n"));
console.error(`wrote ${outputPath} (${out.length} lines)`);
