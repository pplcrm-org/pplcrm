import type {
  ExportCsvInputType,
  ExportCsvResponseType,
  IAuthKeyPayload,
  SortModelType,
  getAllOptionsType,
} from '../../../../../../libs/common/src';
import {
  buildPersonSlug,
  MAX_SELECT_ALL_IDS,
  normalizeCrockford,
  PUBLIC_ID_LENGTH,
} from '../../../../../../libs/common/src';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { TRPCError } from '@trpc/server';
import { BadRequestError } from '../../errors/app-errors';
import { BaseController, MAX_INLINE_EXPORT_ROWS } from '../../lib/base.controller';
import type { QueryParams } from '../../lib/base.repo';
import { FULL_SCAN_BATCH_SIZE } from '../../lib/paging';
import { generatePersonPublicId } from '../../lib/person-public-id';
import { HouseholdRepo } from '../households/repositories/households.repo';
import { MapListsPersonsRepo } from '../lists/repositories/map-lists-persons.repo';
import { MapPersonsTagRepo } from './repositories/map-persons-tags.repo';
import { PersonsRepo } from './repositories/persons.repo';
import { MapTeamsPersonsRepo } from '../teams/repositories/map-teams-persons.repo';
import { queueZapierTrigger } from '../zapier/zapier.service';
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

export class PersonsController extends BaseController<'persons', PersonsRepo> {
  private mapPersonsTagRepo = new MapPersonsTagRepo();
  private mapListsPersonsRepo = new MapListsPersonsRepo();
  private mapTeamsPersonsRepo = new MapTeamsPersonsRepo();
  private householdRepo = new HouseholdRepo();

  constructor() {
    super(new PersonsRepo());
  }

  /**
   * Rename regenerates the display slug from the person's existing public_id
   * (spec §1). The public_id NEVER changes, so old URLs keep resolving; only the
   * decorative name prefix tracks the current name.
   */
  public override async update(input: { tenant_id: string; id: string; row: OperationDataType<'persons', 'update'> }) {
    const row = input.row as Record<string, unknown>;
    if ('first_name' in row || 'last_name' in row) {
      const original = (await this.getRepo().getOneById({ id: input.id, tenant_id: input.tenant_id })) as
        | Record<string, unknown>
        | undefined;
      const first = ('first_name' in row ? row['first_name'] : original?.['first_name']) ?? '';
      const last = ('last_name' in row ? row['last_name'] : original?.['last_name']) ?? '';
      const existing = original?.['public_id'];
      // Post-migration every person has a public_id; mint one only for the
      // (effectively impossible) legacy row that somehow lacks it.
      const publicId = typeof existing === 'string' && existing.length > 0 ? existing : generatePersonPublicId();
      if (publicId !== existing) row['public_id'] = publicId;
      row['slug'] = buildPersonSlug(String(first), String(last), publicId);
    }
    return super.update(input);
  }

  public getAllWithAddress(
    auth: IAuthKeyPayload,
    options?: getAllOptionsType,
  ): Promise<{ rows: { [x: string]: unknown }[]; count: number }> {
    const { tags, ...queryParams } = options || {};
    return this.getRepo().getAllWithAddress({
      tenant_id: auth.tenant_id,
      options: queryParams as QueryParams<'persons' | 'households' | 'tags' | 'map_peoples_tags'>,
      tags,
    });
  }

  /**
   * The ids of every person matching the same filters `getAllWithAddress` serves, in the same
   * sort order, up to MAX_SELECT_ALL_IDS — what "select all matching" and record navigation hold.
   * `count` is the true matched total from the same predicate, so `capped` tells the caller
   * whether it has the whole answer or the first window of one; the client must then SAY so
   * rather than claiming every match is selected.
   */
  public async getMatchingIds(
    auth: IAuthKeyPayload,
    options?: getAllOptionsType,
  ): Promise<{ ids: string[]; count: number; capped: boolean }> {
    const { tags, ...queryParams } = options || {};
    const { rows, count } = await this.getRepo().getAllWithAddress({
      tenant_id: auth.tenant_id,
      options: queryParams as QueryParams<'persons' | 'households' | 'tags' | 'map_peoples_tags'>,
      tags,
      idsOnly: { limit: MAX_SELECT_ALL_IDS },
    });
    const ids = rows.map((r) => String(r['id']));
    return { ids, count, capped: count > ids.length };
  }

  public getByHouseholdId(household_id: string, auth: IAuthKeyPayload, options?: getAllOptionsType) {
    return this.getRepo().getByHouseholdId({
      id: household_id,
      tenant_id: auth.tenant_id,
      options: options as QueryParams<'persons'>,
    });
  }

  public getByCompanyId(company_id: string, auth: IAuthKeyPayload, options?: getAllOptionsType) {
    return this.getRepo().getByCompanyId({
      id: company_id,
      tenant_id: auth.tenant_id,
      options: options as QueryParams<'persons'>,
    });
  }

