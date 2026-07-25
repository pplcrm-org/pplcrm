import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../test-utils/exclusive-db-lock';
import { claimNextPendingJob } from './job-claim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reaches the shared Kysely handle
const db = (BaseRepository as any)._db;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

// Every assertion here is about which row claimNextPendingJob picks out of the *whole* table, so
// no other spec file may hold a pending job while these run.
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);

describe('claimNextPendingJob (per-tenant in-flight fairness)', () => {
  const createdJobs: string[] = [];
  const createdTenants: string[] = [];

  /** background_jobs.tenant_id is an FK to tenants — create a real tenant row for each label. */
  async function tenant(): Promise<string> {
    const id = rand();
    await db
      .insertInto('tenants')
      .values({ id, name: `Fairness Tenant ${id}` })
      .execute();
    createdTenants.push(id);
    return id;
  }

  async function insertJob(tenantId: string | null, status: 'pending' | 'processing'): Promise<string> {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status,
        payload: JSON.stringify({ type: 'noop' }),
        run_at: new Date(),
        max_attempts: 3,
        locked_at: status === 'processing' ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    createdJobs.push(String(row.id));
    return String(row.id);
  }

  beforeEach(() => {
    createdJobs.length = 0;
    createdTenants.length = 0;
  });

  afterEach(async () => {
    if (createdJobs.length > 0) {
      await db.deleteFrom('background_jobs').where('id', 'in', createdJobs).execute();
    }
    if (createdTenants.length > 0) {
      await db.deleteFrom('tenants').where('id', 'in', createdTenants).execute();
    }
  });

  it('skips a tenant already at its in-flight cap, even though its job has the lower id', async () => {
    const busy = await tenant();
    const other = await tenant();

    await insertJob(busy, 'processing');
    await insertJob(busy, 'processing'); // busy is at cap (2)
    await insertJob(busy, 'pending'); // lower id, but should be skipped
    await insertJob(other, 'pending'); // higher id, but its tenant is free

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(String(claimed?.tenant_id)).toBe(other);
  });

  it('claims a tenant below its cap in FIFO order', async () => {
    const a = await tenant();
    const b = await tenant();

    await insertJob(a, 'processing'); // 1 in flight, cap 2 → still eligible
    const aPending = await insertJob(a, 'pending'); // lower id
    await insertJob(b, 'pending'); // higher id

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(String(claimed?.tenant_id)).toBe(a);
    expect(String(claimed?.id)).toBe(aPending);
  });

  it('never throttles system jobs (tenant_id = null)', async () => {
    const busy = await tenant();
    await insertJob(busy, 'processing');
    await insertJob(busy, 'processing'); // at cap
    await insertJob(busy, 'pending'); // lower id, throttled
    const sysJob = await insertJob(null, 'pending'); // higher id, exempt

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(claimed?.tenant_id).toBeNull();
    expect(String(claimed?.id)).toBe(sysJob);
  });
});
