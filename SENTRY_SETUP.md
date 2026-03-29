# Sentry Setup Guide for Production Error Tracking

This document explains how to set up Sentry for real-time error monitoring in production.

## What is Sentry?

Sentry is an error tracking platform that captures exceptions from your application and provides:
- **Real-time alerts** when errors occur
- **Error context** (stack traces, user info, browser environment)
- **Trend tracking** (error frequency, affected users)
- **Release tracking** (which version introduced the bug)

## Setup Steps

### 1. Create a Free Sentry Account

1. Go to https://sentry.io/signup/
2. Sign up with GitHub (or email)
3. Create a new organization (or use existing)
4. Create a new project:
   - **Platform**: Deno
   - **Alert frequency**: I want to be alerted on every new issue
   - **Project name**: `listing-assistant-pro`

You'll get a **DSN** that looks like:
```
https://xxxxx@oxxxxx.ingest.sentry.io/yyyy
```

### 2. Add DSN to Environment Variables

**For local development:**
```bash
# Create/update .env.local
echo "SENTRY_DSN=https://xxxxx@oxxxxx.ingest.sentry.io/yyyy" >> .env.local
```

**For production (Supabase):**
1. Go to Supabase dashboard → Settings → Environment variables
2. Add new variable:
   - **Name**: `SENTRY_DSN`
   - **Value**: `https://xxxxx@oxxxxx.ingest.sentry.io/yyyy`
   - **Environment**: Production
3. Click Save
4. Redeploy functions: `supabase functions deploy --use-api`

### 3. Verify Setup

The Sentry integration is already in place for these functions:
- `analyze-item`
- `ebay-publish`
- `ebay-pricing`

Each function will:
1. Call `initSentry()` on startup ✅
2. Capture errors in the main `catch` block ✅
3. Include context (function name, user ID, action type) ✅

To test:
```bash
# Generate a test error (optional)
# Call a function with invalid data and check Sentry dashboard
```

### 4. Monitor Errors in Production

1. Access your Sentry dashboard: https://sentry.io/organizations/your-org/issues/
2. Click on an error to see:
   - **Stack trace** — exactly where the error occurred
   - **Breadcrumbs** — what happened before the error
   - **User context** — which user hit the error
   - **Release** — which version of code had the bug
   - **Affected users** — how many people were impacted

### 5. Set Up Alerts (Optional)

In Sentry dashboard → Alerts:
1. Create alert rule:
   - **Filter**: `issue.title:* (all errors)`
   - **Actions**: `Send to Slack` or `Send email`
   - **Conditions**: Every new issue OR when <X> events in <timeframe>

Example: Alert when more than 5 errors occur in 1 minute.

---

## Free Tier Limits

Sentry's free plan includes:
- **100,000 events/month** free (plenty for early-stage apps)
- **90-day data retention**
- **Up to 3 team members**
- **Basic release tracking**

Upgrade to Pro ($99/month) if you exceed limits.

---

## What Gets Captured

Each error automatically includes:

```json
{
  "error": "ReferenceError: xyz is not defined",
  "function": "analyze-item",
  "timestamp": "2026-03-29T15:30:45Z",
  "context": {
    "function": "analyze-item",
    "userId": "user-uuid-xxx",
    "action": "create_listing"
  },
  "stack_trace": "at Object.<anonymous> (file:///deno/...",
  "environment": "production"
}
```

This gives you **complete visibility** into what broke and why.

---

## Troubleshooting

### Errors not appearing in Sentry?

1. **Verify DSN is set**: 
   ```bash
   # Check environment variables
   supabase secrets list
   ```

2. **Check Sentry project permissions**:
   - Go to https://sentry.io/settings/projects/listing-assistant-pro/
   - Verify DSN is correct

3. **Verify function is running**:
   - Check Supabase function logs
   - Confirm error actually occurred (not silently caught elsewhere)

4. **Network issue?**
   - If Sentry is down, errors are silently dropped (no impact on app)
   - App continues working normally

### Too many errors?

If you're seeing spam errors:
1. Go to Sentry dashboard → Alerts
2. Create filter to ignore certain patterns
3. Or fix the bug and redeploy

---

## Cost Summary

| Scenario | Cost |
|----------|------|
| <100k errors/month | Free |
| 100-500k errors/month | $29-99/month |
| 500k+ errors/month | Contact sales |

For a production app with good error handling, you'll likely stay in the **free tier** (or low Pro tier).

---

## Next: Deploy & Test

```bash
# 1. Commit Sentry changes
git add supabase/functions/_helpers/sentry.ts \
  supabase/functions/analyze-item/index.ts \
  supabase/functions/ebay-publish/index.ts \
  supabase/functions/ebay-pricing/index.ts

git commit -m "feat: add Sentry error tracking to core functions"

# 2. Deploy
supabase functions deploy --use-api

# 3. Test error (optional - call function with invalid data)
# 4. Check Sentry dashboard for the error
```

---

## Support

- **Sentry Docs**: https://docs.sentry.io/product/
- **Deno Integration**: https://docs.sentry.io/platforms/javascript/guides/deno/
- **Getting Help**: support@sentry.io
