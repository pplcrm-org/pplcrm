import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Beta gate: a newly signed-up tenant is held until pplCRM ops approves it.
 *
 * Signup itself still runs in full (tenant, owner, seed data, verification email) — the
 * account simply cannot be signed into until `approval_status = 'approved'`. Ops approves
 * from a one-click link mailed to the ops inbox, authenticated by `approval_token_hash`.
 *
 * The column DEFAULTs to 'pending' on purpose: this is an access gate, so a row that some
 * future code path inserts without naming a status must fail CLOSED, not open. Existing
 * tenants are grandfathered by the explicit backfill below — they signed up before the gate
 * existed and must not be locked out by it.
 *
 * Only the hash of the approval token is stored (same reasoning as sessions and
 * turf-assignment tokens): a database leak must not hand an attacker a working
 * approve-anything link. The token is single-use — the hash is cleared once ops decides.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.tenants
      ADD COLUMN IF NOT EXISTS approval_status       text        NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS approval_requested_at timestamptz,
      ADD COLUMN IF NOT EXISTS approved_at           timestamptz,
      ADD COLUMN IF NOT EXISTS declined_at           timestamptz,
      ADD COLUMN IF NOT EXISTS approval_token_hash   text
  `.execute(db);

  // Grandfather everything that already exists. Runs before the CHECK constraint so the
  // backfill can never be the thing that trips it.
  await sql`
    UPDATE public.tenants
       SET approval_status = 'approved',
           approved_at     = COALESCE(approved_at, created_at)
     WHERE approval_status = 'pending'
  `.execute(db);

  // 'declined' is a distinct ops decision, but it deliberately shows the user the same
  // "still on the waitlist" message as 'pending' — see tenant-approval.ts.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tenants_approval_status_check'
      ) THEN
        ALTER TABLE public.tenants
          ADD CONSTRAINT tenants_approval_status_check
          CHECK (approval_status IN ('pending', 'approved', 'declined'));
      END IF;
    END $$
  `.execute(db);

  // The ops link is looked up by token hash alone (there is no session and no tenant
  // context on that request), so the lookup needs an index, and two tenants sharing a
  // token would be a cross-account approval bug — hence UNIQUE. Partial, because the hash
  // is NULLed on decision and NULLs must not collide.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_approval_token_hash
      ON public.tenants (approval_token_hash)
      WHERE approval_token_hash IS NOT NULL
  `.execute(db);

  // Supports the ops view of who is still waiting.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_tenants_approval_status_pending
      ON public.tenants (approval_requested_at)
      WHERE approval_status = 'pending'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS public.idx_tenants_approval_status_pending`.execute(db);
  await sql`DROP INDEX IF EXISTS public.idx_tenants_approval_token_hash`.execute(db);
  await sql`ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_approval_status_check`.execute(db);
  await sql`
    ALTER TABLE public.tenants
      DROP COLUMN IF EXISTS approval_token_hash,
      DROP COLUMN IF EXISTS declined_at,
      DROP COLUMN IF EXISTS approved_at,
      DROP COLUMN IF EXISTS approval_requested_at,
      DROP COLUMN IF EXISTS approval_status
  `.execute(db);
}
