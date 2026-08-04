import type { Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { SortModelType } from '../../../../../../../libs/common/src';

export class TeamsRepo extends BaseRepository<'teams'> {
  constructor() {
    super('teams');
  }

  public override async getAllWithCounts(
    input: { tenant_id: string; options?: QueryParams<'teams' | 'persons' | 'map_teams_persons'> },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = ((options as JoinedQueryParams)?.filterModel ?? {}) as Record<string, { value: string }>;

    const page = resolvePageWindow(options, 100);

    const applyFilters = <QB extends AnyQB>(qb: QB) =>
      qb
        .leftJoin('map_teams_persons', (join) =>
          join.onRef('map_teams_persons.team_id', '=', 'teams.id').on('map_teams_persons.tenant_id', '=', tenantId),
        )
        .leftJoin('persons as volunteer_person', (join) =>
          join
            .onRef('volunteer_person.id', '=', 'map_teams_persons.person_id')
            .on('volunteer_person.tenant_id', '=', tenantId),
        )
        .leftJoin('persons as captain', 'captain.id', 'teams.team_captain_id')
        .leftJoin('authusers as lead_user', 'lead_user.id', 'teams.team_lead_user_id')
        .where('teams.tenant_id', '=', tenantId)
        .$if(!!searchStr, (builder) => {
          const text = searchStr;
          return builder.where(
            sql<boolean>`(
              LOWER(teams.name) LIKE ${text} OR
              LOWER(COALESCE(teams.description, '')) LIKE ${text} OR
              LOWER(COALESCE(captain.first_name || ' ' || captain.last_name, '')) LIKE ${text} OR
              LOWER(COALESCE(lead_user.first_name || ' ' || lead_user.last_name, '')) LIKE ${text}
            )`,
          );
        })
        .$if(!!filterModel['name']?.value, (builder) =>
          builder.where('teams.name', 'ilike', `%${filterModel['name']?.value}%`),
        )
        .$if(!!filterModel['team_captain_id']?.value, (builder) =>
          builder.where('teams.team_captain_id', '=', filterModel['team_captain_id']?.value as string),
        )
        .$if(!!filterModel['team_lead_user_id']?.value, (builder) =>
          builder.where('teams.team_lead_user_id', '=', filterModel['team_lead_user_id']?.value as string),
        );

    const countRow = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT teams.id`).as('total')])
      .executeTakeFirst();
    const count = Number(countRow?.['total'] ?? 0);

    const rowsRaw = await applyFilters(this.getSelect(trx))
      .select([
        'teams.id',
        'teams.name',
        'teams.description',
        'teams.team_captain_id',
        'teams.team_lead_user_id',
        'teams.updated_at',
        sql`COALESCE(captain.first_name || ' ' || captain.last_name, '')`.as('captain_name'),
        sql`COALESCE(lead_user.first_name || ' ' || lead_user.last_name, '')`.as('lead_user_name'),
        sql<number>`COUNT(DISTINCT CASE WHEN volunteer_person.volunteer_status IS NOT NULL THEN map_teams_persons.person_id END)`.as(
          'volunteer_count',
        ),
      ])
      .groupBy([
        'teams.id',
        'teams.name',
        'teams.description',
        'teams.team_captain_id',
        'teams.team_lead_user_id',
        'teams.updated_at',
        'captain.first_name',
        'captain.last_name',
        'lead_user.first_name',
        'lead_user.last_name',
      ])
      .$if(Array.isArray(options.sortModel) && options.sortModel.length > 0, (builder) =>
        (options.sortModel ?? []).reduce((acc: any, sort: SortModelType) => {
          switch (sort.colId) {
            case 'volunteer_count':
              return acc.orderBy(
                sql`COUNT(DISTINCT CASE WHEN volunteer_person.volunteer_status IS NOT NULL THEN map_teams_persons.person_id END)`,
                sort.sort,
              );
            case 'team_captain_name':
              return acc.orderBy(sql`COALESCE(captain.first_name || ' ' || captain.last_name, '')`, sort.sort);
            case 'team_lead_user_name':
              return acc.orderBy(sql`COALESCE(lead_user.first_name || ' ' || lead_user.last_name, '')`, sort.sort);
            default: {
              let col = sort.colId;
              if (typeof col === 'string' && !col.includes('.')) {
                if (
                  [
                    'id',
                    'name',
                    'description',
                    'team_captain_id',
                    'team_lead_user_id',
                    'tenant_id',
                    'created_at',
                    'updated_at',
                    'createdby_id',
                    'updatedby_id',
                  ].includes(col)
                ) {
                  col = `teams.${col}`;
                }
              }
              return acc.orderBy(col, sort.sort);
            }
          }
        }, builder),
      )
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    const rows = (rowsRaw as any[]).map((row) => ({
      id: row['id'],
      name: row['name'],
      description: row['description'],
      team_captain_id: row['team_captain_id'] != null ? String(row['team_captain_id']) : null,
      team_captain_name: row['captain_name'] ? String(row['captain_name']) : null,
      team_lead_user_id: row['team_lead_user_id'] != null ? String(row['team_lead_user_id']) : null,
      team_lead_user_name: row['lead_user_name'] ? String(row['lead_user_name']) : null,
      volunteer_count: Number(row['volunteer_count'] ?? 0),
      updated_at: row['updated_at'],
    }));

    return { rows, count };
  }

  public async clearCaptain(input: { tenant_id: string; team_id: string }, trx?: Transaction<Models>) {
    await this.getUpdate(trx)
      .set({ team_captain_id: null })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.team_id)
      .executeTakeFirst();
  }

  public async clearLeadUser(input: { tenant_id: string; team_id: string }, trx?: Transaction<Models>) {
    await this.getUpdate(trx)
      .set({ team_lead_user_id: null })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.team_id)
      .executeTakeFirst();
  }
}
