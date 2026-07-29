---
name: pplcrm-canvassing
description: How pplCRM's Canvassing feature (§13) works end-to-end — the turfs/turf_households/turf_assignments/turf_knocks tables, the turf-cutting engine (clusters geocoded households into contiguous ward-bounded turfs), derived progress from knocks, the tokenised account-less Canvass Companion, and the field report. USE WHEN editing anything under modules/canvassing, experiences/canvassing, the turf/knock schema, the cutting engine, the Companion public route, or the field report. EXAMPLES 'add a knock outcome', 'why do turfs never cross a ward', 'how does the Companion token auth work', 'where does turf progress come from'.
---

# Canvassing (§13)

Cut a smart-list universe into walkable **turfs**, hand them to volunteers via a
**Canvass Companion** (web app, no account), and let every knock sync back live.
Built net-new in Wave 2 Track F. Reuses Wave 1A geocoding (`households.lat/lng` +
`ward`) and Wave 1C `lists.getCurrentMembers` — do **not** re-derive either.

## Data model

The four core tables live in the squashed baseline (`_migrations/schema.sql`) — the old
dated `2026-07-11-canvassing.ts` no longer exists post-squash (see `pplcrm-migrations`).
`turf_segment_claims` was added later by its own dated file.

Canvassing-namespaced (so they never collide with Track G's
delivery tables). All follow the house pattern: `bigint` id + `UNIQUE(id)` +
`PRIMARY KEY(id, tenant_id)`, `ENABLE`+`FORCE ROW LEVEL SECURITY` with the
standard `tenant_isolation` policy, grants to `pplcrm_app`. Multi-statement DDL
runs through `sql.raw(...)` (parameterless → simple protocol), like the baseline.

