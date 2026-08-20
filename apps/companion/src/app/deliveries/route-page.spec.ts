import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';

import { RoutePage } from './route-page';
import { CompanionSessionService } from '../gate/companion-api';

/**
 * The whole volunteer deliveries page (/r/:token). The companion gate wraps it, so the
 * session service is mocked to answer 'ready' and the page's own REST calls are pinned
 * at the fetch seam: what URL and payload each tap sends, and which screen each server
 * answer produces. The map tab is never opened, so the pc-map placeholder never renders.
 */

interface StopOverrides {
  status?: 'pending' | 'delivered' | 'skipped';
  reason?: string | null;
}

function stop(id: string, seq: number, name: string, address: string, overrides: StopOverrides = {}) {
  return {
    id,
    seq,
    first_name: name,
    address,
    lat: 45 + seq / 10,
    lng: -75 - seq / 10,
    status: overrides.status ?? 'pending',
    reason: overrides.reason ?? null,
    acted_at: overrides.status && overrides.status !== 'pending' ? '2026-08-20T10:00:00Z' : null,
  };
}

function routeData(overrides: Record<string, unknown> = {}) {
  return {
    organization_name: 'Riverside Campaign',
    route_name: 'Route 7',
    status: 'in_progress',
    start: { lat: 45, lng: -75 },
    stops_total: 3,
    stops_delivered: 1,
    stops: [
      stop('s1', 1, 'Ann', '1 Elm St', { status: 'delivered' }),
      stop('s2', 2, 'Bob', '2 Oak Ave'),
      stop('s3', 3, 'Cara', '3 Pine Rd'),
    ],
    ...overrides,
  };
}

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

/** What the global test-setup fetch mock answers — pc-icon SVG loads go through here. */
const svgResponse = { ok: true, status: 200, text: () => Promise.resolve('<svg></svg>') };

type FetchLike = (input: unknown, init?: RequestInit) => Promise<unknown>;

