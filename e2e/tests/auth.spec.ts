import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'principal@lincoln.edu';
const DEMO_PASSWORD = 'password123';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('displays login form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('shows validation error for empty fields', async ({ page }) => {
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*login/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.getByLabel(/email/i).fill('invalid@test.com');
    await page.locator('#password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*login/);
  });

  test('successfully logs in with demo credentials', async ({ page }) => {
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('persists authentication across page reload', async ({ page }) => {
    // Login
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    // Reload page
    await page.reload();

    // Should still be on dashboard
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('logout clears session', async ({ page }) => {
    // Login first
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    // Open user menu and sign out
    await page.locator('button[aria-haspopup="true"]').click();
    await page.getByRole('button', { name: /sign out/i }).click();

    // Should be back at login
    await expect(page).toHaveURL(/.*login/);
  });
});
