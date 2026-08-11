import { ADDRESSES, type Feature } from '../home/audience-content';
import type { Limit } from '../districts/districts-content';

/**
 * Copy and mock data for the /deliveries page — yard-sign requests, route planning and the
 * volunteer delivery page.
 *
 * Everything here is a factual claim about what the product does, so it is governed by the
 * `pplcrm-website-claims` registry. The sources of truth:
 *
 *  - routes sized to about an hour, deterministic, no external routing API, named leftover
 *    buckets → `apps/backend/src/app/lib/routing/` (`route-constants.ts`: TARGET_ROUTE_MINUTES
 *    60, SHARE_TOKEN_TTL_DAYS 30; `plan-routes.ts`)
 *  - preview-then-commit (preview is a pure calculation that writes nothing) and "routed is
 *    derived, never stored" (a request is on a route only while it has a live pending stop,
 *    enforced by a partial unique index) → `apps/backend/src/app/modules/deliveries`
 *  - the volunteer page carrying first name and address ONLY, undo on terminal stops, skip
 *    moving a stop to the end, an undeliverable stop returning the request to the planning
 *    pool → `apps/companion/src/app/deliveries/route-page.ts` (route `/r/:token`)
 *  - assignment minting a fresh link and sending it by email and text in the same
 *    transaction; re-assigning invalidating the old link → the deliveries controller +
 *    `lib/mail/volunteer-link-notify.ts`
 *  - link expiry as a live workspace policy (30 days by default, switchable off) → the
 *    workspace App settings + deliveries token checks
 *  - a canvasser marking a sign delivered at the door closing that house's stop on whatever
 *    route it was on → the companion canvass survey side-effects
 *  - the yard-sign standing card on household and person pages → experiences/households +
 *    experiences/persons
 *  - plan gating (deliveries and companions are Movement; a demo workspace gates as
 *    Movement) → `libs/common/src/lib/billing/plans.ts`
 *
 * If any of those change, this file changes in the same commit. Do not add a number here
 * that is not read off the code.
 */

