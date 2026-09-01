import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildSystemPrompt, type PromptContext } from "./domainPrompts.ts";

// Regression guard for the 2026-09-01 stale-coin-category-ID cleanup (see
// todo.md's "Fix the stale/wrong-domain eBay coin-category IDs" entry).
//
// buildSystemPrompt("coins_bullion", ...) is the actual text sent to Gemini
// as the system prompt for coin/bullion items whenever no deterministic
// category is already locked (ctx.suggestedCategoryId unset) — confirmed by
// reading categoryBlock()'s early return and the Gemini call itself
// (analyze-item/index.ts: OpenAI-shim function calling, categoryId is a
// plain string with no enum, so this text is advisory, not schema-enforced).
// Before this cleanup, zero tests imported this module or asserted on its
// content, and the same stale-ID bug class was found independently three
// times with no automated guard. This extracts every "Label=ID" occurrence
// from the rendered prompt and cross-checks each ID against the frozen
// taxonomy snapshot, mirroring scripts/replay-corpus.mjs's approach.

const SNAPSHOT_PATH = "../../../corpus/ebay_taxonomy_snapshot.json";

interface SnapshotCategory {
  category_id: string;
  category_name: string;
  breadcrumb: string;
  is_leaf: boolean;
}

function loadSnapshot(): Map<string, SnapshotCategory> {
  const url = new URL(SNAPSHOT_PATH, import.meta.url);
  const raw = Deno.readTextFileSync(url);
  const parsed = JSON.parse(raw) as { categories: SnapshotCategory[] };
  return new Map(parsed.categories.map((c) => [c.category_id, c]));
}

function minimalContext(): PromptContext {
  return { itemName: "test coin", imageCount: 1 };
}

function extractLabelIds(prompt: string): Map<string, string> {
  // Matches the exact "Label=ID" shape used throughout buildCoinBullionPrompt's
  // "### CATEGORY IDs" block, e.g. "Morgan=39464" or "Sacagawea/Native American=11983".
  const found = new Map<string, string>();
  for (const m of prompt.matchAll(/([A-Za-z][A-Za-z /&().'"-]*?)=(\d{2,7})\b/g)) {
    found.set(m[2], m[1].trim());
  }
  return found;
}

Deno.test("buildSystemPrompt(coins_bullion): every hardcoded category ID is a confirmed live leaf", () => {
  const prompt = buildSystemPrompt("coins_bullion", minimalContext());
  const ids = extractLabelIds(prompt);
  const snapshot = loadSnapshot();

  const problems: string[] = [];
  for (const [id, label] of ids) {
    const cat = snapshot.get(id);
    if (!cat) {
      problems.push(`${id} (labeled "${label}") is ABSENT from the live taxonomy`);
    } else if (!cat.is_leaf) {
      problems.push(`${id} (labeled "${label}") is a NON-LEAF: ${cat.breadcrumb}`);
    } else if (!/coins|paper money/i.test(cat.breadcrumb)) {
      problems.push(
        `${id} (labeled "${label}") is a WRONG-DOMAIN live leaf: ${cat.breadcrumb}`,
      );
    }
  }

  assertEquals(problems, [], `\n${problems.join("\n")}`);
});

Deno.test("buildSystemPrompt(coins_bullion): extraction actually finds category IDs (sanity check)", () => {
  // Guards against the extractor itself silently matching nothing (e.g. after
  // a future rewording of the CATEGORY IDs block) and the test above passing
  // for the wrong reason — trivially, on an empty result set.
  const prompt = buildSystemPrompt("coins_bullion", minimalContext());
  const ids = extractLabelIds(prompt);
  if (ids.size < 20) {
    throw new Error(
      `Expected at least 20 Label=ID pairs in the coins_bullion prompt, found ${ids.size} — the extraction regex may no longer match the prompt's format.`,
    );
  }
});
