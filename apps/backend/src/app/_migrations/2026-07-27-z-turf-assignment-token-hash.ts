import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Store canvass companion tokens hashed, like delivery-route tokens already are.
 *
 * SECURITY (finding M5): `turf_assignments.token` held the raw bearer credential in
 * plaintext. Anyone with database read access — a backup copy, a read replica, a support
 * query, an unrelated SQL-injection elsewhere — could open every active volunteer link in
 * every tenant. `delivery_routes.share_token_hash` had this right; canvassing did not.
 *
 * Existing tokens keep working: the plaintext is hashed in place, so a volunteer who
 * already has their link is unaffected. The trade is that the admin UI can no longer
 * re-display a link after the fact (the raw value no longer exists anywhere) — re-assigning
 * mints a fresh one, which is exactly how deliveries already behaves.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.turf_assignments ADD COLUMN IF NOT EXISTS token_hash text`.execute(db);

  // pgcrypto's digest() is available (the baseline creates the extension); hash in place so
  // links already in volunteers' hands keep resolving.
  await sql`
    UPDATE public.turf_assignments
       SET token_hash = encode(digest(token, 'sha256'), 'hex')
     WHERE token IS NOT NULL AND token_hash IS NULL
  `.execute(db);

  await sql`ALTER TABLE public.turf_assignments DROP CONSTRAINT IF EXISTS turf_assignments_token_key`.execute(db);
  await sql`ALTER TABLE public.turf_assignments DROP COLUMN IF EXISTS token`.execute(db);
  await sql`ALTER TABLE public.turf_assignments ALTER COLUMN token_hash SET NOT NULL`.execute(db);
  await sql`
    ALTER TABLE public.turf_assignments
      ADD CONSTRAINT turf_assignments_token_hash_key UNIQUE (token_hash)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Irreversible by design: the plaintext tokens are gone. Restore the column shape so the
  // schema matches, but every existing link is invalidated and must be re-issued.
  await sql`ALTER TABLE public.turf_assignments ADD COLUMN IF NOT EXISTS token text`.execute(db);
  await sql`UPDATE public.turf_assignments SET token = token_hash WHERE token IS NULL`.execute(db);
  await sql`ALTER TABLE public.turf_assignments ALTER COLUMN token SET NOT NULL`.execute(db);
  await sql`ALTER TABLE public.turf_assignments DROP CONSTRAINT IF EXISTS turf_assignments_token_hash_key`.execute(db);
  await sql`ALTER TABLE public.turf_assignments DROP COLUMN IF EXISTS token_hash`.execute(db);
  await sql`ALTER TABLE public.turf_assignments ADD CONSTRAINT turf_assignments_token_key UNIQUE (token)`.execute(db);
}
