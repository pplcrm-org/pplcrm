import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionOpAck, CompanionTurfPayload } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { CanvassStore } from './canvass-store';

const TOKEN = 'tok-abc';
const QUEUE_KEY = `pc-canvass-queue:${TOKEN}`;

function turfPayload(): CompanionTurfPayload {
  return {
    campaign_name: 'Vote Rivera',
    turf_name: 'Turf 4',
    canvasser_name: 'Jordan Rivera',
    script: '',
    issues: ['Roads', 'Housing'],
    expires_at: null,
    households: [
      {
        id: '10',
        walk_order: 1,
        address: '218 Alder St',
        lat: null,
        lng: null,
        dnc: false,
        door_outcome: null,
        hh_survey: null,
        people: [{ id: '1', name: 'Alice Door', dnc: false, result: null, survey: null }],
      },
      {
        id: '11',
        walk_order: 2,
        address: '220 Alder St',
        lat: null,
        lng: null,
        dnc: false,
        door_outcome: null,
        hh_survey: null,
        people: [],
      },
    ],
  };
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

function acksFor(ops: { op_id: string }[], status: CompanionOpAck['status'] = 'applied'): { acks: CompanionOpAck[] } {
  return { acks: ops.map((op) => ({ op_id: op.op_id, status })) };
}

/** Respond to GET with the payload and to every POST by acking all sent ops. */
function autoAckFetch(): FetchMock {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
    const body = JSON.parse(String(init.body)) as { ops: { op_id: string }[] };
    return Promise.resolve(jsonResponse(acksFor(body.ops)));
  });
}

function postedOps(
  fetchMock: FetchMock,
  call: number,
): { op_id: string; type: string; payload: Record<string, unknown> }[] {
  const posts = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
  const init = posts[call]?.[1] as RequestInit;
  return (JSON.parse(String(init.body)) as { ops: { op_id: string; type: string; payload: Record<string, unknown> }[] })
    .ops;
}

