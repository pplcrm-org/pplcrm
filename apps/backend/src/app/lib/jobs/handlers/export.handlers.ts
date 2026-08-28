import type { AliasedRawBuilder, ExpressionBuilder, JoinBuilder, Kysely } from 'kysely';
import { sql } from 'kysely';
import { Readable } from 'stream';
import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import type { AnyQB } from '../../base.repo';
import { ExportsRepo } from '../../../modules/exports/repositories/exports.repo';
import { CsvTransformStream } from '../../csv-stream';
import { notificationEnabled } from '../../profile-preferences';
import { StorageService } from '../../storage.service';
import { sendMailOrDrop } from '../../mail/send-or-drop';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { UserActivityRepo } from '../../user-activity.repo';
import type { JobPayloadOf } from '../job-payloads';
import {
  ALLOWED_EXPORT_TABLES,
  ELECTORAL_AREA_EXPORT_TABLE,
  electoralExportColumns,
  resolveExportColumns,
  type ElectoralExportColumn,
} from '../../../modules/exports/export-tables';
import { isPrivilegedRole } from '../../../../../../../libs/common/src';
import { FULL_SCAN_BATCH_SIZE } from '../../paging';
import { PersonsRepo } from '../../../modules/persons/repositories/persons.repo';
import { HouseholdRepo } from '../../../modules/households/repositories/households.repo';
import { CompaniesRepo } from '../../../modules/companies/repositories/companies.repo';
import { TagsRepo } from '../../../modules/tags/repositories/tags.repo';
import { TasksRepo } from '../../../modules/tasks/repositories/tasks.repo';
import { ListsRepo } from '../../../modules/lists/repositories/lists.repo';
import { NewslettersRepo } from '../../../modules/newsletters/repositories/newsletters.repo';
import { TeamsRepo } from '../../../modules/teams/repositories/teams.repo';
import { AuthUsersRepo } from '../../../modules/auth/repositories/authusers.repo';
import { VolunteerEventsRepo } from '../../../modules/volunteer-events/repositories/volunteer-events.repo';
import { WebFormsRepo } from '../../../modules/web-forms/repositories/web-forms.repo';
import { WorkflowsRepo } from '../../../modules/workflows/repositories/workflows.repo';

const storageService = new StorageService();
const mailService = new TransactionalEmailService({ defaultAudience: 'staff' });
const userActivityRepo = new UserActivityRepo();
const personsRepo = new PersonsRepo();
const householdsRepo = new HouseholdRepo();

type ExportJobOptions = JobPayloadOf<'export_csv'>['options'];

/**
 * True when the queued options carry any server-side filter the grid was applying when the user
 * clicked export. The whole-table streaming path applies none of them, so a filtered export MUST
 * route its row selection through the entity's own grid query instead — the export dialog
 * promises "all matching rows", and a file containing the whole tenant table is both wrong data
 * and a data-egress surprise.
 */
function hasGridFilters(opts: ExportJobOptions): boolean {
  const filterModelKeys = opts.filterModel ? Object.keys(opts.filterModel).length : 0;
  return Boolean(
    opts.searchStr?.trim() ||
    opts.tags?.length ||
    opts.issues?.length ||
    filterModelKeys > 0 ||
    opts.advancedFilterModel != null ||
    opts.listId ||
    opts.volunteerStatus?.length ||
    opts.staffStatus?.length ||
    opts.includeArchived,
  );
}

/**
 * One page of matching rows from each simple entity's grid query — the same `getAllWithCounts`
 * its tRPC `getAll` calls, so a filtered export can never disagree with the grid about which rows
 * match. The `as never` on options mirrors the deliveries controller: these repos each declare
 * their own `QueryParams<...>` union for the options bag, and the validated payload options are a
 * plain superset of every one of them.
 */
const FILTERED_PAGE_FETCHERS: Record<
  string,
  (tenantId: string, options: Record<string, unknown>) => Promise<{ rows: Record<string, unknown>[] }>
