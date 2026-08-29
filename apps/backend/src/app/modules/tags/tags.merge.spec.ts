import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { TagsRepo } from './repositories/tags.repo';

/**
 * mergeTags used to load BOTH tags' entire memberships into JS Sets and re-point them one
 * INSERT round-trip per person/household inside one transaction — minutes of lock-holding for a
 * tag applied to tens of thousands of people. It is now one INSERT … SELECT … WHERE NOT EXISTS
 * plus one DELETE per mapping table. These tests pin the merge SEMANTICS the rewrite must
 * preserve: source-only members gain the target, overlapping members are not duplicated, no
 * source mapping survives, and the source tag row is gone.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('TagsRepo.mergeTags', () => {
  const repo = new TagsRepo();
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let sourceTagId: string;
  let targetTagId: string;
  let sourceOnlyPersonId: string;
  let bothTagsPersonId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    householdId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Tag Merge Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `merger-${userId}@example.com`,
        first_name: 'Merger',
        last_name: 'Person',
        verified: true,
        role: 'user',
        password: 'not-a-real-hash',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const sourceTag = await db
      .insertInto('tags')
      .values({ tenant_id: tenantId, name: 'merge-source', createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    sourceTagId = String(sourceTag.id);
    const targetTag = await db
      .insertInto('tags')
      .values({ tenant_id: tenantId, name: 'merge-target', createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    targetTagId = String(targetTag.id);

    const sourceOnly = await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'SourceOnly',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    sourceOnlyPersonId = String(sourceOnly.id);
    const both = await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'BothTags',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    bothTagsPersonId = String(both.id);

    const personTagRows = [
      { person_id: sourceOnlyPersonId, tag_id: sourceTagId },
      { person_id: bothTagsPersonId, tag_id: sourceTagId },
      { person_id: bothTagsPersonId, tag_id: targetTagId },
    ];
    for (const row of personTagRows) {
      await db
        .insertInto('map_peoples_tags')
        .values({ tenant_id: tenantId, ...row, createdby_id: userId, updatedby_id: userId })
        .execute();
    }
    // The household carries only the source tag.
    await db
      .insertInto('map_households_tags')
      .values({
        tenant_id: tenantId,
        household_id: householdId,
        tag_id: sourceTagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_households_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function personTagRows(): Promise<Array<{ person_id: string; tag_id: string }>> {
    const rows = await db
      .selectFrom('map_peoples_tags')
      .select(['person_id', 'tag_id'])
      .where('tenant_id', '=', tenantId)
      .execute();
    return rows.map((r: { person_id: unknown; tag_id: unknown }) => ({
      person_id: String(r.person_id),
      tag_id: String(r.tag_id),
    }));
  }

  it('re-points source-only members, deduplicates overlapping members, and drops the source tag', async () => {
    const survivor = await repo.mergeTags({
      tenant_id: tenantId,
      source_id: sourceTagId,
      target_id: targetTagId,
      user_id: userId,
    });
    expect(String(survivor?.id)).toBe(targetTagId);

    const rows = await personTagRows();
    // Source-only person now carries the target; the person who had both keeps exactly ONE row.
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { person_id: sourceOnlyPersonId, tag_id: targetTagId },
        { person_id: bothTagsPersonId, tag_id: targetTagId },
      ]),
    );

    const householdRows = await db
      .selectFrom('map_households_tags')
      .select(['household_id', 'tag_id'])
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(householdRows).toHaveLength(1);
    expect(String(householdRows[0].tag_id)).toBe(targetTagId);

    const sourceTag = await db
      .selectFrom('tags')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', sourceTagId)
      .executeTakeFirst();
    expect(sourceTag).toBeUndefined();
  });

  it('merging is idempotent-safe when the source has no members beyond the overlap', async () => {
    // Remove the source-only mapping so every source member already carries the target.
    await db
      .deleteFrom('map_peoples_tags')
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', sourceOnlyPersonId)
      .execute();

    await repo.mergeTags({
      tenant_id: tenantId,
      source_id: sourceTagId,
      target_id: targetTagId,
      user_id: userId,
    });

    const rows = await personTagRows();
    expect(rows).toEqual([{ person_id: bothTagsPersonId, tag_id: targetTagId }]);
  });

  it('refuses to merge a tag into itself', async () => {
    await expect(
      repo.mergeTags({ tenant_id: tenantId, source_id: sourceTagId, target_id: sourceTagId, user_id: userId }),
    ).rejects.toThrow('Cannot merge a tag into itself.');
  });
});
