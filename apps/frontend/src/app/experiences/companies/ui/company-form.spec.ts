import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { CompaniesService } from '../services/companies-service';
import { CompanyForm } from './company-form';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

describe('CompanyForm', () => {
  let component: CompanyForm;
  let fixture: ComponentFixture<CompanyForm>;
  let mockCompaniesSvc: any;
  let mockAlertSvc: any;
  let mockRouter: any;
  let mockConfirmDialogSvc: any;

  beforeEach(() => {
    mockCompaniesSvc = {
      getById: vi.fn(),
      add: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      triggerRefresh: vi.fn(),
    };

    mockAlertSvc = {
      showError: vi.fn(),
      showSuccess: vi.fn(),
    };

    mockRouter = {
      navigate: vi.fn(),
    };

    mockConfirmDialogSvc = {
      confirm: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    history.replaceState({}, '');
  });

  async function createComponent() {
    await TestBed.configureTestingModule({
      imports: [CompanyForm],
      providers: [
        { provide: CompaniesService, useValue: mockCompaniesSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: {} },
        { provide: ConfirmDialogService, useValue: mockConfirmDialogSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanyForm);
    component = fixture.componentInstance;
  }

  it('should initialize an empty form when there is no id (new mode)', async () => {
    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['isNewMode']()).toBe(true);
    expect(mockCompaniesSvc.getById).not.toHaveBeenCalled();
    expect(component['payload']()).toEqual({
      name: '',
      description: '',
      website: '',
      industry: '',
      email: '',
      phone: '',
      notes: '',
    });
  });

  it('should load an existing company and populate the form in edit mode', async () => {
    const mockCompany = {
      id: 'c-1',
      name: 'Acme Corp',
      description: 'Widgets',
      website: 'https://acme.example.com',
      industry: 'Technology',
      email: 'info@acme.example.com',
      phone: '555-0100',
      notes: 'VIP',
    };
    mockCompaniesSvc.getById.mockResolvedValue(mockCompany);

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['isNewMode']()).toBe(false);
    expect(mockCompaniesSvc.getById).toHaveBeenCalledWith('c-1');
    expect(component['payload']()).toEqual({
      name: 'Acme Corp',
      description: 'Widgets',
      website: 'https://acme.example.com',
      industry: 'Technology',
      email: 'info@acme.example.com',
      phone: '555-0100',
      notes: 'VIP',
    });
  });

  it('should pre-fill a "(Copy)" name from cloneData when creating from a clone in new mode', async () => {
    history.replaceState(
      {
        cloneData: {
          name: 'Acme Corp',
          description: 'Widgets',
          website: 'https://acme.example.com',
          industry: 'Technology',
          email: 'info@acme.example.com',
          phone: '555-0100',
          notes: 'VIP',
        },
      },
      '',
    );

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['payload']().name).toBe('Acme Corp (Copy)');
    expect(component['payload']().website).toBe('https://acme.example.com');
  });

  it('should compute breadcrumbs for new mode', async () => {
    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['crumbs']()).toEqual([{ label: 'Companies', route: '/companies' }, { label: 'New company' }]);
  });

  it('should compute breadcrumbs for edit mode once the company loads', async () => {
    mockCompaniesSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Acme Corp' });

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component['crumbs']()).toEqual([
      { label: 'Companies', route: '/companies' },
      { label: 'Acme Corp', route: ['/companies', 'c-1'] },
      { label: 'Edit' },
    ]);
  });

  it('should call add and navigate to the list on successful save in new mode', async () => {
    mockCompaniesSvc.add.mockResolvedValue({ id: 'new-id' });

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    component['payload'].set({
      name: 'New Co',
      description: '',
      website: '',
      industry: '',
      email: '',
      phone: '',
      notes: '',
    });

    component['save']();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCompaniesSvc.add).toHaveBeenCalledWith({
      name: 'New Co',
      description: '',
      website: '',
      industry: '',
      email: '',
      phone: '',
      notes: '',
    });
    expect(mockCompaniesSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Company added successfully');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/companies']);
  });

  it('creates only once when Save is double-clicked (immediate saving guard)', async () => {
    let resolveAdd!: (value: unknown) => void;
    mockCompaniesSvc.add.mockReturnValue(new Promise((r) => (resolveAdd = r)));

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    component['payload'].set({
      name: 'New Co',
      description: '',
      website: '',
      industry: '',
      email: '',
      phone: '',
      notes: '',
    });

    // Two rapid clicks before the first add resolves: the loading gate stays invisible
    // for its first 300ms, so only the immediate `saving` guard can block the second.
    component['save']();
    component['save']();

    expect(mockCompaniesSvc.add).toHaveBeenCalledTimes(1);

    resolveAdd({ id: 'new-id' });
    await new Promise((r) => setTimeout(r, 0));

    // Guard clears after the save settles, so a later save can proceed.
    expect(component['saving']()).toBe(false);
  });

  it('should call update and show a success alert on successful save in edit mode', async () => {
    mockCompaniesSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Acme Corp' });
    mockCompaniesSvc.update.mockResolvedValue({ id: 'c-1', name: 'Acme Corp Updated' });

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    component['payload'].update((p) => ({ ...p, name: 'Acme Corp Updated' }));

    component['save']();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockCompaniesSvc.update).toHaveBeenCalledWith('c-1', expect.objectContaining({ name: 'Acme Corp Updated' }));
    expect(mockCompaniesSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Company updated successfully');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/companies', 'c-1']);
  });

  it('should call the done callback instead of navigating when save is invoked with one', async () => {
    mockCompaniesSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Acme Corp' });
    mockCompaniesSvc.update.mockResolvedValue({ id: 'c-1' });

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const done = vi.fn();
    component['save'](done);
    await new Promise((r) => setTimeout(r, 0));

    expect(done).toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should show an error alert when save fails', async () => {
    mockCompaniesSvc.add.mockRejectedValue(new Error('Save exploded'));

    await createComponent();
    fixture.detectChanges();
    await fixture.whenStable();

    component['save']();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Save exploded');
  });

  it('should delete the company after confirmation and navigate back to the list', async () => {
    mockCompaniesSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Acme Corp' });
    mockCompaniesSvc.delete.mockResolvedValue(true);

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    await component['deleteCompany']();

    expect(mockConfirmDialogSvc.confirm).toHaveBeenCalled();
    expect(mockCompaniesSvc.delete).toHaveBeenCalledWith('c-1');
    expect(mockCompaniesSvc.triggerRefresh).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Company deleted');
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/companies']);
  });

  it('should not delete the company when the confirmation dialog is cancelled', async () => {
    mockCompaniesSvc.getById.mockResolvedValue({ id: 'c-1', name: 'Acme Corp' });
    mockConfirmDialogSvc.confirm.mockResolvedValue(false);

    await createComponent();
    fixture.componentRef.setInput('id', 'c-1');
    fixture.detectChanges();
    await fixture.whenStable();

    await component['deleteCompany']();

    expect(mockCompaniesSvc.delete).not.toHaveBeenCalled();
  });
});
