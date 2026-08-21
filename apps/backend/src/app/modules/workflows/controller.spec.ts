import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { WorkflowsController } from './controller';

// NOTE on useTestTransaction(): WorkflowsController.enrollPerson (and, transitively,
// triggerWorkflow/triggerTagAdded) always logs user activity through the module-level
// DB singleton -- the trx it's given is never forwarded to userActivity.log (see
// controller.ts's `executeLogic`, which checks `typeof (t as any).transaction ===
// 'undefined'`; both a `Transaction` and a `Kysely` instance expose `.transaction()`,
// so that check is always false and the activity-log write always lands on the real
// connection pool). Mixing an open `useTestTransaction()` transaction with that
// singleton-pool write produces cross-connection FK lock contention (the activity
// log's FK lookups on `authusers`/`tenants` block on -- and can deadlock against --
// row locks held by the still-open outer transaction). To keep this spec reliable,
// every test here uses the same manual seed/cleanup pattern as the other controller
// specs in this module set (e.g. tags/controller.spec.ts, imports/controller.spec.ts)
// instead of forcing trx-based isolation.
const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

function getDb() {
  return (BaseRepository as any)._db;
}

async function seedTenantAndUser(db: ReturnType<typeof getDb>) {
  const tenantId = rand();
  const userId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant Workflows' }).execute();

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

async function cleanTenant(db: ReturnType<typeof getDb>, tenantId: string) {
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

async function seedPerson(
  db: ReturnType<typeof getDb>,
  args: { tenantId: string; campaignId: string; householdId: string; userId: string },
) {
  const personId = rand();
  await db
    .insertInto('persons')
    .values({
      id: personId,
      tenant_id: args.tenantId,
      campaign_id: args.campaignId,
      household_id: args.householdId,
      first_name: 'Wanda',
      last_name: 'Worker',
      email: `wanda-${personId}@example.com`,
      createdby_id: args.userId,
      updatedby_id: args.userId,
    })
    .execute();
  return personId;
}

async function seedWorkflow(
  db: ReturnType<typeof getDb>,
  args: { tenantId: string; userId: string; triggerType?: string; status?: string; triggerEventId?: string | null },
) {
  const workflowId = rand();
  await db
    .insertInto('workflows')
    .values({
      id: workflowId,
      tenant_id: args.tenantId,
      createdby_id: args.userId,
      updatedby_id: args.userId,
      name: 'Test Workflow',
      trigger_type: args.triggerType ?? 'manual',
      status: args.status ?? 'active',
      trigger_event_id: args.triggerEventId ?? null,
    })
    .execute();
  return workflowId;
}

async function seedStep(
  db: ReturnType<typeof getDb>,
  args: { tenantId: string; workflowId: string; stepNumber?: number; delayDays?: number },
) {
  const stepId = rand();
  await db
    .insertInto('workflow_steps')
    .values({
      id: stepId,
      tenant_id: args.tenantId,
      workflow_id: args.workflowId,
      step_number: args.stepNumber ?? 1,
      kind: 'send_email',
      config: null,
      delay_days: args.delayDays ?? 0,
      delay_unit: 'days',
      subject: 'Follow up',
    })
    .execute();
  return stepId;
}

describe('WorkflowsController Integration', () => {
  const controller = new WorkflowsController();
  const db = getDb();
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  beforeEach(async () => {
    const seed = await seedTenantAndUser(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should return steps ordered by step_number with stringified ids', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedStep(db, { tenantId, workflowId, stepNumber: 2, delayDays: 2 });
    await seedStep(db, { tenantId, workflowId, stepNumber: 1, delayDays: 0 });

    const steps = await controller.getSteps(tenantId, workflowId);

    expect(steps).toHaveLength(2);
    expect(steps[0].step_number).toBe(1);
    expect(steps[1].step_number).toBe(2);
    expect(steps[0].id).toBeTypeOf('string');
    expect(steps[0].workflow_id).toBe(workflowId);
  });

  it('should enroll a person in a workflow starting at the first step', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedStep(db, { tenantId, workflowId, stepNumber: 1, delayDays: 1 });

    const enrollment = await controller.enrollPerson(tenantId, personId, workflowId, userId);

    expect(enrollment.id).toBeTypeOf('string');
    expect(enrollment.workflow_id).toBe(workflowId);
    expect(enrollment.person_id).toBe(personId);
    expect(enrollment.status).toBe('active');
    expect(enrollment.current_step_number).toBe(1);
    expect(enrollment.next_run_at).toBeDefined();
  });

  it('should throw NOT_FOUND when enrolling a person that does not exist', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedStep(db, { tenantId, workflowId });

    await expect(controller.enrollPerson(tenantId, '999999999', workflowId, userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Person not found.',
    });
  });

  it('should throw NOT_FOUND when enrolling into a workflow that does not exist', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });

    await expect(controller.enrollPerson(tenantId, personId, '999999999', userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workflow not found.',
    });
  });

  it('should throw BAD_REQUEST when the person is already actively enrolled', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedStep(db, { tenantId, workflowId });

    await controller.enrollPerson(tenantId, personId, workflowId, userId);

    await expect(controller.enrollPerson(tenantId, personId, workflowId, userId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'This person is already enrolled in this workflow.',
    });
  });

  it('should throw BAD_REQUEST when the workflow has no steps', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });

    await expect(controller.enrollPerson(tenantId, personId, workflowId, userId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'This workflow does not have any steps yet.',
    });
  });

  it('should enroll a matching person when triggerWorkflow finds an active workflow with no event filter', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId, triggerType: 'tag_added', status: 'active' });
    await seedStep(db, { tenantId, workflowId });

    await controller.triggerWorkflow(tenantId, personId, 'tag_added', null);

    const enrollment = await db
      .selectFrom('workflow_enrollments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', '=', workflowId)
      .where('person_id', '=', personId)
      .executeTakeFirst();

    expect(enrollment).toBeDefined();
    expect(enrollment?.status).toBe('active');
  });

  it('should not enroll anyone when triggerWorkflow finds no matching active workflow', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    // Seed a workflow with a *different* trigger type so it should not match.
    await seedWorkflow(db, { tenantId, userId, triggerType: 'manual', status: 'active' });

    await controller.triggerWorkflow(tenantId, personId, 'tag_added', null);

    const enrollment = await db
      .selectFrom('workflow_enrollments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .executeTakeFirst();

    expect(enrollment).toBeUndefined();
  });

  it('should enroll a person into the specialized new_subscriber workflow when they subscribe', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId, triggerType: 'new_subscriber', status: 'active' });
    await seedStep(db, { tenantId, workflowId });

    // Consent is a campaign_subscriptions write (§15), not a tag attach.
    await controller.triggerSubscriptionChanged(tenantId, personId, 'subscribed');

    const enrollment = await db
      .selectFrom('workflow_enrollments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', '=', workflowId)
      .where('person_id', '=', personId)
      .executeTakeFirst();

    expect(enrollment).toBeDefined();
  });

  it('should replace all steps and log update activity on saveSteps', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await seedStep(db, { tenantId, workflowId, stepNumber: 1 });

    const result = await controller.saveSteps(
      tenantId,
      workflowId,
      [
        // Spec §16: only a `wait` step carries a delay; action steps (send_email) do not.
        { kind: 'wait', delay_days: 2, delay_unit: 'hours' },
        { kind: 'send_email', delay_days: 0, delay_unit: 'days', subject: 'Step B' },
      ],
      userId,
    );

    expect(result).toEqual({ success: true });

    const steps = await db
      .selectFrom('workflow_steps')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', '=', workflowId)
      .orderBy('step_number', 'asc')
      .execute();

    expect(steps).toHaveLength(2);
    expect(steps[0].kind).toBe('wait');
    expect(steps[0].delay_days).toBe(2);
    expect(steps[0].delay_unit).toBe('hours');
    expect(steps[1].kind).toBe('send_email');
    expect(steps[1].subject).toBe('Step B');
    expect(steps[1].step_number).toBe(2);

    const activity = await db
      .selectFrom('user_activity')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('entity', '=', 'workflows')
      .where('activity', '=', 'update')
      .executeTakeFirst();
    expect(activity).toBeDefined();
  });

  it('should throw NOT_FOUND from saveSteps when the workflow does not exist', async () => {
    await expect(controller.saveSteps(tenantId, '999999999', [], userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Workflow not found.',
    });
  });

  it('should cancel an active enrollment', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    const enrollmentId = rand();
    await db
      .insertInto('workflow_enrollments')
      .values({
        id: enrollmentId,
        tenant_id: tenantId,
        workflow_id: workflowId,
        person_id: personId,
        status: 'active',
        current_step_number: 1,
      })
      .execute();

    const result = await controller.cancelEnrollment(tenantId, enrollmentId, userId);
    expect(result).toEqual({ success: true });

    const updated = await db
      .selectFrom('workflow_enrollments')
      .selectAll()
      .where('id', '=', enrollmentId)
      .executeTakeFirstOrThrow();
    expect(updated.status).toBe('cancelled');
    expect(updated.next_run_at).toBeNull();
  });

  it('should throw NOT_FOUND when cancelling a missing enrollment', async () => {
    await expect(controller.cancelEnrollment(tenantId, '999999999', userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Enrollment not found.',
    });
  });

  it('should throw BAD_REQUEST when cancelling an enrollment that is not active', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    const enrollmentId = rand();
    await db
      .insertInto('workflow_enrollments')
      .values({
        id: enrollmentId,
        tenant_id: tenantId,
        workflow_id: workflowId,
        person_id: personId,
        status: 'completed',
        current_step_number: 1,
      })
      .execute();

    await expect(controller.cancelEnrollment(tenantId, enrollmentId, userId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Only active enrollments can be cancelled.',
    });
  });

  it('should list enrollments with joined person details via getEnrollments', async () => {
    const personId = await seedPerson(db, { tenantId, campaignId, householdId, userId });
    const workflowId = await seedWorkflow(db, { tenantId, userId });
    await db
      .insertInto('workflow_enrollments')
      .values({
        id: rand(),
        tenant_id: tenantId,
        workflow_id: workflowId,
        person_id: personId,
        status: 'active',
        current_step_number: 1,
      })
      .execute();

    const enrollments = await controller.getEnrollments(tenantId, workflowId);

    expect(enrollments).toHaveLength(1);
    expect(enrollments[0].person_id).toBe(personId);
    expect((enrollments[0] as any).person_first_name).toBe('Wanda');
  });

  it('should resolve creator/updater names on getOneById', async () => {
    const workflowId = await seedWorkflow(db, { tenantId, userId });

    const workflow = await controller.getOneById({ tenant_id: tenantId, id: workflowId });

    expect(workflow).toBeDefined();
    expect((workflow as any).created_by_name).toBe('Test User');
    expect((workflow as any).updated_by_name).toBe('Test User');
  });
});

