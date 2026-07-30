/* ----------------------  eslint.config.cjs  ---------------------- */
/* Root flat-config shared by every project in the workspace.        */
/* PASTE THE WHOLE FILE – it replaces the previous version.          */

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');
const globals = require('globals');
const nxPlugin = require('@nx/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const localRules = require('./tools/eslint-rules/index.cjs');

const compat = new FlatCompat({ baseDirectory: __dirname, recommendedConfig: js.configs.recommended });

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  /* 0️⃣  Ignored files globally */
  {
    ignores: [
      'node_modules',
      'dist',
      '**/dist/**',
      '.angular',
      '**/.angular/**',
      '.nx',
      '**/.nx/**',
      'coverage',
      '**/coverage/**',
      '**/eslint.config.cjs',
      '**/postcss.config.*',
      'jest.preset.cjs',
      '**/index.html',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      'scratch/**',
      'scratch-*',
      'test-*',
      '**/test-*.js',
      '**/test-*.ts',
      '**/test-*.cjs',
    ],
  },

  /* 1️⃣  Core JS recommendations */
  js.configs.recommended,

  /* 2️⃣  Nx + Prettier shared base */
  ...compat.config({
    extends: ['plugin:@nx/typescript', 'prettier'],
  }),

  /* 3️⃣  Workspace-wide TypeScript rules ------------------------------ */
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.base.json'],
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      local: localRules,
    },
    rules: {
      /* Shared TS best practices */
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-import-type-side-effects': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',

      /* General best practices */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  /* 4️⃣  Enforce Nx module boundaries ---------------------------------- */
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { '@nx': nxPlugin },
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },

  /* 5️⃣  console allowed in CLI scripts and e2e specs */
  {
    files: ['scripts/**/*.ts', 'apps/frontend-e2e/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  /* 6️⃣  internal ESLint plugin files are CommonJS */
  {
    files: ['tools/eslint-rules/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },

  /* 6️⃣b Claude Code hook scripts are Node ESM, run by the editor harness (not
   *      by the app), so they need node globals and may write to stdout. */
  {
    files: ['tools/claude-hooks/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },

  /* 7️⃣  Register @angular-eslint rules for Angular projects so that tools
   *      which run from the workspace root (editor, lint-staged/git hooks)
   *      recognize rule IDs like `@angular-eslint/component-selector` —
   *      otherwise `eslint-disable-next-line` comments for those rules fail
   *      with "Definition for rule ... was not found". `nx lint frontend`
   *      is unaffected since it already loads apps/frontend/eslint.config.cjs
   *      directly, which sets the actual severities/options for these rules. */
  ...compat.config({ extends: ['plugin:@angular-eslint/recommended'] }).map((cfg) => ({
    ...cfg,
    files: ['apps/frontend/**/*.ts', 'libs/uxcommon/**/*.ts'],
  })),
];
