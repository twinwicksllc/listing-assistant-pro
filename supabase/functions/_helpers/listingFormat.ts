/**
 * Listing presentation helpers: SEO title assembly and eBay description HTML.
 *
 * Both halves of this file exist because of the same class of mistake -- a
 * constraint was stated as a ceiling and then never built toward.
 *
 * TITLES. Every prompt in this codebase said "Title <= 80 chars" and the only
 * length logic in the pipeline truncated downward, so the model treated 80 as a
 * limit to stay safely clear of. Production titles were landing at 50-58
 * characters ("1896 US $1 Morgan Silver Dollar 0.7734oz PCGS MS63" is 50),
 * which throws away 22-30 characters of Cassini index surface per listing --
 * eBay search ranks on exact keyword tokens in the title, so an unused
 * character is a keyword the item cannot be found by. `buildSeoTitle` is a
 * greedy assembler: it appends whole search-priority tiers, then individual
 * words, then buyer synonyms, stopping at or just before 80 and never splitting
 * a word.
 *
 * DESCRIPTIONS. eBay interprets `listingDescription` as HTML. Raw "\n" is
 * collapsed to a single space by browsers and by the native iOS/Android apps,
 * so plain text arrives as one wall of prose. The previous converter
 * (`markdownToHtml`) tried to fix this but had three defects, all reproduced
 * against real descriptions:
 *
 *   1. Its "already HTML" guard was `/<[a-z][\s\S]*>/i` -- a single inline tag
 *      anywhere (one `<b>`) returned the ENTIRE description unconverted, raw
 *      newlines and all. That is the wall of text, and it fired often.
 *   2. It emitted no inline styles, so spacing was at the mercy of whatever
 *      defaults each eBay surface applies. Inline `style="..."` is the only
 *      thing that renders identically on desktop, mobile web and the apps --
 *      external stylesheets, <head> and <script> are stripped or flagged.
 *   3. It mapped every single "\n" to `<br>`, so the model's soft line wraps
 *      became literal mid-sentence breaks: "The bail is<br>solid and opens
 *      smoothly."
 *
 * `formatDescriptionHtml` replaces it: paragraph blocks are split on blank
 * lines and re-flowed (soft wraps become spaces), "Label: Value" runs -- which
 * is what the prompts' plain-text "Quick Details:" block actually produces --
 * become styled lists, and everything is wrapped in one self-contained
 * inline-styled container.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SEO title assembly
// ─────────────────────────────────────────────────────────────────────────────

/** eBay rejects titles over this; it is a hard API limit, not a guideline. */
export const TITLE_MAX_LENGTH = 80;

/**
 * Below this we are measurably leaving search surface unused. Not enforceable
 * (a sparse item may have nothing true left to say) but it is what the
 * assembler builds toward, and what `titleFillRatio` reports on.
 */
export const TITLE_TARGET_MIN_LENGTH = 75;

/**
 * Subjective filler. Cassini either ignores these outright or treats them as
 * keyword spam, and they consume characters a real identifier could use.
 *
 * Deliberately limited to terms confirmed as filler. Numismatic strike
 * descriptors that LOOK like marketing are NOT here -- "GEM BU" and "Proof"
 * are real grade language buyers search for, and "NR" (no reserve) only means
 * anything on auctions. Removing those would cost more than it saves.
 */
const BANNED_TITLE_PATTERNS: readonly RegExp[] = [
  /L\s*@+\s*K(?:ING)?/gi, // L@@K, L@K, L@@KING
  /\b(?:rare|stunning|wow|estate)\b/gi,
];

