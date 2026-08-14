import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';

import type {
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionOpAck,
  CompanionOpType,
  CompanionPersonResult,
  CompanionSegmentClaim,
  CompanionTurfChoices,
  CompanionTurfPayload,
  KnockResponse,
} from '@common';
import { COMPANION_OPS_MAX_PER_BATCH, CompanionOpObj, LOCATION_PING_INTERVAL_MS } from '@common';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { CompanionSessionService } from '../gate/companion-api';
import { GeoPosition } from './geo-position';
import {
  applyLocalOps,
  deriveSegments,
  deriveWalkEntries,
  entryRemaining,
  isAttempted,
  isTempPersonId,
  meStats,
  nextDoor,
  opPersonId,
  orderEntriesForWalk,
  segmentKeyOf,
  unitsOf,
  type CanvassSegment,
  type LocalOp,
  type WalkEntry,
} from './canvass-derive';

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
  /** The units inside one apartment building, opened from its folded walk-list row. */
  | { kind: 'building'; building_key: string }
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

/**
 * A recorded result that came back off the queue without reaching the server, kept
 * where the volunteer can see it.
 *
 * Two things land here, and neither may be deleted behind the volunteer's back:
 * a result the server REFUSED (which is reachable from ordinary validation — the turf's
 * household list can change while a phone is offline), and a result whose person can
 * never be identified, because the `person_create` it depends on was acknowledged
 * without an id. Silently dropping either destroys work somebody did at a door.
 */
export interface BlockedOp {
  entry: QueuedOp;
  /** A plain sentence the volunteer reads. Server wording when the server had some. */
  reason: string;
  /**
   * Whether sending it again could work.
   *
   * A refusal often stops applying (the organizer refreshes the turf's doors and the
   * household is in it again), so those are offered a retry. A result whose person id
   * is unrecoverable is not — re-sending it would fail identically forever, and saying
   * "try again" about something that cannot succeed is worse than saying nothing.
   */
  retryable: boolean;
}

/** Everything the survey view collects; maps 1:1 onto the survey op payload. */
export interface SurveyDraft {
  support: KnockResponse | null;
  issues: string[];
  wants_volunteer: boolean;
  wants_yard_sign: boolean;
  /** "…and I gave them one just now" — only sent alongside wants_yard_sign. */
  yard_sign_delivered: boolean;
  set_dnc: boolean;
  senior: boolean;
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

/**
 * The offline queue, keyed per DEVICE rather than per link.
 *
 * It used to hang off the capability token, which was fine while a token was the only
 * way in. It no longer is: a volunteer can arrive on `/t/:token` in the morning and on
 * `/canvass` (session-first, after joining by QR) in the afternoon, and a per-token key
 * would strand the morning's unsynced results under a key nothing reads again. Every op
 * already carries the turf it belongs to, so one queue per device is both correct and
 * simpler.
 */
const QUEUE_KEY = 'pc-canvass-queue';
/** Pre-2026-07-28 per-token keys, adopted once so a deploy never eats an offline shift. */
const LEGACY_QUEUE_KEY_PREFIX = 'pc-canvass-queue:';
/**
 * Results that came off the queue without syncing. Persisted like the queue, because a
 * reload must not be the thing that finally destroys work the app already told the
 * volunteer it was holding for them.
 */
const BLOCKED_KEY = 'pc-canvass-blocked';
/** What a result says when the person it was recorded against can never be identified. */
const UNRESOLVABLE_REASON =
  'The person this was recorded against was saved, but this phone lost track of their record. Refresh the turf and record it again.';
/**
 * Doors THIS device logged this shift.
 *
 * Kept separately from the queue because the queue empties as results sync, while
 * "what you personally did today" must survive syncing. It matters now that several
 * volunteers can walk one turf at once: the turf payload carries everyone's knocks,
 * so turf-wide totals would otherwise be shown back to one volunteer as their own.
 */
const MY_DOORS_KEY_PREFIX = 'pc-canvass-mydoors:';

/**
 * A stand-in real id, used only to validate a stored op that carries a temp one.
 *
 * `CompanionOpObj` requires every person id to be a database id, which is right for the
 * wire — the server must never be handed a `tmp-…` placeholder. But the phone's own
 * persisted queue is full of them for as long as it is offline, so validating stored
 * entries against the wire schema unchanged deleted, on every reload, exactly the results
 * recorded for somebody added at a door. Masking the placeholder for the length of the
 * check keeps the rest of the shared validation and loses nothing else.
 */
const TEMP_ID_MASK = '0';

function maskTempPersonId(op: unknown): unknown {
  if (op == null || typeof op !== 'object') return op;
  const payload = (op as { payload?: unknown }).payload;
  if (payload == null || typeof payload !== 'object') return op;
  const personId = (payload as { person_id?: unknown }).person_id;
  if (typeof personId !== 'string' || !isTempPersonId(personId)) return op;
  return { ...op, payload: { ...payload, person_id: TEMP_ID_MASK } };
}

function isQueuedOp(value: unknown): value is QueuedOp {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { label?: unknown; op?: unknown; temp_person_id?: unknown; turf_id?: unknown };
  if (typeof candidate.label !== 'string') return false;
  if (candidate.temp_person_id !== undefined && typeof candidate.temp_person_id !== 'string') return false;
  if (candidate.turf_id !== undefined && typeof candidate.turf_id !== 'string') return false;
  return CompanionOpObj.safeParse(maskTempPersonId(candidate.op)).success;
}

function isBlockedOp(value: unknown): value is BlockedOp {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as { entry?: unknown; reason?: unknown; retryable?: unknown };
  if (typeof candidate.reason !== 'string') return false;
  if (typeof candidate.retryable !== 'boolean') return false;
  return isQueuedOp(candidate.entry);
}

@Injectable()
export class CanvassStore {
  private readonly alerts = inject(AlertService);
  private readonly session = inject(CompanionSessionService);
  private readonly geo = inject(GeoPosition);

