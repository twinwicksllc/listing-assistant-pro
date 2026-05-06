# Supabase Edge Functions Deployment

## Status

✅ **Feature #10 — Bulk Listing Generator** is merged to `main`
✅ All code is production-ready
⚠️ **Edge functions need manual deployment** (requires Supabase CLI or Dashboard access)

---

## Edge Functions to Deploy

### New Functions (for Bulk Listing Feature)

| Function | Purpose | File |
|----------|---------|------|
| `bulk-generate-descriptions` | Generate AI descriptions per row using GPT-4o-mini | `supabase/functions/bulk-generate-descriptions/index.ts` |
| `bulk-publish` | Batch publish listings to eBay (Inventory → Offer → Publish) | `supabase/functions/bulk-publish/index.ts` |

---

## Deployment Methods

### Option 1: Via Supabase Dashboard (Recommended)

1. Go to: https://supabase.com/dashboard/project/wcednzaxmxwfiijzmjmx/functions
2. Click **"New Function"**
3. For each function:
   - Name: `bulk-generate-descriptions`
   - Paste contents of `supabase/functions/bulk-generate-descriptions/index.ts`
   - Click **"Deploy"**
4. Repeat for `bulk-publish`

### Option 2: Via Supabase CLI (Requires Auth)

```bash
# Install Supabase CLI (if not already installed)
# Visit: https://supabase.com/docs/guides/cli/getting-started

# Link to your project
supabase link --project-ref wcednzaxmxwfiijzmjmx

# Deploy all functions (recommended)
supabase functions deploy

# Or deploy specific functions
supabase functions deploy bulk-generate-descriptions
supabase functions deploy bulk-publish

# Verify deployment
supabase functions list
```

### Option 3: Via GitHub Actions (Future Enhancement)

Add a workflow to auto-deploy edge functions when merged to main:

```yaml
# .github/workflows/deploy-functions.yml
name: Deploy Supabase Functions
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: supabase/setup-cli@v1
      - run: supabase functions deploy
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

---

## Post-Deployment Verification

### Test `bulk-generate-descriptions`

```bash
curl -X POST 'https://wcednzaxmxwfiijzmjmx.supabase.co/functions/v1/bulk-generate-descriptions' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "rows": [
      { "title": "Vintage Rolex", "categoryId": "31387", "condition": "Used" }
    ]
  }'
```

Expected response:
```json
{
  "results": [
    { "rowIndex": 0, "description": "AI-generated description here..." }
  ],
  "tier": "starter",
  "cap": 5
}
```

### Test `bulk-publish`

```bash
curl -X POST 'https://wcednzaxmxwfiijzmjmx.supabase.co/functions/v1/bulk-publish' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "dryRun": true,
    "rows": [
      { "title": "Test Item", "price": 99.99, "categoryId": "31387", "condition": "Used" }
    ]
  }'
```

Expected response (dry-run):
```json
{
  "published": 0,
  "failed": 0,
  "total": 1,
  "results": [
    { "rowIndex": 0, "status": "dry_run", "message": "Validation passed" }
  ]
}
```

---

## Environment Variables (if needed)

Both functions use the following Supabase environment variables automatically:
- `SUPABASE_URL` (auto-injected)
- `SUPABASE_SERVICE_ROLE_KEY` (auto-injected)
- `NEW_OPENAI_API_KEY` (already configured for existing `analyze-item` function)

No additional env vars required for the new functions.

---

## Summary Checklist

- [ ] Deploy `bulk-generate-descriptions` function
- [ ] Deploy `bulk-publish` function
- [ ] Test `bulk-generate-descriptions` with sample data
- [ ] Test `bulk-publish` with `dryRun: true`
- [ ] QA test full bulk wizard in production
- [ ] Verify plan-gating caps work correctly
- [ ] Verify eBay listings are created successfully

---

## Existing Functions (for reference)

All other functions are already deployed and should not need redeployment:
- `analyze-item` ✅
- `ebay-publish` ✅
- `ebay-policies` ✅
- `ebay-user` ✅
- `ebay-listings` ✅
- `ebay-pricing` ✅
- `ebay-reprice` ✅
- `ebay-competitor-search` ✅
- `spot-prices` ✅
- `transcribe-voice` ✅
- `create-checkout` ✅
- `customer-portal` ✅
- `check-subscription` ✅
- `stripe-webhook` ✅
- `category-lookup` ✅
- `setup-categories` ✅
- `get-free-credits` ✅
- `disconnect-ebay` ✅
- `competitor-prices-cron` ✅
- `cost-alert-cron` ✅
- `system-status` ✅