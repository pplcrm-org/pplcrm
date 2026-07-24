import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { FilesService } from '@experiences/files/services/files.service';
import { BugReportsService } from '../../services/api/bug-reports-service';
import { BugReportDialogService } from '../../services/bug-report-dialog.service';
import { ReportBugDialog } from './report-bug-dialog';

describe('ReportBugDialog', () => {
  let component: ReportBugDialog;
  let fixture: ComponentFixture<ReportBugDialog>;
  let dialogSvc: BugReportDialogService;
  let mockBugReportsSvc: any;
  let mockFilesSvc: any;
  let mockAlertSvc: any;

  beforeEach(async () => {
    mockBugReportsSvc = {
      report: vi.fn().mockResolvedValue({ id: '42' }),
    };
    mockFilesSvc = {
      uploadFileDirectly: vi.fn().mockResolvedValue({ id: '55' }),
    };
    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ReportBugDialog],
      providers: [
        { provide: BugReportsService, useValue: mockBugReportsSvc },
        { provide: FilesService, useValue: mockFilesSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: Router, useValue: { url: '/people/1' } },
      ],
    }).compileComponents();

    dialogSvc = TestBed.inject(BugReportDialogService);
    fixture = TestBed.createComponent(ReportBugDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // jsdom doesn't implement <dialog>.showModal/close — stub them so open/close don't throw.
    const dlgEl = fixture.nativeElement.querySelector('dialog');
    dlgEl.showModal = vi.fn();
    dlgEl.close = vi.fn();
  });

  it('does not submit with an empty description', async () => {
    await component['submit']();
    expect(mockBugReportsSvc.report).not.toHaveBeenCalled();
    expect(component['descriptionInvalid']()).toBe(true);
  });

  it('submits the description with auto-captured context and shows the reference code', async () => {
    component['description'].set('The save button does nothing');

    await component['submit']();

    expect(mockBugReportsSvc.report).toHaveBeenCalledWith({
      description: 'The save button does nothing',
      page_url: '/people/1',
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screenshot_file_id: null,
    });
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(
      'Thanks for the report. Reference BR-42. Our team will take a look.',
    );
    expect(dialogSvc.visible()).toBe(false);
  });

  it('uploads the screenshot first and passes its file id', async () => {
    const file = new File(['fake'], 'shot.png', { type: 'image/png' });
    component['description'].set('Broken layout');
    component['screenshot'].set(file);

    await component['submit']();

    expect(mockFilesSvc.uploadFileDirectly).toHaveBeenCalledWith(file);
    expect(mockBugReportsSvc.report).toHaveBeenCalledWith(expect.objectContaining({ screenshot_file_id: '55' }));
  });

  it('rejects a non-image or oversized screenshot with an error toast', () => {
    const pdf = new File(['fake'], 'doc.pdf', { type: 'application/pdf' });
    component['onScreenshotChange']({ length: 1, item: () => pdf } as unknown as FileList);
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('The screenshot must be an image.');
    expect(component['screenshot']()).toBeNull();

    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    component['onScreenshotChange']({ length: 1, item: () => big } as unknown as FileList);
    expect(mockAlertSvc.showError).toHaveBeenCalledWith(
      'That image is over 5 MB. Crop it or take a smaller screenshot.',
    );
    expect(component['screenshot']()).toBeNull();
  });

  it('shows an error toast when the submit fails and keeps the dialog open', async () => {
    mockBugReportsSvc.report.mockRejectedValue(new Error('Too many requests. Retry in 60 seconds.'));
    dialogSvc.open();
    component['description'].set('Broken');

    await component['submit']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Too many requests. Retry in 60 seconds.');
    expect(dialogSvc.visible()).toBe(true);
  });
});