  /** The server turf payload — never mutated after load. */
  public readonly payload = signal<CompanionTurfPayload | null>(null);
  /** Ops not yet acked by the server; persisted to localStorage. */
  public readonly queue = signal<QueuedOp[]>([]);
  /**
   * Results that left the queue without syncing, held for the volunteer to retry or
   * discard. Never emptied by the app on its own — see `BlockedOp`.
   */
  public readonly blocked = signal<BlockedOp[]>([]);
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
  /**
   * Which street the walk list and map are scoped to; null = the whole turf.
   *
   * Lives here rather than in the list component so the list and the map can never show
   * different scopes, and so switching tabs doesn't silently widen it back out.
   */
  public readonly segmentKey = signal<string | null>(null);
  /**
   * Which colouring the map tab shows: 'walk' (visit status, the default — the
   * walker's question is "where next", not "how are we polling") or 'results'
   * (the stance colours the walk-list rows use). Lives here so it survives tab
   * switches; resets with the turf, like the street scope.
   */
  public readonly mapMode = signal<'walk' | 'results'>('walk');
  /** When the server payload was last pulled. Drives "Updated just now". */
  public readonly lastRefreshedAt = signal<Date | null>(null);
  /** A refresh is in flight — distinct from the initial load, which blanks the screen. */
  public readonly refreshing = signal(false);
  /**
   * A turf is open and this device is actively broadcasting its position (spec: the
   * volunteer must see a persistent indicator for the whole open shift). Honest by
   * construction: `GeoPosition.stop()` resets its state, so this can never claim
   * sharing after `endShift()`.
   */
  public readonly locationSharing = computed(() => this.payload() != null && this.geo.state() === 'ready');

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
  /** Every street in this turf, in walk order, with its own progress. */
  public readonly segments = computed<CanvassSegment[]>(() => deriveSegments(this.households()));
  /**
   * The doors currently in scope — the whole turf, or one street.
   *
   * A scope naming a street that no longer exists (the turf was refreshed from its list
   * and that street dropped out) falls back to the whole turf rather than showing an
   * empty list: the volunteer did nothing wrong and an empty screen would not say so.
   */
  public readonly scopedHouseholds = computed<CompanionHousehold[]>(() => {
    const key = this.segmentKey();
    if (key == null) return this.households();
    const matching = this.households().filter((h) => segmentKeyOf(h) === key);
    return matching.length > 0 ? matching : this.households();
  });
  /** The scoped street, or null when the whole turf is in view. */
  public readonly activeSegment = computed<CanvassSegment | null>(() => {
    const key = this.segmentKey();
    return key == null ? null : (this.segments().find((s) => s.key === key) ?? null);
  });
  /**
   * Who else is on which street, keyed by street.
   *
   * Purely informational: nothing in this store consults it before recording anything. It
   * exists so a group splitting one turf can see how it has been split instead of finding
   * out at a door somebody already knocked. Own claims are dropped — the picker already
   * shows which street you are on, and "Showing · You're here" says the same thing twice.
   */
  public readonly claimsByStreet = computed<Map<string, CompanionSegmentClaim[]>>(() => {
    const out = new Map<string, CompanionSegmentClaim[]>();
    for (const claim of this.payload()?.segment_claims ?? []) {
      if (claim.mine) continue;
      const existing = out.get(claim.street_key);
      if (existing) existing.push(claim);
      else out.set(claim.street_key, [claim]);
    }
    return out;
  });
  /**
   * The rows the walk list actually renders: single doors, and apartment buildings folded
   * back into the address their units share. Scoped like everything else on this screen,
   * and in the suggested walking order — up one side of the street, back down the other.
   */
  public readonly walkEntries = computed<WalkEntry[]>(() =>
    orderEntriesForWalk(deriveWalkEntries(this.scopedHouseholds())),
  );
  /**
   * Each row's position in the walking order, 1-based. The list's number circles and the
   * map's pin labels both read this, so a door is never "3" in one place and "7" in the
   * other. Stable for the shift: finishing a door does not renumber the rest.
   */
  public readonly walkSeqByKey = computed<Map<string, number>>(
    () => new Map(this.walkEntries().map((entry, i) => [entry.key, i + 1])),
  );
  /** Turf-wide stats — these include every canvasser's work, not just this device's. */
  public readonly stats = computed(() => meStats(this.households()));
  /** Doors this volunteer logged on this device this shift. */
  public readonly myDoorCount = computed(() => this.myDoorIds().size);
  /** Everything recorded on this phone that is not in pplCRM yet — queued or held. */
  public readonly unsyncedCount = computed(() => this.queue().length + this.blocked().length);
  /**
   * The first row in the walking order that still has work behind it. Scoped, so
   * narrowing to a street moves the ring to the next door ON that street.
   */
  private readonly nextEntry = computed<WalkEntry | null>(() => this.walkEntries().find(entryRemaining) ?? null);
  /** The next open door: the first remaining stop in the walking order. */
  public readonly nextDoorId = computed<string | null>(() => {
    const entry = this.nextEntry();
    if (!entry) return null;
    if (entry.kind === 'door') return entry.household.id;
    return entry.units.find((u) => !isAttempted(u))?.id ?? null;
  });
  /**
   * The walk-list row holding the next open door — a building when that door is a unit
   * inside one, so the ring lands on the row the volunteer can actually see and tap.
   */
  public readonly nextEntryKey = computed<string | null>(() => this.nextEntry()?.key ?? null);
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
  /** The turf whose permission-denied verdict was already reported — once per turf, not per minute. */
  private deniedReportedForTurf: string | null = null;
  /** The turf that already got its arrival ping, so opening a turf shows up within seconds. */
  private immediatePingTurf: string | null = null;

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

