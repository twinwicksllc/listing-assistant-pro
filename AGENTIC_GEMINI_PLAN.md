# Agentic Gemini Implementation Plan

**Feature Branch:** `feature/agentic-gemini`  
**Status:** Implementation in progress

---

## Overview

This document describes the "Agentic Interfacing" upgrade to the listing analysis backend. The goal is to replace static, pattern-based logic with a live, grounded, multi-step agentic pipeline powered by **Gemini 2.0 Flash** (the 2026 production model with full tool support).

Three enhancements are shipped together:

| #   | Enhancement                         | Gemini Capability Used                                |
| --- | ----------------------------------- | ----------------------------------------------------- |
| 1   | Real-Time Category & Comp Grounding | `google_search` built-in tool                         |
| 2   | Agentic Vision for Item Inspection  | `code_execution` built-in tool (Think-Act-Observe)    |
| 3   | Hybrid API Strategy                 | Gemini grounding + eBay Taxonomy API cross-validation |

---

## Key Architecture Decision: Native API vs OpenAI-Compat Shim

The current codebase uses the OpenAI-compatibility endpoint:

```
POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
```

**This endpoint does NOT support native Gemini tools** (grounding, code execution). Those features require the native `generateContent` endpoint:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

**Strategy:** We introduce a **new Pre-Pass 0** ("Agentic Pre-Pass") that runs BEFORE the existing Pass 1 and Pass 2. This pre-pass uses the native API with grounding + code execution enabled. Its output (grounded category ID, market analysis, and zoom-inspection findings) is fed as context into the existing Pass 1/2 pipeline.

This approach:

- ✅ Preserves all existing logic (no regression risk)
- ✅ Adds grounding without changing the function-calling schema
- ✅ Feeds structured output forward to existing prompts
- ✅ Is non-blocking (if pre-pass fails, existing pipeline runs unchanged)

---

## Model Selection

| Pass                    | Current Model         | New Model          | Why                                                             |
| ----------------------- | --------------------- | ------------------ | --------------------------------------------------------------- |
| Pre-Pass 0 (NEW)        | —                     | `gemini-2.0-flash` | Native tools (grounding + code_execution), fast, cost-efficient |
| Pass 1 (identification) | `gemini-2.5-pro`      | `gemini-2.0-flash` | Pass 1 is lightweight; Flash is faster                          |
| Pass 2 (main listing)   | `gemini-2.5-pro`      | `gemini-2.5-pro`   | Keep Pro for final structured output quality                    |
| category-lookup         | `gemini-flash-latest` | `gemini-2.0-flash` | Explicit version pinning                                        |

> **Note on model naming:** The Google Gemini API model identifiers as of 2026:
>
> - `gemini-2.0-flash` — Production Flash model with full tool support
> - `gemini-2.5-pro` — Production Pro model for complex reasoning
> - `gemini-flash-latest` — Alias (currently resolves to 2.0 Flash)

---

## Pre-Pass 0: Agentic Pipeline

### 0a. Google Search Grounding (Enhancement #1)

Uses the native `generateContent` API with `tools: [{ googleSearch: {} }]`.

**What it does:**

1. Searches for the current eBay leaf category ID for the identified item
2. Searches for recently sold prices with qualitative nuances:
   - Coins: mint mark premiums, key dates, error coins, toning value
   - Clothing: size tag confirmation, rips/snags, zipper condition, brand tags
   - Electronics: charger included, accessories completeness
   - Trading cards: print runs, error variants, graded vs raw premiums

**Prompt strategy:**

```
Search for: "eBay category ID for [itemName] 2026 leaf category"
Search for: "eBay recently sold [itemName] [qualitative_variant] price 2026"
```

**Output added to response:**

```typescript
market_analysis: string; // Cites specific search results, mentions premiums/discounts found
grounded_category_id: string | null; // Category ID found via grounding (if any)
```

### 0b. Agentic Vision — Code Execution (Enhancement #2)

Uses `tools: [{ codeExecution: {} }]` with an image cropping instruction.

**Think-Act-Observe loop:**

1. **THINK:** The model reasons about which regions of the image need closer inspection
   - Coins: mint mark location (above/below date), date digits, edge reeds
   - Clothing: size label (collar/side seam), brand tag, visible damage areas
   - Electronics: model number sticker, condition of ports/buttons, serial
   - Trading cards: card number/set symbol, condition of corners/surface