/** "***", "!!!", "~~~" and friends -- punctuation runs read as spam. */
const PUNCTUATION_RUN_PATTERNS: readonly RegExp[] = [
  /[*!~=+#]{2,}/g,
  /-{3,}/g,
];

/**
 * Terms buyers use interchangeably. When the assembled title has room, adding
 * the other half of a pair widens the queries the listing can match at no cost
 * to accuracy. Keyed on what is already in the title; the synonym is appended
 * only if it is not already present.
 *
 * Kept deliberately narrow. "Quarter"/"Dime"/"Nickel" are NOT here: "Quarter"
 * appears in "Quarter oz" (a bullion weight, not a 25-cent piece) and "Nickel"
 * appears in "Copper-Nickel" (a composition), so mapping them to face values
 * would inject a wrong keyword into a correct title.
 *
 * NOTE: these patterns must NOT carry the `g` flag -- `RegExp.test` on a global
 * regex advances `lastIndex` between calls and would skip matches.
 */
const TITLE_SYNONYMS: readonly {
  readonly match: RegExp;
  readonly synonym: string;
}[] = [
  { match: /\bcents?\b/i, synonym: "Penny" },
  { match: /\bpenn(?:y|ies)\b/i, synonym: "Cent" },
  { match: /\b1\/2\s*oz\b/i, synonym: "Half oz" },
  { match: /\bhalf\s*oz\b/i, synonym: "1/2 oz" },
  { match: /\b1\/4\s*oz\b/i, synonym: "Quarter oz" },
  { match: /\bquarter\s*oz\b/i, synonym: "1/4 oz" },
  { match: /\bsilver dollar\b/i, synonym: "$1" },
  { match: /\buncirculated\b/i, synonym: "BU" },
];

/** Connectors that are not worth a character when topping a title up. */
const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "for",
  "with",
  "and",
  "or",
  "to",
  "at",
  "by",
  "is",
]);

/**
 * Units and classifiers that are only meaningful attached to the phrase they
 * came from. The top-up pass appends leftover words from the model's own title,
 * and these are exactly the ones that turn into word-salad when appended alone
 * ("... BU RCM Bullion oz .9999 Coin"), matching no query a buyer would type.
 * A tier that legitimately needs one carries it inside its own phrase.
 */
const ORPHAN_TOPUP_WORDS = new Set([
  "oz",
  "ozt",
  "coin",
  "coins",
  "fine",
  "grams",
  "gram",
  "troy",
  "content",
  "piece",
  "item",
  "lot",
  "value",
  "type",
]);

/**
 * The six search-priority tiers, front-loaded most-identifying first, in the
 * order eBay buyers scan and type them.
 */
export interface TitleComponents {
  /** Tier 1 -- year and mint mark, e.g. "1894-O", "2018". */
  yearMint?: string | null;
  /** Tier 2 -- series/subject, e.g. "Morgan Silver Dollar", "Canada Polar Bear". */
  series?: string | null;
  /** Tier 3 -- denomination or face value, e.g. "1C", "$1", "$2". */
  denomination?: string | null;
  /** Tier 4 -- composition/purity/weight, e.g. ".9999 Fine Silver 1/2 oz". */
  composition?: string | null;
  /** Tier 5 -- grade/condition/strike, e.g. "BU", "PCGS MS63", "G/VG", "Proof". */
  grade?: string | null;
  /** Tier 6 -- secondary search terms / sovereign mint, e.g. "RCM", "Bullion". */
  secondaryTerms?: (string | null)[] | null;
}

/** Removes subjective filler and punctuation runs, then normalises whitespace. */
export function stripTitleFiller(title: string): string {
  let out = title ?? "";
  for (const pattern of BANNED_TITLE_PATTERNS) out = out.replace(pattern, " ");
  for (const pattern of PUNCTUATION_RUN_PATTERNS) {
    out = out.replace(pattern, " ");
  }
  return out
    .replace(/\s{2,}/g, " ")
    // Tidy " ," and " ." left behind by a removed word -- but ONLY when the mark
    // ends a word. A leading-decimal token is real purity data (".9999 Fine
    // Silver"), and collapsing the space before it welds two keywords into the
    // unsearchable single token "oz.9999".
    .replace(/\s+([,;:.])(?=\s|$)/g, "$1")
    .trim();
}

/**
 * Trims to `max` characters at a word boundary.
 *
 * A single token longer than `max` is the one case that cannot be honoured --
 * eBay's limit is hard, so it is cut. Nothing the pipeline produces looks like
 * that, but the fallback is here rather than throwing.
 */
export function truncateToWordBoundary(
  text: string,
  max: number = TITLE_MAX_LENGTH,
): string {
  const trimmed = (text ?? "").trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max).replace(/\s+\S*$/, "").trim();
  return cut.length > 0 ? cut : trimmed.slice(0, max);
}

/** Whole-phrase containment -- keeps the assembler from repeating itself. */
function containsPhrase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Greedy assembler. Appends tiers in search-priority order, tops the result up
 * with anything the model's own title contributed that the tiers missed, then
 * adds buyer synonyms while characters remain.
 *
 * `fallbackTitle` is the model's `title` field and is never discarded: if the
 * structured components are too sparse to beat it, it becomes the base and the
 * components become top-up material. So this can only ever lengthen a title,
 * never shorten one below what the model already produced.
 */
