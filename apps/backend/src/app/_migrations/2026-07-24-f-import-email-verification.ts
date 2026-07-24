import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * In-house email verification on contact import.
 *
 * The import background job now checks each imported address's domain (MX/A/AAAA via DNS) and
 * the disposable-domain list, then suppresses proven-bad addresses with a new
 * email_suppressions reason `invalid` — the address stays on the person record, but the
 * reason-agnostic newsletter/automation suppression checks exclude it from sends.
 * `data_imports.email_verification` stores the per-import verification summary (counts, typo
 * suspects, tripwire outcome) that the completion email and the History page report from.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.email_suppressions DROP CONSTRAINT IF EXISTS chk_esup_reason`.execute(db);
  await sql`
    ALTER TABLE public.email_suppressions ADD CONSTRAINT chk_esup_reason
      CHECK (reason = ANY (ARRAY['hard_bounce'::text, 'spam_complaint'::text, 'manual'::text, 'invalid'::text]))
  `.execute(db);
  await sql`ALTER TABLE public.data_imports ADD COLUMN IF NOT EXISTS email_verification jsonb`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM public.email_suppressions WHERE reason = 'invalid'`.execute(db);
  await sql`ALTER TABLE public.email_suppressions DROP CONSTRAINT IF EXISTS chk_esup_reason`.execute(db);
  await sql`
    ALTER TABLE public.email_suppressions ADD CONSTRAINT chk_esup_reason
      CHECK (reason = ANY (ARRAY['hard_bounce'::text, 'spam_complaint'::text, 'manual'::text]))
  `.execute(db);
  await sql`ALTER TABLE public.data_imports DROP COLUMN IF EXISTS email_verification`.execute(db);
}
