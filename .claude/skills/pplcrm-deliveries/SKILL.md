---
name: pplcrm-deliveries
description: Deliveries (§14) — yard-sign requests → pure-preview route planning → volunteer-driven routes, the three delivery_* tables and their "routed is derived" invariant, the pure routing engine, and the tokenized public volunteer page. USE WHEN touching modules/deliveries, experiences/deliveries, the routing engine (lib/routing), the delivery_* tables, the public /r/:token page, or the deliveries sidebar badge. EXAMPLES: 'why is a request still showing as routed', 'change how routes are estimated', 'the volunteer link 404s'.
---

# Deliveries (§14)

Yard-sign requests → about-an-hour driving routes → a volunteer drives them via a public tokenized
link (no account). Binding spec: `docs/spec/Deliveries Spec.dc.html`. Prior plan (partly stale):
repo-root `YARD-SIGN-ROUTES-PLAN.md` — the spec's strings win where they disagree.

## The data model (3 tables, all tenant-scoped + RLS)

The three tables live in the squashed baseline (`_migrations/schema.sql`); the original dated
migration no longer exists post-squash (see `pplcrm-migrations`). A **new** delivery migration must
still sort alphabetically after every applied file — Kysely aborts with "corrupted migrations"
otherwise. Kysely models (`DeliveryRequests`, `DeliveryRoutes`, `DeliveryRouteStops`)
in `libs/common/src/lib/kysely.models.ts`.

- **`delivery_requests`** — one per household sign request. `status: new | approved | declined | delivered`
  (spec spelling; **no `cancelled`**). Tied to a `household_id` (coords + geocoding_status live on the
  household; never a parallel geocoder). `web_form_id` is `uuid` (web_forms has a uuid id).
- **`delivery_routes`** — `status: draft | assigned | in_progress | completed | canceled` (American
  one-L "canceled", per spec). Carries `start_lat/lng`, `est_minutes/est_km`, a `params` jsonb
  snapshot, and the share link as **`share_token_hash` (sha256 hex) only** — the raw token is returned
  to staff once and never stored. **Link expiry is a live workspace policy, not row state**: the
  30-day `share_token_expires_at` is always _stored_ at mint time but only _enforced_ while the
  Workspace → App toggle (`settings` key `app.volunteer_links_expire`, default ON) says so — see
  `lib/volunteer-link-policy.ts` (`volunteerLinksExpire()`), read live at every enforcement point
  (`mintShareLink` active-check, `isTokenUsable`, `sanitizeRoute`, and the companion gate's
  `resolveLink` route branch). Flipping the toggle instantly revives/re-expires existing links; when
  expiry is off the API reports no date (`link_expires_at` / mint `expires_at` come back null) so
  the UI never shows a date that isn't enforced.
- **`delivery_route_stops`** — `status: pending | delivered | skipped`, `seq` (1-based),
  `leg_minutes`, `reason`, `acted_via: volunteer_link | staff`.

### A canvasser can deliver a sign too (2026-08-08)

Two public methods exist for the Canvass Companion to call **inside its own op transaction**
(`pplcrm-canvassing` → "Delivering a yard sign at the door" has the client half):

- `deliverHouseholdSign(trx, auth, {household_id, campaign_id, person_id, via})` — resolves
  or creates the household's request in that campaign, then flips it delivered **through
  `applyStopTransition` when a pending stop exists**. That is the whole point: a house a
  canvasser already served must stop being a stop a driver is sent to, and going through the
  stop is what advances and auto-completes the route. Already-delivered returns false, so a
  retried offline op writes nothing.
- `undoHouseholdSignDelivery(trx, auth, {household_id, campaign_id, via})` — reuses
  `undoStop`, so an undo restores the stop to pending and reopens a route the delivery had
  completed.

`logRequestStanding` takes a `via` argument (default `'staff'`) so a doorstep delivery reads
as "via Canvass Companion (name)" in the activity log rather than claiming staff did it, and
knows the `'undelivered'` label — the request lands back on `approved`, but calling that
"approved" would describe an office decision instead of what happened.

**No new request status was added.** "Delivered" already means the sign reached the house;
an `installed` status was considered and deliberately rejected as unnecessary complexity.

### The one invariant: "routed" is derived, never stored (acceptance §22.6)

A request is "on a route" **iff it has an active (`pending`) stop**. There is no `routed` status.
Enforced by a partial unique index `uq_delivery_route_stops_active_request (request_id) WHERE
status = 'pending'` — a request can be on at most one active stop. Skipping/removing a stop flips it
out of `pending` and the request is instantly back in the pool (set its request `status='approved'`).
The requests grid derives the Route column via a LEFT JOIN on the active stop, not a column.

