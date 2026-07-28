import type { Transaction } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { CompanionVolunteerRow } from '../../../../../../../libs/common/src';

export interface CompanionVolunteer {
  id: string;
  tenant_id: string;
  person_id: string;
  status: string;
  verify_code_hash: string | null;
  verify_code_expires_at: Date | null;
  verify_attempts: number;
  verify_channel: string | null;
  verified_at: Date | null;
  /** Per-volunteer roam override; null = inherit the workspace roam setting. */
  can_roam: boolean | null;
}

export class CompanionVolunteersRepo extends BaseRepository<'companion_volunteers'> {
  constructor() {
    super('companion_volunteers');
  }

  public async findByPerson(
    input: { tenant_id: string; person_id: string },
    trx?: Transaction<Models>,
  ): Promise<CompanionVolunteer | null> {
    const row = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('person_id', '=', input.person_id)
      .executeTakeFirst();
    return row ? this.toVolunteer(row) : null;
  }

  public async findById(
    input: { tenant_id: string; id: string },
    trx?: Transaction<Models>,
  ): Promise<CompanionVolunteer | null> {
    const row = await this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row ? this.toVolunteer(row) : null;
  }

  /** Get-or-create the volunteer row for a person (idempotent on the unique key). */
  public async ensureForPerson(
    input: { tenant_id: string; person_id: string; created_by: string },
    trx?: Transaction<Models>,
  ): Promise<CompanionVolunteer> {
    const row = {
      tenant_id: input.tenant_id,
      person_id: input.person_id,
      createdby_id: input.created_by,
      updatedby_id: input.created_by,
    } as OperationDataType<'companion_volunteers', 'insert'>;
    await this.getInsert(trx)
      .values(row)
      .onConflict((oc) => oc.columns(['tenant_id', 'person_id']).doNothing())
      .execute();
    const found = await this.findByPerson(input, trx);
    if (!found) throw new Error('companion volunteer row missing after ensure');
    return found;
  }

  public async setVerifyCode(
    input: { tenant_id: string; id: string; code_hash: string; expires_at: Date; channel: 'email' | 'sms' },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({
        verify_code_hash: input.code_hash,
        verify_code_expires_at: input.expires_at,
        verify_attempts: 0,
        verify_channel: input.channel,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  public async bumpVerifyAttempts(input: { tenant_id: string; id: string }, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set((eb) => ({ verify_attempts: eb('verify_attempts', '+', 1), updated_at: new Date() }))
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  /** Invalidate a code (attempt lockout / after use). */
  public async clearVerifyCode(input: { tenant_id: string; id: string }, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ verify_code_hash: null, verify_code_expires_at: null, updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  /**
   * Record a successful code confirmation: clear the code and move
   * invited → verified. An already-approved volunteer stays approved.
   */
  public async markVerified(input: { tenant_id: string; id: string }, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set((eb) => ({
        verify_code_hash: null,
        verify_code_expires_at: null,
        verified_at: new Date(),
        status: eb
          .case()
          .when('status', '=', 'invited')
          .then('verified')
          .else(eb.ref('status'))
          .end()
          .$castTo<string>(),
        updated_at: new Date(),
      }))
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  public async approve(
    input: { tenant_id: string; id: string; admin_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({
        status: 'approved',
        approved_by: input.admin_id,
        approved_at: new Date(),
        revoked_at: null,
        updatedby_id: input.admin_id,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  public async revoke(
    input: { tenant_id: string; id: string; admin_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({
        status: 'revoked',
        revoked_at: new Date(),
        updatedby_id: input.admin_id,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }

  /** Admin page rows: volunteers joined with their person + approver. */
  public async getAllWithPerson(tenant_id: string): Promise<CompanionVolunteerRow[]> {
    const rows = await this.getSelect()
      .innerJoin('persons', (join) =>
        join
          .onRef('persons.id', '=', 'companion_volunteers.person_id')
          .onRef('persons.tenant_id', '=', 'companion_volunteers.tenant_id'),
      )
      .leftJoin('authusers', (join) =>
        join
          .onRef('authusers.id', '=', 'companion_volunteers.approved_by')
          .onRef('authusers.tenant_id', '=', 'companion_volunteers.tenant_id'),
      )
      .select([
        'companion_volunteers.id',
        'companion_volunteers.person_id',
        'companion_volunteers.status',
        'companion_volunteers.verify_channel',
        'companion_volunteers.verified_at',
        'companion_volunteers.approved_at',
        'companion_volunteers.created_at',
        'companion_volunteers.can_roam',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'authusers.first_name as approver_first_name',
        'authusers.last_name as approver_last_name',
      ])
      .where('companion_volunteers.tenant_id', '=', tenant_id)
      .orderBy('companion_volunteers.created_at', 'desc')
      .execute();

    return rows.map((r) => ({
      id: String(r.id),
      person_id: String(r.person_id),
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      mobile: r.mobile,
      status: String(r.status) as CompanionVolunteerRow['status'],
      verify_channel: (r.verify_channel ?? null) as CompanionVolunteerRow['verify_channel'],
      verified_at: r.verified_at ? new Date(String(r.verified_at)).toISOString() : null,
      approved_at: r.approved_at ? new Date(String(r.approved_at)).toISOString() : null,
      can_roam: r.can_roam == null ? null : Boolean(r.can_roam),
      approved_by_name: r.approver_first_name ? `${r.approver_first_name} ${r.approver_last_name ?? ''}`.trim() : null,
      created_at: new Date(String(r.created_at)).toISOString(),
    }));
  }

  /** Volunteers awaiting admin approval (the sidebar badge count). */
  public async pendingCount(tenant_id: string): Promise<number> {
    const row = await this.getSelect()
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('tenant_id', '=', tenant_id)
      .where('status', '=', 'verified')
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  private toVolunteer(row: Record<string, unknown>): CompanionVolunteer {
    return {
      id: String(row['id']),
      tenant_id: String(row['tenant_id']),
      person_id: String(row['person_id']),
      status: String(row['status']),
      verify_code_hash: row['verify_code_hash'] == null ? null : String(row['verify_code_hash']),
      verify_code_expires_at: row['verify_code_expires_at'] ? new Date(String(row['verify_code_expires_at'])) : null,
      verify_attempts: Number(row['verify_attempts'] ?? 0),
      verify_channel: row['verify_channel'] == null ? null : String(row['verify_channel']),
      verified_at: row['verified_at'] ? new Date(String(row['verified_at'])) : null,
      can_roam: row['can_roam'] == null ? null : Boolean(row['can_roam']),
    };
  }

  /** Set or clear this volunteer's roam override (null = follow the workspace setting). */
  public async setCanRoam(
    input: { tenant_id: string; id: string; can_roam: boolean | null; user_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ can_roam: input.can_roam, updatedby_id: input.user_id, updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .execute();
  }
}
