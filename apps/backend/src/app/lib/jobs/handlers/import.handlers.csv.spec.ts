import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fail-open verification is unit-tested in import-verification.spec.ts; stubbed here so the
// csv-path tests never resolve DNS.
vi.mock('./import-verification', () => ({
  runImportEmailVerification: vi.fn(async () => null),
}));

import type { Kysely } from 'kysely';
import { importRowLimitFor } from '../../../../../../../libs/common/src';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { CompaniesController } from '../../../modules/companies/controller';
import { HouseholdsController } from '../../../modules/households/controller';
import { ImportsRepo } from '../../../modules/imports/repositories/imports.repo';
import { PersonsService } from '../../../modules/persons/services/persons.service';
import { StorageService } from '../../storage.service';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { TransactionalSendBlockedError } from '../../mail/transactional-send-guard';
import { handleImportCsvJob } from './import.handlers';

/**
 * Chainable stand-in that answers each `executeTakeFirst()` from a queue: the run-state read
 * (status + resume offset) first, then — on a fresh (non-resuming) run — the tenant-plan read
 * that resolves the per-plan row cap, then (depending on the test) the skip-reason merge read
 * and the summary-email user lookup. `undefined` everywhere means "not completed, offset 0,
 * no plan row (fails closed to Free's 5,000-row cap), no stored reasons, no user" — the
 * handler proceeds fresh and simply sends no email. The `insertInto` chain records
 * continuation-job enqueues.
 */
function makeScriptedDb(results: unknown[] = []): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where', 'values']) b[m] = vi.fn(() => b);
  b.insertInto = vi.fn(() => b);
  b.execute = vi.fn(async () => []);
  let call = 0;
  b.executeTakeFirst = vi.fn(async () => results[call++]);
  return b as Kysely<Models>;
}

function csvPayload(overrides: Record<string, unknown> = {}): any {
  return {
    type: 'import_csv',
    import_id: '11',
    tenant_id: '1',
    user_id: '2',
    source: 'persons',
    storage_key: 'imports/source/1/abc.csv',
    mapping: { '0': 'first_name', '1': 'email' },
    campaign_id: '3',
    tags: ['Imported-20260804'],
    file_name: 'contacts.csv',
    duplicate_decision: 'skip',
    list_name: null,
    ...overrides,
  };
}

/** downloadStream mock: a fresh in-memory stream per call (the handler downloads twice). */
function mockCsvBlob(text: string | Buffer): void {
  const buffer = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
  vi.spyOn(StorageService.prototype, 'downloadStream').mockImplementation(async () => ({
    stream: Readable.from([Buffer.from(buffer)]),
    contentLength: buffer.length,
  }));
}

