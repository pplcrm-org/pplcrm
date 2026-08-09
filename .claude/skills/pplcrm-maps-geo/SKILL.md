---
name: pplcrm-maps-geo
description: Maps and geocoding — the single `<pc-map>` Google Maps primitive (placeholder-safe, and the only thing that draws boundaries), the household geocoding transactional-outbox job, the `geocode_cache` memo, the boundary-set/feature/household_districts tables and the point-in-polygon matcher, and the geocode-status chip contract. USE WHEN adding a map to any page (household card, canvassing turfs, delivery routes), drawing or uploading boundaries, reading a household's electoral areas, surfacing geocode status, wiring a geocoding/boundary background job, or configuring the Google Maps API key. EXAMPLES: 'draw turf polygons on a map', 'why is my map a grey placeholder in tests', 'what does geocoding_status mean', 'which district is this household in'.
---

# Maps & geocoding (§6 / §13 / §14)

**§13 maps ruling: Google Maps Platform only — no mixed providers.** Maps
JavaScript SDK for coverage/turf maps, Places Autocomplete for addresses,
Geocoding for the voter file, and the maps deep-link for door/route navigation.

## The one map primitive — `<pc-map>`

`@uxcommon/components/map/map` (exported from the `@uxcommon` barrel). Full
binding contract in `docs/spec/pc-map-usage.md`. Do **not** hand-roll a
`new google.maps.Map(...)` in a component — use `<pc-map>`.

- Inputs: `markers`, `polygons`, `polylines`, `center`, `zoom`, `fitBounds`,
  `interactive`, `deepLink`, `mapId`, `ariaLabel`, `userLocation`. Value types
  (`PcMapMarker`, `PcMapPolygon`, `PcMapPolyline`, `PcLatLng`, `PcMapVariant`)
  come from `@uxcommon/components/map/map-types` and carry **no** Google SDK
  types, so you can build inputs in a plain `computed()`.
- `userLocation` (`PcLatLng | null`) draws the device's own position as a haloed
  info-coloured dot. It is deliberately not a marker: it never joins
  fit-to-content (the map frames the work, not the walker) and a moving fix
  redraws only the dot. Feed it from the companion's `GeoPosition` service,
  which asks for location **only on an explicit tap** — never wire it to an
  automatic request.
- A marker's optional `label` (1–2 chars) draws inside the pin — that's how a
  delivery route numbers its stops. `polylines` are **open paths** and default to
  `dashed: true`: a route line shows the visit order we computed, not a road path
  we didn't. Don't switch one to solid to make it look tidier.
- Outputs: `markerClicked`, `polygonClicked` — each echoes the item's `payload`.
- Give it a height (`class="block h-48"`); it has a `min-h-40` floor.
- Marker/polygon colours resolve from DaisyUI `--color-*` tokens at runtime and
  redraw on a light/dark theme flip. Pass a semantic `variant`, never a hex.

### Drawing mode — the same component, off by default

Two more inputs: `drawingEnabled` (default `false`) and `selectedPolygonId`
(default `null`, highlights that polygon id with a heavier stroke and denser
fill). With `drawingEnabled` on:

- A map click places a vertex. A vertex landing within
  `VERTEX_SNAP_TOLERANCE_PX = 12` **screen** pixels of a vertex already on the
  map snaps onto it exactly — that is how two neighbouring areas share an edge
  instead of leaving slivers. `snapToleranceInDegrees(zoom)` converts pixels to
  degrees, and the distance test corrects for the Mercator 1/cos(latitude)
  stretch, so the tolerance is not far too generous north–south in Canada.
- Clicking the first vertex again — or `finishDrawing()` — closes the ring
  (minimum three vertices) and emits `polygonDrawn: PcLatLng[]`.
- Saved polygons become editable/draggable; each shape change emits
  `polygonEdited: { id, path }`. Clicking one emits `polygonSelected: string`.
  Right-clicking a polygon's **body** emits `polygonDeleted: string`;
  right-clicking a **vertex** of an editable saved shape removes that vertex —
  the component implements the gesture itself (Google provides no
  remove-a-vertex gesture). Shapes above the component's vertex threshold stay
  view-only in edit mode, with a note explaining why. Escape cancels an
  in-progress trace; Enter finishes a closable one (three or more vertices).
- Public methods `finishDrawing()`, `cancelDrawing()`, `undoLastVertex()` and
  the signals `draftVertexCount()` / `canFinishDrawing()` are how a host page
  drives its toolbar.

Every drawing payload is plain `PcLatLng` values and string ids — no Google SDK
object ever leaves the component.

