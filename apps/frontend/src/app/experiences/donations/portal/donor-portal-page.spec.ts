import { Location } from '@angular/common';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DonorPortalApiError, DonorPortalApiService, DonorPortalSummary } from './donor-portal-api';
import { DonorPortalPage } from './donor-portal-page';

/**
 * The portal page's contract pins: every 404 is the dead-link state with a guided exit to /g; a
 * 200 renders the donor's sections; a pledge cancel never fires without the danger confirm; the
 * card-update redirect re-checks the API-supplied URL at the `window.location.href` sink; and a
 * `?card_session_id` on load confirms the Stripe session, toasts, and strips the param.
 *
 * Navigation is observed the same way as public-form.spec.ts: `window.location` cannot be replaced
 * in this jsdom (`Object.defineProperty` and `vi.stubGlobal` both throw), and jsdom never performs
 * a `javascript:` navigation — so the refusal is asserted as "href unchanged + the error toast the
 * component only reaches by refusing the value".
 */

const SUMMARY: DonorPortalSummary = {
  org_name: 'Riverdale Campaign',
  first_name: 'Dana',
  donations: [
    { id: 'd1', amount_cents: 5000, date: '2026-05-01', method: 'card', status: 'succeeded', refunded_at: null },
    {
      id: 'd2',
      amount_cents: 2500,
      date: '2026-04-01',
      method: 'check',
      status: 'refunded',
      refunded_at: '2026-04-15',
    },
  ],
  pledges: [
    {
      id: 'pl1',
      monthly_amount_cents: 2500,
      status: 'active',
      started_at: '2026-01-05',
      next_billing_date: '2026-09-05',
      cancelled_at: null,
      can_manage_card: true,
    },
  ],
  receipts: [{ id: 'r1', kind: 'per_gift', number: 'R-2026-0001', year: 2026, pdf_ready: true }],
  address: { street: '1 Main St', apt: '', city: 'Riverdale', state: 'ON', zip: 'A1A 1A1', country: 'Canada' },
  address_shared: false,
  subscriptions: [{ campaign_id: 'c1', campaign_name: 'Main office', status: 'subscribed' }],
  email_suppressed: false,
  volunteer_interest: false,
  yard_sign: null,
};

