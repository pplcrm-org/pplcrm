/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by `tools/boundary-catalog/` (`npm run boundary-catalog -- build`). That script downloads
 * each publisher's file, converts and simplifies it, and records the feature count, byte size and
 * SHA-256 of the bytes it produced. Editing this file by hand would let those three fields describe
 * a file that does not exist; the loader verifies the checksum and refuses a file that does not
 * match, so a hand-typed value does not fail quietly, it fails the whole map.
 *
 * ## Why this list is empty right now
 *
 * The mechanism is complete and the script is written, but no publisher's file has been converted
 * and published yet, for two reasons, both of which are work rather than unknowns:
 *
 *  1. Each source's licence has to be checked individually before its file can be redistributed.
 *     US Census Bureau TIGER/Line files and the Canadian federal file are expected to permit it;
 *     provincial and territorial terms vary and some may not. A source whose terms do not clearly
 *     permit redistribution gets no entry at all.
 *  2. The converted files have to be uploaded to the catalog storage prefix, which is a maintainer
 *     action against a real storage account.
 *
 * While this list is empty the product's behaviour is exactly what it was before the catalog
 * existed: the picker says no published maps are available yet, and a workspace gets a map by
 * importing names, uploading a GeoJSON, or drawing it. Nothing anywhere claims otherwise, and no
 * coordinates have been invented to fill the gap — that mistake was already made once in this
 * codebase with three rectangles over downtown Chicago, and is recorded in
 * `apps/backend/src/app/lib/gis/boundary-data/README.md`.
 */

import type { PublishedBoundaryEntry } from './catalog.types';

/** Every published map available to add, in the order the picker lists them within a group. */
export const PUBLISHED_BOUNDARY_ENTRIES: readonly PublishedBoundaryEntry[] = [];
