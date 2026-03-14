# eBay Live Publishing Pre-Flight Checklist

## Overview
This checklist ensures your system is fully configured for live eBay publishing. Complete all items before attempting your first live listing.

---

## ✅ 1. Database Migration Status

### Required Migration
- [ ] **Migration `20260315000000_draft_publish_lifecycle.sql`** must be applied
  - **Why**: Adds `publish_status`, `ebay_sku`, `ebay_offer_id`, `ebay_listing_id` fields to track publish lifecycle
  - **How to apply**: Run this SQL in your Supabase dashboard SQL Editor:
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

### Verification Query
```sql
-- Check if columns exist
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'drafts'
AND column_name IN ('publish_status', 'ebay_sku', 'ebay_offer_id', 'ebay_listing_id');
```

---

## ✅ 2. eBay Developer Account Configuration

### Production API Credentials
- [ ] **EBAY_CLIENT_ID** environment variable set in Supabase
- [ ] **EBAY_CLIENT_SECRET** environment variable set in Supabase
- [ ] **EBAY_ENVIRONMENT** set to `"production"` in Supabase
- [ ] **EBAY_RUNAME** (RuName) configured in Supabase for OAuth redirect

### eBay Application Status
- [ ] eBay Developer Application is in **Production** status (not Sandbox)
- [ ] Application has the required scopes:
  - `https://api.ebay.com/oauth/api_scope`
  - `https://api.ebay.com/oauth/api_scope/sell.inventory`
  - `https://api.ebay.com/oauth/api_scope/sell.account`
  - `https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly`

### Verification
Check your eBay Developer Dashboard:
1. Go to https://developer.ebay.com/my/keys
2. Verify your application is in Production mode
3. Note your Client ID and Secret

---

## ✅ 3. eBay Seller Account Business Policies

### Required Policies
You MUST have at least these business policies configured in your eBay Seller Hub:

#### 1. Fulfillment (Shipping) Policy
- [ ] At least one fulfillment policy exists
- [ ] Policy is set as default or you can select it
- [ ] Shipping regions configured (e.g., US)
- [ ] Shipping service types selected (e.g., USPS Priority Mail)
- [ ] Handling time configured (e.g., 1-3 business days)

#### 2. Return Policy
- [ ] At least one return policy exists
- [ ] Return window configured (e.g., 30 days)
- [ ] Return shipping fee configured (who pays)
- [ ] Return type configured (e.g., money back, replacement)

#### 3. Payment Policy (Optional)
- [ ] Payment policy configured OR
- [ ] You're enrolled in eBay Managed Payments (most sellers) - **No payment policy needed**

### How to Create/Verify Policies
1. Go to https://www.ebay.com/sh/ovw/policies
2. Create policies if they don't exist
3. Note the Policy IDs for testing

### Verification Query (Optional)
The system will auto-fetch the first policy of each type if you don't specify IDs, but it's better to explicitly select them in the UI.

---

## ✅ 4. Supabase Environment Variables

### Required Environment Variables (Production)
Set these in your Supabase Edge Functions environment:

```bash
# eBay API Credentials
EBAY_CLIENT_ID=your_production_client_id
EBAY_CLIENT_SECRET=your_production_client_secret
EBAY_ENVIRONMENT=production
EBAY_RUNAME=your_ru_name

# Supabase Credentials
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional: eBay Partner Network (for affiliate links)
EPN_CAMPAIGN_ID=your_epn_campaign_id  # Optional
```

### How to Set Environment Variables in Supabase
1. Go to your Supabase project dashboard
2. Navigate to Edge Functions → Settings
3. Add each environment variable with its value
4. Save and redeploy the `ebay-publish` edge function

---

## ✅ 5. OAuth Token Status

### Token Storage
The system now securely stores eBay OAuth tokens in the `profiles` table:

- [ ] You've completed eBay OAuth flow at least once
- [ ] Token is stored in `profiles.ebay_access_token`
- [ ] Refresh token is stored in `profiles.ebay_refresh_token`
- [ ] Token expiry is tracked in `profiles.ebay_token_expires_at`

