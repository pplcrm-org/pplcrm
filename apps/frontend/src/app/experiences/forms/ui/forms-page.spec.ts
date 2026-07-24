import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import type { FormField } from '../../../../../../../libs/common/src';
import { ListsService } from '@experiences/lists/services/lists-service';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import type { FormDetail } from '../services/forms-service';
import { FormsService } from '../services/forms-service';
import { FormsPageComponent } from './forms-page';

function field(key: string, overrides: Partial<FormField> = {}): FormField {
  return {
    key,
    label: key,
    type: 'text',
    on: true,
    required: false,
    ...overrides,
  } as FormField;
}

function formDetail(fields: FormField[]): FormDetail {
  return {
    id: 'form-1',
    name: 'June signup',
    description: null,
    redirect_url: null,
    status: 'draft',
    type: 'signup',
    form_type: 'standard',
    slug: 'june-signup',
    submit_label: null,
    thanks_title: null,
    thanks_body: null,
    send_confirmation: false,
    confirm_subject: null,
    confirm_body: null,
    notify_team_on: false,
    target_tags: [],
    target_lists: [],
    fields,
    submission_count: 0,
    updated_at: new Date('2026-07-01T00:00:00Z'),
    created_at: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('FormsPageComponent — field reorder', () => {
  let component: FormsPageComponent;
  let fixture: ComponentFixture<FormsPageComponent>;
  let mockFormsSvc: any;

  beforeEach(async () => {
    mockFormsSvc = {
      listForms: vi.fn().mockResolvedValue([]),
      updateLive: vi.fn().mockImplementation((_id: string, patch: unknown): Promise<unknown> => Promise.resolve(patch)),
    };

    await TestBed.configureTestingModule({
      imports: [FormsPageComponent],
      providers: [
        { provide: FormsService, useValue: mockFormsSvc },
        { provide: ListsService, useValue: { getAllWithCounts: vi.fn().mockResolvedValue({ rows: [] }) } },
        { provide: SettingsService, useValue: { load: vi.fn().mockResolvedValue(undefined), getValue: vi.fn() } },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn() } },
        { provide: AuthService, useValue: { getUser: vi.fn().mockReturnValue({ tenant_slug: 'acme' }) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormsPageComponent);
    component = fixture.componentInstance;
  });

  function seed(fields: FormField[]): void {
    const c = component as any;
    c.forms.set([formDetail(fields)]);
    c.selectedId.set('form-1');
  }

  it('moves a field and queues the reordered array to persist', async () => {
    seed([field('full_name'), field('email', { required: true }), field('mobile')]);

    // Drag "mobile" (index 2) to the top (index 0).
    (component as any).reorderField({ previousIndex: 2, currentIndex: 0 });

    // Optimistic local update is immediate.
    const optimistic = (component as any).selected().fields.map((f: FormField) => f.key);
    expect(optimistic).toEqual(['mobile', 'full_name', 'email']);

    // Flushing the debounced patch persists the same order through the existing update path.
    await (component as any).flushPatch();
    expect(mockFormsSvc.updateLive).toHaveBeenCalledTimes(1);
    const [, patch] = mockFormsSvc.updateLive.mock.calls[0];
    expect(patch.fields.map((f: FormField) => f.key)).toEqual(['mobile', 'full_name', 'email']);
  });

  it('lets the email field be reordered while keeping it on and required (invariant preserved)', () => {
    seed([field('full_name'), field('email', { required: true }), field('mobile')]);

    // Drag email (index 1) to the end (index 2).
    (component as any).reorderField({ previousIndex: 1, currentIndex: 2 });

    const fields: FormField[] = (component as any).selected().fields;
    expect(fields.map((f) => f.key)).toEqual(['full_name', 'mobile', 'email']);
    const email = fields.find((f) => f.key === 'email');
    expect(email?.on).toBe(true);
    expect(email?.required).toBe(true);
  });

  it('does not change any field on/required state when reordering (toggles unaffected)', () => {
    seed([
      field('full_name', { on: true, required: true }),
      field('email', { required: true }),
      field('mobile', { on: false, required: false }),
    ]);

    (component as any).reorderField({ previousIndex: 0, currentIndex: 2 });

    const byKey = new Map<string, FormField>((component as any).selected().fields.map((f: FormField) => [f.key, f]));
    expect(byKey.get('full_name')?.on).toBe(true);
    expect(byKey.get('full_name')?.required).toBe(true);
    expect(byKey.get('mobile')?.on).toBe(false);
    expect(byKey.get('mobile')?.required).toBe(false);
  });

  it('is a no-op when dropped in the same position', () => {
    seed([field('full_name'), field('email', { required: true }), field('mobile')]);

    (component as any).reorderField({ previousIndex: 1, currentIndex: 1 });

    expect((component as any).selected().fields.map((f: FormField) => f.key)).toEqual(['full_name', 'email', 'mobile']);
    expect(Object.keys((component as any).pendingPatch)).toHaveLength(0);
  });

  describe('live-edit patch targeting', () => {
    it('flushes a pending patch to the form it was queued for, never the newly selected form', () => {
      const formA = formDetail([field('email', { required: true })]);
      const formB = { ...formDetail([field('email', { required: true })]), id: 'form-2', name: 'Other form' };
      (component as any).forms.set([formA, formB]);
      (component as any).selectedId.set('form-1');

      // Queue a debounced edit on form-1, then switch to form-2 before the 400ms flush.
      (component as any).editName('Renamed A');
      (component as any).select('form-2');

      expect(mockFormsSvc.updateLive).toHaveBeenCalledTimes(1);
      expect(mockFormsSvc.updateLive).toHaveBeenCalledWith('form-1', { name: 'Renamed A' });
      expect(Object.keys((component as any).pendingPatch)).toHaveLength(0);
    });

    it('restores the un-flushed patch under the captured id and toasts when the flush fails', async () => {
      seed([field('email', { required: true })]);
      (component as any).editName('New name');
      mockFormsSvc.updateLive.mockRejectedValueOnce(new Error('network down'));

      await (component as any).flushPatch();

      const alerts = TestBed.inject(AlertService) as any;
      expect(alerts.showError).toHaveBeenCalled();
      expect((component as any).pendingPatch).toEqual({ name: 'New name' });
      expect((component as any).pendingPatchId).toBe('form-1');

      // The next flush retries the restored patch against the same form.
      await (component as any).flushPatch();
      expect(mockFormsSvc.updateLive).toHaveBeenLastCalledWith('form-1', { name: 'New name' });
    });
  });
});
