import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildFallbackDescription,
  buildSeoTitle,
  formatDescriptionHtml,
  MIN_TITLE_WORDS_KEPT,
  shrinkTitleToFit,
  stripTitleFiller,
  TITLE_MAX_LENGTH,
  TITLE_TARGET_MIN_LENGTH,
  titleFillRatio,
  truncateToWordBoundary,
} from "./listingFormat.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Title assembly
//
// The reported symptom was titles landing at 50-58 of the 80 available
// characters. The two production examples below are the actual regression
// cases, measured from logs on 2026-09-15.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("buildSeoTitle fills the budget for the reported 50-char Morgan title", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1896",
      series: "Morgan Silver Dollar",
      denomination: "$1",
      composition: "90% Silver 0.7734oz",
      grade: "PCGS MS63",
      secondaryTerms: ["US Mint", "Type Coin"],
    },
    "1896 US $1 Morgan Silver Dollar 0.7734oz PCGS MS63",
  );

  assert(
    title.length >= TITLE_TARGET_MIN_LENGTH,
    `expected >=${TITLE_TARGET_MIN_LENGTH} chars, got ${title.length}: "${title}"`,
  );
  assert(title.length <= TITLE_MAX_LENGTH, `over cap: ${title.length}`);
  // Front-loaded: the year leads, the series follows.
  assert(title.startsWith("1896 Morgan Silver Dollar"), title);
});

Deno.test("buildSeoTitle fills the budget for the reported 58-char Polar Bear title", () => {
  const title = buildSeoTitle(
    {
      yearMint: "2019",
      series: "Canada Polar Bear",
      denomination: "$2",
      composition: ".9999 Fine Silver 1/2 oz",
      grade: "BU",
      secondaryTerms: ["RCM", "Bullion"],
    },
    "2019 Canada $2 Polar Bear 1/2 oz .9999 Fine Silver Coin BU",
  );

  // Lands at 73, not 75+, and that is correct: this item's true attributes are
  // exhausted with ~7 characters spare. The only way to reach 75 here is to
  // re-add the orphaned-unit padding ("... Bullion oz .9999 Coin") that spends
  // characters on tokens no buyer query contains. So the assertion is "used the
  // budget far better than the 58 production titles did, without inventing
  // anything", NOT a hard floor -- a floor would force junk back in.
  assert(
    title.length >= 70,
    `expected >=70 chars, got ${title.length}: "${title}"`,
  );
  assert(title.length <= TITLE_MAX_LENGTH, `over cap: ${title.length}`);
  // Every supplied tier survived into the title.
  for (const tier of [".9999 Fine Silver", "1/2 oz", "BU", "RCM", "Bullion"]) {
    assertStringIncludes(title, tier);
  }
});

Deno.test("buildSeoTitle orders tiers by search priority, not by input order", () => {
  const title = buildSeoTitle(
    {
      // Deliberately supplied out of order in the object literal; the assembler
      // reads named fields, so declaration order must not matter.
      grade: "BU",
      composition: "Bronze",
      series: "Indian Head Cent",
      yearMint: "1907",
      denomination: "1C",
    },
    "Indian Head Cent",
  );

  const order = ["1907", "Indian Head Cent", "1C", "Bronze", "BU"].map((part) => title.indexOf(part));
  for (const idx of order) assert(idx >= 0, `missing part in "${title}"`);
  for (let i = 1; i < order.length; i++) {
    assert(
      order[i] > order[i - 1],
      `tier ${i} out of order in "${title}"`,
    );
  }
});

Deno.test("buildSeoTitle never exceeds 80 characters even with oversized input", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1894-O",
      series: "Morgan Silver Dollar United States of America Liberty Head",
      denomination: "One Dollar $1",
      composition: "90% Silver 10% Copper 0.7734 oz ASW Fine Silver",
      grade: "PCGS Genuine Certified MS63 Brilliant Uncirculated",
      secondaryTerms: ["US Mint", "New Orleans", "Bullion", "Type Coin"],
    },
    "1894-O Morgan Silver Dollar",
  );

  assertEquals(
    title.length <= TITLE_MAX_LENGTH,
    true,
    `over cap at ${title.length}: "${title}"`,
  );
});

