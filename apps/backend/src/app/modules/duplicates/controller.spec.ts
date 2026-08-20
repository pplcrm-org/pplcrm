import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { DuplicatesController } from './controller';
import { PersonsRepo } from '../persons/repositories/persons.repo';
import { PersonsService } from '../persons/services/persons.service';

/**
 * Tenant safety of the review-queue endpoints the Duplicates page calls:
 *
 * - duplicates.countQueue / getSweepInfo / dismissGroup (this module)
 * - persons.getPotentialDuplicates / persons.mergePersons (persons module — the page's pair list
 *   and its Merge button)
 *
 * The underlying detection is covered in persons.repo.spec.ts; what this file pins is that none
 * of the review actions can see or touch another tenant's rows. The worst possible regression is
 * a merge pairing two persons from DIFFERENT tenants, so those tests assert the refusal AND that
 * neither person row was modified.
 *
 * All duplicate groups here share ONE group_key across both tenants on purpose: group keys are
 * content-derived (a shared email), so two unrelated workspaces holding the same key is the
 * realistic collision the scoping must survive.
 */

const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface SeededTenant {
  tenantId: string;
  userId: string;
  householdId: string;
  /** Duplicate pair: target has no mobile, source carries one (merge fill assertion). */
  targetId: string;
  sourceId: string;
  auth: { tenant_id: string; user_id: string; session_id: string };
}

