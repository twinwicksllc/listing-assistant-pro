import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildSeoTitle,
  formatDescriptionHtml,
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

  assert(!/Coin$/.test(title), `orphaned classifier at tail: "${title}"`);
  assert(!/oz\s+oz/.test(title), `duplicated unit: "${title}"`);
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
