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

| Input         | Type               | Default         | Notes                                                                                                             |
| ------------- | ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `markers`     | `PcMapMarker[]`    | `[]`            | `{ position, variant?, tooltip?, label?, id?, payload? }` — `label` numbers the pin                               |
| `polygons`    | `PcMapPolygon[]`   | `[]`            | `{ path, variant?, label?, dashed?, id?, payload? }`                                                              |
| `polylines`   | `PcMapPolyline[]`  | `[]`            | `{ path, variant?, dashed?, id?, payload? }` — an open path; `dashed` defaults to `true`                          |
| `clusters`    | `PcMapCluster[]`   | `[]`            | `{ position, count, variant?, id?, payload? }` — counted groups instead of pins; see **Too many markers to draw** |
| `center`      | `PcLatLng \| null` | `null`          | Explicit centre; disables auto-fit                                                                                |
| `zoom`        | `number`           | `14`            | Used with `center`                                                                                                |
| `fitBounds`   | `boolean`          | `true`          | Auto-fit to content when no `center`                                                                              |
| `interactive` | `boolean`          | `true`          | `false` = fully static (§6 card)                                                                                  |
| `deepLink`    | `boolean`          | `false`         | Map/marker click opens the Google Maps app                                                                        |
| `mapId`       | `string`           | `'DEMO_MAP_ID'` | Cloud Map ID for dark tiles                                                                                       |
| `ariaLabel`   | `string`           | `'Map'`         | Placeholder/aria label                                                                                            |

Drawing inputs (see **Drawing mode** below):

| Input               | Type               | Default | Notes                                                                                        |
| ------------------- | ------------------ | ------- | -------------------------------------------------------------------------------------------- |
| `drawingEnabled`    | `boolean`          | `false` | On: map clicks place vertices and saved polygons become editable                             |
| `selectedPolygonId` | `string \| null`   | `null`  | The `PcMapPolygon.id` to highlight (heavier stroke, denser fill)                             |
| `userLocation`      | `PcLatLng \| null` | `null`  | The device's own position, drawn as a haloed info-coloured dot; never part of fit-to-content |

Outputs: `markerClicked: PcMapMarker`, `polygonClicked: PcMapPolygon` (each
carries its `payload` back), `clusterClicked: PcMapCluster`,
`viewportChanged: PcMapViewport`, plus the four drawing outputs below.

Methods: `focusOn(points: readonly PcLatLng[])` frames the map on the points a
host names, once. See **Framing the map** below.

## Too many markers to draw

A pin is a DOM node. A real campaign holds far more doors than a browser can
carry — an Ontario provincial candidate has 35,000+ households — so a host with
that many must not put them in `markers`.

Send counted groups in `clusters` instead: `{ position, count }`. The map draws
each as a disc whose **area** is proportional to its count (relative to the
largest group on screen) with the count written inside, abbreviated past a
thousand. Clicking one takes the map two zoom steps closer, which is how a
reader breaks a group apart and eventually gets individual pins back.

The pattern that goes with it:

1. Listen to `viewportChanged` and fetch only what is inside that rectangle.
2. Have the server return individual points when few enough are in view and
   counted groups when too many are.
3. Turn `fitBounds` **off** on that page and frame the map yourself (below).

Clusters take no part in fit-to-content, because they are a consequence of the
current view rather than a description of the host's data.

## Framing the map

Two ways, and a page uses one or the other, never both:

- **`fitBounds` (default `true`)** — the map re-frames itself on its content
  every time that content changes. Right for a page whose content does not
  depend on where the map is looking: one household, one turf, one route.
- **`focusOn(points)` with `fitBounds` off** — the host decides when the map
  moves and what it frames. Required for any page that listens to
  `viewportChanged`: auto-fit would move the map, the move would be reported,
  the report would fetch new content, and the new content would move it again.

`focusOn` is remembered, so a host may call it before the SDK has finished
loading; the frame is applied when the map appears. Called with a single point
(or several at one spot) it centres at zoom 16 rather than fitting, which would
otherwise zoom to a roof.

