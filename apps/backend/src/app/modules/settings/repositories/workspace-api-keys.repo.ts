import type { Insertable } from 'kysely';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

/** A workspace may hold two live keys at once so a rotation can overlap. See the 2026-07-27 migration. */
export const MAX_KEYS_PER_TENANT = 2;
export const KEY_SLOTS = [1, 2] as const;

export class WorkspaceApiKeysRepo extends BaseRepository<'workspace_api_keys'> {
  constructor() {
    super('workspace_api_keys');
  }

  public async listByTenantId(tenantId: string) {
    return this.getSelect().selectAll().where('tenant_id', '=', tenantId).orderBy('slot', 'asc').execute();
  }

  // Cross-tenant BY DESIGN: this resolves which tenant owns a presented API key, so there is
  // no tenant_id to scope by (same posture as the former Zapier settings-table lookup,
  // SECURITY-REVIEW.md 2.4). The no-unscoped-db-query rule cannot see through getSelect(),
  // so this carries no disable comment — this note is the reviewed justification.
  public async getByKeyHash(keyHash: string) {
    return this.getSelect().selectAll().where('key_hash', '=', keyHash).executeTakeFirst();
  }

  /**
   * Insert into a specific slot. The caller picks the free slot; `uq_workspace_api_keys_tenant_slot`
   * is what actually enforces the two-key cap, so two concurrent creates cannot both land — one
   * raises 23505 and the controller turns it into a CONFLICT rather than silently issuing a third
   * credential.
   */
  public async createInSlot(tenantId: string, slot: number, keyHash: string, keyPreview: string) {
    const row: Insertable<Models['workspace_api_keys']> = {
      tenant_id: tenantId,
      slot,
      key_hash: keyHash,
      key_preview: keyPreview,
      created_at: new Date(),
    };

    return this.getInsert().values(row).returningAll().executeTakeFirst();
  }

  /**
   * Stamp the audit trail on ONE key.
   *
   * Keyed by id as well as tenant, not by tenant alone: with two live keys a tenant-keyed update
   * marked both as used on every request, which is exactly backwards — `last_used_at` exists so
   * you can tell which key is still in service before revoking the other one. Callers already
   * hold the row from `getByKeyHash`, so both values are free.
   */
  public async updateLastUsed(tenantId: string, id: string) {
    return this.getUpdate()
      .set({ last_used_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  public async deleteByTenantAndSlot(tenantId: string, slot: number) {
    return this.getDelete().where('tenant_id', '=', tenantId).where('slot', '=', slot).execute();
  }

  public async deleteByTenantId(tenantId: string) {
    return this.getDelete().where('tenant_id', '=', tenantId).execute();
  }
}
