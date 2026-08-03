import type { Kysely } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';
import { fingerprintFull, isBlankAddress, isIncompleteAddress } from '../address-normalize';
import { applyHouseholdMatches, matchHouseholdBoundaries } from './boundary-match';
import { geocodeAddressCached } from './geocode-cache';

/**
 * Turn one household's address into coordinates, then into the set of areas that cover it.
 *
 * Two steps with opposite economics, and keeping them straight is the point of this file:
 *
 *  - Geocoding costs money. It is billed per Google request, so it is plan-gated
 *    (`planAllowsGeocoding`), metered per tenant per day (`geocode-queue.ts`) and memoised by
 *    address (`geocode-cache.ts`). A cached address makes no request.
 *  - Boundary matching costs nothing. It is a point-in-polygon test in this process. It runs inline
 *    the moment coordinates exist, and it re-runs whenever a map changes.
 */

export { isPointInMultiPolygon, isPointInPolygon } from './point-in-polygon';

export async function geocodeAndMapHousehold(householdId: string, tenantId: string, db: Kysely<Models>): Promise<void> {
  const hh = await db
    .selectFrom('households')
    .selectAll()
    .where('id', '=', householdId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

  if (!hh) {
    logger.warn(`Geocoding job skipped: Household ${householdId} not found.`);
    return;
  }

  // 1. Check if the address is blank or incomplete
  if (isBlankAddress(hh) || isIncompleteAddress(hh)) {
    logger.info(`Geocoding job: Household ${householdId} has a blank or incomplete address. Marking as failed.`);
    await markGeocodingFailed(db, tenantId, householdId);
    return;
  }

  // 2. Resolve coordinates. Every paid Google request in the product goes through
  //    `geocodeAddressCached`, which answers from `geocode_cache` when this tenant has looked the
  //    same address up before — including when the previous answer was "no such address", so a bad
  //    row in a repeatedly re-imported file is paid for once and never again. ZERO_RESULTS ⇒ null ⇒
  //    mark failed; transient errors re-throw so the worker retries with backoff.
  const addressStr = [hh.street_num, hh.street1, hh.street2, hh.city, hh.state, hh.zip, hh.country]
    .filter(Boolean)
    .join(', ');
  const addressFp = hh.address_fp_full ?? fingerprintFull(hh);

  let geocoded: Awaited<ReturnType<typeof geocodeAddressCached>>;
  try {
    geocoded = await geocodeAddressCached(db, tenantId, addressFp, addressStr);
  } catch (err) {
    logger.error({ err }, `Geocoding API call failed for household ${householdId}`);
    throw err;
  }

  if (!geocoded) {
    logger.info(`Geocoding job: Address "${addressStr}" returned zero results. Marking as failed.`);
    await markGeocodingFailed(db, tenantId, householdId);
    return;
  }

  // 3. Store the coordinates.
  await db
    .updateTable('households')
    .set({
      lat: geocoded.lat,
      lng: geocoded.lng,
      formatted_address: geocoded.formatted_address,
      type: geocoded.type,
      geocoding_status: 'success',
      updated_at: new Date(),
    })
    .where('id', '=', householdId)
    .where('tenant_id', '=', tenantId)
    .execute();

  // 4. Match the coordinates against every boundary layer this workspace requires, and write one
  //    `household_districts` row per layer. A United States household legitimately holds a
  //    congressional district AND both legislative districts AND a precinct at the same time; the
  //    three text columns this replaced could hold three answers, so each pass overwrote the last.
  //    This step makes no external call and is free to repeat.
  await matchHouseholdBoundaries(db, tenantId, householdId, geocoded.lat, geocoded.lng);

  logger.info(`Geocoding & GIS mapping completed successfully for household ${householdId}. Status set to success.`);
}

/**
 * Mark a household un-geocodable and drop the areas it used to be in.
 *
 * The stored areas are cleared because they were derived from coordinates that are now known to be
 * wrong or unobtainable; leaving them would report a district for an address the product cannot
 * place. Areas assigned by a CSV import are left alone — see `applyHouseholdMatches`.
 */
async function markGeocodingFailed(db: Kysely<Models>, tenantId: string, householdId: string): Promise<void> {
  await db
    .updateTable('households')
    .set({ geocoding_status: 'failed', updated_at: new Date() })
    .where('id', '=', householdId)
    .where('tenant_id', '=', tenantId)
    .execute();
  // Deliberately unscoped, unlike a re-match: an unplaceable address invalidates every
  // geometry-derived row, not just the layers the workspace currently requires.
  await applyHouseholdMatches(db, tenantId, householdId, []);
}
