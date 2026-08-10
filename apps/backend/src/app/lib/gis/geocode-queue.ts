import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import { effectivePlanKey, planAllowsGeocoding } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import { isMockOrTestGeocode } from './geocode-address';

type Db = Kysely<Models> | Transaction<Models>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight — the anchor for day-N run_at buckets when a big import is spread across days. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function geocodeJobRow(tenantId: string, householdId: string, runAt: Date) {
  return {
    tenant_id: tenantId,
    queue: 'default',
    status: 'pending' as const,
    payload: JSON.stringify({ type: 'geocode_household', household_id: householdId, tenant_id: tenantId }),
    run_at: runAt,
    max_attempts: 3,
  };
}

/**
 * Enqueue geocoding for a set of households belonging to one tenant, applying the plan gate and the
 * per-tenant daily budget. The single place both the bulk import (`HouseholdRepo.addMany`) and the
 * single-address edit (`households/controller.ts`) enqueue geocoding, so the cost rules live in one
 * spot.
 *
 * Rules:
 *  - **Mock/test/no key** (`isMockOrTestGeocode`): geocoding is free (deterministic dev coords), so
 *    enqueue immediately for everyone regardless of plan — demo/dev/CI still get map pins & turfs.
 *  - **Real Google key**: geocoding costs money, so it is Movement-only (demo-mode tenants are
 *    exempt — the sample workspace is a handful of households and needs its pins). Lower tiers are
 *    never sent to the API: their households are marked `skipped` (the chip shows "Not geocoded")
 *    and no job is enqueued.
 *  - **Allowed tenants**: run_at is spread across days at `GEOCODE_DAILY_BUDGET` per tenant per day,
 *    continuing after the tenant's existing pending geocode backlog — so a 200k-household import is
 *    metered out over days instead of geocoding the whole list (and its Google bill) in one night.
 */
export async function enqueueGeocodeJobs(
  db: Db,
  tenantId: string,
  householdIds: string[],
  dailyBudget: number = env.geocodeDailyBudget,
): Promise<void> {
  const ids = householdIds.map(String).filter(Boolean);
  if (ids.length === 0) return;

  if (isMockOrTestGeocode()) {
    const now = new Date();
    await db
      .insertInto('background_jobs')
      .values(ids.map((id) => geocodeJobRow(tenantId, id, now)))
      .execute();
    return;
  }

  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_plan', 'demo_mode_at'])
    .where('id', '=', tenantId)
    .executeTakeFirst();

  const allowed = planAllowsGeocoding(effectivePlanKey(tenant?.subscription_plan, tenant?.demo_mode_at));
  if (!allowed) {
    await db
      .updateTable('households')
      .set({ geocoding_status: 'skipped', updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', ids)
      .execute();
    return;
  }

  // How many geocode jobs are already queued for this tenant — new work stacks after them so a
  // second import continues filling future days rather than doubling up on the same day's budget.
  const backlogRow = await db
    .selectFrom('background_jobs')
    .select((eb) => eb.fn.countAll().as('cnt'))
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'pending')
    .where(sql<string>`payload->>'type'`, '=', 'geocode_household')
    .executeTakeFirst();
  const backlog = Number(backlogRow?.cnt ?? 0);

  const budget = dailyBudget;
  const dayStart = startOfToday().getTime();
  const now = new Date();
  const rows = ids.map((id, i) => {
    const dayOffset = Math.floor((backlog + i) / budget);
    const runAt = dayOffset === 0 ? now : new Date(dayStart + dayOffset * DAY_MS);
    return geocodeJobRow(tenantId, id, runAt);
  });
  await db.insertInto('background_jobs').values(rows).execute();
}