## The routing engine (pure, the most-tested code)

`apps/backend/src/app/lib/routing/` — `geo.ts` (haversine/road-km/leg-minutes), `route-constants.ts`
(all the named numbers), `plan-routes.ts` (`planRoutes(start, stops, params)`), `plan-routes.spec.ts`.
No DB, no I/O, deterministic (requestId breaks every tie). Greedy nearest-neighbour fill under a
~52-min budget + bounded 2-opt. Unroutable buckets: `too_far_from_start`, `isolated`. Straight-line
distance × 1.3 winding factor; 1-hour neighbourhoods forgive the error — **do not add a routing API
or dependency**. Start-address geocoding reuses the shared `geocodeAddress()` in
`lib/gis/geocode-address.ts` (extracted from the household job; same mock/test degrade path).

## Backend module — `apps/backend/src/app/modules/deliveries/`

Router `deliveries` (registered in `modules/trpc.ts`). `controller.ts` holds all logic; three repos.
Every internal query is tenant-scoped. Key behaviours:

- **Yard-sign standing (first-level concept, derived — never a stored flag).**
  `getSignStatus({household_id, campaign_id})` returns the household's most recently touched request
  for one campaign (+ requester name, derived active-route link) — the truth stays in
  `delivery_requests`; nothing is stored on persons/households. `setRequestStatus` accepts all four
  statuses: `delivered` flips any active (pending) stop via `applyStopTransition` (staff-attributed,
  advances/auto-completes the route); `declined`/`new` are blocked while a pending stop exists.
  Standing flips and `addRequest` log activity to the `households` entity and, when a requester is
  set, `persons` too (`logRequestStanding`).
- **One open request per household is TENANT-wide, not per-campaign** (the
  `uq_delivery_requests_open_per_household` partial index has no `campaign_id` — deliberate: one
  house, one open logistics task). Two seams are handled explicitly: (1) conflict messages name
  the campaign holding the open request (`getOpenForHousehold` + `openHouseholdConflictError` in
  `addRequest`/`setRequestStatus`), and `getSignStatus` returns `open_in_other_campaign` so the
  yard-sign control can disable + explain instead of 409ing; (2) archiving a campaign calls
  `DeliveriesController.closeCampaignDeliveries` (inside the archive transaction) — cancels the
  campaign's live routes (`cancelRouteInTrx`), skips stray pending stops, declines its open
  requests — otherwise an archived (read-only) campaign would hold the household's slot forever.
- **Plan is preview-then-commit.** `previewPlan` is pure — geocodes the start, runs the engine, returns
  routes + `unroutable` + ineligible buckets, **writes nothing**. `commitPlan` re-verifies eligibility
  in-transaction (concurrent-planner guard → `skipped` list), recomputes legs server-side, inserts
  routes+stops atomically, and saves the start address to `settings` key `deliveries.route_defaults`.
- **Stop transitions** (`applyStopTransition`, shared by staff + public): deliver → request delivered;
  skip(reason) → request back to `approved` + skip_reason; first action flips `assigned→in_progress`;
  last terminal stop **auto-completes** the route. `defer` (public "Skip for now") moves the stop to
  the end and renumbers (stays pending). `undo` restores `pending` and reopens a completed route.
  Reorder/defer/remove renumber seq via a temp offset to dodge the `(route_id, seq)` unique index.
- **Activity is mandatory and honestly attributed** (§22.7). Public actions log with
  `metadata.via = 'volunteer_link'` and a "via volunteer link" message; the `user_id` is the route's
  `createdby_id` (same convention as web-forms public writes) — never a fabricated user.

## The public volunteer page — token + verified session (see `pplcrm-companion-access`)

Backend REST route `modules/deliveries/routes/deliveries-public.route.ts` at prefix `/api/deliveries`
(registered in `app/routes.ts`): `GET /r/:token`, `POST /r/:token/stops/:stopId`. Resolution differs
from `/f/:slug`: **there is no subdomain/tenant param** — `findByTokenHash(sha256(token))` resolves the
route AND its tenant (the one intentional `// eslint-disable-next-line local/no-unscoped-db-query`,
cross-tenant by design; every follow-up query is scoped by the resolved `tenant_id`).

