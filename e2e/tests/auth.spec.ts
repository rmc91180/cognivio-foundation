import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = 'principal@demo.cognivio.app';
const TRAINING_ADMIN_EMAIL = 'coach@demo.cognivio.app';
const TEACHER_EMAIL = 'teacher@demo.cognivio.app';
const DEMO_PASSWORD = 'DemoAccess2026!';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  const emailInput = (page) => page.locator('input[type="email"]');
  const passwordInput = (page) => page.locator('input[type="password"]');
  const selectAccessType = async (page, accessType: 'teacher' | 'administrator') => {
    const matcher = accessType === 'administrator' ? /administrator/i : /teacher/i;
    const button = page.getByRole('button', { name: matcher }).first();
    if (await button.count()) {
      await button.click();
    }
  };

  const selectInstitutionType = async (page, institutionType: 'school' | 'training') => {
    const matcher = institutionType === 'training' ? /teacher training/i : /k-12 school/i;
    const button = page.getByRole('button', { name: matcher }).first();
    if (await button.count()) {
      await button.click();
    }
  };

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
    await selectAccessType(page, 'administrator');
    await selectInstitutionType(page, 'school');
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);
    await expect(
      page.getByRole('heading', { name: /teacher performance overview|training program overview/i })
    ).toBeVisible();
  });

  test('persists authentication across page reload', async ({ page }) => {
    await selectAccessType(page, 'administrator');
    await selectInstitutionType(page, 'school');
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    await page.reload();

    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('successfully logs in as teacher and reaches the teacher workspace', async ({ page }) => {
    await selectAccessType(page, 'teacher');
    await emailInput(page).fill(TEACHER_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*my-workspace/);
    await expect(
      page.getByRole('heading', { name: /my teaching workspace/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /your linked administrator/i })
    ).toBeVisible();
    await expect(page.getByText(/demo principal/i).first()).toBeVisible();
  });

  test('school admin is redirected away from teacher-only routes', async ({ page }) => {
    await selectAccessType(page, 'administrator');
    await selectInstitutionType(page, 'school');
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard$/);

    await page.goto('/my-workspace');
    await expect(page).toHaveURL(/.*dashboard$/);

    await page.goto('/dashboard/training');
    await expect(page).toHaveURL(/.*dashboard$/);
  });

  test('training admin reaches the training dashboard and is redirected away from school-admin routes', async ({ page }) => {
    await selectAccessType(page, 'administrator');
    await selectInstitutionType(page, 'training');
    await emailInput(page).fill(TRAINING_ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard\/training$/);
    await expect(
      page.getByRole('heading', { name: /training program overview/i })
    ).toBeVisible();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*dashboard\/training$/);

    await page.goto('/access-management');
    await expect(page).toHaveURL(/.*dashboard\/training$/);
  });

  test('teacher is redirected away from admin-only routes', async ({ page }) => {
    await selectAccessType(page, 'teacher');
    await emailInput(page).fill(TEACHER_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*my-workspace/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*my-workspace/);

    await page.goto('/teachers');
    await expect(page).toHaveURL(/.*my-workspace/);
  });

  test('redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('logout clears session', async ({ page }) => {
    await selectAccessType(page, 'administrator');
    await selectInstitutionType(page, 'school');
    await emailInput(page).fill(ADMIN_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*dashboard/);

    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/.*login/);
  });

  test('teacher can complete privacy setup and reach the upload surface inside tenant scope', async ({ page }) => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/l7uH3wAAAABJRU5ErkJggg==',
      'base64'
    );

    await selectAccessType(page, 'teacher');
    await emailInput(page).fill(TEACHER_EMAIL);
    await passwordInput(page).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/.*my-workspace/);

    await page.goto('/my-workspace/materials');
    const privacyInput = page.locator('input[type="file"]').first();
    await privacyInput.setInputFiles([
      { name: 'ref-1.png', mimeType: 'image/png', buffer: tinyPng },
      { name: 'ref-2.png', mimeType: 'image/png', buffer: tinyPng },
      { name: 'ref-3.png', mimeType: 'image/png', buffer: tinyPng },
    ]);
    await expect(page.getByText(/3 reference files selected/i)).toBeVisible();
    await page.getByRole('button', { name: /save privacy profile/i }).click();
    await expect(page.getByText(/privacy profile saved/i)).toBeVisible();
    await expect(page.getByText(/ready .*3 references/i)).toBeVisible();

    await page.goto('/videos');
    await expect(page.getByRole('combobox', { name: /^teacher$/i })).toHaveCount(0);
    await expect(page.getByText(/privacy profile complete/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /upload and analyze/i })).toBeEnabled();
  });

  test('signup rubric switches correctly between k-12 and training flows', async ({ page }) => {
    const signUpButton = page.getByRole('button', { name: /sign up/i });
    if (!(await signUpButton.count())) {
      test.skip(true, 'Signup is hidden in demo-mode smoke environments.');
    }

    await signUpButton.click();

    await selectAccessType(page, 'teacher');
    await selectInstitutionType(page, 'school');
    await expect(page.getByLabel(/district, network, or parent organization/i)).toBeVisible();
    await expect(page.getByLabel(/^school name$/i)).toBeVisible();
    await expect(page.getByLabel(/school administrator email/i)).toBeVisible();

    await selectInstitutionType(page, 'training');
    await expect(page.getByLabel(/college, provider, or parent organization/i)).toBeVisible();
    await expect(page.getByLabel(/program, cohort, or campus name/i)).toBeVisible();
    await expect(page.getByLabel(/training administrator email/i)).toBeVisible();

    await selectAccessType(page, 'administrator');
    await expect(page.getByLabel(/training administrator email/i)).toHaveCount(0);
    await expect(page.getByText(/teacher training administrator dashboard/i)).toBeVisible();

    await selectInstitutionType(page, 'school');
    await expect(page.getByText(/school administrator dashboard/i)).toBeVisible();
  });
});
