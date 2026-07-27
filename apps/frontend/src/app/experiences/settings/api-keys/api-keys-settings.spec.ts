import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { ApiKeysSettingsComponent } from './api-keys-settings';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../services/settings-service';

const KEY_ONE = { slot: 1, preview: 'ws_aaaa', createdAt: '2026-07-01T00:00:00.000Z', lastUsedAt: null };
const KEY_TWO = {
  slot: 2,
  preview: 'ws_bbbb',
  createdAt: '2026-07-20T00:00:00.000Z',
  lastUsedAt: '2026-07-26T09:00:00.000Z',
};

describe('ApiKeysSettingsComponent', () => {
  let component: ApiKeysSettingsComponent;
  let fixture: ComponentFixture<ApiKeysSettingsComponent>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled test doubles
  let mockSettingsSvc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled test doubles
  let mockAlertSvc: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled test doubles
  let mockDialogSvc: any;

  async function build(keys: unknown[] = []): Promise<void> {
    // Some tests rebuild with a different key set; TestBed refuses a second configure after a
    // component exists, so reset here rather than only in beforeEach.
    TestBed.resetTestingModule();
    mockSettingsSvc = {
      listApiKeys: vi.fn().mockResolvedValue(keys),
      createApiKey: vi.fn().mockResolvedValue({ key: 'ws_secret_full_value', preview: 'ws_secr', slot: 1 }),
      revokeApiKey: vi.fn().mockResolvedValue(undefined),
    };
    mockAlertSvc = { showSuccess: vi.fn(), showError: vi.fn() };
    mockDialogSvc = { confirm: vi.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [ApiKeysSettingsComponent],
      providers: [
        { provide: SettingsService, useValue: mockSettingsSvc },
        { provide: AlertService, useValue: mockAlertSvc },
        { provide: ConfirmDialogService, useValue: mockDialogSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiKeysSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  /** The component's protected surface, reachable in a spec without loosening its real modifiers. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- protected members are the unit under test
  const api = (): any => component as any;

  it('loads existing keys on init', async () => {
    await build([KEY_ONE, KEY_TWO]);

    expect(mockSettingsSvc.listApiKeys).toHaveBeenCalledOnce();
    expect(api().keys()).toHaveLength(2);
  });

  it('allows a second key but not a third', async () => {
    await build([KEY_ONE]);
    expect(api().canCreate()).toBe(true);

    await build([KEY_ONE, KEY_TWO]);
    // Two is the whole rotation window; a third would be another live credential nobody watches.
    expect(api().canCreate()).toBe(false);
  });

  it('shows the raw key once after creating, and refreshes the list', async () => {
    await build([]);

    await api().onCreate();

    expect(api().newKey()).toBe('ws_secret_full_value');
    expect(mockSettingsSvc.listApiKeys).toHaveBeenCalledTimes(2); // init + post-create refresh
    expect(mockAlertSvc.showSuccess).toHaveBeenCalledWith('API key created');
  });

  it('does NOT toast its own error message when a call fails', async () => {
    await build([]);
    mockSettingsSvc.createApiKey.mockRejectedValue(new Error('API access requires the Grassroots plan'));

    await api().onCreate();

    // The tRPC error link already surfaced the server's message. A second showError here produced
    // two alerts for one failure — the exact regression this pins.
    expect(mockAlertSvc.showError).not.toHaveBeenCalled();
    expect(api().creating()).toBe(false); // and the button is not left spinning
  });

  it('warns differently for a key in active service than for one never used', async () => {
    await build([KEY_ONE, KEY_TWO]);

    await api().onRevoke(KEY_TWO); // lastUsedAt set
    expect(mockDialogSvc.confirm.mock.calls[0][0].message).toMatch(/used recently/i);

    mockDialogSvc.confirm.mockClear();
    await api().onRevoke(KEY_ONE); // lastUsedAt null
    expect(mockDialogSvc.confirm.mock.calls[0][0].message).toMatch(/never been used/i);
  });

  it('revokes the chosen slot only after confirmation', async () => {
    await build([KEY_ONE, KEY_TWO]);
    mockDialogSvc.confirm.mockResolvedValue(false);

    await api().onRevoke(KEY_ONE);
    expect(mockSettingsSvc.revokeApiKey).not.toHaveBeenCalled();

    mockDialogSvc.confirm.mockResolvedValue(true);
    await api().onRevoke(KEY_ONE);
    expect(mockSettingsSvc.revokeApiKey).toHaveBeenCalledWith(1);
  });

  it('clears the displayed raw key on revoke so it cannot outlive the credential', async () => {
    await build([]);
    await api().onCreate();
    expect(api().newKey()).not.toBe('');

    await api().onRevoke(KEY_ONE);
    expect(api().newKey()).toBe('');
  });
});