| Table                 | What it is                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turfs`               | A turf. `status` = `draft`\|`active`\|`retired` (stored lifecycle only). `list_id`, `target_doors`, `centroid_lat/lng`, `ward`.                                                                                                                                                        |
| `turf_households`     | The doors — one row per household (junction, PK includes both).                                                                                                                                                                                                                        |
| `turf_assignments`    | A turf handed to a volunteer: `volunteer_person_id` (the person the link belongs to — required by the access layer), optional `expires_at`, `team_id`, `token`. `status` = `active`\|`revoked`.                                                                                        |
| `turf_knocks`         | **The source of truth for progress.** One row per door interaction. `outcome`, `response`, `issues[]`, follow-up flags (`wants_volunteer`/`wants_yard_sign`/`set_dnc`/`subscribe`), `contact_phone/email`, `source`, `canvasser_name`, `client_knock_id`, `knocked_at`.                |
| `turf_segment_claims` | **Advisory only** — "Dana is on Scott Blvd", so a group can split a turf. Never consulted before a knock; no unique index on the street, one live claim per `assignment_id`, 6-hour expiry. Migration `2026-07-28-zzz-street-claims-organizer.ts`. See "Advisory street claims" below. |

Kysely aborts with "corrupted migrations" if a new file sorts alphabetically _before_
an already-applied one, so a new canvassing migration must sort after every applied
file — same-day additions use a `-z`/`-zz`/`-zzz` infix (see the existing companion
files) rather than a future date.

`turf_households.walk_order` stores the suggested visit order (set at cut time
from the engine's snake sweep — a hint, never a lock). `campaigns` carries the
Companion survey vocabulary: `canvass_issues text[]` + `canvass_script`.

Kysely models live in `libs/common/src/lib/kysely.models.ts` (Turfs,
TurfHouseholds, TurfAssignments, TurfKnocks). Zod triad + vocabularies in
`libs/common/src/lib/schemas/canvassing.schema.ts` (`TURF_STATUSES`,
`KNOCK_OUTCOMES` — now incl. `moved` + the append-only `cleared` marker — and
`KNOCK_RESPONSES`, the spec-§3.5 five: `supporter | undecided | non_supporter |
not_voting | already_voted`, labels in `KNOCK_RESPONSE_LABELS`). The Companion
API contract (`CompanionTurfPayload`, `CompanionOpObj` union, `CompanionOpAck`)
lives in the same schema file and is shared with `apps/companion`.

### Derived state — never stored twice (§22.6)

Progress ("attempted", "conversations", "In field now", "Complete") is **derived
from `turf_knocks` at read time** — there are no counter columns. `turfs.status`
stores only the true lifecycle (`draft`/`active`/`retired`); the display status
(`draft`|`assigned`|`in_field`|`complete`|`retired`) is computed in
`CanvassingController.displayStatus` from stored status + knock activity + door
count. `attempted` = `COUNT(DISTINCT household_id)`; `in_field` = a knock within
`IN_FIELD_WINDOW_MS` (6h). An `active` turf with an **empty roster** derives back to
`draft` rather than `assigned` — volunteers can be removed one at a time, and saying
"assigned" with nobody on it would be a lie.

### Several volunteers per turf (group canvassing)

A turf holds **any number of active `turf_assignments`**, one per volunteer, each
with its own token. Two rules make that safe, and breaking either is a real bug:

- `assignTurf` calls `assignments.revokeForVolunteer` (this volunteer only), **never
  `revokeForTurf`** — that retires _everyone_ and is correct only for `retireTurf`.
  Re-assigning the same person still rotates their token (the raw value is hashed and
  can never be re-displayed). Enforced by the partial unique index
  `uq_turf_assignments_active_volunteer` on `(tenant_id, turf_id,
volunteer_person_id) WHERE status = 'active'`.
- **Never join `turf_assignments` directly onto a query that aggregates.** A turf has
  one row per assignment ever made (revoked ones are kept), so joining fans each turf
  out and silently multiplies door counts and knock totals. `TurfsRepo.getTurfs` does
  not join it at all — the roster comes from `TurfAssignmentsRepo.canvassersByTurf` as
  a second query — and the field report's by-team roll-up uses a `DISTINCT ON (turf_id)`
  subquery over _active_ assignments.

`TurfListItem` therefore carries `canvassers: TurfCanvasser[]` and `has_link`, not a
single `team_id`/`team_name`. Per-knock attribution already worked: `turf_knocks`
stores `canvasser_name`, and the field report groups by it.

Companion side: the turf payload carries **everyone's** knocks, so turf-wide totals
must not be shown back to one volunteer as their own work. `CanvassStore` keeps a
separate `myDoorCount` (household ids this device logged, persisted under
`pc-canvass-mydoors:<turf_id>`, cleared on end-shift) and the Me tab labels the two
apart.

### Session-first access, and roaming

The capability link **bootstraps a device; it is not the ongoing credential.** Turf
tokens are hashed (2026-07-27 migration), so the turfs a volunteer already holds can
never be listed back to them as links — which is why switching turfs needs a second
door in. That door is the device session:

- `CompanionAccessController.resolveSession(sessionToken)` — a sibling to
  `requireSession`, answering "who is this?" instead of "may they open this link?".
  It returns `{ tenant_id, volunteer_id, person_id, can_roam }`. **Do not change
  `requireSession`** — `/t/:token` and `/r/:token` keep their link-first check.
- Two independent checks authorize a session-first request: the session says who they
  are (and that an admin approved them), and an **active `turf_assignments` row** says
  they belong on that turf (`assignmentForSession`). Roaming governs who may _create_
  an assignment, never who may read one they do not have.
- Routes: `GET /api/canvass/my-turfs`, `POST /api/canvass/claim`,
  `GET /api/canvass/turf/:turfId`, `POST /api/canvass/turf/:turfId/results`. The
  link-first `/t/:token` pair still exists and still works; the companion uses the
  session-first pair for everything after the first load.
- `CompanionTurfPayload.turf_id` exists so the client knows what to post against.

**Roam policy** (`lib/canvass-roam-policy.ts`, setting `app.canvass_volunteer_roam`):
`campaign` (**the default, for existing tenants too**) lets an approved volunteer
browse and self-claim any unretired turf in a campaign **they already work in**;
`assigned` restricts them to turfs staff placed them on. `companion_volunteers.can_roam`
overrides per volunteer (null = inherit) so one person can be pinned or trusted without
moving the workspace. Roaming never bootstraps a volunteer into a campaign — with no
assignment there is nothing to infer from and the picker is empty.

Client offline note: every queued op carries the `turf_id` it was recorded on, and
`sendableBatch()` stops at a turf change. Without that, a queue recorded on one turf
would drain against whichever turf happened to be open when the connection returned.
The queue itself is keyed **per device** (`pc-canvass-queue`), not per token — a
volunteer can arrive on `/t/:token` or on `/canvass` and must find the same unsynced
results either way; the old per-token key is adopted once on load and then retired.

### Signing up a canvasser who isn't in the CRM (QR join)

`campaign_join_codes` is the front door for strangers: an admin shows a QR (or the
8-char code) from **Join by QR** on `/volunteer-access`, or **Show join QR** in a turf's
row menu. A turf-scoped code puts the whole group on that turf; an unscoped one drops
them on the picker above. The volunteer scans, gives a name and one contact, verifies a
code, and waits for the same one-time approval every other volunteer waits for — the
trust model does not move, only the paperwork moves earlier.

Two things worth knowing from the canvassing side:

- The turf assignment is created at **approval**, not at scan (`placeOnJoinCodeTurf`
  inside `approveVolunteer`), so a declined stranger never held one.
- Approval can also happen from a text message (`/a/:token`) when the inviter opted in.

Everything else — the code lifecycle, the enumeration guards, the person match-or-create
rules — lives in `pplcrm-companion-access`. Read it before touching `joinStart`.

### Street segments and live refresh

`CompanionHousehold` carries `street` + `street_num` **alongside** the flattened `address`
(the payload used to throw the parts away). From those, `deriveSegments()` in
`canvass-derive.ts` groups a turf's doors into `CanvassSegment`s — pure, no DOM, tested in
`canvass-derive.spec.ts` like every other derivation here. Rules worth not re-deriving:

- Streets key on `trim().toLowerCase()` with runs of whitespace collapsed, so `Alder St`
  and `alder  st` are one street, but the **first spelling seen is what displays** —
  normalizing what a volunteer reads would misstate the data.
- Doors with no street land in ONE bucket (`UNKNOWN_SEGMENT_KEY = ''`), not one each.
- Segments sort by `minWalkOrder`, never alphabetically. Walk order is the order the turf
  was cut in and the only one that means anything on foot.
- `segmentKeyOf(h)` is exported so grouping and filtering cannot diverge.

The scope lives on the store (`segmentKey`, null = whole turf) rather than in the list
component, so the list and the map can never show different scopes. `scopedHouseholds()`
**falls back to the whole turf when the scoped street no longer exists** (a list refresh
dropped it) — an empty screen would blame the volunteer for something the turf did.
`stats()` stays turf-wide on purpose; only `nextDoorId()` follows the scope. The picker
(`canvass-segment-picker.ts`) is a plain conditional panel, **never** the focus-based
DaisyUI `.dropdown` (§4 — that bug has shipped twice).

**Live refresh**: `CanvassStore.refresh()` re-pulls the turf every 60s while the walk list
is open and replaces ONLY the server payload — `localOps` replay on top, so nothing queued
or optimistic is lost and re-applying an op the server already has is a no-op. It is
silent on failure (a poll that missed one tick is not a doorstep interruption) and the
narrated "Updated just now" line is what tells the volunteer how fresh the numbers are.
It posts to `/api/canvass/turf/:turfId`, not the link, so it works after a QR join too.

### Advisory street claims (`turf_segment_claims`)

"Dana is here" next to a street in the picker, so a group splitting one turf can see how it
has been split. **Advisory and nothing else** — read that as a hard rule, not a caveat:

- Nothing consults a claim before accepting a knock. `claimSegment` is the only writer and
  no reader outside `companionTurfPayload` exists.
- There is deliberately **no unique index on `(turf_id, street_key)`**. Two people choosing
  to work one street together is a decision they are allowed to make. What IS unique is one
  live claim per `assignment_id`, so nobody appears to stand in two places.
- The client fires and forgets (`CanvassStore.chooseSegment` scopes locally first, then
  POSTs `/api/canvass/turf/:turfId/segment`). A failed claim costs the group a label,
  never a knock, and never an error message at a doorstep.

`SEGMENT_CLAIM_TTL_MS` (6 h) is what stops a phone locked at 4pm telling Sunday's group a
street is taken; `activeForTurf` filters expiry at read time rather than by a sweep job.
Claims are released explicitly on picking a different street, switching turfs, and
`endShift()`. `canvasser_name` is denormalized onto the row like `turf_knocks.canvasser_name`,
so reading claims never touches `persons`. The payload marks the reader's own claim `mine:
true` and the store drops those — "Showing" and "You're here" would say the same thing twice.

## The cutting engine (`modules/canvassing/lib/cutting-engine.ts`)

Pure, dependency-free, unit-tested (`cutting-engine.spec.ts`). `cutTurfs(doors,
target)` and `previewCut(...)` share the same code so the dialog preview can
never disagree with the actual cut.

- **Input**: geocoded households (`{household_id, lat, lng, ward}`). Ungeocoded
  ones are reported as `unplaced`, never dropped.
- **Barriers**: the only barrier data shipped is the ward/precinct GIS polygons
  (`lib/gis/boundaries.geojson`), whose edges follow real rivers/rail/arterials.
  So the engine treats the **ward boundary as the barrier — a turf never spans
  two wards**. True per-street barrier linework isn't in the dataset, so finer
  avoidance is deferred to the manual "rebalance on the map" step the spec
  already calls for. If you add real barrier data, this is where it plugs in.
- **Contiguity**: within a ward, doors are ordered along a latitude-banded
  boustrophedon ("snake") sweep, then chunked into near-equal runs → compact,
  contiguous turfs without a TSP solve.

## The universe = a smart list (reuse, don't re-derive)

`CanvassingController.resolveUniverseHouseholdIds` calls
`new ListsController().getCurrentMembers(auth, listId)` (Wave 1C). If the list is
`people`, it maps to distinct `household_id`s; if `households`, uses them
directly. Then `TurfsRepo.getHouseholdsGeo` fetches lat/lng/ward. **Refresh from
list** re-runs this, drops doors that left the list (knock rows persist —
history kept) and adds new in-ward members not yet in any turf.

## Canvass Companion — tokenised, verified, in apps/companion (§13.4 + COMPANION-APPS-PLAN.md)

Public REST route `modules/canvassing/routes/canvass-public.route.ts`, mounted at
`/api/canvass` in `routes.ts`. The volunteer UI is the separate mobile app
`apps/companion` at `/t/:token` (route in `apps/companion/src/app/app.routes.ts`;
components under `apps/companion/src/app/canvass/`); there is no companion page in
`apps/frontend` anymore.

**Security model — two credentials** (see `pplcrm-companion-access`): the
`turf_assignments.token` (24 random bytes, base64url, UNIQUE) scopes WHAT — it is
resolved by `TurfAssignmentsRepo.resolveByToken`, the one intentionally
un-tenant-scoped query in the module, and everything downstream is scoped by the
resolved `tenant_id` + `turf_id`. The `X-Companion-Session` header proves WHO —
`getCompanionTurf`/`postCompanionResults` call
`CompanionAccessController.requireSession(...)` against the assignment's
`volunteer_person_id` (verified device + admin-approved volunteer). Expired
(`expires_at`) or revoked assignments read as a uniform dead link.

- **API**: `GET /api/canvass/t/:token` → `CompanionTurfPayload` (campaign name,
  script + issue vocabulary, canvasser identity, walk-ordered households with
  residents, DNC flags, door outcomes, survey pre-fills — payload-minimized: no
  emails/phones/notes ever). `POST /api/canvass/t/:token/results` → batched ops
  (`survey`, `person_result`, `door_outcome`, `clear_outcome`, `person_create`),
  each claimed in the `companion_ops` ledger (`ON CONFLICT DO NOTHING`) and applied
  in its own transaction; acks are `applied | duplicate | rejected` per op, and a
  `person_create` ack returns the real id to swap for the client temp id. Those two
  are the **only** routes on `canvass-public.route.ts` — the old `POST /knock`
  single-op endpoint is gone (`LogKnockObj` survives in the schema with no call
  sites). Staff-side roster reads/writes go over tRPC, not this public route.
- **Survey side-effects** (all inside the op's transaction,
  `controller.applySurveySideEffects`): support/turnout →
  `campaign_person_facts` (supporter→strong, non_supporter→against,
  not_voting/already_voted→voting_status); `wants_yard_sign` → a `source='canvass'`
  `delivery_requests` row unless the household already has an open one;
  `set_dnc` → `persons.do_not_contact`; contact capture fills blanks only;
  `subscribe` → `campaign_subscriptions` with `consent_source='canvass'`;
  `wants_volunteer` → sets `persons.volunteer_status = 'prospective'` when it is
  NULL (first-class status, §15 — not a tag; + 'Added at door' tag on person_create).
- **Offline**: the app queues ops in `localStorage` (`pc-canvass-queue:<token>`),
  replays them as an optimistic overlay (`canvass-derive.ts applyLocalOps`), and
  flushes on the `online` event / load — idempotent via `op_id`.
- **Honest attribution (§22.7)**: activity rows land under the **real CRM account
  that deployed the link** (`assignment.created_by`) with `metadata.via =
