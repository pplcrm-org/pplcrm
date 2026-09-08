import { ADDRESSES, type Feature } from '../home/audience-content';
import type { Limit } from '../districts/districts-content';

/**
 * Copy and mock data for the /deliveries page — yard-sign and flyer requests, and the
 * delivery outings that carry them (the driving-route system retired in the 2026-09
 * turfs-absorb-deliveries consolidation; delivery work goes out as delivery-mode turfs).
 *
 * Everything here is a factual claim about what the product does, so it is governed by the
 * `pplcrm-website-claims` registry. The sources of truth:
 *
 *  - requests live on the Requests tab of the Canvassing page; one open request per
 *    household per kind (yard sign / flyer), enforced by a partial unique index →
 *    `apps/backend/src/app/modules/deliveries` (repo + controller)
 *  - cutting an outing CLAIMS its requests (the stored `delivery_requests.turf_id`
 *    pointer, taken with a race-safe `WHERE turf_id IS NULL` update), so two outings can
 *    never be sent to the same lawn; retiring an outing returns undelivered requests to
 *    the pool → same module + `modules/canvassing/controller.ts`
 *  - the driving order is computed deterministically on our servers from distances
 *    between houses (nearest-neighbour + 2-opt in `lib/routing/plan-routes.ts`); no
 *    third-party routing service ever sees addresses — Navigate/Google-Maps links are
 *    built on the volunteer's own phone
 *  - the volunteer app is the same offline canvassing companion (`apps/companion`):
 *    Delivered / Couldn't deliver (reason) / Undo per door, per-stop Navigate, a
 *    next-stops Google Maps chain, the queue synced when signal returns
 *  - what a volunteer sees: residents' names, the address, and door history — never
 *    emails, phone numbers or donation history (`CompanionTurfPayload`)
 *  - assignment sending the personal link by email and text; re-assigning rotating it →
 *    `modules/canvassing/controller.ts` (assignTurf) + `lib/mail/volunteer-link-notify.ts`
 *  - "Add from list" bulk intake (approved request per eligible household; DNC skipped) →
 *    `addRequestsFromList` in the deliveries controller
 *  - the yard-sign standing card on household and person pages → experiences/households +
 *    experiences/persons
 *  - plan gating (deliveries and companions are Movement; a demo workspace gates as
 *    Movement) → `libs/common/src/lib/billing/plans.ts`
 *
 * If any of those change, this file changes in the same commit. Do not add a number here
 * that is not read off the code.
 */

/** The life of a request, told in the pipeline strip. "Out for delivery" is a claim, not a checkbox. */
export interface RequestStage {
  readonly n: string;
  readonly title: string;
  readonly body: string;
}

export const REQUEST_STAGES: readonly RequestStage[] = [
  {
    n: '1',
    title: 'Asked at the door',
    body: 'A canvasser taps “wants a yard sign” in the companion, a supporter checks the box on your web form, or a teammate records it in the CRM. Either way it lands in one queue — nothing lives in a text thread.',
  },
  {
    n: '2',
    title: 'Approved and located',
    body: 'You approve each request, and a readiness chip shows whether the address is placed on the map yet. A request with an address problem links straight to the household to fix it.',
  },
  {
    n: '3',
    title: 'Out with an outing',
    body: 'Cutting a delivery outing claims its requests, so two outings can never be sent to the same lawn. Each request’s row names the outing carrying it; retire the outing and its undelivered requests return to the pool.',
  },
  {
    n: '4',
    title: 'Delivered',
    body: 'Marked by the volunteer at the door, by a canvasser planting the sign mid-walk, or by a teammate in the CRM. All three flip the same request.',
  },
];

/** One door pin on the outing-map mock, in the mock's 320×220 viewBox. */
export interface RouteStop {
  readonly n: number;
  readonly x: number;
  readonly y: number;
  readonly delivered?: true;
}

export const ROUTE_STOPS: readonly RouteStop[] = [
  { n: 1, x: 84, y: 64, delivered: true },
  { n: 2, x: 148, y: 52, delivered: true },
  { n: 3, x: 214, y: 70 },
  { n: 4, x: 268, y: 58 },
  { n: 5, x: 288, y: 118 },
  { n: 6, x: 232, y: 158 },
];

/** The cut panel beside the map mock: proposed outings plus the leftovers, named. */
export interface PanelRoute {
  readonly name: string;
  readonly detail: string;
  readonly muted?: true;
}

export const PANEL_ROUTES: readonly PanelRoute[] = [
  { name: 'Outing 1 · signs & flyers', detail: '12 doors · by car' },
  { name: 'Outing 2 · signs & flyers', detail: '9 doors · by car' },
  { name: 'Not placed yet', detail: '2 addresses still locating', muted: true },
];

