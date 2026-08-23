import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Donor self-service portal ("giving portal").
 *
 * - donor_portal_links: revocable bearer tokens (sha256-hashed at rest) that let a donor open
 *   https://<org>.pplforms.com/g/<token>. Multiple live links per person are allowed on purpose:
 *   a link rides every donor document email, and minting a new one must not kill the link sitting
 *   in last month's inbox. Staff revocation clears all live links for the person at once.
 *   The composite (person_id, tenant_id) FK cascades so a deleted person's links die with them.
 * - campaign_subscriptions.consent_source and delivery_requests.source each gain 'donor_portal'
 *   so consent and yard-sign requests made from the portal carry honest provenance.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE public.donor_portal_links (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      tenant_id     bigint NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
      person_id     bigint NOT NULL,
      token_hash    text   NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      createdby_id  bigint,
      expires_at    timestamptz NOT NULL,
      revoked_at    timestamptz,
      last_used_at  timestamptz,
      CONSTRAINT donor_portal_links_token_hash_key UNIQUE (token_hash),
      CONSTRAINT fk_dpl_person FOREIGN KEY (person_id, tenant_id)
        REFERENCES public.persons(id, tenant_id) ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX idx_dpl_person ON public.donor_portal_links (tenant_id, person_id)`.execute(db);

  await sql`ALTER TABLE public.donor_portal_links ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.donor_portal_links FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation ON public.donor_portal_links
      USING (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL)
        OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)))
      WITH CHECK (((NULLIF(current_setting('app.tenant_id'::text, true), ''::text) IS NULL)
        OR (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::bigint)))
  `.execute(db);

  await sql`ALTER TABLE public.campaign_subscriptions DROP CONSTRAINT chk_csub_source`.execute(db);
  await sql`
    ALTER TABLE public.campaign_subscriptions ADD CONSTRAINT chk_csub_source
      CHECK ((consent_source = ANY (ARRAY['form'::text, 'import'::text, 'manual'::text, 'copied'::text, 'canvass'::text, 'donor_portal'::text])))
  `.execute(db);

  await sql`ALTER TABLE public.delivery_requests DROP CONSTRAINT chk_delivery_requests_source`.execute(db);
  await sql`
    ALTER TABLE public.delivery_requests ADD CONSTRAINT chk_delivery_requests_source
      CHECK ((source = ANY (ARRAY['web_form'::text, 'manual'::text, 'canvass'::text, 'donor_portal'::text])))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.delivery_requests DROP CONSTRAINT chk_delivery_requests_source`.execute(db);
  await sql`
    ALTER TABLE public.delivery_requests ADD CONSTRAINT chk_delivery_requests_source
      CHECK ((source = ANY (ARRAY['web_form'::text, 'manual'::text, 'canvass'::text])))
  `.execute(db);
  await sql`ALTER TABLE public.campaign_subscriptions DROP CONSTRAINT chk_csub_source`.execute(db);
  await sql`
    ALTER TABLE public.campaign_subscriptions ADD CONSTRAINT chk_csub_source
      CHECK ((consent_source = ANY (ARRAY['form'::text, 'import'::text, 'manual'::text, 'copied'::text, 'canvass'::text])))
  `.execute(db);
  await sql`DROP TABLE IF EXISTS public.donor_portal_links`.execute(db);
}
