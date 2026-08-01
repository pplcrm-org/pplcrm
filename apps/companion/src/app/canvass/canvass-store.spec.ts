import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompanionHousehold, CompanionOpAck, CompanionPerson, CompanionTurfPayload } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { CanvassStore } from './canvass-store';

/** A resident with every payload field defaulted, so a test states only what it is about. */
function person(over: Partial<CompanionPerson> & { id: string; name: string }): CompanionPerson {
  return {
    last_name: null,
    dnc: false,
    support: null,
    voting_status: null,
    deceased: false,
    senior: null,
    result: null,
    survey: null,
    ...over,
  };
}

/** Likewise for a door. */
function door(over: Partial<CompanionHousehold> & { id: string; walk_order: number }): CompanionHousehold {
  return {
    address: '',
    street: null,
    street_num: null,
    apt: null,
    lat: null,
    lng: null,
    dnc: false,
    yard_sign: false,
    door_outcome: null,
    hh_survey: null,
    people: [],
    ...over,
  };
}

const TOKEN = 'tok-abc';
const TURF_ID = '4';
/** Per-device, not per-token: a volunteer can arrive on /t/:token or on /canvass and
 *  must find the same unsynced queue either way. */
const QUEUE_KEY = 'pc-canvass-queue';
const LEGACY_QUEUE_KEY = `pc-canvass-queue:${TOKEN}`;