The token alone is no longer enough (COMPANION-APPS-PLAN.md): both endpoints then call
`CompanionAccessController.requireSession(X-Companion-Session header, { tenant_id,
volunteer_person_id })` — the volunteer must have verified a code and been admin-approved.
401/403 from the guard pass through (the gate renders verify/pending from them); everything
else stays a uniform 404 (never distinguish invalid/expired/revoked/canceled). Because the
link is personal, **`mintShareLink` refuses when the route has no `volunteer_person_id`** —
assign the volunteer first. Per-IP rate limit. Payload is **first name + address only**
(field `organization_name` carries the org display name — it was renamed from the lying
`campaign_name`) — verify the payload, not just the UI.

`POST .../stops/:stopId` accepts an optional `op_id` (client uuid): it is claimed in the
`companion_ops` ledger inside the same transaction as the action, so a retried
deliver/skip/defer/undo applies exactly once and just returns the authoritative payload.

Frontend page: **`apps/companion/src/app/deliveries/route-page.ts`** at `/r/:token` of the
separate companion app (NOT apps/frontend — the old `experiences/deliveries/ui/public-route`
page was deleted), wrapped in `<pc-companion-gate kind="route">`; relative `/api` fetches with
`CompanionSessionService.headers()`, a fresh `op_id` per action, Undo on every terminal stop
(including after reload / from the completed state), List/Map via `<pc-map>`. It carries the
**same fixed bottom nav as the Canvass Companion** — List / Map / **Me** (client-side `view`
signal, nothing routable beyond the token). The **Me** tab shows org + route name, a
provenance/end-shift card, and derived shift counts (delivered / remaining / couldn't-deliver /
total). "End shift on this device" confirms, then `session.clearSession()` and drops to a new
`'ended'` page state (deliveries has no local queue — every action posts immediately, so there's
nothing to wipe but the device session). Both companion footers read **"Powered by pplCRM"**,
pinned above the nav. The staff
share-URL builder (`deliveries-route-detail.ts`) still emits `${origin}/r/${token}` — the
companion app is path-routed on the same domain.

## Frontend — `apps/frontend/src/app/experiences/deliveries/`

