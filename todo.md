# Listing Assistant Pro — Fix Tracker

## Location data flow audit & fix [IN PROGRESS — commit 7a2883f]
- [x] User reported: city/postal_code set in profile but listings showing NYC instead of 60046 (Skokie, IL)
- [x] Traced data flow:
  1. ProfileModal saves postal_code + city correctly ✓
  2. usePublishDraft.getEbayToken() receives postal_code (60046) ✓ but city=undefined ✗
  3. Root cause: city column migration exists but wasn't executed in Supabase database
- [x] Added enhanced logging to identify exactly where data is lost:
  - get_stored_token: logs db query results with types for both postal_code and city
  - usePublishDraft: logs when server-side vs localStorage token is used
  - create_draft: logs effective postal_code/city and fallback usage
- [ ] User action required: Run migration 20260318000000_add_city_to_profiles.sql in Supabase
- [ ] User action required: Save profile again with city + postal_code
- [ ] User action required: Re-publish a draft and verify logs show city flowing through

## eBay grading policy enforcement (errorId 25019) [COMPLETE — commit 31eff7c]
- [x] Identify issue: eBay prohibits numerical grades (AU-55, MS-65, VF-30) unless coin is certified by official grader (NGC, PCGS, ANACS, ICG, CAC, ICCS)
- [x] Three coins failed today with this exact error:
  1. "1972 Eisenhower Dollar US $1 Coin Circulated Type I Philadelphia Mint"
  2. "1921 P Morgan Silver Dollar $1 US Coin 90% Silver AU 58 Uncertified"
  3. "1974-D Eisenhower Dollar IKE $1 Coin US Mint Denver Circulated AU 55"
- [x] Add CRITICAL GRADING RULE to analyze-item system prompt (section 4)
- [x] Update EBAY TITLE section (section 2) — forbid numerical grades for uncertified coins
- [x] Update ITEM DESCRIPTION section (section 3) — use descriptive language only for uncertified
- [x] Update STRUCTURED ITEM SPECIFICS section (section 5) — omit Grade field if Certification='Uncertified'
- [x] Update ASPECT VALUE FORMATS — explicitly state Grade only for certified coins
- [x] Update tool parameter description for Grade field to enforce the rule
- [x] Commit: v18 enforce eBay grading policy (31eff7c)

## Shipping location from profile (city + zip) [MOSTLY COMPLETE — v15 @ 6c1e96c]
- [x] Audit publish flow — found postalCode already read from profiles but city was missing; fallback hardcoded to NYC 10001
- [x] Migration: add city column to profiles (postal_code already existed)
- [x] ProfileModal: add City + ZIP fields under "Shipping Location" section with MapPin icon
- [x] ebay-publish v15: ensureInventoryLocation accepts city, get_stored_token returns city, create_draft passes city; fallback 10001→60601
- [x] usePublishDraft: getEbayToken returns city; city passed in publish payload

## EditDraftModal save bugs [COMPLETE — commit 213cdc4]
- [x] Fix policy display race (show selects immediately, "Loading…" placeholder)
- [x] Fix policy auto-select overwriting saved values (functional updater)
- [x] Fix category breadcrumb stale display + never cleared in DB

## Debug postal code / city flow [COMPLETE — commit 0e98492]
- [x] Add console.log in usePublishDraft to log postalCode + city from getEbayToken result
- [x] Add console.log in ebay-publish to log postalCode + city read from DB
- [x] Add _debug_postalCode and _debug_city fields to publishPayload for tracing

## World Coins category 45243 support [COMPLETE — commit f59241a]
- [x] ebay-publish: added 45243 to CATEGORY_ASPECT_RULES (preferred aspects + Certification default)
- [x] ebay-publish: expanded Composition set (Brass, Aluminum, Bimetallic, Copper-Nickel, Copper Clad, Zinc Plated Steel)
- [x] ebay-publish: added Color set (RD, RB, BN) to VALID_ASPECT_VALUES
- [x] analyze-item: expanded Composition enum to match publish validation
- [x] analyze-item: added Color field (RD/RB/BN, copper/bronze only) to schema
- [x] analyze-item: added "Materials sourced from" field (issuing country) to schema
- [x] analyze-item: added detailed WORLD COINS 45243 section to prompt (required/preferred aspects + key rules)
- [x] analyze-item: fixed stale C: prefix note in itemSpecifics description
- [x] analyze-item: added Color format rule to ASPECT VALUE FORMATS section
- [x] Committed and pushed (2 commits: 0e98492, f59241a → main)

## Previous fixes
- [x] v14 (072bc76): fix errorId 25002 Country of Origin too long — AI hallucination guard
- [x] v13 (7d39e03): fix errorId 25005 not-a-leaf-category for US Mint Proof Sets (253→41109)
- [x] v12 (17dd131): fix errorId 25604 Product not found — normalizePreciousMetalContent()