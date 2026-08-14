import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../env', () => ({
  env: { apiUrl: 'https://api.test', sharedSecret: 'test-secret', sendgridFreeTierSubuser: '' },
}));
// The drip handler self-reschedules through the real background_jobs table; pin it shut so the
// fake-db tests below never need to model that transaction.
// Partial mock: cron-registry.ts imports the interval constants from this module, so only the
// scheduling side effect is stubbed — the real constants flow through.
vi.mock('../reschedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reschedule')>();
  return { ...actual, scheduleNextRun: vi.fn() };
});
// The SLA-breach scan dynamically imports the controller to enroll through the normal
// trigger path; stub it so the fake-db tests can assert the enrollment call.
const triggerWorkflowSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../modules/workflows/controller', () => ({
  WorkflowsController: class {
    public triggerWorkflow = triggerWorkflowSpy;
  },
}));

import { AUTOMATION_PHONE_UNVERIFIED_MESSAGE } from '../../../modules/newsletters/send-guards';
import {
  detectTaskSlaBreaches,
  evaluateSendCondition,
  executeActionStep,
  handleProcessDripWorkflows,
} from './workflows.handlers';

const OPENED = { opened_at: new Date('2026-07-01T00:00:00Z'), clicked_at: null };
const CLICKED = { opened_at: new Date('2026-07-01T00:00:00Z'), clicked_at: new Date('2026-07-01T01:00:00Z') };
const UNTOUCHED = { opened_at: null, clicked_at: null };

