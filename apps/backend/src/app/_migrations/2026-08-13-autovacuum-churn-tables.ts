import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Per-table autovacuum tuning for the four highest-churn tables (REVIEW6 T2-8).
 *
 * Postgres's default trigger is 20% of the table dead (`autovacuum_vacuum_scale_factor = 0.2`),
 * which is sized for tables whose rows mostly sit still. These four are the opposite:
 *
 * - `background_jobs`: every row is updated 2–3 times over its life (claim, finish, and often a
 *   reschedule), and the updates are never HOT because `status` sits in three partial-index
 *   predicates — so each update is a full new row version plus index churn.
 * - `potential_duplicates`: rebuilt per tenant whenever the fingerprint pass finds changes — a
 *   full delete + reinsert of that tenant's rows.
 * - `map_lists_persons` / `map_lists_households`: every smart-list refresh is a full delete +
 *   reinsert of the list's membership.
 *
 * On the Burstable B1ms these tables could carry a fifth of themselves as dead rows before
 * vacuum even started, and then vacuum competed with the workload for the tiny I/O budget.
 * 2% (`0.02`) starts vacuum while the dead set is still small, and `cost_delay = 1` (ms) lets
 * each run finish quickly instead of sleeping through the default throttle.
 *
 * Storage parameters, not data — safe on a live table; ALTER TABLE ... SET takes only a brief
 * SHARE UPDATE EXCLUSIVE lock.
 */
const CHURN_TABLES = ['background_jobs', 'potential_duplicates', 'map_lists_persons', 'map_lists_households'];

export async function up(db: Kysely<any>): Promise<void> {
  for (const table of CHURN_TABLES) {
    await sql`
      ALTER TABLE public.${sql.raw(table)}
        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_cost_delay = 1)
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of CHURN_TABLES) {
    await sql`
      ALTER TABLE public.${sql.raw(table)}
        RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_cost_delay)
    `.execute(db);
  }
}
