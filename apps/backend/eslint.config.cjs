/* ---------------------- apps/backend/eslint.config.cjs ---------------------- */
/* Node.js, Fastify, tRPC backend-specific rules only.                         */

const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

module.exports = [
  /* Compose the root config so `nx lint backend` enforces the same
   * workspace-wide rules (no-floating-promises, no-misused-promises, etc.)
   * as the pre-commit `eslint` invocation. Previously this file stood alone,
   * which meant nx lint never saw those rules and plain `eslint` never saw
   * `local/no-unscoped-db-query` below — two disjoint, non-overlapping
   * checks. Confirmed zero new violations from this composition. */
  ...require('../../eslint.config.cjs'),

  /* Extend the base config */
  ...compat.config({ extends: ['plugin:@nx/javascript'] }).map((cfg) => ({
    ...cfg,
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      /* Fastify/tRPC specific style preferences */
      'prefer-arrow-callback': 'warn',
      'arrow-body-style': ['warn', 'as-needed'],
    },
  })),

  /* ── Tenant-isolation lint rule ────────────────────────────────────────────
   *
   * Flags any Kysely query chain (selectFrom / updateTable / deleteFrom) that
   * reaches an execute terminal without a .where('tenant_id', …) filter.
   *
   * Scoped to modules/** only — excludes:
   *   - base.repo.ts          (tenant filtering is callers' responsibility)
   *   - job-handlers.ts       (per-tenant loops; tenant_id used inside trx)
   *   - _migrations/**        (DDL; no runtime tenant scoping)
   *   - *.spec.ts             (integration tests do their own scoped cleanup)
   *   - kyselyinit*.ts        (migration runner)
   * ─────────────────────────────────────────────────────────────────────── */
  {
    files: ['**/src/app/modules/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    // `local` is already registered by the root config spread in above —
    // redeclaring it here for the same file set throws
    // "Cannot redefine plugin 'local'" under ESLint's flat config.
    rules: {
      'local/no-unscoped-db-query': [
        'error',
        {
          // Tables where cross-tenant queries are intentional:
          //   authusers - login by email, password reset by code (pre-auth, no tenant known yet)
          //   sessions  - sign-out by session_id hash (no tenant in token)
          //   tenants   - tenant lookup by id
          //
          // Removed 2026-07-04: `tags` (all module queries already scope tenant_id — the old
          // "join-level scoping" note was wrong) and `ms_oauth_tokens`/`google_oauth_tokens`
          // (migration 2026-06-26-email-sync-per-tenant re-keyed both on UNIQUE(tenant_id) and
          // made user_id nullable, so "keyed by user_id" no longer held — these hold OAuth
          // secrets and must be tenant-scoped). Adding a table here is a security decision:
          // prove every current and future query on it is safe cross-tenant, not just quiet.
          //
          // Added 2026-07-27: `rate_limits` — abuse counters, not tenant data. Its keys are
          // opaque, caller-namespaced strings covering pre-auth subjects (an IP, an email
          // address) as well as tenants, so there is no tenant_id to scope by and the limiter
          // deliberately runs outside any tenant context. Every row is write-only-ish state
          // that expires; none of it is readable business data.
          ignoreTables: ['authusers', 'sessions', 'tenants', 'rate_limits'],
        },
      ],
    },
  },

  /* ── Relax `no-explicit-any` for non-production code ────────────────────────
   *
   * `any` in production logic is a real smell we're driving to zero, but two
   * file classes are intentionally exempt:
   *   - _migrations/**  DDL history; already applied, append-only, never re-run.
   *                     Typing pg/Kysely migration builders adds no runtime safety.
   *   - *.spec.ts       Test doubles/mocks where `any` is the pragmatic shape for
   *                     a stub; typing them buys nothing and obscures intent.
   * ─────────────────────────────────────────────────────────────────────── */
  {
    files: ['**/src/app/_migrations/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