describe('RoutePage', () => {
  let fetchMock: Mock<FetchLike>;
  let originalFetch: typeof globalThis.fetch;
  let showError: ReturnType<typeof vi.fn>;
  const fixtures: ComponentFixture<unknown>[] = [];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn<FetchLike>(() => Promise.resolve(svgResponse));
    globalThis.fetch = fetchMock as any;
    showError = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: CompanionSessionService,
          useValue: {
            getAccess: vi.fn().mockResolvedValue({ state: 'ready' }),
            headers: () => ({ 'X-Companion-Session': 'sess-1' }),
            endSession: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AlertService, useValue: { showError, showSuccess: vi.fn() } },
        { provide: ConfirmDialogService, useValue: { confirm: vi.fn().mockResolvedValue(true) } },
      ],
    });
  });

  afterEach(() => {
    while (fixtures.length) fixtures.pop()?.destroy();
    globalThis.fetch = originalFetch;
  });

  /** Route /api/deliveries requests through `handler`; everything else stays the SVG stub. */
  function stubApi(handler: (url: string, init?: RequestInit) => unknown): void {
    fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/deliveries/')) return Promise.resolve(handler(url, init));
      return Promise.resolve(svgResponse);
    });
  }

  /**
   * The gate's refresh → ready → load() → fetch → json() chain is several microtask
   * turns long, and zoneless whenStable does not track raw promises — so yield a
   * handful of turns, re-rendering after each. Deterministic: no timers involved.
   */
  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  async function createPage(): Promise<ComponentFixture<RoutePage>> {
    const fixture = TestBed.createComponent(RoutePage);
    fixtures.push(fixture);
    fixture.componentRef.setInput('token', 'tok-route');
    await settle(fixture);
    return fixture;
  }

  function buttonByText(fixture: ComponentFixture<unknown>, text: string): HTMLButtonElement {
    const buttons: HTMLButtonElement[] = Array.from(fixture.nativeElement.querySelectorAll('button'));
    const match = buttons.find((b) => (b.textContent ?? '').trim().includes(text));
    if (!match) throw new Error(`No button containing "${text}"`);
    return match;
  }

  /** The recorded fetch call matching `predicate`, throwing (not `!`-asserting) when absent. */
  function findCall(predicate: (url: string, init?: RequestInit) => boolean): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.find((args) => predicate(String(args[0]), args[1]));
    if (!call) throw new Error('expected fetch call not found');
    return { url: String(call[0]), init: call[1] ?? {} };
  }

  it('loads the route with the capability token plus session header and renders the stops', async () => {
    stubApi(() => jsonResponse(200, routeData()));

    const fixture = await createPage();

    const loadCall = findCall((url) => url === '/api/deliveries/r/tok-route');
    const headers = loadCall.init.headers as Record<string, string>;
    expect(headers['X-Companion-Session']).toBe('sess-1');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Route 7');
    expect(text).toContain('Riverside Campaign');
    expect(text).toContain('Ann');
    expect(text).toContain('1 Elm St');
    expect(text).toContain('Bob');
    expect(text).toContain('1 of 3 delivered');
  });

  it('marking the active stop delivered posts the action and re-renders from the response', async () => {
    const after = routeData({
      stops_delivered: 2,
      stops: [
        stop('s1', 1, 'Ann', '1 Elm St', { status: 'delivered' }),
        stop('s2', 2, 'Bob', '2 Oak Ave', { status: 'delivered' }),
        stop('s3', 3, 'Cara', '3 Pine Rd'),
      ],
    });
    stubApi((url, init) => (init?.method === 'POST' ? jsonResponse(200, after) : jsonResponse(200, routeData())));

    const fixture = await createPage();
    buttonByText(fixture, 'Mark delivered').click();
    await settle(fixture);

    const postCall = findCall((url, init) => init?.method === 'POST');
    expect(postCall.url).toBe('/api/deliveries/r/tok-route/stops/s2');
    const body = JSON.parse(String(postCall.init.body));
    expect(body.action).toBe('deliver');
    expect(body.reason).toBeNull();
    // A fresh op_id per tap is what makes a flaky-network retry apply exactly once.
    expect(body.op_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    expect(fixture.nativeElement.textContent).toContain('2 of 3 delivered');
    expect(fixture.nativeElement.textContent).toContain('Delivered just now');
  });

  it("skipping a stop sends the chosen reason and shows it on the stop's row", async () => {
    const after = routeData({
      stops: [
        stop('s1', 1, 'Ann', '1 Elm St', { status: 'delivered' }),
        stop('s2', 2, 'Bob', '2 Oak Ave', { status: 'skipped', reason: 'No safe spot' }),
        stop('s3', 3, 'Cara', '3 Pine Rd'),
      ],
    });
    stubApi((url, init) => (init?.method === 'POST' ? jsonResponse(200, after) : jsonResponse(200, routeData())));

    const fixture = await createPage();
    buttonByText(fixture, "Couldn't deliver").click();
    await settle(fixture);
    buttonByText(fixture, 'No safe spot').click();
    await settle(fixture);

    const postCall = findCall((url, init) => init?.method === 'POST');
    const body = JSON.parse(String(postCall.init.body));
    expect(body.action).toBe('skip');
    expect(body.reason).toBe('No safe spot');

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('No safe spot');
    expect(text).toContain('Skipped just now');
  });

  it('a fully handled route shows the completion state', async () => {
    stubApi(() =>
      jsonResponse(
        200,
        routeData({
          status: 'completed',
          stops_delivered: 3,
          stops: [
            stop('s1', 1, 'Ann', '1 Elm St', { status: 'delivered' }),
            stop('s2', 2, 'Bob', '2 Oak Ave', { status: 'delivered' }),
            stop('s3', 3, 'Cara', '3 Pine Rd', { status: 'skipped', reason: 'Wrong address' }),
          ],
        }),
      ),
    );

    const fixture = await createPage();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('All 3 stops handled. Thank you!');
    expect(text).toContain('3 of 3 handled');
    expect(text).toContain('Completed');
  });

  it('a failed save keeps the loaded route on screen and reports the error', async () => {
    stubApi((url, init) =>
      init?.method === 'POST' ? jsonResponse(500, { error: 'boom' }) : jsonResponse(200, routeData()),
    );

    const fixture = await createPage();
    buttonByText(fixture, 'Mark delivered').click();
    await settle(fixture);

    expect(showError).toHaveBeenCalledWith("Couldn't save that stop. Check your connection and try again.");
    // The route must NOT be discarded: the stop stays pending and retriable.
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Bob');
    expect(text).toContain('Mark delivered');
    expect(text).not.toContain("This route link isn't active");
  });

  it('a 401 on a save routes back through the gate as session-expired', async () => {
    stubApi((url, init) =>
      init?.method === 'POST' ? jsonResponse(401, { error: 'nope' }) : jsonResponse(200, routeData()),
    );

    const fixture = await createPage();
    buttonByText(fixture, 'Mark delivered').click();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain("Let's confirm it's you again");
  });

  it('an initial load failure offers a retry that recovers, never a dead end', async () => {
    let healthy = false;
    stubApi(() => (healthy ? jsonResponse(200, routeData()) : jsonResponse(503, { error: 'deploying' })));

    const fixture = await createPage();
    expect(fixture.nativeElement.textContent).toContain("Can't reach the server");

    healthy = true;
    buttonByText(fixture, 'Try again').click();
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('Route 7');
  });

  it('a dead token on the initial load shows the dead-link screen', async () => {
    stubApi(() => jsonResponse(404, { error: 'NOT_ACTIVE' }));

    const fixture = await createPage();

    expect(fixture.nativeElement.textContent).toContain("This route link isn't active");
  });
});
