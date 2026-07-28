import type { ReferenceExpression, Selectable, Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { Models, OperationDataType, TypeTenantId } from '../../../../../../../libs/common/src/lib/kysely.models';
import { MAX_PAGE_SIZE } from '../../../../../../../libs/common/src';
import { isBlankAddress, isIncompleteAddress } from '../../../lib/address-normalize';
import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { matchCoordinatesToDistrict } from '../../../lib/gis/geocoding';
import { enqueueGeocodeJobs } from '../../../lib/gis/geocode-queue';
import { logger } from '../../../logger';

export class HouseholdRepo extends BaseRepository<'households'> {
  constructor() {
    super('households');
  }

  public override async addMany(
    input: { rows: OperationDataType<'households', 'insert'>[] },
    trx?: Transaction<Models>,
  ) {
    const processedRows = await Promise.all(
      input.rows.map(async (row) => {
        const isBlank = isBlankAddress(row);
        const isIncomplete = isIncompleteAddress(row);

        let geocoding_status = isBlank || isIncomplete ? 'failed' : 'pending';
        let district = row.district ?? null;
        let precinct = row.precinct ?? null;
        let ward = row.ward ?? null;

        if (row.lat && row.lng && Number(row.lat) !== 0 && Number(row.lng) !== 0) {
          try {
            const matched = await matchCoordinatesToDistrict(Number(row.lat), Number(row.lng));
            district = matched.district;
            precinct = matched.precinct;
            ward = matched.ward;
            geocoding_status = 'success';
          } catch (err) {
            logger.error({ err }, 'Failed to map coordinates to district during insert');
          }
        }

        return {
          ...row,
          district,
          precinct,
          ward,
          geocoding_status,
        };
      }),
    );

    const createdRows = await super.addMany({ rows: processedRows }, trx);
    const db = trx || this.db;

    // Enqueue geocoding for the newly-pending households, grouped by tenant so the plan gate and
    // per-tenant daily budget apply per workspace (see lib/gis/geocode-queue.ts).
    const pendingByTenant = new Map<string, string[]>();
    for (const row of createdRows) {
      if (row && row.id && row.geocoding_status === 'pending') {
        const list = pendingByTenant.get(row.tenant_id) ?? [];
        list.push(String(row.id));
        pendingByTenant.set(row.tenant_id, list);
      }
    }
    for (const [tenantId, ids] of pendingByTenant) {
      await enqueueGeocodeJobs(db, tenantId, ids);
    }

    return createdRows;
  }

  public async getIdsByFileId(
    input: { tenant_id: string; file_id: string; onlyEmpty?: boolean },
    trx?: Transaction<Models>,
  ): Promise<string[]> {
    if (!input.file_id) return [];
    let query = this.getSelect(trx)
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.file_id);

    if (input.onlyEmpty) {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('persons').select('id').whereRef('persons.household_id', '=', 'households.id').limit(1),
          ),
        ),
      );
    }

    const rows = await query.execute();
    return rows.map((row) => (row.id != null ? String(row.id) : '')).filter((id) => id.length > 0);
  }

  public async clearFileIdForImport(
    input: { tenant_id: string; import_id: string; user_id: string },
    trx?: Transaction<Models>,
  ) {
    await this.getUpdate(trx)
      .set({
        file_id: null,
        updated_at: sql<Date>`now()`,
      } as unknown as OperationDataType<'households', 'update'>)
      .where('tenant_id', '=', input.tenant_id)
      .where('file_id', '=', input.import_id)
      .executeTakeFirst();
  }

  public async getBlankHousehold(input: { tenant_id: string }, trx?: Transaction<Models>) {
    return this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('home_phone', 'is', null)
      .where('apt', 'is', null)
      .where('street_num', 'is', null)
      .where('street1', 'is', null)
      .where('street2', 'is', null)
      .where('city', 'is', null)
      .where('state', 'is', null)
      .where('zip', 'is', null)
      .where('country', 'is', null)
      .where('file_id', 'is', null)
      .where('notes', 'is', null)
      .selectAll()
      .limit(1)
      .executeTakeFirst();
  }

  public async findByFingerprint(
    input: { tenant_id: string; fp_street: string | null; fp_full?: string | null },
    trx?: Transaction<Models>,
  ) {
    const sel = this.getSelect(trx).where('tenant_id', '=', input.tenant_id);

    if (input.fp_full) {
      const full = await sel.where('address_fp_full', '=', input.fp_full).selectAll().limit(1).executeTakeFirst();
      if (full) return full;
    }
    if (input.fp_street) {
      return await this.getSelect(trx)
        .where('tenant_id', '=', input.tenant_id)
        .where('address_fp_street', '=', input.fp_street)
        .selectAll()
        .limit(1)
        .executeTakeFirst();
    }
    return undefined;
  }

  public async getAllWithPeopleCount(
    input: {
      tenant_id: string;
      options?: QueryParams<'households' | 'tags' | 'map_households_tags' | 'persons'> & { issues?: string[] };
      tags?: string[];
      issues?: string[];
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams & { issues?: string[]; listId?: string } = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const tags = input.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const issues = (input.issues || options.issues)?.map((i) => i.trim().toLowerCase()).filter(Boolean);
    const filterModel = ((options as JoinedQueryParams & { issues?: string[] })?.filterModel ?? {}) as Record<
      string,
      { value: unknown } | undefined
    >;

    // Shared where clause builder (for both queries)
    const applyFilters = <QB extends AnyQB>(qb: QB) => {
      let q = qb
        .leftJoin('map_households_tags', 'map_households_tags.household_id', 'households.id')
        .leftJoin('tags', 'tags.id', 'map_households_tags.tag_id')
        .leftJoin('tenants', 'tenants.id', 'households.tenant_id')
        .$if(!!tags?.length, (q) => q.where('tags.name', 'in', tags ?? []).where('tags.type', '=', 'tag'))
        .$if(!!issues?.length, (q) => q.where('tags.name', 'in', issues ?? []).where('tags.type', '=', 'issue'))
        .$if(!!options.listId, (qb) =>
          qb.where('households.id', 'in', (eb: any) =>
            eb
              .selectFrom('map_lists_households')
              .select('household_id')
              .where('list_id', '=', options.listId ?? '')
              .where('tenant_id', '=', tenantId),
          ),
        )
        .where('households.tenant_id', '=', tenantId)
        .where((eb) =>
          eb.or([
            eb('tenants.placeholder_household_id', 'is', null),
            eb('tenants.placeholder_household_id', '!=', eb.ref('households.id')),
          ]),
        )
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          // ILIKE on the bare column (not LOWER(col) LIKE) so the trigram GIN
          // indexes can serve quick search; normalizeSearch already lowercases,
          // so the match semantics are identical.
          return qb.where(
            sql<boolean>`(
              households.city ILIKE ${text} OR
              households.street1 ILIKE ${text} OR
              households.street2 ILIKE ${text} OR
              households.notes ILIKE ${text} OR
              tags.name ILIKE ${text}
            )`,
          );
        });

      // Apply dynamic, operator-aware column filters
      q = this.applyColumnFilter(q, 'households.city', filterModel['city'] ?? {});
      q = this.applyColumnFilter(q, 'households.state', filterModel['state'] ?? {});
      q = this.applyColumnFilter(q, 'households.street1', filterModel['street1'] ?? {});
      q = this.applyColumnFilter(q, 'households.street2', filterModel['street2'] ?? {});
      q = this.applyCastColumnFilter(q, sql`households.street_num::text`, filterModel['street_num'] ?? {});
      q = this.applyColumnFilter(q, 'households.zip', filterModel['zip'] ?? {});
      q = this.applyColumnFilter(q, 'households.home_phone', filterModel['home_phone'] ?? {});
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

      // Apply advanced query builder filters if present
      const columnMapping = {
        city: { col: 'households.city' },
        state: { col: 'households.state' },
        street1: { col: 'households.street1' },
        street2: { col: 'households.street2' },
        street_num: { col: 'households.street_num::text', isCast: true },
        zip: { col: 'households.zip' },
        country: { col: 'households.country' },
        home_phone: { col: 'households.home_phone' },
        tag: { col: 'tags.name' },
        tags: { col: 'tags.name' },
        issues: { col: 'tags.name' },
      };
      const advModel =
        options.advancedFilterModel || (options.filterModel?.['tags_expression'] as typeof options.advancedFilterModel);
      q = this.applyAdvancedFilters(q, advModel, columnMapping);

      return q;
    };

    // Count query
    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT households.id`).as('total')])
      .execute();

    const count = Number(countResult[0]?.['total'] || 0);

    // Data query
    const rows = await applyFilters(this.getSelect(trx))
      .select([
        'households.id',
        'households.country',
        'households.zip',
        'households.state',
        'households.home_phone',
        'households.city',
        'households.apt',
        'households.street1',
        'households.street2',
        'households.street_num',
        'households.notes',
        'households.district',
        'households.precinct',
        'households.ward',
        'households.geocoding_status',
        'households.updated_at',
      ])
      .select((eb) => [
        eb
          .selectFrom('persons')
          .whereRef('persons.household_id', '=', 'households.id')
          .select(({ fn }) => [fn.count<number>('persons.id').as('persons_count')])
          .as('persons_count'),
        // Members for the grid's Members column — {id, name} so each name can link to
        // its person card. Ordered, empties dropped, one truncated one-liner on the client.
        eb
          .selectFrom('persons')
          .whereRef('persons.household_id', '=', 'households.id')
          .select(
            sql<{ id: string; name: string }[]>`coalesce(
              jsonb_agg(
                jsonb_build_object('id', persons.id, 'name', trim(concat_ws(' ', persons.first_name, persons.last_name)))
                order by persons.first_name, persons.last_name
              ) filter (where nullif(trim(concat_ws(' ', persons.first_name, persons.last_name)), '') is not null),
              '[]'::jsonb
            )`.as('members'),
          )
          .as('members'),
        // is_placeholder: true only for the one household stored on the tenant row
        eb
          .case()
          .when('tenants.placeholder_household_id', '=', eb.ref('households.id'))
          .then(true)
          .else(false)
          .end()
          .as('is_placeholder'),
      ])
      .select(() => [
        sql<string[]>`coalesce(array_remove(array_agg(CASE WHEN tags.type = 'tag' THEN tags.name END), null), '{}')`.as(
          'tags',
        ),
        sql<
          string[]
        >`coalesce(array_remove(array_agg(CASE WHEN tags.type = 'issue' THEN tags.name END), null), '{}')`.as('issues'),
      ])
      .groupBy([
        'households.id',
        'households.country',
        'households.zip',
        'households.state',
        'households.home_phone',
        'households.city',
        'households.apt',
        'households.street1',
        'households.street2',
        'households.street_num',
        'households.notes',
        'households.district',
        'households.precinct',
        'households.ward',
        'households.geocoding_status',
        'households.created_at',
        'households.updated_at',
        'households.campaign_id',
        'households.createdby_id',
        'households.updatedby_id',
        'households.file_id',
        'households.address_fp_street',
        'households.address_fp_full',
        'households.tenant_id',
        'tenants.placeholder_household_id',
      ])
      .$if(!!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce((acc, sort) => {
          let col = sort.colId;
          if (typeof col === 'string' && !col.includes('.')) {
            const hhCols = [
              'id',
              'campaign_id',
              'createdby_id',
              'file_id',
              'home_phone',
              'notes',
              'address_fp_street',
              'address_fp_full',
              'is_placeholder',
              'district',
              'precinct',
              'ward',
              'geocoding_status',
              'tenant_id',
              'updatedby_id',
              'created_at',
              'updated_at',
              'country',
              'zip',
              'state',
              'city',
              'street1',
              'street2',
              'street_num',
              'apt',
            ];
            if (hhCols.includes(col)) {
              col = `households.${col}`;
            }
          }
          return acc.orderBy(col as ReferenceExpression<Models, 'households'>, sort.sort);
        }, qb),
      )
      // Always bounded. This row carries two correlated subqueries and a jsonb_agg of members,
      // so an unpaged request (the old behaviour when startRow/endRow were absent) built that
      // for every household in the tenant.
      .offset(options.startRow ?? 0)
      .limit(
        typeof options.startRow === 'number' && typeof options.endRow === 'number'
          ? Math.min(Math.max(0, options.endRow - options.startRow), MAX_PAGE_SIZE)
          : MAX_PAGE_SIZE,
      )
      .execute();

    return {
      rows,
      count,
    };
  }

  public async getPlaceholderIds(tenant_id: string, candidates: string[]): Promise<Set<string>> {
    if (!candidates.length) return new Set();
    const result = await this.getSelect()
      .leftJoin('tenants', 'tenants.id', 'households.tenant_id')
      .where('households.tenant_id', '=', tenant_id)
      .where('households.id', 'in', candidates)
      .whereRef('tenants.placeholder_household_id', '=', 'households.id')
      .select('households.id')
      .execute();
    return new Set(result.map((r) => String(r.id)));
  }

  /**
   * Deletes households and reassigns their members to the tenant's placeholder
   * household. persons.household_id is NOT NULL, so members are *moved* rather
   * than cascade-deleted along with the household. Runs in a single transaction
   * so persons are never orphaned. Callers must exclude the placeholder household
   * itself from `ids` (see getPlaceholderIds).
   */
  public async deleteManyReassigningPersons(input: {
    tenant_id: string;
    ids: string[];
    user_id: string;
  }): Promise<boolean> {
    if (!input.ids.length) return false;

    return this.transaction().execute(async (trx) => {
      const tenant = await trx
        .selectFrom('tenants')
        .select('placeholder_household_id')
        .where('id', '=', input.tenant_id)
        .executeTakeFirst();

      const placeholderId = tenant?.placeholder_household_id;

      if (placeholderId != null) {
        await trx
          .updateTable('persons')
          .set({ household_id: placeholderId, updated_at: sql<Date>`now()`, updatedby_id: input.user_id })
          .where('tenant_id', '=', input.tenant_id)
          .where('household_id', 'in', input.ids)
          .execute();
      }

      return this.deleteMany({ tenant_id: input.tenant_id, ids: input.ids }, trx);
    });
  }

  public async getPeopleCount(input: { tenant_id: string; id: string }) {
    const result = await this.getSelect()
      .leftJoin('persons', 'persons.household_id', 'households.id')
      .where('households.id', '=', input.id)
      .where('households.tenant_id', '=', input.tenant_id)
      .select(({ fn }) => [fn.count<number>('persons.id').as('count')])
      .executeTakeFirst();

    return Number((result as { count?: number } | undefined)?.count ?? 0);
  }

  /** Same shape as web-forms slugExists — used by the shared uniqueSlug helper (lib/slug.ts). */
  public async slugExists(tenant_id: string, slug: string, excludeId?: string): Promise<boolean> {
    let query = this.getSelect().select('id').where('tenant_id', '=', tenant_id).where('slug', '=', slug);
    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }
    const row = await query.limit(1).executeTakeFirst();
    return !!row;
  }

  /** Tenant-scoped slug resolution for /households/:slug URLs (spec §1). */
  public getOneBySlug(input: { tenant_id: string; slug: string }) {
    return this.getSelect()
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
  }

  /** Distinct geocoded wards — powers the Households grain sentence ("{n} households across {m} wards"). */
  /**
   * Real households the tenant has, excluding the permanent placeholder household
   * (the one on `tenants.placeholder_household_id`, which just holds people with
   * no address and is hidden from the grid). Mirrors the exclusion `getAll` uses,
   * so the grain-tab count and count sentence match the visible rows.
   */
  public async countExcludingPlaceholder(tenant_id: string): Promise<number> {
    const result = await this.getSelect()
      .leftJoin('tenants', 'tenants.id', 'households.tenant_id')
      .where('households.tenant_id', '=', tenant_id)
      .where((eb) =>
        eb.or([
          eb('tenants.placeholder_household_id', 'is', null),
          eb('tenants.placeholder_household_id', '!=', eb.ref('households.id')),
        ]),
      )
      .select(({ fn }) => [fn.count<number>('households.id').as('count')])
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  /**
   * People who live in the tenant's placeholder household — i.e. have no matchable address.
   * Returns the count plus the placeholder household id so the grid footer can link to them.
   */
  public async getUnhoused(tenant_id: string): Promise<{ count: number; household_id: string | null }> {
    const result = await this.db
      .selectFrom('tenants')
      .leftJoin('persons', (join) =>
        join
          .onRef('persons.household_id', '=', 'tenants.placeholder_household_id')
          .on('persons.tenant_id', '=', tenant_id),
      )
      .where('tenants.id', '=', tenant_id)
      .select((eb) => [
        'tenants.placeholder_household_id as household_id',
        eb.fn.count<number>('persons.id').as('count'),
      ])
      .groupBy('tenants.placeholder_household_id')
      .executeTakeFirst();
    return {
      count: Number(result?.count ?? 0),
      household_id: result?.household_id != null ? String(result.household_id) : null,
    };
  }

  public async countDistinctWards(tenant_id: string): Promise<number> {
    const result = await this.getSelect()
      .select(({ fn }) => [fn.count<number>(sql`DISTINCT ward`).as('count')])
      .where('tenant_id', '=', tenant_id)
      .where('ward', 'is not', null)
      .where('ward', '!=', '')
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  public getTags(id: string, tenant_id: string, type?: 'tag' | 'issue') {
    let q = this.getSelect()
      .innerJoin('map_households_tags', 'map_households_tags.household_id', 'households.id')
      .innerJoin('tags', 'tags.id', 'map_households_tags.tag_id')
      .where('households.id', '=', id)
      .where('households.tenant_id', '=', tenant_id);
    if (type) {
      q = q.where('tags.type', '=', type);
    }
    return q.select('tags.name').execute();
  }

  public async getDuplicateCount(tenant_id: string): Promise<number> {
    // NOTE: unscoped by design — outer selectFrom wraps a pre-scoped subquery; lint cannot infer table name from the callback form
    // eslint-disable-next-line local/no-unscoped-db-query
    const countResult = await this.db
      .selectFrom((qb) =>
        qb
          .selectFrom('potential_duplicates')
          .innerJoin('households', 'potential_duplicates.household_id', 'households.id')
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

    // NOTE: unscoped by design — outer selectFrom wraps a pre-scoped subquery; lint cannot infer table name from the callback form
    // eslint-disable-next-line local/no-unscoped-db-query
    const countResult = await this.db
      .selectFrom((qb) =>
        qb
          .selectFrom('potential_duplicates')
          .innerJoin('households', 'potential_duplicates.household_id', 'households.id')
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
      .innerJoin('households', 'potential_duplicates.household_id', 'households.id')
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
      .innerJoin('households', 'potential_duplicates.household_id', 'households.id')
      .select([
        'potential_duplicates.group_key',
        'potential_duplicates.reason',
        'households.id',
        'households.street_num',
        'households.street1',
        'households.street2',
        'households.city',
        'households.state',
        'households.zip',
        'households.country',
        'households.apt',
        'households.home_phone',
        'households.notes',
        'households.created_at',
      ])
      .where('potential_duplicates.tenant_id', '=', tenant_id)
      .where('potential_duplicates.group_key', 'in', groupKeys)
      .execute();

    const hhIds = rows.map((r) => String(r.id));
    if (hhIds.length === 0) {
      return { groups: [], total };
    }

    const persons = await this.db
      .selectFrom('persons')
      .select(['id', 'first_name', 'last_name', 'email', 'household_id'])
      .where('tenant_id', '=', tenant_id)
      .where('household_id', 'in', hhIds)
      .execute();

    const hhToPersons = new Map<
      string,
      Array<{
        id: unknown;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        household_id: unknown;
      }>
    >();
    for (const p of persons) {
      const hhId = String(p.household_id);
      if (!hhToPersons.has(hhId)) {
        hhToPersons.set(hhId, []);
      }
      hhToPersons.get(hhId)?.push(p);
    }

    const groupsMap = new Map<string, { reason: string; households: Record<string, unknown>[] }>();
    for (const row of rows) {
      const groupKey = row.group_key;
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          reason: row.reason,
          households: [],
        });
      }
      groupsMap.get(groupKey)?.households.push({
        ...row,
        id: String(row.id),
        persons: hhToPersons.get(String(row.id)) || [],
      });
    }

    const sortedGroups = groupKeys
      .map((key) => {
        const group = groupsMap.get(key);
        return group ? { ...group, group_key: key } : undefined;
      })
      .filter((g): g is NonNullable<typeof g> => !!(g && g.households.length > 1));

    return { groups: sortedGroups, total };
  }

  public async mergeHouseholds(input: { tenant_id: string; target_id: string; source_id: string; user_id: string }) {
    return this.transaction().execute(async (trx) => {
      const target = (await this.getOneBy(
        'id',
        { tenant_id: input.tenant_id as TypeTenantId<'households'>, value: input.target_id },
        trx,
      )) as Selectable<Models['households']>;
      const source = (await this.getOneBy(
        'id',
        { tenant_id: input.tenant_id as TypeTenantId<'households'>, value: input.source_id },
        trx,
      )) as Selectable<Models['households']>;

      if (!target || !source) {
        throw new Error('Target or Source household not found');
      }

      // 1. Merge fields (copy null/empty fields from source to target)
      const targetUpdate: Record<string, unknown> = {};
      const fields = [
        'apt',
        'street_num',
        'street1',
        'street2',
        'city',
        'state',
        'zip',
        'country',
        'home_phone',
        'notes',
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

      if (Object.keys(targetUpdate).length > 0) {
        targetUpdate['updatedby_id'] = input.user_id;
        targetUpdate['updated_at'] = sql`now()`;
        await this.update({ tenant_id: input.tenant_id, id: input.target_id, row: targetUpdate }, trx);
      }

      // 2. Transfer tags (map_households_tags)
      const targetTags = await trx
        .selectFrom('map_households_tags')
        .select('tag_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.target_id)
        .execute();
      const targetTagIds = new Set(targetTags.map((t) => String(t.tag_id)));

      const sourceTags = await trx
        .selectFrom('map_households_tags')
        .select(['tag_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      for (const st of sourceTags) {
        const tagIdStr = String(st.tag_id);
        if (!targetTagIds.has(tagIdStr)) {
          await trx
            .insertInto('map_households_tags')
            .values({
              tenant_id: input.tenant_id,
              household_id: input.target_id,
              tag_id: st.tag_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_households_tags')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 3. Transfer lists (map_lists_households)
      const targetLists = await trx
        .selectFrom('map_lists_households')
        .select('list_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.target_id)
        .execute();
      const targetListIds = new Set(targetLists.map((l) => String(l.list_id)));

      const sourceLists = await trx
        .selectFrom('map_lists_households')
        .select(['list_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      for (const sl of sourceLists) {
        if (!targetListIds.has(String(sl.list_id))) {
          await trx
            .insertInto('map_lists_households')
            .values({
              tenant_id: input.tenant_id,
              household_id: input.target_id,
              list_id: sl.list_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_lists_households')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 4. Reassign people (persons.household_id)
      await trx
        .updateTable('persons')
        .set({ household_id: input.target_id, updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 5. Delete source household
      await this.delete({ tenant_id: input.tenant_id, id: input.source_id }, trx);

      return { success: true };
    });
  }
}
