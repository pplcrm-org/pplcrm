import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fail-open DNS verification is unit-tested in import-verification.spec.ts; stubbed here so
// these job-level tests never resolve DNS.
vi.mock('../../../lib/jobs/handlers/import-verification', () => ({
  runImportEmailVerification: vi.fn(async () => null),
}));

import { BaseRepository } from '../../../lib/base.repo';
import { handleImportCsvJob } from '../../../lib/jobs/handlers/import.handlers';
import type { JobPayloadOf } from '../../../lib/jobs/job-payloads';
import { TransactionalEmailService } from '../../../lib/mail/transactional-mail.service';
import { StorageService } from '../../../lib/storage.service';
import { ListsRepo } from '../../lists/repositories/lists.repo';

/**
 * End-to-end `import_csv` job runs against real Postgres, pinning the defect classes the import
 * redesign fixed:
 *
 *  - The "add everyone to a NEW list" option used to fail silently for months: the lists insert
 *    violated NOT NULL campaign_id and a broad catch swallowed it, so the import reported clean
 *    success with no list. The first test proves the list now really EXISTS (campaign-scoped)
 *    with exactly the imported persons as members; the second proves that when the list write
 *    fails, the failure is LOUD — the chunk's rows are recorded as errors with per-row reasons
 *    and an error message, never a clean success.
 *  - Skipped rows used to be counted without an explanation. The mixed-causes test asserts the
 *    invariant that `data_imports.skipped_count` equals the number of recorded skip_reasons
 *    entries (under the 500-reason cap), with each reason naming its row.
 *  - A phone-only row used to make the whole 100-row chunk roll back (its household_id came out
 *    empty — NOT NULL violation); the first test includes such a row and asserts zero errors.
 */

// This file commits `pending` background_jobs rows (batched trigger jobs and, potentially, the
// usage-limit check). No queue lock is needed for them: the three spec files that read the queue
// globally insert their own rows in a high priority band, so `claimNextPendingJob` never prefers
// a row this file left behind. Everything this file reads back is scoped to its own tenant_id.

const db = BaseRepository.dbInstance;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

type StoredSkipReason = { row: number; email?: string; reason: string };

function reasonsOf(record: Record<string, unknown>): StoredSkipReason[] {
  const raw = record['skip_reasons'];
  return Array.isArray(raw) ? (raw as StoredSkipReason[]) : [];
}

/**
 * The counted-but-unexplained invariant: every counted skip and every counted error row has a
 * recorded reason naming it, so skipped_count + error_count === skip_reasons.length whenever the
 * totals are under the 500-reason cap.
 */
function expectCountsMatchReasons(record: Record<string, unknown>): void {
  const counted = Number(record['skipped_count']) + Number(record['error_count']);
  if (counted < 500) {
    expect(reasonsOf(record)).toHaveLength(counted);
  }
}

/** downloadStream mock: a fresh in-memory stream per call (the handler downloads twice). */
function mockCsvBlob(text: string): void {
  const buffer = Buffer.from(text, 'utf8');
  vi.spyOn(StorageService.prototype, 'downloadStream').mockImplementation(async () => ({
    stream: Readable.from([Buffer.from(buffer)]),
    contentLength: buffer.length,
  }));
}

