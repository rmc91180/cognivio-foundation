import { test, expect, type Page } from '@playwright/test';

const DEMO_EMAIL = 'principal@lincoln.edu';
const DEMO_PASSWORD = 'password123';

test.describe('Template Creation Flow', () => {
  test.describe.configure({ mode: 'serial' });

  const loginAsPrincipal = async (page: Page) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(DEMO_EMAIL);
    await page.locator('#password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
  };

  const openFrameworkSelection = async (page: Page) => {
    await page.getByRole('button', { name: /manage frameworks/i }).click();
    await expect(page).toHaveURL(/.*frameworks/);
    await expect(
      page.getByRole('heading', { name: /select evaluation framework/i })
    ).toBeVisible();
  };

  const selectDanielsonAndContinue = async (page: Page) => {
    await page
      .getByRole('heading', { name: /danielson framework for teaching/i })
      .click();
    await page.getByRole('button', { name: /^select framework$/i }).click();
    await expect(page).toHaveURL(/.*frameworks\/elements\?templateId=/);
    await expect(
      page.getByRole('heading', { name: /customize evaluation columns/i })
    ).toBeVisible();
  };

  test.beforeEach(async ({ page }) => {
    await loginAsPrincipal(page);
  });

  test('navigates to framework selection', async ({ page }) => {
    await openFrameworkSelection(page);
  });

  test('displays available framework templates', async ({ page }) => {
    await page.goto('/frameworks');
    await expect(
      page.getByRole('heading', { name: /danielson framework for teaching/i })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /marshall/i })).toBeVisible();
  });

  test('shows template preview on selection', async ({ page }) => {
    await page.goto('/frameworks');

    await page.getByRole('button', { name: /^preview$/i }).first().click();
    await expect(page.getByRole('button', { name: /select this framework/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^close$/i })).toBeVisible();
    await page.getByRole('button', { name: /^close$/i }).click();
  });

  test('navigates to element selection after choosing template', async ({ page }) => {
    await page.goto('/frameworks');
    await selectDanielsonAndContinue(page);
  });

  test('displays elements organized by domain', async ({ page }) => {
    await page.goto('/frameworks');
    await selectDanielsonAndContinue(page);
    await expect(page.getByRole('button', { name: /domain 1: planning and preparation/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /domain 2: the classroom environment/i })).toBeVisible();
  });

  test('allows assigning elements to metric columns', async ({ page }) => {
    await page.goto('/frameworks');
    await selectDanielsonAndContinue(page);
    await page.getByRole('button', { name: /domain 1: planning and preparation/i }).click();
    await page.getByRole('button', { name: /1a: demonstrating knowledge of content and pedagogy/i }).click();
    await page.getByRole('button', { name: /^1: planning$/i }).click();
    await expect(page.getByText(/^1 element$/i).first()).toBeVisible();
  });

  test('saves template configuration', async ({ page }) => {
    await page.goto('/frameworks');
    await selectDanielsonAndContinue(page);
    await page.getByRole('button', { name: /domain 1: planning and preparation/i }).click();
    await page.getByRole('button', { name: /1a: demonstrating knowledge of content and pedagogy/i }).click();
    await page.getByRole('button', { name: /^1: planning$/i }).click();

    const enabledCheckboxes = page.getByRole('checkbox', { name: /enabled/i });
    const enabledCount = await enabledCheckboxes.count();
    for (let i = 1; i < enabledCount; i += 1) {
      await enabledCheckboxes.nth(i).click();
    }

    await page.getByLabel(/template name/i).fill(`E2E Template ${Date.now()}`);
    await page.getByRole('button', { name: /save template/i }).click();
    await expect(page).toHaveURL(/.*roster\?templateId=/);
  });

  test('allows editing the custom template name', async ({ page }) => {
    await page.goto('/frameworks');
    await selectDanielsonAndContinue(page);
    const templateNameInput = page.getByLabel(/template name/i);
    await expect(templateNameInput).toHaveValue('Custom Template');
    await templateNameInput.fill('Quarterly Leadership Checkpoint');
    await expect(templateNameInput).toHaveValue('Quarterly Leadership Checkpoint');
  });
});
