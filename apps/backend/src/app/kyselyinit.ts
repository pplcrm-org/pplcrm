import { env } from '../env';
import { runMigrateDown, runMigrateToLatest } from './migrations/run-migrations';

/**
 * Migration entry points for the running server (the `MIGRATE_ON_BOOT` path in `main.ts`), which
 * already has a fully validated `env`. The deploy-time migration runs `migrate-cli.ts` instead —
 * it must not import this module, because importing `env` there would demand production secrets a
 * migration never uses.
 *
 * Both connect as the owner role via `env.migrationDb` (least-privilege split: the runtime role
 * has no DDL rights).
 */
export async function migrateDown(): Promise<void> {
  await runMigrateDown(env.migrationDb);
}

export async function migrateToLatest(): Promise<void> {
  await runMigrateToLatest(env.migrationDb);
}
