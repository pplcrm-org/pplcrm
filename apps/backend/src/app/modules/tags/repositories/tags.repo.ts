import type { ReferenceExpression, Transaction, Selectable } from 'kysely';
import type { AnyQB } from '../../../lib/base.repo';
import { sql } from 'kysely';

import type { JoinedQueryParams, QueryParams } from '../../../lib/base.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { resolvePageWindow } from '../../../lib/paging';
import { resolveSeatSetId } from '../../households/electoral-areas';
import type {
  Models,
  OperationDataType,
  TypeId,
  TypeTenantId,
} from '../../../../../../../libs/common/src/lib/kysely.models';

/** Row shape for the §9.1/§9.2 admin pages (Tags admin / Issues admin). Not paginated —
 * tag/issue vocabularies are small (dozens, not thousands), so the admin page fetches
 * the whole list in one round trip and does its own client-side sentence/callout math. */
export interface TagAdminRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  deletable: boolean;
  type: 'tag' | 'issue';
  created_at: Date;
  created_by_name: string | null;
  use_count_people: number;
  use_count_households: number;
  last_applied_at: Date | null;
  /** New applications (person or household) in the trailing 30 days. Always >= 0 — there is
   * no removal-history table, so this approximates "trend" as new activity only. See
   * pplcrm-forms/pplcrm-trpc-backend skills note on `user_activity` if that ever changes. */
  recent_applications_30d: number;
  /**
   * The most common electoral area among the tagged people's households, read from
   * `household_districts` (one row per household per boundary set) rather than from a fixed
   * `households.ward` column. Areas are ranked inside ONE boundary set — the calling campaign's
   * own seat set when `getAdminList` is given a campaign (the same resolution the grids use,
   * `resolveSeatSetId`), otherwise the workspace's primary set (a seat-area set first, then the
   * set covering the most households) — because a household sits in several boundaries at once
   * and mixing sets would rank a riding against a precinct. Null when the workspace has no
   * boundary data yet.
   *
   * The property is still called `top_ward` because the Issues admin page reads that key; only the
   * column HEADING is jurisdiction-aware. Renaming it is a coordinated frontend change.
   */
  top_ward: string | null;
}

export class TagsRepo extends BaseRepository<'tags'> {
  constructor() {
    super('tags');
  }

  private lowercaseRow<R extends OperationDataType<'tags', 'insert' | 'update'>>(row: R): R {
    if (row && typeof row.name === 'string') {
      return {
        ...row,
        name: row.name.toLowerCase().trim(),
      };
    }
    return row;
  }

  public override async add(input: { row: OperationDataType<'tags', 'insert'> }, trx?: Transaction<Models>) {
    return super.add({ row: this.lowercaseRow(input.row) }, trx);
  }

  public override async addMany(input: { rows: OperationDataType<'tags', 'insert'>[] }, trx?: Transaction<Models>) {
    return super.addMany({ rows: input.rows.map((row) => this.lowercaseRow(row)) }, trx);
  }

