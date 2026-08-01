import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { BaseRepository } from './base.repo';
import { FILE_REFERENCE_COLUMNS, describeFileReferences } from './file-references';

// The reference check is only as good as its list of columns. A migration that adds a new column
// holding a files.id, without adding it to FILE_REFERENCE_COLUMNS, silently reopens the bug this
// module exists to close: some feature's file gets deleted by another feature's cleanup. So the
// list is compared against the live database rather than trusted.
//
// These read pg_catalog rather than information_schema on purpose. Tests connect as pplcrm_app,
// and information_schema.constraint_column_usage only shows constraints on tables the connected
// role OWNS — under pplcrm_app it returns nothing at all, so the check would pass vacuously.
describe('FILE_REFERENCE_COLUMNS matches the schema', () => {
  const db = (BaseRepository as any)._db;

  const listed = () => new Set(FILE_REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`));

  it('covers every column named like a files.id holder', async () => {
    // Matches file_id, avatar_file_id, screenshot_file_id — and anything a future migration adds
    // following the same convention.
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      SELECT cl.relname AS table_name, att.attname AS column_name
        FROM pg_class cl
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_attribute att ON att.attrelid = cl.oid
       WHERE ns.nspname = 'public'
         AND cl.relkind = 'r'
         AND att.attnum > 0
         AND NOT att.attisdropped
         AND cl.relname <> 'files'
         AND att.attname ~ '(^|_)file_id$'
    `.execute(db);

    const inSchema = rows.map((r) => `${r.table_name}.${r.column_name}`).sort();
    expect(inSchema.length).toBeGreaterThan(0);
    expect(inSchema.filter((name) => !listed().has(name))).toEqual([]);
  });

  it('covers every real foreign key that points at files', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      SELECT cl.relname AS table_name, att.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.contype = 'f'
         AND ns.nspname = 'public'
         AND ref.relname = 'files'
    `.execute(db);

    const inSchema = rows.map((r) => `${r.table_name}.${r.column_name}`);
    // Most of the listed columns have no foreign key at all, which is exactly why an application
    // check is needed; the few that do must still be listed.
    expect(inSchema.length).toBeGreaterThan(0);
    expect(inSchema.filter((name) => !listed().has(name))).toEqual([]);
  });

  it('lists no column that the schema does not have', async () => {
    const { rows } = await sql<{ table_name: string; column_name: string }>`
      SELECT cl.relname AS table_name, att.attname AS column_name
        FROM pg_class cl
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_attribute att ON att.attrelid = cl.oid
       WHERE ns.nspname = 'public'
         AND cl.relkind = 'r'
         AND att.attnum > 0
         AND NOT att.attisdropped
    `.execute(db);

    const inSchema = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    expect([...listed()].filter((name) => !inSchema.has(name))).toEqual([]);
  });
});

describe('describeFileReferences', () => {
  const hit = (label: string) => ({ table: 't', column: 'c', label });

  it('names a single holder', () => {
    expect(describeFileReferences([hit('an email attachment')])).toBe('an email attachment');
  });

  it('joins several holders and drops duplicates', () => {
    expect(
      describeFileReferences([hit('an email attachment'), hit('a profile photo'), hit('an email attachment')]),
    ).toBe('an email attachment and a profile photo');
  });

  it('falls back when there is nothing to name', () => {
    expect(describeFileReferences([])).toBe('another record');
  });
});
