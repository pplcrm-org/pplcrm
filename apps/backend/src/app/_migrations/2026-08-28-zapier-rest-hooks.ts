import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Zapier REST hooks: a tenant may now hold SEVERAL webhook subscriptions per event type —
 * each Zap subscribes with its own generated hook URL, so UNIQUE (tenant_id, event_type)
 * (one URL per event, upserted in place) made a second Zap silently overwrite the first.
 * The replacement uniqueness is the full (tenant_id, event_type, webhook_url) triple: it
 * dedupes an identical re-subscribe, and its (tenant_id, event_type) prefix keeps serving
 * the trigger-time lookup that the old constraint's index provided.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.zapier_subscriptions DROP CONSTRAINT IF EXISTS zapier_subscriptions_tenant_id_event_type_key`.execute(
    db,
  );
  await sql`ALTER TABLE public.zapier_subscriptions ADD CONSTRAINT uq_zapier_subscriptions_tenant_event_url UNIQUE (tenant_id, event_type, webhook_url)`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE public.zapier_subscriptions DROP CONSTRAINT IF EXISTS uq_zapier_subscriptions_tenant_event_url`.execute(
    db,
  );
  // Collapse to one row per (tenant, event) before restoring the narrower constraint.
  await sql`
    DELETE FROM public.zapier_subscriptions a
      USING public.zapier_subscriptions b
      WHERE a.tenant_id = b.tenant_id
        AND a.event_type = b.event_type
        AND a.id > b.id
  `.execute(db);
  await sql`ALTER TABLE public.zapier_subscriptions ADD CONSTRAINT zapier_subscriptions_tenant_id_event_type_key UNIQUE (tenant_id, event_type)`.execute(
    db,
  );
}