  public override async addOrGet<K extends keyof Models['tags'] & string>(
    input: {
      row: OperationDataType<'tags', 'insert'>;
      onConflictColumn: K;
    },
    trx?: Transaction<Models>,
  ): Promise<Selectable<Models['tags']> | undefined> {
    const row = this.lowercaseRow(input.row);
    const type = row.type ?? 'tag';
    const insertResult = await this.getInsert(trx)
      .values(row)
      .onConflict((oc) => oc.columns(['tenant_id', 'name', 'type']).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (insertResult) return insertResult as unknown as Selectable<Models['tags']>;

    return this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', row.tenant_id)
      .where('name', '=', row.name)
      .where('type', '=', type)
      .executeTakeFirst();
  }

  public override async update(
    input: {
      tenant_id: TypeTenantId<'tags'>;
      id: TypeId<'tags'>;
      row: OperationDataType<'tags', 'update'>;
    },
    trx?: Transaction<Models>,
  ) {
    return super.update(
      {
        tenant_id: input.tenant_id,
        id: input.id,
        row: this.lowercaseRow(input.row),
      },
      trx,
    );
  }

  public override getAll(
    input: {
      tenant_id: TypeTenantId<'tags'>;
      options?: QueryParams<'tags'> & { type?: 'tag' | 'issue' };
    },
    trx?: Transaction<Models>,
  ) {
    let query = this.getSelectWithColumns(input.options, trx);
    query = query.where('tenant_id', '=', input.tenant_id);
    const type = input.options?.type;
    if (type) {
      query = query.where('type', '=', type);
    }
    return query.execute();
  }

  public override async deleteMany(input: { tenant_id: TypeTenantId<'tags'>; ids: TypeId<'tags'>[] }) {
    return await this.transaction().execute(async (trx) => {
      if (!input.ids.length) return false;

      const deletableRows = await trx
        .selectFrom(this.table)
        .select(['id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('id', 'in', input.ids)
        .where('deletable', '=', true)
        .execute();

      if (!deletableRows.length) return false;

      const deletableIds = deletableRows.map((row) => row.id);

      await trx
        .deleteFrom('map_households_tags')
        .where('tag_id', 'in', deletableIds)
        .where('tenant_id', '=', input.tenant_id)
        .execute();
      await trx
        .deleteFrom('map_peoples_tags')
        .where('tag_id', 'in', deletableIds)
        .where('tenant_id', '=', input.tenant_id)
        .execute();

      // Fix: Nullify the tag association on past imports before deleting the tag
      await trx
        .updateTable('data_imports')
        .set({ tag_id: null })
        .where('tag_id', 'in', deletableIds)
        .where('tenant_id', '=', input.tenant_id)
        .execute();

      const result = await trx
        .deleteFrom(this.table)
        .where('id', 'in', deletableIds)
        .where('tenant_id', '=', input.tenant_id)
        .executeTakeFirst();

      return Number(result?.numDeletedRows ?? 0) > 0;
    });
  }

  public override async getAllWithCounts(
    input: {
      tenant_id: string;
      options?: QueryParams<'persons' | 'households' | 'tags' | 'map_peoples_tags' | 'map_households_tags'> & {
        type?: 'tag' | 'issue';
      };
    },
    trx?: Transaction<Models>,
  ): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const options: JoinedQueryParams & { type?: 'tag' | 'issue' } = input.options || {};
    const tenantId = input.tenant_id;
    const searchStr = this.normalizeSearch(options.searchStr);
    const filterModel = (options.filterModel ?? {}) as Record<string, { value: unknown } | undefined>;
    const type = options.type;

    // Pagination defaults
    const page = resolvePageWindow(options, 100);

    // Shared filter/search logic for both queries
    const applyFilters = <QB extends AnyQB>(qb: QB) =>
      qb
        .leftJoin('map_peoples_tags', 'map_peoples_tags.tag_id', 'tags.id')
        .leftJoin('map_households_tags', 'map_households_tags.tag_id', 'tags.id')
        .where('tags.tenant_id', '=', tenantId)
        .$if(!!type, (qb) => qb.where('tags.type', '=', type ?? 'tag'))
        .$if(!!searchStr, (qb) => {
          const text = searchStr;
          return qb.where(
            sql<boolean>`(
            LOWER(tags.name) LIKE ${text} OR
            LOWER(tags.description) LIKE ${text}
          )`,
          );
        })
        .$if(!!filterModel['name']?.value, (q) => q.where('tags.name', 'ilike', `%${filterModel['name']?.value}%`))
        .$if(!!filterModel['description']?.value, (q) =>
          q.where('tags.description', 'ilike', `%${filterModel['description']?.value}%`),
        )
        .$if(!!filterModel['deletable']?.value || typeof filterModel['deletable'] === 'string', (q) => {
          const raw = filterModel['deletable']?.value ?? filterModel['deletable'];
          const v = String(raw || '')
            .trim()
            .toLowerCase();
          if (v === 'true' || v === '1' || v === 'yes') return q.where('tags.deletable', '=', true);
          if (v === 'false' || v === '0' || v === 'no') return q.where('tags.deletable', '=', false);
          return q;
        });

    // Count query (with filters/search)
    const countResult = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [fn.count(sql`DISTINCT tags.id`).as('total')])
      .execute();

    const count = Number(countResult[0]?.['total'] || 0);

    // Data query (with filters/search, sorting, pagination)
    const rows = await applyFilters(this.getSelect(trx))
      .select(({ fn }) => [
        'tags.id',
        'tags.name',
        'tags.description',
        'tags.color',
        'tags.deletable',
        'tags.type',
        fn.count('map_peoples_tags.person_id').as('use_count_people'),
        fn.count('map_households_tags.household_id').as('use_count_households'),
      ])
      .groupBy(['tags.id', 'tags.name', 'tags.description', 'tags.color', 'tags.deletable', 'tags.type'])
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
      rows,
      count,
    };
  }

