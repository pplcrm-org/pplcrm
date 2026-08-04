import type { IAuthKeyPayload, ImportListItem } from '../../../../../../libs/common/src';

import { isPrivilegedRole } from '../../../../../../libs/common/src';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { StorageService } from '../../lib/storage.service';
import { logger } from '../../logger';
import { sql } from 'kysely';
import { MapListsPersonsRepo } from '../lists/repositories/map-lists-persons.repo';
import { HouseholdRepo } from '../households/repositories/households.repo';
import { MapHouseholdsTagsRepo } from '../households/repositories/map-households-tags.repo';
import { MapPersonsTagRepo } from '../persons/repositories/map-persons-tags.repo';
import { PersonsRepo } from '../persons/repositories/persons.repo';
import { CompaniesRepo } from '../companies/repositories/companies.repo';
import { TasksRepo } from '../tasks/repositories/tasks.repo';
import type { DataImportWithStats } from './repositories/imports.repo';
import { ImportsRepo } from './repositories/imports.repo';

/** The subset of an import row this module's access rule needs. */
export interface ImportOwnershipRow {
  createdby_id: string | null;
}

/** The subset of a caller this module's access rule needs — satisfied by both the tRPC
 *  `IAuthKeyPayload` and the REST `RestAuthContext`. */
export interface ImportActor {
  user_id: string;
  role?: string | null;
}

/**
 * May `actor` download the file behind `row`?
 *
 * The retained upload is the member's own raw contact list, kept under their name in a file that
 * outlives the request. `data_imports.id` comes from a sequence and is therefore guessable inside
 * a tenant, so tenant scoping alone is not a boundary — any member could walk the ids and pull
 * every list the workspace has ever uploaded. Same rule and same reasoning as `canAccessExport`
 * in the exports module. A row with no recorded uploader predates attribution and stays readable
 * tenant-wide.
 */
export function canAccessImport(row: ImportOwnershipRow, actor: ImportActor): boolean {
  if (row.createdby_id == null || row.createdby_id === '') return true;
  if (String(row.createdby_id) === String(actor.user_id)) return true;
  return isPrivilegedRole(actor.role);
}

/**
 * What an import's people are attached to elsewhere in the workspace, counted per import id.
 *
 * "Also delete people" cascades far beyond the people themselves, and the dialog used to say only
 * how many people it had found. These are the record types a member would want to know about
 * before ticking it.
 */
interface PeopleDependentCounts {
  donationCount: number;
  issuedReceiptCount: number;
  eventRegistrationCount: number;
  campaignSubscriptionCount: number;
}

const EMPTY_DEPENDENT_COUNTS: PeopleDependentCounts = {
  donationCount: 0,
  issuedReceiptCount: 0,
  eventRegistrationCount: 0,
  campaignSubscriptionCount: 0,
};

export class ImportsController extends BaseController<'data_imports', ImportsRepo> {
  private readonly personsRepo = new PersonsRepo();
  private readonly mapPersonsTagRepo = new MapPersonsTagRepo();
  private readonly mapListsPersonsRepo = new MapListsPersonsRepo();
  private readonly householdsRepo = new HouseholdRepo();
  private readonly mapHouseholdsTagsRepo = new MapHouseholdsTagsRepo();
  private readonly companiesRepo = new CompaniesRepo();
  private readonly tasksRepo = new TasksRepo();

  constructor() {
    super(new ImportsRepo());
  }

  public async list(auth: IAuthKeyPayload): Promise<ImportListItem[]> {
    const rows = await this.getRepo().getAllWithStats({ tenant_id: auth.tenant_id });
    const dependents = await this.countPeopleDependents(auth.tenant_id);
    return rows.map((row) => this.mapToListItem(row, dependents.get(row.id) ?? EMPTY_DEPENDENT_COUNTS));
  }