/** Lets every pending promise in the component's load chain settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DonorPortalPage', () => {
  let fixture: ComponentFixture<DonorPortalPage>;
  let apiMock: {
    getSummary: ReturnType<typeof vi.fn>;
    confirmCardUpdate: ReturnType<typeof vi.fn>;
    cancelPledge: ReturnType<typeof vi.fn>;
    startCardUpdate: ReturnType<typeof vi.fn>;
  };
  let dialogMock: { confirm: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> };
  let cardSessionId: string | null;

  beforeEach(async () => {
    cardSessionId = null;
    apiMock = {
      getSummary: vi.fn().mockResolvedValue(SUMMARY),
      confirmCardUpdate: vi.fn().mockResolvedValue({ status: 'ok' }),
      cancelPledge: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      startCardUpdate: vi.fn().mockResolvedValue({ url: 'javascript:alert(document.domain)' }),
    };
    dialogMock = { confirm: vi.fn().mockResolvedValue(false), prompt: vi.fn().mockResolvedValue(null) };

    await TestBed.configureTestingModule({
      imports: [DonorPortalPage],
      providers: [
        provideRouter([]),
        { provide: DonorPortalApiService, useValue: apiMock },
        { provide: ConfirmDialogService, useValue: dialogMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (key: string): string | null => (key === 'token' ? 'tok1' : null) },
              queryParamMap: {
                get: (key: string): string | null => (key === 'card_session_id' ? cardSessionId : null),
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function render(): Promise<DonorPortalPage> {
    fixture = TestBed.createComponent(DonorPortalPage);
    fixture.detectChanges(); // runs ngOnInit
    await flushMicrotasks();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function buttonByText(text: string): HTMLButtonElement {
    const el: HTMLElement = fixture.nativeElement;
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
    expect(button, `expected a "${text}" button`).toBeDefined();
    // The find above was just asserted non-null.
    return button!;
  }

  it('treats a 404 as the dead-link state with the "Email me a new link" exit to /g', async () => {
    apiMock.getSummary.mockRejectedValue(new DonorPortalApiError('gone', 404));

    const component = await render();

    expect(component['state']()).toBe('dead');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('This link is no longer active');
    expect(el.textContent).toContain('It may have expired or been replaced.');
    const exit = el.querySelector('a[href="/g"]');
    expect(exit, 'expected the routerLink exit to /g').toBeTruthy();
    expect(exit?.textContent).toContain('Email me a new link');
  });

  it('shows the error state (not dead) on a network failure', async () => {
    apiMock.getSummary.mockRejectedValue(new DonorPortalApiError('unreachable', 0));

    const component = await render();

    expect(component['state']()).toBe('error');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Try again');
  });

  it('renders every section from a 200 summary', async () => {
    const component = await render();

    expect(component['state']()).toBe('open');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Riverdale Campaign'); // org identity block
    expect(text).toContain('Your giving');
    expect(text).toContain('$25.00'); // pledge card amount
    expect(text).toContain('$50.00'); // gift row
    expect(text).toContain('Refunded'); // refunded gift stays visible, badged
    expect(text).toContain('R-2026-0001'); // receipt row
    expect(text).toContain('Used on your donation receipts.'); // address helper line
    expect(text).toContain('Email preferences');
    expect(text).toContain('Get involved');
  });

  it('never cancels a pledge without the confirm; cancels after it', async () => {
    await render();

    dialogMock.confirm.mockResolvedValue(false);
    buttonByText('Cancel monthly gift').click();
    await flushMicrotasks();
    expect(dialogMock.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'danger',
        emphasizeCancel: true,
        title: expect.stringContaining('$25.00'),
        confirmText: 'Cancel monthly gift',
        cancelText: 'Keep giving',
      }),
    );
    expect(dialogMock.confirm.mock.calls[0][0].title).toContain('Riverdale Campaign');
    expect(apiMock.cancelPledge).not.toHaveBeenCalled();

    dialogMock.confirm.mockResolvedValue(true);
    buttonByText('Cancel monthly gift').click();
    await flushMicrotasks();
    expect(apiMock.cancelPledge).toHaveBeenCalledWith('tok1', 'pl1');
  });

  it('refuses a javascript: card-update URL at the window.location.href sink', async () => {
    const alerts = TestBed.inject(AlertService);
    const showError = vi.spyOn(alerts, 'showError');
    await render();

    const hrefBefore = window.location.href;
    buttonByText('Update card').click();
    await flushMicrotasks();

    expect(apiMock.startCardUpdate).toHaveBeenCalledWith('tok1', 'pl1');
    expect(window.location.href).toBe(hrefBefore);
    // The error toast is the branch the component only reaches by refusing the value.
    expect(showError).toHaveBeenCalled();
  });

  it('confirms a ?card_session_id on load, toasts, and strips the param', async () => {
    cardSessionId = 'cs_123';
    const alerts = TestBed.inject(AlertService);
    const showSuccess = vi.spyOn(alerts, 'showSuccess');
    const location = TestBed.inject(Location);
    const replaceState = vi.spyOn(location, 'replaceState');

    await render();

    expect(apiMock.confirmCardUpdate).toHaveBeenCalledWith('tok1', 'cs_123');
    expect(showSuccess).toHaveBeenCalledWith('Your card has been updated.');
    expect(replaceState).toHaveBeenCalled();
    const replaced = String(replaceState.mock.calls[0][0]);
    expect(replaced).not.toContain('card_session_id');
  });

  it('does not call the confirm endpoint when there is no card_session_id', async () => {
    await render();
    expect(apiMock.confirmCardUpdate).not.toHaveBeenCalled();
  });
});
