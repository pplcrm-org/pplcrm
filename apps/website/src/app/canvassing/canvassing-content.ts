import { ADDRESSES, RESIDENTS, type Feature, type FieldPreview, doorsWith } from '../home/audience-content';
import type { Limit } from '../districts/districts-content';

/**
 * Copy and mock data for the /canvassing page — turf cutting, walk sheets and the companion.
 *
 * Everything here is a factual claim about what the product does, so it is governed by the
 * `pplcrm-website-claims` registry. The sources of truth:
 *
 *  - turfs never crossing a boundary, the finest-subdivision → seat-map → unbounded fallback,
 *    the snake walk order and the doors-per-turf presets → the cutting engine
 *    (`apps/backend/src/app/modules/canvassing/lib/cutting-engine.ts`, `turf-boundary.ts`)
 *    and `DOORS_PER_TURF_PRESETS` in libs/common
 *  - turf status being derived from knock records, never stored → the canvassing module's
 *    status computation (stored status is only draft/active/retired)
 *  - the printable walk sheet (grayscale map, numbered dots, dashed route, blank result
 *    columns, QR code, schematic fallback) →
 *    `apps/frontend/src/app/experiences/canvassing/ui/turf-print-page.ts`
 *  - the walking order shared by phone, CRM and paper → `libs/common/src/lib/geo/walk-order.ts`
 *  - companion behavior (no account, one street at a time, 30-day "somebody was already
 *    here", offline queue with a visible blocked list, survey side-effects) → `apps/companion`
 *  - the volunteer trust model (one-time code, one admin approval per volunteer, QR join
 *    codes, approve-by-text, revoke-all-devices) → `modules/companion-access`
 *  - plan gating (canvassing, companions and geocoding are Movement; a demo workspace gates
 *    as Movement) → `libs/common/src/lib/billing/plans.ts`
 *
 * If any of those change, this file changes in the same commit. Do not add a number here
 * that is not read off the code.
 */

/** The doors-per-turf presets the cutter offers. Mirrors `DOORS_PER_TURF_PRESETS`. */
export interface DoorPreset {
  readonly doors: string;
  readonly recommended?: true;
}

export const DOOR_PRESETS: readonly DoorPreset[] = [
  { doors: '30' },
  { doors: '40', recommended: true },
  { doors: '50' },
  { doors: '60' },
];

/**
 * The badges a turf wears, in lifecycle order. Labels must match the app verbatim — every
 * one is computed from the actual knock records at read time, never flipped by hand.
 */
export interface TurfStatus {
  readonly label: string;
  readonly body: string;
}

export const TURF_STATUSES: readonly TurfStatus[] = [
  {
    label: 'Needs canvassers',
    body: 'Cut and ready, nobody assigned yet. Assign a roster and each volunteer gets their own personal link.',
  },
  {
    label: 'Links sent',
    body: 'The links went out by email and text to the contacts already on each volunteer’s record. Nothing knocked yet.',
  },
  {
    label: 'Knocking now',
    body: 'A knock landed in the last six hours. The map and the report are moving while you watch.',
  },
  {
    label: 'Every door knocked',
    body: 'Exactly what it says — counted from the knock records, not from anyone remembering to close the turf.',
  },
];

/** One door dot on the turf-map mock, in the mock's 320×220 viewBox. */
export interface TurfDoor {
  readonly x: number;
  readonly y: number;
  /** Knocked doors render filled; remaining doors render hollow. */
  readonly knocked?: true;
}

/**
 * The turf-map mock: two turfs cut on either side of one boundary line. The line is the
 * argument — the cutter treats it as a wall, so no volunteer is sent across the river or
 * the arterial road the line follows in real life.
 */
export interface TurfShape {
  readonly name: string;
  readonly meta: string;
  readonly hull: string;
  readonly doors: readonly TurfDoor[];
}

/** The boundary the two turfs respect, drawn as one polyline through the viewBox. */
export const BOUNDARY_LINE = '158,0 152,58 162,118 154,168 160,220';

export const TURF_A: TurfShape = {
  name: 'Turf 3',
  meta: '42 doors · PD 412',
  hull: '20,30 132,22 138,102 124,152 18,144',
  doors: [
    { x: 38, y: 48, knocked: true },
    { x: 64, y: 42, knocked: true },
    { x: 92, y: 46, knocked: true },
    { x: 116, y: 52, knocked: true },
    { x: 40, y: 76, knocked: true },
    { x: 70, y: 80, knocked: true },
    { x: 100, y: 78 },
    { x: 122, y: 88 },
    { x: 44, y: 108 },
    { x: 74, y: 112 },
    { x: 102, y: 116 },
    { x: 52, y: 134 },
    { x: 86, y: 136 },
  ],
};

export const TURF_B: TurfShape = {
  name: 'Turf 4',
  meta: '38 doors · PD 415',
  hull: '176,38 300,30 296,148 180,156',
  doors: [
    { x: 196, y: 56, knocked: true },
    { x: 224, y: 52 },
    { x: 252, y: 56 },
    { x: 280, y: 52 },
    { x: 198, y: 86 },
    { x: 228, y: 90 },
    { x: 258, y: 86 },
    { x: 284, y: 92 },
    { x: 204, y: 120 },
    { x: 236, y: 124 },
    { x: 266, y: 122 },
  ],
};

/** One row of the walk-sheet print mock. Uses the site's shared five-household cast. */
export interface WalkSheetRow {
  readonly n: number;
  readonly addr: string;
  readonly who: string;
  /** Doors already knocked print with their result, so a paper round never retreads them. */
  readonly done?: string;
}

