import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { ImportsPage } from './imports-page';
import { ImportsService } from '../services/imports-service';
import { ExportsService } from '../../exports/services/exports-service';
import { TokenService } from '../../../services/api/token-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import * as httpDownload from '../../../services/api/http-download';

vi.mock('../../../services/api/http-download', () => ({
  downloadWithAuthHeader: vi.fn(),
}));

const baseItem = {
  id: '1',
  fileName: 'contacts.csv',
  source: 'csv',
  tagName: 'Import 2026',
  tagMissing: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  processedAt: new Date('2026-01-01T00:05:00Z'),
  createdBy: { id: 'u1', name: 'Admin', email: 'admin@example.com' },
  insertedCount: 10,
  errorCount: 0,
  skippedCount: 0,
  mergedCount: 0,
  tagsApplied: ['Imported-20260101-0000'],
  rowCount: 10,
  householdsCreated: 3,
  contactCount: 10,
  householdCount: 3,
  companyCount: 0,
  taskCount: 0,
  donationCount: 0,
  issuedReceiptCount: 0,
  eventRegistrationCount: 0,
  campaignSubscriptionCount: 0,
  status: 'completed' as const,
  errorMessage: null,
  canDeleteContacts: true,
  sourceFileSize: 2048,
  canDownloadSource: true,
  canDownloadSkipped: false,
};

const baseExportJob = {
  id: 'job-1',
  entity: 'people',
  file_name: 'people-export.csv',
  status: 'completed' as const,
  row_count: 42,
  error: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  downloadable: true,
  ownedByOther: false,
  createdBy: { name: 'Admin', email: 'admin@example.com' },
};

