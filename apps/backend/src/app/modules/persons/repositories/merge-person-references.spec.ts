import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { PersonsRepo } from './persons.repo';

/**
 * Merging two people deletes the source row. Anything still pointing at it either gets
 * nulled by the database (the `ON DELETE SET NULL` foreign keys), gets deleted with it
 * (`ON DELETE CASCADE`), or — for the columns that name a person but carry no foreign
 * key at all — silently keeps an id that no longer exists. `mergePersons` has to move
 * every one of those to the surviving person, and the last test in this file is the
 * tripwire that notices when a new column shows up and nobody did.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
  householdId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createSeed(db: any): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Merge Refs Tenant' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `merge-refs-${userId}@example.com`,
      password: 'password',
      first_name: 'Merge',
      last_name: 'Refs',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Merge Refs Campaign',
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

  return { tenantId, userId, campaignId, householdId };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanTenant(db: any, tenantId: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  for (const table of [
    'companion_approval_tokens',
    'companion_sessions',
    'companion_volunteers',
    'turf_segment_claims',
    'turf_assignments',
    'turfs',
    'workflow_runs',
    'workflows',
    'tasks',
    'potential_duplicates',
    'persons',
    'households',
    'campaigns',
    'sessions',
    'authusers',
  ]) {
    await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('mergePersons re-points everything that names the source person', () => {
  const repo = new PersonsRepo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (BaseRepository as any)._db;
  let seed: Seed;

  const addPerson = async (firstName: string): Promise<{ id: string }> =>
    repo.add({
      row: {
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: seed.householdId,
        first_name: firstName,
        last_name: 'Duplicate',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      },
    });

  // companion_volunteers, companion_sessions, workflow_runs and turf_segment_claims all
  // declare `id` as GENERATED ALWAYS AS IDENTITY, so the database has to hand out the id.
  const addVolunteer = async (personId: string, status: string): Promise<string> => {
    const row = await db
      .insertInto('companion_volunteers')
      .values({
        tenant_id: seed.tenantId,
        person_id: personId,
        status,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const addSession = async (volunteerId: string): Promise<string> => {
    const row = await db
      .insertInto('companion_sessions')
      .values({
        tenant_id: seed.tenantId,
        volunteer_id: volunteerId,
        token_hash: `session-${volunteerId}-${rand()}`,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const addTurf = async (): Promise<string> => {
    const id = rand();
    await db
      .insertInto('turfs')
      .values({
        id,
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        name: `Turf ${id}`,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    return id;
  };

  const addAssignment = async (turfId: string, personId: string, status: string): Promise<string> => {
    const id = rand();
    await db
      .insertInto('turf_assignments')
      .values({
        id,
        tenant_id: seed.tenantId,
        turf_id: turfId,
        volunteer_person_id: personId,
        token_hash: `hash-${id}`,
        status,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    return id;
  };

  beforeEach(async () => {
    seed = await createSeed(db);
  });

  afterEach(async () => {
    await cleanTenant(db, seed.tenantId);
  });

  it('moves the source person tasks to the target instead of leaving them with no person', async () => {
    const target = await addPerson('Target');
    const source = await addPerson('Source');

    const taskId = rand();
    await db
      .insertInto('tasks')
      .values({
        id: taskId,
        tenant_id: seed.tenantId,
        name: 'Call about the yard sign',
        person_id: source.id,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();

    await repo.mergePersons({
      tenant_id: seed.tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: seed.userId,
    });

    const task = await db
      .selectFrom('tasks')
      .select(['person_id'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', taskId)
      .executeTakeFirst();

    expect(task).toBeDefined();
    expect(task.person_id).not.toBeNull();
    expect(String(task.person_id)).toBe(String(target.id));
  });

  it('moves workflow run history and street claims, which no foreign key would have protected', async () => {
    const target = await addPerson('Target');
    const source = await addPerson('Source');

    const workflowId = rand();
    await db
      .insertInto('workflows')
      .values({
        id: workflowId,
        tenant_id: seed.tenantId,
        name: 'Welcome sequence',
        trigger_type: 'manual',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    const run = await db
      .insertInto('workflow_runs')
      .values({
        tenant_id: seed.tenantId,
        workflow_id: workflowId,
        person_id: source.id,
        status: 'success',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const runId = String(run.id);

    const turfId = await addTurf();
    const assignmentId = await addAssignment(turfId, source.id, 'active');
    const claim = await db
      .insertInto('turf_segment_claims')
      .values({
        tenant_id: seed.tenantId,
        turf_id: turfId,
        assignment_id: assignmentId,
        volunteer_person_id: source.id,
        street_key: 'scott blvd',
        street_label: 'Scott Blvd',
        canvasser_name: 'Source Duplicate',
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const claimId = String(claim.id);

    await repo.mergePersons({
      tenant_id: seed.tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: seed.userId,
    });

    const mergedRun = await db
      .selectFrom('workflow_runs')
      .select(['person_id'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', runId)
      .executeTakeFirst();
    expect(String(mergedRun.person_id)).toBe(String(target.id));

    const mergedClaim = await db
      .selectFrom('turf_segment_claims')
      .select(['volunteer_person_id'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', claimId)
      .executeTakeFirst();
    expect(String(mergedClaim.volunteer_person_id)).toBe(String(target.id));

    const assignment = await db
      .selectFrom('turf_assignments')
      .select(['volunteer_person_id', 'status'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', assignmentId)
      .executeTakeFirst();
    expect(String(assignment.volunteer_person_id)).toBe(String(target.id));
    expect(assignment.status).toBe('active');
  });

  it('moves the companion volunteer row when only the source person is a volunteer', async () => {
    const target = await addPerson('Target');
    const source = await addPerson('Source');
    const volunteerId = await addVolunteer(source.id, 'approved');
    await addSession(volunteerId);

    await repo.mergePersons({
      tenant_id: seed.tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: seed.userId,
    });

    const rows = await db
      .selectFrom('companion_volunteers')
      .select(['id', 'person_id', 'status'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toBe(String(volunteerId));
    expect(String(rows[0].person_id)).toBe(String(target.id));
    expect(rows[0].status).toBe('approved');

    // The row moved rather than being recreated, so the volunteer's verified device
    // still resolves and they are not asked for a code again.
    const sessions = await db
      .selectFrom('companion_sessions')
      .select(['volunteer_id'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    expect(sessions).toHaveLength(1);
    expect(String(sessions[0].volunteer_id)).toBe(String(volunteerId));
  });

  it('keeps exactly one companion volunteer row, the target one, when both people are volunteers', async () => {
    const target = await addPerson('Target');
    const source = await addPerson('Source');
    // The target is the more restrictive of the two: a merge must not turn an invitation
    // that was never approved into approved companion access.
    const targetVolunteerId = await addVolunteer(target.id, 'invited');
    const sourceVolunteerId = await addVolunteer(source.id, 'approved');
    await addSession(sourceVolunteerId);

    // Without the collision handling this throws on uq_companion_volunteers_person.
    await repo.mergePersons({
      tenant_id: seed.tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: seed.userId,
    });

    const rows = await db
      .selectFrom('companion_volunteers')
      .select(['id', 'person_id', 'status'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();

    expect(rows).toHaveLength(1);
    expect(String(rows[0].id)).toBe(String(targetVolunteerId));
    expect(String(rows[0].person_id)).toBe(String(target.id));
    expect(rows[0].status).toBe('invited');

    // Nothing is left naming the volunteer row that was dropped.
    const sessions = await db
      .selectFrom('companion_sessions')
      .select(['id'])
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    expect(sessions).toHaveLength(0);
  });

  it('revokes rather than duplicates the source turf assignment when both walk the same turf', async () => {
    const target = await addPerson('Target');
    const source = await addPerson('Source');
    const sharedTurf = await addTurf();
    const otherTurf = await addTurf();

    const targetAssignment = await addAssignment(sharedTurf, target.id, 'active');
    const sourceCollidingAssignment = await addAssignment(sharedTurf, source.id, 'active');
    const sourceOtherAssignment = await addAssignment(otherTurf, source.id, 'active');

    // Without the collision handling this throws on uq_turf_assignments_active_volunteer.
    await repo.mergePersons({
      tenant_id: seed.tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: seed.userId,
    });

    const byId = new Map<string, { volunteer_person_id: string; status: string }>(
      (
        await db
          .selectFrom('turf_assignments')
          .select(['id', 'volunteer_person_id', 'status'])
          .where('tenant_id', '=', seed.tenantId)
          .execute()
      ).map((r: { id: string; volunteer_person_id: string; status: string }) => [String(r.id), r]),
    );

    expect(byId.get(String(targetAssignment))?.status).toBe('active');
    // The duplicate is kept as history, not deleted, and is no longer active.
    expect(byId.get(String(sourceCollidingAssignment))?.status).toBe('revoked');
    expect(String(byId.get(String(sourceCollidingAssignment))?.volunteer_person_id)).toBe(String(target.id));
    // The non-colliding one stays live under the surviving person.
    expect(byId.get(String(sourceOtherAssignment))?.status).toBe('active');
    expect(String(byId.get(String(sourceOtherAssignment))?.volunteer_person_id)).toBe(String(target.id));
  });

  /**
   * Columns deliberately left alone by the merge. Each needs a reason, because the
   * default answer for a column that names a person is "re-point it".
   */
  const NOT_RE_POINTED: Record<string, string> = {
    'potential_duplicates.person_id':
      'Duplicate-detection scratch data, ON DELETE CASCADE on purpose. The groups are ' +
      'recomputed by DuplicateMaintenanceService after the merge, so carrying stale rows ' +
      'across would be worse than losing them.',
  };

  it('fails when a new column names a person and the merge was not taught about it', async () => {
    // Deliberately NOT a foreign-key audit. companion_volunteers.person_id,
    // workflow_runs.person_id, turf_assignments.volunteer_person_id and
    // turf_segment_claims.volunteer_person_id all name a person with no foreign key at
    // all, so a constraint-only sweep sees none of them. Match on the column NAME, and
    // take the foreign keys as well so a differently-named one (teams.team_captain_id)
    // is still covered.
    const columns = await sql<{ table_name: string; column_name: string }>`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
         AND t.table_type = 'BASE TABLE'
       WHERE c.table_schema = 'public'
         AND c.column_name LIKE '%person_id'
      UNION
      SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.constraint_schema = tc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND ccu.table_name = 'persons'
         AND kcu.table_name <> 'persons'
       ORDER BY 1, 2
    `.execute(db);

    const source = readFileSync(join(__dirname, 'persons.repo.ts'), 'utf8');
    const markerIndex = source.indexOf('public async mergePersons');
    expect(markerIndex, 'mergePersons was renamed — this guard test can no longer find it').toBeGreaterThan(-1);
    const mergeBody = source.slice(markerIndex);

    const unhandled = columns.rows
      .filter((row) => {
        if (NOT_RE_POINTED[`${row.table_name}.${row.column_name}`]) return false;
        return !new RegExp(`['"\`]${row.table_name}['"\`]`).test(mergeBody);
      })
      .map((row) => `${row.table_name}.${row.column_name}`);

    expect(
      unhandled,
      [
        `These columns name a person but mergePersons() never mentions their table:`,
        `  ${unhandled.join('\n  ')}`,
        ``,
        `Merging two people hard-deletes the source person row, so each of these either`,
        `becomes null, is cascade-deleted, or (when there is no foreign key) keeps pointing`,
        `at a row that no longer exists. Pick one and do it in`,
        `apps/backend/src/app/modules/persons/repositories/persons.repo.ts:`,
        ``,
        `  1. No per-person uniqueness -> add a plain UPDATE ... SET <col> = target`,
        `     alongside donations/tasks/workflow_runs in step 6.`,
        `  2. Unique or partial-unique on the person -> follow campaign_person_facts or`,
        `     companion_volunteers in step 7: decide which row survives a collision,`,
        `     drop or revoke the other, then re-point the rest.`,
        `  3. Genuinely fine to lose -> add it to NOT_RE_POINTED in this file WITH the`,
        `     reason, the way potential_duplicates.person_id is documented.`,
        ``,
        `Every statement must carry .where('tenant_id', ...) and stay inside the merge`,
        `transaction. Add a case to this spec file for whichever branch you picked.`,
      ].join('\n'),
    ).toEqual([]);
  });
});