export function buildSeoTitle(
  components: TitleComponents | undefined | null,
  fallbackTitle: string,
): string {
  const fallback = stripTitleFiller(fallbackTitle ?? "");

  const tierSegments: string[] = [
    components?.yearMint,
    components?.series,
    components?.denomination,
    components?.composition,
    components?.grade,
    ...(components?.secondaryTerms ?? []),
  ]
    .map((segment) => stripTitleFiller(String(segment ?? "")))
    .filter((segment) => segment.length > 0);

  let assembled = "";

  const tryAppend = (piece: string): boolean => {
    const next = assembled ? `${assembled} ${piece}` : piece;
    if (next.length > TITLE_MAX_LENGTH) return false;
    assembled = next;
    return true;
  };

  const appendSegment = (segment: string): void => {
    if (!segment || containsPhrase(assembled, segment)) return;
    if (tryAppend(segment)) return;
    // The whole segment does not fit. Append its leading words one at a time
    // and stop at the first that does not -- never split a word, and never
    // skip ahead to a shorter later word, which would scramble the phrase.
    for (const word of segment.split(/\s+/)) {
      if (containsPhrase(assembled, word)) continue;
      if (!tryAppend(word)) break;
    }
  };

  for (const segment of tierSegments) appendSegment(segment);

  if (assembled.length < fallback.length) {
    // Components were too sparse to improve on what the model wrote. Keep its
    // title and fold the tiers back in as extra keywords.
    assembled = truncateToWordBoundary(fallback);
    for (const segment of tierSegments) appendSegment(segment);
  } else {
    // Top-up from the model's own title, word by word. Only whole words that
    // carry search value on their own: a bare unit or classifier ("oz",
    // "Coin", "Fine") appended away from the phrase it belonged to reads as
    // word-salad and matches nothing -- the first cut of this produced
    // "... BU RCM Bullion oz.9999 Coin".
    for (const word of fallback.split(/\s+/)) {
      if (word.length < 3 || TITLE_STOPWORDS.has(word.toLowerCase())) continue;
      if (ORPHAN_TOPUP_WORDS.has(word.toLowerCase())) continue;
      appendSegment(word);
    }
  }

  for (const { match, synonym } of TITLE_SYNONYMS) {
    if (assembled.length + 1 + synonym.length > TITLE_MAX_LENGTH) continue;
    if (!match.test(assembled) || containsPhrase(assembled, synonym)) continue;
    tryAppend(synonym);
  }

  return truncateToWordBoundary(assembled || fallback);
}

/**
 * A title must keep at least this many words to still identify the item. Below
 * it, dropping more is worse than declining the edit that needed the room.
 */
export const MIN_TITLE_WORDS_KEPT = 5;

/** Trailing separators left dangling once a word is dropped. */
const DANGLING_TAIL = /[\s,;:\-/&+.]+$/;

/**
 * Frees characters in an already-assembled title by dropping whole words from
 * the tail, returning `null` rather than mid-word truncating when it cannot.
 *
 * This exists because a ceiling built *toward* breaks every later insertion.
 * `buildSeoTitle` deliberately targets 75-80 of the 80 characters, so a
 * downstream correction that needs two more -- adding a confirmed mint mark,
 * "1894" -> "1894-O" -- arrives at a title with no room. The guards that used
 * to sit at those call sites (`if (newTitle.length <= 80)`) then discarded the
 * correction silently: item specifics carried the right mint while the title
 * carried the wrong one, which on a coin is a materially wrong listing, not a
 * cosmetic one. Before the assembler existed titles ran 50-58 characters and
 * the room was always there, so the guards had never once fired.
 *
 * Dropping from the tail is safe because the tail is, by construction, the
 * least valuable end: the assembler appends its six tiers in search-priority
 * order, so trailing content is tier-6 secondary keywords ("Type Coin", "US
 * Mint") and appended buyer synonyms. Trading a generic keyword for a verified
 * mint mark is the right trade every time.
 *
 * To make room for something being appended or prepended, pass a reduced `max`
 * (`TITLE_MAX_LENGTH - (addition.length + 1)`) -- the addition is then never
 * itself a drop candidate.
 */
