# Listing Assistant Pro — Fix Tracker

## Numerical grade removal for uncertified coins [COMPLETE — commit 64958da]
- [x] User reported: analyze function still assigning numerical grades despite v18 fix
- [x] Root cause: Section 4B contradicted the CRITICAL GRADING RULE
  - 4B said: "Assign a conservative Sheldon-scale grade (e.g., MS-63, AU-55, XF-45)"  
  - Critical Rule said: "Do NOT include ANY numerical grade if Uncertified"
  - AI was following the detailed instruction, not the rule
- [x] Complete rewrite of Section 4 (Condition Assessment & Grading):
  - Removed: instruction to assign numerical grades to unslabbed coins
  - Added: documentation of visual condition features (descriptively only)
  - Clarified: condition code is derived from observations, not exposed as grade
  - Enforced: numerical grades explicitly forbidden for uncertified coins
- [x] Enhanced key date/mint mark focus:
  - Section 2 (Title): Emphasize key dates and mint marks in SEO-optimized titles
  - Section 3 (Description): Highlight scarce years, mint marks, key producers (bullion)
  - Pricing: Key dates/scarce years get significant numismatic premium
- [x] Updated tool parameter descriptions:
  - suggestedGrade: Explicitly "DO NOT POPULATE FOR UNCERTIFIED COINS"
  - gradingRationale: Explicitly "DO NOT POPULATE FOR UNCERTIFIED COINS"  
  - Both now clear: ONLY for slabbed/certified coins
- [x] Version: v20

## Location data flow audit & fix [COMPLETE — commit 76b50b7]
- [x] User reported: city/postal_code set in profile but listings showing NYC instead of 60046 (Lake Villa, IL)
- [x] Traced data flow:
  1. ProfileModal saves postal_code + city correctly ✓
  2. Database stores postal_code + city correctly ✓
  3. usePublishDraft.getEbayToken() receives postal_code + city correctly ✓
  4. Payload sent to ebay-publish includes postalCode + city correctly ✓
- [x] Root cause identified: ensureInventoryLocation() was reusing stale location
  - "default-location" already existed from earlier publishes with old address
  - Function detected "already exists" (errorId 25803) and just returned key without updating
  - Should PATCH the existing location with new address, not reuse it
- [x] Added enhanced logging (commit 7a2883f):
  - get_stored_token: detailed database query results  
  - usePublishDraft: token source logging
  - create_draft: location setup logging
- [x] Fixed ensureInventoryLocation() (commit 76b50b7):
  - Try POST to create location
  - If exists (409/25803), PATCH to update address
  - PATCH sends new city/postal_code to eBay
  - Updated v17→v19 for code version

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