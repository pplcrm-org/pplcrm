import type { Kysely, Transaction } from 'kysely';

import type { Models } from '../../../../../libs/common/src/lib/kysely.models';

/** Workspace → App toggle (settings key). ON by default — expiry is the secure default. */
export const VOLUNTEER_LINKS_EXPIRE_SETTING_KEY = 'app.volunteer_links_expire';

/**
 * Does this tenant expire delivery-route volunteer links (30 days after minting)?
 *
 * The policy is evaluated LIVE at every enforcement point (never baked into the row):
 * `share_token_expires_at` is always stored at mint time as data, and this setting decides
 * whether it is enforced. That makes the toggle instant and reversible — turning expiry off
 * revives already-expired links, and turning it back on immediately re-applies the stored
 * dates (links minted more than 30 days ago stop working again).
 *
 * Enforced in DeliveriesController (mintShareLink active-check, isTokenUsable, sanitizeRoute)
 * and CompanionAccessController.resolveLink (the gate's route branch) — keep them in sync.
 */
export async function volunteerLinksExpire(
  db: Kysely<Models> | Transaction<Models>,
  tenantId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', VOLUNTEER_LINKS_EXPIRE_SETTING_KEY)
    .executeTakeFirst();
  // Anything other than an explicit "off" means the secure default: links expire.
  return !(row?.value === false || row?.value === 'false');
}

/** Hard ceiling on a turf link's life, whatever the campaign says. */
export const MAX_ASSIGNMENT_TTL_DAYS = 30;

/**
 * When a canvassing turf link stops working.
 *
 * The campaign's end date wins when it is sooner (spec §2: "end of the canvass window"),
 * otherwise the ceiling applies.
 *
 * SECURITY (M5): this used to return null — "never expires" — whenever the campaign had
 * no end date, which is the common case for an ongoing office context. A bearer token
 * that never expires is a permanent credential sitting in someone's SMS history.
 *
 * Lives here rather than on CanvassingController because three callers need it now:
 * assigning a turf, a volunteer self-claiming one, and the companion-access layer
 * placing a QR joiner on the turf their code named. The last of those cannot import
 * the canvassing controller — it already imports this module's controller back.
 */
export async function turfAssignmentExpiry(
  db: Kysely<Models> | Transaction<Models>,
  tenantId: string,
  campaignId: string,
): Promise<Date> {
  const ceiling = new Date(Date.now() + MAX_ASSIGNMENT_TTL_DAYS * 24 * 60 * 60 * 1000);
  if (!campaignId) return ceiling;
  const campaign = await db
    .selectFrom('campaigns')
    .select(['enddate'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', campaignId)
    .executeTakeFirst();
  if (!campaign?.enddate) return ceiling;
  const end = new Date(`${campaign.enddate}T23:59:59`);
  if (Number.isNaN(end.getTime()) || end <= new Date()) return ceiling;
  return end < ceiling ? end : ceiling;
}
