import { describe, expect, it } from 'vitest';
// Imported from the schema module directly: exportEntitySchema is not re-exported by the barrel.
import { exportEntitySchema } from '../../../../../../libs/common/src/lib/schemas/core.schema';
import { BaseRepository } from '../../lib/base.repo';
import { ALLOWED_EXPORT_TABLES, EXPORT_ENTITY_TABLE } from './export-tables';

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
