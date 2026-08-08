---
name: pplcrm-canvassing
description: Canvassing (§13) — the turfs / turf_households / turf_assignments / turf_knocks tables, the turf-cutting engine (clusters geocoded households into contiguous turfs bounded by whichever boundary map the campaign's office implies), progress derived from knocks, and the tokenised account-less Canvass Companion. USE WHEN editing modules/canvassing, experiences/canvassing, the turf/knock schema, the cutting engine, turf-boundary.ts, the Companion public route, or the field report. EXAMPLES 'add a knock outcome', 'why do turfs never cross a boundary', 'what is an unbounded turf', 'where does turf progress come from'.
---

# Canvassing (§13)

Cut a smart-list universe into walkable **turfs**, hand them to volunteers via a
**Canvass Companion** (web app, no account), and let every knock sync back live.
Reuses the existing household geocoding (`households.lat/lng`, plus the
`household_districts` rows the boundary matcher writes — `households.ward` and
its two siblings no longer exist) and `lists.getCurrentMembers` — do **not**
re-derive either.

## Data model

The four core tables live in the squashed baseline (`_migrations/schema.sql`) — the
original dated migration no longer exists post-squash (see `pplcrm-migrations`).
`turf_segment_claims` was added later by its own dated file.

Canvassing-namespaced, so they never collide with the `delivery_*`
tables. All follow the house pattern: `bigint` id + `UNIQUE(id)` +
`PRIMARY KEY(id, tenant_id)`, `ENABLE`+`FORCE ROW LEVEL SECURITY` with the
standard `tenant_isolation` policy, grants to `pplcrm_app`. Multi-statement DDL
runs through `sql.raw(...)` (parameterless → simple protocol), like the baseline.

| Table                 | What it is                                                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turfs`               | A turf. `status` = `draft`\|`active`\|`retired` (stored lifecycle only). `list_id`, `target_doors`, `centroid_lat/lng`, `boundary_set_id` (FK, `ON DELETE SET NULL`) + `boundary_name` (text). The old `ward` column is **dropped**.                                                   |
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
`KNOCK_OUTCOMES` — `moved`, `deceased`, `data_error`, plus the append-only
`cleared` marker — and `KNOCK_RESPONSES`, the spec-§3.5 five: `supporter |
undecided | non_supporter | not_voting | already_voted`, labels in
`KNOCK_RESPONSE_LABELS`). The Companion API contract (`CompanionTurfPayload`,
`CompanionOpObj` union, `CompanionOpAck`) lives in the same schema file and is
shared with `apps/companion`.

**One stance vocabulary, three surfaces.** `CanvassStance` (`supporter |
undecided | non_supporter`) is what a walk-list row, a map pin and a household
card are all coloured by, and both richer vocabularies collapse into it through
`SUPPORT_LEVEL_TO_STANCE` and `KNOCK_RESPONSE_TO_STANCE` in the same schema
file. Add a support level or a knock response and you add a mapping here, or the
Companion silently reads it as "no ID". `VOTED_STATUSES` is the matching list
for the green check ("has cast a ballot", not "intends to").

### Two person columns the door writes (2026-07-30)

`persons.deceased_at` (timestamptz) and `persons.senior` (boolean) — first-class
columns rather than tags, for the same reason `volunteer_status`/`staff_status`
stopped being tags (§15). Both **nullable with no default**: `senior = NULL` means
"nobody has asked", which is not the claim `senior = false` makes. Migration
`2026-07-30-canvass-person-flags.ts` adds partial indexes matching the only two
queries anyone runs. Wired into the smart-list rule builder as `senior` /
`deceased` (`persons.repo` columnMapping + `list-rule-fields.ts` + `list-form.ts`
— a rule field needs **all three** or it is silently dropped; see `pplcrm-lists`),
and onto the person page's standing card under "At the door".

Written from `applyPersonResultSideEffects` / `applySurveySideEffects`:

- **`deceased`** stamps `deceased_at` (once — a second report must not overwrite
  when we first learned it) **and** sets `do_not_contact`. Not optional: the harm
  the flag exists to prevent is one more letter.
- **`data_error`** writes nothing to the person. It opens a Task named
  `Check door data: <name>` assigned to the campaign admin (falling back to the
  link's deployer) carrying the volunteer's note. One open task per person,
  deduped on that name prefix — a family of four at a wrong address is one task.
- **`senior`** has exactly two transitions and never a blanket write: ON sets
  `true` where it is not already true, OFF only clears a value that was `true`.
  The survey toggle ships `false` on every save, so writing it straight through
  would assert "under 65" about the whole turf. The client pre-fills the toggle
  from `CompanionPerson.senior`, which is what makes an un-tick a correction.

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
  It returns `{ tenant_id, volunteer_id, person_id, can_roam, join_campaign_id }`.
  **Do not change `requireSession`** — `/t/:token` and `/r/:token` keep their
  link-first check.
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
moving the workspace.

**Which campaigns a roamer may reach** is `CanvassingController.roamableCampaigns()`, and
both the picker (`getMyTurfs`) and self-claim (`claimTurf`) read it — a turf the picker
lists is always claimable. Placed volunteers roam inside the campaigns their active
assignments are in, and nowhere else. A volunteer with **no assignment yet** bootstraps
from their join code's campaign (`join_campaign_id`, provenance from the QR path) if it
named one, and otherwise from **every active campaign** in the workspace; archived
campaigns are never a bootstrap. Until 2026-07-29 that case returned nothing, so
"any turf in campaign" silently did nothing for anyone staff hadn't already placed by
hand — do not reintroduce that as a "roaming widens, never bootstraps" rule.

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

Three things worth knowing from the canvassing side:

- For a **stranger**, the turf assignment is created at **approval**, not at scan
  (`placeOnJoinCodeTurf` inside `approveVolunteer`), so a declined stranger never
  held one. An **already-approved** volunteer opening a turf-scoped join link is
  placed by `attachJoinCode` (`POST /api/companion/join/attach`) instead — approval
  never fires again for them, and without this they landed on the picker with no
  assignment.
- The client carries the turf across the handoff: `JoinPage` navigates to
  `/canvass?turf=…`, and `CanvassStore.bootstrapFromSession(preferredTurfId)` opens
  that turf directly (falling back to the picker if it can't).
- Approval can also happen from a text message (`/a/:token`) when the inviter opted in.

Everything else — the code lifecycle, the enumeration guards, the person match-or-create
rules — lives in `pplcrm-companion-access`. Read it before touching `joinStart`.

### Prior ID in the payload, and what a row shows

`CompanionPerson` carries `support` + `voting_status` read from
`campaign_person_facts` **in the turf's campaign** — from any source, not just
this turf's knocks — plus `last_name`, `deceased` and `senior`.
`CompanionHousehold` carries `apt` and `yard_sign` — a `CompanionYardSign`
(`{status: 'requested' | 'delivered', requested_at}`) or null, campaign-scoped.
It is **not** a boolean any more: the `delivered` state travels too, or a door
that already has its sign reads as still owing one and gets a second.

This is the one deliberate widening of payload minimization (§2): a paper walk
list has always carried prior ID, and "already voted" is essentially never
canvasser-recorded, so without it the green check could never fire. Still no
emails, phones, donations or notes. `priorFactsByPerson` returns an empty map
when the turf has no campaign — an unknown context must read as unknown, never as
another campaign's answer.

Client side, `personStance` lets a survey recorded on this walk beat the prior ID
(newer, and heard first-hand), and `householdStance` folds every resident plus
the anonymous household survey into unanimity-or-`mixed` — never an average,
which would put a confident colour on the doors that most need a conversation.
`residentSummary` folds a shared surname ("Heather & Ross Gagnon") and **drops
deceased residents**, so nobody reads a dead person's name off a screen at their
family's door.

### "Somebody was already here" — `last_knock` (2026-08-07)

`CompanionHousehold.last_knock` is `{canvasser_name, conversation, at}` or null: the most
recent knock at that door inside `RECENT_KNOCK_WINDOW_DAYS` (30, in the shared schema).
Rendered by `lastVisitLabel()` (`canvass-ui.ts`) as the line at the top of the door screen —
"Julie L. spoke to someone here 1 day ago".

Three rules it is built on, each of which is a bug if reversed:

- **Campaign-scoped, not turf-scoped.** `TurfKnocksRepo.getLastKnockByHousehold` joins
  `turfs` and filters `campaign_id`, so a door two turfs overlap on reports the other
  turf's visit — that is the whole point — while a different race's canvass never appears
  on this screen. The controller skips the query entirely when the turf has no campaign.
- **`cleared` rows are excluded.** That marker means an outcome was undone; counting it as
  a visit tells a volunteer somebody was here when the record says the opposite.
- **`conversation` is carried separately** so the sentence can say "tried this door" for a
  no-answer. Calling a no-answer "canvassed" overstates what happened at that door.

`timeAgoLabel` deliberately never says "yesterday" (26 hours ago can be today), and the
household component runs its own 30s clock because the walk list's 60s refresh is
unmounted on the door screen.

### Delivering a yard sign at the door (2026-08-08)

A canvasser carrying signs can hand one over, from two places, both writing the ordinary
`delivery_requests.status = 'delivered'` — **no new status was added, deliberately**:

- **The door card** (`canvass-household.ts`) shows only when the door has a request. Its op
  is `{type:'yard_sign', payload:{household_id, delivered}}` — door-level, because the sign
  goes in the lawn, not to a person. `delivered:false` is the Undo.
- **The survey follow-up line** "I gave them one just now" (`yard_sign_delivered` on
  `CompanionSurveyObj`), nested under "Wants a yard sign" and hidden once the door's sign is
  already delivered. Asking and handing over happen in the same half-minute, so they are one
  save; a two-step version would need the request to exist before the second tap.

The work is done by two public methods on `DeliveriesController` that run **inside the
canvassing op's transaction** — `deliverHouseholdSign` and `undoHouseholdSignDelivery`. Do
not reimplement either here. What they get right, and what breaks if you bypass them:

- **The delivery goes through the pending route stop** (`applyStopTransition`), so a house a
  canvasser already served stops being a stop a driver is sent to, and the route advances
  and auto-completes exactly as it does for the driver. Writing the request status directly
  would leave a driver's route claiming that house is still to do.
- **Undo restores the stop** via `undoStop`, reopening a route the delivery had completed.
- **Creates the request when there is none** (the survey path), and returns false rather
  than writing when the tenant-wide open-per-household index says another campaign holds
  this household's request.
- **No knock row is written.** Handing over a sign is not a report of a visit, and counting
  it as one would inflate the turf's attempted-door numbers.

`CanvassStore.yardSign()` returns false when there is nothing to change (no request, or
already in that state), so a retried offline op and a second canvasser at the same door are
both no-ops. `applyLocalOps` only moves an EXISTING `yard_sign` between its two states — it
never invents a request the server may not have created.

Companion-side attribution: `logRequestStanding` now takes a `via` argument (default
`'staff'`), and the canvassing path passes `"via Canvass Companion (name)"`. The user id is
still the staff account that deployed the turf link (§22.7) — `companionAuth()` builds that
CRM-shaped caller.

### Vocabulary drift is a real failure mode here

`turf_knocks.response` is a plain text column and the door vocabulary already changed once
(`strong_support`/`lean_support`/`opposed` → the current `KNOCK_RESPONSES`). A stale value
is not caught by types: `KNOCK_RESPONSE_LABELS[stale]` is `undefined`, which renders as a
**green badge with no word in it**, and `KNOCK_RESPONSE_TO_STANCE[stale]` is undefined, so
the thumb disappears too — colour with no meaning, which is exactly what §5 forbids. Two
guards now exist and both should stay: `isKnockResponse()` (shared, used by the
controller's `toPrefill`) narrows on the way out of the DB, and `personResultLabel` falls
back to "Surveyed" rather than to an empty string. The demo seed carried the old spelling
until 2026-08-07 — `DemoKnockDef.response` is now typed `KnockResponse` so it cannot drift
again silently.

### Apartments: `WalkEntry`, not one row per flat

`deriveWalkEntries()` groups doors into the rows the list actually renders:
`{kind:'door'}` or `{kind:'building'}`. `buildingKeyOf(h)` is
`street_num|segmentKeyOf(h)` and returns null unless the door carries an `apt` —
two unit-less households sharing a street number are a duplicate-data problem,
not a building, and folding them would hide it. A building takes its earliest
unit's `walk_order` (folding never moves a block in the walk), sorts units
numerically then alphabetically (`101 < 102 < 1003 < PH2`), and counts as
attempted only when every unit does. A one-unit "building" stays a plain door.
`CanvassStore.nextEntryKey` puts the ring on the row the volunteer can see and
tap, which for a flat is its building. `canvass-building.ts` renders the unit
list, and `canvass-household.ts` goes back to it rather than to the walk list.

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

**Street-first by default (2026-07-30).** `applyDefaultScope()` runs after every payload
load/switch and scopes to the street holding the next unattempted door — a turf is a
neighbourhood, a shift is a street, and landing on "all 143 doors" made narrowing the
volunteer's first job. It is a **no-op on a single-street turf** (nothing to narrow) and
it deliberately does **not** claim the street: a claim tells the group "I am standing
here", and the app guessing would put a name on a street nobody has walked to. Only an
explicit pick claims. The picker has **no "All doors" option** — nothing is hidden by
that, because every street is listed (incl. the one `UNKNOWN_SEGMENT_KEY` bucket) and the
turf total is printed under the list. Streets sort nearest-first once `GeoPosition` has a
fix and by walk order otherwise, with the heading naming which order is in force;
"Find the street I'm on" is the only path allowed to move the scope for the volunteer.

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
`endShift()` (now async — it revokes the device session too, see `pplcrm-companion-access`
→ `POST /session/end`; the Me tab flushes the queue first so signing out cannot become a
new way to lose recorded doors). `canvasser_name` is denormalized onto the row like `turf_knocks.canvasser_name`,
so reading claims never touches `persons`. The payload marks the reader's own claim `mine:
true` and the store drops those — "Showing" and "You're here" would say the same thing twice.

## The cutting engine (`modules/canvassing/lib/cutting-engine.ts`)

Pure, dependency-free, unit-tested (`cutting-engine.spec.ts`). `cutTurfs(doors,
target)` and `previewCut(...)` share the same code so the dialog preview can
never disagree with the actual cut.

- **Input**: geocoded households as `DoorPoint {household_id, lat, lng, boundaryName}`.
  Ungeocoded ones are reported as `unplaced`, never dropped.
- **Barriers**: the engine is told only the **name** of the area each door falls
  in, never which kind of area it is, and never lets one turf span two — a
  boundary edge in practice follows a river, a rail line or an arterial road.
  True per-street barrier linework is not in the dataset, so finer avoidance is
  still the manual "rebalance on the map" step.
- **Contiguity**: within one boundary area, doors are ordered along a
  latitude-banded boustrophedon ("snake") sweep, then chunked into near-equal
  runs → compact, contiguous turfs without a TSP solve.
- `TurfCluster.boundaryName` is `null` for an **unbounded** turf — either the
  workspace holds no usable map, or those doors fell outside every area of it.
  Supported state, not an error; the UI labels it rather than inventing a name.

### Which boundary — `modules/canvassing/lib/turf-boundary.ts`

`resolveTurfBoundary(db, { tenant_id, campaign_id })` is the **single place**
that decides, and it returns `{ set_id, label, label_plural }`. Order:

1. The **finest subdivision** set matching the campaign's jurisdiction and
   region (a polling division or precinct is about one evening's walk). "Finest"
   is `feature_count DESC NULLS LAST` — more areas over the same ground means
   smaller areas.
2. Otherwise the **seat-area** set (a riding is far too big for one turf, but is
   still a real barrier, and the engine chunks each area to target size anyway).
3. Otherwise **no set at all** (`set_id: null`) — purely geographic clustering.

A set with `region` NULL is national and matches any campaign region; ties break
to the highest id so re-running a cut picks the same map. A null `campaign_id`
resolves to the workspace's permanent office campaign, and an unrecognised
stored `jurisdiction` reads as `'other'` rather than throwing.

The `label` / `label_plural` come from `seatLabelFor` / `subdivisionLabelFor`
(see `pplcrm-campaigns`), which is why the field report's roll-up tab reads "By
polling division" or "By ward" depending on the campaign — never a hard-coded
word. `getCoverage` and `getTurfDetail` return them as `boundary_label` /
`boundary_label_plural`; doors in unbounded turfs roll up under
`UNBOUNDED_AREA_LABEL`.

Refreshing a turf's doors compares against **the turf's own**
`boundary_set_id` + `boundary_name`, not the campaign's current map
(`boundaryMembersNotInAnyTurf`), so redrawing a map never silently re-scopes an
existing turf.

Because that comparison is on the area's **name as text**, renaming an area in
Settings → Boundaries rewrites `turfs.boundary_name` for every turf of that same
boundary set in the same transaction (`BoundariesController.updateFeature`), so a
renamed or renumbered area keeps refreshing the doors it always did instead of
finding none.

## The universe = a smart list (reuse, don't re-derive)

`CanvassingController.resolveUniverseHouseholdIds` calls
`new ListsController().getCurrentMembers(auth, listId)`. If the list is
`people`, it maps to distinct `household_id`s; if `households`, uses them
directly. Then `TurfsRepo.getHouseholdsGeo({ tenant_id, household_ids,
boundary_set_id })` fetches lat/lng plus each door's area name, joined from
`household_districts` for that one set (a null `boundary_set_id` means no map
applies and every door comes back with `boundaryName: null`). **Refresh doors
from list** re-runs this, drops doors that left the list (knock rows persist —
history kept) and adds new members that fall in the **same area of the same
map** and are not yet in any turf.

It only works on a turf with a `list_id`, i.e. one that was **cut**; `addTurf`
accepts an optional `list_id` but `updateTurf` cannot attach one afterwards, so a
hand-built turf can never be refreshed. Both surfaces therefore gate the action on
`list_name`/`list_id` rather than letting the `BadRequestError` be the explanation:
the row menu names the list in the label ("Refresh doors from Ward 12 supporters")
and disables the item when there is none, the detail page disables the button with
a tooltip, and both ask for confirmation first through
`refreshFromListExplainer()`/`refreshResultMessage()` in `ui/turf-vocabulary.ts`.

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
  `person_create` ack returns the real id to swap for the client temp id — **on the
  `duplicate` path too**, read back from `companion_ops.result` (see
  `pplcrm-companion-access` → "Retrying an op that already succeeded"). Those two
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
  NULL (first-class status, §15 — not a tag; + 'Added at door' tag on person_create);
  `senior` → `persons.senior`, two transitions only (see "Two person columns the
  door writes" above). The `person_result` codes `deceased` and `data_error` have
  their own side effects in `applyPersonResultSideEffects`.
- **Offline**: the app queues ops in `localStorage` (`pc-canvass-queue`), replays
  them as an optimistic overlay (`canvass-derive.ts applyLocalOps`), and flushes on
  the `online` event / load — idempotent via `op_id`. Four rules keep a queue from
  wedging, all in `CanvassStore` and all with specs:
  - `sendableBatch()` **skips** an op whose `tmp-…` person is still waiting on its
    `person_create`; it must never `break`, or one held entry freezes every unrelated
    door recorded after it.
  - "Can this dependency ever resolve?" is answered **structurally** — is there still a
    queued `person_create` producing that temp id — never by a retry count or an age.
    No clock means nothing is dropped because the network was slow.
  - Anything that leaves the queue unsent lands in `blocked` (persisted under
    `pc-canvass-blocked`) with a reason and a `retryable` flag, and is shown in a
    top-of-screen bar plus a list in the Me tab with Try again / Discard. **A rejected
    op is never deleted** — the "not part of this turf" refusal is reachable from an
    ordinary turf refresh, so deleting it would destroy real doorstep work.
  - `isQueuedOp` masks a `tmp-` person id before validating against `CompanionOpObj`.
    The wire schema requires a real db id (correctly — the server must never see a
    placeholder), and validating stored entries with it unchanged deleted exactly those
    results on every reload.
- **Honest attribution (§22.7)**: activity rows land under the **real CRM account
  that deployed the link** (`assignment.created_by`) with `metadata.via =
"via Canvass Companion (<volunteer name>)"` — the name now comes from the
  assignment's volunteer person server-side, never from client input.

## Frontend

- `experiences/canvassing/services/canvassing-service.ts` — extends `TRPCService`,
  wraps `api.canvassing.*`. Router: `modules/canvassing/trpc.router.ts`, registered
  as `canvassing:` in `modules/trpc.ts`.
- `ui/turf-vocabulary.ts` — **the one place the feature's user-facing words live**:
  the status label/hint/tone/map-variant maps, the refresh copy, and the rename copy
  (`renameTurfPrompt` + `turfRenameIntent`, which folds cancelled/blank/unchanged into
  one `none` so none of them fires a request, and catches the 120-char limit before the
  server does). Both the list and
  the detail page read it, so a turf can never read two ways. The labels deliberately
  describe the world rather than the stored lifecycle (`draft` → "Needs canvassers",
  `assigned` → "Links sent", `in_field` → "Knocking now", `complete` → "Every door
  knocked"); if you add a display status, add its label **and** its hint here and in
  the help article's status glossary.
- `ui/canvassing-page.ts` — the /canvassing page (Turfs & assignments + Field
  report tabs, `pc-map` turf-centroid markers tinted by status). Header is
  `pc-grid-header` with `helpArticle="canvassing"`, so the ⓘ defines a turf and links
  the guide. With zero turfs the whole tab is a `pc-empty-state` walking through the
  three steps (`GETTING_STARTED`) instead of four empty widgets. The Field report
  tab's **Coverage** card (§13.3) has a Street map / by-area toggle whose label is
  the campaign's own word ("By ward", "By polling division", from
  `boundary_label_plural`; `'Areas'` when the payload has none): `getCoverage`
  (router + `controller.getCoverage`) returns one door per geocoded turf household
  coloured by window knock status (`conversation`/`attempted`/`not_yet`), a
  convex-hull dashed boundary per turf, and a by-area roll-up. It renders whenever
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
- **Renaming** is offered from both surfaces — "Rename turf" in the list's ⋯ menu, and the
  pencil beside the name on the detail page — through `ConfirmDialogService.prompt`, which
  is the house idiom for a one-field edit (same as the Tags/Issues admin). Nothing else is
  editable from the UI: `updateTurf` also accepts `status`/`notes`, but the lifecycle moves
  through `retireTurf` and derived display status, not by hand. The controller resolves the
  turf first (so an unknown id is a `NotFoundError`, not a silent no-op) and logs a rename
  to the turf's activity log as `metadata.changes.name.{from,to}` — the shape
  `record-activities.ts` already renders as "changed name from X to Y".
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
  boundary areas — a `boundary_sets` row plus one `household_districts` row per
  household, which is where the cutter reads them — and drives the full flow
  (cut → assign → token → idempotent knock → progress → refresh).
  `cutting-engine.spec.ts` covers clustering purely.
- Mixed `.select([...])` (string cols + `sql` builders) type-checks as a plain
  array but **not** in a `.select(() => [...])` callback — use plain arrays.

## What's deferred (and why)

- **Filled turf polygons on the _turf strip_** (Turfs & assignments tab) — the
  turf list row only carries the centroid, so that map still pins tinted centroids
  honestly (clicking a pin opens the turf, which does draw its hull). The
  **Coverage** map (Field report tab) _does_ draw per-turf boundaries,
  computing the convex hull of each turf's door coordinates on the fly in
  `getCoverage` — reuse that if you want hulls on the turf strip too.
- **Sub-area barrier avoidance** — there is no highway/rail/water linework
  anywhere in the product, so the boundary line a workspace holds is the honest
  proxy (see engine). A workspace holding no map at all cuts unbounded turfs.
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