  /**
   * Count, per import, the records attached to the people that import created.
   *
   * Read-only and tenant-scoped on both sides of every join. Four grouped queries for the whole
   * page rather than four per row: the History page lists every import a workspace has ever run.
   */
  private async countPeopleDependents(tenantId: string): Promise<Map<string, PeopleDependentCounts>> {
    const db = this.getRepo().db;
    const counts = new Map<string, PeopleDependentCounts>();

    const bump = (fileId: unknown, key: keyof PeopleDependentCounts, value: unknown): void => {
      if (fileId == null) return;
      const id = String(fileId);
      const entry = counts.get(id) ?? { ...EMPTY_DEPENDENT_COUNTS };
      entry[key] = Number(value ?? 0);
      counts.set(id, entry);
    };

    const donations = await db
      .selectFrom('donations')
      .innerJoin('persons', 'persons.id', 'donations.person_id')
      .select(['persons.file_id', (eb) => eb.fn.countAll().as('cnt')])
      .where('donations.tenant_id', '=', tenantId)
      .where('persons.tenant_id', '=', tenantId)
      .where('persons.file_id', 'is not', null)
      .groupBy('persons.file_id')
      .execute();
    for (const row of donations) bump(row.file_id, 'donationCount', row.cnt);

    const receipts = await db
      .selectFrom('donation_receipts')
      .innerJoin('persons', 'persons.id', 'donation_receipts.person_id')
      .select(['persons.file_id', (eb) => eb.fn.countAll().as('cnt')])
      .where('donation_receipts.tenant_id', '=', tenantId)
      .where('persons.tenant_id', '=', tenantId)
      .where('donation_receipts.status', '=', 'issued')
      .where('persons.file_id', 'is not', null)
      .groupBy('persons.file_id')
      .execute();
    for (const row of receipts) bump(row.file_id, 'issuedReceiptCount', row.cnt);

    const registrations = await db
      .selectFrom('event_registrations')
      .innerJoin('persons', 'persons.id', 'event_registrations.person_id')
      .select(['persons.file_id', (eb) => eb.fn.countAll().as('cnt')])
      .where('event_registrations.tenant_id', '=', tenantId)
      .where('persons.tenant_id', '=', tenantId)
      .where('persons.file_id', 'is not', null)
      .groupBy('persons.file_id')
      .execute();
    for (const row of registrations) bump(row.file_id, 'eventRegistrationCount', row.cnt);

    const subscriptions = await db
      .selectFrom('campaign_subscriptions')
      .innerJoin('persons', 'persons.id', 'campaign_subscriptions.person_id')
      .select(['persons.file_id', (eb) => eb.fn.countAll().as('cnt')])
      .where('campaign_subscriptions.tenant_id', '=', tenantId)
      .where('persons.tenant_id', '=', tenantId)
      .where('persons.file_id', 'is not', null)
      .groupBy('persons.file_id')
      .execute();
    for (const row of subscriptions) bump(row.file_id, 'campaignSubscriptionCount', row.cnt);

    return counts;
  }

