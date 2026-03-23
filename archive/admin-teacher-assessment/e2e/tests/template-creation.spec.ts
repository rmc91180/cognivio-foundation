import { test, expect } from '@playwright/test';

test.describe('Template Creation Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@cognivio.demo');
    await page.getByLabel(/password/i).fill('demo123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('navigates to framework selection', async ({ page }) => {
    await page.getByRole('link', { name: /frameworks/i }).click();
    await expect(page).toHaveURL(/.*frameworks/);
    await expect(page.getByRole('heading', { name: /select.*framework/i })).toBeVisible();
  });

  test('displays available framework templates', async ({ page }) => {
    await page.goto('/frameworks');

    // Should show Danielson and Marshall templates
    await expect(page.getByText(/danielson/i)).toBeVisible();
    await expect(page.getByText(/marshall/i)).toBeVisible();
  });

  test('shows template preview on selection', async ({ page }) => {
    await page.goto('/frameworks');

    // Click on Danielson template
    await page.getByText(/danielson/i).click();

    // Should show element count and preview
    await expect(page.getByText(/22 elements/i)).toBeVisible();
  });

  test('navigates to element selection after choosing template', async ({ page }) => {
    await page.goto('/frameworks');

    // Select Danielson
    await page.getByText(/danielson/i).click();

    // Click continue/next button
    await page.getByRole('button', { name: /continue|next|select/i }).click();

    // Should be on element selection page
    await expect(page).toHaveURL(/.*elements/);
  });

  test('displays elements organized by domain', async ({ page }) => {
    await page.goto('/frameworks');
    await page.getByText(/danielson/i).click();
    await page.getByRole('button', { name: /continue|next|select/i }).click();

    // Should show domains
    await expect(page.getByText(/planning.*preparation/i)).toBeVisible();
    await expect(page.getByText(/classroom.*environment/i)).toBeVisible();
  });

  test('allows assigning elements to metric columns', async ({ page }) => {
    await page.goto('/frameworks/elements');

    // Find an element and a column
    const element = page.locator('[data-testid="element-item"]').first();
    const column = page.locator('[data-testid="metric-column"]').first();

    // Should be able to see both
    await expect(element).toBeVisible();
    await expect(column).toBeVisible();
  });

  test('saves template configuration', async ({ page }) => {
    await page.goto('/frameworks/elements');

    // Click save button
    await page.getByRole('button', { name: /save/i }).click();

    // Should show success message
    await expect(page.getByText(/saved|success/i)).toBeVisible();
  });

  test('creates custom template from scratch', async ({ page }) => {
    await page.goto('/frameworks');

    // Click create custom
    await page.getByRole('button', { name: /create.*custom|new.*template/i }).click();

    // Should show template name input
    await expect(page.getByLabel(/template.*name/i)).toBeVisible();
  });
});
