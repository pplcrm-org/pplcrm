import { Service, inject } from '@angular/core';
import {
  ExportCsvInputType,
  ExportCsvResponseType,
  MAX_BULK_IDS,
  UpdateHouseholdsType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { RouterInputs, RouterOutputs } from '../../../services/api/trpc-types';

@Service()
export class HouseholdsService extends AbstractAPIService<'households', never> {
  protected override readonly endpointName = 'households';

  private readonly campaignContext = inject(CampaignContextService);

  public add(household: UpdateHouseholdsType) {
    return this.api.households.add.mutate(household);
  }

  public override addMany(rows: never[]): Promise<unknown> {
    return Promise.resolve(rows);
  }

  public attachTag(id: string, tag_name: string, type?: 'tag' | 'issue') {
    return this.api.households.attachTag.mutate({ id: id, tag_name, type });
  }

  /** One round trip per MAX_BULK_IDS chunk instead of the base class's one mutation per id. */
  public override async attachTagToMany(ids: string[], tag_name: string, type: 'tag' | 'issue' = 'tag'): Promise<void> {
    for (let i = 0; i < ids.length; i += MAX_BULK_IDS) {
      await this.api.households.attachTagToMany.mutate({ ids: ids.slice(i, i + MAX_BULK_IDS), tag_name, type });
    }
  }

  /** CSV import wizard (spec §17) — queues a background households import. */
  public import(input: RouterInputs['households']['import']): Promise<RouterOutputs['households']['import']> {
    return this.api.households.import.mutate(input);
  }

  public count(): Promise<number> {
    return this.api.households.count.query();
  }

  /**
   * How many distinct areas the workspace's households fall into on the active campaign's own
   * boundary map. Powers the grain sentence "{n} households across {m} wards", where the last word
   * is whatever that campaign calls its areas.
   *
   * The backend procedure is still named `countDistinctWards`. That name is kept deliberately (the
   * same decision as the `top_ward` key on the Issues admin row): renaming a wire contract is a
   * coordinated change, and only the words a person reads have to be jurisdiction-aware.
   */
  public countDistinctAreas(): Promise<number> {
    // The active campaign picks WHICH seat map is counted, so the number agrees with the
    // campaign's word around it ("across 12 wards").
    const campaignId = this.campaignContext.activeCampaignId();
    return this.api.households.countDistinctWards.query(campaignId ? { campaignId } : undefined);
  }

  /** People in the placeholder household (no matchable address) — powers the grid footer note. */
  public getUnhoused(): Promise<{ count: number; household_id: string | null }> {
    return this.api.households.getUnhoused.query();
  }

  /** Tenant-scoped slug resolution for /households/:slug URLs (spec §1). */
  public getBySlug(slug: string) {
    return this.api.households.getBySlug.query(slug);
  }

  public detachTag(id: string, tag_name: string, type?: 'tag' | 'issue') {
    return this.api.households.detachTag.mutate({ id: id, tag_name, type });
  }

  public getAll(options?: getAllOptionsType) {
    return this.getAllWithPeopleCount(options);
  }

  // We don't support archives
  public getAllArchived(_options?: getAllOptionsType) {
    return Promise.resolve({ rows: [], count: 0 });
  }

  /**
   * Whether this address is in the campaign's own territory.
   *
   * The campaign is passed explicitly rather than left to the server to infer, because the server's
   * request-scoped campaign is only set for non-admin users — an owner or admin would get nothing.
   */
  public getSeatStatus(householdId: string, campaignId: string | null) {
    return this.api.households.seatStatus.query({ householdId, campaignId }, { signal: this.ac.signal });
  }

  public getById(id: string) {
    return this.api.households.getById.query(id);
  }

  public async getTags(id: string, type?: 'tag' | 'issue') {
    const tags = await this.api.households.getTags.query({ id, type });
    return tags.map((tag: { name: string }) => tag.name);
  }

  public getPeopleCount(id: string) {
    return this.api.households.getPeopleCount.query(id);
  }

  /** Most recent canvass at this household's door, or null if never canvassed. */
  public getLastCanvass(id: string) {
    return this.api.households.getLastCanvass.query(id);
  }

  public update(id: string, data: UpdateHouseholdsType) {
    return this.api.households.update.mutate({ id: id, data });
  }

  private async getAllWithPeopleCount(options?: getAllOptionsType) {
    // Stamp the active context so the campaign-resolved electoral column (§15) reads the
    // campaign's own seat map — the same stamp persons-service.ts applies.
    const campaignId = this.campaignContext.activeCampaignId();
    const scoped = campaignId ? { ...(options ?? {}), campaignId } : options;
    return this.api.households.getAllWithPeopleCount.query(scoped, {
      signal: this.ac.signal,
    });
  }

  public exportCsv(input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return this.api.households.exportCsv.mutate(input);
  }

  public getPotentialDuplicates(options?: {
    page?: number;
    pageSize?: number;
  }): Promise<{ groups: any[]; total: number }> {
    return this.api.households.getPotentialDuplicates.query(options);
  }

  public mergeHouseholds(targetId: string, sourceId: string): Promise<any> {
    return this.api.households.mergeHouseholds.mutate({ target_id: targetId, source_id: sourceId });
  }

  public getLastFingerprintRecomputation(): Promise<{ lastRunAt: string | null }> {
    return this.api.households.getLastFingerprintRecomputation.query();
  }

  public recomputeAddressFingerprints(): Promise<void> {
    return this.api.households.recomputeAddressFingerprints.mutate();
  }
}
