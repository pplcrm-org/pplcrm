import type { ReferenceExpression, Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';
import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

export class WorkflowsRepo extends BaseRepository<'workflows'> {
  constructor() {
    super('workflows');
  }

  public override async getAllWithCounts(
    input: {
      tenant_id: string;
      options?: QueryParams<'workflows'>;
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, Record<string, unknown>>;

    const page = resolvePageWindow(options, 100);

    const applyFilters = <QB extends AnyQB>(qb: QB) =>
      qb
        .where('workflows.tenant_id', '=', tenantId)
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          return qb.where(
            sql<boolean>`(
            LOWER(workflows.name) LIKE ${text} OR
            LOWER(workflows.description) LIKE ${text}
          )`,
          );
        })
        .$if(!!filterModel['name']?.['value'], (q) =>
          q.where('workflows.name', 'ilike', `%${filterModel['name']?.['value']}%`),
        )
        .$if(!!filterModel['status']?.['value'], (q) =>
          q.where('workflows.status', '=', filterModel['status']?.['value']),
        )
        .$if(!!filterModel['trigger_type']?.['value'], (q) =>
          q.where('workflows.trigger_type', '=', filterModel['trigger_type']?.['value']),
        );

    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT workflows.id`).as('total')])
      .execute();

    const count = Number(countResult[0]?.['total'] || 0);

    const rows = await applyFilters(this.getSelect(trx))
      .select([
        'workflows.id',
        'workflows.tenant_id',
        'workflows.name',
        'workflows.description',
        'workflows.trigger_type',
        'workflows.status',
        'workflows.createdby_id',
        'workflows.updatedby_id',
        'workflows.created_at',
        'workflows.updated_at',
      ])
      .select((eb) => [
        eb
          .selectFrom('workflow_steps')
          .select(({ fn }) => fn.count('workflow_steps.id').as('steps_count'))
          .whereRef('workflow_steps.workflow_id', '=', 'workflows.id')
          .as('steps_count'),
        eb
          .selectFrom('workflow_enrollments')
          .select(({ fn }) => fn.count('workflow_enrollments.id').as('active_enrollments_count'))
          .whereRef('workflow_enrollments.workflow_id', '=', 'workflows.id')
          .where('workflow_enrollments.status', '=', 'active')
          .as('active_enrollments_count'),
      ])
      .$if(!!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce(
          (acc, sort) => acc.orderBy(sort.colId as ReferenceExpression<any, any>, sort.sort),
          qb,
        ),
      )
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    return {
      rows: rows.map((row) => ({
        ...row,
        id: String(row['id']),
        steps_count: Number(row['steps_count'] || 0),
        active_enrollments_count: Number(row['active_enrollments_count'] || 0),
      })),
      count,
    };
  }
}