## Drawing mode

`drawingEnabled` is `false` by default, so an existing `<pc-map>` behaves
exactly as it did before drawing existed. Turned on:

- A click on the map places a vertex of the shape in progress. A vertex that
  lands within **`VERTEX_SNAP_TOLERANCE_PX = 12`** screen pixels of a vertex
  already on the map snaps onto it exactly — that is how two neighbouring areas
  come to share an edge instead of leaving slivers. The constant is exported
  from `map.ts`; `snapToleranceInDegrees(zoom)` converts it to degrees of
  longitude, and the comparison corrects for the Mercator 1/cos(latitude)
  stretch so the tolerance stays honest at Canadian latitudes.
- Clicking the first vertex again — or calling `finishDrawing()` — closes the
  ring and emits `polygonDrawn`. A shape needs **at least three** vertices.
- Saved polygons become `editable` and `draggable`, so their vertices can be
  moved; every shape change emits `polygonEdited`. Shapes above the component's
  vertex threshold stay view-only in edit mode, with a note explaining why.
- Clicking a saved polygon emits `polygonSelected` with its `id` (and, as
  always, `polygonClicked` with the whole polygon).
- Right-clicking the **body** of a saved polygon emits `polygonDeleted` with its
  `id`. Right-clicking one of its **vertices** removes that vertex — the
  component implements the gesture itself, because Google provides no
  remove-a-vertex gesture of its own.
- **Escape** cancels the trace in progress; **Enter** finishes a closable one
  (three or more vertices).

Drawing outputs:

| Output            | Payload               | Fires when                                             |
| ----------------- | --------------------- | ------------------------------------------------------ |
| `polygonDrawn`    | `PcLatLng[]`          | A new ring is closed (the ring is not repeated at end) |
| `polygonEdited`   | `PcMapPolygonEdit`    | A saved polygon's shape changed: `{ id, path }`        |
| `polygonDeleted`  | `string` (polygon id) | Right-click on a saved polygon's body                  |
| `polygonSelected` | `string` (polygon id) | A saved polygon was clicked                            |

Every drawing payload is plain `PcLatLng` values and string ids — never a Google
SDK object — so a host can hold and post the result without loading the SDK.

Public methods and signals a host drives the toolbar with:

| Member               | Kind                | What it does                                            |
| -------------------- | ------------------- | ------------------------------------------------------- |
| `finishDrawing()`    | method              | Closes and emits the shape; no-op under three vertices  |
| `cancelDrawing()`    | method              | Discards the shape in progress, emitting nothing        |
| `undoLastVertex()`   | method              | Removes the most recently placed vertex                 |
| `draftVertexCount()` | `computed<number>`  | Vertices placed so far; `0` when nothing is in progress |
| `canFinishDrawing()` | `computed<boolean>` | True once the shape has at least three vertices         |

Turning `drawingEnabled` off discards whatever was half-traced.

### Two things that will otherwise be got wrong

**There is no `DrawingManager`.** Google removed it: `@types/google.maps`
(pinned at Maps JS API **3.65**) marks `google.maps.drawing.DrawingManager`
`@deprecated` with "The DrawingManager functionality in the Maps JavaScript API
is no longer available in the Maps JavaScript API as of version 3.65." That is
why `<pc-map>` places vertices from raw map `click` events itself, keeps the
ring in a `draft` signal, and draws the shape in progress as a `Polyline` plus
one `AdvancedMarkerElement` per vertex. Do not "simplify" this back onto the
drawing library — it is gone.

**`<pc-map>` renders no drawing toolbar.** The component draws only the map
surface and the shape in progress. The finish, undo and cancel controls are the
**host page's** job: call `finishDrawing()` / `undoLastVertex()` /
`cancelDrawing()` on a `viewChild(PcMap)` and gate the buttons on
`canFinishDrawing()` and `draftVertexCount()`. The live example is the boundary
map editor (`apps/frontend/src/app/experiences/settings/boundaries/`).

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
