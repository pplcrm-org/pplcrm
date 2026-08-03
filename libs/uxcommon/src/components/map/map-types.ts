/**
 * Shared value types for the single Google Maps primitive, `<pc-map>`.
 *
 * These are the binding contract consumed by §6 (household card), §13
 * (canvassing turf polygons) and §14 (delivery routes / per-door dots). Keep
 * them free of any Google Maps SDK types so consumers and unit tests can build
 * marker/polygon inputs without loading the SDK.
 */

/** A plain latitude/longitude pair (never a `google.maps.LatLng`). */
export interface PcLatLng {
  lat: number;
  lng: number;
}

/**
 * Semantic colour bucket. Maps 1:1 to a DaisyUI `--color-*` token, resolved at
 * runtime so overlays stay correct across a light/dark theme flip. `muted`
 * resolves to `base-content` at reduced opacity.
 */
export type PcMapVariant = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'muted';

/** One point marker. `payload` is echoed back on `markerClicked`. */
export interface PcMapMarker<T = unknown> {
  position: PcLatLng;
  variant?: PcMapVariant;
  tooltip?: string;
  /** Short text drawn inside the pin (a stop number, 1–2 characters). Omit for a plain dot. */
  label?: string;
  id?: string;
  payload?: T;
}

/**
 * One open path (a delivery route's visit order). Deliberately separate from
 * `PcMapPolygon`: a route is a line, not an area, and it is drawn `dashed` by
 * default because our estimate is straight-line distance, not a road path — a
 * solid line would claim turn-by-turn accuracy we don't have.
 */
export interface PcMapPolyline<T = unknown> {
  path: PcLatLng[];
  variant?: PcMapVariant;
  /** `true` (the default for routes) renders a dotted line — an approximate order, not a road path. */
  dashed?: boolean;
  id?: string;
  payload?: T;
}

/** One filled polygon (a turf boundary). `payload` is echoed on `polygonClicked`. */
export interface PcMapPolygon<T = unknown> {
  path: PcLatLng[];
  variant?: PcMapVariant;
  label?: string;
  dashed?: boolean;
  id?: string;
  /**
   * Set `false` to keep this polygon view-only even in drawing mode: no vertex
   * handles, no dragging. A host uses this for a shape too detailed to reshape
   * on the map (thousands of handles, and a saved edit would exceed the server's
   * request-body limit). Defaults to editable. A polygon without an `id` is
   * always view-only regardless — an edit cannot be reported without an
   * identity, and handles whose edits go nowhere would be a lie.
   */
  editable?: boolean;
  payload?: T;
}

/**
 * One saved polygon whose shape was changed on the map — a vertex dragged, a
 * vertex added or removed, or the whole shape dragged. Emitted by `<pc-map>`'s
 * `polygonEdited` output.
 *
 * `path` is the new vertex ring in the same plain `PcLatLng[]` form
 * `PcMapPolygon.path` accepts, so an edited shape goes straight back into the
 * `polygons` input with no conversion, and straight into a GeoJSON coordinate
 * ring with no conversion either.
 */
export interface PcMapPolygonEdit {
  /** The `id` of the `PcMapPolygon` whose shape changed. */
  id: string;
  path: PcLatLng[];
}
