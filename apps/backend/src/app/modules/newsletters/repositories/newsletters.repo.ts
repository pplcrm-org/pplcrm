import { sql } from 'kysely';

import type { QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { clampPageLimit, clampRowOffset, resolvePageWindow } from '../../../lib/paging';
import type { GridFilterModel } from '../../../../../../../libs/common/src';

export class NewslettersRepo extends BaseRepository<'newsletters'> {
  constructor() {
    super('newsletters');
  }

  public async getAllWithCount(
    tenant_id: string,
    options?: QueryParams<'newsletters'>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const opts: QueryParams<'newsletters'> = options ?? {};
    const searchStr = this.normalizeSearch(opts.searchStr);
    const filterModel = (opts?.filterModel ?? {}) as GridFilterModel;
    // `offset` is this repo's own alias for `startRow`; either may be used. A request that
    // supplies neither a `limit` nor an `endRow` used to emit no LIMIT clause at all, so it read
    // every newsletter in the workspace — resolvePageWindow gives that case MAX_PAGE_SIZE.
    const startRow = typeof opts.startRow === 'number' ? clampRowOffset(opts.startRow) : clampRowOffset(opts.offset);
    const limit =
      typeof opts.limit === 'number'
        ? clampPageLimit(opts.limit)
        : resolvePageWindow({ startRow, endRow: opts.endRow }).limit;

    const applyFilters = <QB extends ReturnType<typeof this.getSelect>>(qb: QB) =>
      qb
        .where('newsletters.tenant_id', '=', tenant_id)
        .$if(!!searchStr, (q) => q.where(sql<boolean>`LOWER(newsletters.name) LIKE ${searchStr}`))
        .$if(!!filterModel['name']?.value, (q) =>
          q.where('newsletters.name', 'ilike', `%${filterModel['name']?.value}%`),
        )
        .$if(!!filterModel['status']?.value || typeof filterModel['status'] === 'string', (q) => {
          const raw: unknown = filterModel['status']?.value ?? filterModel['status'];
          const text = String(raw ?? '')
            .trim()
            .toLowerCase();
          if (!text) return q;
          return q.where('newsletters.status', '=', text);
        })
        .$if(!!filterModel['delivered_count']?.value || typeof filterModel['delivered_count'] === 'string', (q) => {
          const raw: unknown = filterModel['delivered_count']?.value ?? filterModel['delivered_count'];
          const text = String(raw ?? '').trim();
          if (!text) return q;
          if (/^\d+$/.test(text)) return q.where('newsletters.delivered_count', '=', Number(text));
          return q.where(sql<boolean>`CAST(newsletters.delivered_count AS TEXT) ILIKE ${'%' + text + '%'}`);
        })
        .$if(!!filterModel['open_rate']?.value || typeof filterModel['open_rate'] === 'string', (q) => {
          const raw: unknown = filterModel['open_rate']?.value ?? filterModel['open_rate'];
          const text = String(raw ?? '').trim();
          if (!text) return q;
          const numeric = Number(text.replace(/%/g, ''));
          if (!Number.isNaN(numeric)) return q.where('newsletters.open_rate', '=', numeric);
          return q.where(sql<boolean>`CAST(newsletters.open_rate AS TEXT) ILIKE ${'%' + text + '%'}`);
        })
        .$if(!!filterModel['click_rate']?.value || typeof filterModel['click_rate'] === 'string', (q) => {
          const raw: unknown = filterModel['click_rate']?.value ?? filterModel['click_rate'];
          const text = String(raw ?? '').trim();
          if (!text) return q;
          const numeric = Number(text.replace(/%/g, ''));
          if (!Number.isNaN(numeric)) return q.where('newsletters.click_rate', '=', numeric);
          return q.where(sql<boolean>`CAST(newsletters.click_rate AS TEXT) ILIKE ${'%' + text + '%'}`);
        })
        .$if(!!filterModel['send_date']?.value, (q) =>
          q.where(
            sql<boolean>`CAST(newsletters.send_date AS TEXT) ILIKE ${'%' + String(filterModel['send_date']?.value) + '%'}`,
          ),
        )
        .$if(!!filterModel['total_recipients']?.value || typeof filterModel['total_recipients'] === 'string', (q) => {
          const raw: unknown = filterModel['total_recipients']?.value ?? filterModel['total_recipients'];
          const text = String(raw ?? '').trim();
          if (!text) return q;
          if (/^\d+$/.test(text)) return q.where('newsletters.total_recipients', '=', Number(text));
          return q.where(sql<boolean>`CAST(newsletters.total_recipients AS TEXT) ILIKE ${'%' + text + '%'}`);
        })
        .$if(!!filterModel['updated_at']?.value, (q) =>
          q.where(
            sql<boolean>`CAST(newsletters.updated_at AS TEXT) ILIKE ${'%' + String(filterModel['updated_at']?.value) + '%'}`,
          ),
        )
        .$if(!!filterModel['subject']?.value, (q) =>
          q.where('newsletters.subject', 'ilike', `%${filterModel['subject']?.value}%`),
        )
        .$if(!!filterModel['summary']?.value, (q) =>
          q.where('newsletters.summary', 'ilike', `%${filterModel['summary']?.value}%`),
        );

    const countResult = await applyFilters(this.getSelect())
      .select(({ fn }) => [fn.countAll<number>().as('total')])
      .executeTakeFirst();
    const count = Number(countResult?.total ?? 0);

    let query = applyFilters(this.getSelect()).select([
      'newsletters.id',
      'newsletters.name',
      'newsletters.status',
      'newsletters.delivered_count',
      'newsletters.total_recipients',
      'newsletters.open_rate',
      'newsletters.click_rate',
      'newsletters.send_date',
      'newsletters.updated_at',
      'newsletters.subject',
      'newsletters.summary',
    ]);

    if (opts.sortModel?.length) {
      query = opts.sortModel.reduce((acc: typeof query, sort) => acc.orderBy(sql.ref(sort.colId), sort.sort), query);
    }

    if (startRow > 0) {
      query = query.offset(startRow);
    }

    query = query.limit(limit);

    const rowsRaw = await query.execute();

    const rows = rowsRaw.map((row) => ({
      id: String(row.id),
      name: row.name,
      status: row.status,
      delivered_count: Number(row.delivered_count ?? 0),
      total_recipients: Number(row.total_recipients ?? 0),
      open_rate: row.open_rate != null ? Number(row.open_rate) : null,
      click_rate: row.click_rate != null ? Number(row.click_rate) : null,
      send_date: row.send_date ?? null,
      updated_at: row.updated_at,
      subject: row.subject ?? null,
      summary: row.summary ?? null,
    }));

    return { rows, count };
  }
}
