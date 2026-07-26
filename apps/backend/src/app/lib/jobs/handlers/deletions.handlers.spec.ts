import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../base.repo';
import { performScheduledDeletions, TENANT_SCOPED_TABLES } from './deletions.handlers';

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
 *
 * The 2026-07-26 pre-ship re-squash folded every dated migration into schema.sql, so the chain is
 * currently baseline-only and the loop below is a no-op. Keep it: the next dated migration that
 * adds a tenant_id table must be picked up, and that is the exact case this guard exists for.
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
    expect(live.has('persons')).toBe(true); // long-standing baseline table
    expect(live.has('bug_reports')).toBe(true); // added by a dated migration, now folded into the baseline
    expect(live.has('newsletter_templates')).toBe(true); // the table the old parser missed
    expect(live.has('newsletter_schedules')).toBe(false); // created then dropped pre-squash — must not reappear
  });

  it('honors DROP TABLE when walking dated migrations on top of the baseline', () => {
    // The re-squash left no dated migrations, so the create-then-drop path above no longer
    // exercises anything. Pin the parser behaviour directly instead — a table a future migration
    // drops must leave the inventory, or a stale entry fails the TENANT_SCOPED_TABLES check.
    const tables = new Set<string>();
    applySource('CREATE TABLE public.temp_thing (\n  tenant_id bigint NOT NULL\n)', tables);
    expect(tables.has('temp_thing')).toBe(true);
    applySource('DROP TABLE IF EXISTS public.temp_thing', tables);
    expect(tables.has('temp_thing')).toBe(false);
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

describe('scheduled user deletion (tombstone)', () => {
  const db = BaseRepository.dbInstance;
  const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantId: string;
  let userId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Tombstone Test' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `tomb-${userId}@example.com`,
        password: 'hash',
        first_name: 'Trish',
        last_name: 'Leaving',
        role: 'user',
        verified: true,
        two_factor_enabled: true,
        two_factor_code: '123456',
        deletion_scheduled_at: new Date(Date.now() - 1000),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db.insertInto('profiles').values({ id: rand(), tenant_id: tenantId, auth_id: userId }).execute();
    await db
      .insertInto('sessions')
      .values({ id: rand(), session_id: `sess-${userId}`, user_id: userId, tenant_id: tenantId, ip_address: '::1' })
      .execute();
    await db
      .insertInto('passkeys')
      .values({
        user_id: userId,
        tenant_id: tenantId,
        credential_id: `cred-${userId}`,
        public_key: 'pk',
        device_type: 'singleDevice',
      })
      .execute();
    // Authored content — the NO ACTION FK that made the old hard delete 23503 forever.
    await db
      .insertInto('tags')
      .values({ tenant_id: tenantId, name: `authored-${userId}`, createdby_id: userId, updatedby_id: userId })
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('passkeys').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('tombstones an expired user who authored content, and a re-run is a no-op', async () => {
    await performScheduledDeletions(db);

    const row = await db.selectFrom('authusers').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    expect(row.email).toBe(`deleted-${userId}@deleted.invalid`);
    expect(row.first_name).toBe('Deleted user');
    expect(row.last_name).toBe('');
    expect(row.password).toBe('');
    expect(row.verified).toBe(false);
    expect(row.two_factor_enabled).toBe(false);
    expect(row.two_factor_code).toBeNull();
    // Cleared so the daily cron never re-selects this user (the old infinite-retry loop).
    expect(row.deletion_scheduled_at).toBeNull();
    expect(row.deactivated_at).not.toBeNull();

    // Personal satellites are gone; authored content stays with the tenant.
    for (const [table, column] of [
      ['profiles', 'auth_id'],
      ['sessions', 'user_id'],
      ['passkeys', 'user_id'],
    ] as const) {
      const rows = await db.selectFrom(table).select('id').where(column, '=', userId).execute();
      expect(rows, `${table} not cleared`).toHaveLength(0);
    }
    const tags = await db.selectFrom('tags').select('createdby_id').where('tenant_id', '=', tenantId).execute();
    expect(tags).toHaveLength(1);
    expect(String(tags[0]?.createdby_id)).toBe(userId);

    // Second run: nothing left to select (deletion_scheduled_at null + deleted_at set), no throw.
    const before = row.updated_at;
    await performScheduledDeletions(db);
    const after = await db.selectFrom('authusers').select('updated_at').where('id', '=', userId).executeTakeFirst();
    expect(after?.updated_at).toEqual(before);
  });

  it('rethrows per-user failures so the job can go failed and reach the ops digest', async () => {
    // Force the per-user transaction to blow up — the loop must swallow it per-user (other
    // deletions continue) but the run as a whole must FAIL, not complete silently.
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await expect(performScheduledDeletions(db)).rejects.toThrow(`Scheduled deletions failed for: user ${userId}`);

    // The user was not tombstoned and is still scheduled — the next (retried) run picks them up.
    const row = await db.selectFrom('authusers').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
    expect(row.deleted_at).toBeNull();
    expect(row.deletion_scheduled_at).not.toBeNull();
  });
});
