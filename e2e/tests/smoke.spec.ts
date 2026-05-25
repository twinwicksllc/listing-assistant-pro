import { test, expect, signUp, login, uploadTestPhoto, generateListing, cleanup } from './helpers';

test.describe('PR Smoke Tests', () => {
  test.beforeEach(async ({ page, testUser }) => {
    // Sign up fresh test account
    await signUp(page, testUser);
  });

  test('can create an account', async ({ page, testUser }) => {
    // Verify we're on dashboard
    await expect(page).toHaveURL('**/dashboard');
    
    // Verify user email is displayed
    await expect(page.locator('text=' + testUser.email)).toBeVisible();
  });

  test('can upload photo and generate listing', async ({ page }) => {
    // Upload a coin photo
    await uploadTestPhoto(page, 'coin');
    
    // Verify photo displayed
    await expect(page.locator('[data-testid="photo-preview"]')).toBeVisible();
    
    // Generate listing
    await generateListing(page);
    
    // Verify listing fields populated
    await expect(page.locator('input[placeholder*="title"]')).toHaveValue(/\w+/, { timeout: 5000 });
  });

  test('can navigate app sections', async ({ page }) => {
    // Check dashboard accessible
    await page.goto('/dashboard');
    await expect(page).toHaveURL('**/dashboard');
    
    // Check analyze page accessible
    await page.goto('/analyze');
    await expect(page).toHaveURL('**/analyze');
    
    // Check billing page accessible
    await page.goto('/billing');
    await expect(page).toHaveURL('**/billing');
  });

  test.afterEach(async ({ page }) => {
    await cleanup(page);
  });
});
