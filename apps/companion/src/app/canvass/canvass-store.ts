import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

import type {
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionOpAck,
  CompanionOpType,
  CompanionPersonResult,
  CompanionTurfChoices,
  CompanionTurfPayload,
  KnockResponse,
} from '@common';
import { CompanionOpObj } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { CompanionSessionService } from '../gate/companion-api';
import { applyLocalOps, isTempPersonId, meStats, nextDoor, opPersonId, type LocalOp } from './canvass-derive';

/**
 * The canvass companion's signals store (COMPANION-APPS-PLAN.md §6). Provided
 * by the page component (NOT root) so its state lives and dies with /t/:token.
 *
 * The invariant: the server payload is never mutated. Every action becomes an
 * op in `localOps`, and the visible households are a computed replay of those
 * ops over the payload (`applyLocalOps`) — "derived, never stored". The queue
 * (ops not yet acked) persists to localStorage so an offline shift survives a
 * reload, and drains in order through one idempotent POST.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/** Client-side view state — nothing beyond the token is routable (spec §5). */
export type CanvassView =
  | { kind: 'landing' }
  | { kind: 'list' }
  | { kind: 'map' }
  | { kind: 'me' }
  /** Choose which turf to walk: the ones they are on, plus claimable ones if allowed. */
  | { kind: 'picker' }
  | { kind: 'household'; household_id: string }
  | { kind: 'survey'; household_id: string; person_id: string | null };

/** A locally recorded op plus its human queue label ("Alice Door · 218 Alder St"). */
export interface QueuedOp extends LocalOp {
  label: string;
  /**
   * The turf this op was recorded on.
   *
   * A volunteer can switch turfs mid-shift while results are still queued offline.
   * Without stamping the turf here, a queue recorded on Maple would drain against
   * whatever turf happens to be open when the connection returns — and the server
   * would reject every op as "not part of this turf". Stamped, each batch goes back
   * to where it came from. Optional so a queue persisted by an older build still loads.
   */
  turf_id?: string;
}

/** Everything the survey view collects; maps 1:1 onto the survey op payload. */
export interface SurveyDraft {
  support: KnockResponse | null;
  issues: string[];
  wants_volunteer: boolean;
  wants_yard_sign: boolean;
  set_dnc: boolean;
  contact_phone: string | null;
  contact_email: string | null;
  subscribe: boolean;
  notes: string | null;
}

interface LastAction {
  op_id: string;
  type: CompanionOpType['type'];
  household_id: string;
}

const QUEUE_KEY_PREFIX = 'pc-canvass-queue:';
/**
 * Doors THIS device logged this shift.
 *
 * Kept separately from the queue because the queue empties as results sync, while
 * "what you personally did today" must survive syncing. It matters now that several
 * volunteers can walk one turf at once: the turf payload carries everyone's knocks,
 * so turf-wide totals would otherwise be shown back to one volunteer as their own.
 */
const MY_DOORS_KEY_PREFIX = 'pc-canvass-mydoors:';

function isQueuedOp(value: unknown): value is QueuedOp {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { label?: unknown; op?: unknown; temp_person_id?: unknown; turf_id?: unknown };
  if (typeof candidate.label !== 'string') return false;
  if (candidate.temp_person_id !== undefined && typeof candidate.temp_person_id !== 'string') return false;
  if (candidate.turf_id !== undefined && typeof candidate.turf_id !== 'string') return false;
  return CompanionOpObj.safeParse(candidate.op).success;
}

@Injectable()
export class CanvassStore {
  private readonly alerts = inject(AlertService);
  private readonly session = inject(CompanionSessionService);

  /** The server turf payload — never mutated after load. */
  public readonly payload = signal<CompanionTurfPayload | null>(null);
  /** Ops not yet acked by the server; persisted to localStorage. */
  public readonly queue = signal<QueuedOp[]>([]);
  public readonly syncStatus = signal<SyncStatus>('idle');
  public readonly lastSyncedAt = signal<Date | null>(null);
  /** Volunteer chose to hold the queue; flush waits for toggle-off or "Sync now". */
  public readonly workOffline = signal(false);
  /** Browser connectivity, tracked via the window online/offline events. */
  public readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** 401/403 from a data call — the page sends the user back through the gate. */
  public readonly sessionExpired = signal(false);
  public readonly loadError = signal<string | null>(null);
  public readonly view = signal<CanvassView>({ kind: 'landing' });