  public async deleteImport(
    input: {
      id: string;
      deleteContacts?: boolean;
      deletePeople?: boolean;
      deleteHouseholds?: boolean;
      deleteCompanies?: boolean;
      deleteTasks?: boolean;
    },
    auth: IAuthKeyPayload,
  ): Promise<{ deleted: boolean; contactsRemoved: boolean }> {
    const stats = await this.getRepo().getOneWithStats({ tenant_id: auth.tenant_id, id: input.id });
    if (!stats) throw new NotFoundError('Import not found');

    if (stats.status === 'pending' || stats.status === 'processing') {
      throw new BadRequestError('Cannot delete an import that is still processing.');
    }

    const wantsPeopleDeletion = Boolean(input.deletePeople || input.deleteContacts);
    if (wantsPeopleDeletion) {
      await this.assertNoIssuedReceipts(auth.tenant_id, stats.id);
    }
    const wantsHouseholdDeletion = Boolean(input.deleteHouseholds);
    const wantsCompanyDeletion = Boolean(input.deleteCompanies);
    const wantsTaskDeletion = Boolean(input.deleteTasks);

    // Blobs first, row second — the row holds the only copy of these storage keys, so dropping it
    // first orphans the files permanently with nothing left to find them by. That is exactly what
    // this path used to do: every uploaded CSV a member deleted from History stayed in storage
    // forever. Same ordering as the expired-export sweep in maintenance.handlers.ts.
    await this.deleteImportBlobs(auth.tenant_id, stats.id, stats.source_file_key);

    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // 1. Delete people
        if (wantsPeopleDeletion) {
          const personIds = await this.personsRepo.getIdsByFileId(
            { tenant_id: auth.tenant_id, file_id: stats.id },
            trx,
          );
          if (personIds.length > 0) {
            await this.mapPersonsTagRepo.deleteByPersonIds({ tenant_id: auth.tenant_id, person_ids: personIds }, trx);
            await this.mapListsPersonsRepo.deleteByPersonIds({ tenant_id: auth.tenant_id, person_ids: personIds }, trx);
            await this.personsRepo.deleteMany({ tenant_id: auth.tenant_id, ids: personIds }, trx);
          }
        } else {
          await this.personsRepo.clearFileIdForImport(
            { tenant_id: auth.tenant_id, import_id: stats.id, user_id: auth.user_id },
            trx,
          );
        }

        // 2. Delete households
        if (wantsHouseholdDeletion) {
          const householdIds = await this.householdsRepo.getIdsByFileId(
            { tenant_id: auth.tenant_id, file_id: stats.id },
            trx,
          );
          if (householdIds.length > 0) {
            await this.mapHouseholdsTagsRepo.deleteByHouseholdIds(
              { tenant_id: auth.tenant_id, household_ids: householdIds },
              trx,
            );
            // Also clean up list associations before household deletion
            await trx
              .deleteFrom('map_lists_households')
              .where('tenant_id', '=', auth.tenant_id)
              .where('household_id', 'in', householdIds)
              .execute();
            await this.householdsRepo.deleteMany({ tenant_id: auth.tenant_id, ids: householdIds }, trx);
          }
        } else {
          await this.householdsRepo.clearFileIdForImport(
            { tenant_id: auth.tenant_id, import_id: stats.id, user_id: auth.user_id },
            trx,
          );
        }

        // 3. Delete companies
        if (wantsCompanyDeletion) {
          const companyIds = await this.companiesRepo.getIdsByFileId(
            { tenant_id: auth.tenant_id, file_id: stats.id },
            trx,
          );
          if (companyIds.length > 0) {
            await trx
              .updateTable('persons')
              .set({ company_id: null, updated_at: sql`now()`, updatedby_id: auth.user_id })
              .where('tenant_id', '=', auth.tenant_id)
              .where('company_id', 'in', companyIds)
              .execute();
            await this.companiesRepo.deleteMany({ tenant_id: auth.tenant_id, ids: companyIds }, trx);
          }
        } else {
          await this.companiesRepo.clearFileIdForImport(
            { tenant_id: auth.tenant_id, import_id: stats.id, user_id: auth.user_id },
            trx,
          );
        }

        // 4. Delete tasks
        if (wantsTaskDeletion) {
          const taskIds = await this.tasksRepo.getIdsByFileId({ tenant_id: auth.tenant_id, file_id: stats.id }, trx);
          if (taskIds.length > 0) {
            await trx
              .deleteFrom('task_subtasks')
              .where('tenant_id', '=', auth.tenant_id)
              .where('task_id', 'in', taskIds)
              .execute();
            await trx
              .deleteFrom('task_comments')
              .where('tenant_id', '=', auth.tenant_id)
              .where('task_id', 'in', taskIds)
              .execute();
            await trx
              .deleteFrom('task_attachments')
              .where('tenant_id', '=', auth.tenant_id)
              .where('task_id', 'in', taskIds)
              .execute();
            await this.tasksRepo.deleteMany({ tenant_id: auth.tenant_id, ids: taskIds }, trx);
          }
        } else {
          await this.tasksRepo.clearFileIdForImport(
            { tenant_id: auth.tenant_id, import_id: stats.id, user_id: auth.user_id },
            trx,
          );
        }

        await this.getRepo().delete({ tenant_id: auth.tenant_id, id: stats.id }, trx);
      });

    return { deleted: true, contactsRemoved: wantsPeopleDeletion };
  }

  /**
   * Refuse a people-delete while any of those people holds an issued donation receipt.
   *
   * An issued receipt is a tax document that names a donor; deleting the person leaves it pointing
   * at a record that no longer exists. Receipts are immutable once issued, so the only correct
   * order is to cancel them first — hence a refusal rather than a cascade.
   */
  private async assertNoIssuedReceipts(tenantId: string, importId: string): Promise<void> {
    const issued = await this.getRepo()
      .db.selectFrom('donation_receipts')
      .innerJoin('persons', 'persons.id', 'donation_receipts.person_id')
      .select((eb) => eb.fn.countAll().as('cnt'))
      .where('donation_receipts.tenant_id', '=', tenantId)
      .where('persons.tenant_id', '=', tenantId)
      .where('donation_receipts.status', '=', 'issued')
      .where('persons.file_id', '=', importId)
      .executeTakeFirst();

    const count = Number(issued?.cnt ?? 0);
    if (count > 0) {
      throw new BadRequestError(
        `${count} issued donation receipt${count === 1 ? '' : 's'} belong to people from this import. ` +
          'Cancel those receipts first — an issued receipt must keep pointing at a real donor record.',
      );
    }
  }

  /**
   * Remove the blobs an import owns: the retained original upload (`source_file_key`), and the
   * normalized row payload the import job reads, whose key the row carries in `metadata`. A
   * successful import job already deletes the payload; one that failed or never ran has not.
   *
   * Best-effort by design — `StorageService.delete` is `deleteIfExists`, so an already-gone blob
   * is a success, and a genuine storage failure only leaks bytes and must not block the delete the
   * member asked for.
   */
  private async deleteImportBlobs(tenantId: string, importId: string, sourceFileKey: string | null): Promise<void> {
    const storageService = new StorageService();

    const row = await this.getRepo()
      .db.selectFrom('data_imports')
      .select(sql<string | null>`metadata->>'storage_key'`.as('payload_key'))
      .where('tenant_id', '=', tenantId)
      .where('id', '=', importId)
      .executeTakeFirst();

    for (const key of [sourceFileKey, row?.payload_key ?? null]) {
      if (!key) continue;
      try {
        await storageService.delete(key);
      } catch (err) {
        logger.error({ err, tenantId, importId, key }, 'Failed to delete an import blob while deleting the import');
      }
    }
  }

  private mapToListItem(row: DataImportWithStats, dependents: PeopleDependentCounts): ImportListItem {
    const tagMissing = !row.tag_exists || row.tag_assignment_count === 0;
    const canDeleteContacts = row.contact_count > 0 && !tagMissing;

    return {
      id: row.id,
      fileName: row.file_name,
      source: row.source,
      tagName: row.tag_name,
      tagMissing,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      createdBy: row.createdby_id
        ? {
            id: row.createdby_id,
            name: row.created_by_name,
            email: row.created_by_email,
          }
        : null,
      insertedCount: row.inserted_count,
      errorCount: row.error_count,
      skippedCount: row.skipped_count,
      mergedCount: row.merged_count,
      tagsApplied: row.tags_applied,
      rowCount: row.row_count,
      householdsCreated: row.households_created,
      contactCount: row.contact_count,
      householdCount: row.household_count,
      companyCount: row.company_count,
      taskCount: row.task_count,
      donationCount: dependents.donationCount,
      issuedReceiptCount: dependents.issuedReceiptCount,
      eventRegistrationCount: dependents.eventRegistrationCount,
      campaignSubscriptionCount: dependents.campaignSubscriptionCount,
      status: row.status,
      errorMessage: row.error_message,
      canDeleteContacts,
      sourceFileSize: row.source_file_size,
      canDownloadSource: !!row.source_file_key,
      canDownloadSkipped: row.skip_reasons.length > 0,
    };
  }
}
