import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'principal@demo.cognivio.app';
const TEACHER_EMAIL = 'teacher@demo.cognivio.app';
const DEMO_PASSWORD = 'DemoAccess2026!';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  const emailInput = (page) => page.locator('input[type="email"]');
  const passwordInput = (page) => page.locator('input[type="password"]');

  test('displays login form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /cognivio/i })).toBeVisible();
    await expect(emailInput(page)).toBeVisible();
    await expect(passwordInput(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('keeps the user on login for invalid credentials', async ({ page }) => {
    await emailInput(page).fill('invalid@test.com');
    await passwordInput(page).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*login/);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('successfully logs in as admin and reaches the dashboard', async ({ page }) => {
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);
    await expect(
      page.getByRole('heading', { name: /teacher performance overview|training program overview/i })
    ).toBeVisible();
  });

  test('persists authentication across page reload', async ({ page }) => {
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    await page.reload();

    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('successfully logs in as teacher and reaches the teacher workspace', async ({ page }) => {
    await emailInput(page).fill(TEACHER_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*my-workspace/);
    await expect(
      page.getByRole('heading', { name: /my teaching workspace/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /teacher record not linked yet/i })
    ).toBeVisible();
  });

  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('logout clears session', async ({ page }) => {
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/.*login/);
  });
});
