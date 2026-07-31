import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fail-open verification is unit-tested in import-verification.spec.ts; here it is
// stubbed so we can assert exactly which email projections the handler feeds it.
vi.mock('./import-verification', () => ({
  runImportEmailVerification: vi.fn(async () => null),
}));

import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { CompaniesController } from '../../../modules/companies/controller';
import { ImportsRepo } from '../../../modules/imports/repositories/imports.repo';
import { PersonsService } from '../../../modules/persons/services/persons.service';
import { serializeRowsToNdjson } from '../../ndjson';
import { StorageService } from '../../storage.service';
import { runImportEmailVerification } from './import-verification';
import { handleImportJob } from './import.handlers';

/** Chainable stand-in for the single authusers lookup the handler makes for the summary email. */
function makeFakeDb(): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where']) b[m] = vi.fn(() => b);
  b.executeTakeFirst = vi.fn(async () => undefined); // no user → no summary email
  return b as Kysely<Models>;
}

function personsPayload(overrides: Record<string, unknown> = {}): any {
  return {
    import_id: '11',
    storage_key: 'imports/payloads/1/11.json',
    tenant_id: '1',
    user_id: '2',
    skipped: 1,
    campaign_id: '3',
    tags: ['Imported-20260731'],
    file_name: 'contacts.csv',
    ...overrides,
  };
}

const ROWS: Record<string, string>[] = [
  { first_name: 'Ada', email: 'ada@example.com' },
  { first_name: 'Blank' }, // no email at all — excluded from verification input
  { first_name: 'Cleo', email: 'cleo@example.com', email2: 'cleo2@example.com' },
  { first_name: 'Dee', email2: 'dee-second@example.com' },
];

describe('handleImportJob payload formats', () => {
  let downloadSpy: any;
  let updateSpy: any;
  let capturedRows: Record<string, string>[];

  beforeEach(() => {
    capturedRows = [];
    updateSpy = vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as any);
    downloadSpy = vi.spyOn(StorageService.prototype, 'download');
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(PersonsService.prototype, 'processImportRows').mockImplementation(
      async (_importId, _tenantId, _userId, _campaignId, _tags, _skipped, rows) => {
        for await (const row of rows) capturedRows.push(row);
        return {} as any;
      },
    );
    vi.mocked(runImportEmailVerification).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams an NDJSON payload: identical rows, and email projections fed to verification', async () => {
    downloadSpy.mockResolvedValue(serializeRowsToNdjson(ROWS) as any);

    await handleImportJob(personsPayload(), makeFakeDb());

    expect(capturedRows).toEqual(ROWS);
    // Verification sees only the email columns of rows that had one — never the full rows.
    expect(vi.mocked(runImportEmailVerification)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runImportEmailVerification).mock.calls[0]?.[2]).toEqual([
      { email: 'ada@example.com', email2: undefined },
      { email: 'cleo@example.com', email2: 'cleo2@example.com' },
      { email: undefined, email2: 'dee-second@example.com' },
    ]);
    const statuses = updateSpy.mock.calls.map((c: any[]) => c[0].row.status);
    expect(statuses[0]).toBe('processing');
    expect(statuses[statuses.length - 1]).toBe('completed');
  });

  it('still imports a legacy JSON-array payload (jobs enqueued before the NDJSON switch)', async () => {
    downloadSpy.mockResolvedValue(Buffer.from(`  \n ${JSON.stringify(ROWS)}`, 'utf8') as any);

    await handleImportJob(personsPayload(), makeFakeDb());

    expect(capturedRows).toEqual(ROWS);
    expect(vi.mocked(runImportEmailVerification).mock.calls[0]?.[2]).toHaveLength(3);
    const statuses = updateSpy.mock.calls.map((c: any[]) => c[0].row.status);
    expect(statuses[statuses.length - 1]).toBe('completed');
  });

  it('routes both formats through the companies processor unchanged', async () => {
    const companyRows = [{ name: 'Acme' }, { name: 'Globex' }];
    const captured: Record<string, string>[] = [];
    vi.spyOn(CompaniesController.prototype, 'processImportRows').mockImplementation(
      async (_importId, _tenantId, _userId, _skipped, rows) => {
        for await (const row of rows) captured.push(row);
        return {} as any;
      },
    );

    downloadSpy.mockResolvedValue(serializeRowsToNdjson(companyRows) as any);
    await handleImportJob(personsPayload({ source: 'companies' }), makeFakeDb());
    expect(captured).toEqual(companyRows);

    captured.length = 0;
    downloadSpy.mockResolvedValue(Buffer.from(JSON.stringify(companyRows), 'utf8') as any);
    await handleImportJob(personsPayload({ source: 'companies' }), makeFakeDb());
    expect(captured).toEqual(companyRows);

    // Companies imports never run email verification.
    expect(vi.mocked(runImportEmailVerification)).not.toHaveBeenCalled();
  });
});
