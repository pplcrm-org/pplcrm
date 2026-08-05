import type {
  ExportCsvInputType,
  ExportCsvResponseType,
  IAuthKeyPayload,
  SortModelType,
  UpdateHouseholdsType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';
import { slugifyRecordName } from '../../../../../../libs/common/src';
import { TRPCError } from '@trpc/server';
import { sql } from 'kysely';

import type { QueryParams } from '../../lib/base.repo';
import { BaseRepository } from '../../lib/base.repo';
import { fingerprintFull, fingerprintStreet, isBlankAddress, isIncompleteAddress } from '../../lib/address-normalize';
import { enqueueGeocodeJobs } from '../../lib/gis/geocode-queue';
import { FULL_SCAN_BATCH_SIZE } from '../../lib/paging';
import { backfillMissingSlugs, uniqueSlug } from '../../lib/slug';
import { chunkRows, IMPORT_CHUNK_SIZE } from '../../lib/import-rows';
import { StorageService } from '../../lib/storage.service';
import { HouseholdRepo } from './repositories/households.repo';
import { MapHouseholdsTagsRepo } from './repositories/map-households-tags.repo';
import { ImportsRepo } from '../imports/repositories/imports.repo';
import { createUploadImport } from '../imports/upload-intake';
import { TagsRepo } from '../tags/repositories/tags.repo';
import { applyHouseholdMatchesBatch, matchPointToSets, requiredSetIdsForTenant } from '../../lib/gis/boundary-match';
import { ensureImportedBoundarySets, readImportedAreas, writeImportedAreas } from './electoral-areas';
import { BaseController, MAX_INLINE_EXPORT_ROWS } from '../../lib/base.controller';
import { BadRequestError } from '../../errors/app-errors';
import { SettingsController } from '../settings/controller';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';

// The full-scan export loop below stops fetching once it has passed this many rows so an
// oversized tenant is not scanned to completion in memory before `buildCsvResponse` makes the
// authoritative call — its internal `assertInlineExportWithinCap` is what actually refuses the
// export. Same constant, so the two caps cannot drift.
const EXPORT_SCAN_CAP = MAX_INLINE_EXPORT_ROWS;

/** Order accumulated export rows by the grid's requested sort, in memory (the full scan below reads
 * rows ordered by primary key, not the caller's sort). Absent a sort, the scan order is kept as-is. */
function sortExportRows(
  rows: Record<string, unknown>[],
  sortModel: SortModelType[] | undefined,
): Record<string, unknown>[] {
  if (!sortModel?.length) return rows;
  const compare = (a: unknown, b: unknown): number => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    return String(a).localeCompare(String(b));
  };
  return [...rows].sort((a, b) => {
    for (const { colId, sort } of sortModel) {
      const cmp = compare(a[colId], b[colId]);
      if (cmp !== 0) return sort === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

export class HouseholdsController extends BaseController<'households', HouseholdRepo> {
  private importsRepo = new ImportsRepo();
  private mapHouseholdsTagRepo = new MapHouseholdsTagsRepo();
  private settingsController = new SettingsController();
  private storageService = new StorageService();
  private tagsRepo = new TagsRepo();

  constructor() {
    super(new HouseholdRepo());
  }

  /**
   * Household count for the grain tabs + count sentence — excludes the tenant's
   * permanent placeholder household so the number matches the rows the grid shows.
   */
  public override getCount(tenant_id: string): Promise<number> {
    return this.getRepo().countExcludingPlaceholder(tenant_id);
  }

  public async deleteManyForTenant(auth: IAuthKeyPayload, idsToDelete: string[]) {
    // Filter out any placeholder households — they are permanent and undeletable
    const placeholders = await this.getRepo().getPlaceholderIds(auth.tenant_id, idsToDelete);
    const safeIds = idsToDelete.filter((id) => !placeholders.has(id));

    if (safeIds.length === 0) return false;
    // Members move to the tenant's placeholder household (persons.household_id is
    // NOT NULL) rather than being cascade-deleted along with the household.
    return this.getRepo().deleteManyReassigningPersons({
      tenant_id: auth.tenant_id,
      ids: safeIds,
      user_id: auth.user_id,
    });
  }

  /**
   * Deleting a single household. The generic CRUD delete cannot be used here for two reasons,
   * so the households router routes its `delete` procedure through this method instead:
   *
   * 1. persons.household_id is NOT NULL and its foreign key has no ON DELETE action, so deleting
   *    a household that still has members raises a raw foreign-key error. Members must move to
   *    the tenant's placeholder household first, which is what deleteManyReassigningPersons does.
   * 2. The placeholder household itself is permanent. Its pointer
   *    (tenants.placeholder_household_id) is ON DELETE SET NULL, so deleting it silently clears
   *    the pointer, nothing recreates it, and every later household delete with members fails.
   */
  public async deleteOneForTenant(auth: IAuthKeyPayload, id: string): Promise<boolean> {
    const placeholders = await this.getRepo().getPlaceholderIds(auth.tenant_id, [id]);
    if (placeholders.has(id)) {
      throw new BadRequestError(
        'The placeholder household is permanent and cannot be deleted. It holds people who have no address yet.',
      );
    }

    const deleted = await this.getRepo().deleteManyReassigningPersons({
      tenant_id: auth.tenant_id,
      ids: [id],
      user_id: auth.user_id,
    });

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'delete',
        entity: 'households',
        entity_id: id,
        quantity: 1,
        metadata: { id },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log household delete activity');
    }

    return deleted;
  }

  public async addHousehold(payload: UpdateHouseholdsType, auth: IAuthKeyPayload) {
    const campaign_id = await this.settingsController.getCurrentCampaignId(auth);

    const fp_street = fingerprintStreet({
      street_num: payload.street_num,
      street1: payload.street1,
      street2: payload.street2,
    });
    const fp_full = fingerprintFull({
      apt: payload.apt,
      street_num: payload.street_num,
      street1: payload.street1,
      street2: payload.street2,
      city: payload.city,
      state: payload.state,
      zip: payload.zip,
      country: payload.country,
    });

    // Try to dedupe: find existing by fingerprint
    if (fp_street || fp_full) {
      const existing = await this.getRepo().findByFingerprint({
        tenant_id: auth.tenant_id,
        fp_street: fp_street,
        fp_full: fp_full,
      });
      if (existing?.id) return { id: String(existing.id) } as any;
    }

    // Record slug for /households/:slug URLs (spec §1) — shared strategy in lib/slug.ts.
    const slug = await uniqueSlug(
      slugifyRecordName(`${payload.street_num ?? ''} ${payload.street1 ?? ''}`, 'household'),
      (candidate) => this.getRepo().slugExists(auth.tenant_id, candidate),
    );

    const row = {
      ...payload,
      slug,
      address_fp_street: fp_street,
      address_fp_full: fp_full,
      campaign_id,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    };
    return this.add(row as OperationDataType<'households', 'insert'>);
  }

  public override async getOneById(input: { tenant_id: string; id: string }) {
    const household = await super.getOneById(input);
    if (!household) return undefined;

    const tenantRow = await (BaseRepository as any)['_db']
      .selectFrom('tenants')
      .select('placeholder_household_id')
      .where('id', '=', input.tenant_id)
      .executeTakeFirst();

    const is_placeholder = tenantRow?.placeholder_household_id
      ? String(tenantRow.placeholder_household_id) === String((household as any).id)
      : false;

    // Every boundary this address falls inside — a federal riding AND a municipal ward AND a
    // precinct can all be true at the same time, which is why this is a list and not three fields.
    // The detail page renders one row per entry and needs the map's name next to the area's, since
    // "Ward 4" on its own does not say which map drew it.
    const electoral_areas = await this.getRepo().getElectoralAreas(input.tenant_id, input.id);

    return {
      ...household,
      is_placeholder,
      electoral_areas,
    } as any;
  }

  public override async update(input: {
    tenant_id: string;
    id: string;
    row: OperationDataType<'households', 'update'>;
  }) {
    const placeholders = await this.getRepo().getPlaceholderIds(input.tenant_id, [input.id]);
    if (placeholders.has(input.id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'The placeholder household cannot be edited.',
      });
    }

    const keys = Object.keys(input.row || {});
    const affectsAddress = keys.some((k) =>
      ['apt', 'street_num', 'street1', 'street2', 'city', 'state', 'zip', 'country'].includes(k),
    );

    // Perform the main update without fingerprint columns first
    const result = await super.update(input);

    // Attempt fingerprint recompute in a separate, non-fatal step
    if (affectsAddress) {
      try {
        const current = await this.getOneById({ tenant_id: input.tenant_id, id: input.id });
        const merged = { ...current, ...input.row };

        let geocoding_status = isBlankAddress(merged) || isIncompleteAddress(merged) ? 'failed' : 'pending';

        // Autocomplete supplied coordinates with the edit, so the address is already located and
        // there is nothing to look up. Match it against the workspace's boundary sets right here:
        // point-in-polygon is pure processor work with no external call and nothing billed, so it
        // is safe on the request path the moment coordinates exist. The paid half — turning an
        // address into coordinates — is only ever queued, below.
        const lat = Number(input.row.lat);
        const lng = Number(input.row.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
          geocoding_status = 'success';
          try {
            const db = this.getRepo().db;
            const setIds = await requiredSetIdsForTenant(db, input.tenant_id);
            // Replace only the layers this edit re-matched, exactly as the batch job does. A set
            // outside the required list — an archived campaign's map — was never looked at, so
            // its rows are not an answer this pass may overwrite. No required layers: nothing
            // matched, so nothing to replace either.
            if (setIds.length > 0) {
              const matches = await matchPointToSets(db, input.tenant_id, lat, lng, setIds);
              await applyHouseholdMatchesBatch(db, input.tenant_id, [{ householdId: input.id, matches }], setIds);
            }
          } catch (err) {
            logger.error({ err }, 'Failed to match household coordinates to boundary sets during update');
          }
        }

        // Address change is a household "rename" — regenerate the record slug (spec §1).
        const slug = await uniqueSlug(
          slugifyRecordName(`${merged.street_num ?? ''} ${merged.street1 ?? ''}`, 'household'),
          (candidate) => this.getRepo().slugExists(input.tenant_id, candidate, input.id),
        );

        const fpRow: Record<string, unknown> = {
          slug,
          address_fp_street: fingerprintStreet({
            street_num: merged.street_num,
            street1: merged.street1,
            street2: merged.street2,
          }),
          address_fp_full: fingerprintFull({
            apt: merged.apt,
            street_num: merged.street_num,
            street1: merged.street1,
            street2: merged.street2,
            city: merged.city,
            state: merged.state,
            zip: merged.zip,
            country: merged.country,
          }),
          geocoding_status,
        };
        await super.update({ ...input, row: fpRow as unknown as OperationDataType<'households', 'update'> });

        // Queue geocoding (plan-gated + daily-budgeted — see lib/gis/geocode-queue.ts) when the
        // address changed into a geocodable state.
        if (geocoding_status === 'pending') {
          await enqueueGeocodeJobs(this.getRepo().db, input.tenant_id, [input.id]);
        }
        // Duplicate maintenance is only calculated nightly
      } catch (err) {
        logger.error({ err }, 'Failed to update address fingerprint and queue duplicates maintenance');
      }
    }

    return result;
  }

  public async attachTag(household_id: string, name: string, type: 'tag' | 'issue' = 'tag', auth: IAuthKeyPayload) {
    const placeholders = await this.getRepo().getPlaceholderIds(auth.tenant_id, [household_id]);
    if (placeholders.has(household_id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot attach tags to the placeholder household.',
      });
    }

    const randomHexColor = () =>
      '#' +
      Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0');
    const row = {
      name,
      color: randomHexColor(),
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      type,
    };

    const tag = await this.tagsRepo.addOrGet({
      row: row as OperationDataType<'tags', 'insert'>,
      onConflictColumn: 'name',
    });

    return this.addToMap({
      tag_id: tag?.id as string | undefined,
      household_id,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    });
  }

  public async detachTag(
    tenant_id: string,
    household_id: string,
    tag_name: string,
    type: 'tag' | 'issue' = 'tag',
    userId?: string,
  ) {
    const placeholders = await this.getRepo().getPlaceholderIds(tenant_id, [household_id]);
    if (placeholders.has(household_id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot detach tags from the placeholder household.',
      });
    }

    const tag = await this.tagsRepo.getIdByName({ tenant_id, name: tag_name, type });
    if (tag?.id) {
      await this.mapHouseholdsTagRepo.deleteMapping(tenant_id, household_id, tag.id);
    }

    try {
      if (userId) {
        await this.userActivity.log({
          tenant_id,
          user_id: userId,
          activity: 'update',
          entity: 'households',
          entity_id: household_id,
          quantity: 1,
          metadata: { id: household_id, action: `detach_${type}`, name: tag_name },
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log detach tag activity');
    }
  }

  public getAllWithPeopleCount(auth: IAuthKeyPayload, options?: getAllOptionsType) {
    const { tags, ...queryParams } = options || {};
    return this.getRepo().getAllWithPeopleCount({
      tenant_id: auth.tenant_id,
      options: queryParams as QueryParams<'households' | 'tags' | 'map_households_tags' | 'persons'>,
      tags,
    });
  }

  public getPeopleCount(id: string, auth: IAuthKeyPayload) {
    return this.getRepo().getPeopleCount({ tenant_id: auth.tenant_id, id });
  }

  /**
   * Most recent canvass at this household's door — powers the "Canvassed <date>"
   * segment of the household header subtitle. Returns null when the household has
   * no knock on record (the subtitle then honestly drops the segment).
   */
  public async getLastCanvass(
    id: string,
    auth: IAuthKeyPayload,
  ): Promise<{ knocked_at: Date; canvasser_name: string | null; outcome: string } | null> {
    const row = await this.getRepo()
      .db.selectFrom('turf_knocks')
      .select(['knocked_at', 'canvasser_name', 'outcome'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('household_id', '=', id)
      .orderBy('knocked_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return {
      knocked_at: new Date(row.knocked_at as unknown as string),
      canvasser_name: row.canvasser_name ?? null,
      outcome: row.outcome,
    };
  }

  /** `campaignId` = the campaign whose seat map the count reads (grain sentence, §5). */
  public countDistinctWards(auth: IAuthKeyPayload, campaignId?: string) {
    return this.getRepo().countDistinctWards(auth.tenant_id, campaignId ?? null);
  }

  public getUnhoused(auth: IAuthKeyPayload) {
    return this.getRepo().getUnhoused(auth.tenant_id);
  }

  public getOneBySlug(slug: string, auth: IAuthKeyPayload) {
    return this.getRepo().getOneBySlug({ tenant_id: auth.tenant_id, slug });
  }

  public getTags(id: string, auth: IAuthKeyPayload, type?: 'tag' | 'issue') {
    return this.getRepo().getTags(id, auth.tenant_id, type);
  }

  /**
   * Every household row the current filters/tags match, read in fixed-size batches ordered by
   * primary key (the `fullScan` mode `getAllWithPeopleCount` supports) rather than a single page.
   * Without this, `exportCsv` silently truncated at whatever page size the repo clamps an ordinary
   * request to.
   *
   * Stops once it has passed `EXPORT_SCAN_CAP` rows — the caller's `buildCsvResponse` refuses an
   * export over the real cap anyway, so there is no point pulling an unbounded table into memory
   * first. The caller's requested sort is applied afterwards, in memory: `fullScan` ignores it
   * (it always orders by id to make the keyset walk possible), and re-sorting a bounded ~50k-row
   * accumulation in memory is cheaper than plumbing sort into the keyset scan.
   */
  private async scanAllWithPeopleCount(
    auth: IAuthKeyPayload,
    options?: getAllOptionsType,
  ): Promise<Record<string, unknown>[]> {
    const { tags, ...queryParams } = options || {};
    const queryOptions = queryParams as QueryParams<'households' | 'tags' | 'map_households_tags' | 'persons'>;
    const rows: Record<string, unknown>[] = [];
    let afterId: string | null = null;

    for (;;) {
      const batch = await this.getRepo().getAllWithPeopleCount({
        tenant_id: auth.tenant_id,
        options: queryOptions,
        tags,
        fullScan: { afterId },
      });
      for (const row of batch.rows) rows.push(row);
      if (batch.rows.length < FULL_SCAN_BATCH_SIZE || rows.length > EXPORT_SCAN_CAP) break;
      const lastRow = batch.rows[batch.rows.length - 1];
      const lastId = lastRow ? String(lastRow['id']) : '';
      // The cursor has to move or the next batch repeats this one for ever. It always does move —
      // the scan orders by id and asks for ids strictly greater than the cursor — so this is a
      // termination guarantee, not a case that happens.
      if (lastId === '' || lastId === afterId) break;
      afterId = lastId;
    }

    return sortExportRows(rows, options?.sortModel);
  }

  public override async exportCsv(
    input: ExportCsvInputType & { tenant_id: string },
    auth?: IAuthKeyPayload,
  ): Promise<ExportCsvResponseType> {
    if (auth) {
      const rows = await this.scanAllWithPeopleCount(auth, input?.options);
      const response = this.buildCsvResponse(rows, input) as {
        csv: string;
        fileName: string;
        columns: string[];
        rowCount: number;
      };
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'export',
        entity: 'households',
        quantity: response.rowCount,
        metadata: {
          requested_columns: Array.isArray(input.columns) ? input.columns.slice(0, 12) : [],
          returned_columns: response.columns.slice(0, 12),
          file_name: response.fileName,
        },
      });
      return response;
    }
    return super.exportCsv(input, auth);
  }

  private async addToMap(row: {
    tag_id: string | undefined;
    household_id: string;
    tenant_id: string;
    createdby_id: string;
    updatedby_id: string;
  }) {
    if (!row.tag_id) {
      throw new TRPCError({
        message: 'Failed to add the tag',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    return await this.mapHouseholdsTagRepo.add({
      row: row as OperationDataType<'map_households_tags', 'insert'>,
    });
  }

  public async getPotentialDuplicates(auth: IAuthKeyPayload, options?: { page?: number; pageSize?: number }) {
    return this.getRepo().getPotentialDuplicates(auth.tenant_id, options);
  }

  public async mergeHouseholds(target_id: string, source_id: string, auth: IAuthKeyPayload) {
    // A merge deletes the source household, so merging the tenant's placeholder household away
    // would clear `tenants.placeholder_household_id` (that foreign key is ON DELETE SET NULL).
    // Nothing recreates it, and without it deleting any household that still has members fails
    // on the persons.household_id foreign key. Merging INTO it is refused for the same reason it
    // cannot be edited: it is not a real address, it is the holding pen for people who have none.
    const placeholders = await this.getRepo().getPlaceholderIds(auth.tenant_id, [target_id, source_id]);
    if (placeholders.size > 0) {
      throw new BadRequestError(
        'The placeholder household holds people who have no address yet and cannot be merged. Move those people into a real household first.',
      );
    }

    return this.getRepo().mergeHouseholds({
      tenant_id: auth.tenant_id,
      target_id,
      source_id,
      user_id: auth.user_id,
    });
  }

  public async getLastFingerprintRecomputation(tenantId: string): Promise<{ lastRunAt: string | null }> {
    const job = await this.getRepo()
      .db.selectFrom('background_jobs')
      .select(['created_at'])
      .where('tenant_id', '=', tenantId)
      .where(sql`payload->>'type'`, '=', 'recompute_address_fingerprints')
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    return { lastRunAt: job?.created_at ? new Date(job.created_at).toISOString() : null };
  }

  public async recomputeAddressFingerprints(tenantId: string): Promise<void> {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const existingJob = await this.getRepo()
      .db.selectFrom('background_jobs')
      .select(['created_at'])
      .where('tenant_id', '=', tenantId)
      .where(sql`payload->>'type'`, '=', 'recompute_address_fingerprints')
      .where('created_at', '>', oneMonthAgo)
      .executeTakeFirst();

    if (existingJob) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Address fingerprints can only be recomputed once a month. A request was already submitted recently.',
      });
    }

    await this.getRepo()
      .db.insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'recompute_address_fingerprints',
          tenant_id: tenantId,
        }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();
  }

  /**
   * CSV import (spec §17): record the import in data_imports and queue the `import_csv`
   * background job that stream-parses the uploaded file. Upload-based intake is the ONLY
   * request shape since 2026-08-05 — the legacy rows-in-body variant was removed once the
   * wizard stopped sending it.
   */
  public async importRows(
    input: {
      /** Upload-based intake: the CSV is already in blob storage (imports.getUploadUrl). */
      upload_handle: string;
      /** Stringified 0-based CSV column index → import field key (HouseholdsImportMappingObj). */
      mapping: Record<string, string>;
      tags?: string[];
      file_name?: string | null;
    },
    auth: IAuthKeyPayload,
  ) {
    const campaign_id = await this.settingsController.getCurrentCampaignId(auth);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const autoName = `Imported-Households-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    const created = await createUploadImport({
      auth,
      importsRepo: this.importsRepo,
      storageService: this.storageService,
      source: 'households',
      input,
      fallbackFileName: `${autoName}.csv`,
      tagName: null,
      jobExtras: { campaign_id, tags: input.tags ?? [] },
    });
    return {
      inserted: 0,
      errors: 0,
      skipped: 0,
      file_name: created.file_name,
      import_id: created.import_id,
      tenant_id: auth.tenant_id,
      status: 'pending',
    };
  }

  /**
   * Background-job half of the households CSV import. Rows are deduplicated by
   * address fingerprint — against households the tenant already has and within
   * the file itself — matching how the persons import resolves households.
   * Inserts go through HouseholdRepo.addMany so geocoding jobs are queued in
   * the same transaction.
   */
  public async processImportRows(
    import_id: string,
    tenant_id: string,
    user_id: string,
    campaign_id: string,
    tags: string[],
    skipped: number,
    // Any row source works (arrays included); the import job passes a lazy
    // iterator so the full file is never materialized at once.
    rows: Iterable<Record<string, string>> | AsyncIterable<Record<string, string>>,
  ) {
    const results = { inserted: 0, errors: 0, skipped: 0 };
    const errorMessages: string[] = [];
    // Rows kept downloadable with the reason each was skipped or lost, same as the people
    // importer. Until now this importer wrote none, so a failed batch left an error count
    // with nothing behind it.
    const SKIP_REASONS_CAP = 500;
    const ERROR_MESSAGE_MAX = 1000;

    // Crash/continuation resume: each per-chunk counter write below also records, atomically
    // with the chunk's inserts, how many source rows have been durably consumed
    // (`processed_row_offset`). A re-entering run (worker crash recovered by stale-job recovery,
    // or a continuation job) finds a non-zero offset; its caller has already stream-skipped that
    // many rows, so totals, skip reasons and row numbering continue from what the database holds.
    const importState = await this.importsRepo.db
      .selectFrom('data_imports')
      .select(['processed_row_offset', 'inserted_count', 'error_count', 'skipped_count', 'skip_reasons'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', import_id)
      .executeTakeFirst();
    const resumeOffset = Number(importState?.processed_row_offset ?? 0);
    const resuming = resumeOffset > 0;
    // On resume the pre-processing skips (wizard/count-pass) are already inside the stored
    // skipped_count, so the base contribution must not be added a second time.
    const skippedBase = resuming ? 0 : skipped;
    if (resuming) {
      results.inserted = Number(importState?.inserted_count ?? 0);
      results.errors = Number(importState?.error_count ?? 0);
      results.skipped = Number(importState?.skipped_count ?? 0);
    }
    // Seeded from what is already on file — the CSV job records the counting pass's validation
    // skips there before processing starts, and a resumed run must keep every reason an earlier
    // run persisted (this importer's final write replaces the whole array).
    const storedReasons: unknown = importState?.skip_reasons;
    const skipReasons: Array<{ row: number; reason: string }> = Array.isArray(storedReasons)
      ? storedReasons.filter(
          (value): value is { row: number; reason: string } =>
            typeof value === 'object' &&
            value !== null &&
            'row' in value &&
            'reason' in value &&
            typeof value.row === 'number' &&
            typeof value.reason === 'string',
        )
      : [];
    const trim = (value: string | null | undefined): string | null => {
      const text = (value ?? '').toString().trim();
      return text.length > 0 ? text : null;
    };
    const uniqueTagNames = new Map<string, string>(); // lower(name) -> original casing
    for (const name of tags) {
      const clean = (name ?? '').trim();
      if (clean && !uniqueTagNames.has(clean.toLowerCase())) uniqueTagNames.set(clean.toLowerCase(), clean);
    }

    // Which jurisdiction any boundary set created by this import belongs to. A spreadsheet does not
    // say, so the importing campaign's own jurisdiction is the best available answer; 'other' is the
    // honest default for a workspace that has not declared one.
    const importCampaign = campaign_id
      ? await this.getRepo()
          .db.selectFrom('campaigns')
          .select('jurisdiction')
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', campaign_id)
          .executeTakeFirst()
      : undefined;
    const importJurisdiction = importCampaign?.jurisdiction ?? 'other';

    // Rows consumed from the source so far, so a skipped or lost row can be named by its
    // 1-based position in the file. Starts at the resume offset: the caller already
    // stream-skipped that many rows.
    let rowsSeen = resumeOffset;
    for await (const chunk of chunkRows(rows, IMPORT_CHUNK_SIZE)) {
      const chunkStartRow = rowsSeen;
      rowsSeen += chunk.length;
      // 1. Sanitize and fingerprint valid rows upfront
      type Entry = {
        sanitized: {
          street_num: string | null;
          apt: string | null;
          street1: string | null;
          street2: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          country: string | null;
          home_phone: string | null;
          notes: string | null;
        };
        /**
         * Electoral areas the file itself named, keyed by import field. Empty for most files.
         * These are NOT columns on `households` — they become `household_districts` rows against
         * an `import`-sourced boundary set, one row per column the file carried.
         */
        areas: Record<string, string>;
        fp_street: string | null;
        fp_full: string | null;
        /** 1-based position of this row in the uploaded file. */
        rowNumber: number;
      };
      const entries: Entry[] = [];
      for (const [chunkIdx, raw] of chunk.entries()) {
        const rowNumber = chunkStartRow + chunkIdx + 1;
        const areas = readImportedAreas(raw);
        const sanitized = {
          street_num: trim(raw['street_num']),
          apt: trim(raw['apt']),
          street1: trim(raw['street1']),
          street2: trim(raw['street2']),
          city: trim(raw['city']),
          state: trim(raw['state']),
          zip: trim(raw['zip']),
          country: trim(raw['country']),
          home_phone: trim(raw['home_phone']),
          notes: trim(raw['notes']),
        };
        const hasAddress =
          sanitized.street_num != null ||
          sanitized.apt != null ||
          sanitized.street1 != null ||
          sanitized.street2 != null ||
          sanitized.city != null ||
          sanitized.state != null ||
          sanitized.zip != null ||
          sanitized.country != null;
        if (!hasAddress && sanitized.home_phone == null && sanitized.notes == null) {
          results.skipped += 1;
          continue;
        }
        entries.push({
          sanitized,
          areas,
          fp_street: hasAddress
            ? fingerprintStreet({
                street_num: sanitized.street_num,
                street1: sanitized.street1,
                street2: sanitized.street2,
              })
            : null,
          fp_full: hasAddress
            ? fingerprintFull({
                apt: sanitized.apt,
                street_num: sanitized.street_num,
                street1: sanitized.street1,
                street2: sanitized.street2,
                city: sanitized.city,
                state: sanitized.state,
                zip: sanitized.zip,
                country: sanitized.country,
              })
            : null,
          rowNumber,
        });
      }

      // Whether this chunk's transaction committed — committed chunks persist their counters and
      // resume offset inside the transaction; everything else is recorded after the fact below.
      let chunkCommitted = false;
      if (entries.length > 0) {
        try {
          // Counted inside the transaction but added to the running totals only after it
          // commits — a chunk that rolls back counts its rows as errors and nothing else.
          const committed = await this.getRepo()
            .transaction()
            .execute(async (trx) => {
              let insertedInChunk = 0;
              let skippedInChunk = 0;
              // 2. Dedupe against existing households by full-address fingerprint
              const uniqueFps = [...new Set(entries.map((e) => e.fp_full).filter((fp): fp is string => fp != null))];
              const existingFps = new Set<string>();
              if (uniqueFps.length > 0) {
                const existing = await trx
                  .selectFrom('households')
                  .select(['address_fp_full'])
                  .where('tenant_id', '=', tenant_id)
                  .where('address_fp_full', 'in', uniqueFps)
                  .execute();
                for (const h of existing) {
                  if (h.address_fp_full) existingFps.add(h.address_fp_full);
                }
              }

              // 3. Insert only addresses the tenant doesn't have yet (also deduped within the file)
              const seenFps = new Set<string>();
              const toInsert: OperationDataType<'households', 'insert'>[] = [];
              // Same length and order as `toInsert`, so a created row's areas are found by index.
              const insertedAreas: Record<string, string>[] = [];
              for (const entry of entries) {
                if (entry.fp_full && (existingFps.has(entry.fp_full) || seenFps.has(entry.fp_full))) {
                  skippedInChunk += 1;
                  continue;
                }
                if (entry.fp_full) seenFps.add(entry.fp_full);
                toInsert.push({
                  tenant_id,
                  campaign_id: campaign_id || null,
                  createdby_id: user_id,
                  updatedby_id: user_id,
                  ...entry.sanitized,
                  address_fp_street: entry.fp_street,
                  address_fp_full: entry.fp_full,
                  file_id: import_id,
                } as OperationDataType<'households', 'insert'>);
                insertedAreas.push(entry.areas);
              }

              const created = toInsert.length > 0 ? await this.getRepo().addMany({ rows: toInsert }, trx) : [];
              insertedInChunk += created.length;

              // 3b. Electoral areas the file named — the cheapest way a workspace gets real
              // electoral geography, because it costs nothing at all. A purchased US voter file
              // already carries the congressional district, both legislative district numbers and
              // the precinct on every row, so taking those columns writes `household_districts`
              // rows with no polygon data and no paid address lookup.
              //
              // Geocoding is still queued for these rows by `addMany`, and deliberately so: the
              // areas answer "which boundaries" but not "where on the map", and coordinates are
              // what the map pins and the turf cutter need. The cost of that lookup is controlled
              // where it always was — the plan gate and the per-tenant daily budget in
              // lib/gis/geocode-queue.ts.
              //
              // A multi-row INSERT ... RETURNING gives its rows back in VALUES order, which is what
              // pairs a created household with the areas its own file row carried. If that ever
              // stops holding, writing the areas against the wrong households would be worse than
              // not writing them, so the mismatch is reported rather than guessed at.
              if (created.length !== insertedAreas.length) {
                logger.error(
                  { importId: import_id, inserted: created.length, expected: insertedAreas.length },
                  'Household insert returned a different number of rows than it was given; skipping imported electoral areas for this chunk',
                );
              } else {
                const areaEntries = created
                  .map((h, i) => ({ household_id: h?.id != null ? String(h.id) : '', areas: insertedAreas[i] ?? {} }))
                  .filter((e) => e.household_id.length > 0 && Object.keys(e.areas).length > 0);
                if (areaEntries.length > 0) {
                  const usedFields = [...new Set(areaEntries.flatMap((e) => Object.keys(e.areas)))];
                  const setIdByField = await ensureImportedBoundarySets(
                    trx,
                    tenant_id,
                    user_id,
                    usedFields,
                    importJurisdiction,
                  );
                  await writeImportedAreas(trx, tenant_id, areaEntries, setIdByField);
                }
              }

              // 4. Apply the batch-level tags to every created household
              if (created.length > 0 && uniqueTagNames.size > 0) {
                const tagIds: string[] = [];
                for (const name of uniqueTagNames.values()) {
                  const tag = await this.tagsRepo.addOrGet(
                    {
                      row: {
                        name,
                        tenant_id,
                        createdby_id: user_id,
                        updatedby_id: user_id,
                      } as OperationDataType<'tags', 'insert'>,
                      onConflictColumn: 'name',
                    },
                    trx,
                  );
                  if (tag?.id != null) tagIds.push(String(tag.id));
                }
                const mapRows = created
                  .filter((h) => h?.id != null)
                  .flatMap((h) =>
                    tagIds.map((tag_id) => ({
                      tenant_id,
                      household_id: String(h.id),
                      tag_id,
                      createdby_id: user_id,
                      updatedby_id: user_id,
                    })),
                  );
                if (mapRows.length > 0) {
                  await trx
                    .insertInto('map_households_tags')
                    .values(mapRows as unknown as OperationDataType<'map_households_tags', 'insert'>[])
                    .onConflict((oc) => oc.doNothing())
                    .execute();
                }
              }

              // The chunk's counters and the resume offset, in the SAME transaction as its rows:
              // committed-rows-without-offset (double import on resume) and offset-without-rows
              // (row loss) are both impossible.
              await this.importsRepo.update(
                {
                  tenant_id,
                  id: import_id,
                  row: {
                    inserted_count: results.inserted + insertedInChunk,
                    error_count: results.errors,
                    skipped_count: skippedBase + results.skipped + skippedInChunk,
                    households_created: results.inserted + insertedInChunk,
                    skip_reasons: JSON.stringify(skipReasons),
                    processed_row_offset: rowsSeen,
                    updatedby_id: user_id,
                    updated_at: new Date(),
                  } as unknown as OperationDataType<'data_imports', 'update'>,
                },
                trx,
              );

              return { inserted: insertedInChunk, skipped: skippedInChunk };
            });
          results.inserted += committed.inserted;
          results.skipped += committed.skipped;
          chunkCommitted = true;
        } catch (err) {
          results.errors += entries.length;
          const message = err instanceof Error && err.message ? err.message : String(err);
          errorMessages.push(message);
          logger.error({ err, message, importId: import_id }, 'Household import chunk failed');
          // Name the rows that were lost, so History can list them instead of showing an
          // error count with nothing behind it.
          for (const entry of entries) {
            if (skipReasons.length >= SKIP_REASONS_CAP) break;
            skipReasons.push({
              row: entry.rowNumber,
              reason: `Row ${entry.rowNumber} was not imported: its batch failed and was rolled back (${message})`,
            });
          }
        }
      }

      // A committed chunk already persisted its counters and offset atomically with its rows.
      // Rolled-back and all-skipped chunks are recorded here, after the fact: if the process
      // dies before this write, the chunk simply re-runs on resume — nothing was committed, so
      // nothing can be imported twice or double-counted.
      if (!chunkCommitted) {
        await this.importsRepo.update({
          tenant_id,
          id: import_id,
          row: {
            inserted_count: results.inserted,
            error_count: results.errors,
            skipped_count: skippedBase + results.skipped,
            households_created: results.inserted,
            skip_reasons: JSON.stringify(skipReasons),
            processed_row_offset: rowsSeen,
            updatedby_id: user_id,
            updated_at: new Date(),
          } as unknown as OperationDataType<'data_imports', 'update'>,
        });
      }
    }

    // Bulk-inserted rows get their record slugs in one set-based pass (spec §1).
    try {
      await backfillMissingSlugs(this.getRepo().db, 'households', tenant_id);
    } catch (err) {
      logger.error({ err }, 'Failed to backfill household slugs after import');
    }

    // What was lost and why. The job handler discards the returned errorMessages, so an
    // import that dropped a batch used to read as a clean success on the History page.
    try {
      await this.importsRepo.update({
        tenant_id,
        id: import_id,
        row: {
          skip_reasons: JSON.stringify(skipReasons),
          error_message:
            errorMessages.length > 0 ? [...new Set(errorMessages)].join('; ').substring(0, ERROR_MESSAGE_MAX) : null,
          updatedby_id: user_id,
          updated_at: new Date(),
        } as unknown as OperationDataType<'data_imports', 'update'>,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to persist final household import stats');
    }

    return {
      inserted: results.inserted,
      errors: results.errors,
      skipped: skippedBase + results.skipped,
      errorMessages,
    };
  }
}
