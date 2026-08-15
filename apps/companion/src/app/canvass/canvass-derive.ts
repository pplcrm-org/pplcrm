import type {
  CanvassStance,
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionOpType,
  CompanionPerson,
  CompanionSurveyPrefill,
  KnockResponse,
  LatLng,
} from '@common';
import {
  KNOCK_RESPONSE_TO_STANCE,
  SUPPORT_LEVEL_TO_STANCE,
  VOTED_STATUSES,
  orderForWalk,
  streetKeyOf,
  streetNumberValue,
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
    case 'outcome:moved':
      return 'Moved out';
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

/**
 * The segment a door belongs to. Exported so filtering and grouping can never disagree.
 * Delegates to the shared `streetKeyOf` so the walking order (also derived from it, in
 * libs/common) and the street scope can never split on spelling.
 */
export function segmentKeyOf(h: CompanionHousehold): string {
  return streetKeyOf(h.street) || UNKNOWN_SEGMENT_KEY;
}

// ---------------------------------------------------------------------------
// Street sides — the odd-numbered side and the even-numbered side
// ---------------------------------------------------------------------------

/** Which house-number parity side of the street a door stands on. */
export type StreetSide = 'odd' | 'even';

/** The walk list's side narrowing: one parity side, or no narrowing at all. */
export type SideFilter = StreetSide | 'both';

/** A door's side, or null when its house number has no leading digits to read one from. */
export function doorSide(h: CompanionHousehold): StreetSide | null {
  const num = streetNumberValue(h.street_num);
  if (num == null) return null;
  return num % 2 === 0 ? 'even' : 'odd';
}

export interface SideBreakdown {
  /** Whether narrowing to one side is worth offering for these doors at all. */
  available: boolean;
  /** Doors the 'odd' filter would show — odd-numbered plus the unplaceable ones. */
  odd: number;
  /** Doors the 'even' filter would show — even-numbered plus the unplaceable ones. */
  even: number;
}

/** Fewer numbered doors than this on a side and "filter to that side" filters almost nothing. */
const MIN_DOORS_PER_SIDE = 2;

/**
 * Whether a side filter makes sense for the doors in scope, and what each side holds.
 *
 * Volunteers walk one side of a street at a time, and house numbers are even on one side
 * and odd on the other — so the side is derivable, not stored. It is only offered when it
 * would mean something: a single street (parity across different streets says nothing
 * about where anyone is standing), at least MIN_DOORS_PER_SIDE numbered doors on each
 * side, and no more unplaceable doors than numbered ones. Anywhere thinner the control
 * disappears rather than offering a filter that mostly cannot filter.
 */
export function deriveSideBreakdown(households: readonly CompanionHousehold[]): SideBreakdown {
  let odd = 0;
  let even = 0;
  let unplaced = 0;
  const streets = new Set<string>();
  for (const h of households) {
    streets.add(segmentKeyOf(h));
    const side = doorSide(h);
    if (side === 'odd') odd += 1;
    else if (side === 'even') even += 1;
    else unplaced += 1;
  }
  const available =
    streets.size === 1 && odd >= MIN_DOORS_PER_SIDE && even >= MIN_DOORS_PER_SIDE && odd + even >= unplaced;
  return { available, odd: odd + unplaced, even: even + unplaced };
}

/**
 * Whether a door shows under a side filter. A door whose number carries no parity shows on
 * BOTH sides — a filter may narrow the walk, but it must never make a door unreachable.
 */
export function matchesSide(h: CompanionHousehold, side: SideFilter): boolean {
  if (side === 'both') return true;
  const placed = doorSide(h);
  return placed == null || placed === side;
}

// ---------------------------------------------------------------------------
// Buildings — apartments folded back into the address they share
// ---------------------------------------------------------------------------

/**
 * A row on the walk list: either one door, or one building holding many.
 *
 * An apartment is an ordinary household that happens to carry an `apt`, so a 40-unit block
 * arrives as 40 rows that all read "58 Huron Avenue N". That is not a walk list — it is a
 * wall. Folding them into one row costs one tap and gives the volunteer back the thing the
 * list is for: knowing where to go next.
 */
export type WalkEntry =
  | { kind: 'door'; key: string; walkOrder: number; household: CompanionHousehold }
  | {
      kind: 'building';
      key: string;
      walkOrder: number;
      /** The shared street address, with no unit on the end. */
      address: string;
      units: CompanionHousehold[];
      attempted: number;
    };

/**
 * The building a door belongs to, or null when it stands alone.
 *
 * Keyed on street number + normalized street, and ONLY for doors that carry a unit. Two
 * unit-less households sharing a street number are a duplicate-data problem, not a
 * building, and folding them would hide it.
 */
export function buildingKeyOf(h: CompanionHousehold): string | null {
  if (!h.apt?.trim()) return null;
  const num = h.street_num?.trim().toLowerCase();
  if (!num) return null;
  return `${num}|${segmentKeyOf(h)}`;
}

/**
 * Group doors into walk-list rows, keeping walk order.
 *
 * A building takes the walk order of its earliest unit, so folding never moves a block
 * somewhere else in the walk. A "building" of exactly one unit stays a plain door — a row
 * that says "1 unit" and opens a list of one is pure ceremony.
 */
export function deriveWalkEntries(households: readonly CompanionHousehold[]): WalkEntry[] {
  const buildings = new Map<string, CompanionHousehold[]>();
  const singles: CompanionHousehold[] = [];

  for (const h of households) {
    const key = buildingKeyOf(h);
    if (key == null) {
      singles.push(h);
      continue;
    }
    const existing = buildings.get(key);
    if (existing) existing.push(h);
    else buildings.set(key, [h]);
  }

  const entries: WalkEntry[] = singles.map((household) => ({
    kind: 'door',
    key: household.id,
    walkOrder: household.walk_order,
    household,
  }));

  for (const [key, units] of buildings) {
    const only = units.length === 1 ? units[0] : null;
    if (only) {
      entries.push({ kind: 'door', key: only.id, walkOrder: only.walk_order, household: only });
      continue;
    }
    const sorted = [...units].sort(compareUnits);
    entries.push({
      kind: 'building',
      key,
      walkOrder: Math.min(...units.map((u) => u.walk_order)),
      address: buildingAddress(sorted),
      units: sorted,
      attempted: units.filter(isAttempted).length,
    });
  }

  return entries.sort((a, b) => a.walkOrder - b.walkOrder);
}

/** The units of one building, in the order a canvasser walks them. */
export function unitsOf(households: readonly CompanionHousehold[], buildingKey: string): CompanionHousehold[] {
  return households.filter((h) => buildingKeyOf(h) === buildingKey).sort(compareUnits);
}

/**
 * Whether a walk-list row still has work behind it. A building remains until
 * every unit is attempted. Exported so the list's Remaining filter, the map's
 * colours and the next-door ring all read the same answer.
 */
export function entryRemaining(entry: WalkEntry): boolean {
  return entry.kind === 'building' ? entry.attempted < entry.units.length : !isAttempted(entry.household);
}

/** The household whose street parts place an entry in the walking order. */
function entryHousehold(entry: WalkEntry): CompanionHousehold | null {
  return entry.kind === 'door' ? entry.household : (entry.units[0] ?? null);
}

/**
 * Walk-list rows in the suggested walking order: streets as the cutter reaches
 * them, and within a street up one house-number side and back down the other.
 * A thin adapter over the shared `orderForWalk` (libs/common), which the CRM
 * turf page and the printable walk sheet also use — one order, three surfaces.
 */
export function orderEntriesForWalk(entries: readonly WalkEntry[]): WalkEntry[] {
  const orderable = entries.map((entry) => {
    const h = entryHousehold(entry);
    return { entry, street: h?.street ?? null, street_num: h?.street_num ?? null, walk_order: entry.walkOrder };
  });
  return orderForWalk(orderable).map((o) => o.entry);
}

/** "302" before "1104" before "PH2" — numeric where it can be, alphabetical where it can't. */
function compareUnits(a: CompanionHousehold, b: CompanionHousehold): number {
  // Wholly-numeric only: "PH2" and "B" are labels, not numbers, and belong after the digits.
  const aNum = a.apt != null && /^\d+$/.test(a.apt.trim());
  const bNum = b.apt != null && /^\d+$/.test(b.apt.trim());
  const an = aNum ? Number(a.apt?.trim()) : 0;
  const bn = bNum ? Number(b.apt?.trim()) : 0;
  if (aNum && bNum && an !== bn) return an - bn;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return (a.apt ?? '').localeCompare(b.apt ?? '');
}

/**
 * The building's own address: the shared part of its units' addresses.
 *
 * Derived by stripping the unit off the first unit's formatted address rather than
 * re-joining street parts, so the building reads exactly the way its doors do — including
 * the city and postal code a volunteer uses to confirm they are at the right block.
 */
function buildingAddress(units: readonly CompanionHousehold[]): string {
  const first = units[0];
  if (!first) return '';
  const apt = first.apt?.trim();
  if (!apt) return first.address;
  const withoutUnit = first.address
    .split(', ')
    .filter((part) => part !== apt && part !== `Unit ${apt}`)
    .join(', ');
  return withoutUnit || first.address;
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
// Stance — the one thing a walk-list row is coloured by
// ---------------------------------------------------------------------------

/** null = nobody has ever said; 'mixed' = this door disagrees with itself. */
export type DoorStance = CanvassStance | 'mixed' | null;

/**
 * What one person's stance is right now.
 *
 * A survey recorded on this walk beats the CRM's prior read, because it is newer and it is
 * the thing the volunteer standing here just heard. With no survey, the prior ID answers —
 * that is the entire reason it is in the payload.
 */
export function personStance(p: CompanionPerson): CanvassStance | null {
  const surveyed = p.survey?.support;
  if (surveyed != null) return KNOCK_RESPONSE_TO_STANCE[surveyed] ?? null;
  return p.support != null ? SUPPORT_LEVEL_TO_STANCE[p.support] : null;
}

/**
 * The whole door's stance, folding every resident plus the anonymous household survey.
 *
 * Unanimity or nothing: a house where one person supports and another opposes is 'mixed',
 * never the average of the two. Averaging would put a confident colour on the doors that
 * most need a conversation.
 */
export function householdStance(h: CompanionHousehold): DoorStance {
  const voices: CanvassStance[] = [];
  for (const p of h.people) {
    const stance = personStance(p);
    if (stance != null) voices.push(stance);
  }
  const hh = h.hh_survey?.support;
  if (hh != null) {
    const stance = KNOCK_RESPONSE_TO_STANCE[hh];
    if (stance != null) voices.push(stance);
  }
  const first = voices[0];
  if (first === undefined) return null;
  return voices.every((v) => v === first) ? first : 'mixed';
}

/** Somebody at this door has already cast a ballot — the green check on the row. */
export function hasVoted(h: CompanionHousehold): boolean {
  return h.people.some((p) => p.voting_status != null && VOTED_STATUSES.includes(p.voting_status));
}

/**
 * Residents as one line, with the surname said once.
 *
 * "Heather Gagnon, Ross Gagnon" is the same information as "Heather & Ross Gagnon" and
 * twice the width on a phone. Surnames only fold when EVERY named resident shares one —
 * a blended household gets full names, because that is exactly where the surname matters.
 * Deceased residents are dropped: a canvasser reading a name off a screen and asking for
 * that person at the door is the failure this whole feature exists to prevent.
 */
export function residentSummary(h: CompanionHousehold): string {
  const living = h.people.filter((p) => !p.deceased);
  if (living.length === 0) return '';
  const surnames = new Set(living.map((p) => p.last_name?.trim().toLowerCase()).filter(Boolean));
  const shared = surnames.size === 1 ? living[0]?.last_name?.trim() : null;
  if (shared && living.every((p) => p.last_name?.trim())) {
    const firsts = living.map((p) => firstNameOf(p.name));
    return `${joinNames(firsts)} ${shared}`;
  }
  return living.map((p) => p.name).join(', ');
}

/** "Ann", "Ann & Bo", "Ann, Bo & Cy" — the ampersand only ever separates the last pair. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Lives here rather than in canvass-ui so the pure derivations don't depend on the view layer. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
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
    case 'yard_sign':
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
            // The toggle arrives pre-filled from what the CRM holds, so it is safe to
            // mirror straight through — including a correction back to "not a senior".
            person.senior = op.payload.senior;
            if (op.payload.set_dnc) person.dnc = true;
          }
        }
        break;
      }
      case 'person_result': {
        const person = h.people.find((p) => p.id === String(op.payload.person_id));
        if (person) {
          person.result = op.payload.result;
          person.survey = null;
          // Reported dead suppresses contact immediately on the server; the card has to
          // agree before the next refresh, or the volunteer sees a name they were just
          // told not to ask for.
          if (op.payload.result === 'deceased') {
            person.deceased = true;
            person.dnc = true;
          }
        }
        break;
      }
      case 'yard_sign':
        // Only ever moves an existing request between its two doorstep states. A door with
        // no request stays null: the request the server creates in that case comes back on
        // the next refresh, and inventing one here would show a request that may not exist.
        if (h.yard_sign) {
          h.yard_sign = {
            ...h.yard_sign,
            status: op.payload.delivered ? 'delivered' : 'requested',
          };
        }
        break;
      case 'door_outcome':
        h.door_outcome = op.payload.outcome;
        break;
      case 'clear_outcome':
        h.door_outcome = null;
        break;
      case 'person_create': {
        const id = entry.temp_person_id ?? `tmp-${op.op_id}`;
        if (!h.people.some((p) => p.id === id)) {
          const name = op.payload.name.trim();
          const space = name.lastIndexOf(' ');
          h.people.push({
            id,
            name,
            // Split the same way the server does, so the row folds surnames identically
            // before and after the ack swaps the real id in.
            last_name: space > 0 ? name.slice(space + 1) : null,
            dnc: false,
            support: null,
            voting_status: null,
            deceased: false,
            senior: null,
            result: null,
            survey: null,
          });
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
