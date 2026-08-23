import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../auth/auth-service';
import { DonationsService } from '../../../services/api/donations-service';
import { DonorPortalPanel } from './donor-portal-panel';

/**
 * The staff panel's three states (no link / active / just-sent with Copy link), the danger confirm
 * in front of Revoke, and the demo-mode split: Send is explained-disabled while Create + copy link
 * stays live, because minting is not mail.
 */

const NO_LINKS = { live_count: 0, last_created_at: null, last_used_at: null, expires_at: null };
const ACTIVE = {
  live_count: 2,
  last_created_at: '2026-08-01T00:00:00Z',
  last_used_at: '2026-08-10T00:00:00Z',
  expires_at: '2027-08-01T00:00:00Z',
};

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DonorPortalPanel', () => {
  let fixture: ComponentFixture<DonorPortalPanel>;
  let donationsMock: {
    getPortalLinkStatus: ReturnType<typeof vi.fn>;
    sendPortalLink: ReturnType<typeof vi.fn>;
    revokePortalLinks: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { confirm: ReturnType<typeof vi.fn> };
  let userSignal: ReturnType<typeof signal<{ tenant_demo_mode_at: string | null } | null>>;

  beforeEach(async () => {
    donationsMock = {
      getPortalLinkStatus: vi.fn().mockResolvedValue(NO_LINKS),
      sendPortalLink: vi
        .fn()
        .mockResolvedValue({ url: 'https://org.pplforms.com/g/tok123', emailed: true, expires_at: '2027-08-21' }),
      revokePortalLinks: vi.fn().mockResolvedValue({ revoked: 2 }),
    };
    dialogMock = { confirm: vi.fn().mockResolvedValue(false) };
    userSignal = signal<{ tenant_demo_mode_at: string | null } | null>({ tenant_demo_mode_at: null });

    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    await TestBed.configureTestingModule({
      imports: [DonorPortalPanel],
      providers: [
        { provide: DonationsService, useValue: donationsMock },
        { provide: ConfirmDialogService, useValue: dialogMock },
        { provide: AuthService, useValue: { getUserSignal: () => userSignal } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function render(): Promise<DonorPortalPanel> {
    fixture = TestBed.createComponent(DonorPortalPanel);
    fixture.componentRef.setInput('personId', 'p1');
    fixture.detectChanges(); // runs the load effect
    await flushMicrotasks();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function buttonByText(text: string): HTMLButtonElement {
    const el: HTMLElement = fixture.nativeElement;
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
    expect(button, `expected a "${text}" button`).toBeDefined();
    // The find above was just asserted non-null.
    return button!;
  }

  it('narrates the no-link state with a Send action', async () => {
    await render();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(donationsMock.getPortalLinkStatus).toHaveBeenCalledWith('p1');
    expect(text).toContain('No giving-portal link has been sent.');
    expect(buttonByText('Send portal link').disabled).toBe(false);
  });

  it('narrates the active state honestly: sent/expires dates, Send adds, Revoke stops all', async () => {
    donationsMock.getPortalLinkStatus.mockResolvedValue(ACTIVE);

    await render();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Portal link sent');
    expect(text).toContain('expires');
    expect(text).toContain('adds a new link without turning off');
    expect(text).toContain('Revoke stops every live link immediately');
    expect(buttonByText('Send new link')).toBeTruthy();
    expect(buttonByText('Revoke')).toBeTruthy();
  });

  it('offers Copy link after a send and copies via the clipboard', async () => {
    await render();

    buttonByText('Send portal link').click();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(donationsMock.sendPortalLink).toHaveBeenCalledWith('p1');
    const copy = buttonByText('Copy link');
    copy.click();
    await flushMicrotasks();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://org.pplforms.com/g/tok123');
  });

  it('never revokes without the danger confirm; revokes after it', async () => {
    donationsMock.getPortalLinkStatus.mockResolvedValue(ACTIVE);
    await render();

    dialogMock.confirm.mockResolvedValue(false);
    buttonByText('Revoke').click();
    await flushMicrotasks();
    expect(dialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger', confirmText: 'Revoke all links' }),
    );
    expect(String(dialogMock.confirm.mock.calls[0][0].message)).toContain('stops working immediately');
    expect(donationsMock.revokePortalLinks).not.toHaveBeenCalled();

    dialogMock.confirm.mockResolvedValue(true);
    buttonByText('Revoke').click();
    await flushMicrotasks();
    expect(donationsMock.revokePortalLinks).toHaveBeenCalledWith('p1');
  });

  it('demo mode: Send is explained-disabled, Create + copy link stays live', async () => {
    userSignal.set({ tenant_demo_mode_at: '2026-08-01T00:00:00Z' });

    await render();

    const send = buttonByText('Send portal link');
    expect(send.disabled).toBe(true);
    expect(send.closest('.tooltip')?.getAttribute('data-tip')).toContain('Emailing donors is locked during the demo');

    const create = buttonByText('Create + copy link');
    expect(create.disabled).toBe(false);
    create.click();
    await flushMicrotasks();
    expect(donationsMock.sendPortalLink).toHaveBeenCalledWith('p1');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://org.pplforms.com/g/tok123');
  });
});
