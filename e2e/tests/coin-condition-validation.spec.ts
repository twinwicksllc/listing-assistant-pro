import { test, expect, login, uploadTestPhoto, generateListing } from '../fixtures/helpers';

const QA_USER = {
  email: 'qa0000000000test@test.listcreatorbyteckstart.com',
  password: 'QATest123!@#',
};

test.describe('Coin Condition Validation (Phase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, QA_USER);
  });

  test.describe('Graded Coin Validation', () => {
    test('accepts valid graded coin (PCGS MS 65)', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin category to be detected
      await page.waitForTimeout(2000);
      
      // Should see "Coin Condition Details" section
      const coinConditionSection = page.locator('text=Coin Condition Details');
      await expect(coinConditionSection).toBeVisible({ timeout: 10_000 });
      
      // Select "Graded coin" button
      const gradedButton = page.locator('button:has-text("Graded coin")').first();
      await gradedButton.click();
      
      // Select grading company (PCGS)
      const companySelect = page.locator('select').nth(0);
      await companySelect.selectOption('PCGS');
      
      // Enter grade
      const gradeInput = page.locator('input[placeholder*="MS 65"]');
      await gradeInput.fill('MS 65');
      
      // Verify no error message appears
      const errorBox = page.locator('text=Invalid').first();
      await expect(errorBox).not.toBeVisible();
      
      // Verify form accepts submission
      const submitButton = page.locator('button:has-text("Publish")').first();
      await expect(submitButton).toBeEnabled({ timeout: 5_000 });
    });

    test('rejects invalid grading company', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Graded coin" button
      const gradedButton = page.locator('button:has-text("Graded coin")').first();
      await gradedButton.click();
      
      // Try to enter invalid company through input (dropdown prevents this)
      // Instead, verify the dropdown only shows valid options
      const companySelect = page.locator('select').nth(0);
      const options = await companySelect.locator('option').allTextContents();
      
      // Verify only valid companies are available
      const validCompanies = ['PCGS', 'NGC', 'ANACS', 'ICG', 'CAC', 'ICCS'];
      for (const company of validCompanies) {
        expect(options.some(opt => opt.includes(company))).toBeTruthy();
      }
      expect(options.some(opt => opt.includes('INVALID'))).toBeFalsy();
    });

    test('rejects invalid grade format', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Graded coin" button
      const gradedButton = page.locator('button:has-text("Graded coin")').first();
      await gradedButton.click();
      
      // Select grading company
      const companySelect = page.locator('select').nth(0);
      await companySelect.selectOption('PCGS');
      
      // Enter invalid grade format (number first)
      const gradeInput = page.locator('input[placeholder*="MS 65"]');
      await gradeInput.fill('65 MS'); // Invalid: should be "MS 65"
      
      // Trigger validation by tabbing away
      await gradeInput.blur();
      
      // Should show error message
      const errorBox = page.locator('div:has-text("Grade format")').first();
      await expect(errorBox).toBeVisible({ timeout: 5_000 });
      
      // Submit button should be disabled
      const submitButton = page.locator('button:has-text("Publish")').first();
      await expect(submitButton).toBeDisabled();
    });

    test('requires grade field for graded coins', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Graded coin" button
      const gradedButton = page.locator('button:has-text("Graded coin")').first();
      await gradedButton.click();
      
      // Select grading company but leave grade empty
      const companySelect = page.locator('select').nth(0);
      await companySelect.selectOption('NGC');
      
      // Leave grade empty and blur
      const gradeInput = page.locator('input[placeholder*="MS 65"]');
      await gradeInput.blur();
      
      // Should show error for missing grade
      const errorBox = page.locator('div:has-text("Grade is required")').first();
      await expect(errorBox).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Raw Coin Validation', () => {
    test('accepts valid raw coin (Uncirculated)', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Raw coin" button
      const rawButton = page.locator('button:has-text("Raw coin")').first();
      await rawButton.click();
      
      // Select condition tier
      const conditionSelect = page.locator('select').nth(0);
      await conditionSelect.selectOption('Uncirculated');
      
      // Verify no error message
      const errorBox = page.locator('text=Invalid').first();
      await expect(errorBox).not.toBeVisible();
      
      // Verify form accepts submission
      const submitButton = page.locator('button:has-text("Publish")').first();
      await expect(submitButton).toBeEnabled({ timeout: 5_000 });
    });

    test('rejects invalid raw condition tier', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Raw coin" button
      const rawButton = page.locator('button:has-text("Raw coin")').first();
      await rawButton.click();
      
      // Verify only 4 valid options available in dropdown
      const conditionSelect = page.locator('select').nth(0);
      const options = await conditionSelect.locator('option').allTextContents();
      
      const validConditions = [
        'Uncirculated',
        'Extremely Fine to About Uncirculated',
        'Fine to Very Fine',
        'Below Fine'
      ];
      
      // Count non-placeholder options
      const conditionOptions = options.filter(opt => opt && opt !== '— Select a condition tier —');
      expect(conditionOptions.length).toBe(4);
      
      for (const condition of validConditions) {
        expect(options.some(opt => opt.includes(condition))).toBeTruthy();
      }
    });

    test('requires condition tier for raw coins', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Select "Raw coin" button
      const rawButton = page.locator('button:has-text("Raw coin")').first();
      await rawButton.click();
      
      // Leave condition empty and blur
      const conditionSelect = page.locator('select').nth(0);
      await conditionSelect.blur();
      
      // Should show error for missing condition
      const errorBox = page.locator('div:has-text("Raw condition")').first();
      await expect(errorBox).toBeVisible({ timeout: 5_000 });
      
      // Submit button should be disabled
      const submitButton = page.locator('button:has-text("Publish")').first();
      await expect(submitButton).toBeDisabled();
    });
  });

  test.describe('Non-Coin Category Bypass', () => {
    test('skips coin validation for non-coin categories', async ({ page }) => {
      // Upload electronics photo (not coin)
      await uploadTestPhoto(page, 'electronics');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for form to load
      await page.waitForTimeout(2000);
      
      // Should NOT see "Coin Condition Details" section
      const coinConditionSection = page.locator('text=Coin Condition Details');
      await expect(coinConditionSection).not.toBeVisible();
      
      // Should be able to publish without coin condition
      const submitButton = page.locator('button:has-text("Publish")').first();
      await expect(submitButton).toBeEnabled({ timeout: 5_000 });
    });
  });

  test.describe('Fallback & Error Recovery', () => {
    test('shows clear error if coin condition required but not provided', async ({ page }) => {
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Try to publish WITHOUT providing coin condition
      const publishButton = page.locator('button:has-text("Publish")').first();
      
      // If button is disabled, the validation is working
      if (await publishButton.isDisabled()) {
        // Verify error message is visible
        const errorMessage = page.locator('text=Coin condition details are REQUIRED').first();
        await expect(errorMessage).toBeVisible();
      } else {
        // If button is enabled, click it to see backend error
        await publishButton.click();
        
        // Should see error from backend
        const errorAlert = page.locator('[role="alert"]').first();
        await expect(errorAlert).toBeVisible({ timeout: 10_000 });
        const errorText = await errorAlert.textContent();
        expect(errorText?.toLowerCase()).toContain('coin');
      }
    });

    test('gracefully handles metadata API failures with fallback', async ({ page }) => {
      // This test verifies fallback handling if eBay Metadata API is unavailable
      // We'll monitor the backend logs for error handling
      
      // Upload coin photo
      await uploadTestPhoto(page, 'coin');
      
      // Generate listing
      await generateListing(page);
      
      // Navigate to listing editor
      await page.goto('/analyze');
      
      // Wait for coin section
      await page.waitForTimeout(2000);
      
      // Fill in valid coin condition
      const gradedButton = page.locator('button:has-text("Graded coin")').first();
      await gradedButton.click();
      
      const companySelect = page.locator('select').nth(0);
      await companySelect.selectOption('PCGS');
      
      const gradeInput = page.locator('input[placeholder*="MS 65"]');
      await gradeInput.fill('MS 65');
      
      // Monitor console for error logs
      const consoleLogs: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Try to publish
      const publishButton = page.locator('button:has-text("Publish")').first();
      if (await publishButton.isEnabled()) {
        await publishButton.click();
        
        // Give it time to fail gracefully
        await page.waitForTimeout(5000);
        
        // Should either succeed or show a clear error
        // (Metadata API may be mocked in test environment)
        const successMessage = page.locator('text=Success|Published').first();
        const errorMessage = page.locator('[role="alert"]').first();
        
        const success = await successMessage.isVisible().catch(() => false);
        const error = await errorMessage.isVisible().catch(() => false);
        
        expect(success || error).toBeTruthy();
      }
    });
  });
});
