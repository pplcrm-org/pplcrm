/// <reference types='vitest' />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/uxcommon',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [angular()],
  test: {
    name: 'uxcommon',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/uxcommon',
      provider: 'v8' as const,
      // Coverage ratchet, enforced by CI since 2026-08-20 (verify.yml runs this project's
      // tests with --coverage). Re-baselined that day to just under the measured reality
      // (71.75% stmts / 59.05% branch / 76.80% funcs / 71.29% lines): the previous numbers
      // dated from 2026-07-17 and had drifted ~9 points above reality while nothing ran
      // --coverage. Now that the gate actually fires: never lower these — add tests instead.
      thresholds: {
        statements: 71,
        branches: 58,
        functions: 76,
        lines: 71,
      },
    },
  },
}));