  /** All ops recorded this session (queued + acked) — the optimistic overlay source. */
  private readonly localOps = signal<QueuedOp[]>([]);
  private readonly lastAction = signal<LastAction | null>(null);
  /** Household ids this device recorded something for this shift; survives syncing. */
  private readonly myDoorIds = signal<ReadonlySet<string>>(new Set<string>());
  /**
   * Op ids of the POST batch currently in flight. They are still in `queue`
   * (only an ack removes them), but the server may already have applied them,
   * so treating them as revocable would silently diverge from the server.
   */
  private readonly inFlightOpIds = signal<ReadonlySet<string>>(new Set<string>());

  /** Server payload with the local overlay replayed on top — the one source the views read. */
  public readonly households = computed<CompanionHousehold[]>(() => {
    const payload = this.payload();
    return payload ? applyLocalOps(payload.households, this.localOps()) : [];
  });
  /** Turf-wide stats — these include every canvasser's work, not just this device's. */
  public readonly stats = computed(() => meStats(this.households()));
  /** Doors this volunteer logged on this device this shift. */
  public readonly myDoorCount = computed(() => this.myDoorIds().size);
  public readonly nextDoorId = computed(() => nextDoor(this.households())?.id ?? null);
  /**
   * Undo is offered for door outcomes (inverse op) or while the op is still
   * queued AND not in the in-flight batch — mid-flight the server may already
   * have applied it, so it only becomes final again once the batch acks.
   */
  public readonly canUndo = computed<boolean>(() => {
    const action = this.lastAction();
    if (!action) return false;
    if (action.type === 'door_outcome') return true;
    if (this.inFlightOpIds().has(action.op_id)) return false;
    return this.queue().some((entry) => entry.op.op_id === action.op_id);
  });

  private flushing = false;
  private token = '';

  constructor() {
    const onOnline = (): void => {
      this.online.set(true);
      void this.flush();
    };
    const onOffline = (): void => {
      this.online.set(false);
      if (this.queue().length > 0) this.syncStatus.set('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    });
  }

  // ------------------------------------------------------------------ load --

  public async load(token: string): Promise<void> {
    this.token = token;
    this.restoreQueue();
    this.loadError.set(null);
    try {
      const res = await fetch(`/api/canvass/t/${encodeURIComponent(token)}`, { headers: this.session.headers() });
      if (res.status === 401 || res.status === 403) {
        this.expireSession();
        return;
      }
      if (!res.ok) {
        this.loadError.set('Could not load your turf. Check your connection and try again.');
        return;
      }
      this.payload.set((await res.json()) as CompanionTurfPayload);
      // After the payload, because the tally is keyed by turf id.
      this.restoreMyDoors();
      void this.flush();
    } catch {
      this.loadError.set('Could not load your turf. Check your connection and try again.');
      if (this.queue().length > 0) this.syncStatus.set('offline');
    }
  }

  /**
   * Which turfs this volunteer can walk, and — when their organizer allows roaming —
   * which they can start on. Returns null when the list can't be reached, so the
   * picker can say so rather than claiming there are no turfs.
   */
  public async fetchTurfChoices(): Promise<CompanionTurfChoices | null> {
    try {
      const res = await fetch('/api/canvass/my-turfs', { headers: this.session.headers() });
      if (res.status === 401 || res.status === 403) {
        this.expireSession();
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as CompanionTurfChoices;
    } catch {
      return null;
    }
  }

  /**
   * Open another turf this volunteer is already on.
   *
   * Queued results are NOT flushed first and do not need to be: every op carries the
   * turf it was recorded on, so an offline queue keeps draining to the right place
   * after the switch.
   */
  public async switchTurf(turfId: string): Promise<boolean> {
    this.loadError.set(null);
    try {
      const res = await fetch(`/api/canvass/turf/${encodeURIComponent(turfId)}`, {
        headers: this.session.headers(),
      });
      if (res.status === 401 || res.status === 403) {
        this.expireSession();
        return false;
      }
      if (!res.ok) {
        this.loadError.set('Could not open that turf. Check your connection and try again.');
        return false;
      }
      this.payload.set((await res.json()) as CompanionTurfPayload);
      this.restoreMyDoors();
      this.view.set({ kind: 'list' });
      void this.flush();
      return true;
    } catch {
      this.loadError.set('Could not open that turf. Check your connection and try again.');
      return false;
    }
  }

  /** Start on a turf nobody assigned them. Returns the error message on refusal. */
  public async claimTurf(turfId: string): Promise<string | null> {
    try {
      const res = await fetch('/api/canvass/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.session.headers() },
        body: JSON.stringify({ turf_id: turfId }),
      });
      if (res.status === 401 || res.status === 403) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // 403 here is "not allowed to roam", which the gate must not treat as a dead
        // session — only 401 sends them back through verification.
        if (res.status === 401) {
          this.expireSession();
          return null;
        }
        return body?.error ?? 'Your organizer assigns turfs for this campaign.';
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return body?.error ?? 'Could not start on that turf.';
      }
      return (await this.switchTurf(turfId)) ? null : 'Could not open that turf.';
    } catch {
      return 'Could not start on that turf. Check your connection.';
    }
  }

  public householdById(id: string): CompanionHousehold | null {
    return this.households().find((h) => h.id === id) ?? null;
  }

  // --------------------------------------------------------------- actions --

  /** Save a survey for a person (or the door itself when personId is null). */
  public submitSurvey(householdId: string, personId: string | null, draft: SurveyDraft): void {
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'survey',
      payload: {
        household_id: householdId,
        person_id: personId,
        support: draft.support,
        issues: draft.issues,
        wants_volunteer: draft.wants_volunteer,
        wants_yard_sign: draft.wants_yard_sign,
        set_dnc: draft.set_dnc,
        contact_phone: draft.contact_phone,
        contact_email: draft.contact_email,
        subscribe: draft.subscribe,
        notes: draft.notes,
      },
    };
    this.record(op, `${this.personLabel(householdId, personId)} · ${this.addressOf(householdId)}`);
  }

