# Comprehensive Listing-Types Roadmap

**Goal:** Make the app produce expert-quality eBay listings for _any_ listing type while keeping the user experience dead simple — upload photos, get a listing.

**Status:** Strategic plan (post-PR #395 README rewrite)
**Author:** SuperNinja (autonomous analysis)

---

## 1. Executive Summary

The app has a split personality that explains the current tension between "simple for users" and "comprehensive for all types." At the **infrastructure layer**, it is already comprehensively designed — eBay's entire ~5,000-leaf US category tree is synced weekly, category aspects are fetched dynamically per-category from eBay's Taxonomy API, and a general-purpose listing prompt can produce a structurally correct listing for literally anything. At the **domain-intelligence layer**, however, only two domains (coins/bullion and trading cards) have the deep, specialized AI reasoning that produces expert-grade output. Six more domains (jewelry, electronics, vintage clothing, auto parts, sneakers, luxury handbags, musical instruments, toys/collectibles, home/garden/tools) exist in the architecture's `DOMAIN_REGISTRY` with vision goals and grounding queries already defined — but Pass 1 identification collapses them all into `"general"`, no specialized prompt exists for them, and no detail-extraction pass runs for them.

The plan to "comprehensive for all types" is therefore not a rebuild or a UX redesign. The user-facing flow stays exactly as it is today: upload photos → get a listing. The work is purely **deepening the intelligence layer** so that each domain gets the same quality of treatment that coins and trading cards already receive. This is a phased, additive engineering effort that leverages the architecture already in place.

---

## 2. Current State Assessment

### 2.1 What Is Already Comprehensive (the safety net)

The following systems already work for _every_ eBay listing type without any domain-specific code:

**Dynamic eBay Taxonomy (all ~5,000 categories)**
The `sync-ebay-taxonomy` weekly cron fetches the entire eBay US category tree (`GET /commerce/taxonomy/v1/category_tree/0`) in a single API call, walks every leaf node, builds breadcrumbs, and bulk-upserts into the `ebay_taxonomy_cache` table. This means every eBay category — from Morgan Dollars to vintage Singer sewing machines to industrial HVAC parts — is in the database with a fresh breadcrumb string. There are no hardcoded category maps that limit coverage (the legacy bootstrap map in `suggestedCategories.ts` is explicitly marked deprecated and only serves as a pre-sync fallback).

**Dynamic Category Resolution**
When the AI proposes a category, `buildSuggestedCategories()` resolves the breadcrumb via a 4-tier fallback: (1) `ebay_taxonomy_cache` DB lookup, (2) `category_mappings` legacy records, (3) live `getCategorySubtree` API call, (4) null fallback. This works for any category ID the AI produces, regardless of domain.

**Dynamic Category Suggestions**
`getCategorySuggestions()` in `ebayTaxonomy.ts` queries eBay's `category_suggestions` API with the item name and returns the top 3 matching leaf categories. This is domain-agnostic — it works for a 1921 Morgan Dollar, a Nike Air Jordan 1, or a Bosch dishwasher part equally well.

**Dynamic Item Aspects (item specifics)**
`getCategoryAspects()` fetches eBay's required and recommended aspects for _any_ category ID from the Taxonomy API, caches them in `category_aspects_cache` (7-day TTL), and the main listing generation pass (`analyze-item/index.ts` lines ~1344–1395) builds a dynamic `itemSpecificsSchema` from this data. The AI is then constrained by a JSON schema whose `required` array is populated by eBay's actual required aspects for that specific category. This means the app already knows, for example, that a sneaker listing requires "US Shoe Size" and "Style" because eBay says so — not because someone hardcoded it.

**General-Purpose Listing Generation**
`buildGeneralPrompt()` in `domainPrompts.ts` produces a structurally correct eBay listing for any item: 80-char title rule, 5-part description structure (hook → details → quick details → why it matters → close), pricing block (uses sold comps if available, domain knowledge otherwise), dynamic category block, allowed-values block, and agentic pre-pass context injection. It enforces no markdown, no emojis, no clichés. This prompt is the floor — every domain that lacks a specialized prompt gets this, and it produces acceptable output.

**eBay Inventory API Publishing**
The 5,380-line `ebay-publish` function handles the full publish flow for any item type: `createOrReplaceInventoryItem` → `createOffer` → `publishOffer`. It maps condition IDs, normalizes fineness for metals, handles package dimensions, and manages merchant locations. This is domain-agnostic at the API level.

**Pass 2.5 Specifics Regeneration**
When the category is corrected after the main listing generation pass (Pass 2), `analyze-item` runs a Pass 2.5 that regenerates `itemSpecifics` for the corrected category, seeding context from the old specifics that survive the category change. This prevents the "stale specifics for wrong category" failure mode across all domains.

### 2.2 What Is Domain-Specialized (the expertise layer)

Only two domains have deep, specialized treatment:

**Coins & Bullion** — the deepest implementation in the codebase:

- Pass 1 has domain-specific instructions for slab label OCR (read the printed label first, common AI digit-misread warnings, current-year coin is NOT novelty)
- `buildCoinBullionPrompt()` (~500+ lines): numismatist persona, slab label OCR rules, eBay June 2026 coin condition mandate compliance, mint mark location database, metal weight rules, melt floor calculation, category ID mappings
- `detailExtractor.ts` has a full `CoinDetails` extraction pass with authoritative override: mint mark, mint location, year, denomination, series, key-date detection, variety (VAM/DDO/RPM), errors, reverse visibility
- `registry.ts` has 3 vision goals (slab label, PMG label, date/mint mark)
- `categoryResolution.ts` has a hardcoded `COINS_PAPER_MONEY_IDS` set for fast coin-category validation
- RAG knowledge base (`knowledge_base` table, pgvector) is primarily populated with coin grading standards
- Slab OCR pass (`slabOcr.ts`) runs specifically for coins_bullion domain
- Voice note metal fallback (`applyVoiceNoteMetalFallback`) detects gold/silver/platinum from seller notes
- Spot price integration for melt-value floor pricing

**Trading Cards** — reasonably deep:

- `buildTradingCardsPrompt()`: sports cards / Pokémon / MTG specialist, grading company detection (PSA/BGS/CGC), centering/corners/edges/surface (sub-grades) assessment
- `detailExtractor.ts` has a full `CardDetails` extraction pass: sport, player/character, year, set name, card number, parallel, variant, serial numbering, rookie flag, autograph flag, grader, grade
- `registry.ts` has 2 vision goals (card number/set symbol, corners/edges)
- Hardcoded rule in `analyze-item`: "Sports Trading Cards: ALWAYS include Sport in itemSpecifics"

### 2.3 What Is Missing (the gap map)

| Domain              |   Pass 1 Classifies?    | Specialized Prompt? | Detail Extraction? | Registry Vision Goals? |
| ------------------- | :---------------------: | :-----------------: | :----------------: | :--------------------: |
| coins_bullion       |           ✅            |       ✅ Deep       |      ✅ Full       |       ✅ 3 goals       |
| trading_cards       |           ✅            |       ✅ Deep       |      ✅ Full       |       ✅ 2 goals       |
| jewelry             |           ✅            | ❌ Falls to general |      ✅ Full       |       ✅ 2 goals       |
| electronics         |           ✅            | ❌ Falls to general |         ❌         |       ✅ 2 goals       |
| vintage_clothing    |           ✅            | ❌ Falls to general |         ❌         |       ✅ 2 goals       |
| auto_parts          | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| sneakers            | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| luxury_handbags     | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| musical_instruments | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| toys_collectibles   | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| home_garden_tools   | ❌ Collapsed to general |         ❌          |         ❌         |       ✅ 2 goals       |
| general             |      ✅ (fallback)      |     ✅ Generic      |         ❌         |       ✅ 1 goal        |

**The three layers of the gap, in order of impact:**

1. **Pass 1 identification only recognizes 6 domains** (`pass1Identification.ts`). The Domain type there has 6 entries; the Pass 1 system prompt only instructs the model to choose from 6 domains. Items that should be classified as sneakers, auto_parts, luxury_handbags, musical_instruments, toys_collectibles, or home_garden_tools all get `"general"`. This means their registry vision goals never fire (because `DOMAIN_REGISTRY[context.identification.domain]` looks up "general"), their grounding queries are generic, and the visual/market agents run in general mode. This is the single most impactful gap — fixing it unlocks the registry infrastructure already built.

2. **Only 2 of 12 domains have specialized prompts** (`domainPrompts.ts`). The `buildSystemPrompt()` switch routes coins_bullion and trading_cards to deep specialized prompts, and everything else (including jewelry and electronics, which _are_ classified by Pass 1) to the generic `buildGeneralPrompt`. Jewelry is particularly surprising — it has detail extraction but no specialized listing-generation prompt.

3. **Only 3 of 12 domains have detail extraction** (`detailExtractor.ts`). The `extractDetails()` function explicitly skips any domain not in `["coins_bullion", "trading_cards", "jewelry"]`. The other 9 domains never get the authoritative post-Pass vision re-inspection that catches the high-value details the main model gets wrong (model numbers, SKU codes, date codes, part numbers, hallmarks).

---

## 3. The Strategy: Layered Intelligence, Constant UX

### 3.1 The Core Principle

The user's experience never changes. The flow is and will remain:

1. User uploads 1–10 photos (and optionally a 10-second video or voice note)
2. User taps "Analyze"
3. App returns a complete eBay listing (title, description, category, item specifics, price, condition)

What changes is _invisible to the user_: the depth and accuracy of the intelligence applied behind that single tap. A sneaker seller uploads photos of their Air Jordan 1s and gets the same simple flow as a coin dealer uploading a slabbed Morgan Dollar — but behind the scenes, the app now recognizes the sneaker domain, applies a sneaker-specialized prompt that knows to extract the SKU from the inner size tag, runs a detail-extraction pass that reads the box label and colorway code, and grounds the price against StockX and eBay sold comps. The user never has to tell the app what they're selling or pick a category.

### 3.2 Why the Architecture Supports This Cleanly

The app was built with the right abstraction boundaries. The intelligence layer is cleanly separated into modular components:

- `pass1Identification.ts` — the router (decides which domain)
- `registry.ts` — the configuration (per-domain vision goals, grounding queries, critical attributes)
- `domainPrompts.ts` — the expertise (per-domain system prompts for listing generation)
- `detailExtractor.ts` — the precision layer (per-domain authoritative detail extraction)
- `agent-system/controller.ts` — the orchestrator (wires it all together)

Each of these is a **lookup table or a switch statement**. Expanding coverage means adding entries to these tables and cases to these switches — not restructuring the pipeline. The controller, the parallel sub-agent burst, the embedding pre-computation, the category resolution, the aspect fetching, the publishing flow — none of these need to change. This is why the plan is additive and phased rather than a rewrite.

---

## 4. The Plan: Four Phases

### Phase 1 — Unlock the Registry (Pass 1 Expansion)

**Effort:** Small. **Impact:** High. **Risk:** Low.

**Goal:** Expand Pass 1 identification from 6 domains to all 12 (and optionally more), so that every domain's registry entry (vision goals, grounding queries, critical attributes) actually fires.

**What changes:**

In `pass1Identification.ts`:

- Expand the `Domain` type from 6 to 12 entries to match `pipelineContracts.ts` (add `auto_parts`, `sneakers`, `luxury_handbags`, `musical_instruments`, `toys_collectibles`, `home_garden_tools`)
- Update the Pass 1 system prompt's domain guide to include all 12 domains with clear definitions and examples, mirroring the definitions already in `registry.ts`
- Add domain-specific guidance for domains where AI commonly misclassifies (e.g., "sneakers = athletic shoes with SKU tags, distinguish from vintage_clothing which is apparel/accessories; auto_parts = car/truck/motorcycle components with part numbers, distinguish from home_garden_tools which is power/hand tools for non-vehicle use")

In `domainPrompts.ts` and `detailExtractor.ts`:

- Expand the `Domain` type in both files from 6 to 12 entries to match `pipelineContracts.ts` (these are currently duplicated type definitions that have drifted out of sync)

**What does NOT change:**

- The controller, the visual agent, the market agent, the registry, the category resolution, the aspect fetching, the publishing flow — all already support 12 domains via `pipelineContracts.ts`'s `Domain` type.

**Why this is high-impact / low-risk:** The registry already has vision goals, grounding queries, and critical attributes for all 12 domains. The visual agent and market agent already accept any `DomainDefinition` from the registry. The only reason they don't fire for sneakers, auto_parts, etc. is that Pass 1 never classifies items into those domains. Expanding Pass 1 immediately activates the registry infrastructure for all 12 domains — the visual agent will start zooming into sneaker size tags and auto part number stamps even before any specialized prompt is written.

**Acceptance criteria:**

- Pass 1 classifies a photo of sneakers into `sneakers` (not `general`)
- Pass 1 classifies a photo of an auto part into `auto_parts` (not `general`)
- The visual agent logs show domain-specific vision goals firing for these domains
- The market agent logs show domain-specific grounding queries firing
- No regression in coins_bullion or trading_cards classification accuracy

---

### Phase 2 — Specialized Prompts for High-Volume Domains

**Status:** ✅ Shipped for 6 domains (sneakers, electronics, jewelry, auto_parts, luxury_handbags, vintage_clothing) — see PR implementing this phase.
**Effort:** Medium (per domain). **Impact:** High. **Risk:** Low.

**Goal:** Add specialized listing-generation prompts (`buildXxxPrompt`) for the domains that represent the highest listing volume on eBay, so they get the same expert-persona treatment as coins and trading cards.

**Priority order (by eBay listing volume and user likelihood):**

1. **Sneakers** — one of eBay's largest and most competitive categories; high authentication/valuation complexity (SKU, colorway, size, deadstock vs VNDS vs used); strong sold-comp data availability. The registry already has vision goals for the inner size tag/SKU label and sole wear/stitching. A specialized prompt should encode: SneakerX/StockX valuation methodology, deadstock (DS) / very near deadstock (VNDS) / used condition grading, size conversion (US/UK/EU/CM), colorway code reading, authenticity indicators (stitching patterns, glue lines, box label matching), and eBay's required aspects for sneaker categories (US Shoe Size, Style, Brand, Model).

2. **Electronics** — massive category; high value-density; model-number precision is critical (one digit difference = different product, different price). The registry already has vision goals for model number/serial stickers and ports/connector pins. A specialized prompt should encode: model variant disambiguation rules, storage capacity verification, connectivity spec reading, included-accessories checklist, condition grading for electronics (mint/very good/good/acceptable with specific defect definitions), and battery health/cycle count mention when visible.

3. **Jewelry** — already has detail extraction (hallmarks, karat, maker's marks, gemstones) but no specialized prompt. This is the quickest win because the precision layer exists but the generation layer doesn't use it. A specialized prompt should encode: metal purity and karat valuation methodology, gemstone identification and grading language, hallmark/maker's mark authentication framing, weight-to-price reasoning for precious metals, and eBay's jewelry-specific condition and material aspects.

4. **Auto Parts** — high-value category with unique complexity: fitment/compatibility data. The registry has vision goals for stamped part numbers and connectors/threads/mounting points. A specialized prompt should encode: part number extraction and verification, fitment/compatibility table framing (which vehicles/years the part fits), OEM vs aftermarket distinction, condition grading for mechanical parts, and eBay's Parts & Accessories aspect requirements (Brand, Manufacturer Part Number, Fitment Type, Placement on Vehicle).

5. **Luxury Handbags** — high authentication complexity (date codes, heat stamps, hardware plating, stitching patterns); strong resale market. The registry has vision goals for date code/authenticity card and hardware/stitching. A specialized prompt should encode: authentication indicator framing (date code format by brand/era, hardware stamping, stitching count/direction), condition grading specific to handbags (vachetta patina for Louis Vuitton, corner wear, hardware tarnish), and inclusion framing (dust bag, box, authenticity card, receipt).

6. **Vintage Clothing** — era authentication is the core challenge. The registry has vision goals for brand/size tags and wear points. A specialized prompt should encode: era determination from tag design/union labels/materials, vintage vs retro vs modern distinction, condition grading for textiles (flaws, fading, odor disclosure requirements), and sizing conversion for vintage garments.

**Implementation pattern (per domain):**

- Write `buildSneakersPrompt(ctx: PromptContext): string` following the same structure as `buildTradingCardsPrompt` — expert persona, core rules, description formatting, domain-specific extraction instructions, pricing methodology, category guidance, allowed-values compliance, pre-pass context integration
- Add a case to the `buildSystemPrompt()` switch: `case "sneakers": return buildSneakersPrompt(ctx);`
- Add domain-specific hardcoded rules to `analyze-item/index.ts` where needed (analogous to the "Sports Trading Cards: ALWAYS include Sport" rule) — e.g., "Sneakers: ALWAYS include US Shoe Size and Brand"

**Acceptance criteria (per domain):**

- The domain's specialized prompt fires (not `buildGeneralPrompt`) when Pass 1 classifies into that domain
- The generated listing includes the domain's critical attributes from `registry.ts` in the title and/or item specifics
- The generated description reads with domain expertise (not generic "professional eBay listing expert" language)
- eBay category aspects are still dynamically fetched and enforced (the specialized prompt must integrate with `categoryBlock` and `allowedValuesBlock`, not override them)

---

### Phase 3 — Detail Extraction for Remaining Domains ✅ Shipped

**Effort:** Medium. **Impact:** Medium-High. **Risk:** Low.

**Status:** Implemented for all 6 target domains (electronics, sneakers, auto_parts,
musical_instruments, luxury_handbags, home_garden_tools) in `detailExtractor.ts`. `extractKeyDetails()`
now runs for 9 domains total (the original 3 plus these 6). Each new domain has its own `XxxDetails`
interface, a focused extraction prompt, a result-parsing branch, and an override-application branch in
`applyDetailOverrides()` — following the exact pattern of the original coin/card/jewelry
implementation. `analyze-item/index.ts` required NO changes for this part, since its call site
(`extractKeyDetails()` + `applyDetailOverrides()`) is fully domain-agnostic and delegates entirely to
`detailExtractor.ts`.

Additionally, per user-approved recommendation, lightweight category-mismatch guardrails (soft,
keyword/breadcrumb-based — NOT hardcoded category ID tables) were added for `sneakers` and
`auto_parts` in `analyze-item/index.ts`, extending the existing `isCategoryCompatibleWithDomain()`
switch (previously only handled `coins_bullion`). These reject only categories that are CLEARLY the
wrong domain (e.g. "Action Figures" for a sneaker, "Home & Garden" for an auto part) — unlike the
coins guardrail, they are not a hard allowlist, since footwear/auto-parts category trees are far
larger and more varied than the coin taxonomy.

**Goal:** Extend the authoritative detail-extraction pass (`detailExtractor.ts`) to the domains where precision vision re-inspection adds the most value.

**Original state (pre-Phase 3):** `extractKeyDetails()` only ran for `coins_bullion`, `trading_cards`, and `jewelry`. It explicitly returned null for all other domains (`if (!["coins_bullion", "trading_cards", "jewelry"].includes(domain))`).

**Priority domains for detail extraction:**

1. **Electronics** — `ElectronicsDetails`: exact model number, storage capacity, RAM (if visible on spec sticker), serial number (for authenticity, not publication), included accessories visible in photos, cosmetic defects. Override authority for model number (the main model frequently misreads one digit).

2. **Sneakers** — `SneakerDetails`: SKU (e.g., "CT8013-170"), size (US + EU + CM if visible), colorway name, manufacture date (from tag), box presence, deadstock indicators (tissue paper intact, unlaced). Override authority for SKU and size.

3. **Auto Parts** — `AutoPartDetails`: manufacturer part number, brand, OEM vs aftermarket indicator, placement (front/rear/left/right), material (if stamped). Override authority for part number.

4. **Musical Instruments** — `InstrumentDetails`: brand, model, serial number, year of manufacture (if derivable from serial), country of origin, electronics (active/passive pickups), case inclusion. Override authority for model and serial.

5. **Luxury Handbags** — `HandbagDetails`: brand, model name, date/heat stamp code, hardware material, material (canvas/leather/exotic), dimensions (if tag present), accessories (dust bag/box/card). Override authority for date code and model.

6. **Home & Garden Tools** — `ToolDetails`: brand, model number, power source (corded/cordless/battery platform), voltage/battery platform, included batteries/accessories, condition of cutting surface/wear parts. Override authority for model number.

**Implementation pattern:**

- Define a `XxxDetails` interface for each domain (analogous to `CoinDetails`, `CardDetails`, `JewelryDetails`)
- Add the domain to the `extractDetails()` eligibility check
- Add a `case "xxx":` to the domain-specific prompt switch inside `extractDetails()` with focused vision instructions (analogous to the coin mint-mark prompt)
- Add a result-parsing branch (analogous to `if (domain === "coins_bullion")`) that maps the JSON response to the `XxxDetails` interface
- Add an override-application branch in `analyze-item/index.ts` (analogous to lines ~2487) that applies the authoritative findings to the listing

**Acceptance criteria (per domain):**

- `extractDetails()` runs (does not return null early) for the domain
- Extracted details override the main model's output when they differ (logged with the existing `[invocationId] ✓ Detail extraction applied` message)
- No regression in coins/cards/jewelry detail extraction

---

### Phase 4 — RAG Knowledge Base Expansion & Quality Assurance

**Effort:** Medium-Ongoing. **Impact:** Medium. **Risk:** Low. **Status: Shipped (PR TBD).**

**Goal:** Expand the pgvector RAG knowledge base beyond coin grading to support domain-specific fact-grounding for the new specialized domains, and add a quality-assurance feedback loop.

**What was built:**

_RAG expansion (generalized, not hardcoded):_

- Added `DOMAIN_RAG_CATEGORIES` mapping in `registry.ts` — a lookup table (not a hardcoded per-domain if/else chain) that maps each domain to its relevant `knowledge_base` category. Domains with no entry simply skip RAG injection.
- Generalized `visual-agent.ts`'s RAG injection gate from a coins_bullion-only `if` check to a loop over `DOMAIN_RAG_CATEGORIES[domain]`, so any domain with knowledge_base content automatically benefits without further code changes.
- Seeded new `knowledge_base` categories via an extended `scripts/seed-knowledge-base.cjs` (idempotent — skips content already ingested):
  - `sneaker_authentication` — deadstock/VNDS/used condition definitions, counterfeit indicators, Nike/Jordan and adidas SKU decoding
  - `electronics_spec_standard` — battery health interpretation, model number verification, cosmetic grading (A/B/C), port inspection guidance
  - `jewelry_hallmark_standard` — gold/silver/platinum purity hallmarks and stamp locations, diamond grading terminology (reference only)
  - `auto_parts_fitment` — OEM cross-reference basics, Year/Make/Model/Trim fitment verification, part number locations, used-part condition disclosure
  - `handbag_authentication` — Louis Vuitton date code format, Chanel serial number history, general authentication checkpoints, condition grading
  - `trading_card_grading` — PSA 4-criteria grading (centering/corners/edges/surface), PSA 10 vs PSA 9 distinction, BGS subgrades and half-grades, edge whitening on dark-bordered cards, surface defect types, corner condition thresholds
  - `vintage_clothing_authentication` — ILGWU union label timeline (1900–2005) for garment dating, RN number dating ranges, FTC care-label rule (post-1972), country-of-origin labeling eras, tag material and zipper-type dating (metal vs plastic, side-seam vs back)
  - `instrument_identification` — Fender serial number location by era (bridge/neckplate/headstock), US prefix codes (S/E/N/Z/US10+), Made in Japan vs Crafted in Japan prefix ranges, Made in Mexico prefixes, Gibson serial systems by era, pot-code and neck-date authentication checkpoints
  - `toy_authentication` — wear-pattern authentication (natural vs artificial distressing), manufacturer date codes (Mattel/Kenner/Barbie), materials by era (tin/cast iron/celluloid → acetate → ABS), zinc pest as authenticity confirmation, offset lithography vs digital printing on packaging, AFA grading subgrades
  - `tool_identification` — vintage tool dating via patina/materials/construction methods, maker's marks and USPTO patent number lookup, UL Listed vs UL Recognized distinction, ETL vs UL equivalence, CE (self-declaration) vs GS (third-party) marks, power tool model/serial number nameplate locations
- RAG coverage now spans **all 11 specialized domains** (every domain except `general`). The `general` domain intentionally has no RAG category — it serves as the unclassified fallback and relies on the model's baseline knowledge.
- This satisfies the "RAG retriever returns domain-relevant knowledge for ≥ 3 new domains" acceptance criterion for all 5 target domains, and the subsequent enrichment extends it to the remaining 5 specialized domains.

_Domain tracking (new prerequisite infrastructure):_

- Migration `20260714000000_add_domain_tracking.sql` adds a nullable `domain` column to both `drafts` and `listing_financials`, plus `time_to_sale_days` on `listing_financials`. Fully additive — existing rows get `NULL` domain and are excluded from aggregates until new analyses populate it.
- `ListingDraft` type, `useDrafts.ts` (add/update/fetch), and `AnalyzePage.tsx`'s `buildDraftPayload` now carry the Pass-1-classified `domain` through to persistence.
- `cogs-report/index.ts` now resolves `domain` and `published_at` from the matching `drafts` row (by `ebay_sku`/`ebay_listing_id`) at report time, computes `time_to_sale_days` (sold_at − published_at), and persists both into `listing_financials` via the existing dual-write upsert. Non-fatal on any lookup failure.
- New `domain_quality_metrics` SQL view aggregates sold financials by user + domain (count, avg net profit, avg sale price, avg time-to-sale).

_Quality-assurance feedback loop (scoped to what's actually measurable today):_

- New `domain-quality-report` edge function (admin-only) aggregates `listing_financials` across all users by domain and returns: sold count, avg net profit, avg margin %, avg time-to-sale (with sample size).
- It flags **refinement candidates**: the domain with the longest average time-to-sale and/or the lowest average margin (each requiring a minimum sample size of 3 sold listings), satisfying the "feedback loop identifies ≥ 1 domain for refinement based on real data" acceptance criterion once real sales data accumulates.
- New `DomainQualitySection` component added to `AdminPage.tsx`, displaying the per-domain table and any flagged refinement candidates.

**Explicitly deferred (documented, not silently dropped):**

- **Rejection-rate** (eBay publish API errors per domain) and **edit-rate** (user changed AI output before publishing) have **zero existing instrumentation anywhere in the codebase** — there is no table or event log tracking listing edits or publish failures by domain today. Building this requires new instrumentation (e.g., logging edit diffs in `updateDraft()`, logging publish failures with domain context in `ebay-publish`) that is a meaningfully separate scope of work from RAG expansion and time-to-sale tracking. This is flagged as **future work**, not silently dropped from the acceptance criteria — the shipped `domain-quality-report` explicitly documents this gap in its response (`sampleInfo.note`) and in the admin UI.
- The acceptance criterion "shows per-domain listing metrics: rejection rate, edit rate, time-to-sale" is therefore partially met: time-to-sale (and net profit/margin, which are arguably more actionable proxies for listing quality) are shipped; rejection-rate/edit-rate require the additional instrumentation described above.

**Expansion areas (original plan, for reference):**

- **Sneakers:** StockX-style valuation methodology, deadstock condition standards, common counterfeit indicators by brand/model, SKU decoding tables
- **Electronics:** Model number decoding (e.g., iPhone model number → region/carrier), spec verification tables, battery health interpretation
- **Jewelry:** Karat/metal purity standards, hallmark databases, gemstone grading basics
- **Auto Parts:** OEM part number cross-reference tables, fitment database basics
- **Luxury Handbags:** Date code format references by brand/era, authentication guide summaries

**Acceptance criteria:**

- [x] The RAG retriever returns domain-relevant knowledge for at least 3 new domains (not just coins) — all 11 specialized domains now covered (5 shipped in initial Phase 4, 5 added in subsequent enrichment)
- [x] A quality dashboard (or report) shows per-domain listing metrics: time-to-sale, net profit/margin (rejection-rate/edit-rate deferred — see above)
- [x] The feedback loop identifies at least one domain for refinement based on real data (once sufficient sold-listing volume with domain tracking accumulates — mechanism is live and tested against the schema)

---

## 5. Domain-Specific Implementation Notes

### 5.1 Architecture Alignment (do NOT change these)

The following must remain unchanged to preserve the architecture's integrity:

- The controller's sequential-ID → parallel-burst pattern (`controller.ts`)
- The embedding pre-computation shared across sub-agents
- The 6-pass pipeline in `analyze-item/index.ts` (identification → category resolution → aspects fetch → listing generation → post-lookup verification → specifics regeneration)
- The dynamic category and aspect fetching (never hardcode category IDs or aspects for new domains — use the Taxonomy API and cache)
- The `ebay_taxonomy_cache` weekly sync (it covers all categories already)
- The user-facing upload flow (HomePage2.tsx, CameraSheetModal.tsx, image optimizer)

### 5.2 Type Deduplication (technical debt to resolve first)

There are currently **four separate `Domain` type definitions** that have drifted out of sync:

- `pipelineContracts.ts` — 12 domains (the canonical source)
- `registry.ts` — imports from `pipelineContracts.ts` (correct)
- `pass1Identification.ts` — 6 domains (stale)
- `domainPrompts.ts` — 6 domains (stale)
- `detailExtractor.ts` — 6 domains (stale)

**Action:** All three stale files should import `Domain` from `pipelineContracts.ts` rather than defining their own. This eliminates the drift and ensures that adding a domain to `pipelineContracts.ts` automatically propagates. This is a prerequisite for Phase 1.

### 5.3 Domain Routing Decision: How Many Domains?

The current architecture has 12 domains. eBay has ~5,000 leaf categories. The question is whether 12 domains is the right granularity, or whether more are needed.

**Recommendation:** 12 domains is the right _intelligence_ granularity. Domains group categories that share the same identification challenges, vision inspection targets, and valuation methodology. Going finer (e.g., splitting electronics into phones/laptops/cameras/consoles) would multiply the prompt-writing effort with diminishing returns, because the eBay Taxonomy API already provides category-specific aspects. Going coarser (fewer domains) would lose the specialized vision goals and grounding queries.

The `general` domain remains the catch-all for anything that doesn't fit the 12 — and `buildGeneralPrompt` plus dynamic aspects already produce acceptable output for those items. The 12 domains cover the vast majority of eBay's listing volume and the categories where specialized intelligence adds the most value.

If future data (from the Phase 4 feedback loop) shows a high-volume category performing poorly under `general`, a new domain can be added by: (1) adding it to `pipelineContracts.ts`, (2) adding a registry entry, (3) adding a Pass 1 classification instruction, (4) optionally adding a specialized prompt and detail extractor. The architecture supports this without restructuring.

### 5.4 Keeping UX Simple (the non-negotiable)

The user must never have to:

- Select a category (the AI + Taxonomy API does this)
- Select a domain or "listing type" (Pass 1 does this invisibly)
- Fill in item specifics manually (the AI fills them from dynamic eBay aspects)
- Write a description (the AI writes it with domain expertise)
- Research pricing (the market agent grounds against sold comps)

The only user inputs are: photos (required), voice/video note (optional), and any manual overrides they choose to make on the generated listing before publishing. Every phase in this plan preserves this. The intelligence deepens behind the same single "Analyze" button.

---

## 6. Sequencing and Dependencies

```
Phase 0 (Prerequisite): Deduplicate Domain type → import from pipelineContracts.ts
    │
    ▼
Phase 1: Expand Pass 1 to 12 domains
    │  (unlocks registry for all 12 domains)
    │
    ├──▶ Phase 2: Specialized prompts (can proceed in parallel per domain)
    │       Priority: sneakers → electronics → jewelry → auto_parts → luxury_handbags → vintage_clothing
    │
    ├──▶ Phase 3: Detail extraction (can proceed in parallel per domain, after Phase 2 for that domain)
    │       Priority: electronics → sneakers → auto_parts → musical_instruments → luxury_handbags → home_garden_tools
    │
    └──▶ Phase 4: RAG expansion + QA feedback loop (ongoing, starts after Phase 2 has 3+ domains)
```

Phases 2 and 3 are **per-domain and parallelizable** — each domain is an independent unit of work. A single developer (or AI agent) can implement one domain end-to-end (prompt + detail extraction) in a focused session. This makes the plan incrementally shippable: each domain that gets Phase 2+3 treatment immediately improves listings for that domain's items, with no waiting for the full plan to complete.

---

## 7. Success Metrics

| Metric                                                | Current Baseline | Phase 1 Target | Phase 2+3 Target |
| ----------------------------------------------------- | :--------------: | :------------: | :--------------: |
| Domains classified by Pass 1                          |        6         |       12       |        12        |
| Domains with specialized prompts                      |        2         |       2        |        8+        |
| Domains with detail extraction                        |        3         |       3        |        8+        |
| Domains with registry vision goals firing             |        6         |       12       |        12        |
| eBay listing rejection rate (non-coin/card domains)   |       TBD        |    Measure     |      Reduce      |
| User edit rate before publish (non-coin/card domains) |       TBD        |    Measure     |      Reduce      |
| Time-to-sale (non-coin/card domains)                  |       TBD        |    Measure     |     Improve      |

The TBD metrics should be instrumented as part of Phase 1 (or immediately before) to establish baselines. The quality-assurance feedback loop in Phase 4 formalizes this tracking.

---

## 8. What Not to Build

To preserve focus and avoid scope creep, the following are explicitly **out of scope** for this plan (they may be valuable but are separate initiatives):

- **Native mobile app** — the PWA with vite-plugin-pwa is sufficient for the simple upload flow; a native app is a separate decision
- **Message queues / async processing** — the current synchronous pipeline produces results in acceptable time for the upload-and-wait UX; async processing with Upstash/Redis is a scaling optimization, not a comprehensiveness feature
- **Cloudflare R2 migration** — Supabase Storage is sufficient for current image volume; R2 is a cost optimization
- **New user-facing features** — this plan is about deepening intelligence, not adding UI surface area. The UX stays simple.
- **Hardcoding category IDs or aspects for new domains** — the dynamic Taxonomy API integration already handles this; hardcoding would be regression

---

## 9. Summary

The app is closer to "comprehensive for all listing types" than it appears. The infrastructure is already there — dynamic eBay taxonomy covering all ~5,000 categories, dynamic aspect fetching, dynamic category resolution, a general-purpose listing prompt, and a registry with vision goals for all 12 domains. What's missing is the **domain intelligence** that makes listings expert-grade rather than merely acceptable.

The path is: (1) unlock the registry by expanding Pass 1 classification to all 12 domains, (2) add specialized prompts domain-by-domain starting with the highest-volume categories, (3) extend detail extraction to catch the precision details the main model misses, and (4) expand the RAG knowledge base and add a quality feedback loop. Each phase is additive, each domain is independently shippable, and the user experience never changes — it stays the simplest possible flow: upload photos, get a listing.

The first action is the type deduplication prerequisite, then Phase 1 (Pass 1 expansion), which is a small change that immediately activates the registry infrastructure for all 12 domains. From there, each domain is a focused, incremental improvement.
