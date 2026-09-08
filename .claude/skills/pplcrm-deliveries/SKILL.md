---
name: pplcrm-deliveries
description: Deliveries (§14, post-absorption 2026-09) — yard-sign/flyer requests on the Canvassing page's Requests tab, the stored delivery_requests.turf_id out-for-delivery pointer, delivery-mode turfs (outings) in the shared companion app, add-from-list bulk intake, and the retired driving-route system (tables kept as history). USE WHEN touching modules/deliveries, experiences/deliveries, the delivery_* tables, delivery-mode turfs, the Requests tab, or the yard-sign standing control. EXAMPLES: 'why is a request showing as out with an outing', 'add a request source', 'what happened to routes and /r/:token'.
---

# Deliveries (§14) — absorbed into Canvassing (2026-09, Phase 4 of turfs-absorb-deliveries)

Yard-sign/flyer requests → approve on the **Requests tab of /canvassing** → cut into
**delivery outings** (turfs with `mode='delivery'`) → volunteers deliver in the same
companion app canvassers use. The old driving-route system (plan pages, `/r/:token`
driver page, route/stop write paths) is RETIRED — see "The route system is gone" below.

## The data model

- **`delivery_requests`** — one per household need. `status: new | approved | declined |
delivered`; `purpose: yard_sign | flyer` (CHECK); partial unique index
  `uq_delivery_requests_open_per_household_purpose` = ONE OPEN request per household PER
  KIND, tenant-wide. `web_form_id` uuid. `skip_reason` carries the volunteer's
  couldn't-deliver reason.
- **`delivery_requests.turf_id`** (bigint, FK → turfs ON DELETE SET NULL, partial index
  `(tenant_id, turf_id) WHERE turf_id IS NOT NULL`) — **the stored out-for-delivery
  pointer**: "the delivery outing currently carrying this request". A request is out for
  delivery iff the column is set. Claims are race-safe (`UPDATE … SET turf_id=$new WHERE
turf_id IS NULL` in `DeliveryRequestsRepo.claimForTurf`), so two concurrent cuts cannot
  take one house. TWO clear sites only: delivery-turf retire (`releaseTurfPointers`, open
  statuses only) and request decline/reopen (`doSetRequestStatus`, which also removes the
  door from the turf). **Terminal (delivered) rows KEEP the pointer as provenance** — the
  pool query is `status IN ('new','approved') AND turf_id IS NULL`.
- **`turfs.delivery_purpose`** (`yard_sign | flyer | both`, NULL on non-delivery turfs) —
  what the outing carries; `refreshFromPool` and the cut read it.
- **`delivery_routes` / `delivery_route_stops`** — RETIRED but the tables stay: terminal
  rows are history the dashboard's `signsDelivered7d` still reads (raw SQL in
  `modules/dashboard/controller.ts`). No code writes them anymore. The
  `2026-09-08-retire-delivery-routes.ts` migration converted every live route into a
  draft drive delivery turf (stops → doors in seq order, open requests claimed by the
  pointer, stops skipped, routes canceled; volunteers deliberately NOT re-attached —
  staff re-assign, which sends new links).

## Backend — `apps/backend/src/app/modules/deliveries/`

One repo (`delivery-requests.repo.ts`), `controller.ts`, a requests-only tRPC router.
Key methods:

- Pool/pointer: `getPoolHouseholdIds` (approved + purpose-matched + unclaimed; ungeocoded
  included for honest previews), `claimRequestsForTurf`, `releaseTurfPointers`,
  `turfDeliveryStates` (per-door pending/delivered/undeliverable for the companion
  payload), `deliverTurfCarriedRequests` / `undoTurfCarriedDelivery` /
  `markTurfCarriedUndeliverable` (the delivery outing's door taps, called from the
  canvassing op transaction; knock rows outcome `delivered`/`undeliverable`/`cleared`
  give delivery turfs progress).
- `addRequest` (pre-check + 23505→409 via `isOpenHouseholdConflict`), `setRequestStatus`
  (decline/reopen clears the pointer AND removes the door; manual `delivered` keeps
  both), `addRequestsFromList` (bulk targeting intake: one APPROVED request per eligible
  household; lowest-id member = requester on people lists; unanimous-DNC households and
  the placeholder household skipped; ADD_FROM_LIST_CAP 5000; ONE workspace activity
  entry, not per-household logs).
- `deliverHouseholdSign` / `undoHouseholdSignDelivery` — the canvasser doorstep handover,
  now DIRECT request flips (no stop transitions). Creates the request if none
  ('other_campaign' when another campaign holds the slot); `already_delivered` = retried
  op. `logRequestStanding` honest attribution (via 'staff' | companion).
- `closeCampaignDeliveries` (campaign archive): retires the campaign's delivery turfs
  (revoke links + release pointers) then declines its open requests.
- `sign_delivered` automation fires in `triggerSignDeliveredWorkflows` on every genuine
  transition to delivered.

## Frontend

- **Requests tab**: `experiences/deliveries/ui/deliveries-requests.ts` is an EMBEDDED
  component rendered inside `canvassing-page` (tab id 'requests', gated by the
  `deliveries` org-mode module toggle, badge = `getReadyCount`). Its "Cut into outings ·
  N ready" emits `cutRequested`; the canvassing page opens the cut wizard with the
  delivery card pre-chosen (`CutTurfsDialog.initialMode`). "Add from list" opens
  `add-from-list-dialog.ts`. Kind column shows purpose. "Out with" column reads the
  pointer (unretired turfs only; delivered rows show the outing muted as provenance).
- `/deliveries*` URLs are REDIRECTS to `/canvassing?tab=requests` (dashboard.routes.ts);
  the sidebar has no Deliveries entry (its ready badge moved onto Canvassing; the module
  toggle lives in Workspace → Modules; sidebar-items.spec allows tab-hosted modules).
- **Standing**: `yard-sign-standing.ts` on household/person pages — "Out with: <outing>"
  from `getSignStatus` (turf join, retired turfs excluded). Specs mounting those views
  must stub `CampaignContextService` AND `DeliveriesRequestsService`.
- Grid row DTO types must be **`type` aliases, not `interface`** (AbstractAPIService
  assignability).

## Companion (apps/companion)

Delivery outings use the canvass pages: `delivery-household.ts` door screen (Delivered /
required-reason Couldn't-deliver / Undo / Navigate + the campaign's `delivery_script`
notes), list-row quick actions shared via `canvass-quick-actions.ts`, per-door
`delivery_status` in the turf payload, offline ops `yard_sign` (mode-branched
server-side) and `delivery_result`. `/r/:token` renders `route-moved-page.ts` ("this
link has moved"); the companion-access gate resolves kind 'route' to null.

## Web-form intake

Unchanged: `WebFormsController.maybeCreateYardSignRequest` inside the submit transaction
(yard_sign checkbox; skips placeholder household, existing open request, plans without
deliveries).

## Campaigns (§15)

`delivery_requests.campaign_id` NOT NULL; delivery turfs are cut FOR a campaign and the
pool is campaign-scoped.
