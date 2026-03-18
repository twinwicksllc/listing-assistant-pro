# Listing Assistant Pro — Feature Tracker & Status

## Recently Completed Features (v17-v27)

### Multi-Image Support [COMPLETE — v27 #127]
- [x] Support analyzing multiple photos of the same item
- [x] Drafts can now store multiple image URLs (image_urls array)
- [x] Fixed capture button flow for better UX
- [x] Updated useDrafts, usePublishDraft, AnalyzePage, HomePage, exportCSV

### Category Verification & Suggestions [COMPLETE — v26 #126]
- [x] Improved category-lookup function with google_search integration
- [x] Enhanced suggestedCategories helper function
- [x] Added admin requirement for category store operations
- [x] Added unit tests for category suggestions

### Braided Hair Large Cent Categories [COMPLETE — v24, v25]
- [x] Correct category ID to 39454 with Material requirement
- [x] Added category 41085 for Braided Hair Large Cent

### Category Input & CORS Fixes [COMPLETE — v23]
- [x] Fixed custom category input persistence on AnalyzePage
- [x] Fixed CORS issues for category-lookup
- [x] Fixed wheat penny category fallback

### Postal Code Persistence [COMPLETE — v26 #122]
- [x] Fixed postal code persistence during eBay authentication
- [x] Ensures location data flows correctly through auth flow

### Custom Category Persistence [COMPLETE — v25 #121]
- [x] Fixed custom category persistence on AnalyzePage
- [x] Ensures user-selected categories are saved correctly

### Edit Draft Persistence [COMPLETE — v24 #120]
- [x] Fixed split-state bug in EditDraftModal
- [x] Ensures draft edits persist correctly

### Sequential Publishing [COMPLETE — v21 #119]
- [x] Added sequential publishing logic with retry
- [x] Added missing coin category mappings

## Previous Fixes

### Numerical grade removal for uncertified coins [COMPLETE — commit 64958da]
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

## Additional Features to Consider

### Based on Recent Codebase Analysis

#### 1. Enhanced Category Mapping System [HIGH PRIORITY]
**Current State:**
- `category-lookup` function provides verified coin→category mappings
- `setup-categories` seeds initial mappings (10 common coin types)
- `category_mappings` table with confidence scores and verification sources

**Potential Enhancements:**
- [ ] Add bulk import tool for category mappings (CSV/JSON upload)
- [ ] Implement category mapping approval workflow for team members
- [ ] Add category mapping analytics (most requested, accuracy tracking)
- [ ] Create admin UI for managing category mappings
- [ ] Add automatic category suggestion improvement based on user feedback
- [ ] Integrate more verification sources beyond Google Search

#### 2. Multi-Image Analysis Improvements [MEDIUM PRIORITY]
**Current State:**
- Multi-image drafts are now supported (v27)
- Images stored in `image_urls` array

**Potential Enhancements:**
- [ ] AI analysis of multiple angles (front, back, edge, obverse)
- [ ] Image quality detection and enhancement suggestions
- [ ] Automatic image ordering (obverse first, reverse second, etc.)
- [ ] Image comparison for detecting multiple items in one listing
- [ ] Multi-image pricing (different angles may reveal different conditions)

#### 3. Advanced Pricing Features [HIGH PRIORITY]
**Current State:**
- AI-generated price range based on recent sold listings
- Melt value protection for precious metals
- Competitor price tracking

**Potential Enhancements:**
- [ ] Price trend analysis (historical price charts)
- [ ] Seasonal pricing adjustments
- [ ] Bulk pricing suggestions for multiple items
- [ ] Price optimization algorithms (maximize sell-through vs. profit)
- [ ] Competitive intelligence (market position relative to competitors)
- [ ] Price alerts when similar items sell outside expected range

#### 4. Draft Management Enhancements [MEDIUM PRIORITY]
**Current State:**
- Drafts stored in database
- Edit functionality available
- Export to CSV/other formats

