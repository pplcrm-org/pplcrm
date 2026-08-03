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

/**
 * A purchased voter file's district columns have to reach the server. The people branch of the
 * wizard sends each mapped row to the server as it is, so it carries them for free; the households
 * branch rebuilds each row field by field, and anything not named there never leaves the browser.
 * That is how these columns were lost before, so both branches are checked here.
 */

/** Minimal CSV splitter mirroring the shared csv worker's header/row shape, used to stub `parseCsv`. */
function splitCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const [headerLine, ...dataLines] = text.trim().split('\n');
  const headers = (headerLine ?? '').split(',');
  const rows = dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line.split(',');
      const row: Record<string, string> = {};
      headers.forEach((header, index) => (row[header] = cells[index] ?? ''));
      return row;
    });
  return { headers, rows };
}

const VOTER_FILE_HEADERS = 'Address,City,CD,Legislative District,State House District,Precinct,Ward';
const VOTER_FILE_ROW = '12 Oak St,Springfield,OH-3,18,21,Precinct 12,Ward 5';

/** The district values the row above should arrive at the server carrying. */
const EXPECTED_DISTRICTS = {
  congressional_district: 'OH-3',
  legislative_district: '18',
  state_house_district: '21',
  precinct: 'Precinct 12',
  ward: 'Ward 5',
};

describe('ImportWizard sends a voter file’s district columns', () => {
  let component: ImportWizard;

  /**
   * The protected members this spec drives directly. The wizard exposes no public seam for
   * "upload this file, then import it", so the spec reaches the same members the template does.
   * Declared as a named shape rather than `any` so a rename in the component breaks this file at
   * compile time instead of at runtime — which is the whole reason `any` is banned here.
   */
  interface ImportWizardInternals {
    parseCsv: (file: File) => Promise<ReturnType<typeof splitCsv>>;
    onFileSelected: (event: Event) => void;
    runImport: () => Promise<void>;
    mappedRows: () => Record<string, string>[];
  }

  const internals = (): ImportWizardInternals => component as unknown as ImportWizardInternals;
  let fixture: ComponentFixture<ImportWizard>;
  let mockPersonsSvc: { checkDuplicateEmails: unknown; import: ReturnType<typeof vi.fn> };
  let mockHouseholdsSvc: { import: ReturnType<typeof vi.fn> };
  let queryParams: Record<string, string>;

  beforeEach(() => {
    queryParams = {};
    mockPersonsSvc = {
      checkDuplicateEmails: vi.fn().mockResolvedValue([]),
      import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }),
    };
    mockHouseholdsSvc = { import: vi.fn().mockResolvedValue({ import_id: 'imp-1', status: 'pending' }) };
  });

  async function createComponent(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ImportWizard],
      providers: [
        { provide: PersonsService, useValue: mockPersonsSvc },
        { provide: CompaniesService, useValue: { import: vi.fn() } },
        { provide: HouseholdsService, useValue: mockHouseholdsSvc },
        { provide: TasksService, useValue: { import: vi.fn() } },
        { provide: ImportsService, useValue: { list: vi.fn().mockResolvedValue([]) } },
        { provide: ListsService, useValue: { getAll: vi.fn().mockResolvedValue({ rows: [], count: 0 }) } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
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

  async function flushAsync(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** Stub the private parseCsv (the shared worker is unavailable in jsdom) and upload through the real handler. */
  async function uploadFile(text: string): Promise<void> {
    internals().parseCsv = vi.fn().mockResolvedValue(splitCsv(text));
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [new File([text], 'voterfile.csv', { type: 'text/csv' })] });
    internals().onFileSelected({ target: input } as unknown as Event);
    await flushAsync();
  }

  async function runVoterFileImport(type: 'people' | 'households'): Promise<void> {
    queryParams = { type };
    await createComponent();
    await uploadFile(`${VOTER_FILE_HEADERS}\n${VOTER_FILE_ROW}\n`);
    await internals().runImport();
  }

  it('auto-maps a voter file’s district headers on the People importer', async () => {
    queryParams = { type: 'people' };
    await createComponent();
    await uploadFile(`${VOTER_FILE_HEADERS}\n${VOTER_FILE_ROW}\n`);
    const mapped = internals().mappedRows()[0];
    expect(mapped).toMatchObject(EXPECTED_DISTRICTS);
  });

  it('sends the district columns to the People import endpoint', async () => {
    await runVoterFileImport('people');

    expect(mockPersonsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [expect.objectContaining(EXPECTED_DISTRICTS)] }),
    );
  });

  it('sends the district columns to the Households import endpoint', async () => {
    await runVoterFileImport('households');

    expect(mockHouseholdsSvc.import).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ street1: '12 Oak St', city: 'Springfield', ...EXPECTED_DISTRICTS })],
      }),
    );
  });

  it('sends no district keys at all for a file that has none', async () => {
    queryParams = { type: 'households' };
    await createComponent();
    await uploadFile('Address,City\n12 Oak St,Springfield\n');
    await internals().runImport();

    const sentRow = mockHouseholdsSvc.import.mock.calls[0]?.[0]?.rows?.[0] ?? {};
    expect(Object.keys(sentRow)).not.toContain('ward');
    expect(Object.keys(sentRow)).not.toContain('precinct');
  });
});