describe('WorkflowsController — date_arrives activation guard', () => {
  const controller = new WorkflowsController();
  const db = getDb();
  let tenantId: string;
  let userId: string;
  let campaignId: string;

  beforeEach(async () => {
    const seed = await seedTenantAndUser(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  const validConfig = () => JSON.stringify({ days_before: 14, campaign_id: campaignId, list_id: '1' });

  function row(overrides: Record<string, unknown>) {
    return {
      tenant_id: tenantId,
      name: `Date wf ${rand()}`,
      trigger_type: 'date_arrives',
      createdby_id: userId,
      updatedby_id: userId,
      ...overrides,
    } as Parameters<WorkflowsController['add']>[0];
  }

  it('refuses to CREATE an active date_arrives workflow without a valid config', async () => {
    await expect(controller.add(row({ status: 'active', trigger_event_id: null }))).rejects.toThrow(
      /campaign, a days-before value and a list/,
    );
    await expect(controller.add(row({ status: 'active', trigger_event_id: 'not json' }))).rejects.toThrow(
      /campaign, a days-before value and a list/,
    );
  });

  it('allows an unconfigured DRAFT (built later) and a configured ACTIVE one', async () => {
    const draft = await controller.add(row({ status: 'draft', trigger_event_id: null }));
    expect(draft).toBeDefined();
    const active = await controller.add(row({ status: 'active', trigger_event_id: validConfig() }));
    expect(active).toBeDefined();
  });

  it('refuses a bare status flip to active while the stored config is missing', async () => {
    const draft = await controller.add(row({ status: 'draft', trigger_event_id: null }));
    await expect(
      controller.update({ tenant_id: tenantId, id: String((draft as { id: unknown }).id), row: { status: 'active' } }),
    ).rejects.toThrow(/campaign, a days-before value and a list/);
  });

  it('lets the same flip through once the stored config is valid', async () => {
    const draft = await controller.add(row({ status: 'draft', trigger_event_id: validConfig() }));
    const updated = await controller.update({
      tenant_id: tenantId,
      id: String((draft as { id: unknown }).id),
      row: { status: 'active' },
    });
    expect(updated).toBeDefined();
  });
});
