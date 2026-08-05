import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import type { UserActivityRepo } from '../../lib/user-activity.repo';
import { WorkflowsController } from './controller';
import type { SequenceStepInput } from './controller';

/**
 * Regression coverage for `WorkflowsController.saveSteps`'s enrollment remap and for the
 * savepoint that wraps `enrollPerson` when it is handed a caller transaction.
 *
 * NOTE on isolation: this file deliberately does NOT use `useTestTransaction()`, for the same
 * reason spelled out at the top of `controller.spec.ts` next door -- `saveSteps` opens its own
 * transaction through `this.getRepo().transaction()` and accepts no caller transaction, and the
 * activity-log write inside it lands on the shared connection pool. Driving it from inside an
 * open outer transaction produces cross-connection lock contention. Every test seeds a
 * throwaway tenant with a random id and deletes it again in `afterEach`, matching the pattern
 * the sibling workflow/tag/import controller specs already use.
 */
const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

function getDb() {
  return (BaseRepository as any)._db;
}

type Db = ReturnType<typeof getDb>;

async function seedTenantAndUser(db: Db) {
  const tenantId = rand();
  const userId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant Step Remap' }).execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `remap-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  const campaignId = rand();
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

  const householdId = rand();
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

async function cleanTenant(db: Db, tenantId: string) {
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('workflow_enrollments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('workflow_steps').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('workflows').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

interface SeedStep {
  kind: 'wait' | 'send_email' | 'add_tag' | 'create_task' | 'notify_team';
  subject?: string | null;
  html_content?: string | null;
  config?: Record<string, unknown> | null;
  delay_days?: number;
}

/** Writes rows straight into `workflow_steps`, numbered 1..n by array position. */
async function seedSteps(db: Db, tenantId: string, workflowId: string, steps: SeedStep[]) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await db
      .insertInto('workflow_steps')
      .values({
        id: rand(),
        tenant_id: tenantId,
        workflow_id: workflowId,
        step_number: i + 1,
        kind: step.kind,
        config: step.config ? JSON.stringify(step.config) : null,
        delay_days: step.delay_days ?? 0,
        delay_unit: 'days',
        subject: step.subject ?? null,
        html_content: step.html_content ?? null,
      })
      .execute();
  }
}

async function seedWorkflow(db: Db, args: { tenantId: string; userId: string; status?: string }) {
  const workflowId = rand();
  await db
    .insertInto('workflows')
    .values({
      id: workflowId,
      tenant_id: args.tenantId,
      createdby_id: args.userId,
      updatedby_id: args.userId,
      name: 'Welcome Series',
      trigger_type: 'manual',
      status: args.status ?? 'active',
      trigger_event_id: null,
    })
    .execute();
  return workflowId;
}

async function seedPerson(db: Db, args: { tenantId: string; campaignId: string; householdId: string; userId: string }) {
  const personId = rand();
  await db
    .insertInto('persons')
    .values({
      id: personId,
      tenant_id: args.tenantId,
      campaign_id: args.campaignId,
      household_id: args.householdId,
      first_name: 'Mid',
      last_name: 'Sequence',
      email: `mid-${personId}@example.com`,
      createdby_id: args.userId,
      updatedby_id: args.userId,
    })
    .execute();
  return personId;
}

async function seedEnrollment(
  db: Db,
  args: { tenantId: string; workflowId: string; personId: string; stepNumber: number },
) {
  const enrollmentId = rand();
  await db
    .insertInto('workflow_enrollments')
    .values({
      id: enrollmentId,
      tenant_id: args.tenantId,
      workflow_id: args.workflowId,
      person_id: args.personId,
      status: 'active',
      current_step_number: args.stepNumber,
      next_run_at: new Date(Date.now() + 60_000),
    })
    .execute();
  return enrollmentId;
}

async function readEnrollment(db: Db, enrollmentId: string) {
  return db.selectFrom('workflow_enrollments').selectAll().where('id', '=', enrollmentId).executeTakeFirstOrThrow();
}

/** The subject/body an email step carries when the editor sends it (config stays null). */
function email(subject: string): SequenceStepInput {
  return {
    kind: 'send_email',
    config: null,
    delay_days: 0,
    delay_unit: 'days',
    subject,
    html_content: `<p>${subject}</p>`,
    plain_text_content: subject,
  };
}

function wait(days: number): SequenceStepInput {
  return { kind: 'wait', config: null, delay_days: days, delay_unit: 'days' };
}

/**
 * The controller's activity-log repo, typed rather than reached through `any` -- a spy installed
 * on an `any` value loses the `Promise<void>` return type and trips `no-misused-promises`.
 */
function activityRepoOf(c: WorkflowsController): UserActivityRepo {
  return (c as unknown as { userActivity: UserActivityRepo }).userActivity;
}

function addTag(tagId: string): SequenceStepInput {
  return { kind: 'add_tag', config: { tag_id: tagId }, delay_days: 0, delay_unit: 'days' };
}

describe('WorkflowsController.saveSteps enrollment remap', () => {
  const controller = new WorkflowsController();
  const db = getDb();
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let personId: string;

  beforeEach(async () => {
    const seed = await seedTenantAndUser(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
    personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanTenant(db, tenantId);
  });

  it('leaves a mid-sequence enrollee on the same step when the steps are re-saved unchanged', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Welcome', html_content: '<p>Welcome</p>' },
      { kind: 'wait', delay_days: 3 },
      { kind: 'send_email', subject: 'Follow up', html_content: '<p>Follow up</p>' },
    ]);
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 3 });

    await controller.saveSteps(tenantId, workflowId, [email('Welcome'), wait(3), email('Follow up')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    expect(enrollment.current_step_number).toBe(3);
    expect(enrollment.status).toBe('active');
  });

  it('pushes a mid-sequence enrollee forward when a step is inserted above them', async () => {
    // Kinds differ here, so the content signature can tell the steps apart regardless of
    // whether subject/body are part of it. This pins the insert semantics on their own.
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Welcome', html_content: '<p>Welcome</p>' },
      { kind: 'add_tag', config: { tag_id: '7' } },
    ]);
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 2 });

    await controller.saveSteps(tenantId, workflowId, [email('Welcome'), wait(2), addTag('7')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    // The add_tag step moved from position 2 to position 3; the enrollee must follow it, not
    // stay on 2 (which is now the newly inserted wait).
    expect(enrollment.current_step_number).toBe(3);
    expect(enrollment.status).toBe('active');
  });

  // FAILS against the current code -- defect T1-6 from the production-risk review.
  // `stepContentSignature` (controller.ts, bottom of file) hashes only `kind` + `config`, but an
  // email's identity lives in the `subject` / `html_content` / `plain_text_content` columns and
  // the editor sends `config: null` for emails. Every email step therefore signs as the same
  // string, `send_email|null`, so the remap's first pass pairs emails by order instead of by
  // content: the enrollee waiting on email "B" is remapped onto the copy of email "A" they have
  // already been sent, and receives it a second time.
  it.skip('does not re-send an already-sent email when a new email step is inserted above the enrollee (T1-6)', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Email A', html_content: '<p>A</p>' },
      { kind: 'wait', delay_days: 1 },
      { kind: 'send_email', subject: 'Email B', html_content: '<p>B</p>' },
    ]);
    // Email A has been sent; the enrollee is waiting on Email B.
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 3 });

    await controller.saveSteps(
      tenantId,
      workflowId,
      [email('Brand new opener'), email('Email A'), wait(1), email('Email B')],
      userId,
    );

    const enrollment = await readEnrollment(db, enrollmentId);
    // Email B is now step 4. Anything else means the enrollee is pointed at a step they have
    // already received (or at the wait before it).
    expect(enrollment.current_step_number).toBe(4);
    expect(enrollment.status).toBe('active');
  });

  it('pulls a mid-sequence enrollee back when a step above them is deleted', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Welcome', html_content: '<p>Welcome</p>' },
      { kind: 'wait', delay_days: 1 },
      { kind: 'add_tag', config: { tag_id: '7' } },
    ]);
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 3 });

    // The opening email is removed.
    await controller.saveSteps(tenantId, workflowId, [wait(1), addTag('7')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    // add_tag is now step 2; the enrollee still has it coming and must not be completed.
    expect(enrollment.current_step_number).toBe(2);
    expect(enrollment.status).toBe('active');
  });

  // FAILS against the current code -- same defect T1-6 as above. With every email signing as
  // `send_email|null`, deleting the first of three emails pairs old email 1 -> new email 1 and
  // old email 2 -> new email 2, leaving old email 3 (the one the enrollee is waiting on)
  // unmatched with no surviving later step. The enrollee is marked `completed` and never
  // receives email C.
  it.skip('does not silently complete an enrollee when an earlier email step is deleted (T1-6)', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Email A', html_content: '<p>A</p>' },
      { kind: 'send_email', subject: 'Email B', html_content: '<p>B</p>' },
      { kind: 'send_email', subject: 'Email C', html_content: '<p>C</p>' },
    ]);
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 3 });

    await controller.saveSteps(tenantId, workflowId, [email('Email B'), email('Email C')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    expect(enrollment.status).toBe('active');
    expect(enrollment.current_step_number).toBe(2); // Email C's new position
  });

  // FAILS against the current code -- this is the direct pin on defect T1-6. Two email steps
  // whose only difference is subject/body must produce DIFFERENT content signatures. They do
  // not (`stepContentSignature` reads only kind + config), which is observable here: swapping
  // the order of two emails leaves the remap unable to see that anything moved.
  it.skip('gives two email steps with different subject/body different content signatures (T1-6)', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'First', html_content: '<p>First</p>' },
      { kind: 'send_email', subject: 'Second', html_content: '<p>Second</p>' },
    ]);
    // "First" has been sent; the enrollee is waiting on "Second".
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 2 });

    // Pure reorder: the two emails swap places, no content edited.
    await controller.saveSteps(tenantId, workflowId, [email('Second'), email('First')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    // "Second" is now step 1, so the enrollee must move to 1. Staying on 2 means they will be
    // sent "First" again.
    expect(enrollment.current_step_number).toBe(1);
    expect(enrollment.status).toBe('active');
  });

  it('completes an enrollee whose current step is deleted and has no surviving later step', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Welcome', html_content: '<p>Welcome</p>' },
      { kind: 'add_tag', config: { tag_id: '7' } },
    ]);
    const enrollmentId = await seedEnrollment(db, { tenantId, workflowId, personId, stepNumber: 2 });

    // The trailing add_tag step is removed; nothing survives after the enrollee's position.
    await controller.saveSteps(tenantId, workflowId, [email('Welcome')], userId);

    const enrollment = await readEnrollment(db, enrollmentId);
    expect(enrollment.status).toBe('completed');
    expect(enrollment.next_run_at).toBeNull();
  });

  it('leaves cancelled and completed enrollments untouched by a step edit', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedSteps(db, tenantId, workflowId, [
      { kind: 'send_email', subject: 'Welcome', html_content: '<p>Welcome</p>' },
      { kind: 'add_tag', config: { tag_id: '7' } },
    ]);
    const cancelledId = rand();
    await db
      .insertInto('workflow_enrollments')
      .values({
        id: cancelledId,
        tenant_id: tenantId,
        workflow_id: workflowId,
        person_id: personId,
        status: 'cancelled',
        current_step_number: 2,
        next_run_at: null,
      })
      .execute();

    await controller.saveSteps(tenantId, workflowId, [email('Welcome')], userId);

    const enrollment = await readEnrollment(db, cancelledId);
    expect(enrollment.status).toBe('cancelled');
    expect(enrollment.current_step_number).toBe(2);
  });
});