async function flushMicrotasks(): Promise<void> {
  // Several awaits deep (fetch → json → acks) — a few macrotask turns settles it.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('CanvassStore', () => {
  let store: CanvassStore;
  let alerts: AlertService;
  let fetchMock: FetchMock;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = autoAckFetch();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({ providers: [CanvassStore] });
    store = TestBed.inject(CanvassStore);
    alerts = TestBed.inject(AlertService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('load', () => {
    it('fetches the payload with the session header path and exposes households', async () => {
      await store.load(TOKEN);
      expect(fetchMock).toHaveBeenCalledWith(`/api/canvass/t/${TOKEN}`, expect.anything());
      expect(store.payload()?.turf_name).toBe('Turf 4');
      expect(store.households()).toHaveLength(2);
    });

    it('flags the session as expired on 401/403 so the page re-gates', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 403));
      await store.load(TOKEN);
      expect(store.sessionExpired()).toBe(true);
      expect(store.payload()).toBeNull();
    });

    it('surfaces a load error on other failures', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
      await store.load(TOKEN);
      expect(store.loadError()).toContain('Could not load your turf');
    });

    it('restores a persisted queue and flushes it after load', async () => {
      const op = {
        op_id: 'persisted-1',
        recorded_at: new Date().toISOString(),
        type: 'door_outcome',
        payload: { household_id: '10', outcome: 'no_answer' },
      };
      localStorage.setItem(QUEUE_KEY, JSON.stringify([{ op, label: 'Nobody home · 218 Alder St' }]));
      await store.load(TOKEN);
      await flushMicrotasks();
      expect(postedOps(fetchMock, 0).map((o) => o.op_id)).toEqual(['persisted-1']);
      expect(store.queue()).toHaveLength(0);
      // The restored op stayed in the overlay: the door shows its outcome.
      expect(store.householdById('10')?.door_outcome).toBe('no_answer');
    });

    it('ignores corrupt persisted queues', async () => {
      localStorage.setItem(QUEUE_KEY, '{not json');
      await store.load(TOKEN);
      expect(store.queue()).toHaveLength(0);
    });
  });

  describe('actions + optimistic overlay', () => {
    beforeEach(async () => {
      await store.load(TOKEN);
    });

    it('submitSurvey overlays the person as canvassed and syncs one op', async () => {
      store.submitSurvey('10', '1', {
        support: 'supporter',
        issues: ['Roads'],
        wants_volunteer: true,
        wants_yard_sign: false,
        set_dnc: false,
        contact_phone: null,
        contact_email: null,
        subscribe: false,
        notes: 'Nice porch',
      });
      const alice = store.householdById('10')?.people[0];
      expect(alice?.result).toBe('canvassed');
      expect(alice?.survey?.support).toBe('supporter');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
      expect(store.syncStatus()).toBe('idle');
      expect(store.lastSyncedAt()).not.toBeNull();
      const [op] = postedOps(fetchMock, 0);
      expect(op.type).toBe('survey');
      expect(op.payload['notes']).toBe('Nice porch');
    });

    it('labels queue entries with the person and address', () => {
      store.online.set(false);
      store.personResult('10', '1', 'not_home');
      expect(store.queue()[0].label).toBe('Alice Door · 218 Alder St');
    });

    it('doorOutcome toggles: same outcome again enqueues clear_outcome and reverts the door', async () => {
      expect(store.doorOutcome('10', 'no_answer')).toBe('set');
      await flushMicrotasks();
      expect(store.householdById('10')?.door_outcome).toBe('no_answer');
      expect(store.doorOutcome('10', 'no_answer')).toBe('cleared');
      await flushMicrotasks();
      expect(store.householdById('10')?.door_outcome).toBeNull();
      expect(postedOps(fetchMock, 1)[0].type).toBe('clear_outcome');
    });

    it('addPerson shows a temp person immediately', () => {
      store.online.set(false);
      store.addPerson('11', 'New Neighbor');
      const added = store.householdById('11')?.people[0];
      expect(added?.name).toBe('New Neighbor');
      expect(added?.id.startsWith('tmp-')).toBe(true);
    });

    it('swaps the temp id for the server id on ack, including dependent queued ops', async () => {
      store.online.set(false);
      store.addPerson('11', 'New Neighbor');
      const tempId = store.householdById('11')?.people[0]?.id ?? '';
      store.submitSurvey('11', tempId, {
        support: 'undecided',
        issues: [],
        wants_volunteer: false,
        wants_yard_sign: false,
        set_dnc: false,
        contact_phone: null,
        contact_email: null,
        subscribe: false,
        notes: null,
      });
      expect(store.queue()).toHaveLength(2);

      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        const body = JSON.parse(String(init.body)) as { ops: { op_id: string; type: string }[] };
        const acks = body.ops.map(
          (op): CompanionOpAck =>
            op.type === 'person_create'
              ? { op_id: op.op_id, status: 'applied', person_id: '55' }
              : { op_id: op.op_id, status: 'applied' },
        );
        return Promise.resolve(jsonResponse({ acks }));
      });

      store.online.set(true);
      await store.flush();
      await flushMicrotasks();

      // First POST held back the survey (temp person), second sent it with the real id.
      expect(postedOps(fetchMock, 0).map((o) => o.type)).toEqual(['person_create']);
      const second = postedOps(fetchMock, 1);
      expect(second.map((o) => o.type)).toEqual(['survey']);
      expect(second[0].payload['person_id']).toBe('55');
      expect(store.queue()).toHaveLength(0);
      expect(store.householdById('11')?.people[0]?.id).toBe('55');
    });
  });

  describe('flush semantics', () => {
    beforeEach(async () => {
      await store.load(TOKEN);
    });

    it('treats duplicate acks as success', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        const body = JSON.parse(String(init.body)) as { ops: { op_id: string }[] };
        return Promise.resolve(jsonResponse(acksFor(body.ops, 'duplicate')));
      });
      store.doorOutcome('10', 'refused');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
      expect(store.syncStatus()).toBe('idle');
      // Duplicate = already applied: the overlay keeps the outcome.
      expect(store.householdById('10')?.door_outcome).toBe('refused');
    });

    it('drops a rejected op, reverts its overlay, and toasts the error', async () => {
      const showError = vi.spyOn(alerts, 'showError');
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        const body = JSON.parse(String(init.body)) as { ops: { op_id: string }[] };
        return Promise.resolve(
          jsonResponse({
            acks: body.ops.map((op): CompanionOpAck => ({ op_id: op.op_id, status: 'rejected', error: 'DNC door' })),
          }),
        );
      });
      store.doorOutcome('10', 'refused');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
      expect(store.householdById('10')?.door_outcome).toBeNull();
      expect(showError).toHaveBeenCalledWith(expect.stringContaining('DNC door'));
    });

    it('keeps the queue and goes offline on a network failure, then drains on the online event', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        return Promise.reject(new TypeError('network down'));
      });
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(1);
      expect(store.syncStatus()).toBe('offline');
      // The queue survived to localStorage for a reload.
      expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toHaveLength(1);

      fetchMock.mockImplementation(autoAckFetch());
      window.dispatchEvent(new Event('online'));
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
      expect(store.syncStatus()).toBe('idle');
    });

    it('sets offline without posting when the browser is offline', async () => {
      store.online.set(false);
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.syncStatus()).toBe('offline');
      expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
    });

    it('sets error and keeps the queue on a server error', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        return Promise.resolve(jsonResponse({ error: 'boom' }, 500));
      });
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.syncStatus()).toBe('error');
      expect(store.queue()).toHaveLength(1);
    });

    it('expires the session when a flush hits 403', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        return Promise.resolve(jsonResponse({ error: 'revoked' }, 403));
      });
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.sessionExpired()).toBe(true);
    });

    it('work offline holds the queue; Sync now flushes anyway', async () => {
      store.setWorkOffline(true);
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(1);
      expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
      await store.flush(true); // "Sync now"
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
    });

    it('toggling work offline back off flushes automatically', async () => {
      store.setWorkOffline(true);
      store.doorOutcome('10', 'no_answer');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(1);
      store.setWorkOffline(false);
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
    });
  });

  describe('undo', () => {
    beforeEach(async () => {
      await store.load(TOKEN);
    });

    it('removes a still-queued op and reverts its overlay', async () => {
      store.online.set(false);
      store.personResult('10', '1', 'not_home');
      expect(store.householdById('10')?.people[0]?.result).toBe('not_home');
      expect(store.canUndo()).toBe(true);
      expect(store.undo()).toBe(true);
      expect(store.queue()).toHaveLength(0);
      expect(store.householdById('10')?.people[0]?.result).toBeNull();
      expect(store.canUndo()).toBe(false);
    });

    it('enqueues clear_outcome for a door outcome that already synced', async () => {
      store.doorOutcome('10', 'refused');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(0);
      expect(store.canUndo()).toBe(true);
      expect(store.undo()).toBe(true);
      await flushMicrotasks();
      expect(store.householdById('10')?.door_outcome).toBeNull();
      expect(postedOps(fetchMock, 1)[0].type).toBe('clear_outcome');
    });

    it('blocks undo for an op in the in-flight batch and converges after the ack', async () => {
      let resolvePost: ((r: Response) => void) | undefined;
      let sentOps: { op_id: string }[] = [];
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        sentOps = (JSON.parse(String(init.body)) as { ops: { op_id: string }[] }).ops;
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      });

      store.personResult('10', '1', 'not_home');
      // The POST is unresolved: the op is queued AND in the in-flight batch.
      expect(store.queue()).toHaveLength(1);
      expect(store.syncStatus()).toBe('syncing');
      // The server may already have applied it, so it is not revocable now.
      expect(store.canUndo()).toBe(false);
      expect(store.undo()).toBe(false);
      expect(store.householdById('10')?.people[0]?.result).toBe('not_home');

      resolvePost?.(jsonResponse(acksFor(sentOps)));
      await flushMicrotasks();
      // Converged: server applied the op and the local overlay kept it.
      expect(store.queue()).toHaveLength(0);
      expect(store.syncStatus()).toBe('idle');
      expect(store.householdById('10')?.people[0]?.result).toBe('not_home');
    });

    it('undoes an in-flight door outcome with the compensating clear, never by dropping the op', async () => {
      const resolvers: ((r: Response) => void)[] = [];
      const bodies: { op_id: string; type: string }[][] = [];
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        bodies.push((JSON.parse(String(init.body)) as { ops: { op_id: string; type: string }[] }).ops);
        return new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        });
      });

      store.doorOutcome('10', 'refused');
      // Door outcomes stay undoable mid-flight (inverse op is safe either way).
      expect(store.canUndo()).toBe(true);
      expect(store.undo()).toBe(true);
      // The in-flight op stayed queued; the inverse landed behind it in order.
      expect(store.queue().map((e) => e.op.type)).toEqual(['door_outcome', 'clear_outcome']);
      expect(store.householdById('10')?.door_outcome).toBeNull();

      resolvers[0]?.(jsonResponse(acksFor(bodies[0] ?? [])));
      await flushMicrotasks();
      // The flush loop sent the clear as its own follow-up batch; ack it too.
      expect(bodies[1]?.map((o) => o.type)).toEqual(['clear_outcome']);
      resolvers[1]?.(jsonResponse(acksFor(bodies[1] ?? [])));
      await flushMicrotasks();
      // Server saw refused then cleared; the local replay agrees.
      expect(store.queue()).toHaveLength(0);
      expect(store.householdById('10')?.door_outcome).toBeNull();
    });

    it('cannot undo a survey once it synced', async () => {
      store.submitSurvey('10', '1', {
        support: 'supporter',
        issues: [],
        wants_volunteer: false,
        wants_yard_sign: false,
        set_dnc: false,
        contact_phone: null,
        contact_email: null,
        subscribe: false,
        notes: null,
      });
      await flushMicrotasks();
      expect(store.canUndo()).toBe(false);
      expect(store.undo()).toBe(false);
    });
  });

  describe('endShift', () => {
    it('clears the persisted queue, the overlay, and returns to landing', async () => {
      await store.load(TOKEN);
      store.online.set(false);
      store.doorOutcome('10', 'no_answer');
      store.view.set({ kind: 'me' });
      expect(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')).toHaveLength(1);
      store.endShift();
      expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
      expect(store.queue()).toHaveLength(0);
      expect(store.householdById('10')?.door_outcome).toBeNull();
      expect(store.view()).toEqual({ kind: 'landing' });
    });
  });
});
