import { randomInt } from 'node:crypto';

import type { Transaction } from 'kysely';

import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '../../../../../../../libs/common/src';
import type { JoinCodeRow } from '../../../../../../../libs/common/src';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

/** A join code as the public join path sees it — everything needed to accept or refuse a scan. */
export interface ResolvedJoinCode {
  id: string;
  tenant_id: string;
  campaign_id: string | null;
  turf_id: string | null;
  code: string;
  label: string | null;
  status: string;
  expires_at: Date | null;
  max_uses: number | null;
  use_count: number;
  /** The admin who created the code — the inviter we text, and the actor for what follows. */
  created_by: string;
}

/**
 * Human-typeable by design: the QR is the fast path, but a phone that can't scan (or a
 * cracked camera, or a volunteer reading it off a poster) has to be able to type it.
 * The alphabet drops 0/O/1/I for that reason. `randomInt` rather than `Math.random`
 * because this is a credential, not a display id.
 */
export function generateJoinCode(): string {
  let out = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) out += JOIN_CODE_ALPHABET[randomInt(0, JOIN_CODE_ALPHABET.length)];
  return out;
}

export class JoinCodesRepo extends BaseRepository<'campaign_join_codes'> {
  constructor() {
    super('campaign_join_codes');
  }

  /**
   * Resolve a scanned/typed code to its tenant.
   *
   * Intentionally NOT tenant-scoped — the scan arrives with no session and no tenant
   * context, so the code IS what identifies the tenant, exactly like `turf_assignments`
   * resolving a capability token. `code` is UNIQUE globally for that reason. Every
   * downstream read and write is scoped by the tenant this returns. Listed in the
   * `pplcrm-tenant-safety` exceptions.
   *
   * Returns revoked/expired/exhausted codes too: the caller decides, so the refusal can
   * be uniform and timing-stable rather than short-circuiting here.
   */
  public async resolveByCode(code: string, trx?: Transaction<Models>): Promise<ResolvedJoinCode | null> {
    const row = await this.getSelect(trx).selectAll().where('code', '=', code.trim().toUpperCase()).executeTakeFirst();
    return row ? this.toResolved(row) : null;
  }

  public async findById(
    input: { tenant_id: string; id: string },
    trx?: Transaction<Models>,
  ): Promise<ResolvedJoinCode | null> {
    const row = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row ? this.toResolved(row) : null;
  }

  /**
   * Mint a code, retrying on the (astronomically unlikely) collision with the global
   * unique index rather than trusting entropy alone — 30^8 is large, but "large" is not
   * an integrity guarantee and the retry costs nothing.
   */
  public async createCode(
    input: {
      tenant_id: string;
      campaign_id: string | null;
      turf_id: string | null;
      label: string | null;
      expires_at: Date | null;
      max_uses: number | null;
      user_id: string;
    },
    trx?: Transaction<Models>,
  ): Promise<{ id: string; code: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateJoinCode();
      const row = {
        tenant_id: input.tenant_id,
        campaign_id: input.campaign_id,
        turf_id: input.turf_id,
        code,
        label: input.label,
        status: 'active',
        expires_at: input.expires_at,
        max_uses: input.max_uses,
        createdby_id: input.user_id,
        updatedby_id: input.user_id,
      } as OperationDataType<'campaign_join_codes', 'insert'>;
      const created = await this.getInsert(trx)
        .values(row)
        .onConflict((oc) => oc.column('code').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (created?.id != null) return { id: String(created.id), code };
    }
    throw new Error('Could not generate a unique join code');
  }

