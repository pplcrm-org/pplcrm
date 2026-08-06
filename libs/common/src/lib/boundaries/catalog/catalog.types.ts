/**
 * The catalog of published electoral boundary maps a workspace can add without uploading anything.
 *
 * ## Why this exists
 *
 * Before this catalog there were three ways to get a boundary map: import the district names a CSV
 * already carried, upload a GeoJSON file, or draw the areas by hand. All three are the right answer
 * for a municipality, because thousands of them publish nothing usable. None of them is the right
 * answer for a Canadian federal riding, which is published once by Elections Canada, is identical
 * for every workspace in the country, and does not change until Parliament redistributes seats.
 * Making every campaign find, convert and upload the same national file is work with no product in
 * it.
 *
 * ## What a catalog entry is, and what it is not
 *
 * An entry is a description of one published file: who published it, which edition it is, how many
 * areas it holds, and the checksum of the exact bytes. It is NOT the polygons. The polygons live in
 * a GeoJSON file the backend loads on demand (see `apps/backend/src/app/lib/gis/boundary-store.ts`),
 * because a national map is megabytes of coordinates that no browser needs and no container image
 * should carry for every workspace that did not ask for it.
 *
 * When a workspace adds an entry, one `boundary_sets` row is written with `source = 'bundled'` and
 * the entry's descriptive columns copied onto it. The row is per workspace; the file behind it is
 * shared by every workspace that added the same entry.
 *
 * ## The entry list is generated, never hand-edited
 *
 * `catalog.entries.ts` is written by `tools/boundary-catalog`, which downloads the publisher's file,
 * converts and simplifies it, and records the resulting feature count, byte size and SHA-256. Those
 * three fields describe bytes that exist. Typing them by hand would let them drift from the file
 * they claim to describe, and a checksum that does not match the file it names is worse than no
 * checksum at all, because the loader treats a mismatch as tampering and refuses the file.
 *
 * ## Licensing is per entry, and it gates the entry existing
 *
 * Redistributing a government's boundary file requires that government's licence to permit it, and
 * the terms are not uniform: US Census Bureau TIGER/Line files are federal government works, the
 * Canadian federal file is published under an open government licence that requires attribution,
 * and provincial and territorial terms vary one by one. A source whose licence does not clearly
 * permit redistribution simply has no entry, and that jurisdiction keeps the upload and draw paths.
 * `licence` and `attribution` are required fields so an entry cannot be added without recording
 * what it is being redistributed under, and the product displays the attribution.
 */

import type { BoundaryRole, Chamber, JurisdictionId } from '../../jurisdictions/jurisdiction.types';

/**
 * One published map available to add.
 *
 * The descriptive fields mirror the `boundary_sets` columns they are copied into, so adding an
 * entry is a copy rather than a translation.
 */
export interface PublishedBoundaryEntry {
  /**
   * Stable identity, used three ways at once: the catalog key, the `boundary_sets.slug` value on
   * every workspace that adds it, and the `<slug>.geojson` filename the loader reads. A new edition
   * is a new slug, never the same slug with different bytes.
   */
  readonly slug: string;

  /** What the picker and the boundary list show, e.g. 'Canada — federal ridings'. */
  readonly label: string;

  readonly jurisdiction: JurisdictionId;

  /** Province, territory or state code this layer covers. Null when it covers a whole country. */
  readonly region: string | null;

  /** Set only for US state legislative layers: the two chambers are two different published maps. */
  readonly chamber: Chamber | null;

  /** What the areas mean, which is never inferred from what they are called. */
  readonly role: BoundaryRole;

  /** Which edition this is, e.g. '2023 representation order'. Required — see {@link supersededBy}. */
  readonly vintage: string;

  /** The body that published the original file, shown to the user as the map's origin. */
  readonly publisher: string;

  /** The licence the file is redistributed under, e.g. 'Open Government Licence — Canada 2.0'. */
  readonly licence: string;

  /** The attribution wording that licence requires, displayed wherever the map is shown. */
  readonly attribution: string;

  /** Where the original was obtained, so a maintainer can re-derive the file years later. */
  readonly sourceUrl: string;

  /** Which GeoJSON property of the converted file holds each area's name. */
  readonly nameProperty: string;

  /** Which property holds each area's code, or null when the publisher gives no code. */
  readonly codeProperty: string | null;

  /** Areas in the file. Copied to `boundary_sets.feature_count`; also half the cache version. */
  readonly featureCount: number;

  /** Size of the converted file in bytes, so the picker can say what a download will cost. */
  readonly bytes: number;

  /** SHA-256 of the converted file, verified after download. Lowercase hex. */
  readonly sha256: string;

  /**
   * The slug of the edition that replaced this one, or null while this is current.
   *
   * A superseded entry is kept rather than removed. A campaign working an election held under the
   * old lines needs the old lines, and a workspace that already added an edition keeps it — a
   * boundary file is never rewritten in place, because doing so would silently move households
   * between areas with nothing in the workspace's own data having changed.
   */
  readonly supersededBy: string | null;
}

/** The two countries the catalog covers. `null` is not a catalog case — every entry has a country. */
export type PublishedBoundaryCountry = 'CA' | 'US';

/** What a campaign knows about its own office, and all the picker needs to suggest maps for it. */
export interface PublishedBoundaryMatch {
  readonly jurisdiction: JurisdictionId;
  readonly region: string | null;
  readonly chamber: Chamber | null;
}