2. **ACT:** Model executes Python code to perform conceptual "zoom" — describes in detail what it would find by examining that region, then states its conclusion with confidence

3. **OBSERVE:** Model reads the execution output and incorporates findings into final identification

**Critical use case (Kennedy Half Dollar example):**

- Without zoom: Model might read "1965" as "1964" or vice versa (90% vs 40% silver — $30+ price difference)
- With zoom: Model explicitly examines the date region and mint mark "D/S/P/blank" before finalizing metalWeightOz

**Output added to response:**

```typescript
agentic_inspection: {
  zoom_regions_examined: string[]  // e.g. ["date digits", "mint mark", "edge"]
  key_findings: string             // e.g. "Date confirmed 1965, mint mark 'S' = 40% silver Kennedy"
  confidence_boost: string         // e.g. "HIGH - date clearly visible, mint mark unambiguous"
  identification_correction: string | null  // If initial ID was revised based on zoom
}
```

### 0c. Hybrid API Strategy (Enhancement #3)

After Pre-Pass 0 completes, the existing category resolution pipeline applies a new step:

```
Grounded category ID → eBay Taxonomy API verify → if leaf → use as high-confidence lock
```

Priority order (highest to lowest):

1. User-provided category lock (unchanged)
2. **NEW: Grounding-verified leaf category** (score ≥ 85, verified via eBay Taxonomy)
3. Deterministic DB/eBay lock (score ≥ 92, existing)
4. High-confidence pre-lookup hint (score ≥ 88, existing)
5. Post-lookup verification (existing)
6. AI's own category selection (existing)

---

## Data Flow Diagram

```
User Photos + Voice Note
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ PRE-PASS 0: Native Gemini API (gemini-2.0-flash)        │
│                                                         │
│ 0a. Google Search Grounding Tool                        │
│     • Search: eBay leaf category for item               │
│     • Search: Recently sold prices + qualitative factors│
│     → grounded_category_id (string|null)                │
│     → market_analysis (string with citations)           │
│                                                         │
│ 0b. Code Execution Tool (Agentic Vision)                │
│     • THINK: Which regions need zoom?                   │
│     • ACT: Execute Python crop/inspect logic            │
│     • OBSERVE: Read findings                            │
│     → agentic_inspection.zoom_regions_examined          │
│     → agentic_inspection.key_findings                   │
│     → agentic_inspection.identification_correction      │
└─────────────────────────────────────────────────────────┘
        │
        │ pre_pass_context (injected into Pass 1 & Pass 2 prompts)
        ▼
┌─────────────────────────────────────────────────────────┐
│ PASS 1: Fast Identification (gemini-2.0-flash)          │
│ • Domain classification                                 │
│ • Keywords extraction                                   │
│ • Enhanced with Pre-Pass 0 findings                     │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ Category Resolution (ENHANCED)                          │
│ • Grounding-verified category applied as new tier 2     │
│ • eBay Taxonomy verify on grounded_category_id          │
│ • Existing deterministic pipeline continues             │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ PASS 2: Full Listing (gemini-2.5-pro)                   │
│ • Function calling: create_listing tool                 │
│ • Pre-pass context injected into system prompt          │
│ • Grounding findings inform pricing + specifics         │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│ POST-PROCESSING (existing, unchanged)                   │
│ • Leaf validation, post-lookup, auto-persist            │
│ • Competitor price fetch                                │
│ • Melt floor enforcement                                │
└─────────────────────────────────────────────────────────┘
        │
        ▼
Final Response (EXTENDED)
  + market_analysis: string
  + agentic_inspection: { ... }
  + grounded_category_id: string | null
```

---

## Files Modified

| File                                           | Change Type       | Description                                                                               |
| ---------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `supabase/functions/analyze-item/index.ts`     | Major enhancement | Add Pre-Pass 0 (grounding + code execution), inject context into prompts, extend response |
| `supabase/functions/_helpers/domainPrompts.ts` | Minor             | Accept `prePasContext` in `PromptContext`, inject market analysis into pricing blocks     |
| `supabase/functions/category-lookup/index.ts`  | Minor             | Add `grounded_category_id` as tier-2 in `lookup` action                                   |

---

## Response Shape (Extended)

The existing frontend fields are **100% preserved**. New fields are additive:

```typescript
interface AnalyzeItemResponse {
  // ── Existing fields (unchanged) ──────────────────────────
  title: string;
  description: string;
  priceMin: number;
  priceMax: number;
  condition: string;
  ebayCategoryId: string;
  suggestedCategories: SuggestedCategory[];
  itemSpecifics: Record<string, string>;
  metalType: "gold" | "silver" | "platinum" | "none";
  metalWeightOz: number;
  meltValue: number | null;
  spotPrices: { gold: number; silver: number; platinum: number };
  suggestedGrade: string;
  gradingRationale: string;
  isSlabbed: boolean;
  pricingNotes: string;
  competitorData: CompetitorData | null;
  domain: string;
  _ebayMetadata: EbayMetadata | null;
  _meta: { tier; creditsUsed; creditsRemaining; creditsResetAt };

  // ── NEW fields (additive, zero breaking change) ───────────
  market_analysis: string | null; // Grounded search citations
  grounded_category_id: string | null; // Category ID found via Google Search
  agentic_inspection: {
    // Zoom-inspection findings
    zoom_regions_examined: string[];
    key_findings: string;
    confidence_boost: string;
    identification_correction: string | null;
  } | null;
}
```

---

## Domain-Specific Zoom Targets

| Domain             | Primary Zoom Target                 | Why                                                        |
| ------------------ | ----------------------------------- | ---------------------------------------------------------- |
| `coins_bullion`    | Date digits + mint mark             | 1964 vs 1965 Kennedy = 90% vs 40% silver ($30+ difference) |
| `trading_cards`    | Card number/set symbol + corners    | Parallel variants, PSA vs raw condition                    |
| `vintage_clothing` | Size tag + brand tag + seam quality | 2XL vs XXL, authentic vs replica                           |
| `electronics`      | Model sticker + ports + accessories | Missing charger affects value by $30–$100                  |
| `jewelry`          | Hallmark + clasp + gemstone         | 14k vs 18k, authentic stones vs synthetic                  |
| `general`          | Brand/model label + condition areas | Generic identification improvements                        |

---

## Domain-Specific Search Queries

| Domain             | Primary Search                                                  | Secondary Search                                             |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `coins_bullion`    | `eBay "1965 Kennedy Half Dollar" recently sold price mint mark` | `"key date" "error" "[itemName]" premium price eBay 2026`    |
| `trading_cards`    | `eBay "[card name] [year] [set]" recently sold PSA raw`         | `"[card name]" refractor parallel hologram premium value`    |
| `vintage_clothing` | `eBay "[brand] [item type] [size]" recently sold condition`     | `"[brand]" "[style]" "rip" OR "snag" OR "flaw" price impact` |
| `electronics`      | `eBay "[model]" recently sold "with charger" vs "no charger"`   | `"[model]" accessories "missing" price difference`           |
| `general`          | `eBay "[itemName]" recently sold price range 2026`              | `"[itemName]" condition premium collectible value`           |

---

## Error Handling

All Pre-Pass 0 operations are **non-blocking**:

- If grounding fails → `market_analysis = null`, `grounded_category_id = null`
- If code execution fails → `agentic_inspection = null`
- If grounded category fails eBay verify → falls through to existing pipeline
- Timeouts: Pre-Pass 0 has a 15-second timeout; failure returns immediately

The existing pipeline always runs, ensuring zero regression even if the entire pre-pass fails.

---

## eBay Hybrid Strategy Details

The grounded category ID goes through a sanity-check before being used:

```
grounded_category_id
        │
        ▼
category-lookup: action="verify", categoryId=grounded_id
        │
        ├─ isLeaf=true AND valid=true
        │           │
        │           ▼
        │    Use as deterministic lock (score=90)
        │    "grounding_verified_leaf" source tag
        │
        └─ isLeaf=false OR valid=false
                    │
                    ▼
             Discard, fall through to
             existing deterministic pipeline
```

If grounding found a parent category but eBay says it's not a leaf, we search the `category_mappings` table for a leaf under that parent using the item name — a new "grounding-assisted refinement" step.

---

## Implementation Sequence

1. ✅ **Codebase analysis** (complete)
2. 🔄 **`analyze-item/index.ts`** — Add Pre-Pass 0 before line ~280 (after spot prices, before Pass 1)
3. 🔄 **`_helpers/domainPrompts.ts`** — Add `prePassContext` to `PromptContext`, inject into `pricingBlock()` and domain prompts
4. 🔄 **`category-lookup/index.ts`** — Add grounded category handling in `lookup` action
5. 🔄 **PR** — Create feature branch and PR with full description
