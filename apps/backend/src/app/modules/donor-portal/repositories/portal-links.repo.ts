import type { Transaction } from 'kysely';

import { generateToken, hashToken } from '../../../lib/token-hash';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

/** How long an emailed giving-portal link stays valid. Quoted verbatim by the privacy policy's
 *  retention section (apps/website/src/app/legal/privacy-content.ts) — change both together. */
export const PORTAL_LINK_TTL_DAYS = 365;

export interface ResolvedPortalLink {
  id: string;
  tenant_id: string;
  person_id: string;
}

export interface MintedPortalLink {
  /** The raw bearer token — only ever exists here and inside the outgoing URL. */
  token: string;
  expires_at: Date;
}

export class PortalLinksRepo extends BaseRepository<'donor_portal_links'> {
  constructor() {
    super('donor_portal_links');
  }

  /**
   * Resolve a giving-portal token to its person. This is the ONLY intentionally
   * un-tenant-scoped query in the module: the token itself is the bearer credential
   * and is what identifies the tenant (exactly like a session token — cf. the
   * `sessions` entry in the no-unscoped-db-query ignoreTables). Every downstream
   * read/write is then scoped by the resolved `tenant_id`.
   */
  public async resolveByToken(token: string, trx?: Transaction<Models>): Promise<ResolvedPortalLink | null> {
    // NOTE: intentionally NOT tenant-scoped — the token IS the credential and is
    // what resolves the tenant (see the method doc above).
    const row = await this.getSelect(trx)
      .select(['id', 'tenant_id', 'person_id'])
      .where('token_hash', '=', hashToken(token))
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    return row ? { id: String(row.id), tenant_id: String(row.tenant_id), person_id: String(row.person_id) } : null;
  }

  /** Mint a new link. Several live links per person coexist on purpose — each emailed
   *  link must keep working until its own expiry or a staff revocation. */
  public async mint(
    input: { tenant_id: string; person_id: string; createdby_id?: string | null },
    trx?: Transaction<Models>,
  ): Promise<MintedPortalLink> {
    const token = generateToken();
    const expires_at = new Date(Date.now() + PORTAL_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.getInsert(trx)
      .values({
        tenant_id: input.tenant_id,
        person_id: input.person_id,
        token_hash: hashToken(token),
        createdby_id: input.createdby_id ?? null,
        expires_at,
      })
      .execute();
    return { token, expires_at };
  }

  /** Staff revocation: every live link for the person stops working at once. */
  public async revokeAllForPerson(
    input: { tenant_id: string; person_id: string },
    trx?: Transaction<Models>,
  ): Promise<number> {
    const result = await this.getUpdate(trx)
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0n);
  }

  /** Link state for the staff panel on the person record. */
  public async statusForPerson(
    input: { tenant_id: string; person_id: string },
    trx?: Transaction<Models>,
  ): Promise<{ live_count: number; last_created_at: Date | null; last_used_at: Date | null; expires_at: Date | null }> {
    const rows = await this.getSelect(trx)
      .select(['created_at', 'last_used_at', 'expires_at', 'revoked_at'])
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .execute();
    const now = Date.now();
    const live = rows.filter((r) => !r.revoked_at && new Date(r.expires_at as unknown as string).getTime() > now);
    const maxDate = (dates: (Date | null)[]): Date | null => {
      const times = dates.filter((d): d is Date => d != null).map((d) => new Date(d).getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    };
    return {
      live_count: live.length,
      last_created_at: maxDate(rows.map((r) => r.created_at as unknown as Date)),
      last_used_at: maxDate(rows.map((r) => r.last_used_at as unknown as Date | null)),
      expires_at: maxDate(live.map((r) => r.expires_at as unknown as Date)),
    };
  }

  /** Telemetry only; callers fire-and-forget this. */
  public async touchLastUsed(input: { id: string; tenant_id: string }): Promise<void> {
    await this.getUpdate()
      .set({ last_used_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }
}
