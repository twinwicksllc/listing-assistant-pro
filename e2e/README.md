# E2E Testing Setup Guide

## Overview

This project uses **Playwright** for end-to-end testing with two test suites:
- **PR Smoke Tests** (`e2e-pr-smoke.yml`): Quick validation on every PR (~5-10 min)
- **Weekly Full Lifecycle Tests** (`e2e-full-lifecycle.yml`): Comprehensive end-to-end validation weekly

---

## Prerequisites

### 1. Install Playwright Locally

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

### 2. Create Test Account in Supabase

Create a pre-seeded test user with a fixture UUID:

```sql
INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_sent_at
) VALUES (
  'qa0000000000test',
  'qa0000000000test@test.sovereignlistingsuite.com',
  crypt('QATest123!@#', gen_salt('bf')),
  now(),
  now(),
  now(),
  now()
);

INSERT INTO public.profiles (
  id,
  email,
  created_at,
  stripe_customer_id,
  plan
) VALUES (
  'qa0000000000test',
  'qa0000000000test@test.sovereignlistingsuite.com',
  now(),
  NULL,
  'free'
);
```

Or use the fixture's dynamic email creation (each test creates a unique test account).

### 3. Set Up eBay Sandbox API

**TODO:** You need to:
1. Create/verify sandbox API credentials at [eBay Developer Program](https://developer.ebay.com/)
2. Get **Sandbox API Key** and **Sandbox Token**
3. Store in GitHub Secrets as `EBAY_SANDBOX_API_KEY`

**Current Status:** Need to verify if you have sandbox credentials already.

### 4. Stripe Test Mode

Stripe test mode is already set up (4242 card number). No additional setup needed.

---

## GitHub Secrets Required

Add these to **Settings → Secrets and variables → Actions**:

| Secret | Value | Example |
|--------|-------|---------|
| `QA_BASE_URL` | Staging/preview URL | `https://qa.sovereignlistingsuite.com` |
| `SUPABASE_URL` | Supabase project URL | `https://your-project.supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon key | (from Settings → API in Supabase) |
| `SUPABASE_SERVICE_KEY` | Supabase service key | (for cleanup functions) |
| `EBAY_SANDBOX_API_KEY` | eBay sandbox API key | (get from eBay Developer) |
| `STRIPE_TEST_CARD` | Test card number | `4242424242424242` |

---

## Running Tests Locally

### Run all tests
```bash
npx playwright test
```

### Run smoke tests only
```bash
npx playwright test e2e/tests/smoke.spec.ts
```

### Run full lifecycle tests
```bash
npx playwright test e2e/tests/full-lifecycle.spec.ts
```

### Run with UI (debug mode)
```bash
npx playwright test --ui
```

### Run single test
```bash
npx playwright test -g "can create an account"
```

### View HTML report
```bash
npx playwright show-report
```

---

## Test Files Structure

```
e2e/
├── fixtures/
│   ├── helpers.ts          # Reusable test utilities
│   ├── test-coin.jpg       # Test photo: coin
│   ├── test-electronics.jpg # Test photo: electronics
│   └── test-clothing.jpg   # Test photo: clothing
├── tests/
│   ├── smoke.spec.ts       # PR smoke tests
│   └── full-lifecycle.spec.ts # Weekly full tests
└── README.md               # This file
```

---

## Test Photos

Create simple test images in `e2e/fixtures/`:

| Photo | Type | Size | Purpose |
|-------|------|------|---------|
| `test-coin.jpg` | Coin/Bullion | 1-2MB | Validate coin-specific categories |
| `test-electronics.jpg` | Electronics | 1-2MB | Validate non-collectible categories |
| `test-clothing.jpg` | Apparel/Clothing | 1-2MB | General-purpose item test |

**To create simple test images:**

```bash
# Using ImageMagick (if installed)
convert -size 1024x1024 xc:blue e2e/fixtures/test-coin.jpg
convert -size 1024x1024 xc:red e2e/fixtures/test-electronics.jpg
convert -size 1024x1024 xc:green e2e/fixtures/test-clothing.jpg

# Or upload your own sample images from the internet
```

---

## Test Data Cleanup

**Automatic cleanup** runs after successful weekly tests:
- Deletes test listings older than 7 days
- Keeps most recent failed test artifacts for 30 days
- Never deletes failed listings (for debugging)

**Manual cleanup:**

```sql
-- View all QA test listings
SELECT * FROM drafts WHERE created_by = 'qa0000000000test' ORDER BY created_at DESC;

-- Delete test listings older than 7 days
DELETE FROM drafts 
WHERE created_by = 'qa0000000000test' 
AND created_at < now() - interval '7 days';
```

---

## Troubleshooting

### Tests timeout waiting for elements
- Increase timeout in test: `{ timeout: 30_000 }`
- Verify selectors match your actual UI
- Check browser logs: `npx playwright test --debug`

### Stripe checkout not working in tests
- Stripe embeds in iframes; selectors must use `frameLocator()`
- Verify test card is `4242424242424242`
- See `fillStripeTestCard()` helper for reference

### eBay API calls fail
- Verify `EBAY_SANDBOX_API_KEY` is set
- Confirm you're calling sandbox endpoints (not live)
- Check rate limits (eBay allows ~100 req/min)

### Tests fail in CI but pass locally
- Likely environment variable not set in GitHub Secrets
- Check workflow logs for `undefined` errors
- Run locally with same env vars: `BASE_URL=... npx playwright test`

---

## Adding New Tests

1. Create new file in `e2e/tests/`:
```typescript
import { test, expect, signUp, generateListing } from '../fixtures/helpers';

test('new feature test', async ({ page, testUser }) => {
  await signUp(page, testUser);
  // ... your test steps
});
```

2. Use helpers from `fixtures/helpers.ts` for common operations

3. Add `[data-testid]` attributes to your components for reliable selectors

---

## Next Steps

1. **Verify eBay Sandbox:** Check if you have existing credentials
2. **Create QA staging URL:** Set up `qa.sovereignlistingsuite.com` (like your other project)
3. **Add GitHub Secrets:** Add all values from the table above
4. **Create test photos:** Generate or upload sample images
5. **Run locally:** `npx playwright test` to verify setup
6. **Deploy:** Push to GitHub to trigger workflows

---

## References

- [Playwright Docs](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [eBay Developer API](https://developer.ebay.com)
- [Stripe Testing](https://stripe.com/docs/testing)
