import { test, expect, login, uploadTestPhoto, generateListing } from '../fixtures/helpers';

const QA_USER = {
  email: 'qa0000000000test@test.sovereignlistingsuite.com',
  password: 'QATest123!@#',
};

test.describe('PR Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, QA_USER);
  });

  test('can login to account', async ({ page }) => {
    await expect(page).toHaveURL(/\/home/);
  });

  test('can upload photo', async ({ page }) => {
    await uploadTestPhoto(page, 'coin');
    await expect(page.getByRole('button', { name: 'Process Now' })).toBeVisible();
  });

  test('coin analysis populates key specifics', async ({ page }) => {
    await uploadTestPhoto(page, 'coin');
    
    // In v2, analysis triggers automatically after clicking "Process Now" in upload flow.
    // The uploadTestPhoto helper handles "Process Now", and AnalyzePage triggers handleGenerate on mount.
    // We just need to wait for the analysis to complete.
    await page.waitForSelector('[data-testid="listing-generated"]', { timeout: 60_000 });

    await page.waitForTimeout(2000);

    await expect(page.locator('text=Coin Condition Details')).toBeVisible({ timeout: 10_000 });

    const specifics = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid^="aspect-"]'));
      const out: Record<string, string> = {};
      for (const row of rows) {
        const key = (row as HTMLElement).dataset.testid?.replace('aspect-', '') || '';
        const valueEl = row.querySelector('input') as HTMLInputElement | null;
        const value = valueEl?.value?.trim() || '';
        if (key) out[key] = value;
      }
      return out;
    });

    expect((specifics['Year'] || '').trim().length).toBeGreaterThan(0);
    expect((specifics['Denomination'] || '').trim().length).toBeGreaterThan(0);

    const optionalFilledCount = ['Mint Mark', 'Mint Location', 'Strike Type', 'Composition']
      .map((k) => (specifics[k] || '').trim().length > 0)
      .filter(Boolean).length;
    expect(optionalFilledCount).toBeGreaterThan(0);
  });

  test('can navigate app sections', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home/);

    await page.goto('/analyze');
    await expect(page).toHaveURL(/\/analyze/);

    await page.goto('/billing');
    await expect(page).toHaveURL(/\/billing/);
  });
});
