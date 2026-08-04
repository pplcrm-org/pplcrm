import type { ReferenceExpression, Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';

export class WebFormsRepo extends BaseRepository<'web_forms'> {
  constructor() {
    super('web_forms');
  }

  /** Public lookup by slug within a known tenant (resolved from the subdomain — lib/public-tenant). */
  public async getBySlugPublic(tenantId: string, slug: string, trx?: Transaction<Models>) {
    return this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('slug', '=', slug)
      .executeTakeFirst();
  }

  public async slugExists(tenantId: string, slug: string, excludeId?: string): Promise<boolean> {
    let query = this.getSelect().select('id').where('tenant_id', '=', tenantId).where('slug', '=', slug);
    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return !!row;
  }

  /**
   * Cards for the new Forms page: every form with a live submission count. Donation forms are
   * included here too so the list is unified, but the frontend routes clicks on them to their own
   * /donation-pages (Stripe) editor rather than the living-funnel inline editor.
   */
  public async listForms(tenantId: string): Promise<Record<string, unknown>[]> {
    return (
      this.getSelect()
        .selectAll('web_forms')
        .select((eb) =>
          eb
            .selectFrom('form_submissions')
            .select((eb2) => eb2.fn.countAll<number>().as('c'))
            .whereRef('form_submissions.form_id', '=', 'web_forms.id')
            .where('form_submissions.tenant_id', '=', tenantId)
            .as('submission_count'),
        )
        .where('web_forms.tenant_id', '=', tenantId)
        // Donation forms are surfaced in the unified Forms list too; the frontend routes clicks on
        // them to the Stripe-backed fundraising editor rather than the living-funnel inline editor.
        .orderBy('web_forms.updated_at', 'desc')
        .execute()
    );
  }

  public async countSubmissions(tenantId: string, formId: string): Promise<number> {
    const row = await this.db
      .selectFrom('form_submissions')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('tenant_id', '=', tenantId)
      .where('form_id', '=', formId)
      .executeTakeFirst();
    return Number(row?.c ?? 0);
  }

  public async getFormSubmissions(
    tenantId: string,
    formId: string,
    limit: number,
    offset: number,
  ): Promise<Record<string, unknown>[]> {
    return this.db
      .selectFrom('form_submissions')
      .leftJoin('persons', (join) =>
        join.onRef('persons.id', '=', 'form_submissions.person_id').on('persons.tenant_id', '=', tenantId),
      )
      .select([
        'form_submissions.id',
        'form_submissions.person_id',
        'form_submissions.answers',
        'form_submissions.created_at',
        'persons.first_name',
        'persons.last_name',
      ])
      .where('form_submissions.tenant_id', '=', tenantId)
      .where('form_submissions.form_id', '=', formId)
      .orderBy('form_submissions.created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
  }

  public override async getAllWithCounts(
    input: {
      tenant_id: string;
      options?: QueryParams<'web_forms'>;
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, { value: string } | undefined>;

    const page = resolvePageWindow(options, 100);

    const applyFilters = <QB extends AnyQB>(qb: QB) =>
      qb
        .where('web_forms.tenant_id', '=', tenantId)
        // Campaigns §15 — the forms page shows the active context's forms.
        .$if(!!(options as { campaignId?: string }).campaignId, (qb: any) =>
          qb.where('web_forms.campaign_id', '=', (options as { campaignId?: string }).campaignId as string),
        )
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          return qb.where(
            sql<boolean>`(
            LOWER(web_forms.name) LIKE ${text} OR
            LOWER(web_forms.description) LIKE ${text}
          )`,
          );
        })
        .$if(!!filterModel['name']?.value, (q) => q.where('web_forms.name', 'ilike', `%${filterModel['name']?.value}%`))
        .$if(!!filterModel['description']?.value, (q) =>
          q.where('web_forms.description', 'ilike', `%${filterModel['description']?.value}%`),
        )
        .$if(!!filterModel['status']?.value, (q) => q.where('web_forms.status', '=', filterModel['status']?.value));

    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT web_forms.id`).as('total')])
      .execute();

    const count = Number(countResult[0]?.['total'] || 0);

    const rows = await applyFilters(this.getSelect(trx))
      .select([
        'web_forms.id',
        'web_forms.tenant_id',
        'web_forms.name',
        'web_forms.description',
        'web_forms.redirect_url',
        'web_forms.target_tags',
        'web_forms.target_lists',
        'web_forms.status',
        'web_forms.createdby_id',
        'web_forms.updatedby_id',
        'web_forms.created_at',
        'web_forms.updated_at',
        'web_forms.send_confirmation',
        'web_forms.send_alert',
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

    const formattedRows = rows.map((row) => ({
      ...row,
      id: String(row['id']),
      target_tags: Array.isArray(row['target_tags'])
        ? row['target_tags']
        : JSON.parse(String(row['target_tags'] || '[]')),
      target_lists: Array.isArray(row['target_lists'])
        ? row['target_lists']
        : JSON.parse(String(row['target_lists'] || '[]')),
    }));

    return {
      rows: formattedRows,
      count,
    };
  }
}
