import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Zapier REST-hook subscriptions — restore the arbiter index the upsert depends on.
 *
 * `ZapierService.subscribe()` upserts with
 * `.onConflict(oc.columns(['tenant_id', 'event_type']).doUpdateSet(...))`, which requires a
 * UNIQUE constraint/index on (tenant_id, event_type) as the conflict arbiter. That constraint
 * lives in the baseline `schema.sql` (`zapier_subscriptions_tenant_id_event_type_key`), but it
 * was added there without a dated migration — so databases provisioned before it reached the
 * baseline (prod) never got it, and every `subscribe()` call fails with Postgres 42P10
 * ("no unique or exclusion constraint matching the ON CONFLICT specification"). REST-hook
 * subscriptions can therefore never be created on those databases.
 *
 * This migration ensures the constraint exists on every database, reusing the EXACT name the
 * baseline uses so fresh-bootstrap and migrated databases converge on the same object name
 * (avoiding the kind of name divergence that bit workspace_api_keys).
 *
 * Idempotent: on a fresh database the baseline already created the constraint, so the guarded
 * ADD CONSTRAINT catches `duplicate_object` and no-ops. The pre-dedupe is defensive — because
 * inserts have been failing there are almost certainly no duplicate (tenant_id, event_type)
 * rows, but if any exist (e.g. from a direct write path) we keep the newest so the constraint
 * can still be created.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Defensive de-duplicate: keep the newest row per (tenant_id, event_type).
  // Runs with no app.tenant_id GUC set, so RLS permits every row (see pplcrm-migrations).
  await sql`
    DELETE FROM public.zapier_subscriptions a
    USING public.zapier_subscriptions b
    WHERE a.tenant_id = b.tenant_id
      AND a.event_type = b.event_type
      AND a.id < b.id
  `.execute(db);

  // Add the constraint only if it isn't already present. A fresh database already has it from the
  // baseline, where it exists as a named UNIQUE constraint backed by an index — re-adding it raises
  // 42P07 (duplicate_table, for the index relation), which is NOT the duplicate_object a bare
  // EXCEPTION handler would catch, so guard explicitly on pg_constraint instead.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'zapier_subscriptions_tenant_id_event_type_key'
          AND conrelid = 'public.zapier_subscriptions'::regclass
      ) THEN
        ALTER TABLE ONLY public.zapier_subscriptions
          ADD CONSTRAINT zapier_subscriptions_tenant_id_event_type_key UNIQUE (tenant_id, event_type);
      END IF;
    END
    $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.zapier_subscriptions
      DROP CONSTRAINT IF EXISTS zapier_subscriptions_tenant_id_event_type_key
  `.execute(db);
}