    // The location broadcast (Live tab): one POST a minute while a turf is open. Lives in
    // the store — not the walk-list component — so switching to the Map or Me tab doesn't
    // silently stop the trail the volunteer has been told is being shared.
    const pingTimer = setInterval(() => void this.sendLocationPing(), LOCATION_PING_INTERVAL_MS);

    // Arrival ping: the first usable fix (or a denial verdict) after a turf opens is sent
    // straight away, so the organizer sees the volunteer within one board poll rather
    // than a minute later.
    effect(() => {
      const turfId = this.payload()?.turf_id ?? null;
      const state = this.geo.state();
      if (turfId == null) {
        this.immediatePingTurf = null;
        return;
      }
      if ((state !== 'ready' && state !== 'denied') || this.immediatePingTurf === turfId) return;
      this.immediatePingTurf = turfId;
      void this.sendLocationPing();
    });

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(pingTimer);
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
      this.lastRefreshedAt.set(new Date());
      // After the payload, because the tally is keyed by turf id.
      this.restoreMyDoors();
      this.applyDefaultScope();
      this.startLocationSharing();
      void this.flush();
    } catch {
      this.loadError.set('Could not load your turf. Check your connection and try again.');
      if (this.queue().length > 0) this.syncStatus.set('offline');
    }
  }

  /**
   * Re-pull the current turf without disturbing anything local.
   *
   * With several volunteers on one turf, a payload that never refreshes means two people
   * knock the same door — the app would be actively hiding the fact that someone else
   * already did it. Only the SERVER payload is replaced; `localOps` replay on top
   * unchanged, so nothing queued or optimistic is lost, and re-applying an op the server
   * already has is a no-op.
   *
   * Silent on failure by design: this runs on a timer, and a poll that missed on one
   * tick is not something to interrupt a volunteer at a doorstep about. The narrated
   * "Updated …" timestamp is what tells them how fresh the numbers are.
   */
  public async refresh(): Promise<void> {
    const turfId = this.payload()?.turf_id;
    if (!turfId || this.refreshing() || !this.online()) return;
    this.refreshing.set(true);
    try {
      const res = await fetch(`/api/canvass/turf/${encodeURIComponent(turfId)}`, {
        headers: this.session.headers(),
      });
      if (res.status === 401 || res.status === 403) {
        this.expireSession();
        return;
      }
      if (!res.ok) return;
      this.payload.set((await res.json()) as CompanionTurfPayload);
      this.lastRefreshedAt.set(new Date());
    } catch {
      // Transient — keep showing what we have and let the next tick try again.
    } finally {
      this.refreshing.set(false);
    }
  }

  /**
   * Open the app with a device session and no link.
   *
   * This is where a QR joiner lands: their turf assignment token is hashed and can never
   * be handed back to them, so there is no `/t/:token` URL to send them to. One turf
   * opens straight into the walk list — the common case after a turf-scoped QR — and
   * anything else goes to the picker, which explains itself either way.
   */
  public async bootstrapFromSession(preferredTurfId: string | null = null): Promise<void> {
    this.restoreQueue();
    this.loadError.set(null);
    // A join link named this turf — open it directly. Any failure (assignment revoked
    // since, turf retired, bad id in the URL) falls through to the choices below,
    // where the picker explains itself instead of dead-ending at an error.
    if (preferredTurfId) {
      if (await this.switchTurf(preferredTurfId)) return;
      this.loadError.set(null);
    }
    const choices = await this.fetchTurfChoices();
    if (!choices) {
      this.loadError.set('Could not load your turfs. Check your connection and try again.');
      return;
    }
    const only = choices.mine.length === 1 ? choices.mine[0] : null;
    if (only) {
      await this.switchTurf(only.turf_id);
      return;
    }
    this.view.set({ kind: 'picker' });
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
    // Released against the turf being LEFT, before the payload changes underneath it —
    // otherwise the release would be aimed at the turf they are arriving on.
    if (this.segmentKey() != null) await this.postSegmentClaim(null, null);
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
      this.lastRefreshedAt.set(new Date());
      // A street scope belongs to the turf it was chosen on, never to the next one.
      this.segmentKey.set(null);
      this.mapMode.set('walk');
      this.restoreMyDoors();
      this.applyDefaultScope();
      this.startLocationSharing();
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

  /**
   * Scope the walk to one street and tell the rest of the group.
   *
   * The scope changes immediately and locally; the claim is fire-and-forget. That ordering
   * is deliberate — a volunteer narrowing to the street they are standing on must not wait
   * on a network round-trip, and a claim that never lands costs the group a label, never a
   * knock. Nothing here or on the server treats a claim as permission.
   */
  public chooseSegment(key: string | null): void {
    this.segmentKey.set(key);
    const street = key == null ? null : (this.segments().find((s) => s.key === key)?.street ?? null);
    void this.postSegmentClaim(key, street);
  }

  public householdById(id: string): CompanionHousehold | null {
    return this.households().find((h) => h.id === id) ?? null;
  }

  /** The units of one building, in unit order. Empty once the building leaves the turf. */
  public unitsFor(buildingKey: string): CompanionHousehold[] {
    return unitsOf(this.households(), buildingKey);
  }

  /**
   * Open a turf on one street rather than on all of it.
   *
   * A turf is a neighbourhood; a shift is a street. Landing on "all 143 doors" makes the
   * volunteer's first job be narrowing the list, which is work the app can do — so the
   * scope starts on the street holding the next unattempted door, and the header says
   * which street that is. Nothing is hidden: every street, including doors with no street
   * on file, is one tap away in the picker.
   *
   * Deliberately does NOT claim the street. A claim tells the rest of the group "I am
   * standing here", and the app guessing on their behalf would put a name on a street
   * nobody has walked to yet. Only an explicit pick claims.
   */
  private applyDefaultScope(): void {
    if (this.segmentKey() != null) return;
    const segments = this.segments();
    if (segments.length <= 1) return;
    const next = nextDoor(this.households());
    const key = next ? segmentKeyOf(next) : segments[0]?.key;
    if (key != null) this.segmentKey.set(key);
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
        // Meaningless without the request it delivers, and sending it alone would ask the
        // server to deliver a sign nobody has asked for.
        yard_sign_delivered: draft.wants_yard_sign && draft.yard_sign_delivered,
        set_dnc: draft.set_dnc,
        senior: draft.senior,
        contact_phone: draft.contact_phone,
        contact_email: draft.contact_email,
        subscribe: draft.subscribe,
        notes: draft.notes,
      },
    };
    this.record(op, `${this.personLabel(householdId, personId)} · ${this.addressOf(householdId)}`);
  }

  /**
   * One-tap code for a person when there was no survey to record.
   *
   * `note` is the volunteer's account of what is wrong with the record, and only
   * `data_error` collects one — the other codes say everything they mean in one word.
   */
  public personResult(
    householdId: string,
    personId: string,
    result: Exclude<CompanionPersonResult, 'canvassed'>,
    note?: string,
  ): void {
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'person_result',
      payload: {
        household_id: householdId,
        person_id: personId,
        result,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    };
    this.record(op, `${this.personLabel(householdId, personId)} · ${this.addressOf(householdId)}`);
  }

  /**
   * The canvasser handed over (or took back) this door's yard sign.
   *
   * Door-level, because the sign goes in the lawn rather than to a person. Returns false
   * when there is nothing to act on, so the caller can stay silent instead of claiming a
   * delivery it did not record.
   */
  public yardSign(householdId: string, delivered: boolean): boolean {
    const sign = this.householdById(householdId)?.yard_sign ?? null;
    if (sign == null) return false;
    if ((sign.status === 'delivered') === delivered) return false;
    const op: CompanionOpType = {
      ...this.baseOp(),
      type: 'yard_sign',
      payload: { household_id: householdId, delivered },
    };
    this.record(op, `${delivered ? 'Sign delivered' : 'Sign delivery undone'} · ${this.addressOf(householdId)}`);
    return true;
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
      moved: 'Moved out',
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
    // Before any early return, including the offline one: a wedged queue must show up in
    // the "couldn't sync" list the moment the app notices, not only once a POST succeeds.
    this.quarantineUnresolvable();
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
        // (still queued) must ack first so the real id can swap in.
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
        // A response that acknowledged nothing we sent leaves this batch at the head of
        // the queue, and the loop would post it again forever. Measured against the batch
        // rather than the queue length, because a volunteer can record another door while
        // the POST is in flight. Stop and show the sync failure instead of spinning.
        const sentIds = new Set(batch.map((entry) => entry.op.op_id));
        if (this.queue().filter((entry) => sentIds.has(entry.op.op_id)).length === batch.length) {
          this.syncStatus.set('error');
          return;
        }
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

  /**
   * Put the retryable held results back on the queue and try again.
   *
   * Only the retryable ones move: a result whose person id is gone would fail in exactly
   * the same way, and a button that quietly does nothing is worse than no button. Their
   * optimistic overlay comes back with them, so the door shows the work again while it
   * is in flight.
   */
  public async retryBlocked(): Promise<void> {
    const retrying = this.blocked().filter((b) => b.retryable);
    if (retrying.length === 0) return;
    const ids = new Set(retrying.map((b) => b.entry.op.op_id));
    this.blocked.update((list) => list.filter((b) => !ids.has(b.entry.op.op_id)));
    this.persistBlocked();
    const entries = retrying.map((b) => b.entry);
    this.localOps.update((l) => [...l, ...entries]);
    this.queue.update((q) => [...q, ...entries]);
    this.persistQueue();
    await this.flush(true);
  }

  /** The volunteer decided a held result is not worth keeping. */
  public discardBlocked(opId: string): void {
    this.blocked.update((list) => list.filter((b) => b.entry.op.op_id !== opId));
    this.persistBlocked();
  }

  public discardAllBlocked(): void {
    this.blocked.set([]);
    this.persistBlocked();
  }

  /**
   * "End shift on this device" — sign this phone out and wipe its local traces.
   *
   * The sign-out is the part that was missing. Clearing the queue, the overlay and the
   * two stored keys left the device SESSION untouched: the token stayed in localStorage
   * and stayed valid on the server for its full 30 days, so whoever opened the app next
   * was back inside the assigned turf — names, addresses, recorded support levels,
   * do-not-contact flags — with nothing to re-verify. `endSession` revokes it server-side
   * as well, so a copied token dies with the shift rather than outliving it.
   */
  public async endShift(): Promise<void> {
    // Stop the location broadcast FIRST: the watch must not outlive the "sharing
    // stopped" confirmation the volunteer is about to read, and a ping fired after the
    // session below is revoked would 401. Then tell the server the shift is over, while
    // the session is still valid — so the board reads the tap's time, not a 30-minute
    // timeout later.
    this.geo.stop();
    await this.postShiftEnd();
    // Hand the street back so tomorrow's group isn't told it's taken. The TTL would get
    // there eventually; saying so now is the honest version.
    if (this.segmentKey() != null) void this.postSegmentClaim(null, null);
    try {
      localStorage.removeItem(this.storageKey());
      localStorage.removeItem(this.myDoorsKey());
      localStorage.removeItem(BLOCKED_KEY);
    } catch {
      // Storage unavailable — the in-memory clear below still applies.
    }
    this.queue.set([]);
    this.blocked.set([]);
    this.localOps.set([]);
    this.myDoorIds.set(new Set<string>());
    this.lastAction.set(null);
    this.workOffline.set(false);
    this.syncStatus.set('idle');
    this.segmentKey.set(null);
    this.mapMode.set('walk');
    this.view.set({ kind: 'landing' });
    // Last, so a slow or failed revoke never leaves turf data on screen after the
    // volunteer has been told the shift ended.
    await this.session.endSession();
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
        // The server did not record it, so the optimistic overlay has to go — but the
        // work itself moves to the "couldn't sync" list instead of being deleted.
        this.localOps.update((l) => l.filter((e) => e.op.op_id !== ack.op_id));
        if (this.lastAction()?.op_id === ack.op_id) this.lastAction.set(null);
        const reason = ack.error ?? 'Your organizer’s copy refused it.';
        this.block(entry, reason, true);
        // Everything queued against a person the server would not create is refused for
        // the same reason. It is shown alongside, not quietly deleted with them.
        if (entry.temp_person_id != null) {
          this.blockOpsReferencing(entry.temp_person_id, `Recorded for ${entry.label}, which could not be saved.`);
        }
        this.alerts.showError(`Couldn't sync "${entry.label}": ${reason} It is kept under Sync in the Me tab.`);
      } else if (entry.op.type === 'person_create' && entry.temp_person_id != null) {
        // `applied` and `duplicate` both mean the person exists on the server. With an
        // id we can finish the job; without one (an op applied before the ledger kept
        // results) nothing later can supply it, so we stop pretending it will.
        if (ack.person_id != null) this.swapTempId(entry.temp_person_id, ack.person_id);
        else this.forgetUnresolvedPerson(entry);
      }
      // Applied, but a best-effort side effect did not land (e.g. the survey's sign handover
      // when another campaign holds the request). The op counts as synced; the volunteer
      // still needs to hear what was NOT recorded.
      if (ack.status !== 'rejected' && ack.warning) {
        this.alerts.showInfo(`"${entry.label}": ${ack.warning}`);
      }
    }
    this.persistQueue();
  }

  private baseOp(): { op_id: string; recorded_at: string } {
    return { op_id: crypto.randomUUID(), recorded_at: new Date().toISOString() };
  }

  /** Move a result out of the queue and into the list the volunteer can act on. */
  private block(entry: QueuedOp, reason: string, retryable: boolean): void {
    this.blocked.update((list) =>
      list.some((b) => b.entry.op.op_id === entry.op.op_id) ? list : [...list, { entry, reason, retryable }],
    );
    this.persistBlocked();
  }

  /** Everything queued against one temp person, held with a shared explanation. */
  private blockOpsReferencing(tempId: string, reason: string): QueuedOp[] {
    const affected = this.queue().filter((entry) => opPersonId(entry.op) === tempId);
    if (affected.length === 0) return [];
    const ids = new Set(affected.map((entry) => entry.op.op_id));
    this.queue.update((q) => q.filter((entry) => !ids.has(entry.op.op_id)));
    this.localOps.update((l) => l.filter((entry) => !ids.has(entry.op.op_id)));
    for (const entry of affected) this.block(entry, reason, false);
    return affected;
  }

  /**
   * Say what stopped, by name where there is only one.
   *
   * The wedged state used to produce no toast and no banner at all — a volunteer who
   * never opened the Me tab had no way to learn their results had stopped going out.
   */
  private announceHeld(entries: readonly QueuedOp[]): void {
    const first = entries[0];
    if (!first) return;
    this.alerts.showError(
      entries.length === 1
        ? `Couldn't sync “${first.label}”. It is kept under Sync in the Me tab.`
        : `${entries.length} results couldn't be synced. They are kept under Sync in the Me tab.`,
    );
  }

  /**
   * The server has this person but will never tell us their id — stop showing the
   * placeholder, and hold everything recorded against it.
   *
   * Clearing the overlay entry matters as much as holding the dependents: while the
   * `tmp-` person keeps rendering on the door, every further survey or one-tap result
   * the volunteer records against them queues another op that can never be sent. The
   * real person is already on the server, so the refresh below brings them back with
   * their true id and the door reads correctly again.
   */
  private forgetUnresolvedPerson(entry: QueuedOp): void {
    const tempId = entry.temp_person_id;
    if (tempId == null) return;
    this.localOps.update((l) => l.filter((e) => e.op.op_id !== entry.op.op_id));
    this.announceHeld(this.blockOpsReferencing(tempId, UNRESOLVABLE_REASON));
    void this.refresh();
  }

  private expireSession(): void {
    this.session.clearSession();
    this.sessionExpired.set(true);
  }

  /**
   * Post (or release) this device's street claim. Silent on every failure by design —
   * see `chooseSegment`. A null key releases whatever was held.
   */
  private async postSegmentClaim(key: string | null, street: string | null): Promise<void> {
    const turfId = this.payload()?.turf_id;
    if (!turfId) return;
    try {
      await fetch(`/api/canvass/turf/${encodeURIComponent(turfId)}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.session.headers() },
        body: JSON.stringify({ street_key: key, street }),
      });
    } catch {
      // Advisory only — the group's picture is briefly stale and nothing else changes.
    }
  }

  /**
   * Start (or resume) the location broadcast for a freshly opened turf. This is the one
   * place the app asks for the permission without a tap: the volunteer has just opened
   * their turf and the shell is showing the sharing banner, so the prompt has its
   * context. A refusal is respected — one `{denied:true}` report and nothing more.
   */
  private startLocationSharing(): void {
    this.deniedReportedForTurf = null;
    this.geo.request();
  }

  /**
   * One location broadcast. Silent on every failure by design — a volunteer at a
   * doorstep must never see an error about a dot on an organizer's map; the next
   * minute's ping is the retry. Sends `{denied:true}` once per turf when the
   * permission is off, so the board can say "Location off" instead of nothing.
   */
  private async sendLocationPing(): Promise<void> {
    const turfId = this.payload()?.turf_id;
    if (!turfId || !this.online() || this.sessionExpired()) return;
    const state = this.geo.state();
    let body: string | null = null;
    if (state === 'ready') {
      const fix = this.geo.fix();
      if (!fix) return;
      body = JSON.stringify({
        lat: fix.lat,
        lng: fix.lng,
        accuracy_m: fix.accuracy_m ?? undefined,
        recorded_at: fix.at.toISOString(),
      });
    } else if (state === 'denied' && this.deniedReportedForTurf !== turfId) {
      body = JSON.stringify({ denied: true });
    }
    if (body == null) return;
    try {
      const res = await fetch(`/api/canvass/turf/${encodeURIComponent(turfId)}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.session.headers() },
        body,
      });
      if (res.ok && state === 'denied') this.deniedReportedForTurf = turfId;
    } catch {
      // Silent — see above.
    }
  }

  /** Close the shift server-side. The 30-minute timeout is the fallback if this misses. */
  private async postShiftEnd(): Promise<void> {
    try {
      await fetch('/api/canvass/shift/end', { method: 'POST', headers: this.session.headers() });
    } catch {
      // Ending the device session still proceeds; the server closes the shift by timeout.
    }
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

  private persistBlocked(): void {
    try {
      localStorage.setItem(BLOCKED_KEY, JSON.stringify(this.blocked()));
    } catch {
      // Storage full/blocked — the list still lives in memory for this visit.
    }
  }

  private restoreBlocked(): void {
    try {
      const raw = localStorage.getItem(BLOCKED_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.blocked.set(parsed.filter(isBlockedOp));
    } catch {
      // Corrupt/blocked storage — start with nothing held rather than crash.
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
    this.restoreBlocked();
    try {
      const raw = localStorage.getItem(QUEUE_KEY) ?? this.legacyQueue();
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

  /** Adopt a queue written under the old per-token key, then retire that key. */
  private legacyQueue(): string | null {
    if (!this.token) return null;
    const legacyKey = `${LEGACY_QUEUE_KEY_PREFIX}${this.token}`;
    const raw = localStorage.getItem(legacyKey);
    if (raw) localStorage.removeItem(legacyKey);
    return raw;
  }

  /**
   * The temp person ids a `person_create` still sitting in the queue will produce.
   *
   * This is the whole test for "can this dependency ever resolve?". A queued op naming a
   * temp person that no queued `person_create` produces is waiting on something that no
   * longer exists — a fact about the queue, not a guess. It needs no attempt counter and
   * no clock, so it cannot drop a result early because the network was slow, and it
   * cannot leave a phone wedged while a timer runs down. It also covers the phones
   * already stuck in the field, whose `person_create` was dequeued by an earlier build.
   */
  private producibleTempPersonIds(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const entry of this.queue()) {
      if (entry.op.type !== 'person_create') continue;
      const temp = entry.temp_person_id;
      if (temp != null) out.add(temp);
    }
    return out;
  }

  /** Queue entries waiting on a person nobody will ever create. */
  private unresolvableEntries(): QueuedOp[] {
    const producible = this.producibleTempPersonIds();
    return this.queue().filter((entry) => {
      const personId = opPersonId(entry.op);
      return personId != null && isTempPersonId(personId) && !producible.has(personId);
    });
  }

  /**
   * Take unresolvable results off the queue and put them in front of the volunteer.
   *
   * The backstop that does not need the server: a phone that wedged before the ledger
   * stored op results has no fix coming from the other end, so the app has to notice on
   * its own. Dropping them silently would be the same bug wearing a different face, so
   * every one of them lands in `blocked` with what it was and why it stopped.
   */
  private quarantineUnresolvable(): void {
    const stuck = this.unresolvableEntries();
    if (stuck.length === 0) return;
    const ids = new Set(stuck.map((entry) => entry.op.op_id));
    this.queue.update((q) => q.filter((entry) => !ids.has(entry.op.op_id)));
    this.localOps.update((l) => l.filter((entry) => !ids.has(entry.op.op_id)));
    for (const entry of stuck) this.block(entry, UNRESOLVABLE_REASON, false);
    this.persistQueue();
    this.announceHeld(stuck);
  }

  /**
   * The next batch to send: entries that share one turf, skipping any still waiting on a
   * `person_create` ahead of them in the queue.
   *
   * Skipping rather than stopping is the point. One held-back entry used to end the scan,
   * so a single unresolvable result at the head froze every unrelated door recorded after
   * it. The held-back entry travels in a later batch, once its person has an id.
   *
   * Stopping at a turf change still matters — each batch posts to one turf's endpoint, and
   * a queue can span turfs after a mid-shift switch. The next flush picks up the rest.
   *
   * Capped at the server's per-POST limit: a batch over it is rejected whole by the request
   * schema, and since nothing here would shrink it, the phone re-sent the same over-limit
   * body forever. The overflow travels in the next flush, exactly like a turf change.
   */
  private sendableBatch(): QueuedOp[] {
    const producible = this.producibleTempPersonIds();
    const out: QueuedOp[] = [];
    let turfId: string | undefined;
    for (const entry of this.queue()) {
      if (out.length >= COMPANION_OPS_MAX_PER_BATCH) break;
      const personId = opPersonId(entry.op);
      if (personId != null && isTempPersonId(personId) && producible.has(personId)) continue;
      if (out.length === 0) turfId = entry.turf_id;
      else if (entry.turf_id !== turfId) break;
      out.push(entry);
    }
    return out;
  }

  private storageKey(): string {
    return QUEUE_KEY;
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
