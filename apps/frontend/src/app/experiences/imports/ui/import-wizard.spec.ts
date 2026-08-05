import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signal } from '@angular/core';

import { MAX_IMPORT_FILE_BYTES, importRowLimitFor } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AuthService } from '../../../auth/auth-service';
import { ImportWizard } from './import-wizard';
import { ImportsService } from '../services/imports-service';
import { CompaniesService } from '../../companies/services/companies-service';
import { HouseholdsService } from '../../households/services/households-service';
import { ListsService } from '../../lists/services/lists-service';
import { PersonsService } from '../../persons/services/persons-service';
import { TasksService } from '../../tasks/services/tasks-service';

/** Minimal CSV splitter mirroring libs/uxcommon's csv.worker.ts header/row shape, used to stub `parseCsv`. */
function splitCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const [headerLine, ...dataLines] = text.trim().split('\n');
  const headers = headerLine.split(',');
  const rows = dataLines
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const cells = line.split(',');
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = cells[i] ?? ''));
      return row;
    });
  return { headers, rows };
}

/** A CSV File whose reported byte size can be forced, to steer the wizard's parse-mode decision. */
function makeCsvFile(text: string, name = 'canvass-signups.csv', sizeBytes?: number): File {
  const file = new File([text], name, { type: 'text/csv' });
  if (sizeBytes !== undefined) {
    Object.defineProperty(file, 'size', { value: sizeBytes });
  }
  return file;
}

/** Just over the wizard's 2 MiB full-parse threshold, so the file lands in preview mode. */
const PREVIEW_MODE_SIZE = 3 * 1024 * 1024;