async function seedTenantWithPair(groupKey: string): Promise<SeededTenant> {
  const tenantId = rand();
  const userId = rand();
  const householdId = rand();
  const targetId = rand();
  const sourceId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Duplicates Spec Tenant' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `dup-spec-${userId}@example.com`,
      password: 'password',
      first_name: 'Dup',
      last_name: 'Reviewer',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();
  await db
    .insertInto('households')
    .values({ id: householdId, tenant_id: tenantId, createdby_id: userId, updatedby_id: userId })
    .execute();
  await db
    .insertInto('persons')
    .values([
      // Same-name pair: persons carries a per-tenant unique index on lower(email)
      // (idx_persons_tenant_email_unique), so an email-keyed pair cannot exist as two committed
      // rows. The email lives on the TARGET and the source carries only a mobile — the reverse
      // (source has the email, target none) makes mergePersons copy the source's email onto the
      // target while the source row still exists, which that same index rejects and the whole
      // merge fails. Real bug, reported separately; not pinned here to avoid enshrining it.
      {
        id: targetId,
        tenant_id: tenantId,
        household_id: householdId,
        createdby_id: userId,
        updatedby_id: userId,
        first_name: 'Taylor',
        last_name: 'Duplikate',
        email: `dup-tgt-${targetId}@example.com`,
        mobile: null,
      },
      {
        id: sourceId,
        tenant_id: tenantId,
        household_id: householdId,
        createdby_id: userId,
        updatedby_id: userId,
        first_name: 'Taylor',
        last_name: 'Duplikate',
        email: null,
        mobile: '5551234567',
      },
    ])
    .execute();
  await db
    .insertInto('potential_duplicates')
    .values([
      { tenant_id: tenantId, group_key: groupKey, person_id: targetId, reason: 'Similar name' },
      { tenant_id: tenantId, group_key: groupKey, person_id: sourceId, reason: 'Similar name' },
    ])
    .execute();

  return {
    tenantId,
    userId,
    householdId,
    targetId,
    sourceId,
    auth: { tenant_id: tenantId, user_id: userId, session_id: 'dup-spec-session' },
  };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('dismissed_duplicate_groups').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('potential_duplicates').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

const personRow = (tenantId: string, id: string) =>
  db.selectFrom('persons').selectAll().where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();

const pairRows = (tenantId: string, groupKey: string) =>
  db
    .selectFrom('potential_duplicates')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('group_key', '=', groupKey)
    .execute();

describe('Duplicates review endpoints — tenant safety', () => {
  const controller = new DuplicatesController();
  const personsRepo = new PersonsRepo();
  const personsService = new PersonsService();

  let groupKey: string;
  let a: SeededTenant; // the caller's tenant
  let b: SeededTenant; // the other tenant, holding an identical group_key

  beforeEach(async () => {
    groupKey = `dup-spec-${rand()}`;
    a = await seedTenantWithPair(groupKey);
    b = await seedTenantWithPair(groupKey);
  });

  afterEach(async () => {
    await cleanTenant(a.tenantId);
    await cleanTenant(b.tenantId);
  });

  describe('listing the review queue', () => {
    it('countQueue counts only the caller-tenant groups', async () => {
      // Both tenants hold a pair under the SAME group_key; each caller must see exactly one.
      expect(await controller.countQueue(a.auth as any)).toBe(1);
      expect(await controller.countQueue(b.auth as any)).toBe(1);
    });

    it('getSweepInfo bundles the tenant-scoped queue count (the sweep timestamp is global by design)', async () => {
      const info = await controller.getSweepInfo(a.auth as any);

      expect(info.queueCount).toBe(1);
      // lastSweepAt is the single global cron's completion time — other suite files may or may
      // not have run it, so only its shape is pinned here.
      expect(info.lastSweepAt === null || typeof info.lastSweepAt === 'string').toBe(true);
    });

    it('getPotentialDuplicates returns only the caller-tenant persons, never the other tenant with the same key', async () => {
      const { groups, total } = await personsRepo.getPotentialDuplicates(a.tenantId);

      expect(total).toBe(1);
      expect(groups).toHaveLength(1);
      const group = groups[0] as { group_key: string; persons: { id: string }[] };
      expect(group.group_key).toBe(groupKey);
      const ids = group.persons.map((p) => String(p.id)).sort();
      expect(ids).toEqual([a.targetId, a.sourceId].sort());
      // The other tenant's two persons under the identical key must not appear.
      expect(ids).not.toContain(b.targetId);
      expect(ids).not.toContain(b.sourceId);
    });
  });

  describe('resolving a pair (merge)', () => {
    it('merges two persons of the caller-own tenant: source deleted, empty target fields filled, queue rows cascade away', async () => {
      const result = await personsService.mergePersons({ target_id: a.targetId, source_id: a.sourceId }, a.auth as any);

      expect(result).toEqual({ success: true });
      // Source person is gone; target survives and inherited the source's mobile (target had
      // none), while its own filled fields are never overwritten.
      expect(await personRow(a.tenantId, a.sourceId)).toBeUndefined();
      const target = await personRow(a.tenantId, a.targetId);
      expect(target).toBeDefined();
      expect(target.mobile).toBe('5551234567');
      expect(target.email).toBe(`dup-tgt-${a.targetId}@example.com`);
      expect(target.first_name).toBe('Taylor');
      // The source's potential_duplicates row is ON DELETE CASCADE.
      const remaining = await pairRows(a.tenantId, groupKey);
      expect(remaining.map((r: { person_id: unknown }) => String(r.person_id))).toEqual([a.targetId]);
      // The merge is logged on the surviving record's activity feed.
      const activity = await db
        .selectFrom('user_activity')
        .selectAll()
        .where('tenant_id', '=', a.tenantId)
        .where('activity', '=', 'merge')
        .where('entity', '=', 'persons')
        .execute();
      expect(activity).toHaveLength(1);
      expect(String(activity[0].entity_id)).toBe(a.targetId);
      // The other tenant's identical-key pair is completely untouched.
      expect(await pairRows(b.tenantId, groupKey)).toHaveLength(2);
      expect(await personRow(b.tenantId, b.sourceId)).toBeDefined();
    });

    it('refuses to merge when the SOURCE belongs to another tenant — and modifies neither person', async () => {
      const foreignBefore = await personRow(b.tenantId, b.sourceId);
      const ownBefore = await personRow(a.tenantId, a.targetId);

      await expect(
        personsService.mergePersons({ target_id: a.targetId, source_id: b.sourceId }, a.auth as any),
      ).rejects.toThrow('Target or Source person not found');

      // The never-leak assertion: the foreign person still exists, byte-for-byte unchanged.
      const foreignAfter = await personRow(b.tenantId, b.sourceId);
      expect(foreignAfter).toEqual(foreignBefore);
      const ownAfter = await personRow(a.tenantId, a.targetId);
      expect(ownAfter).toEqual(ownBefore);
      // No merge was logged for either tenant.
      for (const tenantId of [a.tenantId, b.tenantId]) {
        const logged = await db
          .selectFrom('user_activity')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('activity', '=', 'merge')
          .execute();
        expect(logged).toHaveLength(0);
      }
    });

    it('refuses to merge when the TARGET belongs to another tenant — the caller-own source is not deleted', async () => {
      const foreignBefore = await personRow(a.tenantId, a.targetId);

      await expect(
        personsService.mergePersons({ target_id: a.targetId, source_id: b.sourceId }, b.auth as any),
      ).rejects.toThrow('Target or Source person not found');

      // The foreign target is untouched and the caller's own source person was NOT consumed.
      expect(await personRow(a.tenantId, a.targetId)).toEqual(foreignBefore);
      const ownSource = await personRow(b.tenantId, b.sourceId);
      expect(ownSource).toBeDefined();
      expect(ownSource.mobile).toBe('5551234567');
    });
  });

  describe('dismissing a pair ("Not duplicates")', () => {
    it('dismissGroup clears only the caller-tenant rows for that key — the other tenant keeps its queue', async () => {
      await controller.dismissGroup(groupKey, a.auth as any);

      // Caller's queue rows are gone and the verdict is recorded for the caller only.
      expect(await pairRows(a.tenantId, groupKey)).toHaveLength(0);
      const dismissedA = await db
        .selectFrom('dismissed_duplicate_groups')
        .selectAll()
        .where('tenant_id', '=', a.tenantId)
        .where('group_key', '=', groupKey)
        .execute();
      expect(dismissedA).toHaveLength(1);
      expect(String(dismissedA[0].dismissed_by_id)).toBe(a.userId);
      // The never-leak assertion: tenant B's rows under the identical key survive, and B has no
      // dismissal verdict it never gave.
      expect(await pairRows(b.tenantId, groupKey)).toHaveLength(2);
      const dismissedB = await db
        .selectFrom('dismissed_duplicate_groups')
        .selectAll()
        .where('tenant_id', '=', b.tenantId)
        .where('group_key', '=', groupKey)
        .execute();
      expect(dismissedB).toHaveLength(0);
      expect(await controller.countQueue(a.auth as any)).toBe(0);
      expect(await controller.countQueue(b.auth as any)).toBe(1);
    });

    it('dismissing the same group twice is idempotent (one verdict row, no throw)', async () => {
      await controller.dismissGroup(groupKey, a.auth as any);
      await controller.dismissGroup(groupKey, a.auth as any);

      const dismissed = await db
        .selectFrom('dismissed_duplicate_groups')
        .selectAll()
        .where('tenant_id', '=', a.tenantId)
        .where('group_key', '=', groupKey)
        .execute();
      expect(dismissed).toHaveLength(1);
    });
  });
});