  public getIdByName(input: { tenant_id: string; name: string; type?: 'tag' | 'issue' }, trx?: Transaction<Models>) {
    let q = this.getSelect(trx)
      .select('id')
      .where('name', '=', input.name.toLowerCase().trim())
      .where('tenant_id', '=', input.tenant_id);
    if (input.type) {
      q = q.where('type', '=', input.type);
    }
    return q.executeTakeFirst();
  }

  public findByNameAndType(
    input: { tenant_id: string; name: string; type: 'tag' | 'issue' },
    trx?: Transaction<Models>,
  ) {
    return this.getSelect(trx)
      .select(['name'])
      .where('tenant_id', '=', input.tenant_id)
      .where('name', 'ilike', input.name + '%')
      .where('type', '=', input.type)
      .limit(3)
      .execute();
  }

  /**
   * The full §9.1 (Tags admin) / §9.2 (Issues admin) list: one round trip with counts,
   * last-applied timestamp, creator name, 30-day new-application count (the "trend" proxy —
   * see `TagAdminRow.recent_applications_30d`), and the most common electoral area among tagged
   * people's households. CTEs over raw SQL rather than the query builder because of the window
   * function (top area) and multi-table aggregation; every branch is tenant-scoped.
   */
  public async getAdminList(input: {
    tenant_id: string;
    type: 'tag' | 'issue';
    campaignId?: string | null;
  }): Promise<TagAdminRow[]> {
    // Which boundary set the top-area column ranks inside. With a campaign, the same resolution
    // rule the grid columns use (`resolveSeatSetId`) — its own seat map — so the ranking matches
    // the campaign-worded column heading. Without one, null, and the SQL below falls back to the
    // campaign-free choice: a seat-area set first, then the set covering the most households.
    const campaignSetId = input.campaignId ? await resolveSeatSetId(this.db, input.tenant_id, input.campaignId) : null;
    const rows = await sql<{
      id: string;
      name: string;
      description: string | null;
      color: string | null;
      deletable: boolean;
      type: 'tag' | 'issue';
      created_at: Date;
      created_by_name: string | null;
      use_count_people: string | number;
      use_count_households: string | number;
      last_applied_at: Date | null;
      recent_applications_30d: string | number;
      top_ward: string | null;
    }>`
      WITH base AS (
        SELECT t.id, t.name, t.description, t.color, t.deletable, t.type, t.created_at,
               NULLIF(TRIM(CONCAT_WS(' ', au.first_name, au.last_name)), '') AS created_by_name
        FROM tags t
        LEFT JOIN authusers au ON au.id = t.createdby_id
        WHERE t.tenant_id = ${input.tenant_id} AND t.type = ${input.type}
      ),
      people_counts AS (
        SELECT tag_id, count(*) AS cnt, max(created_at) AS last_applied
        FROM map_peoples_tags WHERE tenant_id = ${input.tenant_id} GROUP BY tag_id
      ),
      household_counts AS (
        SELECT tag_id, count(*) AS cnt, max(created_at) AS last_applied
        FROM map_households_tags WHERE tenant_id = ${input.tenant_id} GROUP BY tag_id
      ),
      recent_30d AS (
        SELECT tag_id, count(*) AS cnt FROM (
          SELECT tag_id, created_at FROM map_peoples_tags WHERE tenant_id = ${input.tenant_id}
          UNION ALL
          SELECT tag_id, created_at FROM map_households_tags WHERE tenant_id = ${input.tenant_id}
        ) recent
        WHERE created_at >= now() - interval '30 days'
        GROUP BY tag_id
      ),
      -- One boundary set to rank inside. A household is in several boundaries at once (a riding
      -- AND a ward AND a precinct), so ranking across all of them would compare areas that are
      -- not comparable. The campaign's own seat set wins when one was resolved above; otherwise
      -- prefer a seat-area set, then the set covering the most households.
      primary_set AS (
        SELECT COALESCE(
          ${campaignSetId}::bigint,
          (SELECT hd.set_id
           FROM household_districts hd
           JOIN boundary_sets bs ON bs.id = hd.set_id AND bs.tenant_id = hd.tenant_id
           WHERE hd.tenant_id = ${input.tenant_id}
           GROUP BY hd.set_id, bs.role
           ORDER BY (bs.role = 'seat_area') DESC, count(*) DESC, hd.set_id
           LIMIT 1)
        ) AS set_id
      ),
      ranked_area AS (
        SELECT mpt.tag_id, hd.name AS area, count(*) AS cnt,
               row_number() OVER (PARTITION BY mpt.tag_id ORDER BY count(*) DESC, hd.name) AS rn
        FROM map_peoples_tags mpt
        JOIN persons p ON p.id = mpt.person_id AND p.tenant_id = mpt.tenant_id
        JOIN household_districts hd ON hd.household_id = p.household_id AND hd.tenant_id = p.tenant_id
        WHERE mpt.tenant_id = ${input.tenant_id}
          AND hd.set_id = (SELECT set_id FROM primary_set)
          AND hd.name <> ''
        GROUP BY mpt.tag_id, hd.name
      ),
      top_area AS (
        SELECT tag_id, area FROM ranked_area WHERE rn = 1
      )
      SELECT
        base.id, base.name, base.description, base.color, base.deletable, base.type, base.created_at,
        base.created_by_name,
        COALESCE(people_counts.cnt, 0) AS use_count_people,
        COALESCE(household_counts.cnt, 0) AS use_count_households,
        GREATEST(people_counts.last_applied, household_counts.last_applied) AS last_applied_at,
        COALESCE(recent_30d.cnt, 0) AS recent_applications_30d,
        top_area.area AS top_ward
      FROM base
      LEFT JOIN people_counts ON people_counts.tag_id = base.id
      LEFT JOIN household_counts ON household_counts.tag_id = base.id
      LEFT JOIN recent_30d ON recent_30d.tag_id = base.id
      LEFT JOIN top_area ON top_area.tag_id = base.id
      ORDER BY COALESCE(people_counts.cnt, 0) DESC, base.name ASC
    `.execute(this.db);

    return rows.rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      description: r.description,
      color: r.color,
      deletable: r.deletable,
      type: r.type,
      created_at: r.created_at,
      created_by_name: r.created_by_name,
      use_count_people: Number(r.use_count_people),
      use_count_households: Number(r.use_count_households),
      last_applied_at: r.last_applied_at,
      recent_applications_30d: Number(r.recent_applications_30d),
      top_ward: r.top_ward,
    }));
  }

  /** §9.2 Issues admin sentence wants unique PEOPLE, not total applications ("2,148 people
   * shared what they care about" — a person with 3 issues counts once, unlike the Tags admin
   * sentence's "applications" total which counts every application). */
  public async countDistinctPeople(input: { tenant_id: string; type: 'tag' | 'issue' }): Promise<number> {
    const result = await this.db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', (join) =>
        join
          .onRef('tags.id', '=', 'map_peoples_tags.tag_id')
          .onRef('tags.tenant_id', '=', 'map_peoples_tags.tenant_id'),
      )
      .select(({ fn }) => [fn.count(sql`DISTINCT map_peoples_tags.person_id`).as('cnt')])
      .where('map_peoples_tags.tenant_id', '=', input.tenant_id)
      .where('tags.type', '=', input.type)
      .executeTakeFirst();
    return Number(result?.cnt ?? 0);
  }

  /**
   * Rename a tag/issue in place and propagate the new name everywhere it's referenced by
   * value rather than by id: `web_forms.target_tags` (tags only — forms don't target issues)
   * and `lists.definition` (the dynamic-list query-builder options; tags live under `.tags`,
   * issues under `.issues`). Footer contract (spec §9.1): "Renames and merges apply everywhere
   * a tag is referenced — people, lists, automations and forms — in one pass." `map_peoples_tags`
   * / `map_households_tags` reference tags by id already, so they need no propagation on rename.
   * Automations (`workflows`/`workflow_steps`) have no tag/issue reference column in the current
   * schema — nothing to propagate there today; see the Track D report for this deferral.
   */
  public async renameTag(input: {
    tenant_id: string;
    id: string;
    new_name: string;
    user_id: string;
  }): Promise<Selectable<Models['tags']> | undefined> {
    return this.transaction().execute(async (trx) => {
      const existing = await this.getSelect(trx)
        .selectAll()
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .executeTakeFirst();
      if (!existing) return undefined;

      const newName = input.new_name.toLowerCase().trim();
      if (newName === existing.name) return existing;

      const updated = await this.update(
        {
          tenant_id: input.tenant_id as TypeTenantId<'tags'>,
          id: input.id as TypeId<'tags'>,
          row: { name: newName, updatedby_id: input.user_id } as OperationDataType<'tags', 'update'>,
        },
        trx,
      );

      // `tags.type` is a `text` column (no DB CHECK constraint); every write path (AddTagObj/
      // UpdateTagObj) restricts it to 'tag' | 'issue', so this narrowing reflects that invariant.
      await this.propagateNameChange(trx, input.tenant_id, existing.type as 'tag' | 'issue', existing.name, newName);

      // `update()` returns `0` only when the row is empty (base.repo.ts) — never here, since we
      // always pass `name`/`updatedby_id`. Narrow it away so the return type stays honest.
      return typeof updated === 'number' ? undefined : updated;
    });
  }

  /**
   * Merge `source_id` into `target_id` (spec §9.1 "Move everyone to"): every person/household
   * carrying the source tag ends up carrying the target tag instead (fills, never duplicates —
   * a record that already has both just keeps one row), the source's name is replaced by the
   * target's name everywhere it was referenced by value, and the source tag row is deleted.
   * Both tags must be the same `type` and the source must be `deletable` (protects seeded
   * system tags/issues from being merged away, same guard as delete).
   */
  public async mergeTags(input: {
    tenant_id: string;
    source_id: string;
    target_id: string;
    user_id: string;
  }): Promise<Selectable<Models['tags']> | undefined> {
    if (input.source_id === input.target_id) {
      throw new Error('Cannot merge a tag into itself.');
    }

    return this.transaction().execute(async (trx) => {
      const [source, target] = await Promise.all([
        this.getSelect(trx)
          .selectAll()
          .where('tenant_id', '=', input.tenant_id)
          .where('id', '=', input.source_id)
          .executeTakeFirst(),
        this.getSelect(trx)
          .selectAll()
          .where('tenant_id', '=', input.tenant_id)
          .where('id', '=', input.target_id)
          .executeTakeFirst(),
      ]);

      if (!source || !target) {
        throw new Error('Source or target tag not found.');
      }
      if (source.type !== target.type) {
        throw new Error('Cannot merge a tag into an issue (or vice versa).');
      }
      if (!source.deletable) {
        throw new Error('This tag is protected and cannot be merged away.');
      }

      // Re-point people/households that only have the source tag; the ones that already carry
      // the target tag just drop the now-redundant source row. Fetch-diff-insert-delete (not a
      // correlated subquery) to match the `mergePersons` shape in persons.repo.ts.
      const targetPeopleIds = new Set(
        (
          await trx
            .selectFrom('map_peoples_tags')
            .select('person_id')
            .where('tenant_id', '=', input.tenant_id)
            .where('tag_id', '=', input.target_id)
            .execute()
        ).map((r) => String(r.person_id)),
      );
      const sourcePeople = await trx
        .selectFrom('map_peoples_tags')
        .select('person_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('tag_id', '=', input.source_id)
        .execute();
      for (const row of sourcePeople) {
        if (!targetPeopleIds.has(String(row.person_id))) {
          await trx
            .insertInto('map_peoples_tags')
            .values({
              tenant_id: input.tenant_id,
              person_id: row.person_id,
              tag_id: input.target_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_peoples_tags')
        .where('tenant_id', '=', input.tenant_id)
        .where('tag_id', '=', input.source_id)
        .execute();

      const targetHouseholdIds = new Set(
        (
          await trx
            .selectFrom('map_households_tags')
            .select('household_id')
            .where('tenant_id', '=', input.tenant_id)
            .where('tag_id', '=', input.target_id)
            .execute()
        ).map((r) => String(r.household_id)),
      );
      const sourceHouseholds = await trx
        .selectFrom('map_households_tags')
        .select('household_id')
        .where('tenant_id', '=', input.tenant_id)
        .where('tag_id', '=', input.source_id)
        .execute();
      for (const row of sourceHouseholds) {
        if (!targetHouseholdIds.has(String(row.household_id))) {
          await trx
            .insertInto('map_households_tags')
            .values({
              tenant_id: input.tenant_id,
              household_id: row.household_id,
              tag_id: input.target_id,
              createdby_id: input.user_id,
              updatedby_id: input.user_id,
            })
            .execute();
        }
      }
      await trx
        .deleteFrom('map_households_tags')
        .where('tenant_id', '=', input.tenant_id)
        .where('tag_id', '=', input.source_id)
        .execute();

      // Historical imports still labeled by the source tag now point at the survivor.
      await trx
        .updateTable('data_imports')
        .set({ tag_id: input.target_id })
        .where('tag_id', '=', input.source_id)
        .where('tenant_id', '=', input.tenant_id)
        .execute();

      // Same invariant as renameTag() above — `type` is enum-shaped by the write paths, not the column.
      await this.propagateNameChange(trx, input.tenant_id, source.type as 'tag' | 'issue', source.name, target.name);

      await trx.deleteFrom('tags').where('tenant_id', '=', input.tenant_id).where('id', '=', input.source_id).execute();

      return target;
    });
  }

  /** Replace `oldName` with `newName` inside the JSON-by-value reference points. De-duplicates
   * the array in the same pass (a merge can otherwise leave `[donor, donor]` if a record already
   * had the target name spelled the same way as the renamed source). */
  private async propagateNameChange(
    trx: Transaction<Models>,
    tenant_id: string,
    type: 'tag' | 'issue',
    oldName: string,
    newName: string,
  ): Promise<void> {
    if (type === 'tag') {
      await sql`
        UPDATE web_forms
        SET target_tags = (
          SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
          FROM (
            SELECT CASE WHEN value = ${oldName} THEN ${newName} ELSE value END AS elem
            FROM jsonb_array_elements_text(target_tags)
          ) sub
        )
        WHERE tenant_id = ${tenant_id} AND target_tags @> to_jsonb(${oldName}::text)
      `.execute(trx);
    }

    const definitionKey = type === 'tag' ? 'tags' : 'issues';
    await sql`
      UPDATE lists
      SET definition = jsonb_set(
        definition,
        ARRAY[${definitionKey}]::text[],
        (
          SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
          FROM (
            SELECT CASE WHEN value = ${oldName} THEN ${newName} ELSE value END AS elem
            FROM jsonb_array_elements_text(definition -> ${definitionKey})
          ) sub
        )
      )
      WHERE tenant_id = ${tenant_id}
        AND definition -> ${definitionKey} @> to_jsonb(${oldName}::text)
    `.execute(trx);

    await this.renameInsideListRules(trx, tenant_id, type, oldName, newName);
  }

  /**
   * Rule-builder conditions hold the tag BY NAME as the `value` of a rule whose `field` is one of
   * the tag fields, nested inside `definition -> 'advancedFilterModel'` (and the older
   * `definition -> 'filterModel' -> 'tags_expression'`). The two statements above never reach
   * them, so a rename used to leave the rule filtering on a name no record carries any more and
   * the smart list silently emptied.
   *
   * Walked in TypeScript rather than SQL because the rule tree nests groups to arbitrary depth and
   * because the value must be replaced only on an exact whole-string match — renaming "donor" must
   * not touch a rule for "donor-major".
   */
  private async renameInsideListRules(
    trx: Transaction<Models>,
    tenant_id: string,
    type: 'tag' | 'issue',
    oldName: string,
    newName: string,
  ): Promise<void> {
    // The builder offers Tags and Issues as separate fields; 'tag' is the singular spelling older
    // saved definitions use. All of them compare against tags.name.
    const fields = type === 'tag' ? ['tag', 'tags'] : ['issues'];
    const rows = await trx
      .selectFrom('lists')
      .select(['id', 'definition'])
      .where('tenant_id', '=', tenant_id)
      .where('definition', 'is not', null)
      .execute();

    for (const row of rows) {
      const definition = row.definition;
      if (!isJsonObject(definition)) continue;

      let changed = false;
      const rewrite = (node: unknown): void => {
        if (Array.isArray(node)) {
          for (const child of node) rewrite(child);
          return;
        }
        if (!isJsonObject(node)) return;
        if (typeof node['field'] === 'string' && fields.includes(node['field']) && node['value'] === oldName) {
          node['value'] = newName;
          changed = true;
        }
        if (node['rules'] !== undefined) rewrite(node['rules']);
      };

      rewrite(definition['advancedFilterModel']);
      const filterModel = definition['filterModel'];
      if (isJsonObject(filterModel)) rewrite(filterModel['tags_expression']);

      if (!changed) continue;
      await trx
        .updateTable('lists')
        .set({ definition: JSON.stringify(definition), updated_at: sql`now()` })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', row.id)
        .execute();
    }
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
