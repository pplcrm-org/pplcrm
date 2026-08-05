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
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { TransactionalSendBlockedError } from '../../mail/transactional-send-guard';
import { runImportEmailVerification } from './import-verification';
import { handleImportJob } from './import.handlers';

/** Chainable stand-in for the single authusers lookup the handler makes for the summary email. */
function makeFakeDb(): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where']) b[m] = vi.fn(() => b);
  b.executeTakeFirst = vi.fn(async () => undefined); // no user → no summary email
  return b as Kysely<Models>;
}

/** Like makeFakeDb, but the first read (the run-state guard) answers with the given row. */
function makeFakeDbWithState(state: Record<string, unknown>): Kysely<Models> {
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where']) b[m] = vi.fn(() => b);
  let call = 0;
  b.executeTakeFirst = vi.fn(async () => (call++ === 0 ? state : undefined));
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

  it('resumes a crashed run at the persisted offset: skips consumed rows, zero skip base, no re-sent client reasons', async () => {
    downloadSpy.mockResolvedValue(serializeRowsToNdjson(ROWS) as any);
    const processSpy = vi.mocked(PersonsService.prototype.processImportRows);

    await handleImportJob(
      personsPayload({ skipped: 1, client_skip_reasons: [{ row: 1, reason: 'client skip' }] }),
      // A crashed run left the import 'processing' with 2 rows durably consumed.
      makeFakeDbWithState({ status: 'processing', processed_row_offset: 2 }),
    );

    expect(capturedRows).toEqual(ROWS.slice(2));
    const [, , , , , skippedBase, , options] = processSpy.mock.calls[0] ?? [];
    // The client-side skips and their reasons are already inside the persisted counters.
    expect(skippedBase).toBe(0);
    expect(options?.clientSkipReasons).toBeUndefined();
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

/**
 * Chainable stand-in that answers each `executeTakeFirst()` from a queue, so a test can script
 * the handler's three single-row reads in order: the already-completed guard, the user lookup for
 * the summary email, and the row counts that email reports.
 */
function makeScriptedDb(results: unknown[]): Kysely<Models> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled query-builder stub
  const b: any = {};
  for (const m of ['selectFrom', 'leftJoin', 'select', 'where']) b[m] = vi.fn(() => b);
  let call = 0;
  b.executeTakeFirst = vi.fn(async () => results[call++]);
  return b as Kysely<Models>;
}

describe('handleImportJob completion summary email', () => {
  beforeEach(() => {
    vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as never);
    vi.spyOn(StorageService.prototype, 'download').mockResolvedValue(serializeRowsToNdjson(ROWS) as never);
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(PersonsService.prototype, 'processImportRows').mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The guard read, then the user lookup, then the import's row counts. */
  const scripted = () =>
    makeScriptedDb([
      { status: 'processing' },
      { email: 'importer@example.com', first_name: 'Ivy', profile_preferences: null },
      { inserted_count: 3, error_count: 0, skipped_count: 1 },
    ]);

  it('attributes the summary to the workspace so a bounce can be traced back to it', async () => {
    // Without a tenant_id the anti-abuse gate has nothing to check and Postmark cannot report a
    // bounce against a workspace, which is how abuse through this pipe stayed invisible before.
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await handleImportJob(personsPayload(), scripted());

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0].tenant_id).toBe('1');
  });

  it('completes the import even when the gate withholds the summary email', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(
      new TransactionalSendBlockedError('Tenant 1 is suspended — transactional mail withheld.'),
    );

    await expect(handleImportJob(personsPayload(), scripted())).resolves.toBeUndefined();
  });
});

/**
 * Re-importing rows is the one failure in this job with a lasting cost: only the persons importer
 * dedupes (its default `duplicate_decision: 'skip'`), so a second run of a companies, households
 * or tasks import writes every row again. The job can still be re-run after the rows land — a
 * worker crash or an execution timeout hands it back to stale-job recovery.
 */
describe('handleImportJob re-run protection', () => {
  let processImportRows: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(ImportsRepo.prototype, 'update').mockResolvedValue({} as never);
    vi.spyOn(StorageService.prototype, 'download').mockResolvedValue(serializeRowsToNdjson(ROWS) as never);
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);
    processImportRows = vi.fn().mockResolvedValue({});
    vi.spyOn(PersonsService.prototype, 'processImportRows').mockImplementation(processImportRows as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes no rows when the import it was given already finished', async () => {
    await handleImportJob(personsPayload(), makeScriptedDb([{ status: 'completed' }]));

    expect(processImportRows).not.toHaveBeenCalled();
  });

  it('still imports when the previous attempt did not finish', async () => {
    await handleImportJob(personsPayload(), makeScriptedDb([{ status: 'processing' }, undefined, undefined]));

    expect(processImportRows).toHaveBeenCalledTimes(1);
  });
});