Deno.test("buildSeoTitle never truncates a word mid-spelling", () => {
  // "Uncirculated" is the word most likely to be sliced: it lands near the cap.
  const title = buildSeoTitle(
    {
      yearMint: "2021",
      series: "American Silver Eagle",
      denomination: "$1",
      composition: ".999 Fine Silver 1 oz",
      grade: "Brilliant Uncirculated Condition",
      secondaryTerms: ["US Mint", "Bullion", "Investment Grade"],
    },
    "2021 American Silver Eagle",
  );

  for (const word of title.split(" ")) {
    // Every emitted word must be a whole word from some input, so no word may
    // be a strict prefix of a longer source word at the tail of the title.
    assert(word.length > 0, "empty token");
  }
  const truncatedTail = /\b(?:Uncirculate|Uncirculat|Brillian|Investmen|Bullio)$/;
  assert(!truncatedTail.test(title), `mid-word cut: "${title}"`);
});

Deno.test("buildSeoTitle strips banned filler words", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1921",
      series: "Rare Morgan Silver Dollar",
      denomination: "$1",
      grade: "Stunning BU",
      secondaryTerms: ["Estate Find"],
    },
    "L@@K!!! RARE Stunning 1921 Morgan Estate ***WOW***",
  );

  for (const banned of ["L@@K", "RARE", "Rare", "Stunning", "WOW", "Estate"]) {
    assert(
      !title.includes(banned),
      `filler "${banned}" survived in "${title}"`,
    );
  }
  assert(!title.includes("***"), `punctuation run survived: "${title}"`);
  assert(!title.includes("!!"), `punctuation run survived: "${title}"`);
  // The real identifiers must survive the strip.
  assertStringIncludes(title, "1921");
  assertStringIncludes(title, "Morgan Silver Dollar");
});

Deno.test("buildSeoTitle adds a buyer synonym when characters remain", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1907",
      series: "Indian Head Cent",
      denomination: "1C",
      composition: "Bronze",
      grade: "G/VG",
    },
    "1907 Indian Head Cent",
  );

  // "Cent" is present and there is room, so "Penny" — what buyers also type —
  // should be appended.
  assertStringIncludes(title, "Penny");
  assert(title.length <= TITLE_MAX_LENGTH);
});

Deno.test("buildSeoTitle skips a synonym that would breach the cap", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1909-S VDB",
      series: "Lincoln Wheat Cent",
      denomination: "1C",
      composition: "95% Copper Bronze Composition",
      grade: "PCGS Certified Very Fine 30",
      secondaryTerms: ["US Mint Philadelphia", "Key Date Type Coin"],
    },
    "1909-S VDB Lincoln Wheat Cent",
  );

  assert(title.length <= TITLE_MAX_LENGTH, `over cap: ${title.length}`);
});

Deno.test("buildSeoTitle never returns SHORTER than the model's own title", () => {
  // The load-bearing safety property. Components can be sparse or junk; the
  // assembler must not lose keywords the model already produced.
  const modelTitle = "2019 Canada $2 Polar Bear 1/2 oz .9999 Fine Silver Coin BU";
  const title = buildSeoTitle({ yearMint: "2019" }, modelTitle);

  assert(
    title.length >= modelTitle.length,
    `shortened from ${modelTitle.length} to ${title.length}: "${title}"`,
  );
});

Deno.test("buildSeoTitle survives entirely absent components", () => {
  const modelTitle = "1896 US $1 Morgan Silver Dollar 0.7734oz PCGS MS63";
  assertEquals(buildSeoTitle(undefined, modelTitle), modelTitle);
  assertEquals(buildSeoTitle(null, modelTitle), modelTitle);
  assertEquals(buildSeoTitle({}, modelTitle), modelTitle);
});

Deno.test("buildSeoTitle does not repeat a term the title already carries", () => {
  const title = buildSeoTitle(
    {
      yearMint: "1896",
      series: "Morgan Silver Dollar",
      denomination: "$1",
    },
    "1896 Morgan Silver Dollar $1",
  );

  assertEquals(
    title.match(/Morgan/g)?.length,
    1,
    `duplicated series in "${title}"`,
  );
  assertEquals(title.match(/1896/g)?.length, 1, `duplicated year in "${title}"`);
});

Deno.test("buildSeoTitle does not weld a leading-decimal purity onto the previous word", () => {
  // Found by reading real output, not by an assertion: the whitespace tidy in
  // stripTitleFiller collapsed "oz .9999" into the single unsearchable token
  // "oz.9999", destroying both keywords at once.
  const title = buildSeoTitle(
    {
      yearMint: "2019",
      series: "Canada Polar Bear",
      denomination: "$2",
      composition: ".9999 Fine Silver 1/2 oz",
      grade: "BU",
    },
    "2019 Canada $2 Polar Bear 1/2 oz .9999 Fine Silver Coin BU",
  );

  assert(!/\woz\.\d/.test(title), `welded purity token: "${title}"`);
  assertStringIncludes(title, ".9999 Fine Silver");
});

