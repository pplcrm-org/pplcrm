import { promises as fs } from 'fs';
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from 'kysely';
import path from 'path';
import { Pool } from 'pg';

import type { Models } from '../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../logger';

const MIGRATION_FOLDER = path.resolve(process.cwd(), 'apps/backend/src/app/_migrations');

/**
 * Connection details for the migration run. Deliberately a plain value rather than a read of
 * `env`: this module is imported by the standalone migrate CLI, which must not pull in the
 * production secret guard in `env.ts`. See `migrate-cli.ts` for why.
 */
export interface MigrationDbConfig {
  database: string;
  host: string;
  password: string;
  port: number;
  ssl: boolean;
  user: string;
}

/**
 * S-2 (schema review 2026-07-06): migrations run on their own short-lived
 * connection using the owner role — separate from the runtime pool, which
 * connects as the least-privilege app role and has no DDL rights. The pool is
 * created for the migration run and destroyed afterward, so the serve process
 * carries no extra idle connection when MIGRATE_ON_BOOT is off.
 */
async function withMigrator<T>(
  config: MigrationDbConfig,
  run: (db: Kysely<Models>, migrator: Migrator) => Promise<T>,
): Promise<T> {
  const db = new Kysely<Models>({
    dialect: new PostgresDialect({
      pool: new Pool({ ...config, max: 2, application_name: 'pplcrm-migrate' }),
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

export async function runMigrateDown(config: MigrationDbConfig): Promise<void> {
  await withMigrator(config, async (_db, migrator) => {
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

export async function runMigrateToLatest(config: MigrationDbConfig): Promise<void> {
  logger.info('Migration starting');

  await withMigrator(config, async (_db, migrator) => {
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
