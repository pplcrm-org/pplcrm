import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Record which automation created a task, so the SLA-breach scan can leave those tasks alone.
 *
 * An automation can be triggered by "task breaches SLA" and can itself contain a "create task"
 * step. That step links the new task to the same person, and the hourly SLA scan enrolls the
 * person of any task that passes its target — so the automation fed itself: task breaches,
 * person is enrolled, automation creates a second task, the enrollment completes, the second
 * task breaches, the person is enrolled again, and so on with no end.
 *
 * `created_by_workflow_id` holds the id of the automation whose "create task" step made the row,
 * and is NULL for every task a person created. The SLA scan skips rows where it is set.
 *
 * There is deliberately no foreign key to `workflows`: this is a record of where the task came
 * from, and deleting the automation must not clear the marker and put the task back into the
 * scan.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.tasks
      ADD COLUMN IF NOT EXISTS created_by_workflow_id bigint
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.tasks
      DROP COLUMN IF EXISTS created_by_workflow_id
  `.execute(db);
}