**There is no `DrawingManager`.** Google removed it: `@types/google.maps`
(pinned at Maps JS API **3.65**) marks `google.maps.drawing.DrawingManager`
`@deprecated` — "no longer available in the Maps JavaScript API as of version
3.65". `<pc-map>` therefore places vertices from raw map `click` events itself
and renders the shape in progress as a `Polyline` plus one marker per vertex.
Do not "simplify" it back onto the drawing library; it is gone.

**`<pc-map>` renders no drawing toolbar of its own** — deliberately. The finish,
undo and cancel controls belong to the host page, which calls the methods above
on a `viewChild(PcMap)`. Live example: the boundary map editor,
`apps/frontend/src/app/experiences/settings/boundaries/`.

### Why it never breaks tests

`<pc-map>` injects the `Loader` **optionally** (`inject(Loader, { optional: true })`).
The `Loader` is provided once in `apps/frontend/src/app/app.config.ts` with
`environment.googleMapsApiKey` (`VITE_GOOGLE_MAPS_API_KEY`).

- Real browser + key → lazy-loads `maps` + `marker` and draws.
- No `Loader` (unit tests) / offline / bad key / a partial SDK → renders a
  deterministic **placeholder** (pin + count/label), never touches the network,
  never throws. `buildMap` is wrapped so any SDK error falls back to the
  placeholder. Component tests provide **no** `Loader` and assert `[role="img"]`
  (see `map.spec.ts`). Degrade honestly — never fake a pin.

## Geocode-status chip — the binding contract

`households.geocoding_status` is `'pending' | 'success' | 'failed' | 'skipped' | null`.
Surface it with `<pc-geocode-chip [status]="...">`
(`@uxcommon/components/geocode-chip/geocode-chip`) or the pure `geocodeChipSpec()`
helper — **never invent your own labels**, and never hide the row:

| DB status        | Chip label          | Tone (semantic)      |
| ---------------- | ------------------- | -------------------- |
| `success`        | **Located**         | success (done)       |
| `pending` / null | **Locating…**       | info (in progress)   |
| `failed`         | **Address problem** | warning (attention)  |
| `skipped`        | **Not geocoded**    | neutral (plan-gated) |

Canvassing readiness and delivery coverage read these same states.

**`skipped` = plan-gated, not broken.** Real (paid) geocoding is Movement-only
(cost control): households on lower tiers are never sent to the Google Geocoding
API — the enqueue helper marks them `skipped`. Mock/test/no-key geocoding is free
and stays ungated (demo/dev/CI still get pins). The gate + per-tenant daily budget
(`GEOCODE_DAILY_BUDGET`, spreads big imports over days) live in the ONE enqueue
helper `apps/backend/src/app/lib/gis/geocode-queue.ts` — both `HouseholdRepo.addMany`
and the single-address update path call it. The plan check is `planAllowsGeocoding`
(`@common`, min plan `GEOCODING_MIN_PLAN = 'movement'`).

## Geocoding runs as a transactional-outbox job

A household address change enqueues `geocode_household` **inside the write's
transaction** (see `households/controller.ts` + `households.repo.ts`). The worker
handler `handleGeocodeHousehold` calls `geocodeAndMapHousehold`
(`apps/backend/src/app/lib/gis/geocoding.ts`), which:

1. Skips + marks `failed` if the address is blank/incomplete.
2. Resolves coordinates through `geocodeAddressCached` (`lib/gis/geocode-cache.ts`),
   which answers from `geocode_cache` when this tenant looked the same address
   fingerprint up before and otherwise calls `geocodeAddress`
   (`lib/gis/geocode-address.ts`) — **unless** `isMockOrTestGeocode()`
   (`!apiKey || apiKey.includes('mock') || NODE_ENV==='test'`), which returns
   deterministic dev coordinates, skips the cache and never touches the network.
   `null` (ZERO_RESULTS) marks the household `failed`; a transient error
   re-throws so the worker retries.
3. Sets lat/lng, `formatted_address`, `type` and `geocoding_status = 'success'`.
4. Calls `matchHouseholdBoundaries` (`lib/gis/boundary-match.ts`) to write one
   `household_districts` row per required boundary layer — point-in-polygon in
   this process, no external service.

Marking a household `failed` also clears its `household_districts` rows, because
they were derived from coordinates now known to be wrong or unobtainable.

### The cost split — memorise this before touching either half

**Geocoding costs money; boundary matching is free.** Geocoding is billed per
Google request, so it is plan-gated, metered per tenant per day, and memoised by
address. Matching a coordinate to polygons is pure CPU in this process, so it
may be re-run as often as anyone likes — every time a map is drawn, redrawn,
uploaded or deleted. Do not add a gate or a budget to matching, and do not
bypass the cache/queue on the geocoding side.

