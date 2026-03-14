# Pre-Live Test Summary - eBay Publishing

## Current Status

### All Code Fixes Implemented (PR #73 - Merged)

All 12 flaws from the third round of reviewer feedback have been addressed and merged to main:

1. **Flaw #1: Deprecated Condition Codes** - Fixed
   - Updated all 7 files to use current eBay condition enums
   - Default changed from USED_EXCELLENT to PRE_OWNED_GOOD
   - Legacy condition migration map added for backwards compatibility

2. **Flaw #2: AUCTION Format Blocking** - Fixed
   - Added explicit AUCTION format check in edge function
   - Returns clear error message directing user to Fixed Price
   - Client-side error handling with helpful toast notification

3. **Flaw #5: Payment Policy Optional** - Fixed
   - Made paymentPolicyId optional in both buildFixedPriceOffer and buildAuctionOffer
   - Only fulfillment and return policies are required
   - Clear error message if required policies are missing

4. **Flaw #7: Token Expiry/Refresh** - Fixed
   - Added 5-minute proactive refresh window in get_stored_token
   - Explicit refresh_token action available
   - Token stored securely in profiles table

5. **Flaw #8: Condition Descriptions** - Fixed
   - Added CONDITION_DESCRIPTIONS map with human-readable descriptions
   - Applied to conditionDescription field in inventory item

6. **Flaws #3, #4, #6, #9-12** - Already addressed in previous work

### Database Schema Ready

Migration file 20260315000000_draft_publish_lifecycle.sql is ready to be applied:
- Adds publish_status lifecycle tracking
- Adds ebay_sku, ebay_offer_id, ebay_listing_id for tracking
- Adds last_publish_error for debugging
- Includes indexes for performance

---

## Critical Actions Required Before Live Testing

### 1. Apply Database Migration (REQUIRED)

You must run this SQL migration in your Supabase dashboard:

```sql
ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS publish_status   TEXT    DEFAULT 'draft'
    CHECK (publish_status IN ('draft', 'publishing', 'published', 'failed')),
  ADD COLUMN IF NOT EXISTS published_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ebay_sku         TEXT,
  ADD COLUMN IF NOT EXISTS ebay_offer_id    TEXT,
  ADD COLUMN IF NOT EXISTS ebay_listing_id  TEXT,
  ADD COLUMN IF NOT EXISTS last_publish_error TEXT;

CREATE INDEX IF NOT EXISTS idx_drafts_publish_status ON drafts(publish_status);
CREATE INDEX IF NOT EXISTS idx_drafts_ebay_sku ON drafts(ebay_sku) WHERE ebay_sku IS NOT NULL;
```

### 2. Verify eBay Production Credentials

Ensure these environment variables are set in Supabase Edge Functions:

- EBAY_CLIENT_ID (production)
- EBAY_CLIENT_SECRET (production)
- EBAY_ENVIRONMENT=production
- EBAY_RUNAME (your RuName for OAuth redirect)

### 3. Create eBay Business Policies

You MUST have these policies in your eBay Seller Hub:

1. **Fulfillment (Shipping) Policy** - Required
2. **Return Policy** - Required
3. **Payment Policy** - Optional if using Managed Payments

Create them at: https://www.ebay.com/sh/ovw/policies

### 4. Complete OAuth Flow

Before your first publish:
- Connect your eBay account via OAuth
- Verify token is stored in profiles table
- Check token expires_at is in the future

### 5. Prepare Test Draft

Create a test draft with:
- FIXED_PRICE format (NOT AUCTION)
- Current condition code (PRE_OWNED_GOOD, etc.)
- Valid image URL
- Selected fulfillment and return policies
- Appropriate category

---

## Remaining Considerations

### Gotchas Already Handled

1. **Deprecated Conditions**: Legacy condition codes automatically migrate
2. **Auction Format**: Blocked with clear error message
3. **Token Refresh**: Automatic proactive refresh
4. **Payment Policy**: Optional for managed payments sellers
5. **Deterministic SKU**: Enables idempotent retries

### Potential Issues to Watch

1. **Category-Specific Requirements**
   - Some categories require specific item specifics
   - Some categories have different condition options
   - eBay may reject if required specifics are missing

2. **Image Requirements**
   - Must be at least 500px on longest side
   - Must be accessible (not blocked)
   - Must be valid format (JPG, PNG, GIF)

3. **Title Requirements**
   - Must be 5-80 characters
   - No HTML or special formatting
   - Must accurately describe the item

4. **Price Requirements**
   - Must be positive number
   - Some categories have minimum prices
   - Must be reasonable for category

5. **Policy Compatibility**
   - Fulfillment policy must support destination
   - Return policy must be valid for category
   - Some categories require specific policy types

---

## Testing Strategy

### 1. Sandbox Testing First (Recommended)

If you have sandbox credentials:
1. Set EBAY_ENVIRONMENT=sandbox
2. Test complete flow in sandbox
3. Verify all fields are correct
4. Check listing appears in sandbox Seller Hub

### 2. Production Testing

When ready for production:
1. Use a low-value test item
2. Set clear, descriptive title
3. Select appropriate category
4. Use PRE_OWNED_GOOD condition
5. Select policies explicitly
6. Monitor for errors
7. Verify listing appears in Seller Hub

### 3. Post-Publish Verification

After successful publish:
- Check publish_status = 'published'
- Verify ebay_listing_id populated
- Check listing on eBay directly
- Verify all details match draft

---

## Files Modified in PR #73

1. supabase/functions/ebay-publish/index.ts
2. src/types/listing.ts
3. src/pages/AnalyzePage.tsx
4. src/components/EditDraftModal.tsx
5. src/lib/exportCSV.ts
6. src/hooks/usePublishDraft.ts
7. supabase/functions/analyze-item/index.ts
8. supabase/migrations/20260315000000_draft_publish_lifecycle.sql (new)

---

## Next Steps

1. Apply the database migration
2. Verify production credentials
3. Create business policies in Seller Hub
4. Complete OAuth flow
5. Create a test draft
6. Publish and verify