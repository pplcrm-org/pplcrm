import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
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

function makeCsvFile(text: string, name = 'canvass-signups.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

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
  let queryParams: Record<string, string>;

  beforeEach(() => {
    queryParams = {};
    mockPersonsSvc = {
      checkDuplicateEmails: vi.fn().mockResolvedValue([]),
      import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }),
    };
    mockCompaniesSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockHouseholdsSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockTasksSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
    mockImportsSvc = {
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
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportWizard);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  /** Stub the private parseCsv (the shared uxcommon Worker isn't available in jsdom) then upload a file through the real handler. */
  async function uploadFile(text: string): Promise<void> {
    (component as any).parseCsv = vi.fn().mockResolvedValue(splitCsv(text));
    const file = makeCsvFile(text);
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    component['onFileSelected']({ target: input } as unknown as Event);
    await flushAsync();
  }

  async function uploadSampleFile(): Promise<void> {
    await uploadFile('First Name,Email\nAmira,amira@example.com\nDana,dana@example.com\n');
  }

  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('runs a people import, polls until completion, and reports the done state', async () => {
    await createComponent();
    await uploadSampleFile();
    component['step'].set('confirm');

    await component['runImport']();

    expect(mockPersonsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [
          { first_name: 'Amira', email: 'amira@example.com' },
          { first_name: 'Dana', email: 'dana@example.com' },
        ],
        duplicate_decision: 'merge',
      }),
    );
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

  it('runs a companies import, dropping rows without the required name', async () => {
    queryParams = { type: 'companies' };
    await createComponent();
    await uploadFile('Company Name,Website\nAcme,acme.com\n,orphan.com\n');

    await component['runImport']();

    expect(mockCompaniesSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ name: 'Acme', website: 'acme.com' })],
        skipped: 1,
      }),
    );
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
        rows: [expect.objectContaining({ street1: '12 Oak St', city: 'Springfield' })],
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
        rows: [expect.objectContaining({ name: 'Call printers', priority: 'high' })],
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