describe('evaluateSendCondition', () => {
  it('previous_not_opened sends only when the previous email went unopened', () => {
    expect(evaluateSendCondition('previous_not_opened', UNTOUCHED)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_not_opened', OPENED).send).toBe(false);
    expect(evaluateSendCondition('previous_not_opened', CLICKED).send).toBe(false);
  });

  it('previous_not_clicked tolerates opens but not clicks', () => {
    expect(evaluateSendCondition('previous_not_clicked', OPENED)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_not_clicked', CLICKED).send).toBe(false);
  });

  it('previous_opened and previous_clicked require the engagement', () => {
    expect(evaluateSendCondition('previous_opened', OPENED)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_opened', UNTOUCHED).send).toBe(false);
    expect(evaluateSendCondition('previous_clicked', CLICKED)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_clicked', OPENED).send).toBe(false);
  });

  it('with no earlier email, negative conditions send and positive conditions skip', () => {
    expect(evaluateSendCondition('previous_not_opened', null)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_not_clicked', null)).toEqual({ send: true });
    expect(evaluateSendCondition('previous_opened', null).send).toBe(false);
    expect(evaluateSendCondition('previous_clicked', null).send).toBe(false);
  });

  it('skip verdicts carry a human-readable narration', () => {
    const verdict = evaluateSendCondition('previous_not_opened', OPENED);
    expect(verdict.send).toBe(false);
    if (!verdict.send) expect(verdict.reason).toMatch(/opened the previous email/);
  });
});

/**
 * Minimal Kysely stand-in: canned rows per table (a single object is treated as a one-row
 * result), with every `insertInto(...).values` / `updateTable(...).set` recorded for
 * assertions. `transaction().execute(cb)` hands the same fake back as the trx.
 */
function makeFakeDb(data: Record<string, unknown>) {
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const state = { transactionCalls: 0 };

  const rowsFor = (table: string): unknown[] => {
    const v = data[table];
    if (v === undefined) return [];
    return Array.isArray(v) ? v : [v];
  };

  const makeBuilder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    const chain = (): Record<string, unknown> => b;
    for (const m of [
      'select',
      'selectAll',
      'where',
      'orderBy',
      'limit',
      'offset',
      'forUpdate',
      'skipLocked',
      'groupBy',
      'onConflict',
      'returning',
    ]) {
      b[m] = vi.fn(chain);
    }
    b['set'] = vi.fn((values: Record<string, unknown>): Record<string, unknown> => {
      updates.push({ table, values });
      return b;
    });
    b['values'] = vi.fn((values: Record<string, unknown>): Record<string, unknown> => {
      inserts.push({ table, values });
      return b;
    });
    b['execute'] = vi.fn(async () => rowsFor(table));
    b['executeTakeFirst'] = vi.fn(async () => rowsFor(table)[0]);
    b['executeTakeFirstOrThrow'] = vi.fn(async () => {
      const row = rowsFor(table)[0];
      if (!row) throw new Error(`makeFakeDb: no canned row for ${table}`);
      return row;
    });
    return b;
  };

  const db: Record<string, unknown> = {
    selectFrom: vi.fn((t: string) => makeBuilder(String(t))),
    updateTable: vi.fn((t: string) => makeBuilder(String(t))),
    insertInto: vi.fn((t: string) => makeBuilder(String(t))),
  };
  db['transaction'] = vi.fn(() => {
    state.transactionCalls += 1;
    return { execute: vi.fn((cb: (trx: unknown) => Promise<unknown>) => cb(db)) };
  });
  return { db, inserts, updates, state };
}

const DUE_ENROLLMENT = {
  id: 'e1',
  tenant_id: '42',
  workflow_id: 'w1',
  person_id: 'p1',
  status: 'active',
  current_step_number: 1,
  next_run_at: new Date('2026-07-01T00:00:00Z'),
  enrolled_at: new Date('2026-06-30T00:00:00Z'),
};

describe('handleProcessDripWorkflows plan gate', () => {
  it('defers enrollments of a tenant whose plan lacks automations without running anything', async () => {
    const { db, updates, state } = makeFakeDb({
      workflow_enrollments: [DUE_ENROLLMENT],
      tenants: { subscription_plan: 'free' },
    });
    await handleProcessDripWorkflows(db as any);

    // Behaves like paused: no step ran (the transaction is never opened), the enrollment is
    // only pushed forward so it resumes cleanly after an upgrade.
    expect(state.transactionCalls).toBe(0);
    const deferrals = updates.filter((u) => u.table === 'workflow_enrollments');
    expect(deferrals).toHaveLength(1);
    expect(deferrals[0].values['next_run_at']).toBeInstanceOf(Date);
    expect((deferrals[0].values['next_run_at'] as Date).getTime()).toBeGreaterThan(Date.now());
    expect(deferrals[0].values['status']).toBeUndefined();
  });

  it('processes enrollments normally when the plan includes automations', async () => {
    const { db, state } = makeFakeDb({
      workflow_enrollments: [DUE_ENROLLMENT],
      tenants: { subscription_plan: 'grassroots' },
      // The locked re-select finds the enrollment; the workflow row is gone, so the tick
      // simply completes the enrollment — enough to prove the gate let it through.
      workflows: [],
    });
    await handleProcessDripWorkflows(db as any);
    expect(state.transactionCalls).toBe(1);
  });

  // Demo workspaces may BUILD automations (the tRPC gate resolves demo as the top tier) but
  // processing stays deferred for UNPAID workspaces: a run ends in outbound email, and the
  // seeded demo contacts are reserved example.com addresses that can only bounce.
  it('defers enrollments of an unpaid demo-mode tenant', async () => {
    const { db, updates, state } = makeFakeDb({
      workflow_enrollments: [DUE_ENROLLMENT],
      // The realistic unpaid demo state is a free/null stored plan (free has no automations
      // feature, so the plan half of the gate already defers; the demo clause additionally
      // covers the one unpaid plan that does include automations — enterprise).
      tenants: { subscription_plan: 'free', demo_mode_at: new Date('2026-08-01T00:00:00Z') },
    });
    await handleProcessDripWorkflows(db as any);

    expect(state.transactionCalls).toBe(0);
    const deferrals = updates.filter((u) => u.table === 'workflow_enrollments');
    expect(deferrals).toHaveLength(1);
    expect((deferrals[0].values['next_run_at'] as Date).getTime()).toBeGreaterThan(Date.now());
    expect(deferrals[0].values['status']).toBeUndefined();
  });

  // The paid exemption (REVIEW7 C3): "paid, demo data still present" is the normal transitional
  // state — exiting the demo requires a settled subscription FIRST — and a paying customer's
  // automations (donation thanks, receipts follow-ups) must not silently stall for it.
  it('processes enrollments of a PAID tenant even while demo data is present', async () => {
    const { db, state } = makeFakeDb({
      workflow_enrollments: [DUE_ENROLLMENT],
      tenants: { subscription_plan: 'movement', demo_mode_at: new Date('2026-08-01T00:00:00Z') },
      workflows: [],
    });
    await handleProcessDripWorkflows(db as any);
    expect(state.transactionCalls).toBe(1);
  });
});

describe('executeActionStep send_email sending gates', () => {
  const SETTINGS_ROWS = [
    { key: 'communications.default_from_email', value: 'team@camp.org' },
    { key: 'communications.verified_domains', value: [{ domain: 'camp.org', status: 'verified' }] },
  ];
  const FREE_TENANT = {
    id: '42',
    subscription_plan: 'free',
    subscription_quantity: 1,
    subscription_ends_at: null,
    subscription_status: '',
    created_at: new Date('2026-06-01T00:00:00Z'),
    suspended_at: null,
    sending_paused_at: null,
    sending_phone_verified_at: null,
  };
  const CTX = {
    tenantId: '42',
    workflowId: 'w1',
    enrollmentId: 'e1',
    actorId: 'u1',
    person: { id: 'p1', email: 'sup@example.org', first_name: 'Sam', last_name: 'Lee' },
    step: {
      kind: 'send_email',
      step_number: 1,
      subject: 'Thanks {{first_name}}',
      html_content: '<p>Thank you!</p>',
      plain_text_content: 'Thank you!',
      config: null,
    },
    messageClass: 'relationship',
  };

  it('fails the run when a Free tenant has not verified a sending phone number', async () => {
    const { db } = makeFakeDb({ settings: SETTINGS_ROWS, tenants: FREE_TENANT });
    await expect(executeActionStep(db as any, CTX as any)).rejects.toThrow(AUTOMATION_PHONE_UNVERIFIED_MESSAGE);
  });

  it('sends once the phone is verified, enqueueing the delivery without metering at enqueue time', async () => {
    const { db, inserts } = makeFakeDb({
      settings: SETTINGS_ROWS,
      tenants: { ...FREE_TENANT, sending_phone_verified_at: new Date('2026-07-01T00:00:00Z') },
      newsletter_send_log: { total: 0 },
      background_jobs: { total: 0 },
      workflow_runs: { id: 'r9' },
    });
    const outcome = await executeActionStep(db as any, CTX as any);
    expect(outcome.runRecorded).toBe(true);

    const jobs = inserts.filter((i) => i.table === 'background_jobs');
    expect(jobs).toHaveLength(1);
    // Quota is metered by the delivery handler (meterOnSend), never in the enqueue transaction.
    expect(String(jobs[0].values['payload'])).toContain('"meterOnSend":true');
    expect(inserts.filter((i) => i.table === 'newsletter_send_log')).toHaveLength(0);
  });
});

describe('detectTaskSlaBreaches', () => {
  // 30 days back always spans well over 24 working hours (the default SLA target),
  // whatever weekday the test runs on.
  const LONG_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const BREACHED_TASK = { id: 't1', tenant_id: '42', created_at: LONG_AGO, person_id: 'p7' };

  beforeEach(() => {
    triggerWorkflowSpy.mockReset();
  });

  it('stamps a breached task once and enrolls its linked person through the trigger path', async () => {
    const { db, updates } = makeFakeDb({ tasks: [BREACHED_TASK], settings: [] });
    await detectTaskSlaBreaches(db as any);

    const stamps = updates.filter((u) => u.table === 'tasks');
    expect(stamps).toHaveLength(1);
    expect(stamps[0].values['sla_breached_at']).toBeInstanceOf(Date);
    expect(triggerWorkflowSpy).toHaveBeenCalledTimes(1);
    expect(triggerWorkflowSpy).toHaveBeenCalledWith('42', 'p7', 'task_sla_breach', null);
  });

  it('leaves tasks still inside their SLA untouched', async () => {
    const young = { ...BREACHED_TASK, created_at: new Date() };
    const { db, updates } = makeFakeDb({ tasks: [young], settings: [] });
    await detectTaskSlaBreaches(db as any);

    expect(updates.filter((u) => u.table === 'tasks')).toHaveLength(0);
    expect(triggerWorkflowSpy).not.toHaveBeenCalled();
  });

  it('stamps a breached task with no linked person but skips enrollment', async () => {
    const orphan = { ...BREACHED_TASK, person_id: null };
    const { db, updates } = makeFakeDb({ tasks: [orphan], settings: [] });
    await detectTaskSlaBreaches(db as any);

    expect(updates.filter((u) => u.table === 'tasks')).toHaveLength(1);
    expect(triggerWorkflowSpy).not.toHaveBeenCalled();
  });

  it('contains a failing enrollment: the scan still completes and the stamp stands', async () => {
    triggerWorkflowSpy.mockRejectedValueOnce(new Error('enrollment blew up'));
    const { db, updates } = makeFakeDb({ tasks: [BREACHED_TASK], settings: [] });

    await expect(detectTaskSlaBreaches(db as any)).resolves.toBeUndefined();
    expect(updates.filter((u) => u.table === 'tasks')).toHaveLength(1);
  });
});