> = {
  companies: (tenant_id, options) => new CompaniesRepo().getAllWithCounts({ tenant_id, options: options as never }),
  tags: (tenant_id, options) => new TagsRepo().getAllWithCounts({ tenant_id, options: options as never }),
  tasks: (tenant_id, options) => new TasksRepo().getAllWithCounts({ tenant_id, options: options as never }),
  lists: (tenant_id, options) => new ListsRepo().getAllWithCounts({ tenant_id, options: options as never }),
  newsletters: (tenant_id, options) => new NewslettersRepo().getAllWithCounts({ tenant_id, options: options as never }),
  teams: (tenant_id, options) => new TeamsRepo().getAllWithCounts({ tenant_id, options: options as never }),
  authusers: (tenant_id, options) => new AuthUsersRepo().getAllWithCounts({ tenant_id, options: options as never }),
  volunteer_events: (tenant_id, options) =>
    new VolunteerEventsRepo().getAllWithCounts({ tenant_id, options: options as never }),
  web_forms: (tenant_id, options) => new WebFormsRepo().getAllWithCounts({ tenant_id, options: options as never }),
  workflows: (tenant_id, options) => new WorkflowsRepo().getAllWithCounts({ tenant_id, options: options as never }),
};

/**
 * Yield the ids of every row the grid's own query matches, in batches.
 *
 * `persons` and `households` walk by primary key through the repositories' backend-only
 * `fullScan` argument — the same mechanism smart-list membership uses — so batches can neither
 * repeat nor skip rows regardless of the saved sort. The other tables page their
 * `getAllWithCounts` by offset windows; their row counts sit far below one batch in practice,
 * and a multi-window scan tolerates the small order-tie risk at window boundaries rather than
 * adding keyset support to ten repositories.
 */
async function* matchingIdBatches(
  table: string,
  entity: string | null | undefined,
  tenantId: string,
  opts: ExportJobOptions,
): AsyncGenerator<string[]> {
  if (table === 'persons' || table === 'households') {
    const { tags, ...queryParams } = opts;
    let afterId: string | null = null;
    for (;;) {
      const batch =
        table === 'persons'
          ? await personsRepo.getAllWithAddress({
              tenant_id: tenantId,
              options: queryParams as never,
              tags,
              fullScan: { afterId },
            })
          : await householdsRepo.getAllWithPeopleCount({
              tenant_id: tenantId,
              options: queryParams as never,
              tags,
              fullScan: { afterId },
            });
      // `ids` is annotated to break a type-inference cycle: the narrowed type of `afterId` at the
      // repo call would otherwise depend on lastId → ids → batch → afterId (TS7022).
      const ids: string[] = batch.rows.map((row) => String(row['id'] ?? '')).filter((id) => id.length > 0);
      if (ids.length > 0) yield ids;
      if (batch.rows.length < FULL_SCAN_BATCH_SIZE) return;
      const lastId: string = ids[ids.length - 1] ?? '';
      // Termination guarantee, same as scanMatchingPersonIds in the lists controller: the scan
      // orders by id and asks for ids strictly greater than the cursor, so it always advances.
      if (lastId === '' || lastId === afterId) return;
      afterId = lastId;
    }
  }

  const fetchPage = FILTERED_PAGE_FETCHERS[table];
  if (!fetchPage) throw new Error(`No grid query for filtered export of: ${table}`);
  // Issues live in the tags table discriminated by `type`; the tags repo reads it from options.
  const baseOptions: Record<string, unknown> = entity === 'issues' ? { ...opts, type: 'issue' } : { ...opts };
  for (let startRow = 0; ; startRow += FULL_SCAN_BATCH_SIZE) {
    const page = await fetchPage(tenantId, { ...baseOptions, startRow, endRow: startRow + FULL_SCAN_BATCH_SIZE });
    const ids = page.rows.map((row) => String(row['id'] ?? '')).filter((id) => id.length > 0);
    if (ids.length > 0) yield ids;
    if (page.rows.length < FULL_SCAN_BATCH_SIZE) return;
  }
}

