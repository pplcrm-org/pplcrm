import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';

import { CompanionSessionService } from '../gate/companion-api';
import { CanvassMe } from './canvass-me';
import { CanvassStore } from './canvass-store';

import type { CompanionOpAck, CompanionTurfPayload } from '@common';

/**
 * "End shift on this device" is a destructive button with two jobs the Me tab owns:
 * it must not become a new way to lose doors somebody knocked, and it must say what it
 * actually does now that it signs the phone out rather than only clearing storage.
 */

const TOKEN = 'tok-abc';

function turfPayload(): CompanionTurfPayload {
  return {
    campaign_name: 'Vote Rivera',
    turf_id: '4',
    turf_name: 'Turf 4',
    canvasser_name: 'Jordan Rivera',
    script: '',
    issues: [],
    expires_at: null,
    households: [
      {
        id: '10',
        walk_order: 1,
        address: '218 Alder St',
        street: 'Alder St',
        street_num: '218',
        apt: null,
        lat: null,
        lng: null,
        dnc: false,
        yard_sign: null,
        door_outcome: null,
        hh_survey: null,
        last_knock: null,
        people: [],
      },
    ],
    segment_claims: [],
  };
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('CanvassMe end shift', () => {
  let store: CanvassStore;
  let dialogs: ConfirmDialogService;
  let component: CanvassMe;
  let fetchMock: FetchMock;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
      if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
      if (String(url).endsWith('/results')) {
        const body = JSON.parse(String(init.body)) as { ops: { op_id: string }[] };
        return Promise.resolve(
          jsonResponse({ acks: body.ops.map((op): CompanionOpAck => ({ op_id: op.op_id, status: 'applied' })) }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({ imports: [CanvassMe], providers: [CanvassStore] });
    store = TestBed.inject(CanvassStore);
    dialogs = TestBed.inject(ConfirmDialogService);
    confirmSpy = vi.spyOn(dialogs, 'confirm').mockResolvedValue(true);

    // A verified device, so "end shift" has something real to sign out of.
    TestBed.inject(CompanionSessionService).saveSession('sess-abc', new Date(Date.now() + 86_400_000).toISOString());

    const fixture = TestBed.createComponent(CanvassMe);
    component = fixture.componentInstance;
    await store.load(TOKEN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** `endShift` is protected, which is right for the template and awkward for a spec. */
  function endShift(): Promise<void> {
    return (component as unknown as { endShift: () => Promise<void> }).endShift();
  }

  function messageShown(): string {
    const call = confirmSpy.mock.calls[0]?.[0] as { message?: string } | undefined;
    return call?.message ?? '';
  }

  it('syncs what it can before offering to destroy anything', async () => {
    // Held back so the result is genuinely unsynced when End shift is tapped.
    store.setWorkOffline(true);
    store.doorOutcome('10', 'no_answer');
    await flushMicrotasks();
    expect(store.queue()).toHaveLength(1);

    await endShift();
    await flushMicrotasks();

    // It went out first, so the volunteer is never warned about losing work that a
    // single flush would have saved.
    expect(store.queue()).toHaveLength(0);
    expect(messageShown()).not.toContain('will be lost');
  });

  it('warns, by count, about work that still could not be synced', async () => {
    store.online.set(false);
    store.doorOutcome('10', 'no_answer');
    await flushMicrotasks();

    await endShift();

    expect(messageShown()).toContain('1 result has not reached pplCRM yet and will be lost');
  });

  it('says the phone is being signed out, because that is what happens now', async () => {
    await endShift();
    await flushMicrotasks();

    expect(messageShown()).toContain('signs this phone out');
    expect(fetchMock).toHaveBeenCalledWith('/api/companion/session/end', expect.objectContaining({ method: 'POST' }));
  });

  it('does nothing at all when the volunteer cancels', async () => {
    confirmSpy.mockResolvedValue(false);
    store.online.set(false);
    store.doorOutcome('10', 'no_answer');
    await flushMicrotasks();

    await endShift();

    expect(store.queue()).toHaveLength(1);
    // Still signed in: cancelling must not half-end the shift.
    expect(TestBed.inject(CompanionSessionService).sessionToken()).toBe('sess-abc');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/session/end'))).toBe(false);
  });

  it('reports the shift as ended rather than as merely cleared', async () => {
    const alerts = TestBed.inject(AlertService);
    const success = vi.spyOn(alerts, 'showSuccess');

    await endShift();
    await flushMicrotasks();

    expect(success).toHaveBeenCalledWith(expect.stringContaining('signed out'));
  });
});
