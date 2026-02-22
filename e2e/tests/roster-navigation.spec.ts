import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'principal@lincoln.edu';
const DEMO_PASSWORD = 'password123';

test.describe('Roster Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('opens roster from dashboard', async ({ page }) => {
    await page.getByRole('button', { name: /open roster/i }).click();
    await expect(page).toHaveURL(/.*roster/);
    await expect(page.getByRole('heading', { name: /teacher roster/i })).toBeVisible();
  });

  test('renders roster table and status indicators', async ({ page }) => {
    await page.goto('/roster');
    await expect(page.getByRole('heading', { name: /teacher roster/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    const tableRows = page.getByRole('row');
    await expect(tableRows.nth(1)).toBeVisible();
    const statusChips = page.getByRole('status');
    expect(await statusChips.count()).toBeGreaterThan(0);
  });

  test('applies status filter controls', async ({ page }) => {
    await page.goto('/roster');
    await page.getByRole('button', { name: /filters/i }).click();
    await page.getByRole('button', { name: /red/i }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('opens teacher dashboard from roster row', async ({ page }) => {
    await page.goto('/roster');
    await page.getByRole('row').nth(1).click();
    await expect(page).toHaveURL(/.*teachers\/.*/);
    await expect(page.getByRole('heading', { level: 2, name: /element scores/i })).toBeVisible();
  });

  test('shows AI insights and gradebook status on teacher dashboard', async ({ page }) => {
    await page.goto('/roster');
    await page.getByRole('row').nth(1).click();
    await expect(page.getByText(/ai insights/i)).toBeVisible();
    await expect(page.getByText(/gradebook status/i)).toBeVisible();
  });
});