### Token Refresh Logic
- [ ] System automatically refreshes tokens when they expire within 5 minutes
- [ ] Proactive refresh is enabled in `get_stored_token` action

### Verification Query
```sql
-- Check if you have a valid token
SELECT 
  id,
  email,
  ebay_token_expires_at,
  CASE 
    WHEN ebay_token_expires_at > NOW() + INTERVAL '5 minutes' 
    THEN 'Valid' 
    ELSE 'Expiring or Expired' 
  END as token_status
FROM profiles
WHERE ebay_access_token IS NOT NULL;
```

---

## ✅ 6. Test Draft Preparation

### Draft Requirements
Create a test draft with these characteristics:

- [ ] **Title**: Clear, descriptive (e.g., "Vintage Silver Dollar - 1921 Morgan Dollar")
- [ ] **Description**: Detailed, accurate description
- [ ] **Condition**: One of the current valid values:
  - `NEW`, `LIKE_NEW`, `NEW_OTHER`, `NEW_WITH_DEFECTS`
  - `CERTIFIED_REFURBISHED`, `EXCELLENT_REFURBISHED`, `VERY_GOOD_REFURBISHED`, `GOOD_REFURBISHED`, `SELLER_REFURBISHED`
  - `PRE_OWNED_GOOD` (default), `PRE_OWNED_FAIR`, `PRE_OWNED_POOR`
  - `FOR_PARTS_OR_NOT_WORKING`
