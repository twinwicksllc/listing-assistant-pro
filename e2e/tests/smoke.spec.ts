import { test, expect, login, uploadTestPhoto } from '../fixtures/helpers';

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

  test('can navigate app sections', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home/);

    await page.goto('/analyze');
    await expect(page).toHaveURL(/\/analyze/);

    await page.goto('/billing');
    await expect(page).toHaveURL(/\/billing/);
  });
});
