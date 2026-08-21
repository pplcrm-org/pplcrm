import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Allow the new `add_to_list` automation step kind (an automation puts the enrolled person on a
 * static list). The step-kind CHECK constraint enumerates every legal kind, so a new kind is a
 * constraint change. Keep this array in step with WORKFLOW_STEP_KINDS in
 * libs/common/src/lib/schemas/workflows.schema.ts.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.workflow_steps DROP CONSTRAINT IF EXISTS chk_workflow_steps_kind`.execute(db);
  await sql`
    ALTER TABLE public.workflow_steps
      ADD CONSTRAINT chk_workflow_steps_kind
      CHECK (kind = ANY (ARRAY['wait'::text, 'send_email'::text, 'add_tag'::text, 'create_task'::text, 'notify_team'::text, 'add_to_list'::text]))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.workflow_steps DROP CONSTRAINT IF EXISTS chk_workflow_steps_kind`.execute(db);
  await sql`
    ALTER TABLE public.workflow_steps
      ADD CONSTRAINT chk_workflow_steps_kind
      CHECK (kind = ANY (ARRAY['wait'::text, 'send_email'::text, 'add_tag'::text, 'create_task'::text, 'notify_team'::text]))
  `.execute(db);
}
