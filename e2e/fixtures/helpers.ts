import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

type TestUser = {
  email: string;
  password: string;
};

export const test = base.extend<{ testUser: TestUser }>({
  testUser: async ({}, use) => {
    const timestamp = Date.now();
    const user: TestUser = {
      email: `qa${timestamp}test@test.sovereignlistingsuite.com`,
      password: 'QATest123!@#',
    };
    await use(user);
  },
});

export { expect };

export async function signUp(page: Page, user: TestUser) {
  await page.goto('/signup');
  
  // Wait for the form to be ready (faster than networkidle which can hang)
  await page.waitForLoadState('domcontentloaded');
  
  // Explicitly wait for form inputs to be visible
  await page.waitForSelector('input[placeholder*="Your name"]', { timeout: 10_000 });
  await page.waitForSelector('input[placeholder*="email"]', { timeout: 10_000 });
  await page.waitForSelector('input[placeholder*="password"]', { timeout: 10_000 });

  // Fill signup form
  await page.fill('input[placeholder*="Your name"]', 'QA E2E User');
  await page.fill('input[placeholder*="email"]', user.email);
  await page.fill('input[placeholder*="password"]', user.password);
  await page.click('button:has-text("Create Account")');

  // New auth flow can either sign in immediately or ask for email verification.
  await Promise.race([
    page.waitForURL('**/home', { timeout: 15_000 }),
    page.waitForSelector('text=Check your email', { timeout: 15_000 }),
  ]);
}

export async function login(page: Page, user: TestUser) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // If a valid session already exists, the app can redirect away from /login.
  if (/\/(home|drafts|analyze|dashboard|billing)(\?|$)/.test(new URL(page.url()).pathname)) {
    return;
  }

  const emailInput = page
    .locator('input[type="email"], input[placeholder*="email" i], input[name="email"]')
    .first();
  let hasEmailInput = await emailInput.isVisible({ timeout: 10_000 }).catch(() => false);

  // Some CI runs can land on /landing due route timing. Click any visible sign-in CTA, then retry /login.
  if (!hasEmailInput) {
    const landingSignIn = page
      .locator('button:has-text("Sign In"),button:has-text("Sign in"),a:has-text("Sign In"),a:has-text("Sign in")')
      .first();

    const hasLandingSignIn = await landingSignIn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (hasLandingSignIn) {
      await landingSignIn.click({ timeout: 5_000 });
    }

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    hasEmailInput = await emailInput.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!hasEmailInput && /\/(home|drafts|analyze|dashboard|billing)(\?|$)/.test(new URL(page.url()).pathname)) {
      return;
    }
  }

  if (!hasEmailInput) {
    throw new Error(`Login form not found at URL: ${page.url()}`);
  }

  await emailInput.fill(user.email);
  await page
    .locator('input[type="password"], input[placeholder*="password" i], input[name="password"]')
    .first()
    .fill(user.password);
  await page.getByRole('button', { name: /sign in/i }).first().click({ timeout: 10_000 });

  await page.waitForURL(/\/home/, { timeout: 15_000 });
}

export async function uploadTestPhoto(
  page: Page,
  photoType: 'coin' | 'electronics' | 'clothing',
) {
  // Navigate to home upload page.
  await page.goto('/home');

  // Upload photo via hidden gallery input.
  const filePath = getTestPhotoPath(photoType);
  await page.locator('input[type="file"][multiple]').first().setInputFiles(filePath);

  // Wait until the upload flow exposes the process action.
  await page.getByRole('button', { name: 'Process Now' }).waitFor({ timeout: 15_000 });
}

export async function generateListing(page: Page, options?: { title?: string }) {
  // Click "Generate Listing" or AI button
  await page.click('button:has-text("Generate Listing")');
  
  // Wait for AI analysis to complete
  await page.waitForSelector('[data-testid="listing-generated"]', { timeout: 30_000 });
  
  // If title provided, update it
  if (options?.title) {
    await page.fill('input[placeholder*="title"]', options.title);
  }
}

export async function publishListing(page: Page) {
  // Click "Publish to eBay"
  await page.click('button:has-text("Publish to eBay")');
  
  // Wait for success message
  await page.waitForSelector('[data-testid="publish-success"]', { timeout: 15_000 });
}

export async function upgradeSubscription(page: Page, plan: 'starter' | 'pro' | 'shop') {
  // Navigate to billing
  await page.click('a:has-text("Billing")');
  await page.waitForURL('**/billing');
  
  // Click upgrade button for plan
  const planButton = page.locator(`button:has-text("${plan.charAt(0).toUpperCase() + plan.slice(1)}") ~ button:has-text("Upgrade")`).first();
  await planButton.click();
  
  // Handle Stripe checkout redirect
  await page.waitForURL(url => url.hostname.includes('stripe.com') || url.hostname.includes('localhost'), { timeout: 10_000 });
  
  // Fill test card
  await fillStripeTestCard(page, {
    cardNumber: '4242424242424242',
    expiry: '12/25',
    cvc: '123',
  });
  
  // Submit payment
  await page.click('button:has-text("Pay")');
  
  // Wait for success redirect
  await page.waitForURL('**/billing?success=true', { timeout: 10_000 });
}

export async function fillStripeTestCard(
  page: Page,
  card: { cardNumber: string; expiry: string; cvc: string },
) {
  // Stripe embeds iframe, we need to handle it
  const cardFrame = page.frameLocator('[title="Secure payment input frame"]');
  
  // Card number
  await cardFrame.locator('input[name="cardnumber"]').fill(card.cardNumber);
  
  // Expiry
  await cardFrame.locator('input[name="exp-date"]').fill(card.expiry);
  
  // CVC
  await cardFrame.locator('input[name="cvc"]').fill(card.cvc);
}

function getTestPhotoPath(photoType: 'coin' | 'electronics' | 'clothing'): string {
  const paths: Record<string, string> = {
    coin: './e2e/fixtures/test-coin.jpg',
    electronics: './e2e/fixtures/test-electronics.jpg',
    clothing: './e2e/fixtures/test-clothing.jpg',
  };
  return paths[photoType] || paths.coin;
}

export async function cleanup(page: Page) {
  // Navigate to drafts
  await page.goto('/drafts');
  await page.waitForLoadState('networkidle');
  
  // Delete all drafts (optional - can keep them for review)
  const deleteButtons = page.locator('button:has-text("Delete")');
  const count = await deleteButtons.count();
  
  for (let i = 0; i < count; i++) {
    await deleteButtons.first().click();
    await page.click('button:has-text("Confirm")');
    await page.waitForTimeout(500);
  }
}
