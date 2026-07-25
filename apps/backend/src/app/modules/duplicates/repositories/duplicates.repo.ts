import { sql } from 'kysely';
import type { Transaction } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';

/** Cross-entity duplicate-admin concerns that don't belong to persons/households/companies
 * individually: the unified queue-size count (sidebar badge + §9.3 sentence), the nightly-sweep
 * timestamp, and "Not duplicates" dismissals. See `pplcrm-migrations` for the
 * `dismissed_duplicate_groups` table this repo owns half of (the other half —
 * `recomputeAllDuplicates` skipping dismissed groups — lives in
 * `persons/services/duplicate-maintenance.service.ts`). */
export class DuplicatesRepo extends BaseRepository<'potential_duplicates'> {
  constructor() {
    super('potential_duplicates');
  }

  /** Number of duplicate GROUPS (not raw rows) waiting across every entity kind — a group_key
   * with more than one row is "a pair (or cluster) waiting for review". */
  public async countQueue(tenant_id: string): Promise<number> {
    const rows = await this.getSelect()
      .select('group_key')
      .where('tenant_id', '=', tenant_id)
      .groupBy('group_key')
      .having(sql`count(id)`, '>', 1)
      .execute();
    return rows.length;
  }

  /** When the nightly sweep (`recompute_all_duplicates`) last completed. Same instant for every
   * tenant — it's one cron loop over all tenants (`handleRecomputeAllDuplicates` in
   * `lib/jobs/handlers/maintenance.handlers.ts`), so there is no tenant_id to scope this by. */
  public async getLastSweepAt(): Promise<Date | null> {
    // NOTE: unscoped by design — this is the completion timestamp of the single global cron
    // run that sweeps every tenant in one job, not tenant-specific data.
    // eslint-disable-next-line local/no-unscoped-db-query
    const lastJob = await this.db
      .selectFrom('background_jobs')
      .select(['updated_at'])
      .where('status', '=', 'completed')
      .where(sql`payload->>'type'`, '=', 'recompute_all_duplicates')
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return lastJob?.updated_at ? new Date(lastJob.updated_at) : null;
  }

  /** Record a "Not duplicates" verdict and drop the pair from today's already-computed queue
   * immediately (the nightly sweep will also honor it on every future run). */
  public async dismissGroup(input: { tenant_id: string; group_key: string; user_id: string }): Promise<void> {
    await this.db
      .insertInto('dismissed_duplicate_groups')
      .values({ tenant_id: input.tenant_id, group_key: input.group_key, dismissed_by_id: input.user_id })
      .onConflict((oc) => oc.columns(['tenant_id', 'group_key']).doNothing())
      .execute();

    await this.db
      .deleteFrom('potential_duplicates')
      .where('tenant_id', '=', input.tenant_id)
      .where('group_key', '=', input.group_key)
      .execute();
  }

  /** The set of group_keys this tenant has already said "not duplicates" about — consumed by
   * `DuplicateMaintenanceService.recomputeAllDuplicates` so the sweep doesn't re-flag them.
   * `trx` is passed when the sweep runs inside someone else's transaction (demo seeding at
   * signup) so it reads the same uncommitted state the sweep is about to write against. */
  public async getDismissedGroupKeys(tenant_id: string, trx?: Transaction<Models>): Promise<Set<string>> {
    const rows = await (trx ?? this.db)
      .selectFrom('dismissed_duplicate_groups')
      .select('group_key')
      .where('tenant_id', '=', tenant_id)
      .execute();
    return new Set(rows.map((r) => r.group_key));
  }
}