export const WALK_SHEET_ROWS: readonly WalkSheetRow[] = [
  { n: 1, addr: ADDRESSES[0], who: RESIDENTS[0], done: 'Supporter' },
  { n: 2, addr: ADDRESSES[1], who: RESIDENTS[1], done: 'Not home' },
  { n: 3, addr: ADDRESSES[2], who: RESIDENTS[2] },
  { n: 4, addr: ADDRESSES[3], who: RESIDENTS[3] },
  { n: 5, addr: ADDRESSES[4], who: RESIDENTS[4] },
];

/** What the cutting engine promises, stated as three cards under the turf-map mock. */
export const CUTTING_CARDS: readonly Feature[] = [
  {
    icon: 'map',
    title: 'It never crosses the line',
    body: 'Turfs are cut inside the finest voting-subdivision map your workspace holds for the race — the polling division or precinct — or the riding, ward or district map if that is what you have. A boundary line in real life follows a river, a rail line or an arterial road, so no volunteer is ever sent across one.',
  },
  {
    icon: 'route',
    title: 'A walk order that walks',
    body: 'Doors are ordered street by street: up one side in ascending house numbers, back down the other. The phone app, the turf page and the printed sheet all use the same order, so pin 7 on the map is row 7 on the paper.',
  },
  {
    icon: 'funnel',
    title: 'Nothing is silently dropped',
    body: 'A household without coordinates is reported as unplaced, never quietly left out. And if you have no boundary map at all, turfs are cut by proximity alone and labelled unbounded — not dressed up in a fake area name.',
  },
];

/** The companion-band bullet list. Every behavior is shipped, in apps/companion. */
export const COMPANION_POINTS: readonly Feature[] = [
  {
    icon: 'phone',
    title: 'No install, no account',
    body: 'A volunteer opens their personal link in the phone’s browser. Nothing to download, no password to invent — a one-time code to the email or mobile already on their record proves who they are.',
  },
  {
    icon: 'queue-list',
    title: 'One street at a time',
    body: 'A turf is a neighbourhood; a shift is a street. The app opens narrowed to one street — nearest first once the phone shares its location — and apartment buildings fold into one row that opens into a unit list.',
  },
  {
    icon: 'hand-thumb-up',
    title: 'Prior support travels to the door',
    body: 'Support recorded anywhere in the CRM shows at the door, so a turf is useful on its first morning. And if somebody already knocked this door in the last 30 days — on any turf in the campaign — the app says so before you ring.',
  },
  {
    icon: 'cloud-arrow-up',
    title: 'Offline without losing work',
    body: 'Knocks queue on the phone and send when the signal returns. Anything the server refuses lands in a visible blocked list with a reason and a Try again button — a recorded conversation is never silently discarded.',
  },
  {
    icon: 'clipboard-document-list',
    title: 'Answers become records, immediately',
    body: '“Wants a yard sign” creates a delivery request. “Wants to volunteer” marks them a prospective volunteer. “Do not contact” suppresses them on the spot. The clipboard-to-database evening shift stops existing.',
  },
];

/** The volunteer trust model, from modules/companion-access. */
export const TRUST_CARDS: readonly Feature[] = [
  {
    icon: 'identification',
    title: 'The link says what. The code says who.',
    body: 'Every canvasser gets their own personal link to their turf — and the first open asks for a one-time code sent to the contact details already on their record. A forwarded link on its own gets nobody in.',
  },
  {
    icon: 'check-circle',
    title: 'One approval per volunteer',
    body: 'A first-time volunteer waits for an admin’s approval — once per person, not per link. Approve from the app, or straight from the text message it sends you.',
  },
  {
    icon: 'user-plus',
    title: 'QR codes for walk-in volunteers',
    body: 'Print a QR code for the launch event. A walk-in who is not in your CRM scans it, signs up on the spot, and lands on the exact turf the code was scoped to — pending your approval.',
  },
  {
    icon: 'lock-closed',
    title: 'Revoke reaches every phone',
    body: 'Removing one canvasser kills only their link. Revoking a volunteer signs them out of every device they ever verified. Either way, a volunteer only ever sees their own turf — never your list.',
  },
];

/** A limit we state before anyone has to ask. Same shape and register as /districts. */
export const LIMITS: readonly Limit[] = [
  {
    icon: 'map-pin',
    title: 'Turf cutting needs located doors',
    body: 'A turf is cut from doors placed on the map, and placing them is the metered part: address lookups run on the Movement plan, spread over a daily budget. District columns imported from your voter file filter, count and export immediately — but a district name does not place a door.',
  },
  {
    icon: 'banknotes',
    title: 'Canvassing is a Movement feature',
    body: 'Turf cutting, walk sheets, field reports and the companion app are on the Movement plan. Every new workspace’s demo data unlocks all of it, so you can cut turfs and knock demo doors before paying anything.',
  },
  {
    icon: 'shield-exclamation',
    title: 'We do not sell voter data',
    body: 'pplCRM ships official boundary maps, not people. The list is yours: your voter file, your sign-up forms, your years of door notes. We would rather say that plainly than let you assume otherwise.',
  },
];

/** The companion phone mock, wearing the shared five-door cast. */
export const CANVASS_FIELD: FieldPreview = {
  context: 'Demo campaign · Turf 3',
  place: 'Alder Street',
  meta: '14 doors · 21 voters',
  progressClass: 'w-[43%]',
  progressNote: '6 of 14 doors attempted',
  conversations: '5 conversations',
  doors: doorsWith('Supporter', 'Mixed'),
};
