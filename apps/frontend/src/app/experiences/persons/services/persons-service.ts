import { Service, inject } from '@angular/core';
import {
  CompanionVolunteerStatus,
  ExportCsvInputType,
  ExportCsvResponseType,
  MAX_BULK_IDS,
  PERSONINHOUSEHOLDTYPE,
  PersonMergeImpactType,
  UpdatePersonsType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { RouterInputs, RouterOutputs } from '../../../services/api/trpc-types';

@Service()
export class PersonsService extends AbstractAPIService<DATA_TYPE, UpdatePersonsType> {
  protected override readonly endpointName = 'persons';

  private readonly campaignContext = inject(CampaignContextService);

  public add(row: UpdatePersonsType, options?: any) {
    return this.api.persons.add.mutate(row, options);
  }

  public addMany(rows: UpdatePersonsType[]) {
    return Promise.resolve(rows);
  }

  public attachTag(id: string, tag_name: string, type?: 'tag' | 'issue') {
    return this.api.persons.attachTag.mutate({ id: id, tag_name, type });
  }

  /** One round trip per MAX_BULK_IDS chunk instead of the base class's one mutation per id. */
  public override async attachTagToMany(ids: string[], tag_name: string, type: 'tag' | 'issue' = 'tag'): Promise<void> {
    for (let i = 0; i < ids.length; i += MAX_BULK_IDS) {
      await this.api.persons.attachTagToMany.mutate({ ids: ids.slice(i, i + MAX_BULK_IDS), tag_name, type });
    }
  }

  public count(): Promise<number> {
    return this.api.persons.count.query();
  }

  /** People linked to any company — powers the "{n} people in {m} companies" grain sentence. */
  public countWithCompany(): Promise<number> {
    return this.api.persons.countWithCompany.query();
  }

  /** Resolve a person by opaque public_id for /people/:slug URLs (spec §1). */
  public getByPublicId(publicId: string) {
    return this.api.persons.getByPublicId.query(publicId);
  }
  public override async delete(id: string, force?: boolean, skipAlert = false): Promise<boolean> {
    const opts = skipAlert ? { context: { skipErrorHandler: true } } : undefined;
    if (force !== undefined) {
      return (await this.api.persons.delete.mutate({ id, force }, opts as any)) !== null;
    }
    return (await this.api.persons.delete.mutate(id, opts as any)) !== null;
  }

  public override async deleteMany(ids: string[], force?: boolean, skipAlert = false): Promise<boolean> {
    const opts = skipAlert ? { context: { skipErrorHandler: true } } : undefined;
    if (force !== undefined) {
      return await this.api.persons.deleteMany.mutate({ ids, force }, opts as any);
    }
    return await this.api.persons.deleteMany.mutate(ids, opts as any);
  }
  public moveEntireHousehold(fromHouseholdId: string, toHouseholdId: string) {
    return this.api.persons.moveEntireHousehold.mutate({ fromHouseholdId, toHouseholdId });
  }

  public detachTag(
    id: string,
    tag_name: string,
    type?: 'tag' | 'issue',
  ): Promise<RouterOutputs['persons']['detachTag']> {
    return this.api.persons.detachTag.mutate({ id, tag_name, type });
  }

  public getAll(options?: getAllOptionsType) {
    return this.getAllWithAddress(options);
  }

  // We don't support archives
  public getAllArchived(_options?: getAllOptionsType) {
    return Promise.resolve({ rows: [], count: 0 });
  }

  public async getAllWithAddress(options?: getAllOptionsType) {
    // Stamp the active context so campaign-scoped columns (support level,
    // voting status — §15) resolve against the campaign the user is working in.
    const campaignId = this.campaignContext.activeCampaignId();
    const scoped = campaignId ? { ...(options ?? {}), campaignId } : options;
    return this.api.persons.getAllWithAddress.query(scoped, {
      signal: this.ac.signal,
    });
  }

  public getByHouseholdId(id: string, options?: getAllOptionsType) {
    return this.api.persons.getByHouseholdId.query({ id: id, options });
  }

  public getByCompanyId(id: string, options?: getAllOptionsType) {
    return this.api.persons.getByCompanyId.query({ id: id, options });
  }

  public countByCompanyId(id: string): Promise<number> {
    return this.api.persons.countByCompanyId.query({ id });
  }

  public getById(id: string) {
    return this.api.persons.getById.query(id);
  }

  public async getPeopleInHousehold(id: string | null | undefined, options?: getAllOptionsType) {
    if (!id) {
      return [];
    }

    const requiredColumns = ['id', 'first_name', 'middle_names', 'last_name'];
    const mergedColumns = Array.from(new Set([...(options?.columns ?? []), ...requiredColumns]));
    const requestOptions = {
      ...options,
      columns: mergedColumns,
    };

    const peopleInHousehold = (await this.getByHouseholdId(id, requestOptions)) as PERSONINHOUSEHOLDTYPE[];

    return peopleInHousehold.map((person) => {
      return {
        ...person,
        full_name: `${person.first_name || ''} ${person.middle_names || ''} ${person.last_name || ''}`.trim(),
      };
    });
  }

  public getActivity(id: string) {
    return this.api.persons.getActivity.query(id);
  }

  public async getTags(id: string, type?: 'tag' | 'issue') {
    const tags = await this.api.persons.getTags.query({ id, type });
    return tags.map((tag: { name: string }) => tag.name);
  }

  /**
   * Queue a people import from an already-uploaded CSV (spec §17). The wizard PUTs the raw file
   * to blob storage via `imports.getUploadUrl` and hands over the signed handle plus the column
   * mapping — no rows travel in the mutation body; the server parses, validates and skips.
   */
  public import(
    input: {
      upload_handle: string;
      /** Stringified 0-based CSV column index → import field key (PersonsImportMappingObj). */
      mapping: NonNullable<RouterInputs['persons']['import']['mapping']>;
      tags?: string[];
      file_name?: string | null;
      duplicate_decision?: 'merge' | 'skip' | 'import_new';
      list_name?: string;
    },
    options?: { skipErrorHandler?: boolean },
  ): Promise<RouterOutputs['persons']['import']> {
    // Wizard shows its own error state — opt out of the global error toast when asked.
    return this.api.persons.import.mutate(
      {
        upload_handle: input.upload_handle,
        mapping: input.mapping,
        tags: input.tags ?? [],
        file_name: input.file_name ?? undefined,
        duplicate_decision: input.duplicate_decision ?? 'skip',
        list_name: input.list_name,
      },
      options?.skipErrorHandler ? { context: { skipErrorHandler: true } } : undefined,
    );
  }

  /** Email-identity duplicate check for the CSV import wizard's Review step (spec §17). */
  public checkDuplicateEmails(emails: string[]): Promise<RouterOutputs['persons']['checkDuplicateEmails']> {
    return this.api.persons.checkDuplicateEmails.query({ emails });
  }

  public async removeHousehold(id: string) {
    return this.api.persons.removeHousehold.mutate(id);
  }

  public async update(id: string, data: UpdatePersonsType, options?: any) {
    return this.api.persons.update.mutate({ id: id, data }, options);
  }

  public exportCsv(input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return this.api.persons.exportCsv.mutate(input);
  }

  public getPotentialDuplicates(
    options?: RouterInputs['persons']['getPotentialDuplicates'],
  ): Promise<RouterOutputs['persons']['getPotentialDuplicates']> {
    return this.api.persons.getPotentialDuplicates.query(options);
  }

  public getDuplicateCounts(): Promise<RouterOutputs['persons']['getDuplicateCounts']> {
    return this.api.persons.getDuplicateCounts.query();
  }

  public mergePersons(target_id: string, source_id: string): Promise<RouterOutputs['persons']['mergePersons']> {
    return this.api.persons.mergePersons.mutate({ target_id, source_id });
  }

  /**
   * The extra sentence the merge confirmation must carry for this particular pair, or null when
   * the merge costs nothing beyond the duplicate record. Both merge surfaces call it (the
   * Duplicates pair card and the People grid's bulk Merge), so the warning cannot drift between
   * them, and it is asked per pair so a warning that applies to very few merges is not shown on
   * all of them.
   */
  public async mergeWarning(target_id: string, source_id: string, names: MergeNames): Promise<string | null> {
    try {
      const impact = await this.api.persons.mergeImpact.query(
        { target_id, source_id },
        // The caller renders whatever comes back inside the confirmation; a global error toast
        // on top of that would be a second, less useful message.
        { context: { skipErrorHandler: true } },
      );
      return companionAccessMergeWarning(impact, names);
    } catch {
      return COMPANION_MERGE_CHECK_FAILED;
    }
  }
}

/** The two records a merge names, in the words the operator is reading on screen. */
export interface MergeNames {
  target: string;
  source: string;
}

/** How each companion volunteer status reads inside a sentence about a person. */
const COMPANION_STATUS_WORDS: Record<CompanionVolunteerStatus, string> = {
  invited: 'invited but has never verified a code',
  verified: 'verified but still waiting for approval',
  approved: 'approved',
  revoked: 'revoked',
};

/** Shown when the impact query itself failed, so the dialog neither invents a consequence nor
 *  hides that it could not check. */
export const COMPANION_MERGE_CHECK_FAILED =
  'Companion volunteer access could not be checked just now. If both people use the canvassing or delivery app, merging keeps only the surviving record’s access and signs the other person out.';

/**
 * What this merge does to companion (volunteer app) access, in one sentence, or null when it
 * does nothing.
 *
 * `companion_volunteers` is UNIQUE (tenant_id, person_id), so a merge cannot keep two volunteer
 * rows: the backend keeps the record being kept and deletes the other one along with its device
 * sessions. That direction is deliberate, because the opposite would let a merge restore access
 * an admin had revoked, but it means merging an approved volunteer into a record that was only
 * ever invited takes their access away.
 */
export function companionAccessMergeWarning(impact: PersonMergeImpactType, names: MergeNames): string | null {
  const { target, source } = impact.companionAccess;

  // With one volunteer record or none there is no collision: the row, its sessions and its
  // approval move to the surviving person untouched.
  if (target == null || source == null) return null;

  // An invitation nobody acted on, or access an admin already revoked, costs nothing to drop.
  if (source === 'invited' || source === 'revoked') return null;

  if (target === 'approved') {
    // The surviving record already carries full access, so a source that was still waiting for
    // approval loses nothing worth interrupting for.
    if (source !== 'approved') return null;
    return (
      `${names.source} and ${names.target} are both approved companion volunteers. ` +
      `Merging keeps ${names.target}'s volunteer record and signs out ${names.source}'s devices, ` +
      `so that volunteer enters a new code the next time they open the canvassing or delivery app.`
    );
  }

  if (source === 'approved') {
    return (
      `Merging takes away ${names.source}'s companion access. ${names.source} is an approved volunteer ` +
      `and ${names.target} is ${COMPANION_STATUS_WORDS[target]}; only one volunteer record survives a merge, ` +
      `and it is ${names.target}'s. ${names.source} verifies a code again and an admin approves them again ` +
      `before they can canvass or deliver.`
    );
  }

  return (
    `Merging discards ${names.source}'s companion verification. ${names.source} has verified a code and is ` +
    `waiting for an admin to approve them, and that request does not survive the merge. ` +
    `They start again on ${names.target}'s record.`
  );
}

export type DATA_TYPE = 'persons' | 'households';