  public countByCompanyId(company_id: string, auth: IAuthKeyPayload) {
    return this.getRepo().countByCompanyId({ id: company_id, tenant_id: auth.tenant_id });
  }

  public countWithCompany(auth: IAuthKeyPayload) {
    return this.getRepo().countWithCompany({ tenant_id: auth.tenant_id });
  }

  /**
   * Resolve a person by opaque public_id (spec §1). Accepts any raw segment
   * form — the caller may pass a full display slug, a hyphen-split id, or a bare
   * id — normalizes to canonical Crockford, and looks it up tenant-scoped.
   * Returns undefined for a malformed segment or an unknown id.
   */
  public getByPublicId(publicId: string, auth: IAuthKeyPayload) {
    const normalized = normalizeCrockford(publicId);
    if (normalized.length !== PUBLIC_ID_LENGTH) return Promise.resolve(undefined);
    return this.getRepo().getByPublicId({ tenant_id: auth.tenant_id, public_id: normalized });
  }

  public getDistinctTags(auth: IAuthKeyPayload, type?: 'tag' | 'issue') {
    return this.getRepo().getDistinctTags(auth.tenant_id, type);
  }

  public getTags(person_id: string, auth: IAuthKeyPayload, type?: 'tag' | 'issue') {
    return this.getRepo().getTags({ id: person_id, tenant_id: auth.tenant_id, type });
  }

  public async moveEntireHousehold(oldHouseholdId: string, newHouseholdId: string, tenantId: string) {
    // household_id has no tenant-composite FK (FINDING A) — Postgres would happily accept
    // another tenant's household id here. Verify it belongs to this tenant before the bulk
    // update below can point this tenant's persons at it.
    const targetHousehold = await this.householdRepo.getOneById({ id: newHouseholdId, tenant_id: tenantId });
    if (!targetHousehold) {
      throw new BadRequestError('That household does not belong to this workspace.');
    }
    // The placeholder household is the shared bucket every address-less person sits in, so a bulk
    // move out of it would drag unrelated contacts along with an address they never had.
    const placeholders = await this.householdRepo.getPlaceholderIds(tenantId, [oldHouseholdId]);
    if (placeholders.has(String(oldHouseholdId))) {
      throw new BadRequestError(
        'These people have no address in common, so they cannot be moved as a household. Move them one at a time.',
      );
    }
    return this.getRepo()
      .transaction()
      .execute(
        async (trx) =>
          await trx
            .updateTable('persons')
            .set({ household_id: newHouseholdId })
            .where('household_id', '=', oldHouseholdId)
            .where('tenant_id', '=', tenantId)
            .returningAll()
            .execute(),
      );
  }