**Potential Enhancements:**
- [ ] Draft templates and presets
- [ ] Batch operations (bulk publish, bulk delete, bulk edit)
- [ ] Draft sharing between team members
- [ ] Draft versioning and history
- [ ] Auto-save improvements (debounced saving)
- [ ] Draft analytics (completion rates, common edit patterns)

#### 5. eBay Integration Improvements [HIGH PRIORITY]
**Current State:**
- Direct publishing to eBay
- Business policy selection
- Inventory location management
- Sequential publishing with retry logic

**Potential Enhancements:**
- [ ] eBay listing monitoring (views, watchers, offers)
- [ ] Automatic price adjustments based on market data
- [ ] Bulk listing updates (price, quantity, descriptions)
- [ ] eBay order syncing and management
- [ ] Message inbox integration
- [ ] Listing performance analytics

#### 6. Organization & Team Features [MEDIUM PRIORITY]
**Current State:**
- Organization support exists
- Team member management

**Potential Enhancements:**
- [ ] Role-based permissions (admin, lister, viewer)
- [ ] Team activity logging and audit trail
- [ ] Organization-wide analytics and reporting
- [ ] Shared templates and policies
- [ ] Team collaboration features (comments, assignments)

#### 7. AI & Analysis Improvements [HIGH PRIORITY]
**Current State:**
- Gemini AI for image analysis
- Voice note support
- Title/description/item specifics generation

**Potential Enhancements:**
- [ ] Fine-tuned AI models for specific coin categories
- [ ] Counterfeit detection alerts
- [ ] Historical significance highlighting
- [ ] Rarity scoring and key date identification
- [ ] Condition grading consistency checks
- [ ] Multi-language support for international listings

#### 8. User Experience & UI Improvements [MEDIUM PRIORITY]
**Current State:**
- PWA support
- Mobile-responsive design
- Welcome tour

**Potential Enhancements:**
- [ ] Dark mode support
- [ ] Keyboard shortcuts and hotkeys
- [ ] Advanced search and filtering
- [ ] Customizable dashboards
- [ ] Drag-and-drop image reordering
- [ ] Mobile app (React Native)

#### 9. Analytics & Reporting [HIGH PRIORITY]
**Current State:**
- Usage tracking
- System status monitoring

**Potential Enhancements:**
- [ ] Detailed sales analytics
- [ ] Profit/loss tracking
- [ ] Time-to-sell analysis
- [ ] Category performance reports
- [ ] AI accuracy metrics
- [ ] Export to various formats (PDF, Excel, Google Sheets)

#### 10. Integration Extensions [LOW PRIORITY]
**Current State:**
- eBay integration
- Stripe for payments
- Supabase for backend

**Potential Enhancements:**
- [ ] Other marketplace integrations (Etsy, Mercari, Poshmark)
- [ ] Shipping carrier integrations (USPS, FedEx, UPS)
- [ ] Inventory management system integrations
- [ ] Accounting software integrations (QuickBooks, Xero)
- [ ] Email marketing integrations

### Infrastructure & DevOps Improvements

#### Testing & Quality Assurance
- [ ] Comprehensive unit test suite
- [ ] E2E testing with Playwright
- [ ] Load testing for concurrent users
- [ ] Automated regression testing
- [ ] Performance monitoring and optimization

#### Documentation & Onboarding
- [ ] API documentation
- [ ] Developer guide for extensions
- [ ] Video tutorials
- [ ] FAQ and troubleshooting guide
- [ ] Community forum setup

#### Security & Compliance
- [ ] Security audit
- [ ] GDPR compliance checklist
- [ ] Data encryption at rest
- [ ] Enhanced rate limiting
- [ ] Fraud detection systems

## Previous fixes
- [x] v14 (072bc76): fix errorId 25002 Country of Origin too long — AI hallucination guard
- [x] v13 (7d39e03): fix errorId 25005 not-a-leaf-category for US Mint Proof Sets (253→41109)
- [x] v12 (17dd131): fix errorId 25604 Product not found — normalizePreciousMetalContent()