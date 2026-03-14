# Listing Assistant Pro — Fix Tracker

## Shipping location from profile (city + zip) [COMPLETE — commit 6c1e96c]
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