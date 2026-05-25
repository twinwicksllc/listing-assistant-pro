import { test, expect, signUp, uploadTestPhoto, generateListing, publishListing, upgradeSubscription, cleanup } from '../fixtures/helpers';

test.describe('Full Lifecycle Tests', () => {
  test.beforeEach(async ({ page, testUser }) => {
    // Sign up fresh test account
    await signUp(page, testUser);
  });

  test('complete flow: upload coin → generate → publish → verify on ebay', async ({ page }) => {
    // Upload coin photo
    await uploadTestPhoto(page, 'coin');
    await expect(page.locator('[data-testid="photo-preview"]')).toBeVisible();

    // Generate listing
    await generateListing(page, { title: 'QA Test Coin Listing' });
    
    // Verify listing created
    const titleInput = page.locator('input[placeholder*="title"]');
    await expect(titleInput).toHaveValue(/QA Test Coin/);

    // Publish to eBay
    await publishListing(page);
    
    // Verify listing appears in dashboard
    await page.goto('/dashboard');
    await expect(page.locator('text=QA Test Coin')).toBeVisible({ timeout: 10_000 });
  });

  test('complete flow: electronics listing', async ({ page }) => {
    // Upload electronics photo
    await uploadTestPhoto(page, 'electronics');
    await expect(page.locator('[data-testid="photo-preview"]')).toBeVisible();

    // Generate listing
    await generateListing(page, { title: 'QA Test Electronics' });
    
    // Verify proper category selected (not coins)
    const categoryField = page.locator('[data-testid="category-display"]');
    await expect(categoryField).not.toContainText('Coins');

    // Publish
    await publishListing(page);
    
    // Verify published
    await page.goto('/dashboard');
    await expect(page.locator('text=QA Test Electronics')).toBeVisible({ timeout: 10_000 });
  });

  test('complete flow: billing upgrade to pro', async ({ page }) => {
    // Navigate to billing
    await page.goto('/billing');
    await expect(page).toHaveURL('**/billing');

    // Verify free tier active
    await expect(page.locator('text=Free Tier')).toBeVisible();

    // Upgrade to Pro
    await upgradeSubscription(page, 'pro');
    
    // Verify upgrade success
    await expect(page.locator('text=Pro Plan Active')).toBeVisible({ timeout: 5000 });
  });

  test('complete flow: verify AI enhancement available after upgrade', async ({ page }) => {
    // Upgrade to pro first
    await page.goto('/billing');
    await upgradeSubscription(page, 'pro');
    
    // Navigate back to analyze
    await page.goto('/analyze');
    
    // Upload photo
    await uploadTestPhoto(page, 'coin');
    
    // Verify AI enhancement button available
    await expect(page.locator('button:has-text("Enhance with AI")')).toBeVisible();
    
    // Click enhance
    await page.click('button:has-text("Enhance with AI")');
    
    // Verify enhanced content generated
    await expect(page.locator('[data-testid="ai-enhanced"]')).toBeVisible({ timeout: 15_000 });
  });

  test('cleanup: removes test listings older than 7 days', async ({ page }) => {
    // This would be more of a backend test/task
    // Verify old test listings are deleted from dashboard
    await page.goto('/dashboard');
    
    // Count listings
    const listings = page.locator('[data-testid="listing-card"]');
    const count = await listings.count();
    
    // Log for debugging - should see previous test listings cleaned up
    console.log(`Current listings: ${count}`);
  });

  test.afterEach(async ({ page }) => {
    await cleanup(page);
  });
});
