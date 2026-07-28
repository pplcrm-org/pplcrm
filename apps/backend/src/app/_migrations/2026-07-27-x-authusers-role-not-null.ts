import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Make `authusers.role` NOT NULL.
 *
 * (The `-x-` segment is the same-day tie-break from the migrations skill: Kysely runs
 * files in lexicographic order and refuses a new name that sorts before an already-applied
 * one, so this must sort after `2026-07-27-workspace-api-keys-two-slots`.)
 *
 * SECURITY (C2): the column was nullable and the CHECK constraint explicitly allowed
 * NULL. `inviteUser` inserted NULL whenever the caller named no role and the tenant had
 * no `access.default_role` setting, so unroled accounts were reachable in normal use.
 *
 * Every permission check in the user-management path was written as "deny if the role is
 * 'user'", which a NULL role passes — making an unroled invitee strictly more privileged
 * than an Editor, including the ability to change other users' roles. Those checks are now
 * deny-by-default (isPrivilegedRole), and this migration removes the state itself so the
 * next such check cannot reintroduce the hole.
 *
 * Existing NULLs are backfilled to the least-privileged working role ('user' = Editor),
 * which is what the invite path would have assigned had a default been configured.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`UPDATE public.authusers SET role = 'user' WHERE role IS NULL`.execute(db);

  // Replace the permissive CHECK (which allowed NULL) before adding NOT NULL, so the
  // column has exactly one source of truth about what a valid role is.
  await sql`ALTER TABLE public.authusers DROP CONSTRAINT IF EXISTS chk_authusers_role`.execute(db);
  await sql`
    ALTER TABLE public.authusers
      ADD CONSTRAINT chk_authusers_role
      CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'user'::text, 'viewer'::text]))
  `.execute(db);
  await sql`ALTER TABLE public.authusers ALTER COLUMN role SET NOT NULL`.execute(db);
  await sql`ALTER TABLE public.authusers ALTER COLUMN role SET DEFAULT 'user'`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.authusers ALTER COLUMN role DROP DEFAULT`.execute(db);
  await sql`ALTER TABLE public.authusers ALTER COLUMN role DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE public.authusers DROP CONSTRAINT IF EXISTS chk_authusers_role`.execute(db);
  await sql`
    ALTER TABLE public.authusers
      ADD CONSTRAINT chk_authusers_role
      CHECK (((role IS NULL) OR (role = ANY (ARRAY['owner'::text, 'admin'::text, 'user'::text, 'viewer'::text]))))
  `.execute(db);
}
