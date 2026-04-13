import { test, expect, type Page } from '@playwright/test';

const DEMO_EMAIL = 'teacher@demo.cognivio.app';
const DEMO_PASSWORD = 'DemoAccess2026!';

test.describe('Teacher Workspace Smoke', () => {
  test.describe.configure({ mode: 'serial' });

  const emailInput = (page: Page) => page.locator('input[type="email"]');
  const passwordInput = (page: Page) => page.locator('input[type="password"]');

  const loginAsTeacher = async (page: Page) => {
    await page.goto('/login');
    await emailInput(page).fill(DEMO_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*my-workspace/, { timeout: 15000 });
  };

  test.beforeEach(async ({ page }) => {
    await loginAsTeacher(page);
  });

  test('loads the teacher workspace home', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /my teaching workspace/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /your linked administrator/i })
    ).toBeVisible();
  });

  test('teacher demo remains in the protected workspace shell after reload', async ({ page }) => {
    await page.reload();
    await expect(page).toHaveURL(/.*my-workspace/);
    await expect(
      page.getByRole('heading', { name: /my teaching workspace/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /your linked administrator/i })
    ).toBeVisible();
  });

  test('teacher demo can open the videos area from the shell', async ({ page }) => {
    await page.getByRole('link', { name: /^my videos$/i }).click();
    await expect(page).toHaveURL(/.*videos/);
    await expect(
      page.getByRole('heading', { name: /lesson recordings & assessments/i })
    ).toBeVisible();
  });
});
