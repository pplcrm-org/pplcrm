import { Service, inject } from '@angular/core';
import type {
  AddBoundaryFeatureType,
  AddDrawnBoundarySetType,
  BoundaryFeatureRowType,
  BoundarySetRowType,
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

/** The pins the map can draw, and how many located households the workspace actually holds. */
export interface BoundaryHouseholdPins {
  pins: BoundaryHouseholdPin[];
  /** Every household with coordinates, including the ones no pin was returned for. */
  totalLocated: number;
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

  public listFeatures(setId: string): Promise<BoundaryFeatureRowType[]> {
    return this.api.boundaries.features.query({ setId }, { signal: this.ac.signal });
  }

  public createDrawnSet(input: AddDrawnBoundarySetType): Promise<BoundarySetRowType> {
    return this.api.boundaries.createDrawn.mutate(input);
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
   * Households that already have coordinates, as map pins, with the true count of located ones.
   *
   * This is the point of drawing in the app rather than in external mapping software: the areas are
   * traced around the doors the workspace actually holds. Households without coordinates are left
   * out because there is nowhere honest to put them, not because they do not matter.
   *
   * The server caps the pin list and orders it by id, so a large workspace sees the same sample
   * every time rather than a different arbitrary slice on each load. `totalLocated` is what the
   * caption must quote as the workspace's number; matching runs over all of them regardless.
   */
  public async listHouseholdPins(): Promise<BoundaryHouseholdPins> {
    const result = await this.api.boundaries.householdPins.query(undefined, { signal: this.ac.signal });
    return {
      pins: result.pins.map((row) => ({ id: row.id, lat: row.lat, lng: row.lng, label: householdLabel(row) })),
      totalLocated: result.total_geocoded,
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
