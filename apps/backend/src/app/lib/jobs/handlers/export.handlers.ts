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

const storageService = new StorageService();
const mailService = new TransactionalEmailService({ defaultAudience: 'staff' });
const userActivityRepo = new UserActivityRepo();

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

      // Apply search string if provided
      if (opts.searchStr) {
        const like = `%${opts.searchStr}%`;
        // Best-effort: try name, first_name/last_name depending on table
        if (table === 'persons') {
          query = query.where((eb: ExpressionBuilder<Models, 'persons'>) =>
            eb.or([eb('first_name', 'ilike', like), eb('last_name', 'ilike', like), eb('email', 'ilike', like)]),
          );
        } else if (table === 'households') {
          query = query.where((eb: ExpressionBuilder<Models, 'households'>) =>
            eb.or([eb('street1', 'ilike', like), eb('city', 'ilike', like)]),
          );
        } else {
          query = query.where('name', 'ilike', like);
        }
      }
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

    // Stream the query results using query.stream(). The column list is always non-empty, so
    // csv-stream never falls back to deriving the header from the first row's keys.
    const dbStream = Readable.from(query.stream());
    const csvStream = new CsvTransformStream(csvColumns);

    await storageService.uploadStream(storageKey, dbStream.pipe(csvStream), 'text/csv');

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
