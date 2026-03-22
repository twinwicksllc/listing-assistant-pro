# Feature #10 — Bulk Listing Generator

## Phase 1: Foundation
- [ ] Install papaparse dependency
- [ ] Create src/types/bulk-listing.ts
- [ ] Create src/lib/bulkCsvParser.ts
- [ ] Create src/lib/bulkTemplates.ts
- [ ] Create src/lib/bulkValidation.ts

## Phase 2: Edge Functions
- [ ] Create supabase/functions/bulk-generate-descriptions/index.ts
- [ ] Create supabase/functions/bulk-publish/index.ts

## Phase 3: Components
- [ ] Create src/components/BulkUploadZone.tsx
- [ ] Create src/components/BulkColumnMapper.tsx
- [ ] Create src/components/BulkDataTable.tsx
- [ ] Create src/components/BulkTemplateCard.tsx
- [ ] Create src/components/BulkProgressBar.tsx

## Phase 4: Page & Routing
- [ ] Create src/pages/BulkListingPage.tsx (4-step wizard)
- [ ] Add /bulk route in src/App.tsx
- [ ] Add Bulk tab to src/components/BottomNav.tsx
- [ ] Add Bulk List card to src/pages/HomePage.tsx

## Phase 5: Polish & Deploy
- [ ] npm run build — zero TypeScript errors
- [ ] Commit + push branch
- [ ] Open PR