function turfPayload(): CompanionTurfPayload {
  return {
    campaign_name: 'Vote Rivera',
    // Results post against the turf id, not the link token: a volunteer can switch
    // turfs mid-shift and every queued op has to go back where it was recorded.
    turf_id: TURF_ID,
    turf_name: 'Turf 4',
    canvasser_name: 'Jordan Rivera',
    script: '',
    issues: ['Roads', 'Housing'],
    expires_at: null,
    households: [
      door({
        id: '10',
        walk_order: 1,
        address: '218 Alder St',
        street: 'Alder St',
        street_num: '218',
        people: [person({ id: '1', name: 'Alice Door', last_name: 'Door' })],
      }),
      door({ id: '11', walk_order: 2, address: '220 Scott Blvd', street: 'Scott Blvd', street_num: '220' }),
    ],
    segment_claims: [],
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
  // Only results batches — street claims POST to the same turf and would otherwise shift
  // every index here by one the moment a test scopes the list to a street.
  const posts = fetchMock.mock.calls.filter(
    (c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/results'),
  );
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

  describe('session bootstrap with a preferred turf', () => {
    it('opens the turf a join link named instead of the picker', async () => {
      await store.bootstrapFromSession(TURF_ID);
      expect(fetchMock).toHaveBeenCalledWith(`/api/canvass/turf/${TURF_ID}`, expect.anything());
      expect(store.payload()?.turf_id).toBe(TURF_ID);
      expect(store.view().kind).toBe('list');
      // The choices list was never needed — the link already answered "which turf".
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/my-turfs'))).toBe(false);
    });

    it('falls back to the picker when the named turf cannot be opened', async () => {
      const choices = { may_roam: true, mine: [], available: [] };
      fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
        if (String(url).includes('/my-turfs')) return Promise.resolve(jsonResponse(choices));
        return Promise.resolve(jsonResponse({ error: 'nope' }, 404));
      });
      vi.stubGlobal('fetch', fetchMock);
      await store.bootstrapFromSession('9');
      expect(store.view().kind).toBe('picker');
      // The failed direct open must not leave an error banner on the picker.
      expect(store.loadError()).toBeNull();
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

  describe('queue key migration', () => {
    it('adopts a queue written under the old per-token key', async () => {
      const op = {
        op_id: 'legacy-1',
        recorded_at: new Date().toISOString(),
        type: 'door_outcome',
        payload: { household_id: '10', outcome: 'no_answer' },
      };
      localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify([{ op, label: 'Nobody home · 218 Alder St' }]));
      fetchMock.mockResolvedValue(jsonResponse(turfPayload()));

      await store.load(TOKEN);

      // Picked up, not stranded — a deploy must never eat an offline shift.
      expect(store.queue().some((e) => e.op.op_id === 'legacy-1')).toBe(true);
      expect(localStorage.getItem(LEGACY_QUEUE_KEY)).toBeNull();
    });
  });

  describe('street scope', () => {
    it('opens on the street holding the next open door, not on the whole turf', async () => {
      await store.load(TOKEN);

      // A turf is a neighbourhood and a shift is a street. Landing on "all doors" made
      // narrowing the volunteer's first job, so the store does it for them.
      expect(store.activeSegment()?.street).toBe('Alder St');
      expect(store.scopedHouseholds().map((h) => h.id)).toEqual(['10']);
      // Turf-wide stats stay turf-wide — the scope answers a different question.
      expect(store.stats().doors_total).toBe(2);
    });

    it('does not claim the street it defaulted to', async () => {
      await store.load(TOKEN);
      await flushMicrotasks();

      // A claim tells the group "I am standing here". The app guessing on their behalf
      // would put a volunteer's name on a street nobody has walked to yet.
      const claims = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/segment'),
      );
      expect(claims).toHaveLength(0);
    });

    it('narrows to a street the volunteer picks', async () => {
      await store.load(TOKEN);

      const scott = store.segments().find((seg) => seg.street === 'Scott Blvd');
      store.segmentKey.set(scott?.key ?? null);

      expect(store.scopedHouseholds().map((h) => h.id)).toEqual(['11']);
      expect(store.activeSegment()?.street).toBe('Scott Blvd');
      expect(store.stats().doors_total).toBe(2);
    });

    it('moves the next-door ring to the next door on the scoped street', async () => {
      await store.load(TOKEN);
      expect(store.nextDoorId()).toBe('10');

      const scott = store.segments().find((seg) => seg.street === 'Scott Blvd');
      store.segmentKey.set(scott?.key ?? null);
      expect(store.nextDoorId()).toBe('11');
    });

    it('leaves a one-street turf alone', async () => {
      const payload = turfPayload();
      payload.households[1] = door({ id: '11', walk_order: 2, address: '220 Alder St', street: 'Alder St' });
      fetchMock.mockResolvedValue(jsonResponse(payload));

      await store.load(TOKEN);

      // Scoping to the only street would say "you are on Alder St" as if that were a
      // choice, and hide nothing. There is nothing to narrow.
      expect(store.segmentKey()).toBeNull();
      expect(store.scopedHouseholds()).toHaveLength(2);
    });

    it('falls back to the whole turf when the scoped street is gone', async () => {
      await store.load(TOKEN);
      store.segmentKey.set('a street that left with a list refresh');
      // An empty list would blame the volunteer for something the turf did.
      expect(store.scopedHouseholds()).toHaveLength(2);
      expect(store.activeSegment()).toBeNull();
    });

    it('never carries a scope across turfs', async () => {
      await store.load(TOKEN);
      const scott = store.segments().find((seg) => seg.street === 'Scott Blvd');
      store.segmentKey.set(scott?.key ?? null);

      await store.switchTurf(TURF_ID);

      // The new turf gets its OWN default (the street of its next open door), never the
      // street that happened to be chosen on the turf being left.
      expect(store.activeSegment()?.street).toBe('Alder St');
    });
  });

  describe('apartment buildings', () => {
    /** Three units at one address, plus the two ordinary doors from the fixture. */
    function withBuilding(): CompanionTurfPayload {
      const payload = turfPayload();
      payload.households.push(
        ...['101', '102', '1003'].map((apt, i) =>
          door({
            id: `2${i}`,
            walk_order: 3 + i,
            address: `58 Huron Ave N, Unit ${apt}`,
            street: 'Huron Ave N',
            street_num: '58',
            apt,
          }),
        ),
      );
      return payload;
    }

    it('folds units into one row and keeps the walk order of its first unit', async () => {
      fetchMock.mockResolvedValue(jsonResponse(withBuilding()));
      await store.load(TOKEN);
      store.segmentKey.set(store.segments().find((s) => s.street === 'Huron Ave N')?.key ?? null);

      const entries = store.walkEntries();
      expect(entries).toHaveLength(1);
      const only = entries[0];
      expect(only?.kind).toBe('building');
      if (only?.kind !== 'building') throw new Error('expected a building');
      // The shared street address, with the unit stripped off.
      expect(only.address).toBe('58 Huron Ave N');
      expect(only.walkOrder).toBe(3);
      // Numeric where it can be: 1003 sorts after 102, not between 101 and 102.
      expect(only.units.map((u) => u.apt)).toEqual(['101', '102', '1003']);
    });

    it('rings the building that holds the next open door', async () => {
      fetchMock.mockResolvedValue(jsonResponse(withBuilding()));
      await store.load(TOKEN);
      store.segmentKey.set(store.segments().find((s) => s.street === 'Huron Ave N')?.key ?? null);

      // The volunteer can only tap the row they can see, so the ring has to land on it.
      expect(store.nextDoorId()).toBe('20');
      expect(store.nextEntryKey()).toBe(store.walkEntries()[0]?.key);
      expect(store.nextEntryKey()).not.toBe('20');
    });

    it('leaves a lone unit as a plain door', async () => {
      const payload = turfPayload();
      payload.households.push(
        door({ id: '30', walk_order: 3, address: '9 Pine St, Unit 2', street: 'Pine St', street_num: '9', apt: '2' }),
      );
      fetchMock.mockResolvedValue(jsonResponse(payload));
      await store.load(TOKEN);
      store.segmentKey.set(store.segments().find((s) => s.street === 'Pine St')?.key ?? null);

      // A row that says "1 unit" and opens a list of one is pure ceremony.
      expect(store.walkEntries().map((e) => e.kind)).toEqual(['door']);
    });
  });

  describe('advisory street claims', () => {
    /** Every POST that is a claim rather than a results batch. */
    function claimPosts(): { street_key: string | null; street: string | null }[] {
      return fetchMock.mock.calls
        .filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST' && String(c[0]).endsWith('/segment'))
        .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as { street_key: string | null; street: string });
    }

    it('scopes immediately and tells the group afterwards', async () => {
      await store.load(TOKEN);
      const scott = store.segments().find((seg) => seg.street === 'Scott Blvd');

      store.chooseSegment(scott?.key ?? null);

      // The scope is local and instant — a volunteer narrowing to the street they are
      // standing on never waits on the network.
      expect(store.scopedHouseholds().map((h) => h.id)).toEqual(['11']);
      await flushMicrotasks();
      expect(claimPosts()).toEqual([{ street_key: scott?.key, street: 'Scott Blvd' }]);
    });

    it('releases the street when the volunteer goes back to the whole turf', async () => {
      await store.load(TOKEN);
      store.chooseSegment(store.segments()[0]?.key ?? null);
      await flushMicrotasks();

      store.chooseSegment(null);
      await flushMicrotasks();

      expect(claimPosts().at(-1)).toEqual({ street_key: null, street: null });
    });

    it('hands the street back on end of shift', async () => {
      await store.load(TOKEN);
      store.chooseSegment(store.segments()[0]?.key ?? null);
      await flushMicrotasks();

      store.endShift();
      await flushMicrotasks();

      // Otherwise tomorrow's group is told a street is taken until the TTL catches up.
      expect(claimPosts().at(-1)?.street_key).toBeNull();
    });

    it('keeps scoping when the claim call fails — it is advisory, not a gate', async () => {
      await store.load(TOKEN);
      fetchMock.mockImplementation((url, init) => {
        if (String(url).endsWith('/segment')) return Promise.reject(new Error('offline'));
        if (!init || init.method !== 'POST') return Promise.resolve(jsonResponse(turfPayload()));
        return Promise.resolve(jsonResponse({ acks: [] }));
      });

      const alder = store.segments().find((seg) => seg.street === 'Alder St');
      store.chooseSegment(alder?.key ?? null);
      await flushMicrotasks();

      expect(store.scopedHouseholds().map((h) => h.id)).toEqual(['10']);
      expect(store.loadError()).toBeNull();
    });

    it('surfaces other people’s claims and hides its own', async () => {
      fetchMock.mockImplementation((url, init) => {
        if (!init || init.method !== 'POST') {
          return Promise.resolve(
            jsonResponse({
              ...turfPayload(),
              segment_claims: [
                { street_key: 'alder st', street: 'Alder St', canvasser_name: 'Dana Fox', claimed_at: '', mine: false },
                { street_key: 'scott blvd', street: 'Scott Blvd', canvasser_name: 'Me', claimed_at: '', mine: true },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ acks: [] }));
      });
      await store.load(TOKEN);

      // "You're here" alongside "Showing" would say the same thing twice.
      expect(store.claimsByStreet().get('alder st')?.[0]?.canvasser_name).toBe('Dana Fox');
      expect(store.claimsByStreet().has('scott blvd')).toBe(false);
    });
  });

  describe('live refresh', () => {
    it('replaces the server payload while keeping queued ops and their overlay', async () => {
      await store.load(TOKEN);
      // Hold the queue so the op is still pending when the refresh lands.
      store.setWorkOffline(true);
      store.doorOutcome('10', 'refused');
      await flushMicrotasks();
      expect(store.queue()).toHaveLength(1);

      await store.refresh();
      await flushMicrotasks();

      expect(store.queue()).toHaveLength(1);
      // The optimistic overlay survives a payload swap — it is replayed, not merged in.
      expect(store.households().find((h) => h.id === '10')?.door_outcome).toBe('refused');
      expect(store.lastRefreshedAt()).toBeInstanceOf(Date);
    });

    it('posts to the turf endpoint, not the link, so it works after a QR join too', async () => {
      await store.load(TOKEN);
      fetchMock.mockClear();
      await store.refresh();
      expect(fetchMock).toHaveBeenCalledWith(`/api/canvass/turf/${TURF_ID}`, expect.anything());
    });

    it('stays silent on a failed tick rather than interrupting a doorstep', async () => {
      await store.load(TOKEN);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));
      await store.refresh();
      expect(store.loadError()).toBeNull();
      expect(store.payload()).not.toBeNull();
    });

    it('re-gates on 401/403 — a revoked volunteer must not keep polling', async () => {
      await store.load(TOKEN);
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no' }, 403));
      await store.refresh();
      expect(store.sessionExpired()).toBe(true);
    });

    it('does nothing while offline', async () => {
      await store.load(TOKEN);
      store.online.set(false);
      fetchMock.mockClear();
      await store.refresh();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