  public async setStatus(
    input: { tenant_id: string; id: string; status: 'active' | 'revoked'; user_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ status: input.status, updatedby_id: input.user_id, updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  public async setDetails(
    input: {
      tenant_id: string;
      id: string;
      label: string | null;
      expires_at: Date | null;
      max_uses: number | null;
      user_id: string;
    },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({
        label: input.label,
        expires_at: input.expires_at,
        max_uses: input.max_uses,
        updatedby_id: input.user_id,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  /**
   * Count one more scan against the code.
   *
   * The `max_uses` guard is in the WHERE clause, not in the caller: two people scanning
   * the same poster at the same moment would otherwise both read `use_count = 9` against
   * a cap of 10 and both pass. Returns whether the bump actually landed, so the caller
   * can refuse when it didn't.
   */
  public async bumpUseCount(input: { tenant_id: string; id: string }, trx?: Transaction<Models>): Promise<boolean> {
    const result = await this.getUpdate(trx)
      .set((eb) => ({ use_count: eb('use_count', '+', 1), updated_at: new Date() }))
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .where('status', '=', 'active')
      .where((eb) => eb.or([eb('max_uses', 'is', null), eb('use_count', '<', eb.ref('max_uses'))]))
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0) > 0;
  }

  /**
   * The admin list for one campaign (or the office context when `campaign_id` is null).
   *
   * The two counts come from correlated subqueries rather than a join: a code with 40
   * volunteers behind it would otherwise fan its own row out 40 times.
   */
  public async getForCampaign(
    input: { tenant_id: string; campaign_id: string | null },
    trx?: Transaction<Models>,
  ): Promise<Omit<JoinCodeRow, 'url'>[]> {
    let qb = this.getSelect(trx)
      .leftJoin('campaigns', (join) =>
        join
          .onRef('campaigns.id', '=', 'campaign_join_codes.campaign_id')
          .on('campaigns.tenant_id', '=', input.tenant_id),
      )
      .leftJoin('turfs', (join) =>
        join.onRef('turfs.id', '=', 'campaign_join_codes.turf_id').on('turfs.tenant_id', '=', input.tenant_id),
      )
      .where('campaign_join_codes.tenant_id', '=', input.tenant_id);

    qb =
      input.campaign_id == null
        ? qb.where('campaign_join_codes.campaign_id', 'is', null)
        : qb.where('campaign_join_codes.campaign_id', '=', input.campaign_id);

    const rows = await qb
      .select((eb) => [
        'campaign_join_codes.id as id',
        'campaign_join_codes.code as code',
        'campaign_join_codes.label as label',
        'campaign_join_codes.campaign_id as campaign_id',
        'campaign_join_codes.turf_id as turf_id',
        'campaign_join_codes.status as status',
        'campaign_join_codes.expires_at as expires_at',
        'campaign_join_codes.max_uses as max_uses',
        'campaign_join_codes.use_count as use_count',
        'campaign_join_codes.created_at as created_at',
        'campaigns.name as campaign_name',
        'turfs.name as turf_name',
        eb
          .selectFrom('companion_volunteers')
          .select((e) => e.fn.countAll<string>().as('c'))
          .whereRef('companion_volunteers.join_code_id', '=', 'campaign_join_codes.id')
          .where('companion_volunteers.tenant_id', '=', input.tenant_id)
          .where('companion_volunteers.status', '=', 'approved')
          .as('joined_count'),
        eb
          .selectFrom('companion_volunteers')
          .select((e) => e.fn.countAll<string>().as('c'))
          .whereRef('companion_volunteers.join_code_id', '=', 'campaign_join_codes.id')
          .where('companion_volunteers.tenant_id', '=', input.tenant_id)
          .where('companion_volunteers.status', 'in', ['invited', 'verified'])
          .as('pending_count'),
      ])
      .orderBy('campaign_join_codes.created_at', 'desc')
      .execute();

    return rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      label: r.label == null ? null : String(r.label),
      campaign_id: r.campaign_id == null ? null : String(r.campaign_id),
      campaign_name: r.campaign_name == null ? null : String(r.campaign_name),
      turf_id: r.turf_id == null ? null : String(r.turf_id),
      turf_name: r.turf_name == null ? null : String(r.turf_name),
      status: String(r.status) === 'revoked' ? ('revoked' as const) : ('active' as const),
      expires_at: r.expires_at ? new Date(String(r.expires_at)).toISOString() : null,
      max_uses: r.max_uses == null ? null : Number(r.max_uses),
      use_count: Number(r.use_count ?? 0),
      joined_count: Number(r.joined_count ?? 0),
      pending_count: Number(r.pending_count ?? 0),
      created_at: new Date(String(r.created_at)).toISOString(),
    }));
  }

  private toResolved(row: Record<string, unknown>): ResolvedJoinCode {
    return {
      id: String(row['id']),
      tenant_id: String(row['tenant_id']),
      campaign_id: row['campaign_id'] == null ? null : String(row['campaign_id']),
      turf_id: row['turf_id'] == null ? null : String(row['turf_id']),
      code: String(row['code']),
      label: row['label'] == null ? null : String(row['label']),
      status: String(row['status']),
      expires_at: row['expires_at'] ? new Date(String(row['expires_at'])) : null,
      max_uses: row['max_uses'] == null ? null : Number(row['max_uses']),
      use_count: Number(row['use_count'] ?? 0),
      created_by: String(row['createdby_id']),
    };
  }
}