  /** One-tap no-conversation code for a person. */
  public personResult(
    householdId: string,
    personId: string,
    result: Exclude<CompanionPersonResult, 'canvassed'>,
  ): void {
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'person_result',
      payload: { household_id: householdId, person_id: personId, result },
    };
    this.record(op, `${this.personLabel(householdId, personId)} · ${this.addressOf(householdId)}`);
  }

  /**
   * Set a door-level outcome; tapping the active outcome again clears it
   * (enqueues the append-only clear_outcome inverse). Returns which happened.
   */
  public doorOutcome(householdId: string, outcome: CompanionDoorOutcome): 'set' | 'cleared' {
    const current = this.householdById(householdId)?.door_outcome ?? null;
    const address = this.addressOf(householdId);
    if (current === outcome) {
      const op: CompanionOpType = { ...this.baseOp(), type: 'clear_outcome', payload: { household_id: householdId } };
      this.record(op, `Cleared outcome · ${address}`);
      return 'cleared';
    }
    const labels: Record<CompanionDoorOutcome, string> = {
      no_answer: 'Nobody home',
      inaccessible: 'Inaccessible',
      refused: 'Refused',
    };
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'door_outcome',
      payload: { household_id: householdId, outcome },
    };
    this.record(op, `${labels[outcome]} · ${address}`);
    return 'set';
  }

  /** "+ Add someone at this door" — shows a temp person until the ack swaps in the real id. */
  public addPerson(householdId: string, name: string): void {
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'person_create',
      payload: { household_id: householdId, name },
    };
    this.record(op, `Added ${name} · ${this.addressOf(householdId)}`, `tmp-${op.op_id}`);
  }

  /**
   * Undo the last action. A queued op is simply removed (the replay overlay
   * reverts with it). A door outcome that already synced (or is mid-flight)
   * gets the inverse clear_outcome op. A synced survey/person result cannot
   * be undone — the server keeps knock history append-only.
   */
  public undo(): boolean {
    const action = this.lastAction();
    if (!action) return false;
    // An op in the in-flight batch is not removable: the server may already
    // have applied it. Door outcomes fall through to the inverse-op path
    // (safe either way); anything else waits for the ack.
    const inFlight = this.inFlightOpIds().has(action.op_id);
    const queued = !inFlight && this.queue().some((entry) => entry.op.op_id === action.op_id);
    this.lastAction.set(null);
    if (queued) {
      this.queue.update((q) => q.filter((entry) => entry.op.op_id !== action.op_id));
      this.localOps.update((l) => l.filter((entry) => entry.op.op_id !== action.op_id));
      this.persistQueue();
      return true;
    }
    if (action.type === 'door_outcome') {
      const op: CompanionOpType = {
        ...this.baseOp(),
        type: 'clear_outcome',
        payload: { household_id: action.household_id },
      };
      this.record(op, `Cleared outcome · ${this.addressOf(action.household_id)}`);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ sync --

  /** Drain the queue in order. Manual = the "Sync now" button (overrides work-offline). */
  public async flush(manual = false): Promise<void> {
    if (this.flushing) return;
    if (this.workOffline() && !manual) return;
    if (this.queue().length === 0) {
      this.syncStatus.set('idle');
      return;
    }
    if (!this.online()) {
      this.syncStatus.set('offline');
      return;
    }
    this.flushing = true;
    this.syncStatus.set('syncing');
    try {
      while (this.queue().length > 0) {
        // Hold back ops that reference a temp person id — their person_create
        // (earlier in the queue) must ack first so the real id can swap in.
        const batch = this.sendableBatch();
        if (batch.length === 0) {
          this.syncStatus.set('error');
          return;
        }
        // Mark the batch in-flight so undo can't remove an op the server may
        // be applying right now (canUndo/undo consult this set).
        this.inFlightOpIds.set(new Set(batch.map((entry) => entry.op.op_id)));
        // Post to the turf the batch was recorded on, not the one currently open.
        const batchTurfId = batch[0]?.turf_id ?? this.payload()?.turf_id;
        if (!batchTurfId) {
          this.syncStatus.set('error');
          return;
        }
        const res = await fetch(`/api/canvass/turf/${encodeURIComponent(batchTurfId)}/results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.session.headers() },
          body: JSON.stringify({ ops: batch.map((entry) => entry.op) }),
        });
        if (res.status === 401 || res.status === 403) {
          this.expireSession();
          return;
        }
        if (!res.ok) {
          this.syncStatus.set('error');
          return;
        }
        const { acks } = (await res.json()) as { acks: CompanionOpAck[] };
        this.applyAcks(batch, acks);
        this.inFlightOpIds.set(new Set<string>());
      }
      this.syncStatus.set('idle');
      this.lastSyncedAt.set(new Date());
    } catch {
      this.syncStatus.set('offline');
    } finally {
      // A failed batch is treated as not applied — its ops stay queued and
      // will re-send idempotently — so they become undoable again here.
      this.inFlightOpIds.set(new Set<string>());
      this.flushing = false;
      this.persistQueue();
    }
  }

  public setWorkOffline(on: boolean): void {
    this.workOffline.set(on);
    if (!on) void this.flush();
  }

  /** "End shift on this device" — wipe local traces, back to the landing view. */
  public endShift(): void {
    try {
      localStorage.removeItem(this.storageKey());
      localStorage.removeItem(this.myDoorsKey());
    } catch {
      // Storage unavailable — the in-memory clear below still applies.
    }
    this.queue.set([]);
    this.localOps.set([]);
    this.myDoorIds.set(new Set<string>());
    this.lastAction.set(null);
    this.workOffline.set(false);
    this.syncStatus.set('idle');
    this.view.set({ kind: 'landing' });
  }

  // --------------------------------------------------------------- private --

  private addressOf(householdId: string): string {
    return this.householdById(householdId)?.address ?? 'this door';
  }

  private applyAcks(batch: QueuedOp[], acks: CompanionOpAck[]): void {
    for (const ack of acks) {
      const entry = batch.find((e) => e.op.op_id === ack.op_id);
      if (!entry) continue;
      this.queue.update((q) => q.filter((e) => e.op.op_id !== ack.op_id));
      if (ack.status === 'rejected') {
        // Drop the op and revert its optimistic overlay (the replay recomputes).
        this.localOps.update((l) => l.filter((e) => e.op.op_id !== ack.op_id));
        if (entry.temp_person_id != null) this.dropOpsReferencing(entry.temp_person_id);
        if (this.lastAction()?.op_id === ack.op_id) this.lastAction.set(null);
        this.alerts.showError(`Couldn't sync "${entry.label}": ${ack.error ?? 'it was rejected'}`);
      } else if (entry.op.type === 'person_create' && entry.temp_person_id != null && ack.person_id != null) {
        this.swapTempId(entry.temp_person_id, ack.person_id);
      }
    }
    this.persistQueue();
  }

  private baseOp(): { op_id: string; recorded_at: string } {
    return { op_id: crypto.randomUUID(), recorded_at: new Date().toISOString() };
  }

  /** A rejected person_create orphans any queued ops aimed at its temp person. */
  private dropOpsReferencing(tempId: string): void {
    const keep = (entry: QueuedOp): boolean => opPersonId(entry.op) !== tempId;
    this.queue.update((q) => q.filter(keep));
    this.localOps.update((l) => l.filter(keep));
  }

  private expireSession(): void {
    this.session.clearSession();
    this.sessionExpired.set(true);
  }

  private personLabel(householdId: string, personId: string | null): string {
    if (personId == null) return 'This household';
    const person = this.householdById(householdId)?.people.find((p) => p.id === personId);
    return person?.name ?? 'Someone';
  }

  private persistQueue(): void {
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(this.queue()));
    } catch {
      // Storage full/blocked — the queue still lives in memory for this visit.
    }
  }

  private record(op: CompanionOpType, label: string, tempPersonId?: string): void {
    const turfId = this.payload()?.turf_id;
    const entry: QueuedOp = {
      op,
      label,
      ...(tempPersonId == null ? {} : { temp_person_id: tempPersonId }),
      ...(turfId == null ? {} : { turf_id: turfId }),
    };
    const householdId = String(op.payload.household_id);
    this.lastAction.set({ op_id: op.op_id, type: op.type, household_id: householdId });
    this.localOps.update((l) => [...l, entry]);
    this.queue.update((q) => [...q, entry]);
    this.markMyDoor(householdId);
    this.persistQueue();
    void this.flush();
  }

  private markMyDoor(householdId: string): void {
    if (this.myDoorIds().has(householdId)) return;
    const next = new Set(this.myDoorIds());
    next.add(householdId);
    this.myDoorIds.set(next);
    try {
      localStorage.setItem(this.myDoorsKey(), JSON.stringify([...next]));
    } catch {
      // Storage full/blocked — the tally still holds for this visit.
    }
  }

  /** Keyed by turf, not by token: switching turfs must not carry the tally across. */
  private myDoorsKey(): string {
    return `${MY_DOORS_KEY_PREFIX}${this.payload()?.turf_id ?? this.token}`;
  }

  private restoreMyDoors(): void {
    try {
      const raw = localStorage.getItem(this.myDoorsKey());
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.myDoorIds.set(new Set(parsed.filter((v): v is string => typeof v === 'string')));
    } catch {
      // Corrupt/blocked storage — start the tally fresh rather than crash.
    }
  }

  private restoreQueue(): void {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const entries = parsed.filter(isQueuedOp);
      this.localOps.set(entries);
      this.queue.set(entries);
    } catch {
      // Corrupt/blocked storage — start with an empty queue rather than crash.
    }
  }

  /**
   * The next batch to send: entries from the head of the queue that share one turf and
   * sit before any unacked temp person id.
   *
   * Stopping at a turf change matters — each batch posts to one turf's endpoint, and a
   * queue can span turfs after a mid-shift switch. The next flush picks up the rest.
   */
  private sendableBatch(): QueuedOp[] {
    const out: QueuedOp[] = [];
    let turfId: string | undefined;
    for (const entry of this.queue()) {
      const personId = opPersonId(entry.op);
      if (personId != null && isTempPersonId(personId)) break;
      if (out.length === 0) turfId = entry.turf_id;
      else if (entry.turf_id !== turfId) break;
      out.push(entry);
    }
    return out;
  }

  private storageKey(): string {
    return `${QUEUE_KEY_PREFIX}${this.token}`;
  }

  /** The server created the person — swap the temp id everywhere it appears. */
  private swapTempId(tempId: string, realId: string): void {
    const swap = (entries: QueuedOp[]): QueuedOp[] =>
      entries.map((entry) => {
        let next = entry;
        if (entry.temp_person_id === tempId) next = { ...next, temp_person_id: realId };
        const op = next.op;
        if (op.type === 'survey' && op.payload.person_id != null && String(op.payload.person_id) === tempId) {
          next = { ...next, op: { ...op, payload: { ...op.payload, person_id: realId } } };
        } else if (op.type === 'person_result' && String(op.payload.person_id) === tempId) {
          next = { ...next, op: { ...op, payload: { ...op.payload, person_id: realId } } };
        }
        return next;
      });
    this.localOps.update(swap);
    this.queue.update(swap);
    // Keep an open survey view pointed at the person after their id changes.
    const view = this.view();
    if (view.kind === 'survey' && view.person_id === tempId) {
      this.view.set({ ...view, person_id: realId });
    }
  }
}
