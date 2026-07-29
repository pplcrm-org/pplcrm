import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { AuthService } from '../../auth/auth-service';
import { CampaignContextService } from '../../services/campaign-context.service';
import { UserService } from '../../services/user.service';
import { ProfilePage } from './profile-page';

const baseUser = {
  id: 'u1',
  email: 'jane@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  role: 'admin',
  avatar_url: null,
  notification_preferences: {
    mention_in_comment: true,
    task_assigned: true,
    task_due: true,
    person_assigned: true,
    export_ready: true,
    import_summary: true,
  },
  stats: {
    emails_assigned: { total: 4, open: 2, closed: 2 },
    contacts_added: { total: 10, last_created_at: new Date('2024-01-01') },
    files_imported: { count: 1, total_rows: 50, last_activity_at: new Date('2024-01-02') },
    files_exported: { count: 2, total_rows: 100, last_activity_at: new Date('2024-01-03') },
  },
};

describe('ProfilePage', () => {
  let component: ProfilePage;
  let fixture: ComponentFixture<ProfilePage>;
  let mockAlertSvc: any;
  let mockAuthSvc: any;
  let mockUserSvc: any;

  beforeEach(async () => {
    mockAlertSvc = { showSuccess: vi.fn(), showError: vi.fn() };

    mockAuthSvc = {
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'u1' }),
      uploadAvatar: vi.fn().mockResolvedValue({ avatar_url: '/avatars/u1.webp' }),
      deleteAvatar: vi.fn().mockResolvedValue({ success: true }),
      cancelEmailChange: vi.fn().mockResolvedValue(undefined),
    };

    mockUserSvc = {
      getProfileById: vi.fn().mockResolvedValue(baseUser),
      resolveAvatarUrl: vi.fn().mockImplementation((url: string | null) => (url ? `https://cdn.test${url}` : null)),
      updateUserProfile: vi.fn().mockResolvedValue(baseUser),
    };

    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: AuthService, useValue: mockAuthSvc },
        { provide: UserService, useValue: mockUserSvc },
        {
          provide: CampaignContextService,
          useValue: {
            campaigns: () => [],
            activeCampaign: () => null,
            activeCampaignId: () => null,
            ensureLoaded: () => Promise.resolve(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePage);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // `load()` chains `auth.getCurrentUser()` -> `userService.getProfileById()`; a single
  // `whenStable()` only drains the first hop, so give the nested await an extra tick.
  async function flush() {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  it('should load the current user profile, stats, and avatar on init', async () => {
    fixture.detectChanges();
    await flush();

    expect(mockAuthSvc.getCurrentUser).toHaveBeenCalled();
    expect(mockUserSvc.getProfileById).toHaveBeenCalledWith('u1');
    expect(component['detail']()).toEqual(baseUser);
    expect(component['payload']().email).toBe('jane@example.com');
    expect(component['payload']().first_name).toBe('Jane');
    expect(component['avatarUrl']()).toBeNull();
    expect(component['displayName']()).toBe('Jane Doe');
    expect(component['initials']()).toBe('JD');
  });

  it('should build the activity sentences from the loaded stats snapshot', async () => {
    fixture.detectChanges();
    await flush();

    const rows = component['activityRows']();
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.key === 'emails')).toMatchObject({
      count: '4 conversations',
      rest: 'assigned to you, 2 open · 2 closed',
      link: '/inbox',
    });
    expect(rows.find((r) => r.key === 'contacts')).toMatchObject({ count: '10 contacts', link: '/people' });
    expect(rows.find((r) => r.key === 'files')).toMatchObject({ count: '1 import · 2 exports' });
  });

  it('should treat a viewer role as read-only via isViewer', async () => {
    mockUserSvc.getProfileById.mockResolvedValue({ ...baseUser, role: 'viewer' });

    fixture.detectChanges();
    await flush();

    expect(component['isViewer']()).toBe(true);
  });

  it('should reject saving when required fields are cleared', async () => {
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, first_name: '' }));
    fixture.detectChanges();

    expect(component['form']().invalid()).toBe(true);

    await component['save']();

    expect(mockUserSvc.updateUserProfile).not.toHaveBeenCalled();
  });

  it('should save profile changes and show a success alert', async () => {
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, first_name: 'Janet' }));

    await component['save']();

    expect(mockUserSvc.updateUserProfile).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ first_name: 'Janet', email: 'jane@example.com' }),
    );
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Profile updated successfully');
    expect(component['saving']()).toBe(false);
  });

  it('should load an existing mobile into the form and send an edited one on save', async () => {
    mockUserSvc.getProfileById.mockResolvedValue({ ...baseUser, mobile: '+16135550142' });

    fixture.detectChanges();
    await flush();

    expect(component['payload']().mobile).toBe('+16135550142');

    component['payload'].update((p) => ({ ...p, mobile: '(613) 555-0199' }));
    await component['save']();

    expect(mockUserSvc.updateUserProfile).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ mobile: '(613) 555-0199' }),
    );
  });

  it('should send null when the mobile is cleared', async () => {
    mockUserSvc.getProfileById.mockResolvedValue({ ...baseUser, mobile: '+16135550142' });

    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, mobile: '   ' }));
    await component['save']();

    expect(mockUserSvc.updateUserProfile).toHaveBeenCalledWith('u1', expect.objectContaining({ mobile: null }));
  });

  // Same rule as the sender: saving a number we could never text would just reproduce the
  // "no mobile on file" dead end the field exists to fix.
  it('should block saving a mobile number that cannot be texted', async () => {
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, mobile: '555-0142' }));
    fixture.detectChanges();

    expect(component['form']().invalid()).toBe(true);

    await component['save']();

    expect(mockUserSvc.updateUserProfile).not.toHaveBeenCalled();
  });

  it('should surface an error message when saving fails', async () => {
    mockUserSvc.updateUserProfile.mockRejectedValue(new Error('Email already in use'));

    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, first_name: 'Janet' }));
    await component['save']();

    expect(component['error']()).toBe('Email already in use');
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Email already in use');
    expect(component['saving']()).toBe(false);
  });

  it('should cancel a pending email change and reload the profile', async () => {
    fixture.detectChanges();
    await flush();
    mockUserSvc.getProfileById.mockClear();

    await component['cancelEmailChange']();

    expect(mockAuthSvc.cancelEmailChange).toHaveBeenCalled();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Email change canceled and reverted');
    expect(mockUserSvc.getProfileById).toHaveBeenCalled();
  });

  it('should restore the form to the last loaded profile values on resetForm', async () => {
    fixture.detectChanges();
    await flush();

    component['payload'].update((p) => ({ ...p, first_name: 'Temporary' }));
    expect(component['payload']().first_name).toBe('Temporary');

    component['resetForm']();

    expect(component['payload']().first_name).toBe('Jane');
  });

  it('should crop and upload a new avatar image', async () => {
    fixture.detectChanges();
    await flush();

    // Provide a fake crop source so cropAndUpload has something to draw.
    component['cropImageSrc'].set('data:image/png;base64,AAA');

    // jsdom never decodes image data, so a real `Image` would never fire `onload`;
    // stub it to resolve immediately. Likewise stub the canvas 2D context/toBlob
    // since jsdom's canvas has no real rendering backend.
    class FakeImage {
      width = 200;
      height = 200;
      onload: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);

    const fakeCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(new Blob(['img'], { type: 'image/webp' })),
    );

    await component['cropAndUpload']();

    expect(mockAuthSvc.uploadAvatar).toHaveBeenCalled();
    expect(component['avatarUrl']()).toBe('https://cdn.test/avatars/u1.webp');
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Profile picture updated successfully');
    expect(component['uploadingAvatar']()).toBe(false);
  });

  it('should remove the current avatar', async () => {
    fixture.detectChanges();
    await flush();

    await component['removeAvatar']();

    expect(mockAuthSvc.deleteAvatar).toHaveBeenCalled();
    expect(component['avatarUrl']()).toBeNull();
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('Profile picture removed');
  });

  it('should show an error alert when the initial load fails', async () => {
    mockAuthSvc.getCurrentUser.mockRejectedValue(new Error('Session expired'));

    fixture.detectChanges();
    await flush();

    expect(component['error']()).toBe('Session expired');
    expect(mockAlertSvc.showError).toHaveBeenCalledWith('Session expired');
  });
});
