import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Keeps Donations reachable in every workspace that predates organization modes.
 *
 * `office` is DEFAULT_ORG_MODE (libs/common/src/lib/org-mode.ts), and a workspace created before
 * modes existed has no `workspace.mode` settings row at all — it resolves to office. That mode's
 * Donations default just flipped to false, because a publicly funded constituency office does not
 * fundraise; its riding association does.
 *
 * The override map read by `isModuleEnabled` is SPARSE on purpose: it records only what the user
 * actually toggled, so an untouched module re-resolves to whatever the mode's default is TODAY.
 * That is what makes switching modes work, and it is also what would make this change remove the
 * Donations nav entry from every existing workspace — including ones with a populated ledger, whose
 * only symptom would be a page that quietly stopped being linked. Nothing is deleted, which is
 * precisely why nobody would notice.
 *
 * So: stamp an EXPLICIT `donations: true` into every existing tenant's override map, merged over
 * whatever is already there. After this runs, "existing workspace" means "a user decision I must
 * honour" rather than "a default I am free to reinterpret" — and new office signups (which have no
 * row here) start without Donations, as intended.
 *
 * Two statements because the row may not exist yet: merge into the map where there is one, insert
 * it where there is not. Both leave an existing `donations` entry alone — a user who deliberately
 * turned Donations OFF must not have it resurrected as true (the `NOT (value ? 'donations')` guard,
 * belt-and-braces with the `||` ordering, which also lets the stored value win).
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Tenants that already have a stored override map: merge donations:true UNDER their own values,
  // so any explicit choice they made (including false) still wins.
  await sql`
    UPDATE public.settings
       SET value      = '{"donations": true}'::jsonb || value,
           updated_at = now()
     WHERE key = 'workspace.modules'
       AND jsonb_typeof(value) = 'object'
       AND NOT (value ? 'donations')
  `.execute(db);

  // Tenants with no override map at all — the common case for a pre-modes workspace.
  await sql`
    INSERT INTO public.settings (tenant_id, key, value)
    SELECT t.id, 'workspace.modules', '{"donations": true}'::jsonb
      FROM public.tenants t
     WHERE NOT EXISTS (
             SELECT 1
               FROM public.settings s
              WHERE s.tenant_id = t.id
                AND s.key       = 'workspace.modules'
           )
  `.execute(db);
}

/**
 * Reverting drops only the key this migration added, and only where it is now the sole entry —
 * a map the user has since edited is their data, not this migration's.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DELETE FROM public.settings
     WHERE key   = 'workspace.modules'
       AND value = '{"donations": true}'::jsonb
  `.execute(db);

  await sql`
    UPDATE public.settings
       SET value      = value - 'donations',
           updated_at = now()
     WHERE key = 'workspace.modules'
       AND jsonb_typeof(value) = 'object'
  `.execute(db);
}
