import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Group coordination: who is on which street, and the page an organizer holds at a launch.
 *
 * `turf_segment_claims` is **advisory and nothing else**. Five people walking one turf need
 * to divide it, and the street is the unit they divide it by (see `deriveSegments`). A claim
 * says "Dana is on Scott Blvd" so the next person picks a different street — it does not,
 * and must never, stop anyone knocking any door. Nothing reads it as permission; the walk
 * list and the results endpoints do not consult it at all. That is why there is no unique
 * constraint on `(turf_id, street_key)`: two people on one street is a decision they are
 * allowed to make, not a race to be arbitrated.
 *
 * What IS unique is one live claim per assignment: picking a new street releases the old
 * one, so a volunteer can never appear to be standing in two places. `expires_at` is the
 * answer to a phone going into a pocket at the end of a shift — a claim that outlived its
 * shift would quietly tell tomorrow's group that a street is taken.
 *
 * `companion_organizer_tokens` is the credential behind `/o/:token`, the mobile page an
 * organizer opens at a canvass launch: the join QR big enough to hold up, and the people
 * who scanned it waiting for approval. It is a bearer token in an SMS, so it is stored as
 * a sha256 only, is scoped to ONE join code (it can approve the people who scanned that
 * poster and nobody else), and expires in hours rather than days — the length of a shift,
 * not a standing grant. Revoking is a column rather than a delete so "this link was killed"
 * stays visible.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.turf_segment_claims (
      id                  bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id           bigint      NOT NULL,
      turf_id             bigint      NOT NULL,
      assignment_id       bigint      NOT NULL,
      volunteer_person_id bigint      NOT NULL,
      street_key          text        NOT NULL,
      street_label        text        NOT NULL,
      canvasser_name      text        NOT NULL,
      claimed_at          timestamptz NOT NULL DEFAULT now(),
      expires_at          timestamptz NOT NULL,
      released_at         timestamptz,
      CONSTRAINT turf_segment_claims_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT turf_segment_claims_id_key UNIQUE (id)
    )
  `.execute(db);

  // One live claim per volunteer per turf — taking a street releases the last one.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_turf_segment_claims_live_assignment
      ON public.turf_segment_claims (tenant_id, turf_id, assignment_id)
      WHERE released_at IS NULL
  `.execute(db);

  // The read behind every turf payload: who is on this turf's streets right now.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_turf_segment_claims_live_turf
      ON public.turf_segment_claims (tenant_id, turf_id)
      WHERE released_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.companion_organizer_tokens (
      id            bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id     bigint      NOT NULL,
      join_code_id  bigint      NOT NULL,
      admin_user_id bigint      NOT NULL,
      token_hash    text        NOT NULL,
      expires_at    timestamptz NOT NULL,
      revoked_at    timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT companion_organizer_tokens_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT companion_organizer_tokens_id_key UNIQUE (id),
      CONSTRAINT companion_organizer_tokens_token_key UNIQUE (token_hash)
    )
  `.execute(db);

  // Killing every outstanding organizer link when its join code is rotated or revoked.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_organizer_tokens_code
      ON public.companion_organizer_tokens (tenant_id, join_code_id)
  `.execute(db);

  // Tenant isolation, copied verbatim from the companion_volunteers policy. The GUC is
  // absent on the un-scoped public paths (resolving an organizer token), and the NULLIF
  // branch is what lets those run at all. Every tenant-scoped read still carries its own
  // .where('tenant_id', ...) — RLS is the second lock, not the first.
  for (const table of ['turf_segment_claims', 'companion_organizer_tokens'] as const) {
    await sql`ALTER TABLE public.${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE public.${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`DROP POLICY IF EXISTS tenant_isolation ON public.${sql.raw(table)}`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation ON public.${sql.raw(table)}
        USING (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
        WITH CHECK (
          NULLIF(current_setting('app.tenant_id', true), '') IS NULL
          OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        )
    `.execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.companion_organizer_tokens`.execute(db);
  await sql`DROP TABLE IF EXISTS public.turf_segment_claims`.execute(db);
}
