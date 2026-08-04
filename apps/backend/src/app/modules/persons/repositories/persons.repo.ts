import type { ExpressionBuilder, JoinBuilder, Selectable, Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { Models, OperationDataType, TypeTenantId } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { CompanionVolunteerStatus } from '../../../../../../../libs/common/src';
import { COMPANION_VOLUNTEER_STATUSES } from '../../../../../../../libs/common/src';
import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import type { FullScanBatch } from '../../../lib/paging';
import { FULL_SCAN_BATCH_SIZE, resolvePageWindow } from '../../../lib/paging';
import { HouseholdRepo } from '../../households/repositories/households.repo';
import {
  anyElectoralAreaSubquery,
  electoralAreaSelects,
  referencesElectoralAreas,
  resolveSeatSetId,
} from '../../households/electoral-areas';

/** persons columns the grid may sort on — prefixed `persons.` in ORDER BY. */
const SORTABLE_PERSON_COLUMNS: readonly string[] = [
  'id',
  'first_name',
  'last_name',
  'email',
  'mobile',
  'notes',
  'household_id',
  'company_id',
  'created_at',
  'updated_at',
  'tenant_id',
  'createdby_id',
  'updatedby_id',
  'volunteer_status',
  'staff_status',
  'do_not_contact',
  'deceased_at',
  'senior',
];

/** households columns reachable through the join — prefixed `households.` in ORDER BY. */
const SORTABLE_PERSON_HOUSEHOLD_COLUMNS: readonly string[] = [
  'country',
  'zip',
  'state',
  'home_phone',
  'city',
  'street1',
  'street2',
  'street_num',
  'apt',
];

/**
 * Output aliases the data query selects, which Postgres resolves bare in ORDER BY. The two
 * electoral columns belong to the lateral `hd_areas` relation; the fact/consent columns come off
 * the `cpf`/`csub` joins; the rest are computed selections with no bare `persons.` column.
 */
const SORTABLE_PERSON_ALIASES: readonly string[] = [
  'electoral_area',
  'any_electoral_area',
  'support_level',
  'voting_status',
  'subscription_status',
  'household_is_placeholder',
  'tags',
  'issues',
];

/**
 * Resolve a grid sortModel colId to an ORDER BY target, or null for anything unknown. A saved sort
 * from a dropped column (the old `ward`/`district`/`precinct` text columns), a mistyped id or a
 * dotted reference must be SKIPPED, not passed through: an unknown identifier makes Postgres
 * reject the whole query and the grid never loads.
 */
function resolvePersonSortColumn(colId: unknown): string | null {
  if (typeof colId !== 'string') return null;
  if (SORTABLE_PERSON_COLUMNS.includes(colId)) return `persons.${colId}`;
  if (SORTABLE_PERSON_HOUSEHOLD_COLUMNS.includes(colId)) return `households.${colId}`;
  if (colId === 'company_name') return 'companies.name';
  if (colId === 'address') return 'households.street1';
  if (SORTABLE_PERSON_ALIASES.includes(colId)) return colId;
  return null;
}

export class PersonsRepo extends BaseRepository<'persons'> {
  constructor() {
    super('persons');
  }

  public async getIdsByFileId(
    input: { tenant_id: string; file_id: string },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    if (!input.file_id) return [];
    const rows = await this.getSelect(trx)
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.file_id)
      .execute();
    return rows.map((row) => (row.id != null ? String(row.id) : '')).filter((id) => id.length > 0);
  }

  public async clearFileIdForImport(
    input: { tenant_id: string; import_id: string; user_id: string },
    trx?: Transaction<Models>,
  ) {
    await this.getUpdate(trx)
      .set({
        file_id: null,
        updated_at: sql`now()`,
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.import_id)
      .executeTakeFirst();
  }

  public async getByIds(
    input: { tenant_id: string; ids: string[]; requireVolunteer?: boolean },
    trx?: Transaction<Models>,
  ) {
    const ids = Array.from(new Set((input.ids ?? []).map((id) => String(id)).filter(Boolean)));
    if (!ids.length) return [];

    let query = this.getSelect(trx)
      .select(['persons.id', 'persons.first_name', 'persons.last_name', 'persons.email'])
      .where('persons.tenant_id', '=', input.tenant_id)
      .where('persons.id', 'in', ids);

    // Volunteer standing is a first-class person status (§15), no longer a tag —
    // any non-null status counts as "is a volunteer".
    if (input.requireVolunteer) {
      query = query.where('persons.volunteer_status', 'is not', null);
    }

    const rows = await query.execute();
    const map = new Map<string, { id: string; first_name: string; last_name: string; email: string | null }>();
    for (const row of rows) {
      const id = row.id != null ? String(row.id) : '';
      if (!id || map.has(id)) continue;
      map.set(id, {
        id,
        first_name: row.first_name ?? '',
        last_name: row.last_name ?? '',
        email: row.email ?? null,
      });
    }
    return Array.from(map.values());
  }

  /**
   * Promote people to an active volunteer standing when they are added to a team
   * (§15) — the structured-status replacement for the old auto-attach of the
   * `volunteer` tag. Only fills a NULL status, so an explicit
   * inactive/former/prospective classification is never clobbered.
   */
  public async promoteToActiveVolunteer(
    input: { tenant_id: string; ids: string[]; user_id: string },
    trx?: Transaction<Models>,
  ) {
    const ids = Array.from(new Set((input.ids ?? []).map((id) => String(id)).filter(Boolean)));
    if (!ids.length) return;
    await this.getUpdate(trx)
      .set({ volunteer_status: 'active', updated_at: sql`now()`, updatedby_id: input.user_id })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', ids)
      .where('volunteer_status', 'is', null)
      .execute();
  }

  public async getCreatedStats(input: { tenant_id: string; user_id: string }) {
    const row = await this.getSelect()
      .select(() => [sql<number>`count(*)`.as('total'), sql<Date>`max(created_at)`.as('last_created_at')])
      .where('tenant_id', '=', input.tenant_id)
      .where('createdby_id', '=', input.user_id)
      .executeTakeFirst();

    return {
      total: Number(row?.total ?? 0),
      last_created_at: row?.last_created_at ? new Date(row.last_created_at) : null,
    };
  }

  public async moveToNewHousehold(input: {
    tenant_id: string;
    person_id: string;
    user_id: string;
    campaign_id: string;
  }) {
    const households = new HouseholdRepo();
    return this.transaction().execute(async (trx) => {
      // Reuse existing blank household if available
      const existingBlank = await households.getBlankHousehold({ tenant_id: input.tenant_id }, trx);
      let targetId = existingBlank?.id as string | undefined;

      if (!targetId) {
        const newHousehold = await households.add(
          {
            row: {
              tenant_id: input.tenant_id,
              campaign_id: input.campaign_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            } as OperationDataType<'households', 'insert'>,
          },
          trx,
        );
        targetId = newHousehold?.id as string | undefined;
      }

      await this.update(
        {
          tenant_id: input.tenant_id,
          id: input.person_id,
          row: { household_id: targetId, updatedby_id: input.user_id } as OperationDataType<'persons', 'update'>,
        },
        trx,
      );

      return { household_id: targetId };
    });
  }

  /**
   * The people grid's read, and the query a smart list's rules resolve through.
   *
   * Two shapes, and which one you get depends on `input.fullScan`:
   *
   * - Without it (every client request, because the tRPC router only ever fills `options`), the
   *   result is one page, capped at `MAX_PAGE_SIZE`, and `count` is the total number of matching
   *   people.
   * - With it (backend callers only — see `FullScanBatch`), the result is one batch of at most
   *   `FULL_SCAN_BATCH_SIZE` rows ordered by `persons.id`, starting after `fullScan.afterId`, and
   *   `count` is the size of that batch rather than the total. The caller loops until a short
   *   batch comes back. This is how list membership reads every matching person instead of the
   *   first 5000.
   */
  public async getAllWithAddress(
    input: {
      tenant_id: string;
      options?: QueryParams<'persons' | 'households' | 'tags' | 'map_peoples_tags'> & { issues?: string[] };
      tags?: string[];
      issues?: string[];
      /** Backend-only. Absent on every client-originated call; see `FullScanBatch`. */
      fullScan?: FullScanBatch;
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams & {
      issues?: string[];
      listId?: string;
      campaignId?: string;
      volunteerStatus?: string[];
    } = input.options || {};
    const tenantId = input.tenant_id;
    const volunteerStatus = options.volunteerStatus?.map((s) => s.trim()).filter(Boolean);
    // Campaign-scoped facts join (§15): '0' matches no rows, so without an active
    // campaign the support/voting columns are simply NULL ("Unknown").
    const campaignId = options.campaignId ?? '0';
    // Which boundary set the single-valued `electoral_area` column reads — the campaign's own seat
    // set where it has one. Resolved once per request; null when the workspace has no map yet.
    const seatSetId = await resolveSeatSetId(trx ?? this.db, tenantId, options.campaignId ?? null);
    const searchStr = this.normalizeSearch(options.searchStr);
    const tags = input.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const issues = (input.issues || options.issues)?.map((i) => i.trim().toLowerCase()).filter(Boolean);
    const filterModel = (options.filterModel ?? {}) as Record<string, { op?: string; value?: unknown } | undefined>;
    const advModel =
      options.advancedFilterModel || (options.filterModel?.['tags_expression'] as typeof options.advancedFilterModel);
    // A backend full scan reads fixed-size batches walked by primary key; everything else — which
    // is every request that arrived over tRPC — is clamped to one page as before.
    const isFullScan = input.fullScan != null;
    const page = isFullScan ? { offset: 0, limit: FULL_SCAN_BATCH_SIZE } : resolvePageWindow(options);
    // The keyset cursor, flattened to a plain string so the guarded `.where` below needs neither a
    // cast nor a non-null assertion. An id is never the empty string, so '' means "no cursor".
    const scanCursorId = input.fullScan?.afterId ?? '';

    // Shared where clause builder. `includeLateral` controls the electoral lateral join: the data
    // query always carries it (the columns are selected), the count query only when a filter
    // actually reads them — see the count below.
    const applyFilters = <QB extends AnyQB>(qb: QB, includeLateral: boolean) => {
      let q = qb
        .leftJoin('households', 'persons.household_id', 'households.id')
        .leftJoin('map_peoples_tags', 'map_peoples_tags.person_id', 'persons.id')
        .leftJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
        .leftJoin('companies', 'persons.company_id', 'companies.id')
        .leftJoin('tenants', 'tenants.id', 'persons.tenant_id')
        // The person's household's electoral geography. Lateral rather than a plain join because a
        // household is in several boundaries at once and a plain join would multiply the person row
        // by that number, which would make the tag/issue `array_agg` below repeat every tag. The
        // subquery aggregates with no GROUP BY, so it always returns exactly one row.
        .$if(includeLateral, (qb2) =>
          qb2.leftJoinLateral(
            (eb: ExpressionBuilder<Models, 'households'>) =>
              eb
                .selectFrom('household_districts as hd')
                .whereRef('hd.household_id', '=', 'households.id')
                .whereRef('hd.tenant_id', '=', 'households.tenant_id')
                .select(electoralAreaSelects(seatSetId))
                .as('hd_areas'),
            (join: JoinBuilder<Models, 'households'>) => join.onTrue(),
          ),
        )
        .leftJoin('campaign_person_facts as cpf', (join) =>
          join
            .onRef('cpf.person_id', '=', 'persons.id')
            .on('cpf.tenant_id', '=', tenantId)
            .on('cpf.campaign_id', '=', campaignId),
        )
        // Email consent for this context (§15). At most one row per person
        // (uq_csub_campaign_person), so this adds no duplication. NULL = never
        // subscribed, which is how a "Subscriber status is subscribed" rule
        // correctly excludes people who never opted in.
        .leftJoin('campaign_subscriptions as csub', (join) =>
          join
            .onRef('csub.person_id', '=', 'persons.id')
            .on('csub.tenant_id', '=', tenantId)
            .on('csub.campaign_id', '=', campaignId),
        )
        .where('households.tenant_id', '=', tenantId)
        .$if(!!tags?.length, (q) => q.where('tags.name', 'in', tags ?? []).where('tags.type', '=', 'tag'))
        .$if(!!issues?.length, (q) => q.where('tags.name', 'in', issues ?? []).where('tags.type', '=', 'issue'))
        .$if(!!volunteerStatus?.length, (q) => q.where('persons.volunteer_status', 'in', volunteerStatus ?? []))
        .$if(!!options.listId, (qb) =>
          qb.where('persons.id', 'in', (eb: any) =>
            eb
              .selectFrom('map_lists_persons')
              .select('person_id')
              .where('list_id', '=', options.listId ?? '')
              .where('tenant_id', '=', tenantId),
          ),
        )
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          // ILIKE on the bare column (not LOWER(col) LIKE) so the trigram GIN
          // indexes can serve quick search; normalizeSearch already lowercases,
          // so the match semantics are identical.
          return qb.where(
            sql<boolean>`(
            persons.first_name ILIKE ${text} OR
            persons.last_name ILIKE ${text} OR
            persons.email ILIKE ${text} OR
            persons.mobile ILIKE ${text} OR
            households.city ILIKE ${text} OR
            households.street1 ILIKE ${text} OR
            companies.name ILIKE ${text} OR
            tags.name ILIKE ${text}
          )`,
          );
        });

      // Apply dynamic, operator-aware column filters
      q = this.applyColumnFilter(q, 'persons.first_name', filterModel['first_name'] ?? {});
      q = this.applyColumnFilter(q, 'persons.last_name', filterModel['last_name'] ?? {});
      q = this.applyColumnFilter(q, 'persons.email', filterModel['email'] ?? {});
      q = this.applyColumnFilter(q, 'persons.mobile', filterModel['mobile'] ?? {});
      q = this.applyColumnFilter(q, 'households.city', filterModel['city'] ?? {});
      q = this.applyColumnFilter(q, 'households.state', filterModel['state'] ?? {});
      q = this.applyColumnFilter(q, 'households.street1', filterModel['street1'] ?? {});
      q = this.applyCastColumnFilter(q, sql`households.street_num::text`, filterModel['street_num'] ?? {});
      q = this.applyColumnFilter(q, 'households.zip', filterModel['zip'] ?? {});
      if (includeLateral) {
        // The grid's "+ Add filter" on the two electoral columns lands here. Outer-query
        // references to a lateral alias are valid Postgres, so the operator-aware helper works
        // against `hd_areas` directly. Guarded because without the lateral the aliases don't exist.
        q = this.applyColumnFilter(q, 'hd_areas.electoral_area', filterModel['electoral_area'] ?? {});
        q = this.applyColumnFilter(q, 'hd_areas.any_electoral_area', filterModel['any_electoral_area'] ?? {});
      }
      if (filterModel['tags']?.value && filterModel['issues']?.value) {
        // Both filters present — use OR grouping to avoid contradictory AND on tags.type
        const tagVal = `%${String(filterModel['tags'].value).replace(/\*/g, '%')}%`;
        const issueVal = `%${String(filterModel['issues'].value).replace(/\*/g, '%')}%`;
        q = q.where((eb) =>
          eb.or([
            eb.and([eb('tags.type', '=', 'tag'), eb('tags.name', 'ilike', tagVal)]),
            eb.and([eb('tags.type', '=', 'issue'), eb('tags.name', 'ilike', issueVal)]),
          ]),
        );
      } else if (filterModel['tags']?.value) {
        q = q.where('tags.type', '=', 'tag');
        q = this.applyColumnFilter(q, 'tags.name', filterModel['tags']);
      } else if (filterModel['issues']?.value) {
        q = q.where('tags.type', '=', 'issue');
        q = this.applyColumnFilter(q, 'tags.name', filterModel['issues']);
      }
      q = this.applyColumnFilter(q, 'companies.name', filterModel['company_name'] ?? {});

      // Apply advanced query builder filters if present
      const columnMapping = {
        first_name: { col: 'persons.first_name' },
        last_name: { col: 'persons.last_name' },
        email: { col: 'persons.email' },
        mobile: { col: 'persons.mobile' },
        city: { col: 'households.city' },
        state: { col: 'households.state' },
        street1: { col: 'households.street1' },
        street_num: { col: 'households.street_num::text', isCast: true },
        zip: { col: 'households.zip' },
        tag: { col: 'tags.name' },
        tags: { col: 'tags.name' },
        issues: { col: 'tags.name' },
        company_name: { col: 'companies.name' },
        notes: { col: 'persons.notes' },
        country: { col: 'households.country' },
        // Structured person status (§15) — the first-class replacements for the
        // retired `volunteer` / `staff` tags. NULL means "not one", which the
        // isEmpty / isNotEmpty operators read correctly.
        volunteer_status: { col: 'persons.volunteer_status' },
        staff_status: { col: 'persons.staff_status' },
        // Recorded at the door (§13), and compared as text like do_not_contact below.
        // `senior` is genuinely tri-state (NULL = nobody has asked), so its own cast is
        // enough. `deceased_at` is a DATE, and a rule asking "is deceased" wants a yes/no
        // — so the presence of the date is what gets cast, not the date itself.
        senior: { col: 'persons.senior::text', isCast: true },
        deceased: { col: '(persons.deceased_at IS NOT NULL)::text', isCast: true },
        // Campaign-scoped facts — resolved against options.campaignId above, so
        // a rule on these means "in the context this query is running in".
        subscription_status: { col: 'csub.status' },
        support_level: { col: 'cpf.support_level' },
        voting_status: { col: 'cpf.voting_status' },
        // Booleans have to go through a text cast for the ILIKE-based operators;
        // the values a rule compares against are 'true' / 'false'.
        do_not_contact: { col: 'persons.do_not_contact::text', isCast: true },
        // Where the person lives, electorally. Two fields, because they answer two different
        // questions: `electoral_area` is the household's area in the campaign's own seat set, a
        // single value that compares exactly; `any_electoral_area` is every area the household is
        // in, joined together, which is what makes "everyone in precinct 12" expressible when
        // precincts are not the seat set. The second is a concatenation, so it answers `contains`
        // honestly and `equals` only for a household in exactly one area.
        //
        // Mapped only while the lateral join is present: without it a rule on these fields is
        // dropped by buildGroupExpression instead of producing a query naming a missing alias.
        ...(includeLateral
          ? {
              electoral_area: { col: 'hd_areas.electoral_area' },
              any_electoral_area: { col: 'hd_areas.any_electoral_area' },
            }
          : {}),
      };
      q = this.applyAdvancedFilters(q, advModel, columnMapping);

      return q;
    };

    // Count query. It never reads the electoral columns, and the lateral aggregate over
    // household_districts is per-row work Postgres cannot eliminate — so the join rides along
    // only when an active filter or rule actually references those fields, which keeps the
    // count's predicate identical to the data query's.
    const countNeedsElectoral = referencesElectoralAreas(filterModel, advModel);
    const countMatchingPeople = async (): Promise<number> => {
      const countResult = await applyFilters(this.getSelect(trx), countNeedsElectoral)
        .select(({ fn }) => [fn.count(sql`DISTINCT persons.id`).as('total')])
        .execute();
      return Number(countResult[0]?.['total'] || 0);
    };

    // A full scan calls this method once per batch and reads only `rows`. Running the DISTINCT
    // count on every batch would re-execute the whole predicate for a number the caller does not
    // use, so it is skipped and the batch's own size is reported instead (see the doc comment).
    const totalCount = isFullScan ? null : await countMatchingPeople();

    // Data query
    const rows = await applyFilters(this.getSelect(trx), true)
      .select((eb) => [
        'persons.id',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'persons.notes',
        'persons.household_id',
        'persons.company_id',
        'companies.name as company_name',
        'households.country',
        'households.zip',
        'households.state',
        'households.home_phone',
        'households.city',
        'households.street1',
        'households.street2',
        'households.street_num',
        'households.apt',
        eb
          .case()
          .when('tenants.placeholder_household_id', '=', eb.ref('persons.household_id'))
          .then(true)
          .else(false)
          .end()
          .as('household_is_placeholder'),
        'cpf.support_level',
        'cpf.voting_status',
        // Structured status + consent, so the list-builder's client-side preview
        // can evaluate the same rules the server does against the loaded rows.
        'persons.volunteer_status',
        'persons.staff_status',
        'persons.do_not_contact',
        'persons.deceased_at',
        'persons.senior',
        'csub.status as subscription_status',
        // Selected as well as filtered on, because the list builder's live preview evaluates the
        // same rules client-side against these rows (see the pplcrm-lists skill).
        'hd_areas.electoral_area',
        'hd_areas.any_electoral_area',
        sql<string[]>`coalesce(array_remove(array_agg(CASE WHEN tags.type = 'tag' THEN tags.name END), null), '{}')`.as(
          'tags',
        ),
        sql<
          string[]
        >`coalesce(array_remove(array_agg(CASE WHEN tags.type = 'issue' THEN tags.name END), null), '{}')`.as('issues'),
      ])
      .groupBy([
        'persons.id',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'persons.notes',
        'persons.household_id',
        'persons.company_id',
        'persons.created_at',
        'persons.updated_at',
        'persons.tenant_id',
        'persons.createdby_id',
        'persons.updatedby_id',
        'companies.name',
        'households.country',
        'households.zip',
        'households.state',
        'households.home_phone',
        'households.city',
        'households.street1',
        'households.street2',
        'households.street_num',
        'households.apt',
        'tenants.placeholder_household_id',
        'cpf.support_level',
        'cpf.voting_status',
        'persons.volunteer_status',
        'persons.staff_status',
        'persons.do_not_contact',
        'persons.deceased_at',
        'persons.senior',
        'csub.status',
        'hd_areas.electoral_area',
        'hd_areas.any_electoral_area',
      ])
      // The caller's sort is skipped during a full scan: the scan's own primary-key order is what
      // makes the keyset cursor below correct, and a second ORDER BY term ahead of it would let
      // batches repeat and skip rows. Nothing reads the row order of a membership scan.
      .$if(!isFullScan && !!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce((acc, sort) => {
          const col = resolvePersonSortColumn(sort.colId);
          if (col == null) return acc;
          return acc.orderBy(col, sort.sort);
        }, qb),
      )
      .$if(isFullScan, (qb) => qb.orderBy('persons.id'))
      .$if(scanCursorId !== '', (qb) => qb.where('persons.id', '>', scanCursorId))
      // Always paged. This used to be a `$if` on both fields being present, so a call with no
      // paging at all — which `persons.getAllWithAddress` accepts directly from any signed-in
      // caller — emitted no LIMIT clause and read every person in the workspace across the seven
      // joins above. A full scan is still paged; it just repeats the page.
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    return { count: totalCount ?? rows.length, rows };
  }

  public getByHouseholdId(
    input: { id: string; tenant_id: string; options: QueryParams<'persons'> },
    trx?: Transaction<Models>,
  ) {
    return this.getSelectWithColumns(input.options, trx)
      .where('household_id', '=', input.id)
      .where('tenant_id', '=', input.tenant_id)
      .execute();
  }

  public getByCompanyId(
    input: { id: string; tenant_id: string; options: QueryParams<'persons'> },
    trx?: Transaction<Models>,
  ) {
    return this.getSelectWithColumns(input.options, trx)
      .where('company_id', '=', input.id)
      .where('tenant_id', '=', input.tenant_id)
      .execute();
  }

  public async countByCompanyId(input: { id: string; tenant_id: string }): Promise<number> {
    const result = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('company_id', '=', input.id)
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirst();
    return Number(result?.total ?? 0);
  }

  /**
   * Tenant-scoped resolution by opaque public_id for /people/:slug URLs
   * (spec §1). `public_id` is the canonical person key — the decorative name in
   * the URL is ignored — so a stale name in an old link still resolves.
   */
  public getByPublicId(input: { tenant_id: string; public_id: string }) {
    return this.getSelect()
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('public_id', '=', input.public_id)
      .executeTakeFirst();
  }

  /** People linked to any company — powers the Companies grain sentence ("{n} people in {m} companies"). */
  public async countWithCompany(input: { tenant_id: string }): Promise<number> {
    const result = await this.getSelect()
      .select(({ fn }) => [fn.count<number>('id').as('total')])
      .where('company_id', 'is not', null)
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirst();
    return Number(result?.total ?? 0);
  }

  public getDistinctTags(tenant_id: string, type: 'tag' | 'issue' = 'tag') {
    return this.getSelect()
      .innerJoin('map_peoples_tags', 'map_peoples_tags.person_id', 'persons.id')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .where('persons.tenant_id', '=', tenant_id)
      .where('tags.type', '=', type)
      .select('tags.name')
      .distinct()
      .execute();
  }

  public getTags(input: { id: string; tenant_id: string; type?: 'tag' | 'issue' }) {
    let q = this.getSelect()
      .innerJoin('map_peoples_tags', 'map_peoples_tags.person_id', 'persons.id')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .where('persons.id', '=', input.id)
      .where('persons.tenant_id', '=', input.tenant_id);
    if (input.type) {
      q = q.where('tags.type', '=', input.type);
    }
    return q.select('tags.name').execute();
  }
  public async findByEmail(input: { tenant_id: string; email: string }) {
    return this.getSelect()
      .select(['id', 'email'])
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`lower(email)`, '=', input.email.trim().toLowerCase())
      .executeTakeFirst();
  }

  /**
   * Batched email-identity lookup for the CSV import wizard's Review step
   * (spec §17) — given a set of candidate emails, return the existing person
   * each one matches (if any), so the wizard can show "3 rows match people
   * you already have" with a door to each matched person.
   */
  public async findManyByEmails(input: { tenant_id: string; emails: string[] }) {
    const normalized = Array.from(
      new Set(input.emails.map((email) => email.trim().toLowerCase()).filter((email) => email.length > 0)),
    );
    if (normalized.length === 0) return [];

    return this.getSelect()
      .select(['id', 'first_name', 'last_name', 'email', 'slug'])
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`lower(email)`, 'in', normalized)
      .execute();
  }

  /**
   * The companion volunteer status of each of these people, for the ones that have a volunteer
   * row at all. `companion_volunteers` is UNIQUE (tenant_id, person_id), so there is at most one
   * status per person. Used to tell an operator, before they confirm a merge, whether that merge
   * will drop one of the two volunteer rows and the companion access it carries.
   */
  public async getCompanionVolunteerStatuses(
    tenant_id: string,
    person_ids: string[],
  ): Promise<Map<string, CompanionVolunteerStatus>> {
    const ids = Array.from(new Set(person_ids.filter((id) => id.length > 0)));
    if (ids.length === 0) return new Map();

    const rows = await this.db
      .selectFrom('companion_volunteers')
      .select(['person_id', 'status'])
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', ids)
      .execute();

    const byPerson = new Map<string, CompanionVolunteerStatus>();
    for (const row of rows) {
      // `status` is a plain text column in the Kysely model, so narrow it against the shared
      // vocabulary rather than asserting. A value outside it is treated as "no known status".
      const status = COMPANION_VOLUNTEER_STATUSES.find((known) => known === row.status);
      if (status) byPerson.set(String(row.person_id), status);
    }
    return byPerson;
  }

  public async getDuplicateCount(tenant_id: string): Promise<number> {
    // NOTE: unscoped by design — tenant_id filtered inside subquery
    // eslint-disable-next-line local/no-unscoped-db-query
    const countResult = await this.db
      .selectFrom((qb) =>
        qb
          .selectFrom('potential_duplicates')
          .innerJoin('persons', 'potential_duplicates.person_id', 'persons.id')
          .select('potential_duplicates.group_key')
          .where('potential_duplicates.tenant_id', '=', tenant_id)
          .groupBy('potential_duplicates.group_key')
          .having(sql`count(potential_duplicates.id)`, '>', 1)
          .as('sub'),
      )
      .select([sql<number>`count(group_key)`.as('total')])
      .executeTakeFirst();
    return Number(countResult?.total ?? 0);
  }

  public async getPotentialDuplicates(
    tenant_id: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<{ groups: unknown[]; total: number }> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;

    // NOTE: unscoped by design — tenant_id filtered inside subquery
    // eslint-disable-next-line local/no-unscoped-db-query
    const countResult = await this.db
      .selectFrom((qb) =>
        qb
          .selectFrom('potential_duplicates')
          .innerJoin('persons', 'potential_duplicates.person_id', 'persons.id')
          .select('potential_duplicates.group_key')
          .where('potential_duplicates.tenant_id', '=', tenant_id)
          .groupBy('potential_duplicates.group_key')
          .having(sql`count(potential_duplicates.id)`, '>', 1)
          .as('sub'),
      )
      .select([sql<number>`count(group_key)`.as('total')])
      .executeTakeFirst();
    const total = Number(countResult?.total ?? 0);

    if (total === 0) {
      return { groups: [], total: 0 };
    }

    const keysRows = await this.db
      .selectFrom('potential_duplicates')
      .innerJoin('persons', 'potential_duplicates.person_id', 'persons.id')
      .select('potential_duplicates.group_key')
      .where('potential_duplicates.tenant_id', '=', tenant_id)
      .groupBy('potential_duplicates.group_key')
      .having(sql`count(potential_duplicates.id)`, '>', 1)
      .orderBy(sql`min(potential_duplicates.id)`)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();

    const groupKeys = keysRows.map((r) => r.group_key);

    if (groupKeys.length === 0) {
      return { groups: [], total };
    }

    const rows = await this.db
      .selectFrom('potential_duplicates')
      .innerJoin('persons', 'potential_duplicates.person_id', 'persons.id')
      .leftJoin('households', 'households.id', 'persons.household_id')
      .select([
        'potential_duplicates.group_key',
        'potential_duplicates.reason',
        'persons.id',
        'persons.first_name',
        'persons.last_name',
        'persons.email',
        'persons.mobile',
        'persons.home_phone',
        'persons.notes',
        'persons.company_id',
        'persons.household_id',
        'persons.created_at',
        // Replaces `households.ward`. The field-grid comparison shows where each candidate lives,
        // and a household is now in several boundaries at once, so this is every area it falls in
        // rather than one column that only ever held the last geocoding pass's answer. Named
        // `any_electoral_area` because that key means "all boundaries, joined" everywhere else,
        // while `electoral_area` means the single seat-set value.
        anyElectoralAreaSubquery().as('any_electoral_area'),
      ])
      .where('potential_duplicates.tenant_id', '=', tenant_id)
      .where('potential_duplicates.group_key', 'in', groupKeys)
      .execute();

    // Field-grid comparison (spec §9.3 pair card) wants each person's tags too — fetched
    // separately rather than joined in (a join would multiply the row per tag).
    const personIds = rows.map((r) => String(r.id));
    const tagsByPerson = new Map<string, string[]>();
    if (personIds.length > 0) {
      const tagRows = await this.db
        .selectFrom('map_peoples_tags')
        .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
        .select(['map_peoples_tags.person_id', 'tags.name'])
        .where('map_peoples_tags.tenant_id', '=', tenant_id)
        .where('map_peoples_tags.person_id', 'in', personIds)
        .where('tags.type', '=', 'tag')
        .execute();
      for (const t of tagRows) {
        const key = String(t.person_id);
        const list = tagsByPerson.get(key) ?? [];
        list.push(t.name);
        tagsByPerson.set(key, list);
      }
    }

    const groupsMap = new Map<string, { reason: string; persons: Record<string, unknown>[] }>();
    for (const row of rows) {
      const groupKey = row.group_key;
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          reason: row.reason,
          persons: [],
        });
      }
      groupsMap.get(groupKey)?.persons.push({
        ...row,
        id: String(row.id),
        tags: tagsByPerson.get(String(row.id)) ?? [],
      });
    }

    const sortedGroups = groupKeys
      .map((key) => {
        const group = groupsMap.get(key);
        return group ? { ...group, group_key: key } : undefined;
      })
      .filter((g): g is NonNullable<typeof g> => !!(g && g.persons.length > 1));

    return { groups: sortedGroups, total };
  }

  public async mergePersons(input: { tenant_id: string; target_id: string; source_id: string; user_id: string }) {
    return this.transaction().execute(async (trx) => {
      const target = (await this.getOneBy(
        'id',
        { tenant_id: input.tenant_id as TypeTenantId<'persons'>, value: input.target_id },
        trx,
      )) as Selectable<Models['persons']>;
      const source = (await this.getOneBy(
        'id',
        { tenant_id: input.tenant_id as TypeTenantId<'persons'>, value: input.source_id },
        trx,
      )) as Selectable<Models['persons']>;

      if (!target || !source) {
        throw new Error('Target or Source person not found');
      }

      // 1. Merge fields (copy null/empty fields from source to target)
      const targetUpdate: Record<string, unknown> = {};
      const fields = [
        'first_name',
        'middle_names',
        'last_name',
        'email',
        'email2',
        'mobile',
        'home_phone',
        'notes',
        'company_id',
        'file_id',
      ] as const;

      for (const field of fields) {
        const targetVal = target[field];
        const sourceVal = source[field];
        if (
          (targetVal == null || String(targetVal).trim() === '') &&
          sourceVal != null &&
          String(sourceVal).trim() !== ''
        ) {
          targetUpdate[field] = sourceVal;
        }
      }

      // Do-not-contact carries over — a merge must never make someone MORE contactable.
      // Channels merge as a union; null means "all channels", so a union with null stays null.
      if (source.do_not_contact) {
        if (!target.do_not_contact) {
          targetUpdate['do_not_contact'] = true;
          targetUpdate['do_not_contact_channels'] = source.do_not_contact_channels ?? null;
        } else if (target.do_not_contact_channels != null) {
          targetUpdate['do_not_contact_channels'] =
            source.do_not_contact_channels == null
              ? null
              : Array.from(new Set([...target.do_not_contact_channels, ...source.do_not_contact_channels]));
        }
      }

      if (Object.keys(targetUpdate).length > 0) {
        targetUpdate['updatedby_id'] = input.user_id;
        targetUpdate['updated_at'] = sql`now()`;
        await this.update({ tenant_id: input.tenant_id, id: input.target_id, row: targetUpdate }, trx);
      }

      // 2. Transfer tags (map_peoples_tags)
      const targetTags = await trx
        .selectFrom('map_peoples_tags')
        .select('tag_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetTagIds = new Set(targetTags.map((t) => String(t.tag_id)));

      const sourceTags = await trx
        .selectFrom('map_peoples_tags')
        .select(['tag_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      for (const st of sourceTags) {
        const tagIdStr = String(st.tag_id);
        if (!targetTagIds.has(tagIdStr)) {
          await trx
            .insertInto('map_peoples_tags')
            .values({
              tenant_id: input.tenant_id,
              person_id: input.target_id,
              tag_id: st.tag_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_peoples_tags')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // 3. Transfer lists (map_lists_persons)
      const targetLists = await trx
        .selectFrom('map_lists_persons')
        .select('list_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetListIds = new Set(targetLists.map((l) => String(l.list_id)));

      const sourceLists = await trx
        .selectFrom('map_lists_persons')
        .select(['list_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      for (const sl of sourceLists) {
        if (!targetListIds.has(String(sl.list_id))) {
          await trx
            .insertInto('map_lists_persons')
            .values({
              tenant_id: input.tenant_id,
              person_id: input.target_id,
              list_id: sl.list_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_lists_persons')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // 4. Transfer teams (map_teams_persons)
      const targetTeams = await trx
        .selectFrom('map_teams_persons')
        .select('team_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetTeamIds = new Set(targetTeams.map((t) => String(t.team_id)));

      const sourceTeams = await trx
        .selectFrom('map_teams_persons')
        .select(['team_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      for (const st of sourceTeams) {
        if (!targetTeamIds.has(String(st.team_id))) {
          await trx
            .insertInto('map_teams_persons')
            .values({
              tenant_id: input.tenant_id,
              person_id: input.target_id,
              team_id: st.team_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_teams_persons')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // 5. Reassign captaincy if source was captain of any team
      await trx
        .updateTable('teams')
        .set({ team_captain_id: input.target_id, updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('team_captain_id', '=', input.source_id)
        .execute();
      // 6. Re-point child rows with no per-person uniqueness constraint. Without this,
      // deleting the source would SET NULL (donations, donation_pledges, delivery_requests,
      // delivery_routes.volunteer_person_id, tasks, turf_knocks) or CASCADE-delete
      // (form_submissions) this history — silent data loss. workflow_runs.person_id and
      // turf_segment_claims.volunteer_person_id carry NO foreign key at all, so nothing in
      // the database would even null them: they would keep pointing at a row that is gone.
      await trx
        .updateTable('donations')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('donation_pledges')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('delivery_requests')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('delivery_routes')
        .set({ volunteer_person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('volunteer_person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('turf_knocks')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('form_submissions')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      await trx
        .updateTable('tasks')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      // workflow_runs has no updatedby_id/updated_at columns — it is an append-only log.
      await trx
        .updateTable('workflow_runs')
        .set({ person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      // turf_segment_claims is unique on (tenant_id, turf_id, assignment_id) where the claim
      // is still live — the volunteer is not part of that key, so a plain re-point is safe.
      await trx
        .updateTable('turf_segment_claims')
        .set({ volunteer_person_id: input.target_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('volunteer_person_id', '=', input.source_id)
        .execute();
      // donation_receipts: official receipts (per_gift/cumulative) have no per-person
      // uniqueness — plain re-point; the donor name/address PRINTED on an issued receipt is a
      // frozen snapshot and stays exactly as issued. Live STATEMENTS are unique per
      // (person, year), and a merged donor's statement is wrong anyway (it must cover both
      // histories), so the source's live statements are cancelled first — rerunning the year
      // regenerates one combined statement — and then every receipt row is re-pointed.
      await trx
        .updateTable('donation_receipts')
        .set({
          status: 'cancelled',
          cancelled_reason: 'Donor records merged — rerun year-end statements',
          cancelled_at: sql`now()`,
          cancelled_by: input.user_id,
          updated_at: sql`now()`,
          updatedby_id: input.user_id,
        })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .where('kind', '=', 'statement')
        .where('status', '=', 'issued')
        .execute();
      await trx
        .updateTable('donation_receipts')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // 7. Children keyed uniquely per person: keep the TARGET's row when both exist
      // (delete the source's duplicate instead of violating the constraint), re-point the rest.
      // campaign_person_facts — unique (tenant_id, campaign_id, person_id)
      const targetFacts = await trx
        .selectFrom('campaign_person_facts')
        .select('campaign_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetFactCampaigns = targetFacts.map((r) => String(r.campaign_id));
      if (targetFactCampaigns.length > 0) {
        await trx
          .deleteFrom('campaign_person_facts')
          .where('tenant_id', '=', input.tenant_id)
          .where('person_id', '=', input.source_id)
          .where('campaign_id', 'in', targetFactCampaigns)
          .execute();
      }
      await trx
        .updateTable('campaign_person_facts')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // event_registrations — unique (tenant_id, event_id, person_id)
      const targetRegs = await trx
        .selectFrom('event_registrations')
        .select('event_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetRegEvents = targetRegs.map((r) => String(r.event_id));
      if (targetRegEvents.length > 0) {
        await trx
          .deleteFrom('event_registrations')
          .where('tenant_id', '=', input.tenant_id)
          .where('person_id', '=', input.source_id)
          .where('event_id', 'in', targetRegEvents)
          .execute();
      }
      await trx
        .updateTable('event_registrations')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // volunteer_shifts — no DB unique, but one signup per person+event is the app invariant
      const targetShifts = await trx
        .selectFrom('volunteer_shifts')
        .select('event_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetShiftEvents = targetShifts.map((r) => String(r.event_id));
      if (targetShiftEvents.length > 0) {
        await trx
          .deleteFrom('volunteer_shifts')
          .where('tenant_id', '=', input.tenant_id)
          .where('person_id', '=', input.source_id)
          .where('event_id', 'in', targetShiftEvents)
          .execute();
      }
      await trx
        .updateTable('volunteer_shifts')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // workflow_enrollments — app-level dedupe: someone already in a sequence isn't enrolled twice
      const targetEnrollments = await trx
        .selectFrom('workflow_enrollments')
        .select('workflow_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetEnrollmentWorkflows = targetEnrollments.map((r) => String(r.workflow_id));
      if (targetEnrollmentWorkflows.length > 0) {
        await trx
          .deleteFrom('workflow_enrollments')
          .where('tenant_id', '=', input.tenant_id)
          .where('person_id', '=', input.source_id)
          .where('workflow_id', 'in', targetEnrollmentWorkflows)
          .execute();
      }
      await trx
        .updateTable('workflow_enrollments')
        .set({ person_id: input.target_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // companion_volunteers — unique (tenant_id, person_id), and unlike every other row
      // here it is an ACCESS GRANT: `status = 'approved'` is what lets someone open the
      // canvass/deliveries companion apps and read voter data. So the collision rule is
      // the target's row wins outright, exactly as campaign_person_facts does, and
      // deliberately NOT "whichever row is further along its lifecycle". Keeping the more
      // permissive row would let a merge hand out access nobody granted — a target whose
      // access was explicitly revoked would come back approved because the source happened
      // to be approved. The cost of choosing this direction is the mirror case: merging an
      // approved source into a target who was only ever invited takes companion access
      // away, and that volunteer has to verify a code again on the surviving record. That
      // is the safe direction to be wrong in, but it IS user-visible, so an admin merging
      // an active canvasser into another record should expect to re-approve them.
      const targetVolunteer = await trx
        .selectFrom('companion_volunteers')
        .select('id')
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .executeTakeFirst();
      if (targetVolunteer) {
        // The source's volunteer row is about to go. Its device sessions and outstanding
        // approve-by-text tokens are keyed on that row's id and carry no foreign key, so
        // nothing else would clean them up; they would sit there naming an id that no
        // longer exists. They can never authenticate again either way (requireSession
        // resolves volunteer_id back to a row and refuses when it finds none), so delete
        // them rather than leave the debris.
        const sourceVolunteers = await trx
          .selectFrom('companion_volunteers')
          .select('id')
          .where('tenant_id', '=', input.tenant_id)
          .where('person_id', '=', input.source_id)
          .execute();
        const sourceVolunteerIds = sourceVolunteers.map((v) => String(v.id));
        if (sourceVolunteerIds.length > 0) {
          await trx
            .deleteFrom('companion_sessions')
            .where('tenant_id', '=', input.tenant_id)
            .where('volunteer_id', 'in', sourceVolunteerIds)
            .execute();
          await trx
            .deleteFrom('companion_approval_tokens')
            .where('tenant_id', '=', input.tenant_id)
            .where('volunteer_id', 'in', sourceVolunteerIds)
            .execute();
          await trx
            .deleteFrom('companion_volunteers')
            .where('tenant_id', '=', input.tenant_id)
            .where('person_id', '=', input.source_id)
            .execute();
        }
      }
      // Only the source is a volunteer: move the row wholesale, which keeps its approval
      // state, its device sessions and its join-code provenance intact under the survivor.
      await trx
        .updateTable('companion_volunteers')
        .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();

      // turf_assignments.volunteer_person_id — partial unique index
      // uq_turf_assignments_active_volunteer (tenant_id, turf_id, volunteer_person_id)
      // WHERE status = 'active', added by 2026-07-28-turf-multiple-canvassers. Revoke rather
      // than delete the source's active row on a turf the target is already walking: that is
      // what the migration itself did to collapse duplicates, revoked rows fall outside the
      // partial index, and the assignment row is history worth keeping.
      const targetActiveTurfs = await trx
        .selectFrom('turf_assignments')
        .select('turf_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('volunteer_person_id', '=', input.target_id)
        .where('status', '=', 'active')
        .execute();
      const targetActiveTurfIds = targetActiveTurfs.map((r) => String(r.turf_id));
      if (targetActiveTurfIds.length > 0) {
        await trx
          .updateTable('turf_assignments')
          .set({ status: 'revoked', updatedby_id: input.user_id, updated_at: sql`now()` })
          .where('tenant_id', '=', input.tenant_id)
          .where('volunteer_person_id', '=', input.source_id)
          .where('status', '=', 'active')
          .where('turf_id', 'in', targetActiveTurfIds)
          .execute();
      }
      await trx
        .updateTable('turf_assignments')
        .set({ volunteer_person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
        .where('tenant_id', '=', input.tenant_id)
        .where('volunteer_person_id', '=', input.source_id)
        .execute();

      // 8. campaign_subscriptions — unique (tenant_id, campaign_id, person_id). Keep the
      // target's row on collision, but consent is MOST-restrictive: if either record for a
      // campaign is unsubscribed, the surviving row must be unsubscribed. A merge must never
      // make someone more contactable.
      const targetSubs = await trx
        .selectFrom('campaign_subscriptions')
        .select(['id', 'campaign_id', 'status'])
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.target_id)
        .execute();
      const targetSubByCampaign = new Map(targetSubs.map((s) => [String(s.campaign_id), s]));
      const sourceSubs = await trx
        .selectFrom('campaign_subscriptions')
        .select(['id', 'campaign_id', 'status', 'unsubscribed_at'])
        .where('tenant_id', '=', input.tenant_id)
        .where('person_id', '=', input.source_id)
        .execute();
      for (const sub of sourceSubs) {
        const existing = targetSubByCampaign.get(String(sub.campaign_id));
        if (!existing) {
          await trx
            .updateTable('campaign_subscriptions')
            .set({ person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', sub.id)
            .execute();
          continue;
        }
        if (sub.status === 'unsubscribed' && existing.status !== 'unsubscribed') {
          await trx
            .updateTable('campaign_subscriptions')
            .set({
              status: 'unsubscribed',
              unsubscribed_at: sub.unsubscribed_at ?? sql`now()`,
              updatedby_id: input.user_id,
              updated_at: sql`now()`,
            })
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', existing.id)
            .execute();
        }
        await trx
          .deleteFrom('campaign_subscriptions')
          .where('tenant_id', '=', input.tenant_id)
          .where('id', '=', sub.id)
          .execute();
      }

      // 9. person_connections — re-point both edge directions. Drop edges that would become a
      // self-loop (source connected to target) or collide with an identical existing target
      // edge (unique on tenant/from/to/relation_type; CHECK forbids from = to).
      const targetFromEdges = await trx
        .selectFrom('person_connections')
        .select(['to_person_id', 'relation_type'])
        .where('tenant_id', '=', input.tenant_id)
        .where('from_person_id', '=', input.target_id)
        .execute();
      const targetFromKeys = new Set(targetFromEdges.map((e) => `${String(e.to_person_id)}|${e.relation_type}`));
      const sourceFromEdges = await trx
        .selectFrom('person_connections')
        .select(['id', 'to_person_id', 'relation_type'])
        .where('tenant_id', '=', input.tenant_id)
        .where('from_person_id', '=', input.source_id)
        .execute();
      for (const edge of sourceFromEdges) {
        const key = `${String(edge.to_person_id)}|${edge.relation_type}`;
        if (String(edge.to_person_id) === String(input.target_id) || targetFromKeys.has(key)) {
          await trx
            .deleteFrom('person_connections')
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', edge.id)
            .execute();
        } else {
          targetFromKeys.add(key);
          await trx
            .updateTable('person_connections')
            .set({ from_person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', edge.id)
            .execute();
        }
      }
      // (to-side selected after the from-side re-point so freshly moved edges count too)
      const targetToEdges = await trx
        .selectFrom('person_connections')
        .select(['from_person_id', 'relation_type'])
        .where('tenant_id', '=', input.tenant_id)
        .where('to_person_id', '=', input.target_id)
        .execute();
      const targetToKeys = new Set(targetToEdges.map((e) => `${String(e.from_person_id)}|${e.relation_type}`));
      const sourceToEdges = await trx
        .selectFrom('person_connections')
        .select(['id', 'from_person_id', 'relation_type'])
        .where('tenant_id', '=', input.tenant_id)
        .where('to_person_id', '=', input.source_id)
        .execute();
      for (const edge of sourceToEdges) {
        const key = `${String(edge.from_person_id)}|${edge.relation_type}`;
        if (String(edge.from_person_id) === String(input.target_id) || targetToKeys.has(key)) {
          await trx
            .deleteFrom('person_connections')
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', edge.id)
            .execute();
        } else {
          targetToKeys.add(key);
          await trx
            .updateTable('person_connections')
            .set({ to_person_id: input.target_id, updatedby_id: input.user_id, updated_at: sql`now()` })
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', edge.id)
            .execute();
        }
      }

      // 10. Delete source person. Remaining references clean themselves up: the source's
      // potential_duplicates rows are ON DELETE CASCADE (stale groups are recomputed by the
      // duplicate-maintenance service), and dismissed_duplicate_groups carries no person FK.
      await this.delete({ tenant_id: input.tenant_id, id: input.source_id }, trx);

      // 11. Clean up empty household if source's household is now empty
      const sourceHhId = source.household_id;
      if (sourceHhId && sourceHhId !== target.household_id) {
        const remainingHhMembers = await trx
          .selectFrom('persons')
          .select('id')
          .where('tenant_id', '=', input.tenant_id)
          .where('household_id', '=', sourceHhId)
          .execute();
        if (remainingHhMembers.length === 0) {
          // Clean up orphaned household associations before deletion
          await trx
            .deleteFrom('map_households_tags')
            .where('tenant_id', '=', input.tenant_id)
            .where('household_id', '=', sourceHhId)
            .execute();
          await trx
            .deleteFrom('map_lists_households')
            .where('tenant_id', '=', input.tenant_id)
            .where('household_id', '=', sourceHhId)
            .execute();
          await trx
            .deleteFrom('households')
            .where('tenant_id', '=', input.tenant_id)
            .where('id', '=', sourceHhId)
            .execute();
        }
      }

      return { success: true };
    });
  }
}
