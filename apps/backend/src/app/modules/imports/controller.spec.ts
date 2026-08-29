import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ImportsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import type { IAuthKeyPayload } from '@common';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  // 1. Tenant
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant',
    })
    .execute();

  // 2. User
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // 3. Campaign
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Test Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // 4. Household
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

  // Update tenant admin, creator, and placeholder household
  await db
    .updateTable('tenants')
    .set({
      admin_id: userId,
      createdby_id: userId,
      placeholder_household_id: householdId,
    })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();

  await db.deleteFrom('task_subtasks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('task_comments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('task_attachments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tasks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companies').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('data_imports').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('ImportsController Delete Import logic', () => {
  const controller = new ImportsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;

    auth = {
      tenant_id: tenantId,
      user_id: userId,
      name: 'Test User',
      session_id: 'test-session',
    };
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should list imports with correct counts', async () => {
    const importId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('data_imports')
      .values({
        id: importId,
        tenant_id: tenantId,
        file_name: 'test.csv',
        source: 'people',
        row_count: 5,
        inserted_count: 5,
        error_count: 0,
        skipped_count: 0,
        households_created: 1,
        status: 'completed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Add a person linked to this import
    const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Test Person',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Add a company linked to this import
    const companyId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: companyId,
        tenant_id: tenantId,
        name: 'Test Company',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Add a task linked to this import
    const taskId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        tenant_id: tenantId,
        name: 'Test Task',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const listResult = await controller.list(auth);
    const item = listResult.find((i) => i.id === importId);
    expect(item).toBeDefined();
    expect(item?.contactCount).toBe(1);
    expect(item?.companyCount).toBe(1);
    expect(item?.taskCount).toBe(1);
  });

  it('should delete import and clean up persons/households/companies/tasks selectively', async () => {
    const importId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('data_imports')
      .values({
        id: importId,
        tenant_id: tenantId,
        file_name: 'test.csv',
        source: 'all',
        row_count: 10,
        inserted_count: 10,
        error_count: 0,
        skipped_count: 0,
        households_created: 1,
        status: 'completed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Seed a specific household
    const importHouseholdId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: importHouseholdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Seed a person linked to import and company
    const companyId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: companyId,
        tenant_id: tenantId,
        name: 'Delete Me Company',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: importHouseholdId,
        first_name: 'Delete Me Person',
        file_id: importId,
        company_id: companyId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Seed a task with subtask, comment, and attachment
    const taskId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        tenant_id: tenantId,
        name: 'Delete Me Task',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('task_subtasks')
      .values({
        id: String(Math.floor(Math.random() * 100000000) + 10000000),
        tenant_id: tenantId,
        task_id: taskId,
        name: 'Subtask',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('task_comments')
      .values({
        id: String(Math.floor(Math.random() * 100000000) + 10000000),
        tenant_id: tenantId,
        task_id: taskId,
        author_id: userId,
        comment: 'Comment',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('task_attachments')
      .values({
        id: String(Math.floor(Math.random() * 100000000) + 10000000),
        tenant_id: tenantId,
        task_id: taskId,
        filename: 'Attachment.txt',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Perform deletion with all options set to true
    const deleteResult = await controller.deleteImport(
      {
        id: importId,
        deletePeople: true,
        deleteHouseholds: true,
        deleteCompanies: true,
        deleteTasks: true,
      },
      auth,
    );

    expect(deleteResult.deleted).toBe(true);

    // Verify all seeded records were deleted
    const importInDb = await db.selectFrom('data_imports').selectAll().where('id', '=', importId).executeTakeFirst();
    expect(importInDb).toBeUndefined();

    const personInDb = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(personInDb).toBeUndefined();

    const householdInDb = await db
      .selectFrom('households')
      .selectAll()
      .where('id', '=', importHouseholdId)
      .executeTakeFirst();
    expect(householdInDb).toBeUndefined();

    const companyInDb = await db.selectFrom('companies').selectAll().where('id', '=', companyId).executeTakeFirst();
    expect(companyInDb).toBeUndefined();

    const taskInDb = await db.selectFrom('tasks').selectAll().where('id', '=', taskId).executeTakeFirst();
    expect(taskInDb).toBeUndefined();

    // Verify subtasks, comments, attachments were cascades deleted
    const subtaskInDb = await db
      .selectFrom('task_subtasks')
      .selectAll()
      .where('task_id', '=', taskId)
      .executeTakeFirst();
    expect(subtaskInDb).toBeUndefined();
  });

  it('deletes only the import`s own people and mappings — other records and their mappings survive', async () => {
    // The undo used to materialize every imported id into JS and bind it into IN (…) lists,
    // which failed outright past 65,535 rows. It now deletes by `file_id` predicates and
    // IN (SELECT …) semi-joins; this test pins the SCOPE of those predicates: a person from the
    // import goes (with their tag/list mappings), a person outside the import stays untouched.
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const importId = rand();
    await db
      .insertInto('data_imports')
      .values({
        id: importId,
        tenant_id: tenantId,
        file_name: 'test.csv',
        source: 'people',
        row_count: 1,
        inserted_count: 1,
        error_count: 0,
        skipped_count: 0,
        households_created: 0,
        status: 'completed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const importedPersonId = rand();
    const keptPersonId = rand();
    for (const [id, name, fileId] of [
      [importedPersonId, 'Imported Person', importId],
      [keptPersonId, 'Kept Person', null],
    ] as const) {
      await db
        .insertInto('persons')
        .values({
          id,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: name,
          file_id: fileId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    const tagId = rand();
    await db
      .insertInto('tags')
      .values({
        id: tagId,
        tenant_id: tenantId,
        name: `undo-scope-${tagId}`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    for (const personId of [importedPersonId, keptPersonId]) {
      await db
        .insertInto('map_peoples_tags')
        .values({ tenant_id: tenantId, person_id: personId, tag_id: tagId, createdby_id: userId, updatedby_id: userId })
        .execute();
    }

    const listId = rand();
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: `Undo Scope List ${listId}`,
        object: 'people',
        is_dynamic: false,
        definition: JSON.stringify({}),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    for (const personId of [importedPersonId, keptPersonId]) {
      await db
        .insertInto('map_lists_persons')
        .values({
          tenant_id: tenantId,
          list_id: listId,
          person_id: personId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    await controller.deleteImport({ id: importId, deletePeople: true }, auth);

    const remainingPersons = await db
      .selectFrom('persons')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', [importedPersonId, keptPersonId])
      .execute();
    expect(remainingPersons.map((r: { id: unknown }) => String(r.id))).toEqual([keptPersonId]);

    const remainingTagMaps = await db
      .selectFrom('map_peoples_tags')
      .select('person_id')
      .where('tenant_id', '=', tenantId)
      .where('tag_id', '=', tagId)
      .execute();
    expect(remainingTagMaps.map((r: { person_id: unknown }) => String(r.person_id))).toEqual([keptPersonId]);

    const remainingListMaps = await db
      .selectFrom('map_lists_persons')
      .select('person_id')
      .where('tenant_id', '=', tenantId)
      .where('list_id', '=', listId)
      .execute();
    expect(remainingListMaps.map((r: { person_id: unknown }) => String(r.person_id))).toEqual([keptPersonId]);

    // Local cleanup for rows this test added beyond cleanTenant's coverage.
    await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  });

  it('should only clear file_id when deleting import without checkboxes checked', async () => {
    const importId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('data_imports')
      .values({
        id: importId,
        tenant_id: tenantId,
        file_name: 'test.csv',
        source: 'all',
        row_count: 10,
        inserted_count: 10,
        error_count: 0,
        skipped_count: 0,
        households_created: 1,
        status: 'completed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const companyId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: companyId,
        tenant_id: tenantId,
        name: 'Keep Me Company',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const taskId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        tenant_id: tenantId,
        name: 'Keep Me Task',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Perform deletion with all options set to false
    await controller.deleteImport(
      {
        id: importId,
        deletePeople: false,
        deleteHouseholds: false,
        deleteCompanies: false,
        deleteTasks: false,
      },
      auth,
    );

    // Verify import is deleted
    const importInDb = await db.selectFrom('data_imports').selectAll().where('id', '=', importId).executeTakeFirst();
    expect(importInDb).toBeUndefined();

    // Verify company is NOT deleted, but file_id is null
    const companyInDb = await db.selectFrom('companies').selectAll().where('id', '=', companyId).executeTakeFirst();
    expect(companyInDb).toBeDefined();
    expect(companyInDb.file_id).toBeNull();

    // Verify task is NOT deleted, but file_id is null
    const taskInDb = await db.selectFrom('tasks').selectAll().where('id', '=', taskId).executeTakeFirst();
    expect(taskInDb).toBeDefined();
    expect(taskInDb.file_id).toBeNull();
  });
});
