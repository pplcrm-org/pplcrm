import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_SCOPED_TABLES } from './deletions.handlers';

/**
 * Guard against the 2026-07-24 regression: a tenant-scoped table left out of the wipe list holds a
 * NO-ACTION FK into a row the wipe deletes, aborting the whole delete transaction (and, before the
 * per-tenant isolation fix, the entire deletion cron) — or, with no FK at all, silently survives the
 * wipe and orphans PII. This test fails the moment a new `tenant_id` table is added without being
 * wired into the wipe — pointing whoever added it at TENANT_SCOPED_TABLES.
 *
 * The table inventory is derived from the FULL migration chain, not just schema.sql: the baseline
 * plus every dated migration's up() in filename (= run) order, honoring DROP TABLE. Parsing only
 * schema.sql is exactly how `newsletter_templates` (created by a dated migration) slipped through
 * and kept aborting tenant wipes.
 */
describe('tenant deletion completeness', () => {
  // Identity tables handled explicitly in the identity block of wipeTenant, plus `tenants` itself.
  const EXPLICITLY_HANDLED = new Set(['authusers', 'profiles', 'sessions', 'passkeys', 'tenants']);

  const MIGRATIONS_DIR = join(__dirname, '../../../_migrations');

  const CREATE_TABLE = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\)/g;
  const DROP_TABLE = /DROP TABLE (?:IF EXISTS )?(?:public\.)?(\w+)/g;

  /** Applies one SQL source's CREATE/DROP TABLE statements to the running inventory. */
  function applySource(source: string, tenantTables: Set<string>): void {
    for (const m of source.matchAll(CREATE_TABLE)) {
      const [, name, body] = m;
      if (/\btenant_id\b/.test(body)) tenantTables.add(name);
    }
    for (const m of source.matchAll(DROP_TABLE)) {
      tenantTables.delete(m[1]);
    }
  }

  /** Every tenant_id table that exists after the full migration chain has run. */
  function liveTenantScopedTables(): Set<string> {
    const tenantTables = new Set<string>();

    // The baseline (0001_baseline.ts executes schema.sql) runs first.
    applySource(readFileSync(join(MIGRATIONS_DIR, 'schema.sql'), 'utf8'), tenantTables);

    // Then each dated migration, in filename order (= Kysely run order). Only the up() section
    // counts — down() bodies contain DROP TABLEs that never run in a forward-only prod history.
    const migrationFiles = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.ts') && f !== '0001_baseline.ts')
      .sort();
    for (const file of migrationFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const upSection = content.split(/export\s+async\s+function\s+down\b/)[0];
      applySource(upSection, tenantTables);
    }

    return tenantTables;
  }

  const live = liveTenantScopedTables();

  it('derives a sane inventory (sanity check that the parser is not silently broken)', () => {
    // A parser regression that stops matching CREATE TABLE would empty the inventory and turn the
    // completeness assertion into a vacuous pass — pin a few tables that can never leave.
    expect(live.has('persons')).toBe(true); // baseline table
    expect(live.has('bug_reports')).toBe(true); // migration-created table
    expect(live.has('newsletter_templates')).toBe(true); // the table the old parser missed
    expect(live.has('newsletter_schedules')).toBe(false); // created then dropped by migrations
  });

  it('covers every live tenant_id table (minus the explicitly-handled identity tables)', () => {
    const covered = new Set<string>([...TENANT_SCOPED_TABLES, ...EXPLICITLY_HANDLED]);
    const missing = [...live].filter((t) => !covered.has(t)).sort();
    expect(missing, `tenant-scoped tables not wiped on tenant deletion: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists no table that does not exist or is an identity table', () => {
    const stray = TENANT_SCOPED_TABLES.filter((t) => !live.has(t) || EXPLICITLY_HANDLED.has(t)).sort();
    expect(stray, `stale/incorrect entries in TENANT_SCOPED_TABLES: ${stray.join(', ')}`).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(TENANT_SCOPED_TABLES.length).toBe(new Set(TENANT_SCOPED_TABLES).size);
  });
});
