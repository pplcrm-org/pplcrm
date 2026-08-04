import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../auth/auth-service';
import { SessionSettingsComponent } from './session-settings';
import { describeUserAgent } from './user-agent-label';

const THIS_DEVICE = {
  id: '10',
  ip_address: '198.51.100.4',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  created_at: new Date('2026-08-01T10:00:00Z'),
  last_used_at: new Date('2026-08-04T08:00:00Z'),
  expires_at: new Date('2026-08-05T10:00:00Z'),
  is_current: true,
};

const OLD_PHONE = {
  id: '11',
  ip_address: '203.0.113.9',
  user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1 Safari/604.1',
  created_at: new Date('2026-07-20T10:00:00Z'),
  last_used_at: new Date('2026-07-21T10:00:00Z'),
  expires_at: null,
  is_current: false,
};

describe('SessionSettingsComponent', () => {
  let component: SessionSettingsComponent;
  let fixture: ComponentFixture<SessionSettingsComponent>;
  // Hand-rolled test doubles; `no-explicit-any` is off for spec files in this workspace.
  let mockAuth: any;
  let mockAlerts: any;
  let mockDialog: any;

  async function build(sessions: unknown[] = [THIS_DEVICE, OLD_PHONE]): Promise<void> {
    TestBed.resetTestingModule();
    mockAuth = {
      listSessions: vi.fn().mockResolvedValue(sessions),
      revokeSession: vi.fn().mockResolvedValue({ success: true, was_current: false }),
      revokeOtherSessions: vi.fn().mockResolvedValue({ revoked: 1 }),
    };
    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };
    mockDialog = { confirm: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [SessionSettingsComponent],
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: AlertService, useValue: mockAlerts },
        { provide: ConfirmDialogService, useValue: mockDialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** The component's protected surface, reachable in a spec without loosening its real modifiers. */
  function api(): any {
    return component as any;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('lists the signed-in devices with a readable name for each', async () => {
    await build();

    expect(mockAuth.listSessions).toHaveBeenCalled();
    expect(
      api()
        .sessions()
        .map((s: { device: string }) => s.device),
    ).toEqual(['Chrome on macOS', 'Safari on iPhone']);
  });

  it('counts only the devices that are not this one', async () => {
    await build();

    expect(api().otherCount()).toBe(1);
    expect(api().revokeOthersLabel()).toBe('Sign out 1 other device');
    expect(
      api()
        .sessions()
        .filter((s: { is_current: boolean }) => s.is_current),
    ).toHaveLength(1);
  });

  it('pluralises the sign-out-everywhere-else label', async () => {
    await build([THIS_DEVICE, OLD_PHONE, { ...OLD_PHONE, id: '12' }]);

    expect(api().revokeOthersLabel()).toBe('Sign out 2 other devices');
  });

  it('confirms before ending a session, then drops the row', async () => {
    await build();

    await api().revokeSession(api().sessions()[1]);

    expect(mockDialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(mockAuth.revokeSession).toHaveBeenCalledWith('11');
    expect(
      api()
        .sessions()
        .map((s: { id: string }) => s.id),
    ).toEqual(['10']);
    expect(mockAlerts.showSuccess).toHaveBeenCalled();
  });

  it('does nothing when the confirmation is declined', async () => {
    await build();
    mockDialog.confirm.mockResolvedValue(false);

    await api().revokeSession(api().sessions()[1]);

    expect(mockAuth.revokeSession).not.toHaveBeenCalled();
    expect(api().sessions()).toHaveLength(2);
  });

  it('reports a failed revoke and re-reads the list rather than pretending it worked', async () => {
    await build();
    mockAuth.revokeSession.mockRejectedValue(new Error('Network down'));

    await api().revokeSession(api().sessions()[1]);

    expect(mockAlerts.showError).toHaveBeenCalledWith('Network down');
    // Two calls: the initial load and the re-read after the failure.
    expect(mockAuth.listSessions).toHaveBeenCalledTimes(2);
    expect(api().sessions()).toHaveLength(2);
  });

  it('keeps this browser when signing out everywhere else', async () => {
    await build();

    await api().revokeOthers();

    expect(mockAuth.revokeOtherSessions).toHaveBeenCalled();
    expect(
      api()
        .sessions()
        .map((s: { id: string }) => s.id),
    ).toEqual(['10']);
    expect(mockAlerts.showSuccess).toHaveBeenCalledWith('1 other device was signed out.');
  });

  it('reports a failed load instead of showing an empty list as if it were the truth', async () => {
    TestBed.resetTestingModule();
    mockAuth = { listSessions: vi.fn().mockRejectedValue(new Error('Could not reach the server')) };
    mockAlerts = { showSuccess: vi.fn(), showError: vi.fn() };
    mockDialog = { confirm: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [SessionSettingsComponent],
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: AlertService, useValue: mockAlerts },
        { provide: ConfirmDialogService, useValue: mockDialog },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockAlerts.showError).toHaveBeenCalledWith('Could not reach the server');
    expect((component as any).sessions()).toEqual([]);
  });
});

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox on Windows'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
  ])('reads %s as a device name', (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });

  it('says so rather than guessing when the header is missing or unfamiliar', () => {
    expect(describeUserAgent('')).toBe('Unrecognised browser');
    expect(describeUserAgent(null)).toBe('Unrecognised browser');
    expect(describeUserAgent('curl/8.4.0')).toBe('Unrecognised browser');
  });
});
