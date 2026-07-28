import type {
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionOpType,
  CompanionPerson,
  CompanionSurveyPrefill,
  KnockResponse,
  LatLng,
} from '@common';

/**
 * Pure derivations over the Companion turf payload (spec §3 "derived, never
 * stored"). No Angular here — every door status, progress number, and Me-tab
 * stat is recomputed from the households array (server payload + the local
 * optimistic ops replayed on top by `applyLocalOps`), so the UI can never
 * disagree with the data it was derived from.
 */

// ---------------------------------------------------------------------------
// Door status
// ---------------------------------------------------------------------------

export type DoorStatus = 'dnc' | `outcome:${CompanionDoorOutcome}` | 'canvassed' | 'in_progress' | 'not_visited';

/**
 * The one derivation the whole walk list hangs off. Precedence: DNC beats
 * everything (skip the door — it still counts), then an explicit door outcome,
 * then survey completion.
 */
export function doorStatus(h: CompanionHousehold): DoorStatus {
  if (h.dnc) return 'dnc';
  if (h.door_outcome != null) return `outcome:${h.door_outcome}`;
  const resulted = h.people.filter((p) => p.result != null).length;
  if (h.hh_survey != null || (h.people.length > 0 && resulted === h.people.length)) return 'canvassed';
  if (resulted > 0) return 'in_progress';
  return 'not_visited';
}