/**
 * The rows of a FILTERED export, in bounded batches: the entity's grid query picks WHICH ids
 * match (exactly the filters the grid showed), and the export's allow-listed column query then
 * reads those rows by id. Peak memory is one batch of rows, never the table. Row order follows
 * the id batches, so a filtered file is ordered by the entity query's scan order rather than the
 * saved grid sort — correct rows over cosmetic order.
 */
async function* rowsMatchingGridFilters(
  columnQuery: AnyQB,
  table: string,
  entity: string | null | undefined,
  tenantId: string,
  opts: ExportJobOptions,
): AsyncGenerator<Record<string, unknown>> {
  for await (const ids of matchingIdBatches(table, entity, tenantId, opts)) {
    const rows: Record<string, unknown>[] = await columnQuery.where('id', 'in', ids).execute();
    const byId = new Map(rows.map((row) => [String(row['id']), row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (row) yield row;
    }
  }
}

/**
 * Export tables whose rows belong to exactly one campaign context (Campaigns §15). Mirrors the
 * campaign-scoped subset of `CAMPAIGN_SCOPED_TABLES` in `lib/base.repo.ts`; the shared rolodex
 * (persons, households, companies, tags, tasks, teams, workflows) is tenant-wide and unscoped.
 */
const CAMPAIGN_SCOPED_EXPORT_TABLES: ReadonlySet<string> = new Set<string>(['lists', 'newsletters', 'web_forms']);

/**
 * The campaign this export must be restricted to, or null when the requester may read every
 * campaign in the tenant.
 *
 * Ordinary reads get this pin from `runWithTenant(..., pinnedCampaign)` in `src/trpc.ts`, but the
 * background worker never enters that context — it runs on a raw Kysely handle with no request
 * behind it. So a campaign-restricted Editor who queued an export of lists, newsletters or forms
 * received the whole tenant's rows. Re-derive the same pin here, from the requester's stored
 * assignment (never from the job payload), using the same office-campaign fallback the middleware
 * uses for an unassigned non-admin.
 */
async function resolveExportCampaignPin(
  db: Kysely<Models>,
  tenantId: string,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;

  const user = await db
    .selectFrom('authusers')
    .select(['role', 'campaign_id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', userId)
    .executeTakeFirst();

  if (!user || isPrivilegedRole(user.role)) return null;
  if (user.campaign_id) return String(user.campaign_id);

  const office = await db
    .selectFrom('campaigns')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('kind', '=', 'office')
    .executeTakeFirst();

  return office ? String(office.id) : null;
}

/**
 * The boundary maps this workspace holds, turned into export columns.
 *
 * Ordered so the CSV is stable between runs: seat areas (ridings, wards, congressional districts —
 * the ones people actually organize around) first, then by label, then by id to break a tie between
 * two maps sharing a label. Without a total order Postgres is free to return the maps in any order
 * and the column order of the file would change from one export to the next.
 */
async function resolveElectoralExportColumns(
  db: Kysely<Models>,
  tenantId: string,
  reservedHeaders: readonly string[],
): Promise<ElectoralExportColumn[]> {
  const sets = await db
    .selectFrom('boundary_sets')
    .select(['id', 'label'])
    .where('tenant_id', '=', tenantId)
    .orderBy(sql`(role = 'seat_area')`, 'desc')
    .orderBy('label', 'asc')
    .orderBy('id', 'asc')
    .execute();

  return electoralExportColumns(
    sets.map((set) => ({ id: String(set.id), label: set.label })),
    reservedHeaders,
  );
}

export async function handleExportCsv(payload: JobPayloadOf<'export_csv'>, db: Kysely<Models>): Promise<void> {
  const exportsRepo = new ExportsRepo();
  const exportId = payload.export_id;
  const tenantId = payload.tenant_id;
  try {
    // Make sure we're exporting one of the allowed tables
    const table = payload.table || payload.entity || '';
    if (!ALLOWED_EXPORT_TABLES.has(table)) throw new Error(`Invalid export entity: ${table}`);

    // Resolve the columns BEFORE building the query: the allow-list gates the SQL select, not
    // just the CSV header. Gating only the header would still read the forbidden values out of
    // Postgres, and an explicitly named column (`columns: ['email','password']`) would have been
    // emitted verbatim.
    const requestedCols: string[] = Array.isArray(payload.columns) ? payload.columns : [];
    const { columns: csvColumns, dropped } = resolveExportColumns(table, requestedCols);
    if (csvColumns.length === 0) throw new Error(`No exportable columns for: ${table}`);
    if (dropped.length > 0) {
      logger.warn({ exportId, table, dropped }, 'Export dropped columns that are not exportable');
    }

    // Mark as processing
    await exportsRepo.updateStatus(exportId, tenantId, 'processing');

    // Fetch all rows for the entity
    const opts = payload.options;
    // The export query is assembled dynamically across heterogeneous tables and joins,
    // which Kysely cannot express statically — the builder is intentionally untyped here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any;

    if (table === 'user_activity') {
      query = db
        .selectFrom('user_activity')
        .innerJoin('authusers', 'authusers.id', 'user_activity.user_id')
        .select([
          'user_activity.id',
          'user_activity.created_at',
          sql`TRIM(CONCAT(authusers.first_name, ' ', COALESCE(authusers.last_name, '')))::text`.as('user'),
          'authusers.email',
          'user_activity.activity',
          'user_activity.entity',
          'user_activity.entity_id',
          'user_activity.quantity',
          'user_activity.metadata',
        ])
        .where('user_activity.tenant_id', '=', tenantId);

      if (opts.userId) {
        query = query.where('user_activity.user_id', '=', opts.userId);
      }
      if (opts.entity) {
        query = query.where('user_activity.entity', 'in', getEntityFilterValues(opts.entity));
      }
      if (opts.activity) {
        query = query.where('user_activity.activity', '=', opts.activity);
      }
      if (opts.searchStr) {
        const search = `%${opts.searchStr.trim().toLowerCase()}%`;
        query = query.where((eb: ExpressionBuilder<Models, 'user_activity' | 'authusers'>) =>
          eb.or([
            eb('authusers.first_name', 'ilike', search),
            eb('authusers.last_name', 'ilike', search),
            eb('user_activity.entity', 'ilike', search),
            eb('user_activity.activity', 'ilike', search),
          ]),
        );
      }
    } else {
      // The table and its column list are both resolved at runtime, so Kysely cannot type the
      // selection — hence AnyQB, the workspace's alias for a deliberately untyped query builder.
      // `csvColumns` is not free-form: it comes from EXPORT_TABLE_COLUMNS, which the export-tables
      // spec checks against information_schema on every run.
      let dynamic: AnyQB = db.selectFrom(table as keyof Models);
      // The columns to select. Starts as the allow-listed table columns; a households export then
      // appends one aggregate per boundary map.
      const selectList: Array<string | AliasedRawBuilder<string | null, string>> = [...csvColumns];

      // A households CSV used to carry `district`, `precinct` and `ward` as plain columns of the
      // table, and lost them when electoral geography moved into `household_districts`. Restore
      // them here as one column per boundary map the workspace holds — see `electoralExportColumns`
      // in modules/exports/export-tables.ts for why one column per map rather than one column
      // listing every area.
      //
      // This costs nothing and calls nothing: the areas are rows already on file, written either by
      // point-in-polygon matching (pure processor work) or straight out of an imported file. No
      // geocoding, no external service, no per-address billing is involved in exporting them.
      if (table === ELECTORAL_AREA_EXPORT_TABLE) {
        const areaColumns = await resolveElectoralExportColumns(db, tenantId, csvColumns);
        if (areaColumns.length > 0) {
          // A lateral aggregate, not a join: a household sits in several boundaries at once, so a
          // plain join would emit one CSV row per boundary per household. Aggregating with no
          // GROUP BY yields exactly one row per household, including households that match no
          // boundary at all (their cells are simply empty). The subquery is correlated on both
          // household_id and tenant_id, so it stays tenant-scoped.
          dynamic = dynamic.leftJoinLateral(
            (eb: ExpressionBuilder<Models, 'households'>) =>
              eb
                .selectFrom('household_districts as hd')
                .whereRef('hd.household_id', '=', 'households.id')
                .whereRef('hd.tenant_id', '=', 'households.tenant_id')
                .select(
                  areaColumns.map((column) =>
                    sql<string | null>`max(hd.name) filter (where hd.set_id = ${column.setId})`.as(column.alias),
                  ),
                )
                .as('hd_areas'),
            (join: JoinBuilder<Models, 'households'>) => join.onTrue(),
          );
          for (const column of areaColumns) {
            // Referenced through the safe alias and renamed to the map's label only at the outer
            // level, so a label with spaces or punctuation never has to be a SQL identifier twice.
            selectList.push(sql<string | null>`hd_areas.${sql.raw(column.alias)}`.as(column.header));
            csvColumns.push(column.header);
          }
        }
      }

      query = dynamic.select(selectList).where('tenant_id', '=', tenantId);

      // Campaigns §15 — restrict a campaign-pinned requester to their own campaign's rows.
      if (CAMPAIGN_SCOPED_EXPORT_TABLES.has(table)) {
        const campaignPin = await resolveExportCampaignPin(db, tenantId, payload.user_id);
        if (campaignPin) {
          query = query.where('campaign_id', '=', campaignPin);
        }
      }

      // Issues are tags with type='issue'
      if (payload.entity === 'issues') {
        query = query.where('type', '=', 'issue');
      }

      // No searchStr handling here: search — like every other grid filter — is applied by
      // routing row selection through the entity's own grid query below (hasGridFilters). The
      // old best-effort ilike over 2-3 hard-coded columns both missed columns the real search
      // covers and was the ONLY filter this job applied, so a tag/column/list-filtered export
      // silently contained the whole table.
    }

    // Apply sort
    if (opts.sortModel?.length) {
      for (const s of opts.sortModel) {
        if (s?.colId) {
          query = query.orderBy(s.colId, s.sort === 'desc' ? 'desc' : 'asc');
        }
      }
    } else {
      const sortCol = table === 'user_activity' ? 'user_activity.created_at' : 'created_at';
      query = query.orderBy(sortCol, 'desc');
    }

    const storageKey = `exports/${tenantId}/${exportId}.csv`;

    // Two row sources, one CSV pipeline. Unfiltered exports stream the whole table with a
    // pg-cursor as before. Filtered exports delegate row selection to the entity's own grid
    // query in bounded batches (see rowsMatchingGridFilters) so the file contains exactly the
    // rows the grid was showing. The column list is always non-empty, so csv-stream never falls
    // back to deriving the header from the first row's keys.
    const useGridFilters = table !== 'user_activity' && hasGridFilters(opts);
    if (useGridFilters && !csvColumns.includes('id')) {
      // The filtered path matches column rows back to their id batch; select the id even when
      // the CSV omits it (CsvTransformStream writes only the header's columns).
      query = query.select('id');
    }
    const rowSource = useGridFilters
      ? Readable.from(rowsMatchingGridFilters(query, table, payload.entity, tenantId, opts))
      : Readable.from(query.stream());
    const csvStream = new CsvTransformStream(csvColumns);

    await storageService.uploadStream(storageKey, rowSource.pipe(csvStream), 'text/csv');

    const count = csvStream.rowCount;

    // If no rows were processed, clean up by deleting the empty file if created
    if (count === 0) {
      await storageService.delete(storageKey);
    }

    await exportsRepo.updateStatus(exportId, tenantId, 'completed', {
      rowCount: count,
      storageKey: count > 0 ? storageKey : undefined,
    });

    logger.info(`Export job ${exportId} completed: ${count} rows exported.`);

    // The Exports page promises "every export lands in the Activity log". The inline
    // exportCsv path logs from BaseController; queued exports must log here on completion.
    // A logging failure must not fail (and re-run) an export that already succeeded.
    if (payload.user_id) {
      try {
        await userActivityRepo.log({
          tenant_id: tenantId,
          user_id: payload.user_id,
          activity: 'export',
          entity: table,
          quantity: count,
          metadata: {
            requested_columns: Array.isArray(payload.columns) ? payload.columns.slice(0, 12) : [],
            file_name: payload.file_name || 'export.csv',
          },
        });
      } catch (activityErr) {
        logger.error({ err: activityErr }, `Failed to log activity for export job ${exportId}`);
      }
    }

    // Notify the user who requested the export
    if (payload.user_id) {
      try {
        const user = await db
          .selectFrom('authusers')
          .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
          .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
          .where('authusers.id', '=', payload.user_id)
          .executeTakeFirst();

        if (user) {
          const emailOptedIn = notificationEnabled(user.profile_preferences, 'export_ready');
          const inAppOptedIn = notificationEnabled(user.profile_preferences, 'export_ready_in_app');

          const entityLabel = table === 'user_activity' ? 'Activity Feed' : table;
          const displayLabel = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

          if (inAppOptedIn) {
            const { NotificationsRepo } =
              await import('../../../modules/notifications/repositories/notifications.repo');
            const notificationsRepo = new NotificationsRepo();
            await notificationsRepo.pushNotification({
              tenant_id: tenantId,
              user_id: payload.user_id,
              title: 'Export Ready',
              message: `Your export of ${count} records from ${displayLabel} is complete.`,
              type: 'export',
              link: '/exports',
            });
          }

          if (emailOptedIn && user.email) {
            await sendMailOrDrop(
              mailService,
              {
                to: user.email,
                subject: `Your export is ready: ${payload.file_name || 'export.csv'}`,
                // Postmark round-trips this to the bounce webhook. Without it a bounce or
                // complaint on this message cannot be attributed to a workspace, and the
                // anti-abuse gate has no tenant to check, so it was never gated at all.
                tenant_id: tenantId,
                notificationSettingsLink: true,
                text: `Hi ${user.first_name || 'there'},\n\nYour export of ${count} records from the ${displayLabel} table is ready.\n\nFile name: ${payload.file_name || 'export.csv'}\nDownload it from the Exports page: ${env.appUrl}/exports`,
                html: `<h2>Your export is ready</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>Your export of <strong>${count}</strong> records from the <strong>${displayLabel}</strong> table is ready.</p>
<div class="panel"><p><strong>File name:</strong> ${payload.file_name || 'export.csv'}</p></div>
<div class="btn-container">
  <a href="${env.appUrl}/exports" class="btn">Go to exports</a>
</div>`,
              },
              'export ready notice',
            );
          }
        }
      } catch (notifErr) {
        logger.error({ err: notifErr }, `Failed to send notifications for export job ${exportId}`);
      }
    }
  } catch (err) {
    logger.error({ err }, `Export job ${exportId} failed`);
    const message = err instanceof Error ? err.message : String(err);
    await exportsRepo.updateStatus(exportId, tenantId, 'failed', {
      error: message.substring(0, 500),
    });
    throw err;
  }
}

function getEntityFilterValues(entityFilter: string): string[] {
  const ent = entityFilter.toLowerCase();
  if (ent === 'persons' || ent === 'person' || ent === 'people') {
    return ['person', 'persons'];
  }
  if (ent === 'households' || ent === 'household') {
    return ['household', 'households'];
  }
  if (ent === 'companies' || ent === 'company') {
    return ['company', 'companies'];
  }
  if (ent === 'tasks' || ent === 'task') {
    return ['task', 'tasks', 'tasks_archived'];
  }
  if (ent === 'emails' || ent === 'email') {
    return ['email', 'emails'];
  }
  if (ent === 'volunteer_events' || ent === 'volunteer_event') {
    return ['volunteer_event', 'volunteer_events'];
  }
  if (ent === 'volunteer_shifts' || ent === 'volunteer_shift') {
    return ['volunteer_shift', 'volunteer_shifts'];
  }
  if (ent === 'web_forms' || ent === 'web_form' || ent === 'forms' || ent === 'form') {
    return ['web_form', 'web_forms', 'form', 'forms'];
  }
  if (ent === 'tags' || ent === 'tag') {
    return ['tag', 'tags'];
  }
  return [ent];
}