/** What cutting promises, stated as three cards under the outing-map mock. */
export const PLANNING_CARDS: readonly Feature[] = [
  {
    icon: 'map',
    title: 'One button from pile to outings',
    body: 'Press “Cut into outings” on the Requests tab and the wizard opens with delivery already chosen: pick signs, flyers or both, pick how many doors per outing, and the approved pile becomes batches a volunteer can say yes to. Anything without a map position is named, not hidden.',
  },
  {
    icon: 'clock',
    title: 'Doors come in driving order',
    body: 'A delivery outing’s doors are ordered for a car, not a walker’s street sweep. The math is deterministic and runs on our servers — no third-party routing service ever sees your addresses.',
  },
  {
    icon: 'arrow-top-right-on-square',
    title: 'Turn-by-turn when you want it',
    body: 'On the volunteer’s phone, every stop has a Navigate button, and one tap opens the next stretch of stops in Google Maps as a waypoint chain, for the driver who wants voice directions.',
  },
];

/** The volunteer's delivery outing, from apps/companion (the same app canvassers use). */
export const VOLUNTEER_POINTS: readonly Feature[] = [
  {
    icon: 'phone',
    title: 'A link is the whole app',
    body: 'Assigning a volunteer sends their personal link by email and text in the same moment. No install, no account — re-assigning rotates the link, and every volunteer verifies a one-time code and is approved once by an admin.',
  },
  {
    icon: 'queue-list',
    title: 'The next stop, ringed',
    body: 'The outing is a numbered stop list with the next undone door ringed, and two honest buttons on every row: Delivered, and Couldn’t deliver — which asks for a reason your office sees on the request.',
  },
  {
    icon: 'cloud-arrow-up',
    title: 'Works in a dead zone',
    body: 'It is the same offline-first companion canvassers use: taps queue on the phone and sync back when signal returns, and Undo is right there for the fat-fingered “Delivered” at a red light.',
  },
  {
    icon: 'lock-closed',
    title: 'No emails, no phones, no donations',
    body: 'The volunteer sees what the doorstep needs — who lives there, the address, and what happened at the door before. Never an email, a phone number or a donation history. A lost phone leaks a door list, not your voter file.',
  },
  {
    icon: 'arrow-path',
    title: 'A failed stop stays owed',
    body: 'Mark a door “couldn’t deliver” and the request stays with the outing for a retry, reason attached. Retire the outing and every undelivered request returns to the pool on its own. Nobody keeps a list of leftovers in their head.',
  },
];

/** Standing that shows up outside the Requests tab. */
export const STANDING_CARDS: readonly Feature[] = [
  {
    icon: 'yard-sign',
    title: 'Standing follows the household',
    body: 'Every household page — and the campaign card on every person — shows where the sign request stands: none, requested, approved, declined or delivered, with who asked and a link to the outing carrying it.',
  },
  {
    icon: 'hand-thumb-up',
    title: 'The canvasser closes the loop',
    body: 'A canvasser carrying signs can mark one delivered right at the door. The request flips everywhere at once — including on a delivery outing that was carrying it, where the door shows as already served.',
  },
];

/**
 * The volunteer's phone mock. It must obey the same payload rule the real app does:
 * residents' names and addresses, nothing else.
 */
export interface DriverStop {
  readonly addr: string;
  readonly who: string;
}

export const DRIVER_MOCK = {
  context: 'Maple outing · Signs & flyers',
  progress: 'Stop 3 of 6',
  delivered: '2 delivered',
  current: { addr: ADDRESSES[2], who: 'Denise Tran' } satisfies DriverStop,
  next: [
    { addr: ADDRESSES[3], who: 'Priya Patel' },
    { addr: ADDRESSES[4], who: 'Marcus Webb' },
  ] satisfies readonly DriverStop[],
} as const;

/** A limit we state before anyone has to ask. Same shape and register as /districts. */
export const LIMITS: readonly Limit[] = [
  {
    icon: 'map-pin',
    title: 'Outings need located addresses',
    body: 'A request joins an outing once its address is placed on the map. Address lookups run on the Movement plan, spread over a daily budget, and a request that cannot be placed says so on its row — with a link to fix the address — rather than being silently skipped.',
  },
  {
    icon: 'paper-airplane',
    title: 'The order is distance math, not roads',
    body: 'The driving order is computed from distances between houses on our servers — it does not know about one-way streets or bridges. That is why every stop hands you to Google Maps for the actual roads, and why we don’t promise per-stop minutes.',
  },
  {
    icon: 'banknotes',
    title: 'Deliveries is a Movement feature',
    body: 'Requests, delivery outings and the volunteer app are on the Movement plan. Every new workspace’s demo data unlocks all of it, so you can send out demo outings before paying anything.',
  },
];
