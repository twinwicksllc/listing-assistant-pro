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

// Phase 1.3b (2026-09-16): analyze-item's Pass 2 splits into two concurrent
// calls, one structured-extraction-only and one description-only, each built
// from the same domain prompt with a narrowed `promptMode`. These tests pin
// the two invariants the split depends on: (1) promptMode gates the right
// sections out of each mode, and (2) the default (undefined) mode is
// completely unaffected — byte-identical to how every caller before this
// split behaved, since that's the only thing preventing this from being a
// silent behavior change for every request that doesn't use the split.

const GATED_DOMAINS: Array<Parameters<typeof buildSystemPrompt>[0]> = [
  "coins_bullion",
  "general",
];

function contextWithCategoryAndAspects(): PromptContext {
  return {
    itemName: "test item",
    imageCount: 2,
    suggestedCategoryId: "12345",
    suggestedCategoryName: "Test Category",
    requiredAspects: ["Brand"],
    allowedValues: { Color: ["Red", "Blue"] },
  };
}

for (const domain of GATED_DOMAINS) {
  Deno.test(`buildSystemPrompt(${domain}, promptMode="structured"): excludes DESCRIPTION FORMATTING, includes category/aspect guidance`, () => {
    const prompt = buildSystemPrompt(domain, {
      ...contextWithCategoryAndAspects(),
      promptMode: "structured",
    });
    if (/### DESCRIPTION FORMATTING/.test(prompt)) {
      throw new Error(
        `promptMode="structured" must not include a DESCRIPTION FORMATTING section, but one was found in the ${domain} prompt`,
      );
    }
    if (!/### eBay CATEGORY|### CATEGORY IDs/.test(prompt)) {
      throw new Error(
        `promptMode="structured" must still include category guidance, but none was found in the ${domain} prompt`,
      );
    }
    if (!/### VALID ASPECT VALUES/.test(prompt)) {
      throw new Error(
        `promptMode="structured" must still include allowed-values guidance, but none was found in the ${domain} prompt`,
      );
    }
  });

  Deno.test(`buildSystemPrompt(${domain}, promptMode="description"): includes DESCRIPTION FORMATTING, excludes category/aspect guidance`, () => {
    const prompt = buildSystemPrompt(domain, {
      ...contextWithCategoryAndAspects(),
      promptMode: "description",
    });
    if (!/### DESCRIPTION FORMATTING/.test(prompt)) {
      throw new Error(
        `promptMode="description" must include a DESCRIPTION FORMATTING section, but none was found in the ${domain} prompt`,
      );
    }
    if (/### eBay CATEGORY|### CATEGORY IDs/.test(prompt)) {
      throw new Error(
        `promptMode="description" must not include category guidance, but some was found in the ${domain} prompt`,
      );
    }
    if (/### VALID ASPECT VALUES/.test(prompt)) {
      throw new Error(
        `promptMode="description" must not include allowed-values guidance, but some was found in the ${domain} prompt`,
      );
    }
  });

  Deno.test(`buildSystemPrompt(${domain}, promptMode=undefined): byte-identical to the pre-split full prompt (back-compat)`, () => {
    const ctx = contextWithCategoryAndAspects();
    const withUndefinedMode = buildSystemPrompt(domain, { ...ctx, promptMode: undefined });
    const withoutModeField = buildSystemPrompt(domain, ctx);
    assertEquals(withUndefinedMode, withoutModeField);
    // Both structured-only content and description-only content must be present
    // simultaneously — this is the "full prompt" every caller got before the
    // split existed, and it's what every caller that doesn't pass promptMode
    // still gets today.
    if (!/### DESCRIPTION FORMATTING/.test(withoutModeField)) {
      throw new Error(`Default (no promptMode) ${domain} prompt is missing DESCRIPTION FORMATTING`);
    }
    if (!/### eBay CATEGORY|### CATEGORY IDs/.test(withoutModeField)) {
      throw new Error(`Default (no promptMode) ${domain} prompt is missing category guidance`);
    }
  });
}

Deno.test('buildSystemPrompt(coins_bullion, promptMode="structured"): keeps evidence-reading rules that ground both calls (slab-label-is-truth, mint mark locations)', () => {
  const prompt = buildSystemPrompt("coins_bullion", {
    ...contextWithCategoryAndAspects(),
    promptMode: "structured",
  });
  if (!/SLAB LABEL IS TRUTH/.test(prompt)) {
    throw new Error('promptMode="structured" must keep the slab-label-is-truth rule');
  }
  if (!/MINT MARK LOCATIONS/.test(prompt)) {
    throw new Error('promptMode="structured" must keep the mint-mark-locations evidence rule');
  }
});

Deno.test('buildSystemPrompt(coins_bullion, promptMode="description"): keeps evidence-reading rules so the narrative doesn\'t contradict extracted facts', () => {
  const prompt = buildSystemPrompt("coins_bullion", {
    ...contextWithCategoryAndAspects(),
    promptMode: "description",
  });
  if (!/SLAB LABEL IS TRUTH/.test(prompt)) {
    throw new Error('promptMode="description" must keep the slab-label-is-truth rule');
  }
  if (!/MINT MARK LOCATIONS/.test(prompt)) {
    throw new Error('promptMode="description" must keep the mint-mark-locations evidence rule');
  }
});

Deno.test('buildSystemPrompt(coins_bullion, promptMode="description"): drops the coin-specific ITEM SPECIFICS list', () => {
  const prompt = buildSystemPrompt("coins_bullion", {
    ...contextWithCategoryAndAspects(),
    promptMode: "description",
  });
  if (/### ITEM SPECIFICS\n/.test(prompt)) {
    throw new Error('promptMode="description" must not include the coin ITEM SPECIFICS list');
  }
});
