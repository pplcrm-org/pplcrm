import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * A front door for volunteers who are not in the database yet, and one-tap approval by SMS.
 *
 * Until now a volunteer had to already exist as a person before anyone could hand them a
 * companion link, which leaves an organizer standing in a parking lot with five new people
 * and no path at all. `campaign_join_codes` is that path: an admin shows a QR code, the
 * volunteer scans it, names themselves and one contact, and lands in the SAME verify →
 * approve gate everyone else goes through. Nothing about the trust model moves — an admin
 * still has to approve each person once — only the paperwork moves earlier.
 *
 * `turf_id` set   → everyone who scans that QR is put on that turf, so a group can start
 *                   walking together off one poster.
 * `turf_id` null  → they land on the turf picker (see `app.canvass_volunteer_roam`).
 *
 * `code` is 8 characters from a Crockford-style alphabet (no 0/O/1/I) because it doubles as
 * a typeable fallback for a phone that cannot scan, and it is UNIQUE **globally** rather
 * than per tenant: the scan arrives with no session and no tenant context, so the code is
 * what resolves the tenant. Same idiom as `turf_assignments.token`.
 *
 * `companion_approval_tokens` is the approve-by-text counterpart. Only the sha256 is stored
 * — a database leak must not hand an attacker a working approve-anybody link — and a row is
 * minted per admin so `approved_by` records who actually tapped, not merely that someone did.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.campaign_join_codes (
      id           bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id    bigint      NOT NULL,
      campaign_id  bigint,
      turf_id      bigint,
      code         text        NOT NULL,
      label        text,
      status       text        NOT NULL DEFAULT 'active',
      expires_at   timestamptz,
      max_uses     integer,
      use_count    integer     NOT NULL DEFAULT 0,
      createdby_id bigint      NOT NULL,
      updatedby_id bigint      NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT campaign_join_codes_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT campaign_join_codes_id_key UNIQUE (id),
      CONSTRAINT campaign_join_codes_code_key UNIQUE (code),
      CONSTRAINT chk_cjc_status CHECK (status IN ('active', 'revoked')),
      CONSTRAINT chk_cjc_max_uses CHECK (max_uses IS NULL OR max_uses > 0)
    )
  `.execute(db);

  // The admin-facing list: the live codes for one campaign.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_campaign_join_codes_campaign
      ON public.campaign_join_codes (tenant_id, campaign_id, status)
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS public.companion_approval_tokens (
      id            bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
      tenant_id     bigint      NOT NULL,
      volunteer_id  bigint      NOT NULL,
      admin_user_id bigint      NOT NULL,
      token_hash    text        NOT NULL,
      expires_at    timestamptz NOT NULL,
      used_at       timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT companion_approval_tokens_pk PRIMARY KEY (id, tenant_id),
      CONSTRAINT companion_approval_tokens_id_key UNIQUE (id),
      CONSTRAINT companion_approval_tokens_token_key UNIQUE (token_hash)
    )
  `.execute(db);

  // Superseding a volunteer's outstanding approval links when someone decides.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_companion_approval_tokens_volunteer
      ON public.companion_approval_tokens (tenant_id, volunteer_id)
  `.execute(db);

  // The join handshake: the scan mints a claim, the verify step redeems it. Kept on the
  // volunteer row rather than a table of its own because it is one live claim per volunteer
  // by definition — a second scan replaces the first.
  await sql`
    ALTER TABLE public.companion_volunteers
      ADD COLUMN IF NOT EXISTS join_claim_hash       text,
      ADD COLUMN IF NOT EXISTS join_claim_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS join_code_id          bigint
  `.execute(db);

  // Same reasoning as the approval token: the claim resolves a volunteer with no session
  // and no tenant context, so it is looked up by hash alone and must not collide.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_companion_volunteers_join_claim
      ON public.companion_volunteers (join_claim_hash)
      WHERE join_claim_hash IS NOT NULL
  `.execute(db);

  // Tenant isolation, copied verbatim from the companion_volunteers policy: the GUC is
  // absent on the un-scoped public paths (resolving a code, resolving an approval token),
  // and the NULLIF branch is what lets those run at all. Every tenant-scoped read still
  // carries its own .where('tenant_id', ...) — RLS is the second lock, not the first.
  for (const table of ['campaign_join_codes', 'companion_approval_tokens'] as const) {
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
  await sql`DROP INDEX IF EXISTS public.idx_companion_volunteers_join_claim`.execute(db);
  await sql`
    ALTER TABLE public.companion_volunteers
      DROP COLUMN IF EXISTS join_code_id,
      DROP COLUMN IF EXISTS join_claim_expires_at,
      DROP COLUMN IF EXISTS join_claim_hash
  `.execute(db);
  await sql`DROP TABLE IF EXISTS public.companion_approval_tokens`.execute(db);
  await sql`DROP TABLE IF EXISTS public.campaign_join_codes`.execute(db);
}
