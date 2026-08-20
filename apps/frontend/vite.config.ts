/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/frontend',
  resolve: {
    tsconfigPaths: true,
    alias: {
      'apps/frontend/src': __dirname + '/src',
    },
  },
  server: {
    watch: {
      ignored: ['**/node_modules/**', '**/.angular/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [angular()],
  test: {
    name: 'frontend',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/frontend',
      provider: 'v8' as const,
      // Coverage ratchet: set just under the measured baseline (2026-07-17:
      // 56.96% stmts / 39.72% branch / 55.18% funcs / 56.98% lines). These may
      // only ever be raised, never lowered — if your change drops coverage
      // below them, add tests rather than editing the thresholds. Enforced by CI
      // since 2026-08-20 (verify.yml runs this project's tests with --coverage;
      // still passing as measured that day).
      thresholds: {
        statements: 55,
        branches: 38,
        functions: 54,
        lines: 55,
      },
    },
    // Suppress NG0914: Angular fires this when provideZonelessChangeDetection() is used
    // alongside Zone.js (which the Angular testing harness always loads). It's harmless.
    onConsoleLog(log: string) {
      if (log.includes('NG0914')) return false;
    },
  },
}));
