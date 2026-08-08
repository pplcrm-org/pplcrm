import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../test-utils/exclusive-db-lock';
import { IMPORT_CONTINUATION_PRIORITY, claimNextPendingJob } from './job-claim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test reaches the shared Kysely handle
const db = (BaseRepository as any)._db;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/**
 * Base priority added to every row this file inserts.
 *
 * Every assertion here is about which row `claimNextPendingJob` picks out of the *whole* table,
 * and about thirty other spec files commit `pending` background_jobs rows as a side effect of
 * what they test (a signup queues a welcome email, importing an address queues a geocode job).
 * Those rows are older, so under `priority DESC, id ASC` they would be picked ahead of the rows
 * these tests just inserted. Lifting this file's rows into their own priority band puts them all
 * ahead of every such row while leaving the *relative* order among them untouched: each insert
 * adds this base to the priority the test asked for, so a test comparing priority 0 against
 * IMPORT_CONTINUATION_PRIORITY still compares 1000 against 1010.
 *
 * Nothing about the claim is bypassed — the real `claimNextPendingJob` still runs, including the
 * per-tenant in-flight fairness these tests exist to pin.
 */
const SPEC_PRIORITY_BASE = 1000;

// The priority band above handles every spec file that merely leaves a claimable row behind. The
// lock handles the remaining case it cannot: the other spec files that run a real claimer
// (worker.retry-backoff.spec.ts) or a real queue sweep (worker.reliability.spec.ts) and use the
// same band, so those few files take turns instead of claiming each other's rows.
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

  async function insertJob(
    tenantId: string | null,
    status: 'pending' | 'processing',
    priority: number = 0,
  ): Promise<string> {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status,
        priority: SPEC_PRIORITY_BASE + priority,
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

describe('claimNextPendingJob (priority ordering)', () => {
  const createdJobs: string[] = [];
  const createdTenants: string[] = [];

  async function tenant(): Promise<string> {
    const id = rand();
    await db
      .insertInto('tenants')
      .values({ id, name: `Priority Tenant ${id}` })
      .execute();
    createdTenants.push(id);
    return id;
  }

  async function insertJob(tenantId: string, priority: number, payloadType = 'noop'): Promise<string> {
    const row = await db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'pending',
        priority: SPEC_PRIORITY_BASE + priority,
        payload: JSON.stringify({ type: payloadType }),
        run_at: new Date(),
        max_attempts: 3,
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

  it('claims a ready import continuation before a large batch of earlier-enqueued fan-out jobs', async () => {
    const importer = await tenant();

    // The observed live shape, scaled down: a segment fans out a batch of default-priority
    // geocode jobs (lower ids), THEN enqueues its continuation (highest id). Same-second run_at
    // throughout, exactly as observed — id order alone would drain the whole batch first.
    for (let i = 0; i < 50; i++) {
      await insertJob(importer, 0, 'geocode_household');
    }
    const continuation = await insertJob(importer, IMPORT_CONTINUATION_PRIORITY, 'import_csv');

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(String(claimed?.id)).toBe(continuation);
  });

  it('keeps plain FIFO (lowest id first) among default-priority jobs', async () => {
    const a = await tenant();
    const b = await tenant();

    const first = await insertJob(a, 0);
    await insertJob(b, 0);
    await insertJob(a, 0);

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(String(claimed?.id)).toBe(first);
  });

  it('still skips a prioritized job whose tenant is at its in-flight cap (fairness beats priority)', async () => {
    const busy = await tenant();
    const other = await tenant();

    // busy is at cap (2) with default-priority work in flight.
    for (let i = 0; i < 2; i++) {
      const row = await db
        .insertInto('background_jobs')
        .values({
          tenant_id: busy,
          queue: 'default',
          status: 'processing',
          priority: SPEC_PRIORITY_BASE,
          payload: JSON.stringify({ type: 'noop' }),
          run_at: new Date(),
          max_attempts: 3,
          locked_at: new Date(),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      createdJobs.push(String(row.id));
    }
    await insertJob(busy, IMPORT_CONTINUATION_PRIORITY, 'import_csv'); // prioritized but throttled
    const otherJob = await insertJob(other, 0);

    const claimed = await claimNextPendingJob(db, 'test-worker', 2);
    expect(String(claimed?.tenant_id)).toBe(other);
    expect(String(claimed?.id)).toBe(otherJob);
  });
});
