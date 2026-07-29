# `<pc-map>` — usage

The single Google Maps primitive for the app (§13 maps ruling: Google Maps
Platform only — **no mixed providers**, §22.10). Lives in `libs/uxcommon`
(`@uxcommon/components/map/map`), exported from the `@uxcommon` barrel.

## How it loads (and why it never breaks tests)

`<pc-map>` injects the `@googlemaps/js-api-loader` `Loader` **optionally**. The
loader is provided once in `apps/frontend/src/app/app.config.ts` with the key
from `environment.googleMapsApiKey` (`VITE_GOOGLE_MAPS_API_KEY`).

- **Real browser + key** → lazy-loads the `maps` + `marker` libraries and draws.
- **No `Loader` (unit tests) / offline / bad key** → renders a deterministic
  **placeholder** surface (a pin icon + a count/label) and never hits the
  network. This mirrors the geocoding mock's degrade-don't-crash approach.

So component tests provide **no** `Loader` and assert the placeholder — see
`map.spec.ts`.

## Theming & motion

- Marker/polygon colours come from **DaisyUI semantic tokens** (`--color-*`)
  resolved at runtime — never a hardcoded hue. `variant` maps 1:1 to a token
  (`primary`, `success`, `warning`, `error`, `info`, `neutral`, …); `muted`
  resolves to `base-content` at reduced opacity.
- A `MutationObserver` on `<html data-theme>` redraws overlays on a light/dark
  flip, so colours stay correct after a theme toggle.
- Map **tiles**: styled via a cloud-based **Map ID** (`[mapId]`). Default is
  Google's `DEMO_MAP_ID`; supply a production Map ID configured for a dark style
  in the Google Cloud console so the tiles don't clash with the dark UI. (Marker
  and polygon colours already adapt; only the base tiles need the Map ID.)
- **Wheel-zoom is off** (`scrollwheel: false`, §13.3) so the page keeps
  scrolling; drag-to-pan stays on when `interactive`.

## API (the binding contract for T3.2, T4.2, T4.5, T4.6)

Inputs:

| Input         | Type               | Default         | Notes                                                                                    |
| ------------- | ------------------ | --------------- | ---------------------------------------------------------------------------------------- |
| `markers`     | `PcMapMarker[]`    | `[]`            | `{ position, variant?, tooltip?, label?, id?, payload? }` — `label` numbers the pin      |
| `polygons`    | `PcMapPolygon[]`   | `[]`            | `{ path, variant?, label?, dashed?, id?, payload? }`                                     |
| `polylines`   | `PcMapPolyline[]`  | `[]`            | `{ path, variant?, dashed?, id?, payload? }` — an open path; `dashed` defaults to `true` |
| `center`      | `PcLatLng \| null` | `null`          | Explicit centre; disables auto-fit                                                       |
| `zoom`        | `number`           | `14`            | Used with `center`                                                                       |
| `fitBounds`   | `boolean`          | `true`          | Auto-fit to content when no `center`                                                     |
| `interactive` | `boolean`          | `true`          | `false` = fully static (§6 card)                                                         |
| `deepLink`    | `boolean`          | `false`         | Map/marker click opens the Google Maps app                                               |
| `mapId`       | `string`           | `'DEMO_MAP_ID'` | Cloud Map ID for dark tiles                                                              |
| `ariaLabel`   | `string`           | `'Map'`         | Placeholder/aria label                                                                   |

Outputs: `markerClicked: PcMapMarker`, `polygonClicked: PcMapPolygon` (each
carries its `payload` back).

## Consumption patterns

### 1. Household static card (§6)

One marker; static; clicking opens the maps app.

```html
<pc-map
  class="block h-48"
  [markers]="[{ position: { lat: household.lat, lng: household.lng } }]"
  [interactive]="false"
  [deepLink]="true"
  ariaLabel="Household location"
/>
```

Replaces the ad-hoc `initMap` currently inline in `household-view.ts` (T3.2
swaps it in).

### 2. Turf polygons (§13)

Polygons tinted by turf status; auto-fit; click to select.

```html
<pc-map class="block h-80" [polygons]="turfs()" (polygonClicked)="selectTurf($event.payload)" />
```

```ts
turfs = computed<PcMapPolygon<Turf>[]>(() =>
  this.data().map((t) => ({
    path: t.boundary,
    variant: t.status === 'in_field' ? 'success' : 'neutral',
    label: t.name,
    payload: t,
  })),
);
```

### 3. Per-door dots + dashed boundary (§13.3 / §14)

Many markers coloured by knock outcome, dashed turf outline.

```html
<pc-map
  class="block h-96"
  [markers]="doors()"
  [polygons]="[{ path: turf.boundary, variant: 'neutral', dashed: true }]"
  (markerClicked)="openDoor($event.payload)"
/>
```

```ts
// Conversation = success, knocked/no-answer = primary, not-yet = muted
doors = computed<PcMapMarker<Door>[]>(() =>
  this.doorData().map((d) => ({
    position: d.coords,
    variant: d.outcome === 'conversation' ? 'success' : d.knocked ? 'primary' : 'muted',
    tooltip: d.address,
    payload: d,
  })),
);
```

### 4. A delivery route: numbered pins + the visit order (§14)

Start pin, one numbered pin per stop tinted by its status, and the order as a
**dotted** polyline. Dotted on purpose: `planRoutes` measures straight-line
distance × a winding factor, so a solid line would claim a road path we never
computed. Pair it with an "Open in Google Maps" button for real turn-by-turn
(live: `deliveries-route-detail.html`).

```html
<pc-map
  class="block h-72 w-full overflow-hidden rounded-lg"
  [markers]="mapMarkers()"
  [polylines]="mapRoute()"
  ariaLabel="Delivery route map"
/>
```

```ts
// One dotted path: start address first, then the located stops in seq order.
mapRoute = computed<PcMapPolyline[]>(() => [{ path: [start, ...locatedStops], variant: 'primary', dashed: true }]);
```

Stops the geocoder hasn't located can't be drawn — **say how many are missing**
rather than silently shortening the route (design §2).

> **Sizing:** `<pc-map>` fills its host; give it a height (`class="block h-48"`,
> a grid cell, or a wrapper with a set height). It has a `min-h-40` floor.
