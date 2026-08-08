import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../../../lib/test-utils/exclusive-db-lock';
import { ImportsRepo } from '../../imports/repositories/imports.repo';
import { PersonsService } from './persons.service';

/**
 * Crash-resume and trigger-batching behavior of the people importer, driven against real
 * Postgres because the invariants under test are about what is DURABLE when the worker process
 * dies between arbitrary statements:
 *  (a) no contact is ever inserted twice across a crash + re-run,
 *  (b) the data_imports counters end mutually consistent,
 *  (c) committed chunks' skip reasons survive the crash,
 *  (d) automation-trigger jobs are enqueued inside the chunk transaction (a rollback discards
 *      them) in bounded batches, with the same firing semantics the inline loop had.
 */

// This file commits `pending` background_jobs rows (the batched trigger jobs), which a
// concurrently-running queue spec could claim; take the queue lock so the files take turns.
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

/** One import row for a person with a unique email. */
function personRow(i: number, overrides: Record<string, string> = {}): Record<string, string> {
  return { first_name: `Person${i}`, last_name: 'Imported', email: `person-${i}@example.com`, ...overrides };
}

/** Yields `crashAfter` rows, then dies the way a killed worker does: mid-pull, no cleanup. */
function* crashingSource(
  rows: Record<string, string>[],
  crashAfter: number,
): Generator<Record<string, string>, void, undefined> {
  let yielded = 0;
  for (const row of rows) {
    if (yielded >= crashAfter) throw new Error('simulated worker crash');
    yielded += 1;
    yield row;
  }
}

type StoredJobPayload = { type?: string; person_ids?: string[]; pairs?: Array<Record<string, string>> };

type StoredSkipReason = { row: number; email?: string; reason: string };

function reasonsOf(record: Record<string, unknown>): StoredSkipReason[] {
  const raw = record['skip_reasons'];
  return Array.isArray(raw) ? (raw as StoredSkipReason[]) : [];
}

/**
 * The counted-but-unexplained invariant: every counted skip and every counted error row has a
 * recorded reason naming it, so skipped_count + error_count === skip_reasons.length whenever the
 * totals are under the importer's 500-reason cap.
 */
function expectCountsMatchReasons(record: Record<string, unknown>): void {
  const counted = Number(record['skipped_count']) + Number(record['error_count']);
  if (counted < 500) {
    expect(reasonsOf(record)).toHaveLength(counted);
  }
}

async function storedJobPayloads(tenantId: string): Promise<StoredJobPayload[]> {
  const rows = await db.selectFrom('background_jobs').select('payload').where('tenant_id', '=', tenantId).execute();
  return rows.map((row: { payload: unknown }) => {
    const raw: unknown = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return (raw ?? {}) as StoredJobPayload;
  });
}

