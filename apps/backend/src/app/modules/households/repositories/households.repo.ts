import type { ExpressionBuilder, JoinBuilder, ReferenceExpression, Selectable, Transaction } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { Models, OperationDataType, TypeTenantId } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { FullScanBatch } from '../../../lib/paging';
import { FULL_SCAN_BATCH_SIZE, resolvePageWindow } from '../../../lib/paging';
import { isBlankAddress, isIncompleteAddress } from '../../../lib/address-normalize';
import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { matchPointToSets, requiredSetIdsForTenant } from '../../../lib/gis/boundary-match';
import { enqueueGeocodeJobs } from '../../../lib/gis/geocode-queue';
import {
  areaSetLateralSelects,
  areaSetOuterSelects,
  areaSetRefs,
  electoralAreaSelects,
  getHouseholdAreas,
  listAreaSetColumns,
  referencesElectoralAreas,
  resolveSeatContext,
  resolveSeatSetId,
  seatStatusSelect,
  upsertHouseholdAreas,
  type HouseholdAreaListing,
  type HouseholdAreaRow,
} from '../electoral-areas';
import { logger } from '../../../logger';

/** households columns the grid may sort on — prefixed `households.` in ORDER BY. */
const SORTABLE_HOUSEHOLD_COLUMNS: readonly string[] = [
  'id',
  'campaign_id',
  'createdby_id',
  'file_id',
  'home_phone',
  'notes',
  'address_fp_street',
  'address_fp_full',
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

/**
 * Output aliases the data query selects, which Postgres resolves bare in ORDER BY. The two
 * electoral columns belong to the lateral `hd_areas` relation, not to `households`, so prefixing
 * them would fail; `is_placeholder`, `persons_count`, `members`, `tags` and `issues` are computed
 * selections with no backing column at all.
 */
const SORTABLE_HOUSEHOLD_ALIASES: readonly string[] = [
  'electoral_area',
  'any_electoral_area',
  'is_placeholder',
  'persons_count',
  'members',
  'tags',
  'issues',
];

/**
 * Resolve a grid sortModel colId to an ORDER BY target, or null for anything unknown. A saved sort
 * from a dropped column (the old `ward`/`district`/`precinct` text columns), a mistyped id or a
 * dotted reference must be SKIPPED, not passed through: an unknown identifier makes Postgres
 * reject the whole query and the grid never loads.
 *
 * `areaSetFields` is the set of per-boundary-map aliases this particular query selected — checked
 * by membership for the same reason, since a map can be deleted after a sort on it was saved.
 */
function resolveHouseholdSortColumn(colId: unknown, areaSetFields: ReadonlySet<string>): string | null {
  if (typeof colId !== 'string') return null;
  if (SORTABLE_HOUSEHOLD_COLUMNS.includes(colId)) return `households.${colId}`;
  if (SORTABLE_HOUSEHOLD_ALIASES.includes(colId)) return colId;
  if (areaSetFields.has(colId)) return colId;
  return null;
}

export class HouseholdRepo extends BaseRepository<'households'> {
  constructor() {
    super('households');
  }

  public override async addMany(
    input: { rows: OperationDataType<'households', 'insert'>[] },
    trx?: Transaction<Models>,
  ) {
    const processedRows = input.rows.map((row) => {
      const isBlank = isBlankAddress(row);
      const isIncomplete = isIncompleteAddress(row);
      const hasCoordinates = row.lat && row.lng && Number(row.lat) !== 0 && Number(row.lng) !== 0;
      // Coordinates already on the row (address autocomplete, demo seed, a file that carried them)
      // mean there is nothing to look up and nothing to bill.
      const geocoding_status = hasCoordinates ? 'success' : isBlank || isIncomplete ? 'failed' : 'pending';
      return { ...row, geocoding_status };
    });

    const createdRows = await super.addMany({ rows: processedRows }, trx);
    const db = trx || this.db;

    // Boundary matching for every row that arrived with coordinates. This is deciding which
    // polygons contain a point: pure processor work, no external call, nothing billed. So it runs
    // inline the moment coordinates exist, unlike geocoding below, which is billed per address and
    // therefore only ever queued.
    //
    // The rows are written here rather than through `applyHouseholdMatches` because that function
    // opens its own transaction, and Kysely implements a nested transaction as a second BEGIN and
    // COMMIT on the same connection rather than as a savepoint — inside the CSV import's
    // transaction it would commit the import early. See `upsertHouseholdAreas`.
    const locatedByTenant = new Map<string, { id: string; lat: number; lng: number }[]>();
    const pendingByTenant = new Map<string, string[]>();
    for (const row of createdRows) {
      if (!row || !row.id) continue;
      if (row.geocoding_status === 'pending') {
        const list = pendingByTenant.get(row.tenant_id) ?? [];
        list.push(String(row.id));
        pendingByTenant.set(row.tenant_id, list);
      }
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
        const list = locatedByTenant.get(row.tenant_id) ?? [];
        list.push({ id: String(row.id), lat, lng });
        locatedByTenant.set(row.tenant_id, list);
      }
    }

    for (const [tenantId, located] of locatedByTenant) {
      try {
        const setIds = await requiredSetIdsForTenant(db, tenantId);
        if (setIds.length === 0) continue;
        const areaRows: HouseholdAreaRow[] = [];
        for (const item of located) {
          const matches = await matchPointToSets(db, tenantId, item.lat, item.lng, setIds);
          for (const match of matches) {
            areaRows.push({ household_id: item.id, set_id: match.set_id, name: match.name, code: match.code });
          }
        }
        await upsertHouseholdAreas(db, tenantId, areaRows);
      } catch (err) {
        logger.error({ err, tenantId }, 'Failed to match new households to boundary sets during insert');
      }
    }

    // Enqueue geocoding for the newly-pending households, grouped by tenant so the plan gate and
    // per-tenant daily budget apply per workspace (see lib/gis/geocode-queue.ts).
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

  /**
   * The households grid's read, and the query a household smart list's rules resolve through.
   *
   * Two shapes, and which one you get depends on `input.fullScan`:
   *
   * - Without it (every client request, because the tRPC router only ever fills `options`), the
   *   result is one page, capped at `MAX_PAGE_SIZE`, and `count` is the total number of matching
   *   households.
   * - With it (backend callers only — see `FullScanBatch`), the result is one batch of at most
   *   `FULL_SCAN_BATCH_SIZE` rows ordered by `households.id`, starting after `fullScan.afterId`,
   *   and `count` is the size of that batch rather than the total. The caller loops until a short
   *   batch comes back. This is how list membership reads every matching household instead of the
   *   first 5000.
   */
  public async getAllWithPeopleCount(
    input: {
      tenant_id: string;
      options?: QueryParams<'households' | 'tags' | 'map_households_tags' | 'persons'> & { issues?: string[] };
      tags?: string[];
      issues?: string[];
      /** Backend-only. Absent on every client-originated call; see `FullScanBatch`. */
      fullScan?: FullScanBatch;
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams & { issues?: string[]; listId?: string; campaignId?: string } =
      input.options || {};
    const tenantId = input.tenant_id;
    // Which boundary set the single-valued `electoral_area` column reads. Resolved once per request
    // rather than per row; null when the workspace has no map yet, and the column is then NULL.
    // The seat set, the seat the campaign contests, and when the map was added — the last of which
    // is what stops a household checked before the map existed from reading as "outside" it.
    const seat = await resolveSeatContext(trx ?? this.db, tenantId, options.campaignId ?? null);
    const seatSetId = seat.setId;
    // One column per boundary map, so a ward map the campaign does not contest still gets a column
    // of its own. A full scan reads membership only, so it skips both the read and the aggregates.
    const areaSetColumns =
      input.fullScan != null ? [] : await listAreaSetColumns(trx ?? this.db, tenantId, options.campaignId ?? null);
    const areaSetFields = new Set(areaSetColumns.map((column) => column.field));
    const searchStr = this.normalizeSearch(options.searchStr);
    const tags = input.tags?.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const issues = (input.issues || options.issues)?.map((i) => i.trim().toLowerCase()).filter(Boolean);
    const filterModel = ((options as JoinedQueryParams & { issues?: string[] })?.filterModel ?? {}) as Record<
      string,
      { op?: string; value?: unknown } | undefined
    >;
    const advModel =
      options.advancedFilterModel || (options.filterModel?.['tags_expression'] as typeof options.advancedFilterModel);
    // A backend full scan reads fixed-size batches walked by primary key; everything else — which
    // is every request that arrived over tRPC — is clamped to one page as before.
    const isFullScan = input.fullScan != null;
    const page = isFullScan ? { offset: 0, limit: FULL_SCAN_BATCH_SIZE } : resolvePageWindow(options);
    // The keyset cursor, flattened to a plain string so the guarded `.where` below needs neither a
    // cast nor a non-null assertion. An id is never the empty string, so '' means "no cursor".
    const scanCursorId = input.fullScan?.afterId ?? '';

    // Shared where clause builder (for both queries). `includeLateral` controls the electoral
    // lateral join: the data query always carries it (the columns are selected), the count query
    // only when a filter actually reads them — see the count below.
    const applyFilters = <QB extends AnyQB>(qb: QB, includeLateral: boolean) => {
      let q = qb
        .leftJoin('map_households_tags', 'map_households_tags.household_id', 'households.id')
        .leftJoin('tags', 'tags.id', 'map_households_tags.tag_id')
        .leftJoin('tenants', 'tenants.id', 'households.tenant_id')
        // Electoral geography. A household is in several boundaries at once, so this is a lateral
        // aggregate rather than a plain join: a plain join would multiply the household row by its
        // number of boundaries, and the tag/issue `array_agg` below would then repeat every tag
        // once per boundary. The subquery aggregates with no GROUP BY, so it yields exactly one
        // row per household even when the household matches no boundary at all.
        .$if(includeLateral, (qb2) =>
          qb2.leftJoinLateral(
            (eb: ExpressionBuilder<Models, 'households'>) =>
              eb
                .selectFrom('household_districts as hd')
                .whereRef('hd.household_id', '=', 'households.id')
                .whereRef('hd.tenant_id', '=', 'households.tenant_id')
                .select([...electoralAreaSelects(seatSetId), ...areaSetLateralSelects(areaSetColumns)])
                .as('hd_areas'),
            (join: JoinBuilder<Models, 'households'>) => join.onTrue(),
          ),
        )
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
      if (includeLateral) {
        // The grid's "+ Add filter" on the two electoral columns lands here. Outer-query
        // references to a lateral alias are valid Postgres, so the operator-aware helper works
        // against `hd_areas` directly. Guarded because without the lateral the aliases don't exist.
        q = this.applyColumnFilter(q, 'hd_areas.electoral_area', filterModel['electoral_area'] ?? {});
        q = this.applyColumnFilter(q, 'hd_areas.any_electoral_area', filterModel['any_electoral_area'] ?? {});
        // The same, once per boundary map, so a filter can name one map exactly.
        for (const column of areaSetColumns) {
          q = this.applyColumnFilter(q, `hd_areas.${column.field}`, filterModel[column.field] ?? {});
        }
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
        // Electoral geography (§8 rule builder). Two fields, because they answer two different
        // questions and one cannot do both:
        //  - `electoral_area` is the household's area in the campaign's own seat set, a single
        //    value, so "Riding is Ottawa Centre" compares exactly.
        //  - `any_electoral_area` is every area the household is in, joined together, so
        //    "everyone in precinct 12" works even when precincts are not the seat set. It is a
        //    concatenation, so it answers `contains` honestly and `equals` only when the household
        //    is in exactly one area — the frontend field list must offer contains / does not
        //    contain / is set / is not set for it, not equals.
        //
        // Mapped only while the lateral join is present: without it a rule on these fields is
        // dropped by buildGroupExpression instead of producing a query naming a missing alias.
        ...(includeLateral
          ? {
              electoral_area: { col: 'hd_areas.electoral_area' },
              any_electoral_area: { col: 'hd_areas.any_electoral_area' },
              // And one field per boundary map, so a rule can name a single map exactly.
              ...Object.fromEntries(
                areaSetColumns.map((column) => [column.field, { col: `hd_areas.${column.field}` }]),
              ),
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
    const countMatchingHouseholds = async (): Promise<number> => {
      const countResult = await applyFilters(this.getSelect(trx), countNeedsElectoral)
        .select(({ fn }) => [fn.count(sql`DISTINCT households.id`).as('total')])
        .execute();
      return Number(countResult[0]?.['total'] || 0);
    };

    // A full scan calls this method once per batch and reads only `rows`. Running the DISTINCT
    // count on every batch would re-execute the whole predicate for a number the caller does not
    // use, so it is skipped and the batch's own size is reported instead (see the doc comment).
    const totalCount = isFullScan ? null : await countMatchingHouseholds();

    // Data query
    const rows = await applyFilters(this.getSelect(trx), true)
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
        // Replaces the three fixed text columns (district, precinct, ward). Both are selected, not
        // just filtered on, because the list builder's live preview evaluates the same rules
        // client-side against the returned rows — a field filtered server-side but not selected
        // previews wrong. See the pplcrm-lists skill.
        'hd_areas.electoral_area',
        'hd_areas.any_electoral_area',
        'households.geocoding_status',
        'households.updated_at',
      ])
      // One more column per boundary map, so a workspace holding both a riding map and a ward map
      // gets a column for each instead of the two names joined into one string.
      .select(areaSetOuterSelects(areaSetColumns))
      .select(seatStatusSelect(seatSetId, seat.seatAreaNames, seat.setStampedAt))
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
        'hd_areas.electoral_area',
        'hd_areas.any_electoral_area',
        ...areaSetRefs(areaSetColumns),
        'households.geocoding_status',
        'households.created_at',
        'households.updated_at',
        'households.campaign_id',
        'households.createdby_id',
        'households.boundary_checked_at',
        'households.updatedby_id',
        'households.file_id',
        'households.address_fp_street',
        'households.address_fp_full',
        'households.tenant_id',
        'tenants.placeholder_household_id',
      ])
      // The caller's sort is skipped during a full scan: the scan's own primary-key order is what
      // makes the keyset cursor below correct, and a second ORDER BY term ahead of it would let
      // batches repeat and skip rows. Nothing reads the row order of a membership scan.
      .$if(!isFullScan && !!options.sortModel?.length, (qb) =>
        (options.sortModel ?? []).reduce((acc, sort) => {
          const col = resolveHouseholdSortColumn(sort.colId, areaSetFields);
          if (col == null) return acc;
          return acc.orderBy(col as ReferenceExpression<Models, 'households'>, sort.sort);
        }, qb),
      )
      .$if(isFullScan, (qb) => qb.orderBy('households.id'))
      .$if(scanCursorId !== '', (qb) => qb.where('households.id', '>', scanCursorId))
      // Always bounded. This row carries two correlated subqueries and a jsonb_agg of members,
      // so an unpaged request (the old behaviour when startRow/endRow were absent) built that
      // for every household in the tenant. A full scan is still bounded; it just repeats the
      // batch, so that per-row work never happens for more than FULL_SCAN_BATCH_SIZE rows at once.
      .offset(page.offset)
      .limit(page.limit)
      .execute();

    return {
      rows,
      count: totalCount ?? rows.length,
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

  /**
   * How many distinct electoral areas the workspace's households fall into — the "{n} households
   * across {m} ridings" grain sentence. The word is the campaign's; the number is this.
   *
   * Counted inside ONE boundary set (see `resolveSeatSetId`), because a household is in a riding
   * AND a ward AND a precinct at once and counting across sets would add a riding count to a
   * precinct count. Zero when the workspace has no map yet, which is the honest answer.
   *
   * `campaignId` picks the campaign whose seat set the count reads — the same resolution the grid
   * columns use, so the number and the word in "{n} households across {m} ridings" agree.
   */
  public async countDistinctWards(tenant_id: string, campaignId?: string | null): Promise<number> {
    const setId = await resolveSeatSetId(this.db, tenant_id, campaignId ?? null);
    if (setId == null) return 0;
    const result = await this.db
      .selectFrom('household_districts')
      .select(({ fn }) => [fn.count<number>(sql`DISTINCT name`).as('count')])
      .where('tenant_id', '=', tenant_id)
      .where('set_id', '=', setId)
      .where('name', '!=', '')
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  /**
   * Every boundary one household falls inside — a riding AND a ward AND a precinct can all be
   * true at once — each named with the map it came from, in the order the detail page shows them.
   *
   * One query, whatever the number of boundaries. See `listHouseholdAreas`.
   */
  public getElectoralAreas(tenant_id: string, household_id: string): Promise<HouseholdAreaListing[]> {
    return getHouseholdAreas(this.db, tenant_id, household_id);
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

  public async mergeHouseholds(input: {
    tenant_id: string;
    target_id: string;
    source_id: string;
    user_id: string;
  }): Promise<{ success: boolean }> {
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

      // 5. Move the source's boundary rows (household_districts) to the target wherever the
      // target has no row for that set yet. Without this the FK cascade on the source delete
      // below silently drops them — including rows against an `import`-sourced boundary set,
      // whose area names arrived in a spreadsheet and cannot be recomputed from any polygon.
      await sql`
        INSERT INTO household_districts (tenant_id, household_id, set_id, name, code, matched_at)
        SELECT tenant_id, ${input.target_id}, set_id, name, code, matched_at
        FROM household_districts
        WHERE tenant_id = ${input.tenant_id} AND household_id = ${input.source_id}
        ON CONFLICT (household_id, set_id) DO NOTHING
      `.execute(trx);

      // 6. Re-point the canvassing rows. turf_knocks.household_id and turf_households.household_id
      // are both ON DELETE CASCADE on households(id), so the source delete below would erase every
      // knock ever recorded at that door and drop the address out of the turf it belongs to —
      // silent loss of field history that no other step restores. Same class of re-pointing the
      // PERSON merge does for its child rows.
      //
      // turf_knocks: the only unique key is uq_turf_knocks_client
      // (tenant_id, turf_id, client_knock_id) WHERE client_knock_id IS NOT NULL. The household is
      // not part of that key, so a plain re-point cannot collide.
      await trx
        .updateTable('turf_knocks')
        .set({ household_id: input.target_id, updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 7. turf_households: primary key (tenant_id, turf_id, household_id). Where the target is
      // already in the same turf, re-pointing the source's row would violate that key, so the
      // source's membership row is deleted instead and the target's own row (with its own
      // walk_order) survives. Memberships in turfs the target is not in move across normally.
      const targetTurfs = await trx
        .selectFrom('turf_households')
        .select('turf_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.target_id)
        .execute();
      const targetTurfIds = targetTurfs.map((r) => String(r.turf_id));
      if (targetTurfIds.length > 0) {
        await trx
          .deleteFrom('turf_households')
          .where('tenant_id', '=', input.tenant_id)
          .where('household_id', '=', input.source_id)
          .where('turf_id', 'in', targetTurfIds)
          .execute();
      }
      await trx
        .updateTable('turf_households')
        .set({ household_id: input.target_id, updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 8. delivery_requests.household_id is also ON DELETE CASCADE, so yard-sign requests at the
      // source address would vanish with it. uq_delivery_requests_open_per_household is a partial
      // unique index on (tenant_id, household_id) WHERE status IN ('new','approved'), so only one
      // OPEN request may point at the surviving household. When both households have an open
      // request the target's stays open and the source's is declined first, with the reason
      // recorded — that moves it out of the partial index while keeping the row as history.
      // Requests already delivered or declined sit outside the index and simply move across.
      const targetOpenRequest = await trx
        .selectFrom('delivery_requests')
        .select('id')
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.target_id)
        .where('status', 'in', ['new', 'approved'])
        .executeTakeFirst();
      if (targetOpenRequest) {
        await trx
          .updateTable('delivery_requests')
          .set({
            status: 'declined',
            skip_reason: 'Household records merged — the surviving household already has an open sign request',
            updated_at: sql`now()`,
            updatedby_id: input.user_id,
          })
          .where('tenant_id', '=', input.tenant_id)
          .where('household_id', '=', input.source_id)
          .where('status', 'in', ['new', 'approved'])
          .execute();
      }
      await trx
        .updateTable('delivery_requests')
        .set({ household_id: input.target_id, updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('household_id', '=', input.source_id)
        .execute();

      // 8b. user_activity keys history by a plain (entity, entity_id) text pair with no foreign
      // key, so the source address's logged visits and notes would keep naming an id that no
      // longer exists and become unreachable from either record. Re-point them onto the survivor.
      await trx
        .updateTable('user_activity')
        .set({ entity_id: String(input.target_id), updated_at: sql`now()`, updatedby_id: input.user_id })
        .where('tenant_id', '=', input.tenant_id)
        .where('entity', '=', 'households')
        .where('entity_id', '=', String(input.source_id))
        .execute();

      // 9. Delete source household
      await this.delete({ tenant_id: input.tenant_id, id: input.source_id }, trx);

      return { success: true };
    });
  }
}
