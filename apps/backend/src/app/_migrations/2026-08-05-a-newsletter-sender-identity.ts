import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Store the From name and From address the composer chose for a newsletter.
 *
 * The wizard requires both fields and blocks progression until they are filled, and the test send
 * honors them — but the real send never saw them: they were absent from the create/update payload
 * and from the table, so the send worker always used the workspace-wide
 * `communications.default_from_name` / `communications.default_from_email` settings (and the
 * literal name "pplCRM Team" when no default name was set). A workspace with more than one
 * verified sender could pick the non-default one, have the test email confirm the choice, and then
 * send the real newsletter from a different identity.
 *
 * Both columns are NULLABLE and both are read as "use the workspace default when NULL": every
 * newsletter that already exists, and every row written by a caller that does not set them (the
 * demo seeder, the non-opener resend clone), keeps exactly the behavior it has today. There is no
 * backfill for the same reason — writing today's workspace default into old rows would freeze it,
 * so that a later change to the workspace default would stop applying to them.
 *
 * The stored address is NOT a way around sender verification: it is checked against
 * `communications.verified_emails` when the send is requested (NewslettersController.sendNewsletter)
 * and again in the send worker, which falls back to the workspace default if the address is no
 * longer verified. That is the same rule the test-send path already applies.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.newsletters
      ADD COLUMN IF NOT EXISTS from_name text,
      ADD COLUMN IF NOT EXISTS from_email text
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.newsletters
      DROP COLUMN IF EXISTS from_email,
      DROP COLUMN IF EXISTS from_name
  `.execute(db);
}