describe('ImportsPage', () => {
  let component: ImportsPage;
  let fixture: ComponentFixture<ImportsPage>;
  let mockImportsSvc: any;
  let mockExportsSvc: any;
  let mockAlertSvc: any;
  let mockTokenSvc: any;
  let mockDialogSvc: any;
  let mockRouter: any;

  beforeEach(async () => {
    vi.mocked(httpDownload.downloadWithAuthHeader).mockReset().mockResolvedValue(undefined);
    mockImportsSvc = {
      list: vi.fn().mockResolvedValue([baseItem]),
      delete: vi.fn().mockResolvedValue(true),
      abort: vi.fn(),
    };
    mockExportsSvc = {
      list: vi.fn().mockResolvedValue([baseExportJob]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    };
    mockTokenSvc = {
      getAuthToken: vi.fn().mockReturnValue('token-123'),
    };
    mockDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    mockRouter = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ImportsPage],
      providers: [
        { provide: ImportsService, useValue: mockImportsSvc },
        { provide: ExportsService, useValue: mockExportsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: TokenService, useValue: mockTokenSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('should load imports on creation and expose the item count', async () => {
    await fixture.whenStable();

    expect(mockImportsSvc.list).toHaveBeenCalled();
    expect(component['items']()).toEqual([baseItem]);
    expect(component['itemCount']()).toBe(1);
    expect(component['error']()).toBeNull();
  });

  it('should set an error and show an alert when loading fails with a plain Error', async () => {
    fixture.destroy();
    mockImportsSvc.list.mockRejectedValue(new Error('Network down'));

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();

    expect(component['error']()).toBe('Network down');
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Network down');
  });

  it('should extract a tRPC error message when loading fails without a plain Error', async () => {
    fixture.destroy();
    mockImportsSvc.list.mockRejectedValue({ data: { message: 'Server exploded' } });

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();

    expect(component['error']()).toBe('Server exploded');
  });

  it('should format a date value using the locale date/time style', async () => {
    await fixture.whenStable();

    const formatted = component['formatDate'](new Date('2026-01-01T00:05:00Z'));
    expect(formatted).toEqual(expect.any(String));
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('should compute the this-year summary sentence counts', async () => {
    await fixture.whenStable();

    expect(component['importsThisYear']()).toBe(
      baseItem.processedAt.getFullYear() === new Date().getFullYear() ? 1 : 0,
    );
  });

  it('should open the delete dialog and populate pendingDelete', async () => {
    await fixture.whenStable();
    const dialog = { show: vi.fn(), close: vi.fn() } as unknown as ModalShell;

    component['openDeleteDialog'](baseItem, dialog);

    expect(component['pendingDelete']()).toEqual(baseItem);
    expect(dialog.show).toHaveBeenCalled();
  });

  it('should reset checkbox selections when the delete dialog is closed', async () => {
    await fixture.whenStable();
    const dialog = { show: vi.fn(), close: vi.fn() } as unknown as ModalShell;

    component['openDeleteDialog'](baseItem, dialog);
    component['deletePeople'].set(true);
    component['deleteHouseholds'].set(true);

    component['closeDeleteDialog'](dialog);
    // The reset lives in an effect() watching pendingDelete(), which flushes
    // on the next change detection rather than synchronously.
    fixture.detectChanges();

    expect(dialog.close).toHaveBeenCalled();
    expect(component['pendingDelete']()).toBeNull();
    expect(component['deletePeople']()).toBe(false);
    expect(component['deleteHouseholds']()).toBe(false);
  });

  it('should delete the pending import with selected options and reload the list', async () => {
    await fixture.whenStable();
    const dialog = { show: vi.fn(), close: vi.fn() } as unknown as ModalShell;
    component['openDeleteDialog'](baseItem, dialog);
    component['deletePeople'].set(true);
    component['deleteTasks'].set(true);
    mockImportsSvc.list.mockClear();
    mockImportsSvc.list.mockResolvedValue([]);

    await component['confirmDelete'](dialog);

    expect(mockImportsSvc.delete).toHaveBeenCalledWith('1', {
      deletePeople: true,
      deleteHouseholds: false,
      deleteCompanies: false,
      deleteTasks: true,
    });
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Import deleted');
    expect(mockImportsSvc.list).toHaveBeenCalled();
    expect(dialog.close).toHaveBeenCalled();
    expect(component['deleting']()).toBe(false);
  });

  it('should show an error alert and keep the dialog open when delete fails', async () => {
    await fixture.whenStable();
    const dialog = { show: vi.fn(), close: vi.fn() } as unknown as ModalShell;
    component['openDeleteDialog'](baseItem, dialog);
    mockImportsSvc.delete.mockRejectedValue(new Error('Import in use'));

    await component['confirmDelete'](dialog);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Import in use');
    expect(dialog.close).not.toHaveBeenCalled();
    expect(component['deleting']()).toBe(false);
  });

  it('should poll only while an import is pending or processing, and stop once none are left', async () => {
    fixture.destroy();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    mockImportsSvc.list.mockResolvedValue([{ ...baseItem, status: 'processing' }]);

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges(); // flush the polling effect

    expect(component['hasActiveImports']()).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 4000);

    // A refresh finds every import finished: the effect stops the interval.
    clearIntervalSpy.mockClear();
    component['items'].set([{ ...baseItem, status: 'completed' }]);
    fixture.detectChanges();

    expect(component['hasActiveImports']()).toBe(false);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('should not start polling when nothing in the list is active', async () => {
    fixture.destroy();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    mockImportsSvc.list.mockResolvedValue([{ ...baseItem, status: 'completed' }]);

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 4000);
  });

  it('should replace the list with the latest server state on each poll step', async () => {
    await fixture.whenStable();
    mockImportsSvc.list.mockClear();
    mockImportsSvc.list.mockResolvedValue([{ ...baseItem, status: 'completed', insertedCount: 99 }]);

    await component['pollStep']();

    expect(mockImportsSvc.list).toHaveBeenCalled();
    expect(component['items']()).toEqual([{ ...baseItem, status: 'completed', insertedCount: 99 }]);
  });

  it('should show live progress for a processing import once the row count is known', async () => {
    fixture.destroy();
    mockImportsSvc.list.mockResolvedValue([
      { ...baseItem, status: 'processing', rowCount: 200, insertedCount: 40, skippedCount: 6, errorCount: 4 },
    ]);

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('50 of 200 rows');
    const bar = el.querySelector('progress.progress-info') as HTMLProgressElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.max).toBe(200);
    expect(bar?.value).toBe(50);
  });

  it('should show a counting state, not a 0-of-0 bar, while the row count is unknown', async () => {
    fixture.destroy();
    mockImportsSvc.list.mockResolvedValue([
      { ...baseItem, status: 'processing', rowCount: 0, insertedCount: 0, skippedCount: 0, errorCount: 0 },
    ]);

    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Counting rows');
    expect(el.textContent).not.toContain('0 of 0');
    expect(el.querySelector('progress.progress-info')).toBeNull();
    // The File cell must not claim "0 rows" while the job is still counting.
    expect(el.textContent).not.toContain('0 rows');
  });

  it('should abort in-flight requests and stop an active poll on destroy', async () => {
    fixture.destroy();
    mockImportsSvc.list.mockResolvedValue([{ ...baseItem, status: 'processing' }]);
    fixture = TestBed.createComponent(ImportsPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
    fixture.detectChanges(); // flush the polling effect so an interval is running
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    fixture.destroy();

    expect(mockImportsSvc.abort).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('should navigate to the CSV import wizard', async () => {
    await fixture.whenStable();

    component['startNewImport']();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/imports/new']);
  });

  describe('Exports tab', () => {
    it('should load export jobs the first time the Exports tab is opened', async () => {
      await fixture.whenStable();

      component['switchTab']('exports');
      await Promise.resolve();

      expect(mockExportsSvc.list).toHaveBeenCalled();
      expect(component['exportJobs']()).toEqual([baseExportJob]);
      expect(component['tab']()).toBe('exports');
    });

    it('should identify jobs older than 30 days as expired', () => {
      const oldJob = { ...baseExportJob, created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() };
      const recentJob = { ...baseExportJob, created_at: new Date().toISOString() };

      expect(component['isExpired'](oldJob as never)).toBe(true);
      expect(component['isExpired'](recentJob as never)).toBe(false);
    });

    it('should download a completed, non-expired export job', async () => {
      await component['downloadExportJob'](baseExportJob as never);

      expect(mockTokenSvc.getAuthToken).toHaveBeenCalled();
      expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    });

    it('should refuse to download an expired export job', async () => {
      const expiredJob = {
        ...baseExportJob,
        created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      };

      await component['downloadExportJob'](expiredJob as never);

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('This export has expired (30+ days old).');
    });

    it('should not delete an export job when the confirmation dialog is dismissed', async () => {
      mockDialogSvc.confirm.mockResolvedValue(false);

      await component['deleteExportJob'](baseExportJob as never);

      expect(mockExportsSvc.delete).not.toHaveBeenCalled();
    });

    it('should delete an export job and reload the list after confirmation', async () => {
      await component['deleteExportJob'](baseExportJob as never);

      expect(mockExportsSvc.delete).toHaveBeenCalledWith(baseExportJob.id);
      expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Export deleted successfully.');
    });

    it('should show an error alert when deleting an export job fails', async () => {
      mockExportsSvc.delete.mockRejectedValue(new Error('cannot delete'));

      await component['deleteExportJob'](baseExportJob as never);

      expect(mockAlertSvc.showError).toHaveBeenCalledWith('Failed to delete export. Please try again.');
    });

    // Downloading and deleting an export are limited to the member who requested it plus
    // admins and owners, but the tab lists the whole workspace. The row must not offer a
    // button the server answers with a permission error.
    async function renderExportsTabWith(job: unknown): Promise<string> {
      mockExportsSvc.list.mockResolvedValue([job]);
      await fixture.whenStable();
      component['switchTab']('exports');
      await fixture.whenStable();
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).innerHTML;
    }

    it('should offer no download or delete button for a colleague’s export', async () => {
      const html = await renderExportsTabWith({ ...baseExportJob, downloadable: false, ownedByOther: true });

      expect(html).toContain('Owner only');
      expect(html).not.toContain('Download CSV');
      expect(html).not.toContain('Delete export');
    });

    it('should still offer the download and delete buttons for your own export', async () => {
      const html = await renderExportsTabWith(baseExportJob);

      expect(html).not.toContain('Owner only');
      expect(html).toContain('Download CSV');
      expect(html).toContain('Delete export');
    });

    it('should name the owner in the "Owner only" tooltip, and fall back when nobody is named', () => {
      expect(
        component['ownerOnlyHint']({ ...baseExportJob, createdBy: { id: 'u2', name: 'Rosa Diaz', email: null } }),
      ).toBe('Only Rosa Diaz, or a workspace admin, can download or delete this export.');
      expect(component['ownerOnlyHint']({ ...baseExportJob, createdBy: null })).toBe(
        'Only the member who requested this export, or a workspace admin, can download or delete it.',
      );
    });

    it('should toggle the "New export" guidance panel instead of opening a wizard', () => {
      expect(component['showNewExportInfo']()).toBe(false);

      component['toggleNewExportInfo']();
      expect(component['showNewExportInfo']()).toBe(true);

      component['goToPeopleGrid']();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/people']);
    });
  });
});
