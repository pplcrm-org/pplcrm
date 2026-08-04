import type { Transaction } from 'kysely';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../../lib/base.repo';
import { hashToken } from '../../../lib/token-hash';

/**
 * One row of the "where am I signed in" list. Deliberately does NOT carry `session_id` or
 * `refresh_token`: both columns hold hashes of the tokens the auth gates accept, so neither may
 * leave the server. A row is identified to the client by its own primary key, which authenticates
 * nothing on its own — the revoke path re-checks ownership before deleting.
 */
export interface ActiveSessionRow {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  /** True for the session making the request, so the UI can say "this device". */
  is_current: boolean;
}

export class SessionsRepo extends BaseRepository<'sessions'> {
  constructor() {
    super('sessions');
  }

  public async deleteBySessionId(session_id: string, trx?: Transaction<Models>) {
    const result = await this.getDelete(trx).where('session_id', '=', hashToken(session_id)).executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  }

  public async deleteByUserId(user_id: string, tenant_id: string, trx?: Transaction<Models>) {
    return this.getDelete(trx).where('user_id', '=', user_id).where('tenant_id', '=', tenant_id).executeTakeFirst();
  }

  /**
   * Every session that can still authenticate as this user, for the "where am I signed in" screen.
   *
   * Scoped by BOTH user_id and tenant_id — a user must never see a colleague's sessions, and the
   * same account id in another workspace is a different person's row.
   *
   * The filters mirror what the auth middleware in `trpc.ts` accepts, so the list never shows a
   * row that is already dead: status must be 'active' (a 'rotated' row is refused by the gates)
   * and the row must not have passed its absolute expiry.
   *
   * `currentSessionHash` is the SHA-256 of the caller's plaintext session id — compared here, in
   * SQL, so the hash column itself never has to be selected into application memory.
   */
  public async getActiveByUserId(
    user_id: string,
    tenant_id: string,
    currentSessionHash: string,
    trx?: Transaction<Models>,
  ): Promise<ActiveSessionRow[]> {
    const rows = await this.getSelect(trx)
      .select((eb) => [
        'id',
        'ip_address',
        'user_agent',
        'created_at',
        'last_used_at',
        'expires_at',
        eb('session_id', '=', currentSessionHash).as('is_current'),
      ])
      .where('user_id', '=', user_id)
      .where('tenant_id', '=', tenant_id)
      .where('status', '=', 'active')
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', new Date())]))
      // Most recently used first. `last_used_at` is stamped on creation and on every refresh
      // rotation, so it is the closest thing to "when was this device last active"; NULLS LAST
      // keeps any legacy row without one at the bottom rather than the top.
      .orderBy('last_used_at', (ob) => ob.desc().nullsLast())
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map((row) => ({
      id: String(row.id),
      ip_address: row.ip_address ?? '',
      user_agent: row.user_agent ?? '',
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      is_current: row.is_current === true,
    }));
  }

  /**
   * The owning user of one session row, for the ownership check the revoke path runs before it
   * deletes anything, plus whether that row is the caller's own session (so the caller can clear
   * its refresh cookie instead of leaving a cookie behind that points at a deleted row).
   *
   * Tenant-scoped; returns undefined when no such row exists in this workspace. As with the list
   * above, the `session_id` hash is compared in SQL and never selected.
   */
  public getOwnershipById(id: string, tenant_id: string, currentSessionHash: string, trx?: Transaction<Models>) {
    return this.getSelect(trx)
      .select((eb) => ['user_id', eb('session_id', '=', currentSessionHash).as('is_current')])
      .where('id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .executeTakeFirst();
  }

  /**
   * Revoke one session by its row id. The user_id and tenant_id filters are defence in depth: the
   * caller has already proved ownership via `getOwnerById`, and this makes the delete itself
   * incapable of touching another user's row even if that check were removed.
   */
  public async deleteByIdForUser(id: string, user_id: string, tenant_id: string, trx?: Transaction<Models>) {
    const result = await this.getDelete(trx)
      .where('id', '=', id)
      .where('user_id', '=', user_id)
      .where('tenant_id', '=', tenant_id)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  }

  /**
   * Revoke every session this user has EXCEPT the one identified by `keepSessionHash` (the SHA-256
   * of the caller's own plaintext session id).
   *
   * Deliberately not filtered by status: a 'rotated' row's refresh token stays replayable for a
   * short grace window (see `renewAuthToken`), so leaving those behind would let a device we just
   * signed out mint a fresh session from its previous cookie.
   */
  public async deleteOthersByUserId(
    user_id: string,
    tenant_id: string,
    keepSessionHash: string,
    trx?: Transaction<Models>,
  ) {
    const result = await this.getDelete(trx)
      .where('user_id', '=', user_id)
      .where('tenant_id', '=', tenant_id)
      .where('session_id', '!=', keepSessionHash)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  }

  /** Delete rotated sessions whose refresh-reuse grace window has passed — they can never
   * authenticate again (auth gates only accept status='active', and renew rejects rotated
   * sessions older than the grace window). */
  public async deleteRotatedBefore(user_id: string, tenant_id: string, cutoff: Date, trx?: Transaction<Models>) {
    return this.getDelete(trx)
      .where('user_id', '=', user_id)
      .where('tenant_id', '=', tenant_id)
      .where('status', '=', 'rotated')
      .where('last_used_at', '<', cutoff)
      .executeTakeFirst();
  }

  /** Mark a session as rotated (refresh-token rotation). The row becomes invisible to the auth
   * gates immediately (they filter status='active'), but renewAuthToken still honors its refresh
   * token for a short reuse window so concurrent tabs replaying the same cookie aren't stranded.
   * `last_used_at` is stamped with the rotation time — the grace check reads it. */
  public async markRotatedBySessionHash(session_hash: string, tenant_id: string, trx?: Transaction<Models>) {
    const result = await this.getUpdate(trx)
      .set({ status: 'rotated', last_used_at: new Date() })
      .where('session_id', '=', session_hash)
      .where('tenant_id', '=', tenant_id)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0);
  }
}
