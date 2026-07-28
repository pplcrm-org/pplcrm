/**
 * Standalone deploy-time migration entry point (the `migrate` job in .github/workflows/deploy.yml).
 *
 * Reads its database connection straight from `process.env` rather than importing `../env`, and
 * that indirection is the whole point: `env.ts` runs `assertProductionSecrets()` at import time,
 * which requires SHARED_SECRET, OAUTH_TOKEN_ENC_KEY and STRIPE_SECRET_KEY. That guard is correct
 * for the *server* — it exists because an unresolved secret degrades silently rather than failing
 * (plaintext OAuth tokens, billing mock mode) — but a migration process serves no traffic and
 * touches neither Stripe nor OAuth tokens, so it has no business holding those secrets. Importing
 * `env` here would have forced us to either ship production secrets to CI or hand the guard
 * placeholder values, and both make the guard mean less than it says.
 *
 * The connection mirrors `env.migrationDb`: the owner role, falling back to the runtime role's
 * credentials when the migration-specific ones are unset.
 */
import { runMigrateToLatest, type MigrationDbConfig } from './migrations/run-migrations';

const DEFAULT_DB_PORT = 5432;

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(`${name} is required to run migrations`);
  }
  return value;
}

function readConfig(): MigrationDbConfig {
  const port = Number(process.env['DB_PORT'] ?? DEFAULT_DB_PORT);
  if (!Number.isFinite(port)) {
    throw new Error(`DB_PORT must be a number, got "${process.env['DB_PORT']}"`);
  }

  return {
    database: required('DB_NAME', process.env['DB_NAME']),
    host: process.env['DB_HOST'] ?? 'localhost',
    // Same fallback as env.migrationDb: the owner role when set, else the runtime role.
    password: required(
      'DB_MIGRATION_PASSWORD or DB_PASSWORD',
      process.env['DB_MIGRATION_PASSWORD'] ?? process.env['DB_PASSWORD'],
    ),
    port,
    ssl: process.env['DB_SSL'] === 'true',
    user: required('DB_MIGRATION_USER or DB_USER', process.env['DB_MIGRATION_USER'] ?? process.env['DB_USER']),
  };
}

runMigrateToLatest(readConfig()).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