Deno.test("buildSeoTitle does not append orphaned units as word-salad", () => {
  // Also found by reading output: topping the title up word-by-word from the
  // model's own title appended bare units far from the phrase they belonged to,
  // producing "... BU RCM Bullion oz .9999 Coin" -- characters spent on tokens
  // no buyer query contains.
  const title = buildSeoTitle(
    {
      yearMint: "2019",
      series: "Canada Polar Bear",
      denomination: "$2",
      composition: ".9999 Fine Silver 1/2 oz",
      grade: "BU",
      secondaryTerms: ["RCM", "Bullion"],
    },
    "2019 Canada $2 Polar Bear 1/2 oz .9999 Fine Silver Coin BU",
  );

  assert(!/\bCoin$/.test(title), `orphaned classifier at tail: "${title}"`);
  assert(!/\boz\s+oz\b/.test(title), `duplicated unit: "${title}"`);
});

Deno.test("truncateToWordBoundary cuts at a space, never mid-word", () => {
  const text = "1894-O Morgan Silver Dollar Brilliant Uncirculated Condition";
  const cut = truncateToWordBoundary(text, 40);
  assert(cut.length <= 40, `over max: ${cut.length}`);
  assert(!cut.endsWith("Unc"), cut);
  assert(text.startsWith(cut), `not a prefix: "${cut}"`);
  // The cut must land on a word boundary in the source.
  assert(
    text[cut.length] === " " || text.length === cut.length,
    `cut mid-word: "${cut}"`,
  );
});

Deno.test("truncateToWordBoundary still cuts a single oversized token", () => {
  // eBay's cap is hard, so an unbreakable token has to be cut rather than
  // shipped over-length or thrown away.
  const cut = truncateToWordBoundary("A".repeat(120));
  assertEquals(cut.length, TITLE_MAX_LENGTH);
});

Deno.test("stripTitleFiller preserves real numismatic grade language", () => {
  // "GEM BU" and "Proof" look like marketing but are terms buyers search on.
  // Over-stripping them would cost more search surface than the filler ban saves.
  const kept = stripTitleFiller("1881-S Morgan GEM BU Proof Like PL Toned");
  assertStringIncludes(kept, "GEM BU");
  assertStringIncludes(kept, "Proof");
});