export function shrinkTitleToFit(
  title: string,
  max: number = TITLE_MAX_LENGTH,
  minWordsKept: number = MIN_TITLE_WORDS_KEPT,
): string | null {
  const trimmed = (title ?? "").trim();
  // Blank in, decline out. Returning "" here would read as SUCCESS to a caller
  // testing `!== null`, and an empty title is worse than a declined edit.
  if (trimmed.length === 0) return null;
  if (max <= 0) return null;
  if (trimmed.length <= max) return trimmed;

  const words = trimmed.split(/\s+/);
  for (let keep = words.length - 1; keep >= minWordsKept; keep--) {
    const candidate = words.slice(0, keep).join(" ").replace(DANGLING_TAIL, "");
    if (candidate.length > 0 && candidate.length <= max) return candidate;
  }
  return null;
}

/** Fraction of the 80-character budget used. For shortfall logging. */
export function titleFillRatio(title: string): number {
  if (!title) return 0;
  return Math.round((title.length / TITLE_MAX_LENGTH) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Description HTML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline styles only. eBay strips <head> and external stylesheets and flags
 * <script>, so inline `style="..."` is the only way to get identical rendering
 * across the desktop site, mobile web, and the native iOS/Android apps.
 */
const CONTAINER_STYLE = "font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #333333;";
const PARAGRAPH_STYLE = "margin: 0 0 12px 0;";
const UNORDERED_LIST_STYLE = "list-style-type: disc; margin: 0 0 12px 20px; padding-left: 0;";
const ORDERED_LIST_STYLE = "list-style-type: decimal; margin: 0 0 12px 20px; padding-left: 0;";
const LIST_ITEM_STYLE = "margin-bottom: 6px;";
const HEADING_STYLE = "font-size: 16px; font-weight: bold; margin: 0 0 8px 0;";

/**
 * Only BLOCK-level tags mean "this is already structured HTML, leave the layout
 * alone". The old guard matched any tag at all, so a single inline `<b>`
 * skipped the entire conversion and shipped raw newlines.
 */
const BLOCK_LEVEL_HTML = /<\s*(?:p|div|ul|ol|li|table|tbody|tr|td|h[1-6]|br|section|article|blockquote)\b/i;

const BULLET_LINE = /^[-*•·]\s+(.*\S)\s*$/;
const NUMBERED_LINE = /^\d{1,2}[.)]\s+(.*\S)\s*$/;
const HEADING_LINE = /^#{1,6}\s+(.*\S)\s*$/;
/** "Metal: Sterling Silver" -- a short label, a colon, then a value. */
const LABEL_LINE = /^([A-Za-z][A-Za-z0-9 /&'()%.-]{0,40}?):[ \t]+(\S.*)$/;

/** A label is a label only if it is short; longer means prose with a colon. */
function matchLabelLine(line: string): [string, string] | null {
  const m = line.match(LABEL_LINE);
  if (!m) return null;
  const label = m[1].trim();
  if (label.split(/\s+/).length > 5) return null;
  return [label, m[2].trim()];
}

/** Escapes bare ampersands without mangling existing entities. */
function inlineMarkup(text: string): string {
  return text
    .replace(/&(?![a-zA-Z#][a-zA-Z0-9]{0,9};)/g, "&amp;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "<i>$1</i>")
    .replace(/(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g, "<i>$1</i>");
}

function renderParagraph(lines: string[]): string {
  // Joined with a space, NOT <br>: consecutive lines inside one block are the
  // model's soft wraps, and mapping them to <br> is what produced
  // "The bail is<br>solid and opens smoothly."
  const text = inlineMarkup(lines.join(" ").replace(/\s{2,}/g, " ").trim());
  return text ? `<p style="${PARAGRAPH_STYLE}">${text}</p>` : "";
}

function renderList(items: string[], ordered: boolean): string {
  if (items.length === 0) return "";
  const style = ordered ? ORDERED_LIST_STYLE : UNORDERED_LIST_STYLE;
  const tag = ordered ? "ol" : "ul";
  const body = items
    .map((item) => `<li style="${LIST_ITEM_STYLE}">${inlineMarkup(item)}</li>`)
    .join("");
  return `<${tag} style="${style}">${body}</${tag}>`;
}

function renderLabelList(pairs: [string, string][]): string {
  if (pairs.length === 0) return "";
  const body = pairs
    .map(
      ([label, value]) => `<li style="${LIST_ITEM_STYLE}"><b>${inlineMarkup(label)}:</b> ${inlineMarkup(value)}</li>`,
    )
    .join("");
  return `<ul style="${UNORDERED_LIST_STYLE}">${body}</ul>`;
}

/**
 * Renders one blank-line-separated block. Walks it line by line so a block can
 * mix a lead-in sentence with bullets or "Label: Value" rows, which is exactly
 * the shape the prompts' plain-text "Quick Details:" section produces.
 */
function renderBlock(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return "";

  // Whether "X: y" lines are a spec list or just prose containing a colon is a
  // whole-block decision -- one such line is a sentence, several are a table.
  const labelCount = lines.filter((line) => matchLabelLine(line) !== null)
    .length;
  const labelsAreList = labelCount >= 2;

  const out: string[] = [];
  let prose: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  let labels: [string, string][] = [];

  const flushProse = () => {
    if (prose.length) out.push(renderParagraph(prose));
    prose = [];
  };
  const flushBullets = () => {
    if (bullets.length) out.push(renderList(bullets, false));
    bullets = [];
  };
  const flushNumbered = () => {
    if (numbered.length) out.push(renderList(numbered, true));
    numbered = [];
  };
  const flushLabels = () => {
    if (labels.length) out.push(renderLabelList(labels));
    labels = [];
  };
  const flushAll = () => {
    flushProse();
    flushBullets();
    flushNumbered();
    flushLabels();
  };

  for (const line of lines) {
    const heading = line.match(HEADING_LINE);
    if (heading) {
      flushAll();
      out.push(`<h3 style="${HEADING_STYLE}">${inlineMarkup(heading[1])}</h3>`);
      continue;
    }
    const bullet = line.match(BULLET_LINE);
    if (bullet) {
      flushProse();
      flushNumbered();
      flushLabels();
      bullets.push(bullet[1]);
      continue;
    }
    const numberedMatch = line.match(NUMBERED_LINE);
    if (numberedMatch) {
      flushProse();
      flushBullets();
      flushLabels();
      numbered.push(numberedMatch[1]);
      continue;
    }
    const label = labelsAreList ? matchLabelLine(line) : null;
    if (label) {
      flushProse();
      flushBullets();
      flushNumbered();
      labels.push(label);
      continue;
    }
    flushBullets();
    flushNumbered();
    flushLabels();
    prose.push(line);
  }
  flushAll();

  return out.join("");
}

function wrapInContainer(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) return "";
  // Idempotent: never nest a container inside a container.
  if (/^<div[^>]*font-family/i.test(trimmed)) return trimmed;
  return `<div style="${CONTAINER_STYLE}">${trimmed}</div>`;
}

/**
 * Converts a plain-text (or lightly-marked-up) description into self-contained,
 * inline-styled, mobile-safe HTML for eBay's `listingDescription`.
 *
 * Descriptions that already contain block-level HTML keep their own layout and
 * are only wrapped in the styled container -- re-flowing hand-written HTML
 * would do more harm than the spacing fix is worth.
 */
export function formatDescriptionHtml(raw: string): string {
  if (!raw) return raw;

  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (BLOCK_LEVEL_HTML.test(text)) {
    return wrapInContainer(text.trim());
  }

  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const rendered = blocks.map(renderBlock).filter(Boolean).join("");
  // A description with no blank lines at all still has to come out as HTML.
  return wrapInContainer(rendered || renderBlock(text.trim()));
}

/**
 * Phase 1.3b fallback: analyze-item's Pass 2 description call can fail or
 * time out independently of the structured-extraction call now that the two
 * run concurrently (`Promise.allSettled`) instead of one call producing both.
 * Before the split, a Pass 2 failure threw for the whole listing -- there was
 * no such thing as "structured fields OK, description missing". This gives
 * that new partial-failure state a plain-text description built entirely
 * from data the structured call already returned, using the exact
 * "Label: Value" line convention every domain prompt already teaches
 * `formatDescriptionHtml` to parse -- so this needs no special-case there.
 */
export function buildFallbackDescription(
  listing: { title?: string; itemSpecifics?: Record<string, unknown> },
): string {
  const lines: string[] = [];
  if (listing.title) {
    lines.push(`${listing.title}.`);
    lines.push("");
  }
  lines.push("Quick Details:");
  const specifics = listing.itemSpecifics ?? {};
  let count = 0;
  for (const [key, value] of Object.entries(specifics)) {
    if (count >= 8) break;
    if (value === null || value === undefined) continue;
    const str = String(value).trim();
    if (!str) continue;
    lines.push(`${key}: ${str}`);
    count++;
  }
  return lines.join("\n");
}
