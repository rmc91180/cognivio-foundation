import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'principal@demo.cognivio.app';
const DEMO_PASSWORD = 'DemoAccess2026!';

test.describe('Admin Navigation Smoke', () => {
  const emailInput = (page) => page.locator('input[type="email"]');
  const passwordInput = (page) => page.locator('input[type="password"]');
  const selectAdminRole = async (page) => {
    const button = page.getByRole('button', { name: /administrator/i });
    if (await button.count()) {
      await button.click();
    }
  };

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
    await selectAdminRole(page);
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

  test('uses the extracted add-teacher dialog and roster quick actions', async ({ page }) => {
    await page.goto('/teachers');
    await page.getByRole('button', { name: /add teacher/i }).click();
    await expect(page.getByRole('dialog', { name: /add teacher/i })).toBeVisible();
    await expect(page.getByText(/school setup lives separately/i)).toBeVisible();
    await page.getByRole('button', { name: /^close$/i }).click();
    await expect(page.getByRole('dialog', { name: /add teacher/i })).not.toBeVisible();

    const quickActionsHeader = page.getByRole('columnheader', { name: /quick actions/i });
    await expect(quickActionsHeader).toBeVisible();
    await expect(page.getByRole('link', { name: /open coaching record/i }).first()).toBeVisible();
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
      page.getByRole('link', { name: /open latest lesson page/i })
    ).toBeVisible();
  });

  test('opens deep-dive sub-pages and shared records from the teacher hub', async ({ page }) => {
    await page.goto('/teachers');
    await page.locator('table a[href^="/teachers/"]').first().click();
    await expect(page).toHaveURL(/.*teachers\/[^/]+$/);

    await page.getByRole('link', { name: /open latest lesson page/i }).click();
    await expect(page).toHaveURL(/.*\/latest-lesson$/);
    await expect(
      page.getByRole('heading', { name: /latest lesson review/i })
    ).toBeVisible();

    await page.getByRole('link', { name: /open coaching hub/i }).click();
    await expect(page).toHaveURL(/.*\/coaching$/);
    await expect(
      page.getByRole('heading', { name: /shared coaching hub/i })
    ).toBeVisible();

    await page.getByRole('link', { name: /open action plan record/i }).click();
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
