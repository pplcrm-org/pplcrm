import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import { hashToken } from '../../../lib/token-hash';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface ResolvedApprovalToken {
  id: string;
  tenant_id: string;
  volunteer_id: string;
  admin_user_id: string;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * One-tap "approve this volunteer" links, texted to the admin who invited them.
 *
 * A row per admin rather than per volunteer, so `approved_by` records who actually
 * tapped. Only the sha256 is stored — same reasoning as sessions, turf tokens and the
 * ops approval link: a database leak must not hand an attacker a working approve-anyone
 * URL. Single use, with a short expiry, because an approval link sitting in an SMS
 * history for a month is a standing credential.
 */
export class ApprovalTokensRepo extends BaseRepository<'companion_approval_tokens'> {
  constructor() {
    super('companion_approval_tokens');
  }

  public async create(
    input: { tenant_id: string; volunteer_id: string; admin_user_id: string; token: string; expires_at: Date },
    trx?: Transaction<Models>,
  ): Promise<void> {
    const row = {
      tenant_id: input.tenant_id,
      volunteer_id: input.volunteer_id,
      admin_user_id: input.admin_user_id,
      token_hash: hashToken(input.token),
      expires_at: input.expires_at,
    } as OperationDataType<'companion_approval_tokens', 'insert'>;
    await this.getInsert(trx).values(row).execute();
  }

  /**
   * Resolve an approval link. Intentionally NOT tenant-scoped: the admin taps this from
   * an SMS with no session, so the token is what identifies the tenant — the same bearer
   * model as `turf_assignments.resolveByToken`. Listed in `pplcrm-tenant-safety`.
   *
   * Used/expired rows come back too, so the page can say "Dana already approved this at
   * 11:04" instead of showing a stranger a dead end.
   */
  public async resolveByToken(token: string, trx?: Transaction<Models>): Promise<ResolvedApprovalToken | null> {
    const row = await this.getSelect(trx).selectAll().where('token_hash', '=', hashToken(token)).executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      volunteer_id: String(row.volunteer_id),
      admin_user_id: String(row.admin_user_id),
      expires_at: new Date(String(row.expires_at)),
      used_at: row.used_at ? new Date(String(row.used_at)) : null,
    };
  }

  /**
   * Burn every outstanding link for this volunteer, not just the one that was tapped.
   *
   * Several admins may each hold a live link for the same person. Once anyone decides,
   * the rest are stale — and a second tap that silently re-approved (or worse, revoked)
   * someone already decided on is exactly the confusing outcome this avoids.
   */
  public async markUsedForVolunteer(
    input: { tenant_id: string; volunteer_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ used_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('volunteer_id', '=', input.volunteer_id)
      .where('used_at', 'is', null)
      .execute();
  }
}
