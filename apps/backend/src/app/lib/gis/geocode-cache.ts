import type { Kysely, Transaction } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';
import type { GeocodeResult } from './geocode-address';
import { geocodeAddress, isMockOrTestGeocode } from './geocode-address';

type Db = Kysely<Models> | Transaction<Models>;

/**
 * The address-to-coordinates memo, and the reason it exists.
 *
 * THE ATTACK THIS STOPS. Import five thousand addresses. Delete every household. Import the same
 * file again. Repeat. Without a cache, each pass pays Google for five thousand geocoding requests
 * covering the same five thousand distinct addresses, and the loop can run indefinitely. The
 * existing per-tenant daily budget in `geocode-queue.ts` does not stop this — it only slows it
 * down, spreading the same spend over more days — and every request after the first is pure waste,
 * because the answer was already bought.
 *
 * WHY THE CACHE MUST SURVIVE HOUSEHOLD DELETION. Surviving deletion IS the defence. There is
 * deliberately no foreign key from `geocode_cache` to `households` and no cascade: deleting the
 * household deletes the household, and the memo of what that address geocoded to stays, so the
 * re-import costs nothing. A cache that were cleaned up alongside the household would defend
 * against nothing at all, because the attack is precisely delete-then-re-import.
 *
 * WHY `zero_results` IS CACHED TOO. A permanent negative answer is worth exactly as much as a
 * positive one. Caching only the successes leaves every unresolvable address — typos, fictional
 * streets, deliberately malformed rows — billable on every single pass, forever. Junk addresses are
 * both the cheapest thing for an attacker to generate and the thing a real customer's messy CSV has
 * most of.
 *
 * WHY THE CACHE IS PER TENANT. A shared cache would be a cross-tenant read: discovering that a
 * lookup for a specific street address is already answered discloses that another workspace holds
 * that address. One first lookup per tenant is the right price for not making that trade.
 *
 * The key is the same normalised fingerprint the household row carries in
 * `households.address_fp_full`, so the same address written two ways hits the same entry.
 */

/** What a cache entry says about an address. */
export interface CachedGeocode {
  status: 'success' | 'zero_results';
  result: GeocodeResult | null;
}

/** Look up an address fingerprint. Returns null when nothing is remembered for it. */
export async function lookupGeocodeCache(db: Db, tenantId: string, addressFp: string): Promise<CachedGeocode | null> {
  const row = await db
    .selectFrom('geocode_cache')
    .select(['status', 'lat', 'lng', 'formatted_address', 'type'])
    .where('tenant_id', '=', tenantId)
    .where('address_fp', '=', addressFp)
    .executeTakeFirst();

  if (!row) return null;
  if (row.status !== 'success') return { status: 'zero_results', result: null };
  if (row.lat == null || row.lng == null) {
    // A 'success' row with no coordinates cannot be used and cannot have been written by this code.
    // Treat it as a miss so the address is looked up again rather than silently losing the pin.
    return null;
  }

  return {
    status: 'success',
    result: {
      lat: Number(row.lat),
      lng: Number(row.lng),
      formatted_address: row.formatted_address ?? '',
      type: row.type ?? '',
    },
  };
}

/**
 * Remember what an address geocoded to, including that it geocoded to nothing.
 *
 * Written outside the caller's transaction on purpose. The memo is worth keeping even when the
 * household update that prompted it rolls back — the money has already been spent either way, and
 * a rolled-back memo means paying for the same address twice.
 */
export async function rememberGeocode(
  db: Db,
  tenantId: string,
  addressFp: string,
  result: GeocodeResult | null,
): Promise<void> {
  await db
    .insertInto('geocode_cache')
    .values({
      tenant_id: tenantId,
      address_fp: addressFp,
      status: result ? 'success' : 'zero_results',
      lat: result?.lat ?? null,
      lng: result?.lng ?? null,
      formatted_address: result?.formatted_address ?? null,
      type: result?.type ?? null,
      looked_up_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'address_fp']).doUpdateSet({
        status: (eb) => eb.ref('excluded.status'),
        lat: (eb) => eb.ref('excluded.lat'),
        lng: (eb) => eb.ref('excluded.lng'),
        formatted_address: (eb) => eb.ref('excluded.formatted_address'),
        type: (eb) => eb.ref('excluded.type'),
        looked_up_at: (eb) => eb.ref('excluded.looked_up_at'),
      }),
    )
    .execute();
}

/**
 * Geocode an address, consulting the cache first and writing the answer back.
 *
 * Every paid Google geocoding call in the product goes through here. A cache hit makes no API call
 * at all, whether the remembered answer was coordinates or "no such address".
 *
 * Mock/test mode skips the cache entirely: those coordinates are derived from a hash of the address
 * string, cost nothing, and never touch the network, so there is nothing to defend and no reason to
 * fill a test database with rows.
 */
export async function geocodeAddressCached(
  db: Db,
  tenantId: string,
  addressFp: string | null,
  addressStr: string,
): Promise<GeocodeResult | null> {
  if (isMockOrTestGeocode()) return geocodeAddress(addressStr);

  // No fingerprint means the address normalised to nothing, so there is no stable key to remember
  // it under. Fall through to a live lookup rather than inventing a key that could collide.
  if (!addressFp) return geocodeAddress(addressStr);

  const cached = await lookupGeocodeCache(db, tenantId, addressFp);
  if (cached) {
    logger.debug({ tenantId }, 'Geocode cache hit — no Google request made');
    return cached.result;
  }

  const result = await geocodeAddress(addressStr);

  try {
    await rememberGeocode(db, tenantId, addressFp, result);
  } catch (err) {
    // A failed cache write must never fail the geocode that already succeeded and was already paid
    // for. The worst case is paying for this one address again on the next pass.
    logger.error({ err, tenantId }, 'Failed to write geocode cache entry');
  }

  return result;
}
