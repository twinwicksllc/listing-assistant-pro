# Todo: RAG Enrichment — Remaining 5 Domains
Branch: feature/phase4-rag-expansion-qa (extends PR #401)

## Research (complete — facts gathered for all 5 domains)
- [x] trading_cards: PSA 4-criteria grading (centering/corners/edges/surface), PSA 10 vs 9, BGS subgrades
- [x] vintage_clothing: ILGWU union label timeline (1900-2005), RN numbers, dating by tags
- [x] musical_instruments: Fender serial number eras (bridge/neckplate/headstock), MIJ/MIM prefixes
- [x] toys_collectibles: wear patterns, manufacturer marks, materials by era, AFA grading
- [x] home_garden_tools: vintage tool ID (patina/materials/maker marks/patent dates), safety cert marks (UL/ETL/CE/GS)

## Implement — registry mapping
- [x] Add 5 new entries to DOMAIN_RAG_CATEGORIES in registry.ts

## Implement — seed content (4-6 entries each)
- [x] TRADING_CARD_GRADING array
- [x] VINTAGE_CLOTHING_AUTHENTICATION array
- [x] MUSICAL_INSTRUMENT_AUTHENTICATION array
- [x] TOYS_COLLECTIBLES_AUTHENTICATION array
- [x] HOME_GARDEN_TOOLS_IDENTIFICATION array
- [x] Add all 5 new arrays to ALL_NEW_DOMAIN_CONTENT

## Update roadmap
- [x] Update COMPREHENSIVE_LISTING_TYPES_ROADMAP.md (RAG now covers all 11 specialized domains)

## Verify
- [x] deno check registry.ts — 0 errors
- [x] deno lint — clean
- [x] deno fmt --check — clean
- [x] npm run build (tsc) — clean
- [x] npm run lint (eslint) — clean
- [x] npm test (vitest) — all passing (24/24)
- [ ] Commit + push (updates PR #401)
