import { describe, it, expect, afterEach } from 'vitest';
import type { IAuthKeyPayload } from '@common';

import { ListsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { FULL_SCAN_BATCH_SIZE } from '../../lib/paging';

/**
 * Regression coverage for `ListsController.scanMatchingPersonIds` (see controller.ts).
 *
 * Smart-list membership evaluation used to run a single `getAllWithAddress` call, which
 * capped results at the grid page size (`MAX_PAGE_SIZE`) -- a smart list with more matches
 * than one page silently lost every member past the cutoff. It was replaced by a scan that
 * walks the same query in `FULL_SCAN_BATCH_SIZE`-sized batches, keyed on `persons.id`, until a
 * short batch signals the end. These tests pin that behaviour so the truncation bug cannot
 * come back silently: they insert more matching people than one batch holds and assert the
 * scan actually reaches the ones past the first batch.
 *
 * `FULL_SCAN_BATCH_SIZE` is `MAX_PAGE_SIZE` (5000, apps/backend/src/app/lib/paging.ts) -- a
 * fixed constant, not an injectable option -- so exercising "beyond one batch" means inserting
 * on that order of rows. Inserts are bulk (`insertInto().values([...])`) in fixed-size chunks
 * to keep runtime reasonable.
 *
 * These tests do not use `useTestTransaction()`: `scanMatchingPersonIds`/`getCurrentMembers`
 * read through the controller's own pooled connection (`BaseRepository.dbInstance`) and never
 * accept a caller-supplied `Transaction`, so rows written inside a separate test transaction
 * would not be visible to them. This matches the existing pattern in `controller.spec.ts`:
 * real commits against a per-test tenant, cleaned up in `afterEach`.
 */

const db = BaseRepository.dbInstance;

// Sequential, strictly-increasing ids for every row this file inserts, so "last inserted"
// always means "highest id" -- which is what the scan's ORDER BY persons.id relies on.
const FILE_ID_SALT = BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
let idCounter = 0n;
function nextId(): string {
  idCounter += 1n;
  return String(FILE_ID_SALT + idCounter);
}

interface TestSeed {
  tenantId: string;
  userId: string;
  campaignId: string;
  householdId: string;
}

async function createTestSeed(): Promise<TestSeed> {
  const tenantId = nextId();
  const userId = nextId();
  const campaignId = nextId();
  const householdId = nextId();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Full Scan Test Tenant' }).execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `full-scan-${userId}@example.com`,
      password: 'password',
      first_name: 'Scan',
      last_name: 'Owner',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Full Scan Test Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: householdId })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

/** Bulk-insert `persons` rows, each tagged with a volunteer_status, in fixed-size chunks. */
async function insertPersons(
  seed: TestSeed,
  rows: Array<{ id: string; volunteer_status: string | null }>,
  chunkSize = 1000,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({
      id: r.id,
      tenant_id: seed.tenantId,
      campaign_id: seed.campaignId,
      household_id: seed.householdId,
      first_name: 'Scan',
      last_name: 'Person',
      volunteer_status: r.volunteer_status,
      createdby_id: seed.userId,
      updatedby_id: seed.userId,
    }));
    await db.insertInto('persons').values(chunk).execute();
  }
}

/**
 * A smart list matching `volunteer_status IN statuses`. `last_refreshed_at` is stamped to now
 * so `ListsController.getOneById` does not treat it as stale and enqueue a lazy background
 * refresh job (see the >24h check in controller.ts) -- these tests read `getCurrentMembers`
 * directly and have nothing to do with the refresh/job pipeline.
 */
async function createSmartVolunteerList(seed: TestSeed, statuses: string[]): Promise<string> {
  const listId = nextId();
  await db
    .insertInto('lists')
    .values({
      id: listId,
      tenant_id: seed.tenantId,
      campaign_id: seed.campaignId,
      name: `Full scan list ${listId}`,
      object: 'people',
      is_dynamic: true,
      status: 'idle',
      last_refreshed_at: new Date(),
      definition: JSON.stringify({ volunteerStatus: statuses }),
      createdby_id: seed.userId,
      updatedby_id: seed.userId,
    })
    .execute();
  return listId;
}

function authFor(seed: TestSeed): IAuthKeyPayload {
  return { tenant_id: seed.tenantId, user_id: seed.userId, name: 'Full Scan Tester', session_id: 'test-session' };
}