  public override async deleteMany(tenant_id: string, idsToDelete: string[], force?: boolean): Promise<boolean> {
    if (!idsToDelete?.length) return false;

    let personSnapshots: Array<{
      id: unknown;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }> = [];
    try {
      personSnapshots = await this.getRepo()
        .db.selectFrom('persons')
        .select(['id', 'email', 'first_name', 'last_name'])
        .where('tenant_id', '=', tenant_id)
        .where('id', 'in', idsToDelete)
        .execute();
    } catch {
      /* ignore — snapshots are best-effort */
    }

    const result = await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // Check if any person is a team captain
        const captainedTeams = await trx
          .selectFrom('teams')
          .select(['id', 'name', 'team_captain_id'])
          .where('tenant_id', '=', tenant_id)
          .where('team_captain_id', 'in', idsToDelete)
          .execute();

        if (captainedTeams.length > 0 && !force) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'One or more selected people are team captains. Deleting them will remove them as captain. Do you want to proceed?',
          });
        }

        // Unlink captaincy if forced and captained teams exist
        if (captainedTeams.length > 0) {
          await trx
            .updateTable('teams')
            .set({ team_captain_id: null })
            .where('tenant_id', '=', tenant_id)
            .where('team_captain_id', 'in', idsToDelete)
            .execute();
        }

        // Delete volunteer shifts
        await trx
          .deleteFrom('volunteer_shifts')
          .where('tenant_id', '=', tenant_id)
          .where('person_id', 'in', idsToDelete)
          .execute();

        // Revoke companion (canvass/deliveries) access for any deleted person who was a
        // volunteer (FINDING B). None of companion_volunteers.person_id,
        // companion_sessions.volunteer_id, companion_approval_tokens.volunteer_id, or
        // turf_assignments/turf_segment_claims.volunteer_person_id carry a foreign key to
        // persons — see the merge cleanup in persons.repo.ts (mergePersons) for the same
        // problem on the merge path. Mirrors that method's lifecycle mechanics: sessions and
        // pending approval tokens are deleted outright (a live device session or a pending
        // magic link is a bare credential, not history worth keeping); companion_volunteers,
        // turf_assignments, and turf_segment_claims are moved to their existing
        // "no longer active" states (status='revoked' / released_at) rather than deleted, so
        // the access-check paths (requireSession, resolveByToken, and the segment-claim
        // uniqueness index) block them the same way a live revoke would, while keeping the
        // row as an audit trail.
        const revokedVolunteers = await trx
          .selectFrom('companion_volunteers')
          .select('id')
          .where('tenant_id', '=', tenant_id)
          .where('person_id', 'in', idsToDelete)
          .execute();
        const revokedVolunteerIds = revokedVolunteers.map((v) => v.id);

        if (revokedVolunteerIds.length > 0) {
          await trx
            .deleteFrom('companion_sessions')
            .where('tenant_id', '=', tenant_id)
            .where('volunteer_id', 'in', revokedVolunteerIds)
            .execute();

          await trx
            .deleteFrom('companion_approval_tokens')
            .where('tenant_id', '=', tenant_id)
            .where('volunteer_id', 'in', revokedVolunteerIds)
            .execute();

          await trx
            .updateTable('companion_volunteers')
            .set({ status: 'revoked', revoked_at: new Date() })
            .where('tenant_id', '=', tenant_id)
            .where('id', 'in', revokedVolunteerIds)
            .execute();
        }

        await trx
          .updateTable('turf_assignments')
          .set({ status: 'revoked', updated_at: new Date() })
          .where('tenant_id', '=', tenant_id)
          .where('volunteer_person_id', 'in', idsToDelete)
          .where('status', '=', 'active')
          .execute();

        await trx
          .updateTable('turf_segment_claims')
          .set({ released_at: new Date() })
          .where('tenant_id', '=', tenant_id)
          .where('volunteer_person_id', 'in', idsToDelete)
          .where('released_at', 'is', null)
          .execute();

        // Delete team mappings
        await this.mapTeamsPersonsRepo.deleteByPersonIds({ tenant_id, person_ids: idsToDelete }, trx);
        // Delete tag mappings
        await this.mapPersonsTagRepo.deleteByPersonIds({ tenant_id, person_ids: idsToDelete }, trx);
        // Delete list mappings
        await this.mapListsPersonsRepo.deleteByPersonIds({ tenant_id, person_ids: idsToDelete }, trx);
        // Delete persons within the same transaction
        const result = await this.getRepo().deleteMany({ tenant_id, ids: idsToDelete }, trx);

        return result;
      });

    try {
      for (const p of personSnapshots) {
        await queueZapierTrigger(this.getRepo().db, tenant_id, 'person_deleted', {
          id: String(p.id),
          email: p.email,
          first_name: p.first_name,
          last_name: p.last_name,
        });
      }
    } catch (e) {
      logger.error({ err: e }, '[Zapier] Failed to queue person_deleted trigger(s)');
    }

    return result;
  }

  public override async delete(
    tenant_id: string,
    idToDelete: string,
    userId?: string,
    force?: boolean,
  ): Promise<boolean> {
    const result = await this.deleteMany(tenant_id, [idToDelete], force);
    try {
      if (userId) {
        await this.userActivity.log({
          tenant_id: tenant_id,
          user_id: userId,
          activity: 'delete',
          entity: 'persons',
          entity_id: idToDelete ? String(idToDelete) : null,
          quantity: 1,
          metadata: { id: idToDelete },
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log delete person activity');
    }
    return result;
  }

  /**
   * Every person row the current filters/tags match, read in fixed-size batches ordered by primary
   * key (the `fullScan` mode `getAllWithAddress` supports) rather than a single page. Without this,
   * `exportCsv` silently truncated at whatever page size the repo clamps an ordinary request to.
   *
   * Stops once it has passed `EXPORT_SCAN_CAP` rows — the caller's `buildCsvResponse` refuses an
   * export over the real cap anyway, so there is no point pulling an unbounded table into memory
   * first. The caller's requested sort is applied afterwards, in memory: `fullScan` ignores it
   * (it always orders by id to make the keyset walk possible), and re-sorting a bounded ~50k-row
   * accumulation in memory is cheaper than plumbing sort into the keyset scan.
   */
  private async scanAllWithAddress(
    auth: IAuthKeyPayload,
    options?: getAllOptionsType,
  ): Promise<Record<string, unknown>[]> {
    const { tags, ...queryParams } = options || {};
    const queryOptions = queryParams as QueryParams<'persons' | 'households' | 'tags' | 'map_peoples_tags'>;
    const rows: Record<string, unknown>[] = [];
    let afterId: string | null = null;

    for (;;) {
      const batch = await this.getRepo().getAllWithAddress({
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
      const rows = await this.scanAllWithAddress(auth, input?.options);
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
        entity: 'persons',
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
}
