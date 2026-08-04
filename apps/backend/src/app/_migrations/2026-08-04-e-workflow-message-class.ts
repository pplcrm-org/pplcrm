import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Give every automation a message class (REVIEW3 "two classes of automation email").
 *
 * 'relationship' = operational mail responding to the recipient's own action; a recipient with
 * zero newsletter-subscription rows may still be emailed. 'marketing' = commercial mail; the
 * consent check requires at least one positively subscribed row and the send gate additionally
 * requires the organization's postal address.
 *
 * The column default is 'marketing' — the safe side for a value nobody set. Existing rows are
 * backfilled FROM THE TRIGGER, not left at the blanket default, so live operational automations
 * (volunteer follow-ups, form-submission responses, donation thank-yous, SLA escalations,
 * unsubscribe confirmations) do not suddenly demand a newsletter subscription and stop emailing
 * the people they were built for. The win-back trigger (`supporter_lapsed`) and the ambiguous
 * triggers (`manual`, `contact_created`, `tag_added`, `list_joined`, `new_subscriber`,
 * `date_arrives`) stay at 'marketing'.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.workflows
      ADD COLUMN IF NOT EXISTS message_class text NOT NULL DEFAULT 'marketing'
  `.execute(db);
  await sql`ALTER TABLE public.workflows DROP CONSTRAINT IF EXISTS chk_workflows_message_class`.execute(db);
  await sql`
    ALTER TABLE public.workflows
      ADD CONSTRAINT chk_workflows_message_class
      CHECK (message_class = ANY (ARRAY['relationship'::text, 'marketing'::text]))
  `.execute(db);
  // Keep this trigger list in step with RELATIONSHIP_LOCKED_TRIGGERS in
  // libs/common/src/lib/schemas/workflows.schema.ts.
  await sql`
    UPDATE public.workflows
       SET message_class = 'relationship'
     WHERE trigger_type = ANY (ARRAY[
       'web_form_submitted',
       'donation_recorded',
       'payment_event',
       'volunteer_shift_status',
       'task_sla_breach',
       'volunteer_signup',
       'new_unsubscriber'
     ])
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.workflows DROP CONSTRAINT IF EXISTS chk_workflows_message_class`.execute(db);
  await sql`ALTER TABLE public.workflows DROP COLUMN IF EXISTS message_class`.execute(db);
}
