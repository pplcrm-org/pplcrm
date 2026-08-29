import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { BadRequestError } from '../../errors/app-errors';
import { ZapierService } from './zapier.service';

/**
 * Database invariants for Zapier REST-hook subscriptions (2026-08-28-zapier-rest-hooks).
 *
 * The constraint change these pin down: a tenant may hold SEVERAL subscriptions per event
 * type (one per Zap), deduped only on the exact (tenant, event, URL) triple. A mock cannot
 * see any of that — the uniqueness lives in uq_zapier_subscriptions_tenant_event_url.
 */
describe('ZapierService subscriptions (database invariants)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test access to the shared Kysely instance
  const db = (BaseRepository as any)._db;
  const service = new ZapierService();

  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  let tenantId: string;

  const countRows = async (): Promise<number> => {
    const rows = await db.selectFrom('zapier_subscriptions').select('id').where('tenant_id', '=', tenantId).execute();
    return rows.length;
  };

  beforeEach(async () => {
    tenantId = rand();
    await db.insertInto('tenants').values({ id: tenantId, name: 'Zapier service spec' }).execute();
  });

  afterEach(async () => {
    await db.deleteFrom('zapier_subscriptions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('holds several subscriptions for the same event — one per Zap hook URL', async () => {
    const first = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');
    const second = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/b');

    expect(first.id).not.toBe(second.id);
    expect(await countRows()).toBe(2);
  });

  it('dedupes an identical re-subscribe onto the existing row and returns the same id', async () => {
    const first = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');
    const again = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');

    expect(again.id).toBe(first.id);
    expect(await countRows()).toBe(1);
  });

  it('unsubscribeById removes exactly that subscription', async () => {
    const first = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');
    const second = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/b');

    await service.unsubscribeById(tenantId, first.id);

    const rows = await db.selectFrom('zapier_subscriptions').select('id').where('tenant_id', '=', tenantId).execute();
    expect(rows.map((r: { id: string }) => String(r.id))).toEqual([second.id]);
  });

  it('unsubscribeById is tenant-scoped — another tenant cannot delete the subscription', async () => {
    const otherTenant = rand();
    await db.insertInto('tenants').values({ id: otherTenant, name: 'Other tenant' }).execute();
    try {
      const sub = await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');

      await service.unsubscribeById(otherTenant, sub.id);

      expect(await countRows()).toBe(1);
    } finally {
      await db.deleteFrom('zapier_subscriptions').where('tenant_id', '=', otherTenant).execute();
      await db.deleteFrom('tenants').where('id', '=', otherTenant).execute();
    }
  });

  it('unsubscribe(event) removes every subscription for that event and no other', async () => {
    await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/a');
    await service.subscribe(tenantId, 'person_created', 'https://hooks.zapier.com/b');
    await service.subscribe(tenantId, 'person_deleted', 'https://hooks.zapier.com/c');

    await service.unsubscribe(tenantId, 'person_created');

    const rows = await db
      .selectFrom('zapier_subscriptions')
      .select('event_type')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(rows.map((r: { event_type: string }) => r.event_type)).toEqual(['person_deleted']);
  });

  it('refuses a non-https hook URL and a private-address target (SSRF guard)', async () => {
    await expect(service.subscribe(tenantId, 'person_created', 'http://example.com/hook')).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(
      service.subscribe(tenantId, 'person_created', 'https://169.254.169.254/latest'),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await countRows()).toBe(0);
  });
});