describe('import_csv job: list creation and skip accounting against real Postgres', () => {
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let importId: string;

  function csvPayload(overrides: Partial<JobPayloadOf<'import_csv'>> = {}): JobPayloadOf<'import_csv'> {
    return {
      type: 'import_csv',
      import_id: importId,
      tenant_id: tenantId,
      user_id: userId,
      source: 'persons',
      storage_key: `imports/source/${tenantId}/job-test.csv`,
      mapping: { '0': 'first_name', '1': 'email' },
      campaign_id: campaignId,
      tags: [],
      file_name: 'job-test.csv',
      duplicate_decision: 'skip',
      list_name: null,
      ...overrides,
    };
  }

  async function importRecord(): Promise<Record<string, unknown>> {
    return await db
      .selectFrom('data_imports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', importId)
      .executeTakeFirstOrThrow();
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();

    // The completed-import summary email must never leave the test process.
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Import Job Test Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `organizer-${userId}@example.com`,
        first_name: 'Organizer',
        last_name: 'Person',
        verified: true,
        role: 'admin',
        password: 'argon2id$not-a-real-hash',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const campaign = await db
      .insertInto('campaigns')
      .values({
        tenant_id: tenantId,
        name: 'Import Job Campaign',
        admin_id: userId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    campaignId = String(campaign.id);
    const dataImport = await db
      .insertInto('data_imports')
      .values({
        tenant_id: tenantId,
        file_name: 'job-test.csv',
        source: 'persons',
        row_count: 0,
        status: 'processing',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    importId = String(dataImport.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('creates the named list scoped to the campaign, with exactly the imported persons as members', async () => {
    // Three rows, one of them phone-only (no email, no address): before fa72342e a phone-only
    // row voided its household_id and the NOT NULL violation rolled back the whole chunk.
    mockCsvBlob('First,Email,HomePhone\nAda,ada@example.com,\nBob,bob@example.com,\nPhoneOnly,,555-0100\n');

    await handleImportCsvJob(
      csvPayload({
        mapping: { '0': 'first_name', '1': 'email', '2': 'home_phone' },
        list_name: 'Knock Weekend',
      }),
      db,
    );

    // The import reports full success — including the phone-only row's chunk.
    const record = await importRecord();
    expect(record['status']).toBe('completed');
    expect(Number(record['inserted_count'])).toBe(3);
    expect(Number(record['error_count'])).toBe(0);
    expect(Number(record['skipped_count'])).toBe(0);
    expectCountsMatchReasons(record);

    // The list EXISTS, campaign-scoped — this insert is the one that silently violated
    // NOT NULL campaign_id for months.
    const list = await db
      .selectFrom('lists')
      .select(['id', 'name', 'campaign_id', 'object', 'is_dynamic'])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();
    expect(list.name).toBe('Knock Weekend');
    expect(String(list.campaign_id)).toBe(campaignId);
    expect(list.object).toBe('people');
    expect(list.is_dynamic).toBe(false);

    // Membership equals the inserted persons — everyone, including the phone-only person.
    const persons = await db
      .selectFrom('persons')
      .select(['id', 'first_name', 'household_id'])
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(persons).toHaveLength(3);
    const phoneOnly = persons.find((p) => p.first_name === 'PhoneOnly');
    expect(phoneOnly).toBeDefined();
    expect(String(phoneOnly?.household_id ?? '')).not.toBe('');

    const members = await db
      .selectFrom('map_lists_persons')
      .select('person_id')
      .where('tenant_id', '=', tenantId)
      .where('list_id', '=', String(list.id))
      .execute();
    expect(new Set(members.map((m) => String(m.person_id)))).toEqual(new Set(persons.map((p) => String(p.id))));
  });

  it('a failed list write is loud: the chunk rows become named errors, never a clean success', async () => {
    mockCsvBlob('First,Email\nAda,ada@example.com\nBob,bob@example.com\nCyd,cyd@example.com\n');
    vi.spyOn(ListsRepo.prototype, 'add').mockImplementation(() => {
      throw new Error('simulated list write failure');
    });

    await handleImportCsvJob(csvPayload({ list_name: 'Broken List' }), db);

    // The chunk rolled back as one: no persons, no list, no memberships.
    expect(await db.selectFrom('persons').select('id').where('tenant_id', '=', tenantId).execute()).toHaveLength(0);
    expect(await db.selectFrom('lists').select('id').where('tenant_id', '=', tenantId).execute()).toHaveLength(0);
    expect(
      await db.selectFrom('map_lists_persons').select('person_id').where('tenant_id', '=', tenantId).execute(),
    ).toHaveLength(0);

    // And the import record says so, loudly — this is what used to read as a clean success.
    const record = await importRecord();
    expect(Number(record['inserted_count'])).toBe(0);
    expect(Number(record['error_count'])).toBe(3);
    expect(String(record['error_message'])).toContain('simulated list write failure');
    const reasons = reasonsOf(record);
    expect(reasons).toHaveLength(3);
    expect(new Set(reasons.map((r) => r.row))).toEqual(new Set([1, 2, 3]));
    for (const reason of reasons) {
      expect(reason.reason).toMatch(/not imported.*rolled back/);
    }
    expectCountsMatchReasons(record);
  });

  it('skipped_count equals the recorded skip reasons across mixed causes, each naming its row', async () => {
    // An existing contact for the existing-duplicate cause.
    const household = await db
      .insertInto('households')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: String(household.id),
        first_name: 'Eve',
        email: 'eve@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // File rows: 1 Ada (imported), 2 within-file duplicate of Ada, 3 duplicate of the existing
    // Eve, 4 validation failure (first_name over the 100-char row-schema cap). The invalid row
    // comes LAST so the processor's valid-row numbering agrees with the file's numbering.
    const longName = 'x'.repeat(150);
    mockCsvBlob(
      'First,Email\n' +
        'Ada,ada@example.com\n' +
        'Bob,ada@example.com\n' +
        'Eve Again,eve@example.com\n' +
        `${longName},late@example.com\n`,
    );

    await handleImportCsvJob(csvPayload(), db);

    const record = await importRecord();
    expect(record['status']).toBe('completed');
    expect(Number(record['row_count'])).toBe(4);
    expect(Number(record['inserted_count'])).toBe(1);
    expect(Number(record['error_count'])).toBe(0);

    // The invariant: every counted skip has a recorded reason.
    expect(Number(record['skipped_count'])).toBe(3);
    const reasons = reasonsOf(record);
    expect(reasons).toHaveLength(Number(record['skipped_count']));
    expectCountsMatchReasons(record);

    // And each reason names its row and its cause.
    const byRow = new Map(reasons.map((r) => [r.row, r]));
    expect([...byRow.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(byRow.get(2)?.reason).toContain('Duplicate of an earlier row in this file');
    expect(byRow.get(2)?.email).toBe('ada@example.com');
    expect(byRow.get(3)?.reason).toContain('Matches a person you already have');
    expect(byRow.get(3)?.email).toBe('eve@example.com');
    expect(byRow.get(4)?.reason).toContain('first_name');
  });
});
