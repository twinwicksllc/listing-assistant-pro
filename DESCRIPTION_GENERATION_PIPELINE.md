# Description Generation Pipeline: analyze-item → ebay-publish → eBay API

## Overview

The description flows through three stages: **(1) Gemini generation**, **(2) format transformation**, **(3) eBay API submission**. Each stage has specific formatting constraints and failure paths.

---

## Stage 1: Gemini Pass 2 Description Call (analyze-item)

**File:** `supabase/functions/analyze-item/index.ts`

### Schema & Prompt

- **Lines 2080-2085**: `descriptionSchemaProperties` defines the Gemini output schema
- **Line 2081**: Single field: `description` (type: string)
- **Lines 2083-2084**: Gemini instructions (current):
  ```
  "Write a natural, human-sounding eBay description in plain text. Do NOT output section headers or labels such as 'Opening Hook', 'Quick Specs', 'What Sets It Apart', 'Closing Statement', 'Overview', 'Specifications', or any markdown heading markers. Do NOT use HTML — the backend converts this plain text into inline-styled HTML for eBay. Keep it concise and readable: 2-5 short paragraphs and optional simple bullet lines. STRUCTURE MATTERS: separate every paragraph and every list with ONE BLANK LINE, put each 'Label: Value' spec on its own line, and never hard-wrap a sentence across two lines — the converter reads blank lines and label lines to build paragraphs and bulleted spec lists, and without them eBay renders everything as one wall of text. Mention condition honestly, what is included, and specific visual details from the photos. Avoid robotic marketing language."
  ```

### Concurrency & Fallback

- **Line 2122**: Description call runs concurrently with structured call via `Promise.allSettled`
- **Lines 2213-2259**: Description outcome handled as non-load-bearing (isolated try-catch)
  - **Line 2238**: On success: `listing.description = descriptionArgs.description;`
  - **Line 2259**: On failure: `listing.description = buildFallbackDescription(listing);`

### Prompt Building

- **Line 1500**: Description prompt built via `buildSystemPrompt(identification.domain, { ...basePromptCtx, promptMode: "description" })`
- Domain-specific prompts in `supabase/functions/_helpers/domainPrompts.ts` (coins, bullion, trading cards, etc.)

---

## Stage 2: Format Transformation (listingFormat.ts)

**File:** `supabase/functions/_helpers/listingFormat.ts`

### Two Paths:

#### Path A: Gemini-Generated Description

When Gemini Pass 2 succeeds, `listing.description` is the raw plain-text output (2-5 paragraphs + optional bullets + "Label: Value" specs).

#### Path B: Fallback Description (Lines 550-570)

When Gemini fails or times out:

```typescript
export function buildFallbackDescription(listing: {
  title?: string;
  itemSpecifics?: Record<string, unknown>;
}): string {
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
```

**Output format:**

```
1894 US $1 Morgan Silver Dollar PCGS MS63.

Quick Details:
Denomination: $1
Year: 1894
Mint Mark: O
Grade: MS63
Metal Type: Silver
Weight: 0.7734 oz
Certification: PCGS
...
```

### HTML Formatting (Lines 520-537)

- **Line 520**: `formatDescriptionHtml(raw: string)` — the core converter
- Takes plain text with blank lines and "Label: Value" lines
- **Returns:** inline-styled HTML safe for eBay (mobile + desktop)

**Key transformations:**

- Blank lines → paragraph breaks with `margin: 0 0 12px 0;`
- "Label: Value" lines (2+ occurrences in a block) → unordered list items
- Bullet/numbered lines → rendered as `<ul>` or `<ol>`
- **Inline markup:** `**bold**`, `__bold__`, `*italic*`, `_italic_` converted to `<b>` and `<i>`
- **Ampersands:** bare `&` escaped to `&amp;` (but existing entities preserved)
- Wraps entire output in `<div>` with font-family, font-size, line-height, color inline styles

**Container style (Line 349):**

```css
font-family: Arial, Helvetica, sans-serif;
font-size: 14px;
line-height: 1.5;
color: #333333;
```

---

## Stage 3: eBay API Submission (ebay-publish)

**File:** `supabase/functions/ebay-publish/publish-create-draft.ts`

### Description Field Mapping

- **Line 1005**: Description passed to `buildFixedPriceOffer()` as the `description` parameter
- **Line 519 comment:** "description goes in the OFFER (listingDescription), not the inventory item"
- The Inventory API call (PUT) creates the item; the Offer API call (POST) attaches the description

### Final eBay Offer Payload

The formatted HTML description becomes `listingDescription` in the eBay Sell Inventory API v1 offer payload:

```json
{
  "listingDescription": "<div style=\"font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #333333;\"><p style=\"margin: 0 0 12px 0;\">1894 US $1 Morgan Silver Dollar PCGS MS63.</p><p style=\"margin: 0 0 12px 0;\">Rare find in excellent condition.</p><ul style=\"list-style-type: disc; margin: 0 0 12px 20px; padding-left: 0;\"><li style=\"margin-bottom: 6px;\"><b>Denomination:</b> $1</li><li style=\"margin-bottom: 6px;\"><b>Year:</b> 1894</li>...</ul></div>",
  "sku": "item-123",
  "pricingSummary": { "price": "1500.00" },
  ...
}
```

### eBay Rendering

- eBay parses inline styles only (external stylesheets/`<head>` stripped)
- Inline `style="..."` attributes render identically on:
  - Desktop web browser
  - Mobile web browser (m.ebay.com)
  - iOS app
  - Android app
- Raw newlines (`\n`) collapsed to single space by browser/app rendering
- **Critical:** Blank lines in plain text are ESSENTIAL — they signal `renderBlock()` to emit `<p>` or `<ul>` tags; without them, everything becomes one wall of text

---

## Current Formatting Flow: Visual Summary

```
┌─────────────────────────────────────────────────────────────────┐
│ Gemini Pass 2 Description Call                                  │
│ Input: images, structured fields, domain-specific prompt        │
│ Output: plain-text description (2-5 paragraphs + bullets + specs)
└─────────────────────────────────────────────────────────────────┘
                              │
                              ├─── Success ───────────────────┐
                              │                               │
                              └─── Failure/Timeout ───────────┤
                                                              │
                                                 buildFallbackDescription()
                                                 (title + "Quick Details:")
                                                              │
┌─────────────────────────────────────────────────────────────────┐
│ listing.description (plain text)                                │
│ Format: blank-line-separated blocks + "Label: Value" specs      │
└─────────────────────────────────────────────────────────────────┘
                              │
                   formatDescriptionHtml()
                              │
┌─────────────────────────────────────────────────────────────────┐
│ htmlDescription (HTML with inline styles)                       │
│ - Paragraphs: <p style="...">                                   │
│ - Lists: <ul>/<ol> with <li style="...">                        │
│ - Bold/italic: <b>, <i>                                         │
│ - Container: <div style="font-family: Arial; ...">              │
└─────────────────────────────────────────────────────────────────┘
                              │
                   ebay-publish / buildFixedPriceOffer()
                              │
┌─────────────────────────────────────────────────────────────────┐
│ eBay Inventory API v1 Offer Payload                             │
│ { "listingDescription": "<div>...</div>", ... }                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                   eBay API → Live Listing
```

---

## Key Formatting Constraints & Gotchas

| Constraint                                         | Where Enforced                                  | Current Behavior                                                                |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| **No section headers** (e.g., "Overview", "Specs") | Gemini prompt (line 2084)                       | Gemini instructed explicitly to avoid them                                      |
| **No HTML in Gemini output**                       | Gemini prompt (line 2084)                       | Gemini told not to output HTML; conversion happens in `formatDescriptionHtml()` |
| **Blank lines are load-bearing**                   | `formatDescriptionHtml()` line 529              | Splits on `\n{2,}` (2+ newlines); single newlines become spaces in paragraphs   |
| **"Label: Value" lines → list items**              | `renderBlock()` line 486                        | Detected by regex; 2+ occurrences in a block render as `<ul>` with `<li>`       |
| **Soft line wraps stay inline**                    | `renderParagraph()` line 392                    | Lines within a paragraph joined with space, not `<br>`                          |
| **Mobile-safe styling**                            | Container/paragraph/list styles (lines 349-354) | Only inline `style="..."`, no external CSS                                      |
| **Inline markup** (`**bold**`, `*italic*`)         | `inlineMarkup()` line 379                       | Converted to `<b>` and `<i>` tags                                               |

---

## Format Requirements Going Forward

**If you have new formatting instructions, specify:**

1. **Gemini output format** — what should Gemini produce? (prose + specs + bullets? fixed structure?)
2. **Separator strategy** — how should blank lines, bullets, or "Label: Value" specs be arranged?
3. **Styling preferences** — font size, colors, margins? (affects CSS in lines 349-354)
4. **Fallback handling** — how should `buildFallbackDescription()` arrange the title + specs when Gemini fails?
5. **eBay constraints** — any eBay-specific rendering quirks you've encountered?

**Files to modify:**

- `analyze-item/index.ts` line 2084: Gemini prompt instructions
- `analyze-item/index.ts` line 1500: Domain-specific prompt builder (if domain-aware formatting needed)
- `listingFormat.ts` line 550: `buildFallbackDescription()` (if fallback structure should change)
- `listingFormat.ts` lines 349-354: CSS styles (if visual formatting should change)
