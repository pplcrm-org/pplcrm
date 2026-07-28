import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Let a workspace hold two API keys at once, so a key can be rotated without an outage.
 *
 * Until now `uq_workspace_api_keys_tenant_id` allowed exactly one row per tenant, and the only
 * way to replace a key was an upsert that invalidated the old one in the same statement. That
 * makes rotation strictly destructive: every integration breaks the instant the button is
 * clicked, and the only way back is pasting the new key everywhere fast. Two slots turn it into
 * the standard overlap flow — issue the second key, move integrations across, revoke the first.
 *
 * Two, not unlimited: the whole point is an overlap window, and each extra live credential is
 * another thing that can leak while nobody is watching it. `slot` makes the cap a database
 * invariant rather than a count-then-insert race (the same shape of bug as the duplicate list
 * names fixed in 2026-07-26-list-name-unique).
 *
 * `key_hash` also picks up a real UNIQUE. It was only indexed, so nothing stopped the same hash
 * being stored twice — astronomically unlikely for a 256-bit token, but `lookupTenantByApiKey`
 * resolves a caller's tenant from it, and "which tenant does this key belong to" must have
 * exactly one answer.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.workspace_api_keys
      DROP CONSTRAINT IF EXISTS uq_workspace_api_keys_tenant_id
  `.execute(db);

  // Every pre-existing row is the tenant's first (and, under the old constraint, only) key.
  await sql`
    ALTER TABLE public.workspace_api_keys
      ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 1
  `.execute(db);

  await sql`
    ALTER TABLE public.workspace_api_keys
      DROP CONSTRAINT IF EXISTS chk_workspace_api_keys_slot
  `.execute(db);
  await sql`
    ALTER TABLE public.workspace_api_keys
      ADD CONSTRAINT chk_workspace_api_keys_slot CHECK (slot IN (1, 2))
  `.execute(db);

  await sql`
    ALTER TABLE public.workspace_api_keys
      ADD CONSTRAINT uq_workspace_api_keys_tenant_slot UNIQUE (tenant_id, slot)
  `.execute(db);

  // The plain index is redundant once the unique constraint below creates its own.
  await sql`DROP INDEX IF EXISTS public.idx_workspace_api_keys_key_hash`.execute(db);
  await sql`
    ALTER TABLE public.workspace_api_keys
      ADD CONSTRAINT uq_workspace_api_keys_key_hash UNIQUE (key_hash)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE public.workspace_api_keys
      DROP CONSTRAINT IF EXISTS uq_workspace_api_keys_key_hash
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_key_hash
      ON public.workspace_api_keys USING btree (key_hash)
  `.execute(db);

  // Reverting to one key per tenant has to pick a survivor; keep slot 1, the original key.
  await sql`DELETE FROM public.workspace_api_keys WHERE slot <> 1`.execute(db);

  await sql`
    ALTER TABLE public.workspace_api_keys
      DROP CONSTRAINT IF EXISTS uq_workspace_api_keys_tenant_slot
  `.execute(db);
  await sql`
    ALTER TABLE public.workspace_api_keys
      DROP CONSTRAINT IF EXISTS chk_workspace_api_keys_slot
  `.execute(db);
  await sql`ALTER TABLE public.workspace_api_keys DROP COLUMN IF EXISTS slot`.execute(db);

  await sql`
    ALTER TABLE public.workspace_api_keys
      ADD CONSTRAINT uq_workspace_api_keys_tenant_id UNIQUE (tenant_id)
  `.execute(db);
}
