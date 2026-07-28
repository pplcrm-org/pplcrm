import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import { hashToken } from '../../../lib/token-hash';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface ResolvedOrganizerToken {
  id: string;
  tenant_id: string;
  join_code_id: string;
  admin_user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * The credential behind `/o/:token` — the organizer's mobile page.
 *
 * Deliberately a separate table from `companion_approval_tokens` even though both are
 * hashed bearer links texted to an admin. They answer different questions: an approval
 * token names ONE volunteer and dies on the first tap; an organizer token names one JOIN
 * CODE and stays usable for the length of a launch, approving whoever shows up. Folding
 * them together would mean a nullable subject column and a lifetime rule that depends on
 * which column is set — two semantics wearing one table.
 *
 * Scoping to the join code is the containment: whoever holds this URL can approve the
 * people who scanned that poster, and reach nothing else in the workspace.
 */
export class OrganizerTokensRepo extends BaseRepository<'companion_organizer_tokens'> {
  constructor() {
    super('companion_organizer_tokens');
  }

  public async create(
    input: { tenant_id: string; join_code_id: string; admin_user_id: string; token: string; expires_at: Date },
    trx?: Transaction<Models>,
  ): Promise<void> {
    const row = {
      tenant_id: input.tenant_id,
      join_code_id: input.join_code_id,
      admin_user_id: input.admin_user_id,
      token_hash: hashToken(input.token),
      expires_at: input.expires_at,
    } as OperationDataType<'companion_organizer_tokens', 'insert'>;
    await this.getInsert(trx).values(row).execute();
  }

  /**
   * Resolve an organizer link. Intentionally NOT tenant-scoped: the organizer opens this
   * from an SMS with no session, so the token is what identifies the tenant — the same
   * bearer model as `turf_assignments.resolveByToken`. Listed in `pplcrm-tenant-safety`.
   *
   * Revoked and expired rows come back too, so the caller decides; the page then answers
   * with one uniform 'dead' rather than explaining which of the two it was.
   */
  public async resolveByToken(token: string, trx?: Transaction<Models>): Promise<ResolvedOrganizerToken | null> {
    const row = await this.getSelect(trx).selectAll().where('token_hash', '=', hashToken(token)).executeTakeFirst();
    if (!row) return null;
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      join_code_id: String(row.join_code_id),
      admin_user_id: String(row.admin_user_id),
      expires_at: new Date(String(row.expires_at)),
      revoked_at: row.revoked_at ? new Date(String(row.revoked_at)) : null,
    };
  }

  /**
   * Kill every outstanding organizer link for a code.
   *
   * Rotating a join code already kills the poster; leaving the phone link alive would mean
   * the printed code stopped working while the credential handed out alongside it kept
   * approving people. The two have to die together.
   */
  public async revokeForJoinCode(
    input: { tenant_id: string; join_code_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('join_code_id', '=', input.join_code_id)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