describe('ListsController smart-list full scan (regression: beyond one batch)', () => {
  const controller = new ListsController();
  const tenantsToClean: string[] = [];

  afterEach(async () => {
    for (const tenantId of tenantsToClean.splice(0)) {
      await cleanTenant(tenantId);
    }
  });

  it('includes members beyond the first batch when matches exceed FULL_SCAN_BATCH_SIZE', async () => {
    const seed = await createTestSeed();
    tenantsToClean.push(seed.tenantId);

    const margin = 50;
    const total = FULL_SCAN_BATCH_SIZE + margin;
    const personIds: string[] = [];
    for (let i = 0; i < total; i++) personIds.push(nextId());
    await insertPersons(
      seed,
      personIds.map((id) => ({ id, volunteer_status: 'active' })),
    );
    const lastInsertedId = personIds[personIds.length - 1];

    const listId = await createSmartVolunteerList(seed, ['active']);
    const result = await controller.getCurrentMembers(authFor(seed), listId);

    expect(result.object).toBe('people');
    expect(result.count).toBe(total);
    expect(result.ids.length).toBe(total);
    // The old single-batch scan would have truncated at FULL_SCAN_BATCH_SIZE and dropped
    // everyone after it -- the last-inserted (highest-id) person is exactly what that bug lost.
    expect(result.ids).toContain(lastInsertedId);
    expect(new Set(result.ids).size).toBe(total);
  }, 60_000);

  it('does not drop or double-count when the total is an exact multiple of the batch size', async () => {
    const seed = await createTestSeed();
    tenantsToClean.push(seed.tenantId);

    const total = FULL_SCAN_BATCH_SIZE; // one exact batch: forces a second, empty fetch to terminate
    const personIds: string[] = [];
    for (let i = 0; i < total; i++) personIds.push(nextId());
    await insertPersons(
      seed,
      personIds.map((id) => ({ id, volunteer_status: 'active' })),
    );

    const listId = await createSmartVolunteerList(seed, ['active']);
    const result = await controller.getCurrentMembers(authFor(seed), listId);

    expect(result.count).toBe(total);
    expect(result.ids.length).toBe(total);
    expect(new Set(result.ids).size).toBe(total);
    expect([...result.ids].sort()).toEqual([...personIds].sort());
  }, 60_000);

  it('keeps excluding non-matching people interleaved across every batch, not just the first', async () => {
    const seed = await createTestSeed();
    tenantsToClean.push(seed.tenantId);

    const matchingTotal = FULL_SCAN_BATCH_SIZE + 20;
    const rows: Array<{ id: string; volunteer_status: string | null }> = [];
    const matchingIds: string[] = [];
    const nonMatchingIds: string[] = [];
    let matched = 0;
    while (matched < matchingTotal) {
      const id = nextId();
      rows.push({ id, volunteer_status: 'active' });
      matchingIds.push(id);
      matched++;
      // Interleave a non-matching person after every 100 matches, so exclusions are spread
      // across both the first batch and everything after the FULL_SCAN_BATCH_SIZE boundary.
      if (matched % 100 === 0) {
        const skipId = nextId();
        rows.push({ id: skipId, volunteer_status: 'inactive' });
        nonMatchingIds.push(skipId);
      }
    }
    await insertPersons(seed, rows);

    const listId = await createSmartVolunteerList(seed, ['active']);
    const result = await controller.getCurrentMembers(authFor(seed), listId);

    expect(result.count).toBe(matchingTotal);
    expect(result.ids.length).toBe(matchingTotal);
    expect([...result.ids].sort()).toEqual([...matchingIds].sort());
    // In particular, a non-matching person planted well past the first-batch boundary must
    // still be excluded -- not just the ones near the start of the scan.
    const idsSet = new Set(result.ids);
    for (const skipId of nonMatchingIds) {
      expect(idsSet.has(skipId)).toBe(false);
    }
  }, 60_000);

  it('never includes matching people from another tenant', async () => {
    const seedA = await createTestSeed();
    const seedB = await createTestSeed();
    tenantsToClean.push(seedA.tenantId, seedB.tenantId);

    const aIds = [nextId(), nextId(), nextId()];
    const bIds = [nextId(), nextId(), nextId()];
    await insertPersons(
      seedA,
      aIds.map((id) => ({ id, volunteer_status: 'active' })),
    );
    await insertPersons(
      seedB,
      bIds.map((id) => ({ id, volunteer_status: 'active' })),
    );

    const listIdA = await createSmartVolunteerList(seedA, ['active']);
    const resultA = await controller.getCurrentMembers(authFor(seedA), listIdA);

    expect(resultA.count).toBe(aIds.length);
    expect([...resultA.ids].sort()).toEqual([...aIds].sort());
    for (const bId of bIds) {
      expect(resultA.ids).not.toContain(bId);
    }
  });
});