"via Canvass Companion (<volunteer name>)"` — the name now comes from the
  assignment's volunteer person server-side, never from client input.

## Frontend

- `experiences/canvassing/services/canvassing-service.ts` — extends `TRPCService`,
  wraps `api.canvassing.*`. Router: `modules/canvassing/trpc.router.ts`, registered
  as `canvassing:` in `modules/trpc.ts`.
- `ui/canvassing-page.ts` — the /canvassing page (Turfs & assignments + Field
  report tabs, `pc-map` turf-centroid markers tinted by status). The Field report
  tab's **Coverage** card (§13.3) has a Street map / By ward toggle: `getCoverage`
  (router + `controller.getCoverage`) returns one door per geocoded turf household
  coloured by window knock status (`conversation`/`attempted`/`not_yet`), a
  convex-hull dashed boundary per turf, and a by-ward roll-up. It renders whenever
  turfs have geocoded doors — independently of `report.doors` — so a freshly-cut
  universe reads as an all-grey map before the first knock. Aggregation lives in
  `controller.getCoverage` (+ the module-level `convexHull`); the raw per-door rows
  come from `TurfHouseholdsRepo.getCoverageRows` (`CoverageDoorRow`).
- `ui/turf-detail-page.ts` — **one turf, opened** (route `/canvassing/:id`; the turf
  name and the strip map's pins link to it). Doors on a map coloured by knock status
  inside the turf's hull, the roster with per-canvasser doors/conversations, and every
  door in walk order with residents, last outcome + response, who knocked, and when.
  Backed by the single `canvassing.getTurfDetail` query (`controller.getTurfDetail` +
  `TurfsRepo.getTurfRow`, `TurfKnocksRepo.getDoorActivity`/`getCanvasserWork`). Two
  things to keep true: everything is derived at read time exactly like the list page
  (no stored counters — §22.6), and per-canvasser work is matched to the roster **by
  `turf_knocks.canvasser_name`**, because knocks carry a name, not a volunteer id — a
  volunteer taken off the roster stays listed with `active: false` rather than having
  their doors disappear. Roster/QR/retire actions reuse the list page's dialogs.
- `ui/cut-turfs-dialog.ts` — universe select (reuses `ListsService.getAllWithCounts`),
  presets, live preview.
- `ui/assign-turf-dialog.ts` — the **canvasser roster** for a turf. A turf holds as
  many volunteers as you put on it (a group walking it together is the normal case),
  so this is add/remove, not a swap: existing canvassers each with a remove action,
  plus a multi-select search to add several at once. Assignment is still personal —
  each volunteer gets their own token and verifies against their own email/mobile —
  so `AssignTurfObj` still requires `volunteer_person_id`, and each add is a separate
  `assign` call. `canvassing.getCanvassers` / `removeCanvasser` back the roster.
  **Assignment also auto-sends the link**: `assignTurf` enqueues an email and/or
  SMS to the volunteer's contacts inside the same transaction
  (`lib/mail/volunteer-link-notify.ts`, URL base `env.companionUrl` /
  `COMPANION_URL`) and returns `{ token, sent: { email, sms } }`; the page's
  toast reflects the channels, warns when nothing could be sent.
- `ui/companion-settings-dialog.ts` — "Survey settings" (header button): the
  campaign-scoped issue chips + door script every Companion shows
  (`canvassing.getCompanionSettings`/`updateCompanionSettings`, admin-gated write).
- Sidebar entry: `layout/sidebar/sidebar-items.ts` under FIELD (icon `map-pin`,
  shortcut `v`). Help article: `libs/common/src/lib/help/articles/engagement.ts`
  (`id: 'canvassing'`); `/canvassing` is in the help spec's route allow-list.

## Testing / gotchas

- Backend specs share one Postgres instance across worktrees. Parallel tracks
  apply their own migrations to `pplcrm_test`, which makes Kysely abort with
  "corrupted migrations". Use a **dedicated** test DB:
  `TEST_DB_NAME=pplcrm_canvass_test apps/backend/scripts/setup-test-db.sh` and set
  `DB_NAME=pplcrm_canvass_test` in `.env.test`. globalSetup then builds it from
  scratch (also the fresh-DB migration verification).
- `controller.spec.ts` seeds a static household list of geocoded doors across two
  wards and drives the full flow (cut → assign → token → idempotent knock →
  progress → refresh). `cutting-engine.spec.ts` covers clustering purely.
- Mixed `.select([...])` (string cols + `sql` builders) type-checks as a plain
  array but **not** in a `.select(() => [...])` callback — use plain arrays.

## What's deferred (and why)

- **Filled turf polygons on the _turf strip_** (Turfs & assignments tab) — the
  turf list row only carries the centroid, so that map still pins tinted centroids
  honestly (clicking a pin opens the turf, which does draw its hull). The
  **Coverage** map (Field report tab) _does_ draw per-turf boundaries,
  computing the convex hull of each turf's door coordinates on the fly in
  `getCoverage` — reuse that if you want hulls on the turf strip too.
- **Sub-ward barrier avoidance** — no highway/rail/water linework in the shipped
  GIS data; ward boundary is the honest proxy (see engine).
- **Team-target picker UI** — the backend fully supports `team_id`; the page
  currently issues the tokenised-link assignment ("Copy a link instead" path).

## Campaigns (§15) — turfs belong to a context

- `turfs.campaign_id` (NOT NULL): turfs are cut FOR a campaign; `cutTurfs`/`addTurf` resolve the
  explicit `campaign_id` input or fall back to the tenant's office context.
- **Knock outcomes with a stance upsert `campaign_person_facts.support_level` for the TURF's
  campaign** (`source='canvass'`; mapping strong_support→strong, lean_support→leaning,
  undecided→undecided, opposed→against) — see `KNOCK_RESPONSE_TO_SUPPORT` in the controller.
  A writ-period knock updates the election campaign's read on the voter, never the office's.
  See `pplcrm-campaigns` for the full contexts model.