describe('People import: crash-resume and batched automation triggers', () => {
  let service: PersonsService;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let importId: string;

  async function createImportRecord(rowCount: number): Promise<string> {
    const dataImport = await db
      .insertInto('data_imports')
      .values({
        tenant_id: tenantId,
        file_name: 'resume-test.csv',
        source: 'persons',
        row_count: rowCount,
        status: 'processing',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(dataImport.id);
  }

  async function importRecordState(): Promise<Record<string, unknown>> {
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
    service = new PersonsService();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Resume Test Tenant' }).execute();
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
        name: 'Resume Campaign',
        admin_id: userId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    campaignId = String(campaign.id);
    importId = await createImportRecord(150);
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

  it('a worker crash between chunks resumes at the committed offset: no double inserts, consistent counters, committed skip reasons kept', async () => {
    // 150 source rows = 2 chunks. Chunk 1 (rows 1..100): 98 with unique emails, one with NO
    // email (the row that WOULD silently duplicate if resume ever re-fed it — nothing dedupes
    // it), one blank (skipped with a reason). Chunk 2 (rows 101..150): 50 more unique emails.
    const rows: Record<string, string>[] = [];
    for (let i = 1; i <= 98; i++) rows.push(personRow(i));
    rows.push({ first_name: 'NoEmail Person' });
    rows.push({}); // blank row -> skipped, reason recorded
    for (let i = 101; i <= 150; i++) rows.push(personRow(i));

    // Run 1: the process dies while pulling row 101 — after chunk 1 committed, before chunk 2.
    await expect(
      service.processImportRows(importId, tenantId, userId, campaignId, [], 0, crashingSource(rows, 100)),
    ).rejects.toThrow('simulated worker crash');

    const afterCrash = await importRecordState();
    // The resume cursor and the counters were written atomically with chunk 1's rows.
    expect(Number(afterCrash['processed_row_offset'])).toBe(100);
    expect(Number(afterCrash['inserted_count'])).toBe(99);
    expect(Number(afterCrash['skipped_count'])).toBe(1);
    expect(Number(afterCrash['error_count'])).toBe(0);

    // Run 2: what the job handler does on re-entry — read the offset, stream-skip that many
    // rows, pass a zero skip base; the processor continues from the persisted counters.
    const offset = Number(afterCrash['processed_row_offset']);
    await service.processImportRows(importId, tenantId, userId, campaignId, [], 0, rows.slice(offset));

    // (a) No contact inserted twice: 149 people total, every email once, ONE no-email person.
    const persons = await db
      .selectFrom('persons')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(persons).toHaveLength(149);
    const emails = persons.map((p: { email: string | null }) => p.email).filter((e: string | null) => e != null);
    expect(new Set(emails).size).toBe(emails.length);
    expect(persons.filter((p: { first_name: string | null }) => p.first_name === 'NoEmail Person')).toHaveLength(1);

    // (b) Counters end mutually consistent: inserted + skipped + errors == source rows.
    const final = await importRecordState();
    expect(Number(final['inserted_count'])).toBe(149);
    expect(Number(final['skipped_count'])).toBe(1);
    expect(Number(final['error_count'])).toBe(0);
    expect(Number(final['inserted_count']) + Number(final['skipped_count']) + Number(final['error_count'])).toBe(150);
    expect(Number(final['processed_row_offset'])).toBe(150);

    // (c) The committed chunk's skip reason survived the crash, exactly once — and every
    // counted skip has a reason on record.
    const reasons = reasonsOf(final);
    expect(reasons.filter((r) => r.reason.includes('Blank row'))).toHaveLength(1);
    expectCountsMatchReasons(final);
  });

  it('enqueues contact_created and tag_added trigger jobs per chunk, bounded, with import semantics preserved', async () => {
    importId = await createImportRecord(120);
    const rows = Array.from({ length: 120 }, (_, i) => personRow(i + 1));

    await service.processImportRows(importId, tenantId, userId, campaignId, ['Imported-trig'], 0, rows, {
      listName: 'Trigger Import List',
    });

    const payloads = await storedJobPayloads(tenantId);
    const contactJobs = payloads.filter((p) => p.type === 'trigger_contact_created');
    const tagJobs = payloads.filter((p) => p.type === 'trigger_tag_added');

    // One job per 100-row chunk (well under the 500 cap), together covering every inserted person.
    expect(contactJobs.map((j) => j.person_ids?.length ?? 0).sort((a, b) => a - b)).toEqual([20, 100]);
    for (const job of contactJobs) expect(job.person_ids?.length).toBeLessThanOrEqual(500);
    const allIds = contactJobs.flatMap((j) => j.person_ids ?? []);
    expect(new Set(allIds).size).toBe(120);

    // Every new person/tag pair fires tag_added — batched, never one job per person.
    const allPairs = tagJobs.flatMap((j) => j.pairs ?? []);
    expect(allPairs).toHaveLength(120);
    for (const job of tagJobs) expect(job.pairs?.length).toBeLessThanOrEqual(500);

    // The import added everyone to the requested static list but must NOT fire list_joined
    // (deliberate product hold).
    const listMembers = await db
      .selectFrom('map_lists_persons')
      .select('person_id')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(listMembers).toHaveLength(120);
    expect(payloads.filter((p) => p.type === 'trigger_list_joined')).toHaveLength(0);

    // Nothing was skipped, so nothing may carry a reason (count and reasons agree at zero too).
    const final = await importRecordState();
    expect(Number(final['skipped_count'])).toBe(0);
    expectCountsMatchReasons(final);
  });

  it('a merged (already-existing) contact gets tag_added for its new tags but never contact_created', async () => {
    const firstImport = await createImportRecord(1);
    await service.processImportRows(firstImport, tenantId, userId, campaignId, ['Imported-one'], 0, [personRow(1)]);
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();

    importId = await createImportRecord(1);
    await service.processImportRows(
      importId,
      tenantId,
      userId,
      campaignId,
      ['Imported-two'],
      0,
      [personRow(1, { first_name: 'Merged' })],
      { duplicateDecision: 'merge' },
    );

    const payloads = await storedJobPayloads(tenantId);
    expect(payloads.filter((p) => p.type === 'trigger_contact_created')).toHaveLength(0);
    const pairs = payloads.filter((p) => p.type === 'trigger_tag_added').flatMap((p) => p.pairs ?? []);
    expect(pairs.map((pair) => pair['tag_name'])).toEqual(['Imported-two']);

    const final = await importRecordState();
    expect(Number(final['merged_count'])).toBe(1);
    expectCountsMatchReasons(final);
  });

  it('a rolled-back chunk discards its trigger jobs, its rows and its list memberships together', async () => {
    importId = await createImportRecord(5);
    const rows = Array.from({ length: 5 }, (_, i) => personRow(i + 1));

    // Make the in-transaction counter write fail once: the whole chunk — rows, trigger-job
    // enqueues, list memberships — must roll back as one.
    vi.spyOn(ImportsRepo.prototype, 'update').mockImplementationOnce(() => {
      throw new Error('simulated in-transaction failure');
    });

    await service.processImportRows(importId, tenantId, userId, campaignId, ['Imported-trig'], 0, rows, {
      listName: 'Rollback List',
    });

    const persons = await db.selectFrom('persons').select('id').where('tenant_id', '=', tenantId).execute();
    expect(persons).toHaveLength(0);
    const payloads = await storedJobPayloads(tenantId);
    expect(payloads.filter((p) => p.type === 'trigger_contact_created' || p.type === 'trigger_tag_added')).toHaveLength(
      0,
    );
    const listMembers = await db
      .selectFrom('map_lists_persons')
      .select('person_id')
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(listMembers).toHaveLength(0);

    const final = await importRecordState();
    expect(Number(final['error_count'])).toBe(5);
    // The lost rows are named, one reason per errored row — an error count with nothing behind
    // it is exactly the silent-failure mode this pins against.
    const reasons = reasonsOf(final);
    expect(reasons).toHaveLength(5);
    expect(new Set(reasons.map((r) => r.row))).toEqual(new Set([1, 2, 3, 4, 5]));
    for (const reason of reasons) {
      expect(reason.reason).toMatch(/not imported.*rolled back/);
    }
    expectCountsMatchReasons(final);
  });

  it('a row whose invalid email was blanked keeps its Tags column, and within-file duplicates get a named skip reason', async () => {
    importId = await createImportRecord(3);
    const rows = [
      { first_name: 'Ada', email: 'ada@example.com', tags: 'Alpha' },
      { first_name: 'Bea', email: 'not-an-email', tags: 'Beta' },
      { first_name: 'Cyd', email: 'ada@example.com', tags: 'Gamma' },
    ];

    await service.processImportRows(importId, tenantId, userId, campaignId, [], 0, rows);

    // Bea imported with the email blanked — and her Tags column applied regardless.
    const bea = await db
      .selectFrom('persons')
      .select(['id', 'email'])
      .where('tenant_id', '=', tenantId)
      .where('first_name', '=', 'Bea')
      .executeTakeFirstOrThrow();
    expect(bea.email).toBeNull();
    const beaTags = await db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .select('tags.name')
      .where('map_peoples_tags.tenant_id', '=', tenantId)
      .where('map_peoples_tags.person_id', '=', String(bea.id))
      .execute();
    // Tag names are lowercased on write; the point is that Beta applied to Bea at all.
    expect(beaTags.map((t: { name: string }) => t.name.toLowerCase())).toEqual(['beta']);

    // Cyd (same email as Ada, earlier in the file) was skipped WITH a reason row — the skipped
    // count and the downloadable reasons list agree.
    const final = await importRecordState();
    expect(Number(final['inserted_count'])).toBe(2);
    expect(Number(final['skipped_count'])).toBe(1);
    const reasons = reasonsOf(final);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ row: 3 });
    expect(reasons[0]?.reason).toContain('Duplicate of an earlier row in this file');
    expectCountsMatchReasons(final);
  });

  it('refuses a chunk whose rows another delivery of the same import already committed', async () => {
    // The duplicate-run bug: a continuation job is committed before the worker marks the current
    // job completed, so if that completion write never lands the original job returns to
    // 'pending' beside its continuation. Both read the same processed_row_offset and re-insert
    // the same rows. The per-chunk offset write is now a compare-and-set, so the run that gets
    // there second writes nothing and its chunk transaction rolls back.
    importId = await createImportRecord(150);
    const rows = Array.from({ length: 150 }, (_, i) => personRow(i + 1));

    // Stands in for the rival run: the moment this run finishes chunk 1 (rows 1..100) and pulls
    // row 101, the other delivery has already committed the rest of the file.
    async function* rivalWinsAfterFirstChunk(): AsyncGenerator<Record<string, string>, void, undefined> {
      for (const [index, row] of rows.entries()) {
        if (index === 100) {
          await db
            .updateTable('data_imports')
            .set({ processed_row_offset: 150 })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', importId)
            .execute();
        }
        yield row;
      }
    }

    await expect(
      service.processImportRows(importId, tenantId, userId, campaignId, [], 0, rivalWinsAfterFirstChunk()),
    ).rejects.toThrow(/advanced past row 100/);

    // Chunk 1's 100 people are there; chunk 2's rows were rolled back, not written twice.
    const persons = await db
      .selectFrom('persons')
      .select(['email'])
      .where('tenant_id', '=', tenantId)
      .where('file_id', '=', importId)
      .execute();
    expect(persons).toHaveLength(100);
    const emails = persons.map((p: { email: string | null }) => p.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).not.toContain('person-150@example.com');
  });

  it('keeps an earlier segment’s error text when a later, clean segment finishes the import', async () => {
    // Each segment's final write replaces the whole error_message column but seeds error_count
    // cumulatively from the stored row. A clean later segment therefore used to store NULL over
    // the earlier segment's text, leaving History showing "N errors" with no explanation.
    importId = await createImportRecord(150);
    await db
      .updateTable('data_imports')
      .set({
        processed_row_offset: 100,
        inserted_count: 99,
        error_count: 1,
        skipped_count: 0,
        error_message: 'chunk 1 could not be written: disk on fire',
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', importId)
      .execute();

    // The continuation segment: 50 clean rows, nothing goes wrong in it.
    const rest = Array.from({ length: 50 }, (_, i) => personRow(i + 101));
    await service.processImportRows(importId, tenantId, userId, campaignId, [], 0, rest);

    const final = await importRecordState();
    expect(String(final['error_message'])).toContain('disk on fire');
    // The count the text explains is still the cumulative one.
    expect(Number(final['error_count'])).toBe(1);
    expect(Number(final['inserted_count'])).toBe(149);
    expect(Number(final['processed_row_offset'])).toBe(150);
  });
});
