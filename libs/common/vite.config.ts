/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/common',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [],
  test: {
    name: 'common',
    watch: false,
    globals: true,
    passWithNoTests: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/common',
      provider: 'v8' as const,
      // Coverage ratchet, enforced by CI since 2026-08-20 (verify.yml runs this project's
      // tests with --coverage). Re-baselined that day to just under the measured reality
      // (95.11% stmts / 88.93% branch / 91.34% funcs / 95.71% lines): the previous numbers
      // dated from 2026-07-17 and had drifted above reality while nothing ran --coverage.
      // Now that the gate actually fires: never lower these — add tests instead.
      thresholds: {
        statements: 95,
        branches: 88,
        functions: 91,
        lines: 95,
      },
    },
  },
}));