`geocode_cache` (per tenant, keyed on the `households.address_fp_full` address
fingerprint) caches **`zero_results` as well as `success`** — a permanent "no
such address" is worth as much as a positive answer, otherwise every typo is
billable forever. It deliberately has **no foreign key to households**: it must
survive household deletion, which is what stops import → delete → re-import from
buying the same lookups twice. It is per tenant, not global, because a shared
cache would disclose that another workspace holds a given address.

**Company enrichment** (`enrich_company_google`) follows the identical pattern
(`companies/services/companies-enrichment.service.ts`) — a Places text search +
details lookup that fills website/phone/industry/description **only where blank**.
The user-facing **Enrich / Re-check Google** button
(`companies.enrich` tRPC mutation → `queueEnrichment`) passes `force: true` to
re-run even when already enriched; the first-load auto-queue does not.

## Electoral geography — `boundary_sets` / `boundary_features` / `household_districts`

`households.district`, `households.precinct` and `households.ward` **no longer
exist** (dropped in `2026-08-02-e-drop-legacy-geography.ts`, along with
`turfs.ward`). Three text columns could hold three answers, but one US address
is simultaneously in a congressional district, both state legislative districts,
a council district and a precinct — so each pass overwrote the last.

| Table                 | Holds                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `boundary_sets`       | One named, versioned map layer. `role` ∈ `seat_area` / `subdivision` / `locality` is **the only place meaning lives**         |
| `boundary_features`   | One row per named area of an editable set: `geometry` (GeoJSON Polygon/MultiPolygon) + `bbox` `[minLng,minLat,maxLng,maxLat]` |
| `household_districts` | One row per household per layer — `UNIQUE (household_id, set_id)`                                                             |

**Grid columns: one per map.** The people and household grids show one area
column per boundary map the workspace holds — the campaign's own map first,
headed with the campaign's word for its areas (`electoral_area`), then one
column per other map, headed with that map's own `label` and carrying the field
name `area_set_<boundary set id>`. Built by `listAreaSetColumns` /
`areaSetLateralSelects` / `areaSetOuterSelects` / `areaSetRefs` in
`modules/households/electoral-areas.ts`, selected by both `persons.repo.ts` and
`households.repo.ts`, and served to the browser by the `boundaries.areaColumns`
tRPC query (frontend: `services/area-columns.service.ts`). Seat-area maps are
visible by default and subdivision/locality maps start hidden — decided by
`role`, never by the map's name. The CSV export already did the same thing
(`electoralExportColumns`), and the two must keep agreeing.

The unique key is `(household_id, set_id)` and **not** `(household_id, level)`
or `(…, kind)` on purpose: a Massachusetts household is genuinely in a ward and
a precinct (both subdivisions of the same city), and a redistricting year needs
the outgoing and incoming maps on the same household on the same day. Never
infer meaning from a layer's **name** — an Ontario "ward" is a seat area, a
Massachusetts "ward" is not. Read `boundary_sets.role`.

**Four ways a workspace gets a map, and all four work.** A CSV import that
already carries district columns (`source = 'import'` — those sets hold no
polygons and are skipped by the matcher), an uploaded GeoJSON (`'upload'`),
polygons drawn on the map (`'drawn'`), or a map picked from the published
catalog (`'bundled'`).

**The published catalog holds six maps as of 2026-08-06** (built and checksummed
by `npm run boundary-catalog -- build`): Canadian federal ridings, Ontario and
Alberta provincial ridings, and US congressional, state senate and state house
districts. **Municipal wards and precincts are deliberately absent** — there is
no common publisher or format, and a single state's precinct file exceeds the
5,000-areas-per-set cap. So the product knows a user's riding or legislative
district out of the box, and does **not** know their city council ward. Say
exactly that and no more.

Adding a jurisdiction means a person reads the publisher's licence, then runs
the build and upload commands; the entry file is generated, never hand-edited.
Whenever `PUBLISHED_BOUNDARY_ENTRIES` gains or loses a jurisdiction, the site
and help copy listing the covered jurisdictions changes in the same commit —
see the boundary row in `pplcrm-website-claims` for the exact locations.

### The published catalog (`libs/common/src/lib/boundaries/catalog/`)

| File                 | What it is                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `catalog.types.ts`   | `PublishedBoundaryEntry` — slug, office, vintage, publisher, licence, counts, `sha256`    |
| `catalog.entries.ts` | **Generated.** Written by `npm run boundary-catalog -- build`. Never hand-edit            |
| `index.ts`           | `findPublishedBoundary`, `publishedBoundariesFor(Offices)`, `publishedBoundaryStorageKey` |

Four rules that are load-bearing rather than stylistic:

- **A catalog entry is immutable, and a file is never rewritten in place.** A
  redistricting is a NEW slug with a new `vintage`; the old entry gets
  `supersededBy`. A workspace keeps the edition it added, because a campaign
  fighting an election under the old lines needs the old lines.
