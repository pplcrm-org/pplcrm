import type { SelectQueryBuilder, Transaction, UpdateResult } from 'kysely';
import { sql } from 'kysely';

import type { GetOperandType, Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { GridFilterModel } from '../../../../../../../libs/common/src';
import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { generateToken, hashToken } from '../../../lib/token-hash';

export class AuthUsersRepo extends BaseRepository<'authusers'> {
  constructor() {
    super('authusers');
  }

  public override async getAllWithCounts(
    input: { tenant_id: string; options?: QueryParams<'authusers'> },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = (input.options as JoinedQueryParams) ?? {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(typeof options.searchStr === 'string' ? options.searchStr : undefined);
    const filterModel = ((options as JoinedQueryParams)?.filterModel ?? {}) as GridFilterModel;

    const startRow = typeof options.startRow === 'number' && options.startRow >= 0 ? options.startRow : 0;
    const endRowCandidate =
      typeof options.endRow === 'number' && options.endRow > startRow ? options.endRow : startRow + 50;
    const pageSize = Math.max(1, endRowCandidate - startRow);

    const applyFilters = <QB extends SelectQueryBuilder<Models, any, any>>(qb: QB) =>
      qb
        .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
        .where('authusers.tenant_id', '=', tenantId)
        // Tombstoned (deleted) users keep their row for FK integrity but never appear in the
        // users grid or assignee pickers — both read through this query.
        .where('authusers.deleted_at', 'is', null)
        .$if(!!searchStr, (builder) => {
          const text = searchStr;
          return builder.where(
            sql<boolean>`(
              LOWER(authusers.email) LIKE ${text} OR
              LOWER(authusers.first_name) LIKE ${text} OR
              LOWER(COALESCE(authusers.last_name, '')) LIKE ${text} OR
              LOWER(COALESCE(profiles.last_name, '')) LIKE ${text}
            )`,
          );
        })
        .$if(filterModel['verified'] !== undefined && filterModel['verified'] !== null, (builder) => {
          const raw = filterModel['verified'];
          const boolVal =
            typeof raw === 'boolean'
              ? raw
              : typeof raw?.value === 'boolean'
                ? raw.value
                : String(raw?.value ?? raw ?? '').toLowerCase() === 'true';
          return builder.where('authusers.verified', '=', boolVal);
        })
        .$if(!!filterModel['role']?.value || typeof filterModel['role'] === 'string', (builder) => {
          const raw = filterModel['role']?.value ?? filterModel['role'];
          const value = String(raw ?? '').trim();
          if (!value) return builder;
          return builder.where('authusers.role', '=', String(value));
        });

    const countRow = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT authusers.id`).as('total')])
      .executeTakeFirst();
    const count = Number(countRow?.['total'] ?? 0);

    const sorts = options.sortModel ?? [];

    const rowsRaw = await applyFilters(this.getSelect(trx))
      .select(() => [
        'authusers.id',
        'authusers.email',
        'authusers.first_name',
        'authusers.last_name',
        'authusers.role',
        'authusers.verified',
        'authusers.two_factor_enabled',
        'authusers.deletion_scheduled_at',
        'authusers.deactivated_at',
        'authusers.created_at',
        'authusers.updated_at',
        sql<string>`COALESCE(authusers.last_name, profiles.last_name)`.as('effective_last_name'),
        sql<string>`profiles.last_name`.as('profile_last_name'),
        'profiles.avatar_file_id',
        // Most recent session touch for this user; sessions are tenant-scoped by the join to authusers.
        sql<Date | null>`(
          SELECT MAX(GREATEST(s.last_accessed, COALESCE(s.last_used_at, s.last_accessed)))
          FROM sessions s
          WHERE s.user_id = authusers.id AND s.tenant_id = authusers.tenant_id
        )`.as('last_active_at'),
      ])
      .$if(sorts.length > 0, (qb) =>
        sorts.reduce((acc, sort) => {
          const dir = sort.sort;
          switch (sort.colId) {
            case 'id':
              return acc.orderBy('authusers.id', dir);
            case 'email':
              return acc.orderBy('authusers.email', dir);
            case 'first_name':
              return acc.orderBy('authusers.first_name', dir);
            case 'last_name':
              return acc.orderBy(sql<boolean>`COALESCE(authusers.last_name, profiles.last_name)`, dir);
            case 'role':
              return acc.orderBy('authusers.role', dir);
            case 'verified':
              return acc.orderBy('authusers.verified', dir);
            case 'created_at':
              return acc.orderBy('authusers.created_at', dir);
            case 'updated_at':
              return acc.orderBy('authusers.updated_at', dir);
            default:
              return acc.orderBy(sort.colId, dir);
          }
        }, qb),
      )
      .offset(startRow)
      .limit(pageSize)
      .execute();

    const rows = rowsRaw.map((row: any) => ({
      id: row.id != null ? String(row.id) : undefined,
      email: row.email ?? '',
      first_name: row.first_name ?? '',
      last_name: row.effective_last_name ?? row.profile_last_name ?? row.last_name ?? '',
      role: row.role != null ? String(row.role) : null,
      verified: this.toBoolean(row.verified),
      two_factor_enabled: this.toBoolean(row.two_factor_enabled),
      deletion_scheduled_at: row.deletion_scheduled_at ?? null,
      deactivated_at: row.deactivated_at ?? null,
      last_active_at: row.last_active_at ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      avatar_file_id: row.avatar_file_id ? String(row.avatar_file_id) : null,
    }));

    return { rows, count };
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
    return false;
  }

  public async addPasswordResetCode(
    id: string,
    trx?: Transaction<Models>,
  ): Promise<{ password_reset_code: string } | undefined> {
    const plaintext = generateToken();
    const hash = hashToken(plaintext);
    await this.getUpdate(trx)
      .set({
        password_reset_code: hash,
        password_reset_code_created_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
    // Return the plaintext so callers can embed it in emails
    return { password_reset_code: plaintext };
  }

  public existsByEmail(email: string): Promise<boolean> {
    return this.exists({ key: email, column: 'email' });
  }

  public getByEmail(email: SelectEmailType, options?: QueryParams<'authusers'>, trx?: Transaction<Models>) {
    return this.getSelectWithColumns(options, trx).where('email', '=', email).executeTakeFirst();
  }

  public async getCountByEmail(email: SelectEmailType): Promise<number> {
    const { count } = (await this.getSelect()
      .select(sql<string>`count(*)`.as('count'))
      .where('email', '=', email)
      .executeTakeFirst()) || { count: '0' };

    return parseInt(count);
  }

  public getPasswordResetCodeTime(code: string, trx?: Transaction<Models>) {
    const options = {
      columns: ['password_reset_code_created_at'] as (keyof Models['authusers'])[],
    };
    // executeTakeFirst, NOT ...OrThrow (finding M13): every caller already handles the
    // "no such code" case with a clean BadRequest/PreconditionFailed. Throwing here fired
    // first and surfaced an unknown verification code as a 500.
    return this.getSelectWithColumns(options, trx)
      .where('password_reset_code', '=', hashToken(code))
      .executeTakeFirst();
  }

  public updatePassword(password: string, code: string, trx?: Transaction<Models>) {
    return this.getUpdate(trx)
      .set({
        password,
        password_reset_code: null,
        password_reset_code_created_at: null,
        verified: true,
      })
      .where('password_reset_code', '=', hashToken(code))
      .executeTakeFirst() as unknown as UpdateResult;
  }

  public verifyEmailByCode(code: string, trx?: Transaction<Models>) {
    return this.getUpdate(trx)
      .set({
        verified: true,
        password_reset_code: null,
        password_reset_code_created_at: null,
      })
      .where('password_reset_code', '=', hashToken(code))
      .executeTakeFirst() as unknown as UpdateResult;
  }
}

type SelectEmailType = GetOperandType<'authusers', 'select', 'email'>;
