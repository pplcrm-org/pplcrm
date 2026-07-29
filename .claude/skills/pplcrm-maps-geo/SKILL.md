---
name: pplcrm-maps-geo
description: How pplCRM does maps and geocoding — the single `<pc-map>` Google Maps primitive (placeholder-safe), the household geocoding transactional-outbox job, the ward/district/precinct GIS match, and the binding geocode-status chip contract (Located / Locating… / Address problem). USE WHEN adding a map to any page (household card, canvassing turfs, delivery routes), reading geocoded lat/lng or ward data, surfacing geocode status, wiring a geocoding/enrichment background job, or configuring the Google Maps API key. EXAMPLES: 'draw turf polygons on a map', 'show a household's pin', 'why is my map a grey placeholder in tests', 'add a background job that calls a Google API', 'what does geocoding_status mean'.
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
  `interactive`, `deepLink`, `mapId`, `ariaLabel`. Value types (`PcMapMarker`,
  `PcMapPolygon`, `PcMapPolyline`, `PcLatLng`, `PcMapVariant`) come from
  `@uxcommon/components/map/map-types` and carry **no** Google SDK types, so you
  can build inputs in a plain `computed()`.
- A marker's optional `label` (1–2 chars) draws inside the pin — that's how a
  delivery route numbers its stops. `polylines` are **open paths** and default to
  `dashed: true`: a route line shows the visit order we computed, not a road path
  we didn't. Don't switch one to solid to make it look tidier.
- Outputs: `markerClicked`, `polygonClicked` — each echoes the item's `payload`.
- Give it a height (`class="block h-48"`); it has a `min-h-40` floor.
- Marker/polygon colours resolve from DaisyUI `--color-*` tokens at runtime and
  redraw on a light/dark theme flip. Pass a semantic `variant`, never a hex.

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

Wave 2 (canvassing readiness, delivery coverage) reads these same states.

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
2. Calls the Google Geocoding API for lat/lng + formatted_address — **unless**
   `isMockOrTest` (`!apiKey || apiKey.includes('mock') || NODE_ENV==='test'`),
   in which case it fills deterministic dev coordinates. This is the honest
   degrade path; real API calls are gated behind a configured key.
3. Matches lat/lng against `lib/gis/boundaries.geojson` to fill
   `ward` / `district` / `precinct` (point-in-polygon, no external service).
4. Sets `geocoding_status = 'success'`.

**Company enrichment** (`enrich_company_google`) follows the identical pattern
(`companies/services/companies-enrichment.service.ts`) — a Places text search +
details lookup that fills website/phone/industry/description **only where blank**.
The user-facing **Enrich / Re-check Google** button
(`companies.enrich` tRPC mutation → `queueEnrichment`) passes `force: true` to
re-run even when already enriched; the first-load auto-queue does not.

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
