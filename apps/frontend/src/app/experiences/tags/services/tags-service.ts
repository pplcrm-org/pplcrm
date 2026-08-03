import { Service } from '@angular/core';
import {
  AddTagType,
  ExportCsvInputType,
  ExportCsvResponseType,
  UpdateTagType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { Tags } from '../../../../../../../libs/common/src/lib/kysely.models';
import { RouterOutputs } from '../../../services/api/trpc-types';

@Service()
export class TagsService extends AbstractAPIService<'tags', AddTagType> {
  protected override readonly endpointName = 'tags';

  public add(tag: AddTagType) {
    return this.api.tags.add.mutate(tag);
  }

  public override addMany(rows: never[]): Promise<unknown> {
    return Promise.resolve(rows);
  }

  public async attachTag(_id: string, tag_name: string) {
    await this.add({ name: tag_name });
  }

  public count(): Promise<number> {
    return this.api.tags.count.query();
  }

  public override async delete(id: string): Promise<boolean> {
    const res = await super.delete(id);
    this.triggerRefresh();
    return res;
  }

  public override async deleteMany(ids: string[]): Promise<boolean> {
    const res = await super.deleteMany(ids);
    this.triggerRefresh();
    return res;
  }

  public detachTag(id: string) {
    return this.delete(id);
  }

  public async filter(key: string, type: 'tag' | 'issue' = 'tag') {
    const names = (await this.findByName(key, type)) as AddTagType[];
    return (names && names.filter((m) => m.name).map((m) => m.name)) || [];
  }

  public findByName(name: string, type: 'tag' | 'issue' = 'tag') {
    return this.api.tags.findByName.query({ name, type });
  }

  public getAll(options?: getAllOptionsType): Promise<{ rows: { [x: string]: any }[]; count: number }> {
    return this.getAllWithCounts(options);
  }

  // We don't support archives
  public getAllArchived(_options?: getAllOptionsType) {
    return Promise.resolve({ rows: [], count: 0 });
  }

  public getAllWithCounts(options?: getAllOptionsType) {
    return this.api.tags.getAllWithCounts.query(options, {
      signal: this.ac.signal,
    });
  }

  public getById(id: string) {
    return this.api.tags.getById.query(id);
  }

  public async getTags(id: string) {
    const tag = (await this.getById(id)) as Tags;
    return [tag.name];
  }

  public async update(id: string, data: UpdateTagType) {
    const res = await this.api.tags.update.mutate({ id: id, data });
    this.triggerRefresh();
    return res;
  }

  public exportCsv(input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return this.api.tags.exportCsv.mutate(input);
  }

  /** §9.1 Tags admin / §9.2 Issues admin — the full unpaginated list. */
  public getAdminList(
    type: 'tag' | 'issue',
    campaignId?: string | null,
  ): Promise<RouterOutputs['tags']['getAdminList']> {
    // The campaign decides which boundary map the per-row "top area" is ranked against;
    // without it the backend falls back to the workspace's newest seat-area map.
    return this.api.tags.getAdminList.query({ type, campaignId: campaignId ?? undefined });
  }

  /** §9.2 Issues admin sentence: unique people, not total applications. */
  public countDistinctPeople(type: 'tag' | 'issue'): Promise<RouterOutputs['tags']['countDistinctPeople']> {
    return this.api.tags.countDistinctPeople.query({ type });
  }

  public async rename(id: string, newName: string): Promise<RouterOutputs['tags']['rename']> {
    const res = await this.api.tags.rename.mutate({ id, newName });
    this.triggerRefresh();
    return res;
  }

  public async merge(sourceId: string, targetId: string): Promise<RouterOutputs['tags']['merge']> {
    const res = await this.api.tags.merge.mutate({ sourceId, targetId });
    this.triggerRefresh();
    return res;
  }
}
