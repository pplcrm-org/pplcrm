import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Back the "a list with this name already exists" check with a real constraint.
 *
 * `ListsController.addList` did a check-then-act (getOneBy('name') then insert) with nothing in
 * the database enforcing it, so two concurrent creates both passed the check and both inserted.
 *
 * The key is (tenant_id, campaign_id, name), not (tenant_id, name): the built-in lists are seeded
 * once per campaign by `ensureSystemLists`, so a tenant running two campaigns legitimately has two
 * lists named "All Subscribers". Campaign is the real conflict domain.
 *
 * Created CONCURRENTLY-safe: this runs inside the migrator's transaction, so a plain CREATE UNIQUE
 * INDEX is used. Pre-ship there is no data to collide; the DO block below fails loudly rather than
 * silently skipping if that ever stops being true.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const duplicates = await sql<{
    tenant_id: string;
    campaign_id: string;
    name: string;
    n: string;
  }>`
    SELECT tenant_id, campaign_id, name, count(*) AS n
    FROM public.lists
    GROUP BY tenant_id, campaign_id, name
    HAVING count(*) > 1
  `.execute(db);

  if (duplicates.rows.length > 0) {
    const sample = duplicates.rows
      .slice(0, 5)
      .map((r) => `tenant ${r.tenant_id}/campaign ${r.campaign_id}: "${r.name}" x${r.n}`)
      .join('; ');
    throw new Error(
      `Cannot add the unique list-name index: ${duplicates.rows.length} duplicate (tenant, campaign, name) group(s) exist. Resolve them first. Sample: ${sample}`,
    );
  }

  await sql`
    CREATE UNIQUE INDEX uq_lists_tenant_campaign_name
      ON public.lists (tenant_id, campaign_id, name)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_lists_tenant_campaign_name`.execute(db);
}
