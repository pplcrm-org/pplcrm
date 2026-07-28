import type { Kysely, Transaction } from 'kysely';

import type { Models } from '../../../../../libs/common/src/lib/kysely.models';

/** Workspace → Companion Apps toggle (settings key). */
export const CANVASS_VOLUNTEER_ROAM_SETTING_KEY = 'app.canvass_volunteer_roam';

/**
 * How much of a campaign an approved canvass volunteer may reach.
 *
 * - `campaign` (default): browse and self-claim any unretired turf in their campaign.
 * - `assigned`: only turfs an admin put them on.
 */
export type CanvassRoamPolicy = 'assigned' | 'campaign';

const ASSIGNED: CanvassRoamPolicy = 'assigned';
const CAMPAIGN: CanvassRoamPolicy = 'campaign';

/**
 * The workspace roam policy.
 *
 * Defaults to `campaign`, unlike `volunteer_links_expire` next door which defaults to the
 * restrictive option. The reasoning is different: link expiry limits a *bearer credential*
 * that may sit in someone's SMS history forever, whereas roaming is bounded by an admin's
 * explicit approval of a named person and by their campaign. Approval is the trust
 * decision; which turf they walk is planning.
 *
 * Evaluated LIVE at every enforcement point, never baked into a row, so flipping it takes
 * effect on the volunteer's next request in either direction.
 */
export async function canvassRoamPolicy(
  db: Kysely<Models> | Transaction<Models>,
  tenantId: string,
): Promise<CanvassRoamPolicy> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', CANVASS_VOLUNTEER_ROAM_SETTING_KEY)
    .executeTakeFirst();
  // Only an explicit "assigned" narrows it; anything else (missing row, corrupt value,
  // a value from a future version) reads as the default rather than failing the request.
  return row?.value === ASSIGNED || row?.value === `"${ASSIGNED}"` ? ASSIGNED : CAMPAIGN;
}

/**
 * Whether THIS volunteer may roam: their own override wins over the workspace setting.
 *
 * `can_roam` is deliberately three-state — true / false / null-inherit — so "this one
 * person stays on their turf" never requires tightening the whole workspace, and
 * "this one person is trusted" never requires loosening it.
 */
export async function volunteerMayRoam(
  db: Kysely<Models> | Transaction<Models>,
  input: { tenant_id: string; can_roam: boolean | null },
): Promise<boolean> {
  if (input.can_roam != null) return input.can_roam;
  return (await canvassRoamPolicy(db, input.tenant_id)) === CAMPAIGN;
}
