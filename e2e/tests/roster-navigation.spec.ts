import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'principal@demo.cognivio.app';
const DEMO_PASSWORD = 'DemoAccess2026!';

test.describe('Admin Navigation Smoke', () => {
  const emailInput = (page) => page.locator('input[type="email"]');
  const passwordInput = (page) => page.locator('input[type="password"]');

  const ensureSeededDemoData = async (page) => {
    const token = await page.evaluate(() => localStorage.getItem('cognivio_token'));
    const teachersBefore = await page.request.get('http://127.0.0.1:8000/api/teachers', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const teacherList = await teachersBefore.json();
    if (Array.isArray(teacherList) && teacherList.length > 0) {
      return;
    }
    const seedResponse = await page.request.post('http://127.0.0.1:8000/api/seed-demo-data', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(seedResponse.ok()).toBeTruthy();
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await emailInput(page).fill(DEMO_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*dashboard/);
    await ensureSeededDemoData(page);
  });

  test('opens teachers from the admin shell', async ({ page }) => {
    await page.getByRole('link', { name: /^teachers$/i }).click();
    await expect(page).toHaveURL(/.*teachers$/);
    await expect(page.getByRole('heading', { name: /^teachers$/i })).toBeVisible();
  });

  test('loads the admin dashboard with current time-horizon lanes', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /what needs action now/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^operations$/i })
    ).toBeVisible();
    await page.getByRole('button', { name: /^insights$/i }).click();
    await expect(
      page.getByRole('heading', { name: /recent lesson signals/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /recurring patterns and ongoing goals/i })
    ).toBeVisible();
  });

  test('opens a teacher deep dive from the roster', async ({ page }) => {
    await page.goto('/teachers');
    const deepDiveLink = page.locator('table a[href^="/teachers/"]').first();
    await expect(deepDiveLink).toBeVisible();
    await deepDiveLink.click();

    await expect(page).toHaveURL(/.*teachers\/[^/]+$/);
    await expect(
      page.getByRole('heading', { name: /how to use this page/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /admin conference prep/i })
    ).toBeVisible();
  });

  test('opens shared action-plan and reflection records from the deep dive', async ({ page }) => {
    await page.goto('/teachers');
    await page.locator('table a[href^="/teachers/"]').first().click();
    await expect(page).toHaveURL(/.*teachers\/[^/]+$/);

    await page.getByRole('link', { name: /jump to action plan/i }).click();
    await expect(page).toHaveURL(/.*\/action-plan$/);
    await expect(
      page.getByRole('heading', { name: /shared action plan record/i })
    ).toBeVisible();

    await page.goto(page.url().replace(/\/action-plan$/, '/reflections'));
    await expect(page).toHaveURL(/.*\/reflections$/);
    await expect(
      page.getByRole('heading', { name: /shared reflection record/i })
    ).toBeVisible();
  });
});
