import type { Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { GridFilterModel } from '../../../../../../../libs/common/src';

export class ListsRepo extends BaseRepository<'lists'> {
  constructor() {
    super('lists');
  }

  public override async getAllWithCounts(
    input: {
      tenant_id: string;
      options?: QueryParams<'lists' | 'map_lists_persons' | 'map_lists_households' | 'authusers'>;
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = ((options as JoinedQueryParams)?.filterModel ?? {}) as GridFilterModel;

    const page = resolvePageWindow(options, 100);

    const applyFilters = <QB extends AnyQB>(qb: QB) =>
      qb
        .leftJoin('map_lists_persons', 'map_lists_persons.list_id', 'lists.id')
        .leftJoin('map_lists_households', 'map_lists_households.list_id', 'lists.id')
        .leftJoin('authusers', 'authusers.id', 'lists.createdby_id')
        .where('lists.tenant_id', '=', tenantId)
        // Campaigns §15 — the lists page shows the active context's segments.
        .$if(!!(options as { campaignId?: string }).campaignId, (qb) =>
          qb.where('lists.campaign_id', '=', (options as { campaignId?: string }).campaignId as string),
        )
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          return qb.where(
            sql<boolean>`(
              LOWER(lists.name) LIKE ${text} OR
              LOWER(lists.description) LIKE ${text} OR
              LOWER(COALESCE(authusers.first_name, '')) LIKE ${text} OR
              LOWER(COALESCE(authusers.last_name, '')) LIKE ${text} OR
              LOWER(COALESCE(authusers.first_name || ' ' || authusers.last_name, '')) LIKE ${text}
            )`,
          );
        })
        // Column filters
        .$if(!!filterModel['name']?.value, (q) => q.where('lists.name', 'ilike', `%${filterModel['name']?.value}%`))
        .$if(!!filterModel['description']?.value, (q) =>
          q.where('lists.description', 'ilike', `%${filterModel['description']?.value}%`),
        )
        .$if(!!filterModel['object']?.value || typeof filterModel['object'] === 'string', (q) => {
          const raw: unknown = filterModel['object']?.value ?? filterModel['object'];
          const v = String(raw || '')
            .trim()
            .toLowerCase();
          if (!v) return q;
          if (v === 'people' || v === 'households') return q.where('lists.object', '=', v as 'people' | 'households');
          return q.where('lists.object', '=', v as 'people' | 'households');
        })
        .$if(!!filterModel['created_by']?.value || typeof filterModel['created_by'] === 'string', (q) => {
          const raw: unknown = filterModel['created_by']?.value ?? filterModel['created_by'];
          const val = String(raw || '').trim();
          if (!val) return q;
          const isNumeric = /^\d+$/.test(val);
          if (isNumeric) {
            return q.where(
              sql<boolean>`(
                COALESCE(authusers.first_name || ' ' || authusers.last_name, '') ILIKE ${'%' + val + '%'} OR
                lists.createdby_id = ${Number(val)}
              )`,
            );
          }
          return q.where(
            sql<boolean>`COALESCE(authusers.first_name || ' ' || authusers.last_name, '') ILIKE ${'%' + val + '%'}`,
          );
        })
        .$if(!!filterModel['updated_at']?.value, (q) =>
          q.where(
            sql<boolean>`CAST(lists.updated_at AS TEXT) ILIKE ${'%' + String(filterModel['updated_at']?.value) + '%'}`,
          ),
        );

    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT lists.id`).as('total')])
      .execute();
    const count = Number(countResult[0]?.['total'] || 0);

    const rowsRaw = await applyFilters(this.getSelect(trx))
      .select(() => [
        'lists.id',
        'lists.name',
        'lists.description',
        'lists.object',
        'lists.is_dynamic',
        'lists.updated_at',
        'lists.last_refreshed_at',
        // The stored rule definition — the frontend renders it as the human
        // "DEFINITION" sentence. Must be in GROUP BY below (Postgres does not
        // infer functional dependency from lists.id here), or the aggregate
        // query fails with "column lists.definition must appear in the GROUP BY".
        'lists.definition',
        // Built-in marker (§8) — drives the row's `deletable` flag below.
        'lists.system_key',
        sql<number>`COUNT(DISTINCT map_lists_persons.person_id)`.as('people_count'),
        sql<number>`COUNT(DISTINCT map_lists_households.household_id)`.as('household_count'),
        sql<string>`CONCAT(authusers.first_name, ' ', authusers.last_name)`.as('created_by'),
        // "LAST USED IN": the most recently created consumer that references
        // this list. Newsletters, forms and teams each link through their own
        // FK-backed junction table. Each arm is tenant-scoped to lists.tenant_id;
        // the outer query is already filtered to this tenant.
        sql<string | null>`(
          SELECT c.label FROM (
            SELECT nl.name AS label, nl.created_at AS ts
              FROM public.map_newsletters_lists mnl
              JOIN public.newsletters nl ON nl.id = mnl.newsletter_id
              WHERE mnl.list_id = lists.id AND mnl.tenant_id = lists.tenant_id
            UNION ALL
            SELECT wf.name AS label, wf.created_at AS ts
              FROM public.map_web_forms_lists mwl
              JOIN public.web_forms wf ON wf.id = mwl.web_form_id
              WHERE mwl.list_id = lists.id AND mwl.tenant_id = lists.tenant_id
            UNION ALL
            SELECT t.name AS label, t.created_at AS ts
              FROM public.map_teams_lists mtl
              JOIN public.teams t ON t.id = mtl.team_id
              WHERE mtl.list_id = lists.id AND mtl.tenant_id = lists.tenant_id
          ) c
          ORDER BY c.ts DESC
          LIMIT 1
        )`.as('last_used_in'),
      ])
      .groupBy([
        'lists.id',
        // tenant_id is referenced by the correlated last_used_in subquery, so it
        // must be grouped too — otherwise "subquery uses ungrouped column
        // lists.tenant_id from outer query".
        'lists.tenant_id',
        'lists.name',
        'lists.description',
        'lists.object',
        'lists.is_dynamic',
        'lists.updated_at',
        'lists.last_refreshed_at',
        'lists.definition',
        'lists.system_key',
        'authusers.first_name',
        'authusers.last_name',
      ])
      .$if(!!options.sortModel?.length, (qb) => {
        const sorts = options.sortModel ?? [];
        const createdSort = sorts.find((s) => s.colId === 'created_by');
        const listSizeSort = sorts.find((s) => s.colId === 'list_size');
        const usedInSort = sorts.find((s) => s.colId === 'used_in');
        const others = sorts.filter(
          (s) => s.colId !== 'created_by' && s.colId !== 'list_size' && s.colId !== 'used_in',
        );
        let acc = qb;
        // created_by sort: sort by full name of creator
        if (createdSort) {
          acc = acc.orderBy(sql`COALESCE(authusers.first_name || ' ' || authusers.last_name, '')`, createdSort.sort);
        }
        // list_size sort: derived from people_count vs household_count
        if (listSizeSort) {
          acc = acc.orderBy(
            sql`CASE WHEN lists.object = 'people' THEN COUNT(DISTINCT map_lists_persons.person_id) ELSE COUNT(DISTINCT map_lists_households.household_id) END`,
            listSizeSort.sort,
          );
        }
        // used_in sort: field is a UI placeholder; sort by a stable column instead (updated_at)
        if (usedInSort) {
          acc = acc.orderBy('lists.updated_at', usedInSort.sort);
        }
        for (const s of others) acc = acc.orderBy(s.colId, s.sort);
        return acc;
      })
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    const rows = rowsRaw.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      object: r.object,
      is_dynamic: r.is_dynamic,
      updated_at: r.updated_at,
      last_refreshed_at: r.last_refreshed_at,
      definition: r.definition,
      system_key: r.system_key ?? null,
      // The datagrid's generic non-deletable guard reads `deletable` (same
      // contract as tags): it drops the row from bulk delete and blocks
      // renaming it inline. Built-in lists (§8) are the only false here.
      deletable: r.system_key == null,
      // MEMBERS: the real snapshot/refreshed member count, tabular for both
      // smart and static lists (smart lists persist members after each refresh).
      list_size: r.object === 'people' ? Number(r.people_count) : Number(r.household_count),
      last_used_in: r.last_used_in ?? null,
      used_in: 0,
      created_by: r.created_by,
    }));

    return { rows, count };
  }

  public async getHouseholdsByListId(
    input: { tenant_id: string; list_id: string },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const qb = this.getSelect(trx)
      .innerJoin('map_lists_households as mlh', 'mlh.list_id', 'lists.id')
      .innerJoin('households', 'households.id', 'mlh.household_id')
      .where('lists.tenant_id', '=', input.tenant_id)
      .where('lists.id', '=', input.list_id);

    const countResult = await qb
      .select(({ fn }) => [fn.count(sql`DISTINCT households.id`).as('total')])
      .executeTakeFirst();
    const total = countResult?.total;

    const rows = await qb
      .select([
        'households.id',
        'households.street1',
        'households.street_num',
        'households.city',
        'households.state',
        'households.zip',
      ])
      .groupBy([
        'households.id',
        'households.street1',
        'households.street_num',
        'households.city',
        'households.state',
        'households.zip',
      ])
      .execute();

    return { rows, count: Number(total || 0) };
  }

  public async getPersonsByListId(
    input: { tenant_id: string; list_id: string },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const qb = this.getSelect(trx)
      .innerJoin('map_lists_persons as mlp', 'mlp.list_id', 'lists.id')
      .innerJoin('persons', 'persons.id', 'mlp.person_id')
      .leftJoin('households', 'households.id', 'persons.household_id')
      .where('lists.tenant_id', '=', input.tenant_id)
      .where('lists.id', '=', input.list_id);

    const countResult2 = await qb
      .select(({ fn }) => [fn.count(sql`DISTINCT persons.id`).as('total')])
      .executeTakeFirst();
    const total = countResult2?.total;

    const rows = await qb
      .select([
        'persons.id',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'persons.household_id',
        'households.city',
        'households.state',
        'households.street1',
        'households.street_num',
        'households.zip',
      ])
      .groupBy([
        'persons.id',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'persons.household_id',
        'households.city',
        'households.state',
        'households.street1',
        'households.street_num',
        'households.zip',
      ])
      .execute();

    return { rows, count: Number(total || 0) };
  }
}
