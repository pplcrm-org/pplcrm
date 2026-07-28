import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { SettingsService } from './services/settings-service';
import { SettingsPage } from './settings-page';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AuthService } from '../../auth/auth-service';
import { UserService } from '../../services/user.service';
import { of } from 'rxjs';

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;
  let mockSettingsSvc: any;
  let mockAlertSvc: any;
  let mockAuthSvc: any;
  let mockUserService: any;
  let snapshotSignalValue: any;

  beforeEach(async () => {
    snapshotSignalValue = signal<Record<string, unknown>>({
      'organization.name': 'Acme Corp',
      'organization.contact_email': 'hello@acme.com',
      'organization.phone': '(555) 019-2834',
      'organization.address': '456 Oak Ave, Metropolis',
    });

    mockSettingsSvc = {
      snapshotSignal: snapshotSignalValue,
      load: vi.fn().mockResolvedValue(snapshotSignalValue()),
      getValue: vi.fn((key: string, fallback: any) => {
        const val = snapshotSignalValue()[key];
        return val === undefined ? fallback : val;
      }),
      upsert: vi.fn().mockImplementation(async (entries) => {
        const newSnapshot = { ...snapshotSignalValue() };
        for (const entry of entries) {
          newSnapshot[entry.key] = entry.value;
        }
        snapshotSignalValue.set(newSnapshot);
        return newSnapshot;
      }),
      snapshot: vi.fn(() => snapshotSignalValue()),
      pending: vi.fn(() => false),
    };

    mockAlertSvc = {
      showSuccess: vi.fn(),
      showError: vi.fn(),
      show: vi.fn(),
    };

    const mockAuthUser = {
      id: '123',
      email: 'john@example.com',
      first_name: 'John',
      last_name: 'Doe',
      notification_preferences: {
        mention_in_comment: true,
        mention_in_comment_in_app: true,
        task_assigned: true,
        task_assigned_in_app: true,
        task_due: true,
        task_due_in_app: true,
        person_assigned: true,
        person_assigned_in_app: true,
        export_ready: true,
        export_ready_in_app: true,
        import_summary: true,
        import_summary_in_app: true,
        companion_approval_sms: false,
      },
    };

    mockAuthSvc = {
      getCurrentUser: vi.fn().mockResolvedValue(mockAuthUser),
      getUserSignal: vi.fn().mockReturnValue(signal(null)),
    };

    mockUserService = {
      getProfileById: vi.fn().mockResolvedValue(mockAuthUser),
      updateUserProfile: vi.fn().mockResolvedValue(mockAuthUser),
    };

    const mockActivatedRoute = {
      queryParams: of({}),
      snapshot: {
        data: {
          mode: 'workspace',
        },
        queryParamMap: {
          get: vi.fn().mockReturnValue(null),
        },
      },
    };

    const mockRouter = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        { provide: SettingsService, useValue: mockSettingsSvc },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: Router, useValue: mockRouter },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should initialize and build section states', () => {
    expect(component).toBeTruthy();
    expect(component['hasLoaded']()).toBe(true);
    expect(component['sectionStates'].length).toBeGreaterThan(0);

    // Verify first section form is populated
    const orgSection = component['sectionStates'].find((s) => s.config.id === 'organization');
    expect(orgSection).toBeTruthy();
    expect(orgSection?.payload()['organization_name']).toBe('Acme Corp');
    expect(orgSection?.payload()['organization_contact_email']).toBe('hello@acme.com');
  });

  it('should allow switching between sections', () => {
    expect(component['selectedSectionId']()).toBe('organization');

    const router = TestBed.inject(Router);
    component['selectSection']('notifications');
    // Query params are preserved so a go-live `?setup` hop between sections keeps its way back.
    expect(router.navigate).toHaveBeenCalledWith(['/', 'workspace', 'notifications'], {
      queryParamsHandling: 'preserve',
    });

    fixture.componentRef.setInput('section', 'notifications');
    fixture.detectChanges();

    expect(component['selectedSectionId']()).toBe('notifications');
    expect(component['isSelected']('notifications')).toBe(true);
    expect(component['isSelected']('organization')).toBe(false);
  });

  it('should mark form as dirty when field value changes', () => {
    const orgSection = component['sectionStates'].find((s) => s.config.id === 'organization');
    expect(orgSection).toBeTruthy();
    expect(component['isSectionDirty'](orgSection!)).toBe(false);

    // Change a value via DOM element
    const input = fixture.nativeElement.querySelector('#organization_name');
    expect(input).toBeTruthy();
    input.value = 'New Acme Name';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component['isSectionDirty'](orgSection!)).toBe(true);
  });

  it('should validate email field and set invalid state', () => {
    const orgSection = component['sectionStates'].find((s) => s.config.id === 'organization');
    expect(orgSection).toBeTruthy();
    expect(component['isSectionInvalid'](orgSection!)).toBe(false);

    // Set invalid email via DOM
    const emailInput = fixture.nativeElement.querySelector('#organization_contact_email');
    expect(emailInput).toBeTruthy();
    emailInput.value = 'invalid-email';
    emailInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component['isSectionInvalid'](orgSection!)).toBe(true);
  });

  it('should reset section fields back to original settings', () => {
    const orgSection = component['sectionStates'].find((s) => s.config.id === 'organization');
    expect(orgSection).toBeTruthy();

    const input = fixture.nativeElement.querySelector('#organization_name');
    input.value = 'Temporary Name';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component['isSectionDirty'](orgSection!)).toBe(true);

    component['resetSection'](orgSection!);
    fixture.detectChanges();

    expect(orgSection?.payload()['organization_name']).toBe('Acme Corp');
    expect(component['isSectionDirty'](orgSection!)).toBe(false);
  });

  it('should save modified fields via SettingsService.upsert', async () => {
    const orgSection = component['sectionStates'].find((s) => s.config.id === 'organization');
    expect(orgSection).toBeTruthy();

    const nameInput = fixture.nativeElement.querySelector('#organization_name');
    nameInput.value = 'Acme Corp V2';
    nameInput.dispatchEvent(new Event('input'));

    const phoneInput = fixture.nativeElement.querySelector('#organization_phone');
    phoneInput.value = '(555) 123-4567';
    phoneInput.dispatchEvent(new Event('input'));

    fixture.detectChanges();
    expect(component['isSectionDirty'](orgSection!)).toBe(true);

    await component['saveSection'](orgSection!);

    expect(mockSettingsSvc.upsert).toHaveBeenCalledWith([
      { key: 'organization.name', value: 'Acme Corp V2' },
      { key: 'organization.phone', value: '(555) 123-4567' },
    ]);
    expect(component['isSectionDirty'](orgSection!)).toBe(false);
    expect(snapshotSignalValue()['organization.name']).toBe('Acme Corp V2');
  });

  it('no longer carries personal sections — those moved to the avatar-menu dialog', () => {
    // Notifications and passkeys are the dialog's job; appearance's two keys are tenant
    // defaults and moved into Workspace → Organization. A section here that renders nowhere
    // is exactly how the unreachable 'data' block happened.
    const ids = component['sectionStates'].map((state) => state.config.id);
    expect(ids).not.toContain('notifications');
    expect(ids).not.toContain('appearance');
    expect(component['visibleSections'].length).toBe(component['sectionStates'].length);
  });

  it('keeps the tenant appearance defaults on the Organization section', () => {
    const organization = component['sectionStates'].find((s) => s.config.id === 'organization');
    const keys = organization?.fields.map((f) => f.config.key) ?? [];
    expect(keys).toContain('appearance.theme');
    expect(keys).toContain('appearance.date_format');
    expect(keys).toContain('organization.timezone');
    expect(keys).toContain('organization.currency');
  });

  it('should initialize correctly under billing mode', async () => {
    const mockRoute = TestBed.inject(ActivatedRoute);
    mockRoute.snapshot.data = { mode: 'workspace' };

    const newFixture = TestBed.createComponent(SettingsPage);
    const newComponent = newFixture.componentInstance;
    newFixture.componentRef.setInput('section', 'billing');
    newFixture.detectChanges();
    await newFixture.whenStable();
    newFixture.detectChanges();

    expect(newComponent['currentMode']).toBe('workspace');
    expect(newComponent['selectedSectionId']()).toBe('billing');
  });

  /**
   * The From picker must offer exactly what the server will accept. Bulk mail needs DMARC
   * alignment, which is a property of the DOMAIN, so a verified single address on an unverified
   * domain is a reply-to and nothing more. Offering it as a From address would be offering a
   * choice that saves and then fails at send time.
   */
  describe('sending identity', () => {
    const withSnapshot = async (extra: Record<string, unknown>) => {
      snapshotSignalValue.set({ ...snapshotSignalValue(), ...extra });
      fixture.detectChanges();
      await fixture.whenStable();
    };

    it('offers only addresses on a verified domain as From addresses', async () => {
      await withSnapshot({
        'communications.verified_emails': ['news@vote-jane.org', 'someone@gmail.com'],
        'communications.verified_domains': [{ domain: 'vote-jane.org', status: 'verified' }],
      });

      expect(component['sendableFromAddresses']()).toEqual(['news@vote-jane.org']);
      // ...and names the one it left out, rather than silently dropping it.
      expect(component['unusableFromAddresses']()).toEqual(['someone@gmail.com']);
    });

    it('treats a pending domain as not verified', async () => {
      await withSnapshot({
        'communications.verified_emails': ['news@vote-jane.org'],
        'communications.verified_domains': [{ domain: 'vote-jane.org', status: 'pending' }],
      });

      expect(component['sendableFromAddresses']()).toEqual([]);
    });

    it('surfaces the platform address when the server supplies one', async () => {
      await withSnapshot({ 'communications.platform_from_email': 'riverside@send.pplcrm.com' });

      expect(component['platformFromEmail']()).toBe('riverside@send.pplcrm.com');

      const comms = component['sectionStates'].find((s: any) => s.config.id === 'communications');
      const fromField = comms.config.fields.find((f: any) => f.key === 'communications.default_from_email');
      expect(fromField.options.some((o: any) => o.value === 'riverside@send.pplcrm.com')).toBe(true);
    });

    it('offers no platform address when the feature is off', async () => {
      await withSnapshot({ 'communications.platform_from_email': null });
      expect(component['platformFromEmail']()).toBeNull();
    });

    // The send guard refuses this combination; the page has to say so at the point of choice.
    it('flags a missing reply-to only while the platform address is selected', async () => {
      await withSnapshot({ 'communications.platform_from_email': 'riverside@send.pplcrm.com' });
      const comms = component['sectionStates'].find((s: any) => s.config.id === 'communications');

      comms.payload.set({ 'communications.default_from_email': 'riverside@send.pplcrm.com' });
      expect(component['usingPlatformFrom']()).toBe(true);
      expect(component['platformFromNeedsReplyTo']()).toBe(true);

      comms.payload.set({
        'communications.default_from_email': 'riverside@send.pplcrm.com',
        'communications.reply_to': 'office@riverside.example',
      });
      expect(component['platformFromNeedsReplyTo']()).toBe(false);

      // Sending from your own domain carries its own identity, so no reply-to is required.
      comms.payload.set({ 'communications.default_from_email': 'news@vote-jane.org' });
      expect(component['usingPlatformFrom']()).toBe(false);
      expect(component['platformFromNeedsReplyTo']()).toBe(false);
    });
  });
});
