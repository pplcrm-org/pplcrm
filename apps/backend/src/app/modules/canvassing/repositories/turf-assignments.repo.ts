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

/** One volunteer currently walking a turf. Several may share one turf (§13: group canvassing). */
export interface TurfCanvasser {
  assignment_id: string;
  person_id: string;
  name: string;
  team_id: string | null;
  team_name: string | null;
  assigned_at: string | null;
  expires_at: string | null;
}

/** A high-entropy, URL-safe Companion token (the bearer credential). */
export function generateTurfToken(): string {
  return randomBytes(24).toString('base64url');
}

export class TurfAssignmentsRepo extends BaseRepository<'turf_assignments'> {
  constructor() {
    super('turf_assignments');
  }

  /**
   * This volunteer's live assignment on one turf — the membership check behind every
   * session-first request. Tenant-scoped, unlike `resolveByToken`, because the caller
   * already knows the tenant from their session.
   */
  public async findActiveForVolunteer(
    input: { tenant_id: string; turf_id: string; volunteer_person_id: string },
    trx?: Transaction<Models>,
  ): Promise<ResolvedAssignment | null> {
    const row = await this.getSelect(trx)
      .select(['id', 'tenant_id', 'turf_id', 'team_id', 'status', 'createdby_id', 'volunteer_person_id', 'expires_at'])
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('volunteer_person_id', '=', input.volunteer_person_id)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row ? this.toResolved(row) : null;
  }

  /** Every turf this volunteer is currently on. */
  public async activeTurfIdsForVolunteer(
    input: { tenant_id: string; volunteer_person_id: string },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    const rows = await this.getSelect(trx)
      .select('turf_id')
      .where('tenant_id', '=', input.tenant_id)
      .where('volunteer_person_id', '=', input.volunteer_person_id)
      .where('status', '=', 'active')
      .execute();
    return rows.map((r) => String(r.turf_id));
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

  /**
   * Retire EVERY active link on a turf. Used when the turf itself is retired.
   *
   * Do NOT call this on assignment: a turf can hold several volunteers at once
   * (a group walking it together), so evicting the others is exactly the bug
   * `revokeForVolunteer` exists to avoid.
   */
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
   * Retire one volunteer's link on one turf, leaving everyone else on it untouched.
   *
   * This backs both "remove them from the roster" and "re-issue their link" — the
   * latter revokes then creates, because the raw token is hashed and can never be
   * re-displayed (see the 2026-07-27 token-hash migration).
   */
  public async revokeForVolunteer(
    input: { tenant_id: string; turf_id: string; volunteer_person_id: string; user_id: string },
    trx?: Transaction<Models>,
  ): Promise<void> {
    await this.getUpdate(trx)
      .set({ status: 'revoked', updatedby_id: input.user_id, updated_at: new Date() })
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('volunteer_person_id', '=', input.volunteer_person_id)
      .where('status', '=', 'active')
      .execute();
  }

  /**
   * The active roster, keyed by turf id.
   *
   * Deliberately a second query rather than a join on the turf list: with several
   * active assignments per turf, joining fans the turf rows out and silently
   * multiplies every aggregate hanging off them.
   */
  public async canvassersByTurf(
    input: { tenant_id: string; turf_id?: string },
    trx?: Transaction<Models>,
  ): Promise<Map<string, TurfCanvasser[]>> {
    let qb = this.getSelect(trx)
      .innerJoin('persons', (join) =>
        join
          .onRef('persons.id', '=', 'turf_assignments.volunteer_person_id')
          .on('persons.tenant_id', '=', input.tenant_id),
      )
      .leftJoin('teams', 'teams.id', 'turf_assignments.team_id')
      .where('turf_assignments.tenant_id', '=', input.tenant_id)
      .where('turf_assignments.status', '=', 'active');

    if (input.turf_id) qb = qb.where('turf_assignments.turf_id', '=', input.turf_id);

    const rows = await qb
      .orderBy('turf_assignments.assigned_at')
      .select([
        'turf_assignments.id as assignment_id',
        'turf_assignments.turf_id as turf_id',
        'turf_assignments.volunteer_person_id as person_id',
        'turf_assignments.team_id as team_id',
        'turf_assignments.assigned_at as assigned_at',
        'turf_assignments.expires_at as expires_at',
        'teams.name as team_name',
        'persons.first_name as first_name',
        'persons.last_name as last_name',
      ])
      .execute();

    const byTurf = new Map<string, TurfCanvasser[]>();
    for (const r of rows) {
      const turfId = String(r.turf_id);
      const list = byTurf.get(turfId) ?? [];
      list.push({
        assignment_id: String(r.assignment_id),
        person_id: String(r.person_id),
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed person',
        team_id: r.team_id == null ? null : String(r.team_id),
        team_name: r.team_name ? String(r.team_name) : null,
        assigned_at: r.assigned_at ? new Date(String(r.assigned_at)).toISOString() : null,
        expires_at: r.expires_at ? new Date(String(r.expires_at)).toISOString() : null,
      });
      byTurf.set(turfId, list);
    }
    return byTurf;
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
