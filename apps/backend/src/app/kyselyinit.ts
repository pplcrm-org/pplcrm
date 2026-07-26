import { promises as fs } from 'fs';
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from 'kysely';
import path from 'path';
import { Pool } from 'pg';

import type { Models } from '../../../../libs/common/src/lib/kysely.models';
import { env } from '../env';
import { logger } from './logger';

const MIGRATION_FOLDER = path.resolve(process.cwd(), 'apps/backend/src/app/_migrations');

/**
 * S-2 (schema review 2026-07-06): migrations run on their own short-lived
 * connection using the owner role (env.migrationDb) — separate from the runtime
 * pool, which connects as the least-privilege app role and has no DDL rights.
 * The pool is created for the migration run and destroyed afterward, so the
 * serve process carries no extra idle connection when MIGRATE_ON_BOOT is off.
 */
async function withMigrator<T>(run: (db: Kysely<Models>, migrator: Migrator) => Promise<T>): Promise<T> {
  const db = new Kysely<Models>({
    dialect: new PostgresDialect({
      pool: new Pool({ ...env.migrationDb, max: 2, application_name: 'pplcrm-migrate' }),
    }),
  });
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder: MIGRATION_FOLDER }),
  });
  try {
    return await run(db, migrator);
  } finally {
    await db.destroy();
  }
}

export async function migrateDown(): Promise<void> {
  await withMigrator(async (_db, migrator) => {
    const { error, results } = await migrator.migrateDown();

    results?.forEach((it) => {
      if (it.status === 'Success') {
        logger.info(`migration down"${it.migrationName}" successful`);
      } else if (it.status === 'Error') {
        logger.error(`failed to execute migration down"${it.migrationName}"`);
      }
    });

    if (error) {
      logger.error({ err: error }, 'failed to migrate down');
      process.exit(1);
    }
  });
}

export async function migrateToLatest(): Promise<void> {
  logger.info('Migration starting');

  await withMigrator(async (_db, migrator) => {
    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((it) => {
      if (it.status === 'Success') {
        logger.info(`migration up:"${it.migrationName}" successful`);
      } else if (it.status === 'Error') {
        logger.error(`failed to execute migration up"${it.migrationName}"`);
      }
    });

    if (error) {
      logger.error({ err: error }, 'failed to migrate up');
      process.exit(1);
    }
  });
}

// Automatically run migration when script is executed directly (the deploy-time
// migrate step; runs as the owner role via env.migrationDb).
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('kyselyinit.ts') || process.argv[1].endsWith('kyselyinit.js'));
if (isMain) {
  void migrateToLatest();
}