describe('ImportWizard', () => {
  let component: ImportWizard;
  let fixture: ComponentFixture<ImportWizard>;
  let mockPersonsSvc: any;
  let mockCompaniesSvc: any;
  let mockHouseholdsSvc: any;
  let mockTasksSvc: any;
  let mockImportsSvc: any;
  let mockListsSvc: any;
  let mockAlertSvc: any;
  let mockRouter: any;
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryParams: Record<string, string>;
  /** The signed-in user the wizard reads `tenant_plan` from — per-plan row limit mirror. */
  let userSignal: ReturnType<typeof signal<{ tenant_plan?: string } | null>>;
  let mockAuthSvc: any;

  beforeEach(() => {
    queryParams = {};
    userSignal = signal<{ tenant_plan?: string } | null>({ tenant_plan: 'free' });
    mockAuthSvc = { getUserSignal: vi.fn(() => userSignal) };
    mockPersonsSvc = {
      checkDuplicateEmails: vi.fn().mockResolvedValue([]),
      import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }),
    };
    mockCompaniesSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockHouseholdsSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockTasksSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockImportsSvc = {
      getUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: 'https://blob.example/sas', uploadHandle: 'handle-1' }),
      list: vi.fn().mockResolvedValue([
        {
          id: 'imp-1',
          status: 'completed',
          insertedCount: 2,
          mergedCount: 0,
          skippedCount: 0,
          errorCount: 0,
          tagName: 'Imported-20260101-0000',
          errorMessage: null,
        },
      ]),
    };
    mockListsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }),
    };
    mockAlertSvc = { showError: vi.fn(), showSuccess: vi.fn() };
    mockRouter = { navigate: vi.fn().mockResolvedValue(true) };
    // The SAS PUT goes through fetch, never through tRPC — stub it globally.
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
  });

  async function createComponent(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ImportWizard],
      providers: [
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: CompaniesService, useValue: mockCompaniesSvc },
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        { provide: TasksService, useValue: mockTasksSvc },
        { provide: ImportsService, useValue: mockImportsSvc },
        { provide: ListsService, useValue: mockListsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportWizard);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    fixture?.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Stub the private parseCsv (the shared uxcommon Worker isn't available in jsdom) then upload a file through the real handler. */
  async function uploadFile(text: string, sizeBytes?: number): Promise<void> {
    (component as any).parseCsv = vi.fn().mockResolvedValue(splitCsv(text));
    const file = makeCsvFile(text, 'canvass-signups.csv', sizeBytes);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    component['onFileSelected']({ target: input } as unknown as Event);
    await flushAsync();
  }

  async function uploadSampleFile(sizeBytes?: number): Promise<void> {
    await uploadFile('First Name,Email\nAmira,amira@example.com\nDana,dana@example.com\n', sizeBytes);
  }

  async function flushAsync(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it('starts on the upload step importing people by default', async () => {
    await createComponent();
    expect(component['step']()).toBe('upload');
    expect(component['rowCount']()).toBe(0);
    expect(component['entity']()).toBe('people');
  });

  it('preselects the record type from the ?type= query param', async () => {
    queryParams = { type: 'companies' };
    await createComponent();
    expect(component['entity']()).toBe('companies');
  });

  it('falls back to people for an unknown ?type= value', async () => {
    queryParams = { type: 'donuts' };
    await createComponent();
    expect(component['entity']()).toBe('people');
  });

  it('parses an uploaded CSV into headers/rows and auto-maps recognizable columns', async () => {
    await createComponent();
    await uploadSampleFile();

    expect(component['headers']()).toEqual(['First Name', 'Email']);
    expect(component['rowCount']()).toBe(2);
    expect(component['mapping']()).toEqual(['first_name', 'email']);
    expect(component['previewMode']()).toBe(false);
  });

  it('rejects a file over the 50 MB limit at step 1 with a plain error and no state change', async () => {
    await createComponent();
    await uploadSampleFile(MAX_IMPORT_FILE_BYTES + 1);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(expect.stringContaining('50 MB'));
    expect(component['fileName']()).toBeNull();
    expect(component['rowCount']()).toBe(0);
  });

  /** Upload a stubbed-parse file with exactly `rowCount` data rows through the real handler. */
  async function uploadParsedRows(rowCount: number): Promise<void> {
    const rows = Array.from({ length: rowCount }, (_, i) => ({ 'First Name': `P${i}`, Email: '' }));
    (component as any).parseCsv = vi.fn().mockResolvedValue({ headers: ['First Name', 'Email'], rows });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [makeCsvFile('First Name,Email\n')] });
    component['onFileSelected']({ target: input } as unknown as Event);
    await flushAsync();
  }

  it('rejects a Free-plan file over 5,000 rows, naming the limit and the plan that raises it', async () => {
    await createComponent();
    await uploadParsedRows(importRowLimitFor('free') + 1);

    const message = String(mockAlertSvc.showError.mock.calls[0]?.[0]);
    expect(message).toContain('5,000');
    expect(message).toContain('Free');
    expect(message).toContain('Grassroots');
    expect(message).toContain('100,000');
    expect(component['fileName']()).toBeNull();
    expect(component['rowCount']()).toBe(0);
  });

  it('admits the same over-5,000-row file on a paid plan (the limit is the tenant plan, not 5,000)', async () => {
    userSignal.set({ tenant_plan: 'grassroots' });
    await createComponent();
    await uploadParsedRows(importRowLimitFor('free') + 1);

    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    expect(component['rowCount']()).toBe(importRowLimitFor('free') + 1);
    expect(component['maxRows']()).toBe(importRowLimitFor('grassroots'));
  });

  it('rejects a paid-plan file over 100,000 rows with the split-the-file message, no upgrade nudge', async () => {
    userSignal.set({ tenant_plan: 'movement' });
    await createComponent();
    await uploadParsedRows(importRowLimitFor('movement') + 1);

    const message = String(mockAlertSvc.showError.mock.calls[0]?.[0]);
    expect(message).toContain('100,000');
    expect(message).not.toContain('raises');
    expect(component['fileName']()).toBeNull();
  });

  it('shows the address-locating note only for address-mapped people/household imports on a geocoding plan', async () => {
    userSignal.set({ tenant_plan: 'movement' });
    await createComponent();
    await uploadFile('First Name,Street\nAmira,12 Main St\n');

    expect(component['mapping']()).toContain('street1');
    expect(component['showGeocodePacingNote']()).toBe(true);

    // Below Movement the note is absent — those imports skip geocoding by design.
    userSignal.set({ tenant_plan: 'grassroots' });
    expect(component['showGeocodePacingNote']()).toBe(false);

    // No address column mapped → nothing to locate → no note.
    userSignal.set({ tenant_plan: 'movement' });
    await uploadSampleFile();
    expect(component['showGeocodePacingNote']()).toBe(false);
  });

  it('switches to preview mode for a large file, keeping at most the head rows', async () => {
    await createComponent();
    await uploadSampleFile(PREVIEW_MODE_SIZE);

    expect(component['previewMode']()).toBe(true);
    expect(component['headers']()).toEqual(['First Name', 'Email']);
    expect(component['rowCount']()).toBe(2);
    expect(component['mapping']()).toEqual(['first_name', 'email']);
  });

  it('re-maps the parsed headers when the record type changes', async () => {
    await createComponent();
    await uploadFile('Name,Phone\nAcme,555-1234\n');
    expect(component['mapping']()).toEqual(['first_name', 'mobile']);

    component['setEntity']('companies');

    expect(component['entity']()).toBe('companies');
    expect(component['mapping']()).toEqual(['name', 'phone']);
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { type: 'companies' } }),
    );
  });

  it('computes mapped rows using only the mapped, non-blank fields', async () => {
    await createComponent();
    await uploadSampleFile();

    expect(component['mappedRows']()).toEqual([
      { first_name: 'Amira', email: 'amira@example.com' },
      { first_name: 'Dana', email: 'dana@example.com' },
    ]);
  });

  it('flags malformed emails as bad-email rows for the Review step', async () => {
    await createComponent();
    await uploadFile('First Name,Email\nAmira,amira@example.com\nBad,not-an-email\n');

    expect(component['badEmailRows']().map((r) => r.email)).toEqual(['not-an-email']);
    expect(component['validEmailRows']().map((r) => r.email)).toEqual(['amira@example.com']);
  });

  it('blocks Continue to review until a required field is mapped', async () => {
    queryParams = { type: 'companies' };
    await createComponent();
    await uploadFile('Website,Phone\nacme.com,555-1234\n');

    expect(component['mapping']()).toEqual(['website', 'phone']);
    expect(component['missingRequiredFields']()).toEqual(['name']);
    expect(component['canContinueToReview']()).toBe(false);

    component['setMapping'](0, 'name');
    expect(component['canContinueToReview']()).toBe(true);
  });

  it('runs the duplicate pre-check on Review in full-parse mode', async () => {
    await createComponent();
    await uploadSampleFile();

    await component['goToReview']();

    expect(mockPersonsSvc.checkDuplicateEmails).toHaveBeenCalledWith(['amira@example.com', 'dana@example.com']);
  });

  it('skips the duplicate pre-check in preview mode and shows the not-checked notice', async () => {
    await createComponent();
    await uploadSampleFile(PREVIEW_MODE_SIZE);

    await component['goToReview']();

    expect(mockPersonsSvc.checkDuplicateEmails).not.toHaveBeenCalled();
    expect(component['duplicateMatches']()).toEqual([]);

    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('not checked for duplicates ahead of time');
    expect(text).toContain('counted while the import runs');
  });

  it('resets all wizard state and returns to the upload step on "Import another file"', async () => {
    await createComponent();
    await uploadSampleFile();
    component['step'].set('confirm');
    component['tagsText'].set('donor');

    component['startOver']();

    expect(component['step']()).toBe('upload');
    expect(component['rowCount']()).toBe(0);
    expect(component['tagsText']()).toBe('');
  });

  it('uploads the original file then runs a people import with the upload handle and index-keyed mapping', async () => {
    await createComponent();
    await uploadSampleFile();
    component['step'].set('confirm');

    await component['runImport']();

    expect(mockImportsSvc.getUploadUrl).toHaveBeenCalledWith('canvass-signups.csv', 'text/csv');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://blob.example/sas',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'x-ms-blob-type': 'BlockBlob' }),
      }),
    );
    expect(mockPersonsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_handle: 'handle-1',
        mapping: { '0': 'first_name', '1': 'email' },
        duplicate_decision: 'merge',
      }),
    );
    const payload = mockPersonsSvc.import.mock.calls[0][0];
    expect(payload).not.toHaveProperty('rows');
    expect(payload).not.toHaveProperty('source_csv');
    expect(payload).not.toHaveProperty('client_skip_reasons');
    expect(mockImportsSvc.list).toHaveBeenCalled();
    expect(component['run']()).toEqual({
      status: 'done',
      inserted: 2,
      merged: 0,
      skipped: 0,
      errors: 0,
      tag: 'Imported-20260101-0000',
      importId: 'imp-1',
    });
  });

  it('hands off to the imports page instead of polling when a preview-mode import starts', async () => {
    await createComponent();
    await uploadSampleFile(PREVIEW_MODE_SIZE);
    component['step'].set('confirm');

    await component['runImport']();

    expect(mockPersonsSvc.import).toHaveBeenCalledWith(expect.objectContaining({ upload_handle: 'handle-1' }));
    // No inline wait: the wizard never reads the import back, it points at the history page.
    expect(mockImportsSvc.list).not.toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(expect.stringContaining('imports page'));
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/imports']);
  });

  it('keeps the inline wait-and-complete flow for a small fully-parsed file', async () => {
    await createComponent();
    await uploadSampleFile();
    component['step'].set('confirm');

    await component['runImport']();

    expect(mockImportsSvc.list).toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalledWith(['/imports']);
    expect(component['run']()).toEqual(expect.objectContaining({ status: 'done' }));
  });

  it('cuts the preview slice at a record boundary, never inside an open quoted field', async () => {
    await createComponent();
    const HEAD_BYTES = 512 * 1024; // the wizard's PREVIEW_HEAD_BYTES
    const header = 'name,notes\n';
    const filler = 'p,ok\n';
    const fillerCount = Math.floor((HEAD_BYTES - 20 - header.length) / filler.length);
    // The quoted field opens just before the 512 KiB boundary and closes after it, with a
    // line break inside the quotes on the near side of the boundary. A quote-blind cut at
    // the last newline would slice the record mid-field into garbage.
    const straddler = 'Bad,"first line\nsecond line of a quoted note that runs far past the preview boundary"\n';
    const text = header + filler.repeat(fillerCount) + straddler + 'after,row\n';
    const file = makeCsvFile(text);

    const preview: string = await (component as any).readPreviewText(file);

    expect(preview.endsWith('p,ok')).toBe(true); // last complete record survives
    expect(preview).not.toContain('Bad'); // the straddling record is dropped whole
    expect((preview.match(/"/g) ?? []).length % 2).toBe(0); // no quote left open
  });

  it('emits only mapped columns in the mapping payload', async () => {
    await createComponent();
    await uploadFile('First Name,Mystery,Email\nAmira,x,amira@example.com\n');
    component['setMapping'](1, ''); // ensure the unrecognized column stays unmapped

    await component['runImport']();

    expect(mockPersonsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({ mapping: { '0': 'first_name', '2': 'email' } }),
    );
  });

  it('surfaces an upload failure as an error and never calls the import mutation', async () => {
    await createComponent();
    await uploadSampleFile();
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await component['runImport']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith(expect.stringContaining('status 403'));
    expect(mockPersonsSvc.import).not.toHaveBeenCalled();
    expect(component['run']()).toEqual(
      expect.objectContaining({ status: 'error', message: expect.stringContaining('status 403') }),
    );
  });

  it('runs a companies import with the upload handle and mapping', async () => {
    queryParams = { type: 'companies' };
    await createComponent();
    await uploadFile('Company Name,Website\nAcme,acme.com\n,orphan.com\n');

    await component['runImport']();

    expect(mockCompaniesSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_handle: 'handle-1',
        mapping: { '0': 'name', '1': 'website' },
        file_name: 'canvass-signups.csv',
      }),
    );
    expect(mockCompaniesSvc.import.mock.calls[0][0]).not.toHaveProperty('rows');
    expect(component['run']()).toEqual(expect.objectContaining({ status: 'done' }));
  });

  it('runs a households import with the batch tags', async () => {
    queryParams = { type: 'households' };
    await createComponent();
    await uploadFile('Address,City\n12 Oak St,Springfield\n');
    component['tagsText'].set('yard-sign, canvass');

    await component['runImport']();

    expect(mockHouseholdsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_handle: 'handle-1',
        mapping: { '0': 'street1', '1': 'city' },
        tags: ['yard-sign', 'canvass'],
      }),
    );
  });

  it('runs a tasks import through the tasks service', async () => {
    queryParams = { type: 'tasks' };
    await createComponent();
    await uploadFile('Task,Priority\nCall printers,high\n');

    await component['runImport']();

    expect(mockTasksSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_handle: 'handle-1',
        mapping: { '0': 'name', '1': 'priority' },
      }),
    );
  });

  it('reports an error state when the import mutation rejects', async () => {
    await createComponent();
    await uploadSampleFile();
    mockPersonsSvc.import.mockRejectedValue(new Error('Server exploded'));

    await component['runImport']();

    expect(component['run']()).toEqual({ status: 'error', message: 'Server exploded' });
  });

  it('navigates to the imported records and to the import history page from the done actions', async () => {
    await createComponent();
    component['viewImported']();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/people']);

    component['backToHistory']();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/imports']);
  });
});
