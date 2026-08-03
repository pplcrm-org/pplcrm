import type { AddTagType, IAuthKeyPayload, UpdateTagType } from '../../../../../../libs/common/src';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { TagsRepo, type TagAdminRow } from './repositories/tags.repo';
import type { OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';

export class TagsController extends BaseController<'tags', TagsRepo> {
  constructor() {
    super(new TagsRepo());
  }

  public async addTag(payload: AddTagType, auth: IAuthKeyPayload) {
    const row = {
      name: payload.name,
      description: payload.description,
      color: payload.color ?? null,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      type: payload.type ?? 'tag',
    };
    try {
      return await this.add(row as OperationDataType<'tags', 'insert'>);
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError('A tag with this name already exists.', undefined, { cause: err });
      }
      throw err;
    }
  }

  public async findByName(input: { name: string; type?: 'tag' | 'issue' }, auth: IAuthKeyPayload) {
    const type = input.type ?? 'tag';
    return this.getRepo().findByNameAndType({
      tenant_id: auth.tenant_id,
      name: input.name,
      type,
    });
  }

  public updateTag(id: string, row: UpdateTagType, auth: IAuthKeyPayload) {
    const rowWithUpdatedBy = {
      ...row,
      updatedby_id: auth.user_id,
    };
    return this.update({
      tenant_id: auth.tenant_id,
      id,
      row: rowWithUpdatedBy as OperationDataType<'tags', 'update'>,
    });
  }

  /** §9.1 Tags admin / §9.2 Issues admin: the full, unpaginated list with counts, last-applied,
   * creator, trend and top-ward — see `TagsRepo.getAdminList`. `campaignId` makes the top-area
   * column rank inside that campaign's own seat set, matching the campaign-worded heading. */
  public getAdminList(type: 'tag' | 'issue', auth: IAuthKeyPayload, campaignId?: string): Promise<TagAdminRow[]> {
    return this.getRepo().getAdminList({ tenant_id: auth.tenant_id, type, campaignId: campaignId ?? null });
  }

  /** §9.2 Issues admin sentence: "N people shared what they care about". */
  public countDistinctPeople(type: 'tag' | 'issue', auth: IAuthKeyPayload): Promise<number> {
    return this.getRepo().countDistinctPeople({ tenant_id: auth.tenant_id, type });
  }

  /** §9.1 footer contract: "Renames and merges apply everywhere a tag is referenced — people,
   * lists, automations and forms — in one pass." See `TagsRepo.renameTag` for what "everywhere"
   * covers today. */
  public async renameTag(id: string, newName: string, auth: IAuthKeyPayload) {
    try {
      const updated = await this.getRepo().renameTag({
        tenant_id: auth.tenant_id,
        id,
        new_name: newName,
        user_id: auth.user_id,
      });
      if (!updated) throw new NotFoundError('Tag not found.');
      return updated;
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new ConflictError('A tag with this name already exists.', undefined, { cause: err });
      }
      throw err;
    }
  }

  /** §9.1 "Move everyone to" — merge `sourceId` into `targetId`. */
  public async mergeTags(sourceId: string, targetId: string, auth: IAuthKeyPayload) {
    try {
      return await this.getRepo().mergeTags({
        tenant_id: auth.tenant_id,
        source_id: sourceId,
        target_id: targetId,
        user_id: auth.user_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Merge failed.';
      if (message === 'Source or target tag not found.') {
        throw new NotFoundError(message, undefined, { cause: err });
      }
      throw new BadRequestError(message, undefined, { cause: err });
    }
  }
}
