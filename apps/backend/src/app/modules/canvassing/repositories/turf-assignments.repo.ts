import { randomBytes } from 'node:crypto';

import type { Transaction } from 'kysely';

import { hashToken } from '../../../lib/token-hash';
import { BaseRepository } from '../../../lib/base.repo';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface ResolvedAssignment {
  id: string;
  tenant_id: string;
  turf_id: string;
  team_id: string | null;
  status: string;
  /** Real CRM account that deployed this Companion — the responsible actor for
   *  synced knocks (§22.7: honest attribution, never a fabricated user). */
  created_by: string;
  /** The person this link belongs to — the companion access layer verifies against them. */
  volunteer_person_id: string | null;
  /** Optional hard expiry for the capability link. */
  expires_at: Date | null;
}

/** A high-entropy, URL-safe Companion token (the bearer credential). */
export function generateTurfToken(): string {
  return randomBytes(24).toString('base64url');
}

export class TurfAssignmentsRepo extends BaseRepository<'turf_assignments'> {
  constructor() {
    super('turf_assignments');
  }

  public async getActiveByTurf(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<ResolvedAssignment | null> {
    const row = await this.getSelect(trx)
      .select(['id', 'tenant_id', 'turf_id', 'team_id', 'status', 'createdby_id', 'volunteer_person_id', 'expires_at'])
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('status', '=', 'active')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? this.toResolved(row) : null;
  }

  public async create(
    input: {
      tenant_id: string;
      turf_id: string;
      team_id: string | null;
      token: string;
      user_id: string;
      volunteer_person_id: string;
      expires_at: Date | null;
    },
    trx?: Transaction<Models>,
  ): Promise<string> {
    const row = {
      tenant_id: input.tenant_id,
      turf_id: input.turf_id,
      team_id: input.team_id,
      token_hash: hashToken(input.token),
      status: 'active',
      volunteer_person_id: input.volunteer_person_id,
      expires_at: input.expires_at,
      createdby_id: input.user_id,
      updatedby_id: input.user_id,
    } as OperationDataType<'turf_assignments', 'insert'>;
    const created = await this.getInsert(trx).values(row).returning('id').executeTakeFirst();
    return String(created?.id ?? '');
  }

  public async revokeForTurf(
    input: { tenant_id: string; turf_id: string; user_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ status: 'revoked', updatedby_id: input.user_id, updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('status', '=', 'active')
      .execute();
  }

  /**
   * Resolve a Companion token to its assignment. This is the ONLY intentionally
   * un-tenant-scoped query in the module: the token itself is the bearer
   * credential and is what identifies the tenant (exactly like a session token —
   * cf. the `sessions` entry in the no-unscoped-db-query ignoreTables). Every
   * downstream read/write is then scoped by the resolved `tenant_id`.
   */
  public async resolveByToken(token: string, trx?: Transaction<Models>): Promise<ResolvedAssignment | null> {
    // NOTE: intentionally NOT tenant-scoped — the token IS the credential and is
    // what resolves the tenant (see the method doc above). Every downstream query
    // is scoped by the resolved tenant_id.
    const row = await this.getSelect(trx)
      .select(['id', 'tenant_id', 'turf_id', 'team_id', 'status', 'createdby_id', 'volunteer_person_id', 'expires_at'])
      .where('token_hash', '=', hashToken(token))
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row ? this.toResolved(row) : null;
  }

  private toResolved(row: {
    id: unknown;
    tenant_id: unknown;
    turf_id: unknown;
    team_id: unknown;
    status: unknown;
    createdby_id: unknown;
    volunteer_person_id?: unknown;
    expires_at?: unknown;
  }): ResolvedAssignment {
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      turf_id: String(row.turf_id),
      team_id: row.team_id == null ? null : String(row.team_id),
      status: String(row.status),
      created_by: String(row.createdby_id),
      volunteer_person_id: row.volunteer_person_id == null ? null : String(row.volunteer_person_id),
      expires_at: row.expires_at ? new Date(String(row.expires_at)) : null,
    };
  }
}
