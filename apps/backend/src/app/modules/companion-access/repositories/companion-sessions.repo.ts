import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface CompanionSession {
  id: string;
  tenant_id: string;
  volunteer_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export class CompanionSessionsRepo extends BaseRepository<'companion_sessions'> {
  constructor() {
    super('companion_sessions');
  }

  public async create(
    input: { tenant_id: string; volunteer_id: string; token_hash: string; expires_at: Date; user_agent: string | null },
    trx?: Transaction<Models>,
  ): Promise<void> {
    const row = {
      tenant_id: input.tenant_id,
      volunteer_id: input.volunteer_id,
      token_hash: input.token_hash,
      expires_at: input.expires_at,
      user_agent: input.user_agent,
    } as OperationDataType<'companion_sessions', 'insert'>;
    await this.getInsert(trx).values(row).execute();
  }

  /**
   * Resolve a device-session token to its session. Like the assignment/route
   * token lookups, this is intentionally NOT tenant-scoped: the (hashed) token
   * IS the credential and is what identifies the tenant. Every downstream check
   * then re-verifies tenant + volunteer match.
   */
  public async findByTokenHash(token_hash: string): Promise<CompanionSession | null> {
    // eslint-disable-next-line local/no-unscoped-db-query
    const row = await BaseRepository.dbInstance
      .selectFrom('companion_sessions')
      .select(['id', 'tenant_id', 'volunteer_id', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', token_hash)
      .executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      volunteer_id: String(row.volunteer_id),
      expires_at: new Date(String(row.expires_at)),
      revoked_at: row.revoked_at ? new Date(String(row.revoked_at)) : null,
    };
  }

  public async touchLastUsed(input: { tenant_id: string; id: string }): Promise<void> {
    await this.getUpdate()
      .set({ last_used_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  /**
   * Kill ONE device session — "end shift on this device".
   *
   * Tenant-scoped, unlike `findByTokenHash` above: the caller has already resolved the
   * session from its token, so the tenant is known and there is no reason to widen the
   * write. Idempotent, and the `revoked_at is null` guard keeps the original revocation
   * time when a second call arrives.
   */
  public async revokeById(input: { tenant_id: string; id: string }): Promise<void> {
    await this.getUpdate()
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Revoking a volunteer dead-ends every device they ever verified. */
  public async revokeForVolunteer(
    input: { tenant_id: string; volunteer_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('volunteer_id', '=', input.volunteer_id)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
