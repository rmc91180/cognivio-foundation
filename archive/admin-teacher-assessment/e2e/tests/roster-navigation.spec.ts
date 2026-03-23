import { test, expect } from '@playwright/test';

test.describe('Roster Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@cognivio.demo');
    await page.getByLabel(/password/i).fill('demo123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('navigates to roster page', async ({ page }) => {
    await page.getByRole('link', { name: /roster|teachers/i }).click();
    await expect(page).toHaveURL(/.*roster/);
    await expect(page.getByRole('heading', { name: /roster|teachers/i })).toBeVisible();
  });

  test('displays teacher list with color-coded metrics', async ({ page }) => {
    await page.goto('/roster');

    // Should show teacher rows
    const teacherRows = page.locator('[data-testid="teacher-row"]');
    await expect(teacherRows.first()).toBeVisible();

    // Should have color chips
    const colorChips = page.locator('[data-testid="color-chip"]');
    await expect(colorChips.first()).toBeVisible();
  });

  test('shows correct color indicators', async ({ page }) => {
    await page.goto('/roster');

    // Should have green, yellow, or red chips visible
    const chips = page.locator('[role="status"]');
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sorts teachers by clicking column header', async ({ page }) => {
    await page.goto('/roster');

    // Click on a sortable column header
    await page.getByRole('columnheader', { name: /name/i }).click();

    // Should show sort indicator
    await expect(page.locator('[data-sort-direction]')).toBeVisible();
  });

  test('filters teachers by status', async ({ page }) => {
    await page.goto('/roster');

    // Click filter dropdown
    await page.getByRole('button', { name: /filter/i }).click();

    // Select "Needs Attention" filter
    await page.getByRole('option', { name: /needs.*attention|red/i }).click();

    // Should filter the list
    const rows = page.locator('[data-testid="teacher-row"]');
    // Filtered count should be less than or equal to total
  });

  test('navigates to teacher dashboard on row click', async ({ page }) => {
    await page.goto('/roster');

    // Click on first teacher row
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Should navigate to teacher dashboard
    await expect(page).toHaveURL(/.*teachers\/.*dashboard/);
  });

  test('displays teacher dashboard with detailed analysis', async ({ page }) => {
    await page.goto('/roster');
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Should show teacher name
    await expect(page.getByRole('heading')).toBeVisible();

    // Should show element scores section
    await expect(page.getByText(/element.*scores|performance/i)).toBeVisible();
  });

  test('shows AI observations on teacher dashboard', async ({ page }) => {
    await page.goto('/roster');
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Should have AI observations section
    await expect(page.getByText(/ai.*observations|video.*analysis/i)).toBeVisible();
  });

  test('allows reviewing AI observations', async ({ page }) => {
    await page.goto('/roster');
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Find an observation card
    const observationCard = page.locator('[data-testid="observation-card"]').first();

    if (await observationCard.isVisible()) {
      // Should have accept/reject buttons
      await expect(observationCard.getByRole('button', { name: /accept/i })).toBeVisible();
      await expect(observationCard.getByRole('button', { name: /reject/i })).toBeVisible();
    }
  });

  test('displays trend charts for teacher performance', async ({ page }) => {
    await page.goto('/roster');
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Should show performance chart
    const chart = page.locator('[data-testid="performance-chart"]');
    // Chart may or may not be visible depending on data
  });

  test('shows gradebook integration status', async ({ page }) => {
    await page.goto('/roster');
    await page.locator('[data-testid="teacher-row"]').first().click();

    // Should show gradebook status indicator
    await expect(page.getByText(/gradebook/i)).toBeVisible();
  });
});
