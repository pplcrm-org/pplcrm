import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { FormsService } from '@experiences/forms/services/forms-service';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { FundraisingFormComponent } from './fundraising-form';

describe('FundraisingFormComponent', () => {
  let component: FundraisingFormComponent;
  let fixture: ComponentFixture<FundraisingFormComponent>;
  let mockFormsSvc: any;
  let mockListsSvc: any;
  let mockAlertSvc: any;
  let mockRouter: any;
  let mockActivatedRoute: any;
  let mockConfirmDialogSvc: any;
  let mockSettingsSvc: any;

  beforeEach(async () => {
    mockFormsSvc = {
      getById: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      // The page deletes through the draft-only guarded verb, which refuses a published or
      // already-answered page, not the generic CRUD delete.
      deleteDraft: vi.fn(),
      triggerRefresh: vi.fn(),
    };

    mockListsSvc = {
      getAll: vi.fn().mockResolvedValue({ rows: [{ id: 'l1', name: 'Newsletter' }], count: 1 }),
    };

    mockAlertSvc = { showError: vi.fn(), showSuccess: vi.fn() };
    mockRouter = { navigate: vi.fn().mockResolvedValue(true) };

    mockActivatedRoute = {
      snapshot: {
        paramMap: { get: vi.fn().mockReturnValue('add') },
      },
    };

    mockConfirmDialogSvc = { confirm: vi.fn().mockResolvedValue(true) };
    // `snapshotSignal` is what WorkspaceCurrencyService reads to resolve the workspace currency;
    // the component names that currency on the amount fields. Left empty here, so the currency
    // falls back to the project default (CAD).
    mockSettingsSvc = {
      getValue: vi.fn().mockReturnValue(''),
      load: vi.fn().mockResolvedValue({}),
      snapshotSignal: signal<Record<string, unknown>>({}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [FundraisingFormComponent],
      providers: [
        { provide: FormsService, useValue: mockFormsSvc },
        { provide: ListsService, useValue: mockListsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: ConfirmDialogService, useValue: mockConfirmDialogSvc },
        { provide: SettingsService, useValue: mockSettingsSvc },
        { provide: AuthService, useValue: { getUser: vi.fn().mockReturnValue({ tenant_slug: 'testorg' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FundraisingFormComponent);
    component = fixture.componentInstance;
  }

  /**
   * `ngOnInit` kicks off two independently-awaited chains (`loadLists` -> `loadPageDetails`
   * and `settingsSvc.load()`), and the component also renders a real `pc-tags` child that
   * fires its own (unmocked, failing) tRPC call. A single `whenStable()` only drains the
   * first microtask hop; give the nested awaits an extra tick to fully settle.
   */
  async function flush() {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  it('should initialize as a new donation page with default values', async () => {
    await createComponent();
    fixture.detectChanges();
    await flush();

    expect(component['isNew']()).toBe(true);
    expect(mockFormsSvc.getById).not.toHaveBeenCalled();
    expect(component['payload']()).toEqual({
      name: '',
      description: '',
      redirect_url: '',
      status: 'active',
      send_confirmation: true,
      send_alert: true,
      form_type: 'donation',
    });
  });

  it('should load an existing donation page in edit mode', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({
      id: 'page-123',
      name: 'Annual Gala',
      description: 'Yearly fundraiser',
      redirect_url: 'https://example.com/thanks',
      status: 'active',
      send_confirmation: true,
      send_alert: false,
      form_type: 'recurring_donation',
      target_tags: ['donor'],
      target_lists: ['l1'],
      fields: ['first_name', 'last_name', 'email'],
    });

    await createComponent();
    fixture.detectChanges();
    await flush();

    expect(component['isNew']()).toBe(false);
    expect(mockFormsSvc.getById).toHaveBeenCalledWith('page-123');
    expect(component['payload']()).toEqual({
      name: 'Annual Gala',
      description: 'Yearly fundraiser',
      redirect_url: 'https://example.com/thanks',
      status: 'active',
      send_confirmation: true,
      send_alert: false,
      form_type: 'recurring_donation',
    });
    expect(component['selectedTags']()).toEqual(['donor']);
    expect(component['selectedLists']()).toEqual(['l1']);
    expect(component['isRecurring']()).toBe(true);
  });

  it('should reject saving when the name field is blank', async () => {
    await createComponent();
    fixture.detectChanges();
    await flush();

    expect(component['form']().invalid()).toBe(true);

    await component['save']();

    expect(mockFormsSvc.add).not.toHaveBeenCalled();
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Please check your inputs.');
  });

  it('should create a new donation page and navigate to it on success', async () => {
    mockFormsSvc.add.mockResolvedValue({ id: 'new-page-id' });

    await createComponent();
    fixture.detectChanges();
    await flush();

    component['payload'].set({
      name: 'Spring Fundraiser',
      description: '',
      redirect_url: '',
      status: 'active',
      send_confirmation: true,
      send_alert: true,
      form_type: 'donation',
    });

    expect(component['form']().invalid()).toBe(false);

    await component['save']();

    expect(mockFormsSvc.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Spring Fundraiser', form_type: 'donation' }),
    );
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Donation page created successfully!');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/donation-pages', 'new-page-id']);
  });

  it('should update an existing donation page and show a success alert', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({
      id: 'page-123',
      name: 'Annual Gala',
      form_type: 'donation',
    });
    mockFormsSvc.update.mockResolvedValue({ id: 'page-123' });

    await createComponent();
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, name: 'Annual Gala Updated' }));

    await component['save']();

    expect(mockFormsSvc.update).toHaveBeenCalledWith(
      'page-123',
      expect.objectContaining({ name: 'Annual Gala Updated' }),
    );
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Donation page updated successfully!');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/donation-pages', 'page-123']);
  });

  it('should surface a save error and keep saving state consistent', async () => {
    mockFormsSvc.add.mockRejectedValue(new Error('Stripe key missing'));

    await createComponent();
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, name: 'Broken Page' }));
    await component['save']();

    expect(component['error']()).toBe('Stripe key missing');
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Stripe key missing');
    expect(component['saving']()).toBe(false);
  });

  it('should confirm, delete, and navigate back on deleteForm', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({ id: 'page-123', name: 'Annual Gala', form_type: 'donation' });
    mockFormsSvc.deleteDraft.mockResolvedValue(true);

    await createComponent();
    fixture.detectChanges();
    await flush();

    await component['deleteForm']();

    expect(mockConfirmDialogSvc.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(mockFormsSvc.deleteDraft).toHaveBeenCalledWith('page-123');
    expect(mockFormsSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Donation page deleted');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/donations']);
  });

  it('should not delete when the confirmation dialog is rejected', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({ id: 'page-123', name: 'Annual Gala', form_type: 'donation' });
    mockConfirmDialogSvc.confirm.mockResolvedValue(false);

    await createComponent();
    fixture.detectChanges();
    await flush();

    await component['deleteForm']();

    expect(mockFormsSvc.deleteDraft).not.toHaveBeenCalled();
  });

  it('should generate a recurring-donation embed snippet with a monthly pledge field once an id is known', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({
      id: 'page-123',
      name: 'Monthly Giving',
      slug: 'monthly-giving',
      form_type: 'recurring_donation',
    });

    await createComponent();
    fixture.detectChanges();
    await flush();

    const snippet = component['embedSnippet']();
    // The amount label names the workspace currency, so a donor is never asked for an amount
    // under one currency and then charged in another.
    expect(snippet).toContain('Monthly Pledge Amount (CAD)');
    expect(snippet).toContain('Start Monthly Pledge');
    expect(snippet).toContain(`/api/forms/submit/monthly-giving?t=testorg`);
  });

  it('should generate a one-time donation embed snippet by default', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({
      id: 'page-123',
      name: 'One Time',
      slug: 'one-time',
      form_type: 'donation',
    });

    await createComponent();
    fixture.detectChanges();
    await flush();

    const snippet = component['embedSnippet']();
    expect(snippet).toContain('Donation Amount (CAD)');
    expect(snippet).toContain('Donate Now');
  });

  it('should add and remove target lists', async () => {
    await createComponent();
    fixture.detectChanges();
    await flush();

    const select = { value: 'l1' } as unknown as HTMLSelectElement;
    component['handleListSelect']({ target: select } as unknown as Event);
    expect(component['selectedLists']()).toEqual(['l1']);

    component['removeList']('l1');
    expect(component['selectedLists']()).toEqual([]);
  });

  it('should copy the embed snippet to the clipboard and show a success alert', async () => {
    mockActivatedRoute.snapshot.paramMap.get.mockReturnValue('page-123');
    mockFormsSvc.getById.mockResolvedValue({ id: 'page-123', name: 'Gala', slug: 'gala', form_type: 'donation' });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true });

    await createComponent();
    fixture.detectChanges();
    await flush();

    component['copySnippet']();
    await new Promise((r) => setTimeout(r, 0));

    expect(writeText).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Donation page snippet copied to clipboard!');
  });
});