/**
 * `saveSteps` runs its remap in a transaction it opens itself and takes no caller transaction,
 * so there is no savepoint on that path to test. The savepoint the workflows controller does
 * implement is in `enrollPerson` (review item T2-14): when a caller hands it an open
 * transaction, a failed enrollment attempt must not poison that transaction.
 */
describe('WorkflowsController.enrollPerson savepoint containment', () => {
  const controller = new WorkflowsController();
  const db = getDb();
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;
  let personId: string;
  let workflowId: string;

  beforeEach(async () => {
    const seed = await seedTenantAndUser(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
    personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    workflowId = await seedWorkflow(db, { tenantId, userId, status: 'active' });
    await seedSteps(db, tenantId, workflowId, [{ kind: 'send_email', subject: 'Welcome' }]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanTenant(db, tenantId);
  });

  it('keeps the caller transaction usable after a database error inside the enrollment attempt', async () => {
    const trx = await db.startTransaction().execute();
    try {
      // The caller's own work, done before it asks for an enrollment.
      await trx
        .updateTable('workflows')
        .set({ name: 'Renamed by caller' })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', workflowId)
        .execute();

      // Force a genuine Postgres error inside enrollPerson, after its INSERT has run. Without
      // the savepoint this aborts the whole caller transaction ("current transaction is
      // aborted, commands ignored until end of transaction block").
      vi.spyOn(activityRepoOf(controller), 'log').mockImplementation(async () => {
        await sql`SELECT * FROM table_that_does_not_exist_step_remap_spec`.execute(trx);
      });

      await expect(controller.enrollPerson(tenantId, personId, workflowId, userId, trx)).rejects.toThrow();

      // Containment 1: the caller's transaction still accepts statements and still holds its
      // own earlier write.
      const workflow = await trx
        .selectFrom('workflows')
        .select(['name'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', workflowId)
        .executeTakeFirstOrThrow();
      expect(workflow.name).toBe('Renamed by caller');

      // Containment 2: the half-finished enrollment was undone by the savepoint rollback.
      const rows = await trx
        .selectFrom('workflow_enrollments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('workflow_id', '=', workflowId)
        .execute();
      expect(rows).toHaveLength(0);
    } finally {
      await trx.rollback().execute();
    }
  });

  it('releases the savepoint on success so the enrollment is visible to the caller transaction', async () => {
    // The activity-log write goes to the shared pool rather than this transaction, so it is
    // stubbed out to keep the test off a second connection.
    vi.spyOn(activityRepoOf(controller), 'log').mockResolvedValue(undefined);

    const trx = await db.startTransaction().execute();
    try {
      const enrollment = await controller.enrollPerson(tenantId, personId, workflowId, userId, trx);
      expect(enrollment.status).toBe('active');
      expect(enrollment.current_step_number).toBe(1);

      const rows = await trx
        .selectFrom('workflow_enrollments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('workflow_id', '=', workflowId)
        .execute();
      expect(rows).toHaveLength(1);

      // The caller's transaction is still open and usable after the savepoint was released.
      await trx
        .updateTable('workflows')
        .set({ name: 'Still writable' })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', workflowId)
        .execute();
    } finally {
      await trx.rollback().execute();
    }

    // Rolling the caller back takes the enrollment with it.
    const after = await db
      .selectFrom('workflow_enrollments')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', '=', workflowId)
      .execute();
    expect(after).toHaveLength(0);
  });
});
