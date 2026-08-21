import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

const isCI = !!process.env.CI;

// Playwright runs webServer commands from THIS directory by default. `nx serve` resolves the
// workspace's tsconfig.base.json against the cwd, so a cold CI start from apps/frontend-e2e dies
// with "Cannot read file 'tsconfig.base.json'" before the health probe ever answers (locally the
// entries attach to already-running servers, which is why this only ever failed in CI).
const repoRoot = path.resolve(__dirname, '../..');

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
  // Both apps: the authenticated-journey spec runs against the REAL backend (no route
  // stubbing), and the frontend targets http://localhost:3000 directly in dev
  // (apps/frontend/src/environments/environment.ts). Locally both entries attach to
  // already-running dev servers (verify skill); CI starts them cold.
  webServer: [
    {
      command: 'npx nx serve backend',
      cwd: repoRoot,
      // /healthz only answers 200 once Postgres is reachable (and boot migrations, which
      // run by default via MIGRATE_ON_BOOT, are done) — a real readiness probe, unlike '/'.
      url: 'http://localhost:3000/healthz',
      reuseExistingServer: !isCI,
      timeout: isCI ? 300_000 : 120_000,
    },
    {
      command: 'npx nx serve frontend',
      cwd: repoRoot,
      url: 'http://localhost:4200',
      reuseExistingServer: !isCI,
      // A cold CI runner compiling the Angular app blows straight past Playwright's 60s default.
      timeout: isCI ? 300_000 : 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
