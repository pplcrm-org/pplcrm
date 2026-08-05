import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fail-open verification is unit-tested in import-verification.spec.ts; stubbed here so the
// csv-path tests never resolve DNS.
vi.mock('./import-verification', () => ({
  runImportEmailVerification: vi.fn(async () => null),
}));

import type { Kysely } from 'kysely';
import { MAX_IMPORT_ROWS } from '../../../../../../../libs/common/src';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { CompaniesController } from '../../../modules/companies/controller';
import { HouseholdsController } from '../../../modules/households/controller';
import { ImportsRepo } from '../../../modules/imports/repositories/imports.repo';
import { PersonsService } from '../../../modules/persons/services/persons.service';
import { StorageService } from '../../storage.service';
import { handleImportCsvJob } from './import.handlers';

/**
 * Chainable stand-in that answers each `executeTakeFirst()` from a queue: the completed-status
 * guard first, then (depending on the test) the skip-reason merge read and the summary-email
 * user lookup. `undefined` everywhere means "not completed, no stored reasons, no user" — the
 * handler proceeds and simply sends no email.
 */
function makeScriptedDb(results: unknown[] = []): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where']) b[m] = vi.fn(() => b);
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
    // The reason rides the same clientSkipReasons machinery the wizard's client skips used.
    expect(capturedOptions.clientSkipReasons).toHaveLength(1);
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
    expect(reasons).toHaveLength(1);
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

  it('fails fast on an over-cap file: row_count written, status failed, zero rows fed', async () => {
    const lines = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `row${i}`);
    mockCsvBlob(`First\n${lines.join('\n')}\n`);

    await handleImportCsvJob(csvPayload({ mapping: { '0': 'first_name' } }), makeScriptedDb());

    expect(personsSpy).not.toHaveBeenCalled();
    expect(updateRows().some((row) => row['row_count'] === MAX_IMPORT_ROWS + 1)).toBe(true);
    const failure = updateRows().find((row) => row['status'] === 'failed');
    expect(failure).toBeDefined();
    expect(String(failure?.['error_message'])).toMatch(/limited to 5,000 rows/);
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
});
