import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'powershell -ExecutionPolicy Bypass -File .\\scripts\\start-e2e-backend.ps1',
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: false,
      cwd: '..',
      timeout: 120 * 1000,
      env: {
        ...process.env,
        SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-session-secret',
        JWT_SECRET: process.env.JWT_SECRET || 'e2e-jwt-secret',
        DEMO_MODE: 'true',
        MONGO_URL: 'mongodb://127.0.0.1:27017',
        DB_NAME: 'cognivio',
      },
    },
    {
      command: 'npm run dev:frontend:mvp',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: false,
      cwd: '..',
      timeout: 120 * 1000,
      env: {
        ...process.env,
        BROWSER: 'none',
        HOST: '127.0.0.1',
        PORT: '3000',
        REACT_APP_BACKEND_URL: 'http://127.0.0.1:8000',
        REACT_APP_DEMO_MODE: 'true',
      },
    },
  ],
});