- [ ] **Listing Format**: `FIXED_PRICE` (AUCTION is not supported by Inventory API)
- [ ] **Listing Price**: Set appropriately (e.g., $50.00)
- [ ] **eBay Category**: Selected appropriate category (e.g., "Coins: US: Dollars: Morgan")
- [ **Item Specifics**: At least one item specific (e.g., Year: 1921)
- [ ] **Image**: Valid image URL uploaded to Supabase Storage
- [ ] **Policies**: Fulfillment and Return policies selected

### Important Notes
- **Do NOT use deprecated conditions**: `USED_EXCELLENT`, `USED_VERY_GOOD`, `USED_GOOD`, `USED_ACCEPTABLE`
- **Do NOT use AUCTION format**: The Inventory API only supports FIXED_PRICE
- **Always select policies**: Don't rely on auto-selection for production

---

## ✅ 7. Code Verification

### All Fixes from PR #73 Applied
Verify these files contain the latest fixes:

- [ ] `supabase/functions/ebay-publish/index.ts`
  - [ ] Contains `CONDITION_ID_MAP` with all 13 current conditions
  - [ ] Contains `CONDITION_DESCRIPTIONS` for human-readable descriptions
  - [ ] Contains `LEGACY_CONDITION_MAP` for backwards compatibility
  - [ ] `paymentPolicyId` is optional in offer builders
  - [ ] AUCTION format blocking is implemented
  - [ ] Token refresh logic with 5-minute proactive refresh

- [ ] `src/types/listing.ts`
  - [ ] `EBAY_CONDITION_ID_MAP` includes all 13 current conditions
  - [ ] `CONDITION_LABELS` includes human-readable labels

- [ ] `src/hooks/usePublishDraft.ts`
  - [ ] Default condition is `PRE_OWNED_GOOD`
  - [ ] AUCTION error handling with clear toast message
  - [ ] Policy validation warnings

- [ ] `src/pages/AnalyzePage.tsx`
  - [ ] Condition dropdown includes all 13 options
  - [ ] Default condition is `PRE_OWNED_GOOD`

- [ ] `src/components/EditDraftModal.tsx`
  - [ ] Conditions array includes all 13 options
  - [ ] Default condition is `PRE_OWNED_GOOD`

---

## ✅ 8. Error Handling & Monitoring

### Expected Error Scenarios
Be prepared for these potential errors:

1. **Missing Business Policies**
   - Error: "Missing required eBay business policies: Fulfillment (Shipping), Return"
   - Solution: Create policies in eBay Seller Hub

2. **Auction Format Attempt**
   - Error: "Auction format is not supported by the eBay Inventory API"
   - Solution: Change listing format to Fixed Price

3. **Token Expired**
   - Error: "eBay session expired"
   - Solution: Reconnect eBay via OAuth flow

4. **Invalid Category ID**
   - Error: "Invalid category ID"
   - Solution: Select a valid eBay category

5. **Missing Image**
   - Error: "Image URL is required"
   - Solution: Upload an image to the draft

### Monitoring Queries
```sql
-- Monitor publish attempts
SELECT 
  id,
  title,
  publish_status,
  published_at,
  ebay_listing_id,
  last_publish_error
FROM drafts
WHERE publish_status IN ('publishing', 'failed')
ORDER BY updated_at DESC
LIMIT 20;

-- Monitor successful publishes
SELECT 
  id,
  title,
  published_at,
  ebay_listing_id,
  ebay_sku
FROM drafts
WHERE publish_status = 'published'
ORDER BY published_at DESC
LIMIT 20;
```

---

## ✅ 9. Production Deployment

### Edge Function Deployment
- [ ] All edge functions deployed to Supabase production
- [ ] Environment variables configured in production
- [ ] Functions tested with production credentials

### Frontend Deployment
- [ ] Frontend deployed to production (Vercel/Netlify/etc.)
- [ ] Environment variables configured
- [ ] Build successful with no TypeScript errors

---

## ✅ 10. Pre-Live Test Checklist

### Before Your First Live Publish
- [ ] Database migration applied
- [ ] eBay credentials configured for production
- [ ] Business policies created in Seller Hub
- [ ] OAuth flow completed successfully
- [ ] Token stored in profiles table
- [ ] Test draft created with all required fields
- [ ] Test draft uses `FIXED_PRICE` format
- [ ] Test draft uses current condition codes (not deprecated)
- [ ] Policies selected in draft
- [ ] Image uploaded and URL valid
- [ ] Code verified to include all fixes

### First Test Publish
When you're ready to test:
1. Create a simple, low-value test item
2. Use a clear, descriptive title
3. Set a reasonable price
4. Select appropriate category and condition
5. Select fulfillment and return policies
6. Click "Publish to eBay"
7. Monitor for success/error messages
8. Verify the listing appears in your eBay Seller Hub

### Post-Publish Verification
After successful publish:
- [ ] Check draft's `publish_status` is `'published'`
- [ ] Check `ebay_listing_id` is populated
- [ ] Check `ebay_offer_id` is populated
- [ ] Check `ebay_sku` is populated
- [ ] Verify listing appears in eBay Seller Hub
- [ ] Check listing details match draft data
- [ ] Verify item specifics are correct
- [ ] Verify condition description is accurate

---

## 🚨 Common Gotchas to Avoid

### ❌ Deprecated Condition Codes
**Don't use**: `USED_EXCELLENT`, `USED_VERY_GOOD`, `USED_GOOD`, `USED_ACCEPTABLE`
**Use instead**: `PRE_OWNED_GOOD`, `PRE_OWNED_FAIR`, `PRE_OWNED_POOR`

### ❌ Auction Format
**Don't use**: `AUCTION` format with Inventory API
**Use instead**: `FIXED_PRICE` format only

### ❌ Missing Policies
**Don't rely on**: Auto-selection of policies for production
**Do instead**: Explicitly select fulfillment and return policies

### ❌ Invalid Images
**Don't use**: Broken or inaccessible image URLs
**Do instead**: Verify images are uploaded and accessible

### ❌ Expired Tokens
**Don't ignore**: Token expiry warnings
**Do instead**: Reconnect eBay when prompted

---

## 📞 Troubleshooting Resources

### eBay Developer Documentation
- Inventory API: https://developer.ebay.com/api-docs/sell/inventory
- OAuth Guide: https://developer.ebay.com/api-docs/static/oauth-client-credentials-quick-start.html
- Condition Enums: https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum

### System Logs
- Check Supabase Edge Function logs for detailed error messages
- Check browser console for client-side errors
- Check database logs for query errors

### Support
- eBay Developer Forums: https://developer.ebay.com/forums
- Supabase Support: https://supabase.com/support

---

## ✅ Ready to Publish?

Once you've completed all items in this checklist, you're ready to test live eBay publishing!

**Good luck! 🎉**