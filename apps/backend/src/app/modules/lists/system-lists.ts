import type { Transaction } from 'kysely';

import { SYSTEM_LISTS, systemListDefinition } from '../../../../../../libs/common/src';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../lib/base.repo';

/**
 * Create any missing built-in lists ("All Subscribers", "All Volunteers") for
 * one campaign context. Idempotent: the partial unique index
 * `uq_lists_system_key (tenant_id, campaign_id, system_key)` absorbs the second
 * caller, so this is safe to run on every Lists read.
 *
 * Called from two places:
 *  - signup (auth/controller.ts), inside the tenant-creation transaction, so a
 *    brand-new tenant has them before it ever opens the page — including while
 *    it is still in demo mode; and
 *  - the Lists read path (ListsController.getAllForContext), which backfills
 *    tenants that predate this feature and any campaign created later.
 *
 * They are deliberately absent from the demo manifest (modules/demo), so
 * exiting demo mode deletes the demo lists and leaves these two standing.
 *
 * Returns the number of rows actually inserted (0 on the steady-state path).
 */
export async function ensureSystemLists(
  params: { tenant_id: string; campaign_id: string; user_id: string },
  trx?: Transaction<Models>,
): Promise<number> {
  const db = trx ?? BaseRepository.dbInstance;

  const result = await db
    .insertInto('lists')
    .values(
      SYSTEM_LISTS.map((def) => ({
        tenant_id: params.tenant_id,
        campaign_id: params.campaign_id,
        name: def.name,
        description: def.description,
        object: def.object,
        is_dynamic: true,
        definition: JSON.stringify(systemListDefinition(def)),
        system_key: def.key,
        // 'refreshing' would be a lie until a worker picks it up; the lists
        // module lazily refreshes any smart list older than 24h on read, and
        // the membership snapshot is only ever a cache of the live rules.
        status: 'idle' as const,
        createdby_id: params.user_id,
        updatedby_id: params.user_id,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();

  return Number(result?.numInsertedOrUpdatedRows ?? 0n);
}

/**
 * Queue an immediate membership refresh for the built-ins we just created, so
 * the Lists page shows a real member count on first paint rather than a zero
 * that only corrects itself a day later.
 */
export async function queueSystemListRefreshes(
  params: { tenant_id: string; campaign_id: string; user_id: string },
  trx?: Transaction<Models>,
): Promise<void> {
  const db = trx ?? BaseRepository.dbInstance;

  const rows = await db
    .selectFrom('lists')
    .select('id')
    .where('tenant_id', '=', params.tenant_id)
    .where('campaign_id', '=', params.campaign_id)
    .where('system_key', 'is not', null)
    .where((eb) => eb.or([eb('last_refreshed_at', 'is', null), eb('status', '=', 'failed')]))
    .execute();
  if (!rows.length) return;

  await db
    .insertInto('background_jobs')
    .values(
      rows.map((row) => ({
        tenant_id: params.tenant_id,
        queue: 'default',
        status: 'pending' as const,
        payload: JSON.stringify({
          type: 'refresh_list',
          list_id: String(row.id),
          tenant_id: params.tenant_id,
          user_id: params.user_id,
        }),
        run_at: new Date(),
      })),
    )
    .execute();
}