Two services (`deliveries-requests-service`, `deliveries-routes-service`) both point at the
`deliveries` tRPC router. **These grids are bespoke signal components, not `pc-datagrid`** — the
requests grid needs status tabs + counts, geocode readiness chips (`<pc-geocode-chip>`), bulk
approve/decline, and the always-enabled "Plan routes · N ready" primary, which the generic grid
doesn't provide. Pages: `deliveries-requests` (`/deliveries`), `deliveries-plan` (`/deliveries/plan`),
`deliveries-routes` (`/deliveries/routes`), `deliveries-route-detail` (`/deliveries/routes/:id`).
The sidebar has a single **Deliveries** entry (→ `/deliveries`), so the two list pages carry a
shared **`deliveries-nav.ts`** (`pc-deliveries-nav`) surface switcher in their header — the house
`pc-tab-bar` in its `underline` variant, whose active tab is driven by `routerLinkActive` (no JS
state) — because otherwise the routes list is only reachable by opening a single route from the
requests grid's Route column. The **Routes** tab carries a count of the routes a volunteer is
currently out delivering (`deliveries.getRouteCounts` → `DeliveryRoutesRepo.getStatusCounts`,
read with `skipErrorHandler` so a failed count drops the badge instead of toasting). It counts
`in_progress` only and is hidden at zero, so the option also sets `tooltip` ("N routes in
progress") — a bare number beside "Routes" would otherwise read as the route total. The nav
fetches on init and exposes `refresh()`; `deliveries-routes.ts` calls it after canceling a route,
the one in-page action that can retire an in-progress route. The **routes list rows** carry the same inline affordances as the route detail:
an inline dashed **Assign** button in the Volunteer cell when unassigned, and a trailing `⋯`
overflow (assign/change volunteer via the shared `assign-volunteer-dialog.ts`, copy volunteer link,
resend link to volunteer, cancel route, delete route) — mirrors the canvassing turf table. The route
detail carries a **Route map card** between the header and the stops: `<pc-map>` with a start pin
(`info`) plus one **numbered** pin per located stop tinted by stop status, and the visit order as a
single **dotted** `polylines` path (dotted because the engine measures straight-line distance, not
roads — do not make it solid). Ungeocoded stops can't be drawn, so `unlocatedNote()` says how many
are missing and a route with none located shows a `pc-empty-state` instead of an empty map. **"Open
in Google Maps"** is the map card's action (it used to sit in the header actions row) and builds a
`maps/dir/?api=1&origin=…&waypoints=…&destination=…` URL from stop coords (route detail only — the
list row has no stop coords). Sidebar: **Deliveries** in FIELD (`sidebar-items.ts`, icon `map-pin`) with a live
ready-count badge wired in `sidebar.ts` (`deliveries.getReadyCount`, mirrors the Tasks/Duplicates
badge pattern). Help article: `libs/common/src/lib/help/articles/engagement.ts` (id `deliveries`); the
known-route allowlist in `help-content.spec.ts` includes `/deliveries*`.

**Standing surfaces outside Deliveries:** `experiences/deliveries/ui/yard-sign-standing.ts`
(`<pc-yard-sign-standing>`) is the one control that reads/flips a household's sign status in the
active campaign context (None requested / Requested / Approved / Declined / Delivered, labels from
`DELIVERY_REQUEST_STATUS_LABELS` in `deliveries.schema.ts`). It's embedded in the person Campaign
standing card (`persons/ui/person-campaign-facts.html`, fed `householdId` from `person-view.html` —
null for placeholder households) and in a "Yard sign" card on `households/ui/household-view.html`
(`showLabel=false`, card provides the eyebrow). No household → muted "Needs an address" guidance,
never a bare disabled select. Picking a status with no request calls `addRequest` (requester =
`personId` when set) then, if not `new`, `setRequestStatus`. Specs mounting either view must stub
`CampaignContextService` AND `DeliveriesRequestsService` or the child fires real tRPC calls.

## Gotchas

- Grid row DTO types must be **`type` aliases, not `interface`** — the `AbstractAPIService.getAll`
  return type requires assignability to `Record<string, unknown>[]`, which interfaces (augmentable)
  fail and type aliases satisfy.
- `est_minutes/est_km/leg_minutes` are `double precision` (not `numeric`) so node-pg returns JS
  numbers, not strings.
- Volunteer assignment IS wired: the route-detail header (`deliveries-route-detail`) has an
  **Assign / Change** control next to Volunteer that opens `assign-volunteer-dialog.ts` (a debounced
  `personsSvc.getAllWithAddress` picker, same idiom as the "Record donation" donor search). The dialog
  emits the picked person (or `null` for **Remove volunteer**); the page calls `svc.assignVolunteer`
  and reloads. When unassigned, the primary action is "Assign a volunteer to share" (opens the picker)
  instead of "Copy volunteer link", since `mintShareLink` refuses without a volunteer.
- **Assignment auto-sends the link**: `assignVolunteer` (controller) mints a fresh share token
  (raw token exists only at that moment — the only chance to put it in a message) and enqueues an
  email and/or SMS to the volunteer's person contacts inside the same transaction
  (`lib/mail/volunteer-link-notify.ts`, URL base `env.companionUrl` / `COMPANION_URL`, prod
  `https://go.pplcrm.com` set by deploy.yml). Returns `{ id, status, sent: { email, sms } }`; the
  frontend toast reflects the channels and warns when the person has no contacts. Re-assigning (even
  the same person) regenerates the token, retiring any previously sent link — as does the manual
  **Copy volunteer link** regenerate flow, which therefore invalidates the emailed link too.
  **Resend link to volunteer** (`resendVolunteerLink`, in the `⋯` menu on both the routes list and
  the route detail, live routes only) re-runs the same mint+notify inside one transaction; if the
  volunteer has no usable contact it throws and the transaction rolls back, so the existing link
  survives a resend that reaches nobody.
- Web-form `yard_sign` intake SHIPPED 2026-08-20: every form carries a standard-catalog
  `yard_sign` checkbox (off by default; `type: 'checkbox'` is a single yes/no box added to
  FormFieldObj for it). When the form's field is ON and the box was checked,
  `WebFormsController.maybeCreateYardSignRequest` (called inside the submit transaction)
  inserts a `delivery_requests` row — status 'new', source 'web_form', the form's uuid on
  `web_form_id`, requester = the submitter. It quietly skips when the person has no real
  household (existing contact on the placeholder — link-not-edit), when the household already
  holds an open request (pre-check + ON CONFLICT DO NOTHING, canvass-path pattern), or when
  the plan lacks deliveries (the answer still lands in form_submissions). Spec: the yard-sign
  describe block in `modules/web-forms/controller.spec.ts`.
- Deferred (not yet built): a grid-level "Add request" household-picker dialog. Manual entry
  per household DOES exist — the `pc-yard-sign-standing` control on the household/person
  pages calls `addRequest`.

## Campaigns (§15) — requests and routes belong to a context

- `delivery_requests.campaign_id` and `delivery_routes.campaign_id` (both NOT NULL): a manual
  request resolves the explicit input or the office fallback; a route inherits the campaign of the
  first request it serves (`createRoutesFromPlan`).
  See `pplcrm-campaigns` for the full contexts model.
