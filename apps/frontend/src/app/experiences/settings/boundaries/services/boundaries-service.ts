import { Service, inject } from '@angular/core';
import type {
  AddBoundaryFeatureType,
  AddDrawnBoundarySetType,
  BoundaryFeatureListType,
  BoundaryFeatureRowType,
  BoundaryHouseholdClusterType,
  BoundarySetRowType,
  BoundaryViewportType,
  BoundaryValidationType,
  UpdateBoundaryFeatureType,
  UploadBoundarySetType,
} from '@common';

import { FilesService } from '../../../files/services/files.service';
import { TRPCService } from '../../../../services/api/trpc-service';

/**
 * The GeoJSON upload is registered under this type rather than whatever the browser guessed.
 *
 * Browsers report no type at all for a `.geojson` file and, on some platforms, `application/geo+json`,
 * which the file module's allow-list does not carry. `application/json` is both true of the bytes and
 * accepted, so declaring it is what keeps a correctly-named file from being refused for its extension.
 */
const GEOJSON_UPLOAD_MIME = 'application/json';

/** One household with coordinates, thinned down to what a map pin needs. */
export interface BoundaryHouseholdPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
}

/**
 * What the map should draw for the rectangle it is showing, and the numbers that describe it.
 *
 * `pins` and `clusters` are alternatives, never both: the server sends individual doors when few
 * enough are in view and counted groups when too many are. See `BoundaryHouseholdPinsObj`.
 */
export interface BoundaryHouseholdPins {
  pins: BoundaryHouseholdPin[];
  clusters: BoundaryHouseholdClusterType[];
  /** Every household with coordinates in the workspace, drawn or not. */
  totalLocated: number;
  /** Located households inside the rectangle asked for. */
  inView: number;
  /** The extent of every located household — what "fit the map to everything" frames. */
  bounds: BoundaryViewportType | null;
}

/**
 * Boundary maps: the sets a workspace holds, the areas inside one, and the free re-match.
 *
 * Nothing this service calls costs money. Drawing, uploading, reshaping and re-matching re-read
 * coordinates already stored on the household and run a point-in-polygon test on the server; the
 * paid step is geocoding, which turns an address into coordinates and happens elsewhere. The page
 * says so out loud, and this comment is here so the next person does not add a plan gate to a free
 * operation.
 */
@Service()
export class BoundariesService extends TRPCService<BoundarySetRowType> {
  private readonly files = inject(FilesService);

  public listSets(): Promise<BoundarySetRowType[]> {
    return this.api.boundaries.list.query(undefined, { signal: this.ac.signal });
  }

  /**
   * The areas of one layer, plus how many the layer really has.
   *
   * The server stops sending outlines once the payload reaches its byte budget, which a drawn or
   * uploaded ward map never reaches and a published national map can. `total` is what a caption must
   * quote as the layer's size; `truncated` says whether the map on screen is all of it.
   */
  public listFeatures(setId: string): Promise<BoundaryFeatureListType> {
    return this.api.boundaries.features.query({ setId }, { signal: this.ac.signal });
  }

  public createDrawnSet(input: AddDrawnBoundarySetType): Promise<BoundarySetRowType> {
    return this.api.boundaries.createDrawn.mutate(input);
  }

  /** Add a map from the published catalog. One slug in — everything else comes from the catalog. */
  public addPublishedSet(catalogSlug: string): Promise<BoundarySetRowType> {
    return this.api.boundaries.addPublished.mutate({ catalog_slug: catalogSlug });
  }

  public uploadSet(input: UploadBoundarySetType): Promise<BoundarySetRowType> {
    return this.api.boundaries.upload.mutate(input);
  }

  public deleteSet(setId: string): Promise<boolean> {
    return this.api.boundaries.deleteSet.mutate({ setId });
  }

  public addFeature(input: AddBoundaryFeatureType): Promise<BoundaryFeatureRowType> {
    return this.api.boundaries.addFeature.mutate(input);
  }

  public updateFeature(id: string, data: UpdateBoundaryFeatureType): Promise<BoundaryFeatureRowType> {
    return this.api.boundaries.updateFeature.mutate({ id, data });
  }

  public deleteFeature(id: string): Promise<boolean> {
    return this.api.boundaries.deleteFeature.mutate({ id });
  }

  /** Queue a re-match. Free to press: duplicate pending jobs are coalesced server-side. */
  public rematch(setId: string | null): Promise<{ queued: true }> {
    return this.api.boundaries.rematch.mutate({ setId });
  }

  /** How many households this map places nowhere, and how many it places in two areas at once. */
  public validate(setId: string): Promise<BoundaryValidationType> {
    return this.api.boundaries.validate.query({ setId }, { signal: this.ac.signal });
  }

  /**
   * What the drawing map should show for one rectangle of the world.
   *
   * This is the point of drawing in the app rather than in external mapping software: the areas are
   * traced around the doors the workspace actually holds. Households without coordinates are left
   * out because there is nowhere honest to put them, not because they do not matter.
   *
   * The answer is scoped to the rectangle because the number of doors a real campaign holds is far
   * larger than a browser can draw — thirty-five thousand households for an Ontario provincial
   * candidate. Inside the rectangle, few enough doors come back as individual pins and too many come
   * back as counted groups; zooming in is what turns groups back into doors. Pass no rectangle on
   * the first load, before the map has framed itself.
   *
   * Matching runs over every household regardless of what is drawn.
   */
  public async listHouseholdPins(viewport?: BoundaryViewportType | null): Promise<BoundaryHouseholdPins> {
    const result = await this.api.boundaries.householdPins.query(
      { viewport: viewport ?? null },
      { signal: this.ac.signal },
    );
    return {
      pins: result.pins.map((row) => ({ id: row.id, lat: row.lat, lng: row.lng, label: householdLabel(row) })),
      clusters: result.clusters,
      totalLocated: result.total_geocoded,
      inView: result.in_view,
      bounds: result.bounds,
    };
  }

  /**
   * Put the original file in blob storage and return its `files` row id.
   *
   * The bytes never travel through a tRPC request: the server-wide body limit is 1 MiB and a
   * boundary file may be up to 20 MB. Keeping the original also means a map that parsed wrongly can
   * be re-read from the source rather than re-downloaded from the publisher.
   */
  public async uploadOriginalFile(file: File): Promise<string> {
    const { uploadUrl, uploadHandle } = await this.files.getUploadUrl(file.name, GEOJSON_UPLOAD_MIME);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': GEOJSON_UPLOAD_MIME },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Storing the file failed with status ${response.status}. Try the upload again.`);
    }

    const registered: unknown = await this.files.registerFile({
      filename: file.name,
      mimeType: GEOJSON_UPLOAD_MIME,
      uploadHandle,
    });
    const id = readFileId(registered);
    if (!id) throw new Error('The file was stored but could not be registered. Try the upload again.');
    return id;
  }
}

/** The pin tooltip: street address then city, and the bare word when the row has neither. */
function householdLabel(row: { street_num: string | null; street1: string | null; city: string | null }): string {
  const street = [row.street_num, row.street1]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  const city = row.city?.trim() ?? '';
  return [street, city].filter(Boolean).join(', ') || 'Household';
}

function readFileId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('id' in value)) return null;
  const id = (value as { id: unknown }).id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  return null;
}
