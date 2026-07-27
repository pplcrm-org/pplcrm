import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { KEY_SLOTS, MAX_KEYS_PER_TENANT, WorkspaceApiKeysRepo } from './workspace-api-keys.repo';

/**
 * Database-level invariants for workspace API keys.
 *
 * These deliberately go through real SQL rather than a mocked repo. Every property below is
 * enforced by a constraint or a WHERE clause, and each one has a failure mode that a mock-based
 * test cannot see: a mock will happily accept a third key, a duplicate hash, or an UPDATE that
 * touches every row of the tenant.
 */
describe('WorkspaceApiKeysRepo (database invariants)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test access to the shared Kysely instance
  const db = (BaseRepository as any)._db;
  const repo = new WorkspaceApiKeysRepo();

  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  let tenantId: string;

  beforeEach(async () => {
    tenantId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'API key repo spec' }).execute();
  });

  afterEach(async () => {
    await db.deleteFrom('workspace_api_keys').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('holds two live keys for one tenant', async () => {
    await repo.createInSlot(tenantId, 1, `hash-a-${tenantId}`, 'ws_aaaa');
    await repo.createInSlot(tenantId, 2, `hash-b-${tenantId}`, 'ws_bbbb');

    const rows = await repo.listByTenantId(tenantId);
    expect(rows).toHaveLength(MAX_KEYS_PER_TENANT);
    expect(rows.map((r) => Number(r.slot))).toEqual([...KEY_SLOTS]);
  });

  it('refuses a second key in the same slot — the cap is the constraint, not a count-then-insert', async () => {
    await repo.createInSlot(tenantId, 1, `hash-a-${tenantId}`, 'ws_aaaa');

    // The controller counts existing keys before choosing a slot, but two concurrent creates can
    // both pass that count. uq_workspace_api_keys_tenant_slot is what actually stops a third
    // credential existing; the controller turns this 23505 into a CONFLICT.
    await expect(repo.createInSlot(tenantId, 1, `hash-c-${tenantId}`, 'ws_cccc')).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('rejects a slot outside 1..2', async () => {
    await expect(repo.createInSlot(tenantId, 3, `hash-d-${tenantId}`, 'ws_dddd')).rejects.toMatchObject({
      code: '23514', // chk_workspace_api_keys_slot
    });
  });

  it('rejects a duplicate key_hash across tenants', async () => {
    const otherTenant = rand();
    await db.insertInto('tenants').values({ id: otherTenant, name: 'Other' }).execute();
    try {
      const sharedHash = `hash-collision-${tenantId}`;
      await repo.createInSlot(tenantId, 1, sharedHash, 'ws_aaaa');

      // "Which tenant owns this key" must have exactly one answer — lookupTenantByApiKey resolves
      // a caller's tenant from this column. It was only indexed, never unique, until 2026-07-27.
      await expect(repo.createInSlot(otherTenant, 1, sharedHash, 'ws_zzzz')).rejects.toMatchObject({
        code: '23505',
      });
    } finally {
      await db.deleteFrom('workspace_api_keys').where('tenant_id', '=', otherTenant).execute();
      await db.deleteFrom('tenants').where('id', '=', otherTenant).execute();
    }
  });

  it('stamps last_used_at on ONE key, never on both', async () => {
    const used = await repo.createInSlot(tenantId, 1, `hash-a-${tenantId}`, 'ws_aaaa');
    await repo.createInSlot(tenantId, 2, `hash-b-${tenantId}`, 'ws_bbbb');
    if (!used) throw new Error('expected the created row back');

    await repo.updateLastUsed(tenantId, String(used.id));

    // The regression this guards: updateLastUsed used to filter on tenant_id alone, so every
    // request marked BOTH keys as used. That is exactly backwards — last_used_at exists so you
    // can tell which half of a rotation is still in service before revoking the other.
    const rows = await repo.listByTenantId(tenantId);
    expect(rows.find((r) => Number(r.slot) === 1)?.last_used_at).not.toBeNull();
    expect(rows.find((r) => Number(r.slot) === 2)?.last_used_at).toBeNull();
  });

  it('will not stamp a key belonging to another tenant', async () => {
    const victimTenant = rand();
    await db.insertInto('tenants').values({ id: victimTenant, name: 'Victim' }).execute();
    try {
      const victimKey = await repo.createInSlot(victimTenant, 1, `hash-v-${victimTenant}`, 'ws_vvvv');
      if (!victimKey) throw new Error('expected the created row back');

      await repo.updateLastUsed(tenantId, String(victimKey.id));

      const rows = await repo.listByTenantId(victimTenant);
      expect(rows[0]?.last_used_at).toBeNull();
    } finally {
      await db.deleteFrom('workspace_api_keys').where('tenant_id', '=', victimTenant).execute();
      await db.deleteFrom('tenants').where('id', '=', victimTenant).execute();
    }
  });

  it('deletes only the named slot, leaving the other key live', async () => {
    await repo.createInSlot(tenantId, 1, `hash-a-${tenantId}`, 'ws_aaaa');
    await repo.createInSlot(tenantId, 2, `hash-b-${tenantId}`, 'ws_bbbb');

    await repo.deleteByTenantAndSlot(tenantId, 1);

    const rows = await repo.listByTenantId(tenantId);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].slot)).toBe(2);
  });
});
