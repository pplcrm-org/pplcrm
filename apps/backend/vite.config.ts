/// <reference types='vitest' />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Local/dev DB credentials come from a gitignored `.env.test` file at the repo root
// (DB_USER, DB_NAME, DB_PASSWORD, DB_PORT, DB_HOST, DB_SSL, JWT_SECRET, SHARED_SECRET —
// see apps/backend/src/env.ts for the full schema). CI/production set these as real
// env vars instead, so loading the file is best-effort — and must stay that way: an
// `existsSync` guard here is not enough, because the file can be present-but-unreadable
// (a sandboxed shell that denies reading `.env*`, restrictive ownership) and then
// `loadEnvFile` throws. @nx/vite evaluates every vite config to infer targets, so a throw
// escaping this file fails the whole Nx project graph — taking down unrelated targets
// like `nx build frontend` with no diagnostic. See the pplcrm-quality-gate skill.
const envTestPath = resolve(__dirname, '../../.env.test');
try {
  process.loadEnvFile(envTestPath);
} catch {
  // Absent or unreadable — the `test.env` block below falls back per key.
}

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/backend',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [],
  test: {
    name: 'backend',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'node',
    // Runs once before any worker: guardrails the target DB, migrates it to
    // latest, and truncates it to a clean slate. Keeps the whole suite on the
    // disposable pplcrm_test database so specs can never touch real data.
    globalSetup: ['./src/test-setup/global-setup.ts'],
    env: {
      DB_USER: process.env['DB_USER'] ?? '',
      DB_NAME: process.env['DB_NAME'] ?? '',
      DB_PASSWORD: process.env['DB_PASSWORD'] ?? '',
      JWT_SECRET: process.env['JWT_SECRET'] ?? '',
      SHARED_SECRET: process.env['SHARED_SECRET'] ?? '',
      DB_PORT: process.env['DB_PORT'] ?? '5432',
      DB_HOST: process.env['DB_HOST'] ?? 'localhost',
      DB_SSL: process.env['DB_SSL'] ?? 'false',
      // The closed-beta gate holds new tenants until pplCRM ops clicks an emailed link; nobody
      // is there to click it in a test run, so signUp auto-approves here. The gate on the
      // sign-in side is unconditional either way, so the specs that exercise it just set
      // `approval_status` on the tenant directly (see tenant-approval.spec.ts).
      AUTO_APPROVE_TENANTS: 'true',
    },
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/backend',
      provider: 'v8' as const,
      // Coverage ratchet: set just under the measured baseline (2026-07-04:
      // 46.85% stmts / 33.24% branch / 55.24% funcs / 48% lines). These may
      // only ever be raised, never lowered — if your change drops coverage
      // below them, add tests rather than editing the thresholds.
      thresholds: {
        statements: 45,
        branches: 32,
        functions: 54,
        lines: 46,
      },
    },
  },
}));