/** The life of a request, told in the pipeline strip. "On a route" is computed, never stored. */
export interface RequestStage {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

export const REQUEST_STAGES: readonly RequestStage[] = [
  {
    n: '1',
    title: 'Asked at the door',
    body: 'A canvasser taps “wants a yard sign” in the companion, or a teammate records the request in the CRM. Either way it lands in one queue — nothing lives in a text thread.',
  },
  {
    n: '2',
    title: 'Approved and located',
    body: 'You approve each request, and a readiness chip shows whether the address is placed on the map yet. A request with an address problem links straight to the household to fix it.',
  },
  {
    n: '3',
    title: 'On a route',
    body: 'Not a checkbox — a fact. A request counts as routed only while it actually has a live stop on a route. Remove or skip the stop and the request is instantly back in the pool.',
  },
  {
    n: '4',
    title: 'Delivered',
    body: 'Marked by the driver on the route page, by a canvasser planting the sign at the door, or by a teammate in the CRM. All three close the same stop.',
  },
];

/** One stop pin on the route-map mock, in the mock's 320×220 viewBox. */
export interface RouteStop {
  readonly n: number;
  readonly x: number;
  readonly y: number;
  readonly delivered?: true;
}

/** The dotted visit-order line. Dotted on purpose: it is the order, not a road path. */
export const ROUTE_LINE = '44,112 84,64 148,52 214,70 268,58 288,118 232,158';

export const ROUTE_START = { x: 44, y: 112 } as const;

export const ROUTE_STOPS: readonly RouteStop[] = [
  { n: 1, x: 84, y: 64, delivered: true },
  { n: 2, x: 148, y: 52, delivered: true },
  { n: 3, x: 214, y: 70 },
  { n: 4, x: 268, y: 58 },
  { n: 5, x: 288, y: 118 },
  { n: 6, x: 232, y: 158 },
];

/** The planner's side panel: proposed routes plus the leftovers, named. */
export interface PanelRoute {
  readonly name: string;
  readonly detail: string;
  readonly muted?: true;
}

export const PANEL_ROUTES: readonly PanelRoute[] = [
  { name: 'Route 1 · Dana', detail: '6 stops · about 55 min' },
  { name: 'Route 2 · unassigned', detail: '8 stops · about 50 min' },
  { name: 'Didn’t fit', detail: '2 too far from start · 1 isolated', muted: true },
];

/** What the planner promises, stated as three cards under the route-map mock. */
export const PLANNING_CARDS: readonly Feature[] = [
  {
    icon: 'map',
    title: 'Preview writes nothing',
    body: 'Type a start address and the planner proposes routes with per-stop travel times — as a pure calculation. Anything that could not fit is named, not hidden: too far from the start, or isolated. Only “Create routes” saves.',
  },
  {
    icon: 'clock',
    title: 'Routes sized to about an hour',
    body: 'A route targets roughly 60 minutes of driving and planting, because “can you take one route tonight?” is an ask a volunteer says yes to. The math is deterministic and runs on our servers — no third-party routing service ever sees your addresses.',
  },
  {
    icon: 'arrow-top-right-on-square',
    title: 'Turn-by-turn when you want it',
    body: 'The visit order draws as a dotted line — it is an order, not a road path. One tap builds the whole route as a Google Maps link with every stop as a waypoint, for the driver who wants voice directions.',
  },
];

/** The volunteer route page, from apps/companion (/r/:token). */
export const VOLUNTEER_POINTS: readonly Feature[] = [
  {
    icon: 'phone',
    title: 'A link is the whole app',
    body: 'Assigning a driver mints their personal link and sends it by email and text in the same moment. No install, no account — and re-assigning the route invalidates the old link automatically.',
  },
  {
    icon: 'queue-list',
    title: 'One stop at a time',
    body: 'The page shows the current stop and three honest buttons: Delivered, Couldn’t deliver (with a reason), and Skip for now, which moves the house to the end instead of pretending it is done.',
  },
  {
    icon: 'arrow-uturn-left',
    title: 'Undo survives a reload',
    body: 'Fat-fingered “Delivered” at a red light? Any finished stop can be undone — even after the page reloads. The last handled stop completes the route.',
  },
  {
    icon: 'lock-closed',
    title: 'First name and address. Nothing else.',
    body: 'The driver’s page carries exactly what planting a sign needs: a first name and an address. No phone numbers, no emails, no donation history — a lost phone leaks a delivery list, not your voter file.',
  },
  {
    icon: 'arrow-path',
    title: 'A failed stop routes itself back',
    body: 'Mark a house undeliverable and its request returns to the planning pool on its own, ready for the next route. Nobody keeps a list of leftovers in their head.',
  },
];

/** Standing that shows up outside the Deliveries pages. */
export const STANDING_CARDS: readonly Feature[] = [
  {
    icon: 'yard-sign',
    title: 'Standing follows the household',
    body: 'Every household page — and the campaign card on every person — shows where the sign request stands: none, requested, approved, declined or delivered, with who asked and a link to the route it rides on.',
  },
  {
    icon: 'hand-thumb-up',
    title: 'The canvasser closes the loop',
    body: 'A canvasser carrying signs can mark one delivered right at the door. That closes the house’s stop on whatever route it was on — and if it was the last stop, the route completes itself.',
  },
];

/**
 * The driver's phone mock. First names only — the mock must obey the same payload rule the
 * real page does, so it shows exactly a first name and an address per stop.
 */
export interface DriverStop {
  readonly addr: string;
  readonly who: string;
}

export const DRIVER_MOCK = {
  context: 'Route 1 · Yard signs',
  progress: 'Stop 3 of 6',
  delivered: '2 delivered',
  current: { addr: ADDRESSES[2], who: 'Denise' } satisfies DriverStop,
  next: [
    { addr: ADDRESSES[3], who: 'Priya' },
    { addr: ADDRESSES[4], who: 'Marcus' },
  ] satisfies readonly DriverStop[],
} as const;

/** A limit we state before anyone has to ask. Same shape and register as /districts. */
export const LIMITS: readonly Limit[] = [
  {
    icon: 'map-pin',
    title: 'Routing needs located addresses',
    body: 'A request joins a route once its address is placed on the map. Address lookups run on the Movement plan, spread over a daily budget, and a request that cannot be placed says so on its row — with a link to fix the address — rather than being silently skipped.',
  },
  {
    icon: 'paper-airplane',
    title: 'The driver’s page needs a signal',
    body: 'Unlike the canvass companion, the delivery page talks to the server as you go, so it needs a connection. Drivers are in a car in town, not a dead zone on foot — but we would rather say it than have you find out.',
  },
  {
    icon: 'banknotes',
    title: 'Deliveries is a Movement feature',
    body: 'Requests, route planning and the driver’s page are on the Movement plan. Every new workspace’s demo data unlocks all of it, so you can plan routes over demo households before paying anything.',
  },
];