describe('handleImportCsvJob', () => {
  let updateSpy: any;
  let personsSpy: any;
  let capturedRows: Record<string, string>[];
  let capturedSkipped: number | null;
  let capturedOptions: any;

  beforeEach(() => {
    capturedRows = [];
    capturedSkipped = null;
    capturedOptions = null;
    updateSpy = vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as any);
    personsSpy = vi
      .spyOn(PersonsService.prototype, 'processImportRows')
      .mockImplementation(async (_importId, _tenantId, _userId, _campaignId, _tags, skipped, rows, options) => {
        capturedSkipped = skipped;
        capturedOptions = options;
        for await (const row of rows) capturedRows.push(row);
        return {} as any;
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const statuses = (): unknown[] => updateSpy.mock.calls.map((c: any[]) => c[0].row.status).filter(Boolean);
  const updateRows = (): Array<Record<string, unknown>> => updateSpy.mock.calls.map((c: any[]) => c[0].row);

  it('parses the file, applies the index mapping and feeds validated rows to the persons processor', async () => {
    mockCsvBlob('First,Email,Ignored\n"Doe, Jane",jane@example.com,x\nBob,bob@example.com,y\n');

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    // Unmapped column dropped; mapped columns keyed by field; quoted comma intact.
    expect(capturedRows).toEqual([
      { first_name: 'Doe, Jane', email: 'jane@example.com' },
      { first_name: 'Bob', email: 'bob@example.com' },
    ]);
    expect(capturedSkipped).toBe(0);
    expect(capturedOptions).toMatchObject({ duplicateDecision: 'skip', clientSkipReasons: [] });
    // The counting pass wrote the real row count before any insert.
    expect(updateRows().some((row) => row['row_count'] === 2)).toBe(true);
    expect(statuses()[0]).toBe('processing');
    expect(statuses()[statuses().length - 1]).toBe('completed');
  });

  it('keeps a quoted field containing a newline as one row', async () => {
    mockCsvBlob('First,Email\n"multi\nline",a@example.com\n');

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(capturedRows).toEqual([{ first_name: 'multi\nline', email: 'a@example.com' }]);
    expect(updateRows().some((row) => row['row_count'] === 1)).toBe(true);
  });

  it('strips a UTF-8 BOM before the first header cell', async () => {
    mockCsvBlob(Buffer.from('﻿First,Email\nAda,ada@example.com\n', 'utf8'));

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(capturedRows).toEqual([{ first_name: 'Ada', email: 'ada@example.com' }]);
  });

  it('detects a semicolon-delimited file the way the browser preview does', async () => {
    mockCsvBlob('First;Email\nAda;ada@example.com\n');

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(capturedRows).toEqual([{ first_name: 'Ada', email: 'ada@example.com' }]);
  });

  it('turns an invalid row into a skip reason and a skipped count, and does not feed it onward', async () => {
    const longName = 'x'.repeat(150); // first_name is capped at 100 by the shared row schema
    mockCsvBlob(`First,Email\nAda,ada@example.com\n${longName},bad@example.com\n`);

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(capturedRows).toEqual([{ first_name: 'Ada', email: 'ada@example.com' }]);
    expect(capturedSkipped).toBe(1);
    // The reason rides the same clientSkipReasons machinery the wizard's client skips used —
    // and the invariant holds at this boundary: every counted pre-skip carries a reason.
    expect(capturedOptions.clientSkipReasons).toHaveLength(capturedSkipped ?? -1);
    expect(capturedOptions.clientSkipReasons[0]).toMatchObject({ row: 2, email: 'bad@example.com' });
    expect(String(capturedOptions.clientSkipReasons[0].reason)).toContain('first_name');
    // Both rows still count toward row_count — the file really had 2 data rows.
    expect(updateRows().some((row) => row['row_count'] === 2)).toBe(true);
  });

  it('merges validation skip reasons into data_imports for a non-persons source', async () => {
    const companiesSpy = vi
      .spyOn(CompaniesController.prototype, 'processImportRows')
      .mockImplementation(async (_importId, _tenantId, _userId, skipped, rows) => {
        capturedSkipped = skipped;
        for await (const row of rows) capturedRows.push(row);
        return {} as any;
      });
    // Row 2 maps to nothing (its only mapped cell is blank) → skipped with a reason.
    mockCsvBlob('Name,Notes\nAcme,ok\n,orphaned\n');

    await handleImportCsvJob(csvPayload({ source: 'companies', mapping: { '0': 'name' } }), makeScriptedDb());

    expect(companiesSpy).toHaveBeenCalledTimes(1);
    expect(capturedRows).toEqual([{ name: 'Acme' }]);
    expect(capturedSkipped).toBe(1);
    const skipWrite = updateRows().find((row) => typeof row['skip_reasons'] === 'string');
    expect(skipWrite).toBeDefined();
    const reasons = JSON.parse(String(skipWrite?.['skip_reasons']));
    // The invariant at this boundary: the reasons persisted for the non-persons source count
    // exactly the rows the processor was told were pre-skipped.
    expect(reasons).toHaveLength(capturedSkipped ?? -1);
    expect(reasons[0]).toMatchObject({ row: 2 });
    expect(personsSpy).not.toHaveBeenCalled();
  });

  it('routes households payloads with campaign and tags to the households processor', async () => {
    const args: unknown[] = [];
    vi.spyOn(HouseholdsController.prototype, 'processImportRows').mockImplementation(
      async (importId, tenantId, userId, campaignId, tags, skipped, rows) => {
        args.push(importId, tenantId, userId, campaignId, tags, skipped);
        for await (const row of rows) capturedRows.push(row);
        return {} as any;
      },
    );
    mockCsvBlob('Street,City\n1 Main St,Springfield\n');

    await handleImportCsvJob(
      csvPayload({ source: 'households', mapping: { '0': 'street1', '1': 'city' } }),
      makeScriptedDb(),
    );

    expect(args).toEqual(['11', '1', '2', '3', ['Imported-20260804'], 0]);
    expect(capturedRows).toEqual([{ street1: '1 Main St', city: 'Springfield' }]);
  });

  it('fails fast on an over-cap Free-plan file, naming the plan that raises the limit', async () => {
    const freeLimit = importRowLimitFor('free');
    const lines = Array.from({ length: freeLimit + 1 }, (_, i) => `row${i}`);
    mockCsvBlob(`First\n${lines.join('\n')}\n`);

    // No tenant row scripted → the plan read fails closed to Free (5,000).
    await handleImportCsvJob(csvPayload({ mapping: { '0': 'first_name' } }), makeScriptedDb());

    expect(personsSpy).not.toHaveBeenCalled();
    expect(updateRows().some((row) => row['row_count'] === freeLimit + 1)).toBe(true);
    const failure = updateRows().find((row) => row['status'] === 'failed');
    expect(failure).toBeDefined();
    // Plan-gate message convention: name the tenant's own limit AND the plan that lifts it.
    expect(String(failure?.['error_message'])).toMatch(/Free plan are limited to 5,000 rows per file/);
    expect(String(failure?.['error_message'])).toMatch(/Grassroots plan raises this to 100,000 rows per file/);
    expect(statuses()).not.toContain('completed');
  });

  it('admits a 20,000-row file on a paid plan (over the old flat 5,000 cap)', async () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `row${i}`);
    mockCsvBlob(`First\n${lines.join('\n')}\n`);

    await handleImportCsvJob(
      csvPayload({ mapping: { '0': 'first_name' } }),
      makeScriptedDb([undefined, { subscription_plan: 'grassroots' }]),
    );

    expect(updateRows().some((row) => row['row_count'] === 20_000)).toBe(true);
    expect(updateRows().every((row) => row['status'] !== 'failed')).toBe(true);
    expect(capturedRows).toHaveLength(20_000);
    expect(statuses()[statuses().length - 1]).toBe('completed');
  });

  it('blocks a paid-plan file over 100,000 rows with the split-the-file message', async () => {
    const paidLimit = importRowLimitFor('grassroots');
    const lines = Array.from({ length: paidLimit + 1 }, (_, i) => `row${i}`);
    mockCsvBlob(`First\n${lines.join('\n')}\n`);

    await handleImportCsvJob(
      csvPayload({ mapping: { '0': 'first_name' } }),
      makeScriptedDb([undefined, { subscription_plan: 'movement' }]),
    );

    expect(personsSpy).not.toHaveBeenCalled();
    const failure = updateRows().find((row) => row['status'] === 'failed');
    expect(failure).toBeDefined();
    expect(String(failure?.['error_message'])).toMatch(/limited to 100,000 rows per file/);
    // A paid tenant already has the top limit — no upgrade nudge, just the split guidance.
    expect(String(failure?.['error_message'])).not.toMatch(/plan raises/);
    expect(statuses()).not.toContain('completed');
  });

  it('marks the import failed with a plain message when the blob cannot be read', async () => {
    vi.spyOn(StorageService.prototype, 'downloadStream').mockImplementation(async () => ({
      stream: new Readable({
        read() {
          this.destroy(new Error('storage exploded'));
        },
      }),
      contentLength: null,
    }));

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(personsSpy).not.toHaveBeenCalled();
    const failure = updateRows().find((row) => row['status'] === 'failed');
    expect(String(failure?.['error_message'])).toMatch(/could not be read as a CSV/);
  });

  it('does nothing when the import already completed (re-delivered job)', async () => {
    const downloadSpy = vi.spyOn(StorageService.prototype, 'downloadStream');

    await handleImportCsvJob(csvPayload(), makeScriptedDb([{ status: 'completed' }]));

    expect(downloadSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(personsSpy).not.toHaveBeenCalled();
  });

  it('never deletes the source CSV (retention owns it)', async () => {
    const deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    mockCsvBlob('First,Email\nAda,ada@example.com\n');

    await handleImportCsvJob(csvPayload(), makeScriptedDb());

    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('resumes a crashed run: skips the counting pass and the already-committed rows, with a zero skip base', async () => {
    mockCsvBlob('First,Email\nAda,ada@example.com\nBob,bob@example.com\nCyd,cyd@example.com\n');
    const dlSpy = vi.spyOn(StorageService.prototype, 'downloadStream');

    // A crashed run left the import 'processing' with 2 of 3 rows durably consumed.
    await handleImportCsvJob(
      csvPayload(),
      makeScriptedDb([{ status: 'processing', processed_row_offset: 2, row_count: 3 }]),
    );

    // Only the un-consumed remainder is fed, numbered/counted from the persisted state.
    expect(capturedRows).toEqual([{ first_name: 'Cyd', email: 'cyd@example.com' }]);
    // Pass 1 skipped: the blob is streamed once, not twice, and row_count is not rewritten.
    expect(dlSpy).toHaveBeenCalledTimes(1);
    expect(updateRows().every((row) => row['row_count'] === undefined)).toBe(true);
    // The pre-skips and their reasons are already inside the persisted counters/skip_reasons.
    expect(capturedSkipped).toBe(0);
    expect(capturedOptions.clientSkipReasons).toBeUndefined();
    expect(statuses()[statuses().length - 1]).toBe('completed');
  });

  it('stops at the per-run row budget and enqueues a continuation job instead of completing', async () => {
    mockCsvBlob('First,Email\nAda,ada@example.com\nBob,bob@example.com\n');
    const db: any = makeScriptedDb();

    await handleImportCsvJob(csvPayload(), db, { rowsPerRun: 1 });

    // Only the budgeted row was fed; the rest belongs to the continuation run.
    expect(capturedRows).toEqual([{ first_name: 'Ada', email: 'ada@example.com' }]);
    // A fresh import_csv job with the same payload was enqueued...
    expect(db.insertInto).toHaveBeenCalledWith('background_jobs');
    const inserted = db.values.mock.calls[0][0];
    expect(JSON.parse(String(inserted.payload))).toMatchObject({ type: 'import_csv', import_id: '11' });
    // ...and the import was NOT marked completed (the continuation finishes it).
    expect(statuses()).not.toContain('completed');
  });

  it('completes without a continuation when the file ends exactly at the budget', async () => {
    mockCsvBlob('First,Email\nAda,ada@example.com\n');
    const db: any = makeScriptedDb();

    await handleImportCsvJob(csvPayload(), db, { rowsPerRun: 1 });

    expect(capturedRows).toHaveLength(1);
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(statuses()[statuses().length - 1]).toBe('completed');
  });
});

describe('handleImportCsvJob completion summary email', () => {
  let updateSpy: any;

  beforeEach(() => {
    updateSpy = vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as any);
    vi.spyOn(PersonsService.prototype, 'processImportRows').mockResolvedValue({} as any);
    mockCsvBlob('First,Email\nAda,ada@example.com\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The run-state read, the tenant-plan read, the user lookup, then the counts the email reports. */
  const scripted = (): Kysely<Models> =>
    makeScriptedDb([
      undefined,
      undefined,
      { email: 'importer@example.com', first_name: 'Ivy', profile_preferences: null },
      { inserted_count: 3, error_count: 0, skipped_count: 1 },
    ]);

  it('attributes the summary to the workspace so a bounce can be traced back to it', async () => {
    // Without a tenant_id the anti-abuse gate has nothing to check and Postmark cannot report a
    // bounce against a workspace, which is how abuse through this pipe stayed invisible before.
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await handleImportCsvJob(csvPayload(), scripted());

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0].tenant_id).toBe('1');
  });

  it('completes the import even when the gate withholds the summary email', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(
      new TransactionalSendBlockedError('Tenant 1 is suspended — transactional mail withheld.'),
    );

    await expect(handleImportCsvJob(csvPayload(), scripted())).resolves.toBeUndefined();
    const statuses = updateSpy.mock.calls.map((c: any[]) => c[0].row.status).filter(Boolean);
    expect(statuses[statuses.length - 1]).toBe('completed');
  });
});
