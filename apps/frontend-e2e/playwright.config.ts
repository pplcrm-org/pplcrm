import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: isCI,
  // CI gates deploys on this suite (.github/workflows/verify.yml), so a single infrastructure
  // hiccup shouldn't block a release — but retries stay off locally, where a flake is a signal
  // worth seeing rather than papering over.
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    // Only kept for a retried (i.e. already-suspect) test — traces are large and the happy path
    // doesn't need them.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx nx serve frontend',
    url: 'http://localhost:4200',
    reuseExistingServer: !isCI,
    // A cold CI runner compiling the Angular app blows straight past Playwright's 60s default.
    timeout: isCI ? 300_000 : 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
