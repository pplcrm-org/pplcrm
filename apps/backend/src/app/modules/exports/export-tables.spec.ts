import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
// Imported from the schema module directly: exportEntitySchema is not re-exported by the barrel.
import { exportEntitySchema } from '../../../../../../libs/common/src/lib/schemas/core.schema';
import { BaseRepository } from '../../lib/base.repo';
import {
  ALLOWED_EXPORT_TABLES,
  EXPORT_ENTITY_TABLE,
  EXPORT_TABLE_COLUMNS,
  PRIVILEGED_EXPORT_ENTITIES,
  resolveExportColumns,
} from './export-tables';

/**
 * Regression guard for a bug that shipped silently.
 *
 * `exportEntitySchema` validates what the UI may ask for; `EXPORT_ENTITY_TABLE` maps that to a
 * real table; `ALLOWED_EXPORT_TABLES` is what the background job checks. Those three had drifted:
 * the allow-list had been written with entity *keys* but is checked against mapped *table names*,
 * so five entities passed validation, created a `data_exports` row, queued a job, and only then
 * failed in the worker. Nothing tested the intersection, and the user just saw an export that
 * never arrived.
 */
describe('export entity/table mapping', () => {
  const entities = exportEntitySchema.options;

  it('every entity the UI may request has a table mapping', () => {
    const unmapped = entities.filter((e) => !EXPORT_ENTITY_TABLE[e]);
    expect(unmapped, `these export entities have no table mapping: ${unmapped.join(', ')}`).toEqual([]);
  });

  it('every mapped table is on the allow-list the job enforces', () => {
    const rejected = entities.filter((e) => !ALLOWED_EXPORT_TABLES.has(EXPORT_ENTITY_TABLE[e] as string));
    expect(rejected, `these exports would queue and then fail in the worker: ${rejected.join(', ')}`).toEqual([]);
  });

  it('every mapped table actually exists in the database', async () => {
    const db = (BaseRepository as any)._db;
    for (const table of new Set(ALLOWED_EXPORT_TABLES)) {
      // `newsletters` was mapped to `marketing_emails`, a table dropped long ago; only a real
      // query catches that, not a name comparison.
      await expect(
        db.selectFrom(table).select('id').limit(0).execute(),
        `export table "${table}" is not queryable`,
      ).resolves.toBeDefined();
    }
  });

  it('does not allow a table no export entity can reach (dead allow-list entries)', () => {
    const reachable = new Set<string>([...Object.values(EXPORT_ENTITY_TABLE), 'user_activity']);
    const dead = [...ALLOWED_EXPORT_TABLES].filter((t) => !reachable.has(t));
    expect(dead, `these allow-list entries are unreachable: ${dead.join(', ')}`).toEqual([]);
  });
});

/**
 * The column allow-list is what stops an export from writing credentials into a CSV in blob
 * storage. It gates the SQL select, so a name that is not a real column fails the whole export at
 * query time — hence the existence check against the live database rather than against the
 * TypeScript model, which can describe a column a migration has not added yet.
 */
describe('export column allow-list', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;

  it('names only columns that exist in the database', async () => {
    for (const [table, columns] of Object.entries(EXPORT_TABLE_COLUMNS)) {
      // `user_activity` is the one table with a bespoke joined select; its entries are that
      // query's aliases ("user" is a concatenation, "email" comes from the joined authusers row),
      // not columns of the table.
      if (table === 'user_activity') continue;

      const live = await sql<{ column_name: string }>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `.execute(db);
      const liveColumns = new Set(live.rows.map((r) => r.column_name));

      const missing = columns.filter((c) => !liveColumns.has(c));
      expect(missing, `${table} allow-lists columns that do not exist: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('every exportable table has a column allow-list', () => {
    const unlisted = [...ALLOWED_EXPORT_TABLES].filter((t) => !EXPORT_TABLE_COLUMNS[t]?.length);
    expect(unlisted, `these tables would export nothing: ${unlisted.join(', ')}`).toEqual([]);
  });

  it('never exposes an authusers credential or account-change audit column', () => {
    // The original defect: entity `users` maps to `authusers`, and `selectAll()` emitted all of
    // these. Argon2id hashes and hashed reset codes are not directly usable, but they are
    // offline-crackable material sitting in a file the whole workspace could download.
    const forbidden = [
      'password',
      'password_reset_code',
      'password_reset_code_created_at',
      'two_factor_code',
      'two_factor_expires_at',
      'two_factor_attempts',
      'previous_email',
      'previous_role',
    ];
    const leaked = forbidden.filter((c) => EXPORT_TABLE_COLUMNS['authusers']?.includes(c));
    expect(leaked, `authusers export would emit: ${leaked.join(', ')}`).toEqual([]);
  });

  it('drops a requested column that is not on the allow-list', () => {
    const result = resolveExportColumns('authusers', ['email', 'password', 'two_factor_code']);

    expect(result.columns).toEqual(['email']);
    expect(result.dropped).toEqual(['password', 'two_factor_code']);
  });

  it('falls back to the whole allow-list when nothing usable was requested', () => {
    expect(resolveExportColumns('authusers', []).columns).toEqual([...(EXPORT_TABLE_COLUMNS['authusers'] ?? [])]);
    expect(resolveExportColumns('authusers', ['password']).columns).toEqual([
      ...(EXPORT_TABLE_COLUMNS['authusers'] ?? []),
    ]);
  });

  it('keeps the requested order and de-duplicates', () => {
    const result = resolveExportColumns('persons', ['last_name', 'first_name', 'last_name']);
    expect(result.columns).toEqual(['last_name', 'first_name']);
  });

  it('returns nothing for a table with no allow-list, so the job refuses it', () => {
    expect(resolveExportColumns('sessions', ['id']).columns).toEqual([]);
  });

  it('restricts the workspace user list to admins and owners', () => {
    expect(PRIVILEGED_EXPORT_ENTITIES.has('users')).toBe(true);
    expect(PRIVILEGED_EXPORT_ENTITIES.has('persons')).toBe(false);
  });
});