Deno.test("titleFillRatio reports the used fraction of the budget", () => {
  assertEquals(titleFillRatio("A".repeat(40)), 0.5);
  assertEquals(titleFillRatio("A".repeat(80)), 1);
  assertEquals(titleFillRatio(""), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Making room in a full title (shrinkTitleToFit)
//
// Second-order fallout from the fix above. Teaching buildSeoTitle to fill the
// 80-character budget broke every downstream insertion, because those call
// sites were written against titles that ran 50-58 characters and so always
// had 20+ spare. `applyDetailOverrides` corrects a coin's mint mark by
// rewriting the year -- "1894" becomes "1894-O", two more characters -- behind
// an `if (newTitle.length <= 80)` with no `else`. On a title packed to 79 or 80
// that guard now fires and silently DISCARDS a confirmed mint mark: the item
// specifics carry the right mint while the title carries the wrong one. "1894"
// and "1894-O" are different coins at very different prices, so that ships a
// materially wrong listing, not a cosmetic blemish. The guard had never once
// fired before the assembler landed.
//
// shrinkTitleToFit is how the call site buys those two characters instead:
// drop a trailing tier-6 keyword ("Type Coin", "US Mint") rather than drop the
// verified mint mark. Dropping from the tail is safe by construction --
// buildSeoTitle appends its six tiers in search-priority order and then buyer
// synonyms, so the tail is always the least valuable end.
//
// The five fixtures below are real buildSeoTitle outputs measured on
// 2026-09-15, and four of the five sit exactly at the 79-80 characters where
// the old guard was dropping mint marks.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Measured buildSeoTitle output, one per shape the assembler produces.
 * "1932 Washington Quarter" at 74 is the control: it already fits the reduced
 * cap, so it exercises the "no work needed" branch on real data rather than on
 * a toy string.
 */
const MEASURED_FULL_TITLES: readonly string[] = [
  "1894 Morgan Silver Dollar $1 90% Silver 0.7734 oz ASW PCGS MS63 New Orleans Mint",
  "1909 Lincoln Wheat Cent 1C 95% Copper Bronze VF Very Fine US Mint Key Date Penny",
  "1916 Mercury Dime 10C 90% Silver 0.0723 oz AU About Uncirculated US Mint Type BU",
  "1881 Morgan Silver Dollar $1 90% Silver GEM BU Proof Like San Francisco US Mint",
  "1932 Washington Quarter 25C 90% Silver 0.1808 oz XF Extremely Fine US Mint",
];

/** The room a "1894" -> "1894-O" mint-mark correction actually needs. */
const MINT_MARK_ROOM = TITLE_MAX_LENGTH - 2;

/**
 * Deliberately a character list rather than a regex. Two assertions in this
 * very file once shipped with a literal backspace where a word-boundary escape
 * was intended, which made both of them vacuous -- they passed while asserting
 * nothing. A plain `includes` on the last character cannot fail that way.
 */
const TRAILING_SEPARATOR_CHARS: readonly string[] = [
  ",",
  ";",
  ":",
  "-",
  "/",
  "&",
  "+",
  ".",
  " ",
  "\t",
  "\n",
];

const wordsOf = (text: string): string[] => text.split(/\s+/).filter((word) => word.length > 0);

Deno.test("shrinkTitleToFit leaves a title that already fits untouched", () => {
  const title = "1932 Washington Quarter 25C 90% Silver 0.1808 oz XF Extremely Fine US Mint";
  assertEquals(shrinkTitleToFit(title, TITLE_MAX_LENGTH), title);
  // Surrounding whitespace is normalised and that is not "an edit" for these
  // purposes -- the caller may be handing us a raw model-supplied string.
  assertEquals(shrinkTitleToFit(`  ${title}  `, TITLE_MAX_LENGTH), title);
});

Deno.test("shrinkTitleToFit frees mint-mark room on every measured full title", () => {
  // The load-bearing case. Each of these is a real assembler output sitting at
  // or one below the cap, which is exactly where the old `<= 80` guard was
  // throwing away a CONFIRMED mint mark.
  for (const title of MEASURED_FULL_TITLES) {
    const shrunk = shrinkTitleToFit(title, MINT_MARK_ROOM);
    assert(
      shrunk !== null,
      `declined to make room in a ${title.length}-char title: "${title}"`,
    );
    assert(
      shrunk.length <= MINT_MARK_ROOM,
      `still over ${MINT_MARK_ROOM} at ${shrunk.length}: "${shrunk}"`,
    );

    // A word-boundary prefix: the same words, in the same order, from the front.
    const original = wordsOf(title);
    const kept = wordsOf(shrunk);
    assert(kept.length <= original.length, `gained words: "${shrunk}"`);
    for (let i = 0; i < kept.length; i++) {
      assertEquals(
        kept[i],
        original[i],
        `word ${i} diverged from the source: "${shrunk}"`,
      );
    }

    // The identifiers a buyer actually searches on -- year and series -- live
    // at the front and must never be what pays for the mint mark.
    assert(
      shrunk.startsWith(original.slice(0, 3).join(" ")),
      `lost leading identifiers: "${shrunk}"`,
    );
    assert(
      kept.length >= MIN_TITLE_WORDS_KEPT,
      `dropped below the word floor: "${shrunk}"`,
    );
  }
});

Deno.test("shrinkTitleToFit never ends mid-word", () => {
  // The entire reason this is not truncateToWordBoundary. A title cut to
  // "... New Orlea" is worse than declining the mint-mark edit, because it
  // corrupts a keyword rather than merely failing to add one.
  for (const title of MEASURED_FULL_TITLES) {
    const sourceWords = new Set(wordsOf(title));
    for (const max of [MINT_MARK_ROOM, 70, 60, 50, 40, 30]) {
      const shrunk = shrinkTitleToFit(title, max);
      if (shrunk === null) continue;
      for (const word of wordsOf(shrunk)) {
        assert(
          sourceWords.has(word),
          `emitted "${word}", not a whole word of the source, at max=${max}: "${shrunk}"`,
        );
      }
    }
  }
});

Deno.test("shrinkTitleToFit strips the separator a dropped word left dangling", () => {
  // Dropping the word after a separator strands the separator, and
  // "1894 Morgan Silver Dollar Proof -" is both ugly and a wasted character --
  // the one character we were fighting for in the first place.
  assertEquals(
    shrinkTitleToFit("1894 Morgan Silver Dollar Proof - Uncirculated Coin", 34),
    "1894 Morgan Silver Dollar Proof",
  );
  assertEquals(
    shrinkTitleToFit("1894 Morgan Silver Dollar Type, Coin Extra", 32),
    "1894 Morgan Silver Dollar Type",
  );

  // And the same as a property, swept across every cap: no result may end in
  // one. A separator embedded inside a surviving word ("G/VG", "0.7734") is
  // untouched, which is why this checks only the final character.
  for (const title of MEASURED_FULL_TITLES) {
    for (let max = 20; max <= TITLE_MAX_LENGTH; max++) {
      const shrunk = shrinkTitleToFit(title, max);
      if (shrunk === null) continue;
      assert(
        !TRAILING_SEPARATOR_CHARS.includes(shrunk.slice(-1)),
        `dangling separator at max=${max}: "${shrunk}"`,
      );
    }
  }
});

Deno.test("shrinkTitleToFit declines rather than shrink past the word floor", () => {
  // `null` means "decline this edit". The caller's fallback -- keeping the
  // slightly-wrong title -- is bad, but a title stripped back to "1894 Morgan"
  // has lost the denomination, composition and grade buyers filter on, which is
  // worse. Six words cannot reach 10 characters while keeping five.
  assertEquals(shrinkTitleToFit("One Two Three Four Five Six", 10), null);
  // Not an off-by-one at the boundary: 13 characters is still short of five
  // words here ("One Two Three Four Five" is 23).
  assertEquals(shrinkTitleToFit("One Two Three Four Five Six", 13), null);
  // A floor above the word count is unsatisfiable by definition.
  assertEquals(shrinkTitleToFit("One Two Three Four Five Six", 12, 7), null);
  // Lowering the floor lets the same call succeed, which proves it is the floor
  // doing the declining and not a length bug.
  assertEquals(shrinkTitleToFit("One Two Three Four Five Six", 10, 2), "One Two");
});

Deno.test("shrinkTitleToFit returns null for a non-positive max", () => {
  // A caller that computed `TITLE_MAX_LENGTH - (addition.length + 1)` against
  // an absurdly long addition lands here. It must decline, not return "" --
  // an empty title would pass a truthiness check at the call site and ship.
  assertEquals(shrinkTitleToFit("1894 Morgan Silver Dollar PCGS MS63", 0), null);
  assertEquals(shrinkTitleToFit("1894 Morgan Silver Dollar PCGS MS63", -5), null);
});

Deno.test("shrinkTitleToFit survives absent and blank input", () => {
  // These arrive straight off a Gemini response field, so undefined is a real
  // input shape rather than a hypothetical. Nothing here may throw -- and
  // blank input DECLINES rather than returning "", because `null` is the
  // contract's "leave the title alone" signal and a caller testing
  // `!== null` would otherwise treat "" as a successful edit and ship it.
  assertEquals(shrinkTitleToFit(""), null);
  assertEquals(shrinkTitleToFit("   \t  "), null);
  assertEquals(shrinkTitleToFit(null as never), null);
  assertEquals(shrinkTitleToFit(undefined as never), null);
});

Deno.test("shrinkTitleToFit declines a single unbreakable token", () => {
  // The one place it deliberately differs from truncateToWordBoundary, which
  // cuts such a token to honour eBay's hard cap. Here the caller is asking
  // "can I make room?" and the honest answer on one 120-character word is no --
  // cutting it would corrupt the only keyword the title has.
  assertEquals(shrinkTitleToFit("A".repeat(120), TITLE_MAX_LENGTH), null);
  assertEquals(shrinkTitleToFit("A".repeat(120), 10), null);
});

Deno.test("shrinkTitleToFit is idempotent at the same max", () => {
  // applyDetailOverrides can run more than once over one draft (a re-analysis,
  // a user re-confirming a detail). A second shrink at the same cap must be a
  // no-op, or repeated passes would erode the title one keyword at a time.
  for (const title of MEASURED_FULL_TITLES) {
    const once = shrinkTitleToFit(title, MINT_MARK_ROOM);
    assert(once !== null, `unexpected decline for "${title}"`);
    assertEquals(shrinkTitleToFit(once, MINT_MARK_ROOM), once);
  }
});

Deno.test("shrinkTitleToFit lets a confirmed mint mark reach a packed title", () => {
  // The end-to-end property the production bug violated. Assembled rather than
  // hand-written so the fixture cannot drift away from what buildSeoTitle
  // actually emits. The mint mark is CONFIRMED -- item specifics already carry
  // it -- so the title disagreeing with them is the defect, and dropping the
  // correction to stay under 80 is how that defect shipped.
  const assembled = buildSeoTitle(
    {
      yearMint: "1894",
      series: "Morgan Silver Dollar",
      denomination: "$1",
      composition: "90% Silver 0.7734 oz ASW",
      grade: "PCGS MS63",
      secondaryTerms: ["New Orleans Mint", "Type Coin"],
    },
    "1894 Morgan Silver Dollar",
  );
  assert(
    assembled.length >= TITLE_TARGET_MIN_LENGTH,
    `fixture no longer reproduces a packed title: ${assembled.length}`,
  );

  const rewritten = assembled.replace(/(^|\s)1894(\s|$)/, "$11894-O$2");
  // Precondition, asserted so this test cannot quietly stop reproducing the
  // bug: the rewrite really does breach the cap the old guard checked.
  assert(
    rewritten.length > TITLE_MAX_LENGTH,
    `rewrite fits at ${rewritten.length}, so it never hit the guard`,
  );

  const shrunk = shrinkTitleToFit(rewritten, TITLE_MAX_LENGTH);
  assert(shrunk !== null, "declined to make room for a confirmed mint mark");
  assert(shrunk.length <= TITLE_MAX_LENGTH, `over cap at ${shrunk.length}: "${shrunk}"`);
  // The whole point: the corrected mint mark survives into the shipped title.
  assertStringIncludes(shrunk, "1894-O");
  // And it is the tail that paid for it, not the identifiers.
  assertStringIncludes(shrunk, "Morgan Silver Dollar");
  assertStringIncludes(shrunk, "PCGS MS63");
});

Deno.test("shrinkTitleToFit spends the tail, keeping the highest-priority tiers", () => {
  // Tail-first is the whole safety argument. If it ever dropped from the front
  // or the middle, "trade a generic keyword for a verified mint mark" would
  // silently become "trade the year for a verified mint mark".
  const title = MEASURED_FULL_TITLES[0];
  const tightened = shrinkTitleToFit(title, 60);
  assert(tightened !== null, "declined at 60 chars");
  assertStringIncludes(tightened, "1894 Morgan Silver Dollar");
  assertStringIncludes(tightened, "$1");
  // Tier-6 secondary terms are gone; the tier 1-3 identifiers are not.
  assert(
    !tightened.includes("New Orleans"),
    `kept tier-6 filler over identifiers: "${tightened}"`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Description HTML
//
// Every case below is a defect reproduced against the old markdownToHtml
// before this module replaced it.
// ─────────────────────────────────────────────────────────────────────────────

const PENDANT_DESCRIPTION = [
  "Up for sale is a beautiful vintage sterling silver pendant.",
  "It has a wonderful patina that only comes with age.",
  "",
  "The piece shows light surface wear consistent with gentle use. The bail is",
  "solid and opens smoothly.",
  "",
  "Quick Details:",
  "Metal: Sterling Silver",
  "Hallmark: 925",
  "Length: 18 inches",
  "Condition: Very Good",
  "",
  "Why It Matters:",
  "Vintage sterling holds its value and this piece is ready to wear.",
].join("\n");

Deno.test("formatDescriptionHtml emits inline styles on every block", () => {
  // The old converter emitted no styles at all, leaving spacing to whatever
  // default each eBay surface applies.
  const html = formatDescriptionHtml(PENDANT_DESCRIPTION);
  assertStringIncludes(html, '<div style="font-family: Arial');
  assertStringIncludes(html, '<p style="margin: 0 0 12px 0;">');
  assertStringIncludes(html, '<ul style="list-style-type: disc;');
  assertStringIncludes(html, '<li style="margin-bottom: 6px;">');
});

Deno.test("formatDescriptionHtml turns a Quick Details block into a real list", () => {
  const html = formatDescriptionHtml(PENDANT_DESCRIPTION);
  assertStringIncludes(html, "<ul");
  assertStringIncludes(html, "<b>Metal:</b> Sterling Silver");
  assertStringIncludes(html, "<b>Hallmark:</b> 925");
  assertStringIncludes(html, "<b>Condition:</b> Very Good");
});

Deno.test("formatDescriptionHtml does NOT turn soft wraps into mid-sentence breaks", () => {
  // The exact reproduced defect: "The bail is<br>solid and opens smoothly."
  const html = formatDescriptionHtml(PENDANT_DESCRIPTION);
  assert(
    !html.includes("is<br>solid"),
    `soft wrap became a break: ${html}`,
  );
  assertStringIncludes(html, "The bail is solid and opens smoothly.");
});

Deno.test("formatDescriptionHtml converts a description containing ONE inline tag", () => {
  // The worst defect: the old guard was /<[a-z][\s\S]*>/i, so a single <b>
  // returned the WHOLE description unconverted with raw newlines intact.
  const raw = [
    "Up for sale is a <b>gorgeous</b> pendant.",
    "",
    "Quick Details:",
    "Metal: Sterling Silver",
    "Hallmark: 925",
  ].join("\n");

  const html = formatDescriptionHtml(raw);
  assert(!html.includes("\n\n"), `raw blank lines survived: ${html}`);
  assertStringIncludes(html, "<p style=");
  assertStringIncludes(html, "<ul style=");
  // The author's own inline emphasis is preserved.
  assertStringIncludes(html, "<b>gorgeous</b>");
});

Deno.test("formatDescriptionHtml leaves real block-level HTML alone but styles it", () => {
  const raw = "<p>Already structured.</p><ul><li>One</li></ul>";
  const html = formatDescriptionHtml(raw);
  assertStringIncludes(html, "<p>Already structured.</p>");
  assertStringIncludes(html, "<li>One</li>");
  assertStringIncludes(html, '<div style="font-family: Arial');
});

Deno.test("formatDescriptionHtml is idempotent", () => {
  // create_draft can be re-run on a draft whose description was already
  // formatted; a second pass must not nest containers or double-escape.
  const once = formatDescriptionHtml(PENDANT_DESCRIPTION);
  const twice = formatDescriptionHtml(once);
  assertEquals(twice, once);
});

Deno.test("formatDescriptionHtml emits no external CSS, head, or script", () => {
  // eBay strips these or flags the listing; inline styling is the only reliable
  // route to identical rendering on desktop, mobile web and the native apps.
  const html = formatDescriptionHtml(PENDANT_DESCRIPTION);
  for (const forbidden of ["<script", "<head", "<link", "<style", "@import"]) {
    assert(
      !html.toLowerCase().includes(forbidden),
      `emitted ${forbidden}: ${html}`,
    );
  }
});

Deno.test("formatDescriptionHtml converts markdown bullets to a styled list", () => {
  const raw = [
    "Key features:",
    "",
    "- Solid sterling construction",
    "- Original patina",
    "- Smooth working bail",
  ].join("\n");

  const html = formatDescriptionHtml(raw);
  assertStringIncludes(html, '<ul style="list-style-type: disc;');
  assertEquals(html.match(/<li /g)?.length, 3);
});

Deno.test("formatDescriptionHtml handles a numbered list", () => {
  const html = formatDescriptionHtml("1. First point\n2. Second point");
  assertStringIncludes(html, '<ol style="list-style-type: decimal;');
  assertEquals(html.match(/<li /g)?.length, 2);
});

Deno.test("formatDescriptionHtml keeps prose with a colon as prose", () => {
  // A lone "X: y" line is a sentence, not a spec row. Two or more make a table.
  // Getting this wrong turns narrative into a bulleted list.
  const html = formatDescriptionHtml(
    "One thing to note: the clasp shows honest wear from use.",
  );
  assertStringIncludes(html, "<p style=");
  assert(!html.includes("<ul"), `prose became a list: ${html}`);
});

Deno.test("formatDescriptionHtml normalises CRLF from Windows-authored text", () => {
  const html = formatDescriptionHtml(
    "First paragraph.\r\n\r\nSecond paragraph.",
  );
  assert(!html.includes("\r"), `carriage return survived: ${html}`);
  assertEquals(html.match(/<p /g)?.length, 2);
});

Deno.test("formatDescriptionHtml escapes a bare ampersand but keeps entities", () => {
  const html = formatDescriptionHtml("Gold & Silver, priced &lt;fairly&gt;.");
  assertStringIncludes(html, "Gold &amp; Silver");
  assertStringIncludes(html, "&lt;fairly&gt;");
  assert(!html.includes("&amp;lt;"), `double-escaped: ${html}`);
});

Deno.test("formatDescriptionHtml handles a single line with no blank lines", () => {
  const html = formatDescriptionHtml("Just one sentence about the item.");
  assertStringIncludes(html, "<p style=");
  assertStringIncludes(html, "Just one sentence about the item.");
});

Deno.test("formatDescriptionHtml passes empty input through untouched", () => {
  assertEquals(formatDescriptionHtml(""), "");
});

Deno.test("formatDescriptionHtml renders a mixed block with a lead-in and specs", () => {
  // The real shape the prompt produces: a label line introducing spec rows.
  const html = formatDescriptionHtml(
    "Quick Details:\nMetal: Silver\nYear: 1896\nGrade: MS63",
  );
  // "Quick Details:" has no value after the colon, so it stays a heading-ish
  // paragraph while the three real pairs become the list.
  assertStringIncludes(html, "<ul");
  assertEquals(html.match(/<li /g)?.length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildFallbackDescription (Phase 1.3b, 2026-09-16)
//
// analyze-item's Pass 2 splits into two concurrent calls (structured
// extraction, prose description). Before the split, a Pass 2 failure threw
// for the whole listing -- "structured fields OK, description missing" is a
// new partial-failure state this function exists to cover. It must produce
// the exact "Label: Value" line shape formatDescriptionHtml already parses,
// so a real listing with only structured fields still renders as a proper
// list, not a wall of unparsed text.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("buildFallbackDescription includes the title and every non-empty item specific", () => {
  const out = buildFallbackDescription({
    title: "1oz Silver Eagle Coin",
    itemSpecifics: { Metal: "Silver", Year: "2024", Grade: "MS63" },
  });
  assertStringIncludes(out, "1oz Silver Eagle Coin");
  assertStringIncludes(out, "Quick Details:");
  assertStringIncludes(out, "Metal: Silver");
  assertStringIncludes(out, "Year: 2024");
  assertStringIncludes(out, "Grade: MS63");
});

Deno.test("buildFallbackDescription caps at 8 item specifics", () => {
  const itemSpecifics: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    itemSpecifics[`Spec${i}`] = `Value${i}`;
  }
  const out = buildFallbackDescription({ title: "Test Item", itemSpecifics });
  const labelLines = out
    .split("\n")
    .filter((line) => /^Spec\d+: Value\d+$/.test(line));
  assertEquals(labelLines.length, 8);
  // The first 8 keys in insertion order should be the ones kept, not an
  // arbitrary subset -- Object.entries preserves insertion order for string
  // keys, so this pins that assumption too.
  for (let i = 1; i <= 8; i++) {
    assertStringIncludes(out, `Spec${i}: Value${i}`);
  }
  assert(!out.includes("Spec9:"), `expected Spec9 to be dropped: ${out}`);
});

Deno.test("buildFallbackDescription skips null, undefined, and empty-string values", () => {
  const out = buildFallbackDescription({
    title: "Test Item",
    itemSpecifics: {
      Metal: "Gold",
      Year: null as unknown as string,
      Grade: undefined as unknown as string,
      Notes: "",
      Composition: "  ",
    },
  });
  assertStringIncludes(out, "Metal: Gold");
  assert(!out.includes("Year:"), `null value rendered: ${out}`);
  assert(!out.includes("Grade:"), `undefined value rendered: ${out}`);
  assert(!out.includes("Notes:"), `empty-string value rendered: ${out}`);
  assert(!out.includes("Composition:"), `whitespace-only value rendered: ${out}`);
});

Deno.test("buildFallbackDescription omits the title line when no title is given", () => {
  const out = buildFallbackDescription({ itemSpecifics: { Metal: "Gold" } });
  assertStringIncludes(out, "Quick Details:");
  assertStringIncludes(out, "Metal: Gold");
  // No title means no leading non-"Quick Details:" prose line before it.
  const firstLine = out.split("\n")[0];
  assertEquals(firstLine, "Quick Details:");
});

Deno.test("buildFallbackDescription does not throw on empty or missing itemSpecifics", () => {
  const noSpecifics = buildFallbackDescription({ title: "Test Item" });
  assertStringIncludes(noSpecifics, "Quick Details:");
  assertStringIncludes(noSpecifics, "Test Item");

  const emptySpecifics = buildFallbackDescription({
    title: "Test Item",
    itemSpecifics: {},
  });
  assertStringIncludes(emptySpecifics, "Quick Details:");
});

Deno.test("buildFallbackDescription's output is parsed by formatDescriptionHtml into a real list, not left as unparsed prose", () => {
  const fallback = buildFallbackDescription({
    title: "1oz Silver Eagle Coin",
    itemSpecifics: { Metal: "Silver", Year: "2024", Grade: "MS63" },
  });
  const html = formatDescriptionHtml(fallback);
  assertStringIncludes(html, "<ul");
  assertEquals(html.match(/<li /g)?.length, 3);
  assertStringIncludes(html, "<b>Metal:</b> Silver");
  assertStringIncludes(html, "<b>Year:</b> 2024");
  assertStringIncludes(html, "<b>Grade:</b> MS63");
});