/** Sentence-case chip label for a derived door status. */
export function doorStatusLabel(status: DoorStatus): string {
  switch (status) {
    case 'dnc':
      return 'Do not contact';
    case 'outcome:no_answer':
      return 'No answer';
    case 'outcome:inaccessible':
      return 'Inaccessible';
    case 'outcome:refused':
      return 'Refused';
    case 'canvassed':
      return 'Canvassed';
    case 'in_progress':
      return 'In progress';
    case 'not_visited':
      return 'Not visited';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * A door counts toward progress once it is resolved: canvassed, marked with a
 * door outcome, or DNC ("DNC doors still count toward your turf" — spec §3.4).
 * In-progress doors are not yet attempted.
 */
export function isAttempted(h: CompanionHousehold): boolean {
  const status = doorStatus(h);
  return status !== 'not_visited' && status !== 'in_progress';
}

/** The next open door: lowest walk_order not yet attempted. */
export function nextDoor(households: readonly CompanionHousehold[]): CompanionHousehold | null {
  let next: CompanionHousehold | null = null;
  for (const h of households) {
    if (isAttempted(h)) continue;
    if (next == null || h.walk_order < next.walk_order) next = h;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Street segments
// ---------------------------------------------------------------------------

/** Doors with no street on file all land in one bucket rather than one bucket each. */
export const UNKNOWN_SEGMENT_KEY = '';

export interface CanvassSegment {
  /** Selection key: the normalized street, or `''` for doors with no street on file. */
  key: string;
  /** What to show — the first spelling encountered, not the normalized key. */
  street: string;
  doors: number;
  attempted: number;
  /** Lowest walk order in the segment. Segments sort by this, so the list keeps walk order. */
  minWalkOrder: number;
  /** Mean of the geocoded doors; null when none of them are geocoded. */
  centroid: LatLng | null;
}

/**
 * Group a turf's doors by street.
 *
 * A volunteer standing on Scott Blvd wants Scott Blvd, not all 143 doors in the turf —
 * and a group splitting a turf needs some unit to split by. The street is that unit,
 * derived here rather than stored, like everything else in this file.
 *
 * Streets are keyed case- and whitespace-insensitively (`Alder St` and `alder  st` are one
 * street) but displayed with the first spelling seen, because normalizing what a volunteer
 * reads would be a lie about the data. Segments come back in walk order — the ordering the
 * turf was cut in, and the only one that means anything on foot.
 */
export function deriveSegments(households: readonly CompanionHousehold[]): CanvassSegment[] {
  interface Acc extends CanvassSegment {
    latSum: number;
    lngSum: number;
    geocoded: number;
  }
  const byKey = new Map<string, Acc>();

  for (const h of households) {
    const key = segmentKeyOf(h);
    const existing = byKey.get(key);
    const acc: Acc = existing ?? {
      key,
      street: h.street?.trim() || 'No street on file',
      doors: 0,
      attempted: 0,
      minWalkOrder: h.walk_order,
      centroid: null,
      latSum: 0,
      lngSum: 0,
      geocoded: 0,
    };
    acc.doors += 1;
    if (isAttempted(h)) acc.attempted += 1;
    if (h.walk_order < acc.minWalkOrder) acc.minWalkOrder = h.walk_order;
    if (h.lat != null && h.lng != null) {
      acc.latSum += h.lat;
      acc.lngSum += h.lng;
      acc.geocoded += 1;
    }
    byKey.set(key, acc);
  }

  return [...byKey.values()]
    .map(
      ({ latSum, lngSum, geocoded, ...segment }): CanvassSegment => ({
        ...segment,
        centroid: geocoded > 0 ? { lat: latSum / geocoded, lng: lngSum / geocoded } : null,
      }),
    )
    .sort((a, b) => a.minWalkOrder - b.minWalkOrder);
}

/** The segment a door belongs to. Exported so filtering and grouping can never disagree. */
export function segmentKeyOf(h: CompanionHousehold): string {
  const street = h.street?.trim().toLowerCase().replace(/\s+/g, ' ');
  return street ? street : UNKNOWN_SEGMENT_KEY;
}

// ---------------------------------------------------------------------------
// Conversations + consensus
// ---------------------------------------------------------------------------

/** Completed surveys: people surveyed ('canvassed') plus household-level surveys. */
export function conversations(households: readonly CompanionHousehold[]): number {
  let count = 0;
  for (const h of households) {
    if (h.hh_survey != null) count += 1;
    count += h.people.filter((p) => p.result === 'canvassed').length;
  }
  return count;
}

/**
 * The door's surveyed stance. Every survey at the door (each surveyed person
 * plus the anonymous household survey) casts a voice; all agree → that level,
 * any disagreement → 'mixed', no stance recorded → null.
 */
export function supportConsensus(h: CompanionHousehold): KnockResponse | 'mixed' | null {
  const voices: KnockResponse[] = [];
  for (const p of h.people) {
    if (p.survey?.support != null) voices.push(p.survey.support);
  }
  if (h.hh_survey?.support != null) voices.push(h.hh_survey.support);
  const first = voices[0];
  if (first === undefined) return null;
  return voices.every((v) => v === first) ? first : 'mixed';
}

// ---------------------------------------------------------------------------
// Me-tab stats
// ---------------------------------------------------------------------------

export interface IssueCount {
  issue: string;
  count: number;
}

export interface MeStats {
  doors_attempted: number;
  doors_total: number;
  conversations: number;
  /** Surveys (person or household) recorded with support = 'supporter'. */
  supporters: number;
  /** Doors with at least one conversation ÷ doors attempted, as a 0–100 integer. */
  contact_rate: number;
  /** Issues ranked by mentions across all surveys; count desc, then A–Z. */
  top_issues: IssueCount[];
}

export function meStats(households: readonly CompanionHousehold[]): MeStats {
  let attempted = 0;
  let supporters = 0;
  let doorsWithConversation = 0;
  const issueCounts = new Map<string, number>();

  const tally = (survey: CompanionSurveyPrefill | null): void => {
    if (survey == null) return;
    if (survey.support === 'supporter') supporters += 1;
    for (const issue of survey.issues) issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
  };

  for (const h of households) {
    if (isAttempted(h)) attempted += 1;
    const talked = h.hh_survey != null || h.people.some((p) => p.result === 'canvassed');
    if (talked) doorsWithConversation += 1;
    tally(h.hh_survey);
    for (const p of h.people) tally(p.survey);
  }

  const top_issues = [...issueCounts.entries()]
    .map(([issue, count]): IssueCount => ({ issue, count }))
    .sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue));

  return {
    doors_attempted: attempted,
    doors_total: households.length,
    conversations: conversations(households),
    supporters,
    contact_rate: attempted > 0 ? Math.round((doorsWithConversation / attempted) * 100) : 0,
    top_issues,
  };
}

// ---------------------------------------------------------------------------
// Local optimistic overlay — replay queued/acked ops over the server payload
// ---------------------------------------------------------------------------

/**
 * One locally-recorded op. `temp_person_id` exists only for `person_create`:
 * the placeholder id the UI shows until the server ack supplies the real one.
 */
export interface LocalOp {
  op: CompanionOpType;
  temp_person_id?: string;
}

/** Client-side placeholder ids for people added at the door, pre-ack. */
export function isTempPersonId(id: string): boolean {
  return id.startsWith('tmp-');
}

/** The person id an op targets, if the op type carries one. */
export function opPersonId(op: CompanionOpType): string | null {
  switch (op.type) {
    case 'survey':
      return op.payload.person_id == null ? null : String(op.payload.person_id);
    case 'person_result':
      return String(op.payload.person_id);
    case 'door_outcome':
    case 'clear_outcome':
    case 'person_create':
      return null;
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

function toPrefill(payload: Extract<CompanionOpType, { type: 'survey' }>['payload']): CompanionSurveyPrefill {
  return {
    support: payload.support ?? null,
    issues: [...payload.issues],
    wants_volunteer: payload.wants_volunteer,
    wants_yard_sign: payload.wants_yard_sign,
    set_dnc: payload.set_dnc,
    subscribe: payload.subscribe,
  };
}

/**
 * Replay local ops (queued + already-acked-this-session) over the server
 * households, newest last so the latest action wins — the same "latest knock
 * wins" rule the backend derives from. Pure and non-mutating.
 */
export function applyLocalOps(
  households: readonly CompanionHousehold[],
  ops: readonly LocalOp[],
): CompanionHousehold[] {
  const byId = new Map<string, CompanionHousehold>(
    households.map((h) => [h.id, { ...h, people: h.people.map((p): CompanionPerson => ({ ...p })) }]),
  );

  for (const entry of ops) {
    const op = entry.op;
    const h = byId.get(String(op.payload.household_id));
    if (!h) continue;
    switch (op.type) {
      case 'survey': {
        const prefill = toPrefill(op.payload);
        if (op.payload.person_id == null) {
          h.hh_survey = prefill;
        } else {
          const person = h.people.find((p) => p.id === String(op.payload.person_id));
          if (person) {
            person.result = 'canvassed';
            person.survey = prefill;
          }
        }
        break;
      }
      case 'person_result': {
        const person = h.people.find((p) => p.id === String(op.payload.person_id));
        if (person) {
          person.result = op.payload.result;
          person.survey = null;
        }
        break;
      }
      case 'door_outcome':
        h.door_outcome = op.payload.outcome;
        break;
      case 'clear_outcome':
        h.door_outcome = null;
        break;
      case 'person_create': {
        const id = entry.temp_person_id ?? `tmp-${op.op_id}`;
        if (!h.people.some((p) => p.id === id)) {
          h.people.push({ id, name: op.payload.name, dnc: false, result: null, survey: null });
        }
        break;
      }
      default: {
        const _exhaustive: never = op;
        void _exhaustive;
      }
    }
  }

  return households.map((h) => byId.get(h.id) ?? h);
}