- **The bytes are checked against the entry's `sha256` before they are parsed.**
  A file that does not match what the catalog describes is refused.
- **Published features are cached by CATALOG SLUG, not by set id.** Every
  workspace holding the same map shares one parsed, frozen copy. Keyed by set id
  a dozen workspaces would exhaust the whole cache budget with one national map.
- **A layer whose file cannot be read is OMITTED from `loadBoundarySets`, not
  returned empty**, and callers scope `applyHouseholdMatchesBatch` to the layers
  they actually got back. "We could not open that map" must never be stored as
  "that map places this household nowhere" — that would erase every household's
  riding because of one failed download.

Files are looked for in `GIS_BOUNDARY_DATA_DIR`, then `gis-boundaries/` beside
the bundle, then `boundary-data/` beside the source, then blob storage under the
reserved `catalog/boundaries/` prefix. The last step is what lets the catalog
cover every province and state without any of it being in the container image.

Maintainer tooling is `scripts/boundary-catalog.ts` (`npm run boundary-catalog --
build | validate | upload`) with its input in `scripts/boundary-catalog-sources.ts`.
It refuses any source whose `licenceVerified` is false.

### The functions in `apps/backend/src/app/lib/gis/`

| File                  | What to call                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boundary-match.ts`   | `requiredSetIdsForTenant`, `matchHouseholdBoundaries` (one household, already geocoded), `matchPointToSets` / `matchPointToLoadedSets`, `applyHouseholdMatches(Batch)`, `countContainingFeatures`, `asCoordinate` |
| `boundary-store.ts`   | `loadBoundarySets` (batched, process-cached, version-checked), `featureContainsPoint` (bbox reject, then ray cast), `invalidateBoundarySetCache`                                                                  |
| `point-in-polygon.ts` | `isPointInPolygon`, `isPointInMultiPolygon` — pure ray casting, holes honoured                                                                                                                                    |
| `boundary-jobs.ts`    | `enqueueBoundaryMatch`, `enqueueBoundaryMatchContinuation`, `runningBoundaryMatchCount`, `BOUNDARY_MATCH_BATCH_SIZE`                                                                                              |
| `geocode-cache.ts`    | `geocodeAddressCached`, `lookupGeocodeCache`, `rememberGeocode`                                                                                                                                                   |

Batch vs single matters: `matchPointToSets` reloads the layers on every call
(right for one household saved in the UI, wrong for thousands). A sweep calls
`loadBoundarySets` once and `matchPointToLoadedSets` per point.

`requiredSetIdsForTenant` derives the layers to match from the workspace's
**active campaigns** (jurisdiction + region + chamber must agree), **plus** every
layer the workspace made itself (uploaded or drawn), always — otherwise drawing
a map would appear to do nothing until a campaign was configured.

Overlapping hand-drawn areas are resolved by a fixed sort (name, then code, by
code point — not `localeCompare`, whose collation varies by Node/ICU build) so
the same household never flips between two areas between runs; overlaps are
reported through validation counts instead of being resolved silently.

Two background jobs (`lib/jobs/handlers/boundaries.handlers.ts`):
`match_boundaries` (enqueued inside the transaction of any boundary write;
`scope: 'all' | 'unmatched'`, keyset `cursor`, re-queues itself per batch) and
the nightly `sweep_unmatched_boundaries`.

### Gone — do not reach for these

`apps/backend/src/app/lib/gis/boundaries.geojson` (three rectangles over
downtown Chicago labelled "Ward 1/2/3") is **deleted**, and with it
`loadBoundaries()` and `matchCoordinatesToDistrict()` from `geocoding.ts`. It
never worked: any address outside those boxes resolved to nulls, it was never
copied into a deployed build, and the loader resolved a source-tree path from
the process working directory. `isPointInPolygon` / `isPointInMultiPolygon`
moved to `point-in-polygon.ts` and are re-exported from `geocoding.ts`.

## Adding a new geo/Google background job

Same rules as `pplcrm-trpc-backend`'s outbox section: add the payload to the
discriminated union in `lib/jobs/job-payloads.ts`, a handler, wire it in
`lib/jobs/job-handlers.ts`, and insert the job row inside the triggering
transaction. Always gate real API calls behind the `isMockOrTest` check so tests
and un-keyed environments never hit the network.

## Config

`GOOGLE_MAPS_API_KEY` (backend `env.ts`, falls back to `VITE_GOOGLE_MAPS_API_KEY`)
and `VITE_GOOGLE_MAPS_API_KEY` (frontend `environment.ts`). No key configured →
addresses still save, the geocode job marks dev coordinates or the status chip
says it will geocode once configured, and `<pc-map>` shows its placeholder.
Never crash on a missing key.
