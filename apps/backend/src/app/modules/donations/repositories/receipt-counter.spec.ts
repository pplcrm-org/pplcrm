import { afterEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../../../lib/test-utils/exclusive-db-lock';
import { ReceiptsRepo } from './receipts.repo';

// Real committed/rolled-back transactions against the shared Postgres — the row lock IS the
// subject — so this file serializes against the receipts controller spec via the same key.
useExclusiveDbLock(DB_TEST_LOCKS.RECEIPT_COUNTERS);

const YEAR = 2099; // far from any live year so leftovers can never collide with real data
const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);

describe('receipt counter (gap-free per tenant-year)', () => {
  const repo = new ReceiptsRepo();
  const db = (BaseRepository as any)._db;
  const tenantIds: string[] = [];

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await db.deleteFrom('receipt_counters').where('tenant_id', '=', tenantId).execute();
    }
  });

  it('hands out strictly sequential numbers under concurrency', async () => {
    const tenantId = rand();
    tenantIds.push(tenantId);

    // Five concurrent transactions race the insert-if-absent upsert; each holds the row lock
    // only until its own commit.
    const serials = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.transaction().execute(async (trx: any) => repo.nextSerial(trx, tenantId, YEAR)),
      ),
    );
    expect([...serials].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns a rolled-back number instead of leaving a gap', async () => {
    const tenantId = rand();
    tenantIds.push(tenantId);

    const first = await db.transaction().execute(async (trx: any) => repo.nextSerial(trx, tenantId, YEAR));
    expect(first).toBe(1);

    await expect(
      db.transaction().execute(async (trx: any) => {
        const n = await repo.nextSerial(trx, tenantId, YEAR);
        expect(n).toBe(2);
        throw new Error('boom — roll back the issuance');
      }),
    ).rejects.toThrow('boom');

    const next = await db.transaction().execute(async (trx: any) => repo.nextSerial(trx, tenantId, YEAR));
    expect(next).toBe(2); // the aborted issuance returned its number

    // Separate years and tenants count independently.
    const otherYear = await db.transaction().execute(async (trx: any) => repo.nextSerial(trx, tenantId, YEAR + 1));
    expect(otherYear).toBe(1);
    const otherTenant = rand();
    tenantIds.push(otherTenant);
    const other = await db.transaction().execute(async (trx: any) => repo.nextSerial(trx, otherTenant, YEAR));
    expect(other).toBe(1);
  });
});
