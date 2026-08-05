import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { TagsService } from '@experiences/tags/services/tags-service';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../../settings/services/settings-service';
import { NewsletterAddComponent } from './newsletter-add';
import { NewslettersService } from '../services/newsletters-service';

describe('NewsletterAddComponent', () => {
  let component: NewsletterAddComponent;
  let fixture: ComponentFixture<NewsletterAddComponent>;
  let mockAlertSvc: { showSuccess: ReturnType<typeof vi.fn>; showError: ReturnType<typeof vi.fn> };
  let mockListsSvc: { getAll: ReturnType<typeof vi.fn> };
  let mockTagsSvc: { getAll: ReturnType<typeof vi.fn> };
  let mockNewslettersSvc: {
    add: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    sendTest: ReturnType<typeof vi.fn>;
    getTemplates: ReturnType<typeof vi.fn>;
    saveTemplate: ReturnType<typeof vi.fn>;
    deleteTemplate: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
  let mockActivatedRoute: unknown;
  let mockAuthSvc: { getUser: ReturnType<typeof vi.fn>; getUserSignal: () => () => unknown };
  let mockConfirmDlg: { confirm: ReturnType<typeof vi.fn>; choose: ReturnType<typeof vi.fn> };
  let mockSettingsSvc: { load: ReturnType<typeof vi.fn>; getValue: ReturnType<typeof vi.fn> };

  const validDetails = { subject: 'Big News', fromName: 'Jane', fromAddress: 'jane@example.com' };

  const savedTemplate = {
    id: 'tpl-1',
    name: 'Monthly update',
    html_content: '<!DOCTYPE html><html><body>Saved body<!-- PPLCRM_VISUAL_BLOCKS_DATA: x --></body></html>',
    plain_text_content: 'Saved body',
    updated_at: new Date('2026-07-01T00:00:00Z'),
  };

  /** Patches the signal-form payload the way a user filling the fields would. */
  function patchPayload(
    patch: Partial<{
      subject: string;
      fromName: string;
      fromAddress: string;
      htmlContent: string;
      plainTextContent: string;
      timingMode: 'now' | 'schedule';
      scheduledDate: string;
      scheduledTime: string;
    }>,
  ): void {
    component['regularPayload'].update((p) => ({ ...p, ...patch }));
  }

  beforeEach(async () => {
    mockAlertSvc = { showSuccess: vi.fn(), showError: vi.fn() };
    mockListsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [{ id: 'l1', name: 'VIP Donors', list_size: 50 }], count: 1 }),
    };
    mockTagsSvc = {
      getAll: vi.fn().mockResolvedValue({
        rows: [{ id: 't1', name: 'volunteer', use_count_people: 10, use_count_households: 5 }],
        count: 1,
      }),
    };
    mockNewslettersSvc = {
      add: vi.fn().mockResolvedValue({ id: 'nl-1' }),
      getById: vi.fn().mockResolvedValue(null),
      send: vi.fn().mockResolvedValue({ success: true }),
      sendTest: vi.fn().mockResolvedValue({ to: 'me@example.com', delivered: 1 }),
      getTemplates: vi.fn().mockResolvedValue([savedTemplate]),
      saveTemplate: vi.fn().mockResolvedValue({ ...savedTemplate, id: 'tpl-2', name: 'My design' }),
      deleteTemplate: vi.fn().mockResolvedValue(true),
    };
    mockRouter = { navigate: vi.fn(), navigateByUrl: vi.fn() };
    mockActivatedRoute = { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } } };
    mockAuthSvc = {
      getUser: vi.fn().mockReturnValue({ email: 'me@example.com' }),
      getUserSignal: () => () => ({ email: 'me@example.com', tenant_demo_mode_at: null }),
    };
    mockConfirmDlg = { confirm: vi.fn().mockResolvedValue(true), choose: vi.fn().mockResolvedValue(null) };
    mockSettingsSvc = {
      load: vi.fn().mockResolvedValue({}),
      getValue: vi.fn((_key: string, fallback: unknown) => fallback),
    };

    await TestBed.configureTestingModule({
      imports: [NewsletterAddComponent],
      providers: [
        provideRouter([]),
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ListsService, useValue: mockListsSvc },
        { provide: TagsService, useValue: mockTagsSvc },
        { provide: NewslettersService, useValue: mockNewslettersSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: ConfirmDialogService, useValue: mockConfirmDlg },
        { provide: SettingsService, useValue: mockSettingsSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NewsletterAddComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('loads available lists and tags on init', () => {
    // The pickers show every option at once, so they request 1,000 — at 100 a workspace with more
    // lists or tags than that could not target the rest, and was never told.
    expect(mockListsSvc.getAll).toHaveBeenCalledWith({ limit: 1000, startRow: 0 });
    expect(mockTagsSvc.getAll).toHaveBeenCalledWith({ limit: 1000, startRow: 0 });
    expect(component['availableLists']()).toEqual([{ id: 'l1', name: 'VIP Donors', size: 50 }]);
    // A tag's usage counts its people only (10), not its households (5) — a newsletter reaches people.
    expect(component['availableTags']()).toEqual([{ id: 't1', name: 'volunteer', usage: 10 }]);
  });

  it('lands on the template step with the welcome template preselected', () => {
    expect(component['currentStep']()).toBe(1);
    expect(component['currentStepId']()).toBe('template');
    expect(component['selectedTemplate']()).toEqual({ kind: 'preset', id: 'welcome' });
    // The auto-applied default is not a user edit, so the leave guard stays quiet.
    expect(component['dirty']()).toBe(false);
  });

  it('populates the html/plain text content when a template is selected', () => {
    component['selectTemplate']('product');

    expect(component['selectedTemplate']()).toEqual({ kind: 'preset', id: 'product' });
    expect(component['regularPayload']().htmlContent).toContain('Introducing Visual Newsletters!');
    expect(component['regularPayload']().plainTextContent).toContain('Introducing Visual Newsletters!');
  });

  it('exposes sentence-case template names for the review step', () => {
    component['selectTemplate']('welcome');
    expect(component['selectedTemplateName']()).toBe('Welcome email');
  });

  it('loads saved templates on init', () => {
    expect(mockNewslettersSvc.getTemplates).toHaveBeenCalled();
    expect(component['savedTemplates']()).toEqual([savedTemplate]);
  });

  it('applies a saved template verbatim and shows its name on the review step', () => {
    component['selectSavedTemplate'](savedTemplate);

    expect(component['selectedTemplate']()).toEqual({ kind: 'saved', id: 'tpl-1' });
    expect(component['regularPayload']().htmlContent).toBe(savedTemplate.html_content);
    expect(component['regularPayload']().plainTextContent).toBe(savedTemplate.plain_text_content);
    expect(component['selectedTemplateName']()).toBe('Monthly update');
    expect(component['dirty']()).toBe(true);
  });

  it('compiles preset previews once and caches them', () => {
    const first = component['presetPreviewHtml']('welcome');
    expect(first).toContain('<!DOCTYPE html>');
    expect(component['presetPreviewHtml']('welcome')).toBe(first);
  });

  it('saves the current content verbatim as a template and confirms with a toast', async () => {
    patchPayload({ htmlContent: '<html>current</html>', plainTextContent: 'current' });
    component['openSaveTemplate']();
    component['templateNamePayload'].set({ name: 'My design' });

    await component['saveAsTemplate']();

    expect(mockNewslettersSvc.saveTemplate).toHaveBeenCalledWith({
      name: 'My design',
      html_content: '<html>current</html>',
      plain_text_content: 'current',
    });
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Template saved');
    expect(component['saveTemplateOpen']()).toBe(false);
    expect(component['savedTemplates']().some((t) => t.name === 'My design')).toBe(true);
  });

  it('does not save a template without a name', async () => {
    component['openSaveTemplate']();

    await component['saveAsTemplate']();

    expect(mockNewslettersSvc.saveTemplate).not.toHaveBeenCalled();
    expect(component['saveTemplateOpen']()).toBe(true);
  });

  it('deletes a saved template behind the danger confirm, naming the template', async () => {
    await component['deleteSavedTemplate'](savedTemplate);

    expect(mockConfirmDlg.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete template "Monthly update"?',
        variant: 'danger',
        confirmText: 'Delete template',
      }),
    );
    expect(mockNewslettersSvc.deleteTemplate).toHaveBeenCalledWith('tpl-1');
    expect(component['savedTemplates']()).toEqual([]);
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Deleted template "Monthly update"');
  });

  it('keeps a saved template when the danger confirm is cancelled', async () => {
    mockConfirmDlg.confirm.mockResolvedValueOnce(false);

    await component['deleteSavedTemplate'](savedTemplate);

    expect(mockNewslettersSvc.deleteTemplate).not.toHaveBeenCalled();
    expect(component['savedTemplates']()).toEqual([savedTemplate]);
  });

  it('does not advance past step 3 when required detail fields are invalid, and coaches', () => {
    component['currentStep'].set(3);

    component['handleNext']();

    expect(component['currentStep']()).toBe(3);
    expect(component['isInvalid']('subject')).toBe(true);
    expect(mockAlertSvc.showError).toHaveBeenCalledWith(component['subjectCoach']);
  });

  it('advances to step 4 once required detail fields are valid', () => {
    component['currentStep'].set(3);
    patchPayload(validDetails);

    component['handleNext']();

    expect(component['currentStep']()).toBe(4);
  });

  it('only lets you jump to steps you have reached, never one you have not', () => {
    component['handleNext'](); // template -> content

    component['goToStep'](4); // never reached
    expect(component['currentStep']()).toBe(2);

    component['goToStep'](1); // completed step
    expect(component['currentStep']()).toBe(1);
  });

  it('keeps a step reachable after stepping back off it', () => {
    patchPayload(validDetails);
    component['handleNext'](); // -> content
    component['handleNext'](); // -> audience
    component['handleBack'](); // back to content

    expect(component['currentStep']()).toBe(2);
    expect(component['canReachStep'](3)).toBe(true);

    component['goToStep'](3);
    expect(component['currentStep']()).toBe(3);
  });

  it('unlocks every step when an existing draft is reopened for editing', async () => {
    mockNewslettersSvc.getById.mockResolvedValueOnce({
      id: 'nl-1',
      name: 'Spring update',
      status: 'draft',
      subject: 'Spring update',
      html_content: '<p>hi</p>',
    });

    await component['loadDraft']('nl-1');

    expect(component['currentStep']()).toBe(2);
    expect(component['canReachStep'](3)).toBe(true);
    expect(component['canReachStep'](4)).toBe(true);
  });

  it('adds and removes included lists, refreshing the audience estimate', () => {
    component['addIncludeList']('l1');
    expect(component['includeListIds']()).toEqual(['l1']);
    expect(component['estimatedAudienceCount']()).toBe(50);

    component['removeIncludeList']('l1');
    expect(component['includeListIds']()).toEqual([]);
    expect(component['estimatedAudienceCount']()).toBe(0);
  });

  it('subtracts an excluded tag’s people count from the estimated audience', () => {
    component['addIncludeList']('l1');
    component['addExcludeTag']('volunteer');

    // include list (50) - the excluded tag's people (10). The tag's 5 households are not
    // subtracted: a newsletter is sent to people, so households were never in the estimate.
    expect(component['estimatedAudienceCount']()).toBe(40);
  });

  it('does not offer the same list as both an include and exclude suggestion', () => {
    component['addIncludeList']('l1');

    expect(component['includeListSuggestions']().some((l) => l.id === 'l1')).toBe(false);
    // moving it to exclude removes it from includes
    component['addExcludeList']('l1');
    expect(component['includeListIds']()).toEqual([]);
    expect(component['excludeListIds']()).toEqual(['l1']);
  });

  it('resolves list names and sizes for chips', () => {
    expect(component['listName']('l1')).toBe('VIP Donors');
    expect(component['listSize']('l1')).toBe(50);
    expect(component['listName']('unknown')).toBe('List');
  });

  it('formats an honest people label', () => {
    expect(component['peopleLabel'](1)).toBe('1 person');
    expect(component['peopleLabel'](1312)).toBe('1,312 people');
  });

  it('blocks send when required detail fields are missing and returns to step 3', async () => {
    component['currentStep'].set(4);

    await component['sendRegular']();

    expect(mockConfirmDlg.confirm).not.toHaveBeenCalled();
    expect(mockNewslettersSvc.add).not.toHaveBeenCalled();
    expect(component['currentStep']()).toBe(3);
  });

  it('runs a send preflight and, on confirm, saves then sends immediately for "now"', async () => {
    patchPayload({ ...validDetails, timingMode: 'now' });

    await component['sendRegular']();

    expect(mockConfirmDlg.confirm).toHaveBeenCalled();
    expect(mockNewslettersSvc.add).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Big News', status: 'draft' }),
    );
    expect(mockNewslettersSvc.send).toHaveBeenCalledWith('nl-1');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith(expect.stringContaining('Queued "Big News"'));
    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('does not send when the preflight is cancelled', async () => {
    mockConfirmDlg.confirm.mockResolvedValueOnce(false);
    patchPayload({ ...validDetails, timingMode: 'now' });

    await component['sendRegular']();

    expect(mockNewslettersSvc.add).not.toHaveBeenCalled();
    expect(mockNewslettersSvc.send).not.toHaveBeenCalled();
  });

  it('schedules (status scheduled, no immediate send) with a valid date/time', async () => {
    patchPayload({
      ...validDetails,
      timingMode: 'schedule',
      scheduledDate: '2026-12-01',
      scheduledTime: '09:00',
    });

    await component['sendRegular']();

    expect(mockNewslettersSvc.add).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
    expect(mockNewslettersSvc.send).not.toHaveBeenCalled();
  });

  it('requires a schedule date/time before sending a scheduled newsletter', async () => {
    patchPayload({ ...validDetails, timingMode: 'schedule' });

    await component['sendRegular']();

    expect(mockConfirmDlg.confirm).not.toHaveBeenCalled();
    expect(mockNewslettersSvc.add).not.toHaveBeenCalled();
    expect(mockAlertSvc.showError).toHaveBeenCalledWith(component['scheduleCoach']);
  });

  it('saves a draft and exits with a toast', async () => {
    patchPayload(validDetails);

    await component['saveDraft']();

    expect(mockNewslettersSvc.add).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Saved draft "Big News". Find it in Newsletters');
    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('sends a test email to the current user and confirms the recipient', async () => {
    patchPayload({ subject: 'Big News' });

    await component['sendTestEmail']();

    expect(mockNewslettersSvc.sendTest).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'me@example.com', subject: 'Big News' }),
    );
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Sent a test of "Big News" to me@example.com');
  });

  it('shows an error when the newsletter fails to save', async () => {
    patchPayload({ ...validDetails, timingMode: 'now' });
    mockNewslettersSvc.add.mockRejectedValueOnce(new Error('Save failed'));

    await component['sendRegular']();

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Save failed');
  });

  it('lets you leave freely when nothing has changed', async () => {
    await expect(component.canDeactivate()).resolves.toBe(true);
    expect(mockConfirmDlg.choose).not.toHaveBeenCalled();
  });

  it('offers saving, discarding or staying when leaving with an in-progress draft', async () => {
    component['selectTemplate']('product'); // a real user edit marks the wizard dirty

    await expect(component.canDeactivate()).resolves.toBe(false); // choose() resolves null = Keep editing

    expect(mockConfirmDlg.choose).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelText: 'Keep editing',
        choices: [
          { label: 'Save draft', value: 'save', variant: 'info' },
          { label: 'Discard draft', value: 'discard', variant: 'warning' },
        ],
      }),
    );
  });

  it('saves the draft and then leaves when you pick Save draft on the way out', async () => {
    patchPayload(validDetails);
    component['selectTemplate']('product');
    mockConfirmDlg.choose.mockResolvedValueOnce('save');

    await expect(component.canDeactivate()).resolves.toBe(true);

    expect(mockNewslettersSvc.add).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
    expect(component['dirty']()).toBe(false);
  });

  it('keeps you on the wizard when the leave-time draft save fails', async () => {
    patchPayload(validDetails);
    component['selectTemplate']('product');
    mockConfirmDlg.choose.mockResolvedValueOnce('save');
    mockNewslettersSvc.add.mockRejectedValueOnce(new Error('Save failed'));

    await expect(component.canDeactivate()).resolves.toBe(false);

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Save failed');
    expect(component['dirty']()).toBe(true);
  });

  it('discards the draft when you pick Discard draft', async () => {
    component['selectTemplate']('product');
    mockConfirmDlg.choose.mockResolvedValueOnce('discard');

    await expect(component.canDeactivate()).resolves.toBe(true);

    expect(mockNewslettersSvc.add).not.toHaveBeenCalled();
  });

  it('navigates to the parent route on close', () => {
    component['close']();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['../'], { relativeTo: mockActivatedRoute });
  });
});
