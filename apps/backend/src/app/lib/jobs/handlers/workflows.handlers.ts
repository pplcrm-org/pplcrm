import type { Kysely, Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import { WORKFLOW_EXIT_CONDITIONS, WORKFLOW_SEND_CONDITIONS, calculateWorkingTimeMs, planAllowsFeature } from '@common';
import type { WorkflowExitCondition, WorkflowMessageClass, WorkflowSendCondition } from '@common';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { logger } from '../../../logger';
import { SLA_SETTING_KEYS, type SlaPolicy, settingsMapFrom, slaPolicyFrom } from '../../sla-policy';
import {
  AUTOMATION_PHONE_UNVERIFIED_MESSAGE,
  assertTenantSendingNotBlocked,
  hasOrganizationAddress,
  hasVerifiedSendingDomain,
  loadSendingTenant,
  needsPhoneVerification,
  remainingSendAllowance,
} from '../../../modules/newsletters/send-guards';
import { encodeUnsubscribeToken } from '../../../modules/newsletters/unsubscribe-token';
import { resolveAutomationSendConsent } from '../../../modules/workflows/automation-consent';
import { CRON_JOBS } from '../cron-registry';
import { DAY_MS, HOUR_MS, scheduleNextRun, TEN_MINUTES_MS } from '../reschedule';

const ENROLLMENT_BATCH_SIZE = 500;

/** The recipient must not be emailed (unsubscribed/suppressed/DNC). Recorded as a 'skipped'
 * run — not a failure — and the sequence advances past the step. */
class SkipStepError extends Error {}

/** The tenant temporarily can't send (paused/suspended/payment hold/allowance exhausted).
 * The enrollment is deferred an hour WITHOUT advancing — the email is delayed, never lost. */
class RetryLaterError extends Error {}
// Guard against a malformed sequence (e.g. an accidental cycle of zero-delay steps) monopolising
// a worker tick. A real sequence pauses at each `wait`, so this only ever bites pathological data.
const MAX_ACTIONS_PER_TICK = 50;

// Spec §16 execution: process active enrollments whose next_run_at is due. A step's `kind`
// decides what happens — `wait` reschedules and pauses the sequence; every action kind executes
// immediately (chaining through consecutive actions in one tick) and writes a workflow_runs row
// so the list's RUNS 30D / LAST RUN and the editor's RECENT RUNS reflect reality. Paused
// automations are skipped: "Pausing stops new runs immediately — nothing queues while paused."
export async function handleProcessDripWorkflows(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  // NOTE: unscoped by design — this is the cron scan that drains due enrollments for EVERY
  // tenant in one pass; each row carries the tenant_id that scopes all downstream work.
  // eslint-disable-next-line local/no-unscoped-db-query
  const pendingEnrollments = await db
    .selectFrom('workflow_enrollments')
    .selectAll()
    .where('status', '=', 'active')
    .where('next_run_at', '<=', now)
    .limit(ENROLLMENT_BATCH_SIZE)
    .execute();

  // Plan gate, checked at processing time (once per tenant per tick): a tenant downgraded
  // below the 'automations' feature's minimum plan must not keep running the automations it
  // built while entitled. Ungated enrollments behave exactly like a paused workflow — nothing
  // sends, nothing advances, nothing is deleted — and resume cleanly on re-upgrade.
  const automationsAllowedByTenant = new Map<string, boolean>();

  for (const enrollment of pendingEnrollments) {
    try {
      const tenantId = String(enrollment.tenant_id);
      let automationsAllowed = automationsAllowedByTenant.get(tenantId);
      if (automationsAllowed === undefined) {
        const tenantRow = await db
          .selectFrom('tenants')
          .select('subscription_plan')
          .where('id', '=', tenantId)
          .executeTakeFirst();
        automationsAllowed = planAllowsFeature(tenantRow?.subscription_plan, 'automations');
        automationsAllowedByTenant.set(tenantId, automationsAllowed);
        if (!automationsAllowed) {
          logger.info(
            { tenantId, plan: tenantRow?.subscription_plan ?? null },
            '[plan-gate] Tenant plan does not include automations — drip enrollments deferred, not run',
          );
        }
      }
      if (!automationsAllowed) {
        await db
          .updateTable('workflow_enrollments')
          .set({ next_run_at: new Date(Date.now() + HOUR_MS), updated_at: new Date() })
          .where('tenant_id', '=', enrollment.tenant_id)
          .where('id', '=', enrollment.id)
          .execute();
        continue;
      }

      await db.transaction().execute(async (trx) => {
        const lockedEnrollment = await trx
          .selectFrom('workflow_enrollments')
          .selectAll()
          .where('tenant_id', '=', enrollment.tenant_id)
          .where('id', '=', enrollment.id)
          .where('status', '=', 'active')
          .where('next_run_at', '<=', now)
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();

        if (!lockedEnrollment) return;

        const workflow = await trx
          .selectFrom('workflows')
          .select(['id', 'name', 'status', 'createdby_id', 'exit_conditions', 'message_class'])
          .where('tenant_id', '=', lockedEnrollment.tenant_id)
          .where('id', '=', lockedEnrollment.workflow_id)
          .executeTakeFirst();

        // Workflow gone, or paused → do not run. Push the enrollment forward so a paused
        // automation doesn't hot-loop the batch; it resumes cleanly when un-paused.
        if (!workflow) {
          await completeEnrollment(trx, lockedEnrollment.tenant_id, lockedEnrollment.id);
          return;
        }
        if (workflow.status === 'paused') {
          await trx
            .updateTable('workflow_enrollments')
            .set({ next_run_at: new Date(Date.now() + TEN_MINUTES_MS), updated_at: new Date() })
            .where('tenant_id', '=', lockedEnrollment.tenant_id)
            .where('id', '=', lockedEnrollment.id)
            .execute();
          return;
        }

        const person = await trx
          .selectFrom('persons')
          .select(['id', 'email', 'first_name', 'last_name'])
          .where('tenant_id', '=', lockedEnrollment.tenant_id)
          .where('id', '=', lockedEnrollment.person_id)
          .executeTakeFirst();

        // Sequence-level goals: the moment one is met the enrollment ends — a supporter who
        // already donated must not get the rest of the ask sequence.
        const exitReason = await findMetExitCondition(trx, {
          tenantId: lockedEnrollment.tenant_id,
          enrollmentId: lockedEnrollment.id,
          personId: lockedEnrollment.person_id,
          enrolledAt: new Date(lockedEnrollment.enrolled_at),
          exitConditions: workflow.exit_conditions,
        });
        if (exitReason) {
          await recordRun(trx, {
            tenantId: lockedEnrollment.tenant_id,
            workflowId: lockedEnrollment.workflow_id,
            enrollmentId: lockedEnrollment.id,
            personId: lockedEnrollment.person_id,
            stepNumber: null,
            stepKind: 'exit',
            status: 'success',
            error: exitReason,
          });
          await trx
            .updateTable('workflow_enrollments')
            .set({ status: 'exited', next_run_at: null, updated_at: new Date() })
            .where('tenant_id', '=', lockedEnrollment.tenant_id)
            .where('id', '=', lockedEnrollment.id)
            .execute();
          return;
        }

        const actorId = workflow.createdby_id ? String(workflow.createdby_id) : null;
        let currentStepNumber = lockedEnrollment.current_step_number;

        for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) {
          const step = await trx
            .selectFrom('workflow_steps')
            .selectAll()
            .where('tenant_id', '=', lockedEnrollment.tenant_id)
            .where('workflow_id', '=', lockedEnrollment.workflow_id)
            .where('step_number', '=', currentStepNumber)
            .executeTakeFirst();

          if (!step) {
            await completeEnrollment(trx, lockedEnrollment.tenant_id, lockedEnrollment.id);
            return;
          }

          const nextStep = await trx
            .selectFrom('workflow_steps')
            .select(['step_number'])
            .where('tenant_id', '=', lockedEnrollment.tenant_id)
            .where('workflow_id', '=', lockedEnrollment.workflow_id)
            .where('step_number', '>', currentStepNumber)
            .orderBy('step_number', 'asc')
            .limit(1)
            .executeTakeFirst();

          // `wait`: schedule the delay, advance past the wait, and stop for this tick.
          if (step.kind === 'wait') {
            const delayMs =
              step.delay_unit === 'hours' ? step.delay_days * 60 * 60 * 1000 : step.delay_days * 24 * 60 * 60 * 1000;
            if (nextStep) {
              await trx
                .updateTable('workflow_enrollments')
                .set({
                  current_step_number: nextStep.step_number,
                  next_run_at: new Date(Date.now() + delayMs),
                  updated_at: new Date(),
                })
                .where('tenant_id', '=', lockedEnrollment.tenant_id)
                .where('id', '=', lockedEnrollment.id)
                .execute();
            } else {
              await completeEnrollment(trx, lockedEnrollment.tenant_id, lockedEnrollment.id);
            }
            return;
          }

          // Action step: execute, record the run (success, skipped, or failed), then advance.
          // send_email records its own run first (the delivery job carries the run id for
          // engagement stamping); every other kind is recorded here after executing.
          try {
            const outcome = await executeActionStep(trx, {
              tenantId: lockedEnrollment.tenant_id,
              workflowId: lockedEnrollment.workflow_id,
              enrollmentId: lockedEnrollment.id,
              actorId,
              person: person ?? null,
              step,
              messageClass: workflow.message_class,
            });
            if (!outcome.runRecorded) {
              await recordRun(trx, {
                tenantId: lockedEnrollment.tenant_id,
                workflowId: lockedEnrollment.workflow_id,
                enrollmentId: lockedEnrollment.id,
                personId: lockedEnrollment.person_id,
                stepNumber: step.step_number,
                stepKind: step.kind,
                status: 'success',
                error: null,
              });
            }
          } catch (err) {
            // Tenant-level sending block: defer the whole enrollment an hour without advancing
            // or recording a run — a welcome email during a payment hold is late, not lost.
            if (err instanceof RetryLaterError) {
              await trx
                .updateTable('workflow_enrollments')
                .set({ next_run_at: new Date(Date.now() + HOUR_MS), updated_at: new Date() })
                .where('tenant_id', '=', lockedEnrollment.tenant_id)
                .where('id', '=', lockedEnrollment.id)
                .execute();
              logger.info(
                { workflowId: lockedEnrollment.workflow_id, reason: err.message },
                'Automation send deferred — tenant sending blocked or allowance exhausted',
              );
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            await recordRun(trx, {
              tenantId: lockedEnrollment.tenant_id,
              workflowId: lockedEnrollment.workflow_id,
              enrollmentId: lockedEnrollment.id,
              personId: lockedEnrollment.person_id,
              stepNumber: step.step_number,
              stepKind: step.kind,
              status: err instanceof SkipStepError ? 'skipped' : 'failed',
              error: message,
            });
            if (!(err instanceof SkipStepError)) {
              logger.error({ err }, `Workflow ${lockedEnrollment.workflow_id} step ${step.step_number} failed`);
            }
            // Narrate-and-continue: the failing/skipped step is recorded; the sequence advances
            // so one bad step doesn't wedge the enrollment forever (spec §16).
          }

          if (!nextStep) {
            await completeEnrollment(trx, lockedEnrollment.tenant_id, lockedEnrollment.id);
            return;
          }
          currentStepNumber = nextStep.step_number;
          await trx
            .updateTable('workflow_enrollments')
            .set({ current_step_number: currentStepNumber, next_run_at: new Date(), updated_at: new Date() })
            .where('tenant_id', '=', lockedEnrollment.tenant_id)
            .where('id', '=', lockedEnrollment.id)
            .execute();
        }
      });
    } catch (err) {
      logger.error({ err }, `Failed to process workflow enrollment ${enrollment.id}`);
    }
  }

  // A full batch means there is likely more work waiting — requeue immediately.
  const delayMs = pendingEnrollments.length === ENROLLMENT_BATCH_SIZE ? 0 : CRON_JOBS.process_drip_workflows;
  await scheduleNextRun(db, 'process_drip_workflows', delayMs);
}

const LAPSED_DEFAULT_DAYS = 90;
const LAPSED_MIN_DAYS = 7;
const MAX_LAPSED_ENROLLMENTS_PER_RUN = 500;

/**
 * Daily scan behind the `supporter_lapsed` trigger ("Supporter goes quiet"). For each active
 * workflow on that trigger, find subscribed people whose consent predates the workflow's
 * inactivity window (trigger_event_id, days; default 90) and who have no opens/clicks inside
 * it, then enroll them through the normal trigger path (conditions respected).
 *
 * Re-enrollment hygiene: `enrollPerson` only blocks people with an ACTIVE enrollment, so a
 * completed win-back sequence would otherwise re-enroll the same person every day. Anyone
 * enrolled in this workflow within the last 2×N days is excluded — a person gets at most one
 * win-back per two windows. First activation on a big stale list is capped at 500 enrollments
 * per workflow per day (the sends are additionally metered by the tenant's caps).
 */
export async function handleDetectLapsedSupporters(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  // NOTE: unscoped by design — the daily cron enumerates every tenant's active supporter_lapsed
  // workflows in one pass; each row carries the tenant_id that scopes all downstream work.
  // eslint-disable-next-line local/no-unscoped-db-query
  const lapsedWorkflows = await db
    .selectFrom('workflows')
    .select(['id', 'tenant_id', 'trigger_event_id'])
    .where('trigger_type', '=', 'supporter_lapsed')
    .where('status', '=', 'active')
    .execute();

  if (lapsedWorkflows.length > 0) {
    const { WorkflowsController } = await import('../../../modules/workflows/controller');
    const controller = new WorkflowsController();

    for (const wf of lapsedWorkflows) {
      const tenantId = String(wf.tenant_id);
      const workflowId = String(wf.id);
      const days = Math.max(LAPSED_MIN_DAYS, parseInt(wf.trigger_event_id ?? '', 10) || LAPSED_DEFAULT_DAYS);
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      const dedupeCutoff = new Date(now.getTime() - 2 * days * DAY_MS);

      try {
        const candidates = await db
          .selectFrom('persons')
          .select(['persons.id'])
          .where('persons.tenant_id', '=', tenantId)
          .where('persons.email', 'is not', null)
          .where('persons.email', '!=', '')
          // Subscribed long enough ago that "quiet since then" is meaningful.
          .where(({ exists, selectFrom }) =>
            exists(
              selectFrom('campaign_subscriptions')
                .select('campaign_subscriptions.id')
                .where('campaign_subscriptions.tenant_id', '=', tenantId)
                .where('campaign_subscriptions.status', '=', 'subscribed')
                .where('campaign_subscriptions.consent_at', '<', cutoff)
                .whereRef('campaign_subscriptions.person_id', '=', 'persons.id'),
            ),
          )
          // No engagement inside the window — rollups first, then any un-pruned raw events.
          .where(({ not, exists, selectFrom }) =>
            not(
              exists(
                selectFrom('person_newsletter_engagements')
                  .select('person_newsletter_engagements.email')
                  .where('person_newsletter_engagements.tenant_id', '=', tenantId)
                  .whereRef('person_newsletter_engagements.email', '=', 'persons.email')
                  .where((inner) =>
                    inner.or([
                      inner('person_newsletter_engagements.last_opened_at', '>', cutoff),
                      inner('person_newsletter_engagements.last_clicked_at', '>', cutoff),
                    ]),
                  ),
              ),
            ),
          )
          .where(({ not, exists, selectFrom }) =>
            not(
              exists(
                selectFrom('newsletter_events')
                  .select('newsletter_events.id')
                  .where('newsletter_events.tenant_id', '=', tenantId)
                  .whereRef('newsletter_events.email', '=', 'persons.email')
                  .where('newsletter_events.event_type', 'in', ['open', 'click'])
                  .where('newsletter_events.timestamp', '>', cutoff),
              ),
            ),
          )
          // Not enrolled in this workflow within the last two windows (any status).
          .where(({ not, exists, selectFrom }) =>
            not(
              exists(
                selectFrom('workflow_enrollments')
                  .select('workflow_enrollments.id')
                  .where('workflow_enrollments.tenant_id', '=', tenantId)
                  .where('workflow_enrollments.workflow_id', '=', workflowId)
                  .whereRef('workflow_enrollments.person_id', '=', 'persons.id')
                  .where('workflow_enrollments.created_at', '>', dedupeCutoff),
              ),
            ),
          )
          .limit(MAX_LAPSED_ENROLLMENTS_PER_RUN)
          .execute();

        for (const candidate of candidates) {
          // The trigger path evaluates the workflow's "ONLY ENROLL IF" conditions; passing the
          // workflow's own trigger_event_id keeps differently-windowed workflows separate.
          await controller.triggerWorkflow(tenantId, String(candidate.id), 'supporter_lapsed', wf.trigger_event_id);
        }
        if (candidates.length > 0) {
          logger.info(
            { workflowId, tenantId, enrolled: candidates.length, days },
            '[supporter-lapsed] Enrolled quiet supporters',
          );
        }
      } catch (err) {
        logger.error({ err, workflowId }, '[supporter-lapsed] Failed to scan workflow');
      }
    }
  }

  await scheduleNextRun(db, 'detect_lapsed_supporters', CRON_JOBS.detect_lapsed_supporters);
}

/** Self-rescheduling hourly scan behind the `task_sla_breach` trigger ("Task breaches SLA"). */
export async function handleDetectTaskSlaBreaches(db: Kysely<Models>): Promise<void> {
  await detectTaskSlaBreaches(db);

  await scheduleNextRun(db, 'detect_task_sla_breaches', CRON_JOBS.detect_task_sla_breaches);
}

const TASK_SLA_SCAN_CHUNK_SIZE = 500;

/**
 * How long after enrolling a person through the `task_sla_breach` trigger that trigger refuses to
 * enroll the same person again. Second layer of the loop damping described on
 * `detectTaskSlaBreaches`: even if a marked task slips through (an automation that creates tasks
 * some other way, a task marked before this column existed), a person can be pulled into a
 * breach automation at most once a week.
 */
const TASK_SLA_REENROLLMENT_COOLDOWN_DAYS = 7;

/**
 * Hourly scan behind the `task_sla_breach` trigger (spec §4 → §16). For every open task not
 * yet marked breached, compute its working-hours age against the tenant's SLA target
 * (`sla.tasks_hours` + working days/hours — the same math as the sidebar badge's
 * countSlaBreaches). The first time a task crosses the target it is stamped
 * `sla_breached_at` (the once-only marker — later ticks skip stamped tasks), then the
 * task's linked person is enrolled through the normal trigger path (conditions respected).
 * Tasks with no linked person are stamped but skip enrollment: automations enroll persons.
 *
 * Two things stop a `task_sla_breach` automation that contains a `create_task` step from feeding
 * itself (breach → enroll → the automation creates another task for the same person → that task
 * breaches → enroll again → …, with no end):
 *   1. Tasks carrying `created_by_workflow_id` were made by an automation and are never scanned.
 *   2. A person enrolled through this trigger within the last
 *      TASK_SLA_REENROLLMENT_COOLDOWN_DAYS days is not enrolled again. Enrollment on its own only
 *      blocks a person with a CURRENTLY ACTIVE enrollment, so a completed sequence would happily
 *      restart. This mirrors the two-window cooldown the `supporter_lapsed` scan already applies.
 *
 * Keyset-paginated by task id (ascending `WHERE id > cursor`, not OFFSET) in chunks of
 * TASK_SLA_SCAN_CHUNK_SIZE, looping until a chunk comes back short — an unbounded, un-stamped
 * open-task backlog across every tenant must never be loaded into memory in one query. Each
 * chunk is grouped by tenant and scanned inside its own try/catch (same as before pagination),
 * so one tenant's failure only drops that slice of that chunk — it never kills the rest of the
 * chunk, later chunks, or other tenants' scans.
 */
export async function detectTaskSlaBreaches(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  const { WorkflowsController } = await import('../../../modules/workflows/controller');
  const controller = new WorkflowsController();
  const slaConfigByTenant = new Map<string, Awaited<ReturnType<typeof loadTaskSlaConfig>>>();

  let cursor: string | null = null;
  for (;;) {
    let chunkQuery = db
      .selectFrom('tasks')
      .select(['id', 'tenant_id', 'created_at', 'person_id'])
      .where('status', 'not in', ['done', 'archived'])
      .where('sla_breached_at', 'is', null)
      // A task an automation created is not a task anyone is late on — and scanning it is how a
      // `task_sla_breach` automation with a `create_task` step re-triggers itself endlessly.
      .where('created_by_workflow_id', 'is', null)
      .orderBy('id', 'asc')
      .limit(TASK_SLA_SCAN_CHUNK_SIZE);
    if (cursor !== null) {
      chunkQuery = chunkQuery.where('id', '>', cursor);
    }
    const chunk = await chunkQuery.execute();
    if (chunk.length === 0) break;
    const lastTask = chunk[chunk.length - 1];
    // Unreachable: the length check above guarantees an element; satisfies noUncheckedIndexedAccess.
    if (!lastTask) break;
    cursor = String(lastTask.id);

    const byTenant = new Map<string, typeof chunk>();
    for (const task of chunk) {
      const tenantId = String(task.tenant_id);
      const list = byTenant.get(tenantId) ?? [];
      list.push(task);
      byTenant.set(tenantId, list);
    }

    for (const [tenantId, tasks] of byTenant.entries()) {
      try {
        let config = slaConfigByTenant.get(tenantId);
        if (!config) {
          config = await loadTaskSlaConfig(db, tenantId);
          slaConfigByTenant.set(tenantId, config);
        }
        const slaMs = config.taskSlaHours * HOUR_MS;

        for (const task of tasks) {
          const workingMs = calculateWorkingTimeMs(
            new Date(task.created_at),
            now,
            config.workingDays,
            config.workingHoursStart,
            config.workingHoursEnd,
            config.timeZone,
          );
          if (workingMs <= slaMs) continue;

          // Stamp before enrolling: even if enrollment fails, the trigger fires at most once
          // per task. The `is null` guard makes concurrent ticks race-safe — only the tick
          // that flips the marker proceeds to enroll.
          const stamped = await db
            .updateTable('tasks')
            .set({ sla_breached_at: now })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(task.id))
            .where('sla_breached_at', 'is', null)
            .returning('id')
            .executeTakeFirst();
          if (!stamped) continue;

          if (!task.person_id) {
            logger.info(
              { tenantId, taskId: String(task.id) },
              '[task-sla] Task breached SLA but has no linked person — skipping automation enrollment',
            );
            continue;
          }

          // Re-enrollment cooldown. Enrollment only refuses a person who is CURRENTLY enrolled,
          // so once a breach sequence completes the same person can be pulled straight back in.
          // Anyone enrolled through this trigger inside the cooldown window is left alone.
          const personId = String(task.person_id);
          const cooldownCutoff = new Date(now.getTime() - TASK_SLA_REENROLLMENT_COOLDOWN_DAYS * DAY_MS);
          const recentEnrollment = await db
            .selectFrom('workflow_enrollments')
            .select('workflow_enrollments.id')
            .where('workflow_enrollments.tenant_id', '=', tenantId)
            .where('workflow_enrollments.person_id', '=', personId)
            .where('workflow_enrollments.created_at', '>', cooldownCutoff)
            .where(({ exists, selectFrom }) =>
              exists(
                selectFrom('workflows')
                  .select('workflows.id')
                  .where('workflows.tenant_id', '=', tenantId)
                  .where('workflows.trigger_type', '=', 'task_sla_breach')
                  .whereRef('workflows.id', '=', 'workflow_enrollments.workflow_id'),
              ),
            )
            .limit(1)
            .executeTakeFirst();
          if (recentEnrollment) {
            logger.info(
              { tenantId, taskId: String(task.id), personId, cooldownDays: TASK_SLA_REENROLLMENT_COOLDOWN_DAYS },
              '[task-sla] Contact was already enrolled in a task-breach automation recently — not enrolling again',
            );
            continue;
          }

          try {
            await controller.triggerWorkflow(tenantId, personId, 'task_sla_breach', null);
          } catch (err) {
            logger.error(
              { err, tenantId, taskId: String(task.id) },
              '[task-sla] Failed to fire task_sla_breach trigger',
            );
          }
        }
      } catch (err) {
        logger.error({ err, tenantId }, '[task-sla] Failed to scan tenant for task SLA breaches');
      }
    }

    if (chunk.length < TASK_SLA_SCAN_CHUNK_SIZE) break;
  }
}

/** The tenant's working-hours SLA settings, with the same fallbacks used tenant-wide. */
async function loadTaskSlaConfig(db: Kysely<Models>, tenantId: string): Promise<SlaPolicy> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('tenant_id', '=', tenantId)
    .where('key', 'in', [...SLA_SETTING_KEYS])
    .execute();
  return slaPolicyFrom(settingsMapFrom(rows));
}

async function completeEnrollment(trx: Transaction<Models>, tenantId: string, enrollmentId: string): Promise<void> {
  await trx
    .updateTable('workflow_enrollments')
    .set({ status: 'completed', next_run_at: null, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', enrollmentId)
    .execute();
}

interface RunRecord {
  tenantId: string;
  workflowId: string;
  enrollmentId: string;
  personId: string;
  stepNumber: number | null;
  stepKind: string;
  status: 'success' | 'failed' | 'skipped';
  error: string | null;
}

async function recordRun(trx: Transaction<Models>, run: RunRecord): Promise<void> {
  await trx
    .insertInto('workflow_runs')
    .values({
      tenant_id: run.tenantId,
      workflow_id: run.workflowId,
      enrollment_id: run.enrollmentId,
      person_id: run.personId,
      step_number: run.stepNumber,
      step_kind: run.stepKind,
      status: run.status,
      error: run.error,
    })
    .execute();
}

interface StepPerson {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface ActionContext {
  tenantId: string;
  workflowId: string;
  enrollmentId: string;
  actorId: string | null;
  person: StepPerson | null;
  step: Selectable<Models['workflow_steps']>;
  /** The workflow's message class — decides which consent branch and which send gates apply. */
  messageClass: WorkflowMessageClass;
}

interface ActionOutcome {
  /** True when the step already wrote its own workflow_runs row (send_email does, so the
   * delivery job can carry the run id). */
  runRecorded: boolean;
}

function readConfig(config: unknown): Record<string, unknown> {
  if (config == null) return {};
  if (typeof config === 'string') {
    try {
      const parsed: unknown = JSON.parse(config);
      return parsed != null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof config === 'object' ? (config as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** Enqueued-but-unsent automation deliveries for the tenant. Quota is metered on actual
 * delivery, so these are invisible to `remainingSendAllowance` — the enqueue-time check
 * subtracts them to stay honest about what is already committed to go out. */
async function pendingAutomationSendCount(trx: Transaction<Models>, tenantId: string): Promise<number> {
  const row = await trx
    .selectFrom('background_jobs')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('tenant_id', '=', tenantId)
    .where('status', 'in', ['pending', 'processing'])
    .where(sql`payload->>'type'`, '=', 'send-automation-email')
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

// Executes a single action step. Throws with a human-readable message on failure so the caller
// records a failed run whose `error` narrates what went wrong (surfaced on the list + editor).
// Exported for unit tests (the drip handler is the only production caller).
export async function executeActionStep(trx: Transaction<Models>, ctx: ActionContext): Promise<ActionOutcome> {
  const { step, person } = ctx;
  const config = readConfig(step.config);

  switch (step.kind) {
    case 'send_email': {
      if (!person?.email) throw new Error('Contact has no email address to send to');
      // An empty step must fail loudly, not fall back to a canned "this is an automated
      // message" body — a placeholder email to a real supporter damages trust.
      // Same merge-token syntax as the newsletter composer; substituted here because the
      // delivery path sends content verbatim.
      const substitute = (content: string): string =>
        content
          .replaceAll('{{first_name}}', person.first_name || 'there')
          .replaceAll('{{last_name}}', person.last_name || '');
      const text = step.plain_text_content ? substitute(step.plain_text_content) : null;
      const html = step.html_content ? substitute(step.html_content) : null;
      if (!text && !html) throw new Error('This email step has no content — edit the step and add a message');

      // Engagement gate first — the sequence author said not to send in this case, so it
      // outranks even consent checks (delay-then-check drip: pair with a preceding wait step).
      const sendCondition = parseSendCondition(config['send_condition']);
      if (sendCondition) {
        // Only a run the delivery handler settled as 'success' counts as an email the person
        // actually received. A 'pending' run is still queued, and 'skipped'/'failed' runs were
        // dropped or never delivered — treating any of those as "sent but not opened" is what
        // made a dropped email silently gate the follow-up.
        const previous = await trx
          .selectFrom('workflow_runs')
          .select(['opened_at', 'clicked_at'])
          .where('tenant_id', '=', ctx.tenantId)
          .where('enrollment_id', '=', ctx.enrollmentId)
          .where('step_kind', '=', 'send_email')
          .where('status', '=', 'success')
          .where('step_number', '<', step.step_number)
          .orderBy('step_number', 'desc')
          .limit(1)
          .executeTakeFirst();
        const verdict = evaluateSendCondition(sendCondition, previous ?? null);
        if (!verdict.send) throw new SkipStepError(verdict.reason);
      }

      // Consent (unsubscribed/suppressed/DNC — plus, for marketing-class automations, "must be
      // a subscribed contact") → skip this recipient, honestly narrated.
      const consent = await resolveAutomationSendConsent(
        trx,
        ctx.tenantId,
        { id: person.id, email: person.email },
        ctx.messageClass,
      );
      if (!consent.ok) throw new SkipStepError(consent.reason);

      // Automation emails obey the same tenant sending gates and caps as newsletters — an
      // automation must not be a side-channel around pauses, holds, or the plan meter.
      const tenant = await loadSendingTenant(trx, ctx.tenantId);
      try {
        assertTenantSendingNotBlocked(tenant);
      } catch (err) {
        throw new RetryLaterError(err instanceof Error ? err.message : String(err));
      }

      // Same identity gates as newsletters, in the newsletter path's order: a verified sending
      // domain (automation emails send from the tenant's own domain via SendGrid, never a
      // platform address), and on Free a verified mobile number. Both need the user to act, so
      // the run fails with the fix named rather than deferring forever.
      if (!(await hasVerifiedSendingDomain(trx, ctx.tenantId))) {
        throw new Error(
          'Verify a sending domain and choose a From address (Settings) so automation emails can send. This email was not sent.',
        );
      }
      if (needsPhoneVerification(tenant)) {
        throw new Error(AUTOMATION_PHONE_UNVERIFIED_MESSAGE);
      }
      // Marketing-class automations are commercial mail, so they carry the same postal-address
      // requirement as newsletters (CAN-SPAM/CASL footer). Relationship mail is transactional
      // and does not. Like the domain/phone gates this needs the user to act, so fail the run
      // with the fix named rather than deferring forever.
      switch (ctx.messageClass) {
        case 'marketing':
          if (!(await hasOrganizationAddress(trx, ctx.tenantId))) {
            throw new Error(
              'Set your organization’s mailing address (Settings → Organization) so marketing automation emails can send — anti-spam laws (like CAN-SPAM and CASL) require it in the footer. This email was not sent.',
            );
          }
          break;
        case 'relationship':
          break;
        default: {
          const _exhaustive: never = ctx.messageClass;
          throw new Error(`Unknown automation message class: ${String(_exhaustive)}`);
        }
      }

      // Caps: quota is metered on actual delivery (the send-automation-email handler writes
      // newsletter_send_log), so enqueued-but-unsent jobs are invisible to the meter — count
      // them against the allowance here so a burst of due enrollments can't enqueue past it.
      const pendingSends = await pendingAutomationSendCount(trx, ctx.tenantId);
      if ((await remainingSendAllowance(trx, tenant, new Date())) - pendingSends < 1) {
        throw new RetryLaterError('Sending allowance exhausted for now');
      }

      const unsubscribeUrl = `${env.apiUrl}/api/unsubscribe/${encodeUnsubscribeToken({
        tenantId: ctx.tenantId,
        personId: person.id,
        email: person.email,
      })}`;

      // Record the run BEFORE enqueueing the delivery job — the job carries the run id as a
      // SendGrid custom arg, and the event webhook stamps opens/clicks back onto this row.
      // Same transaction, so a rollback takes both the run and the job (no ghosts either way).
      //
      // It is written as 'pending', not 'success': nothing has been sent yet. The delivery
      // handler (send-automation-email) settles it — 'success' once SendGrid accepts the
      // message, 'skipped' when it deliberately drops the send, 'failed' when the send throws.
      // Claiming success here made a dropped or failed message read as delivered, both in the
      // automations screens and to the "did they open the previous email?" step condition.
      const run = await trx
        .insertInto('workflow_runs')
        .values({
          tenant_id: ctx.tenantId,
          workflow_id: ctx.workflowId,
          enrollment_id: ctx.enrollmentId,
          person_id: person.id,
          step_number: step.step_number,
          step_kind: step.kind,
          status: 'pending',
          error: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('background_jobs')
        .values({
          tenant_id: ctx.tenantId,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'send-automation-email',
            tenantId: ctx.tenantId,
            workflowRunId: String(run.id),
            to: person.email,
            subject: step.subject ? substitute(step.subject) : 'Automated message',
            text: text ?? '',
            html: html ?? '',
            unsubscribeUrl,
            // The workflow's message class rides in the payload so the delivery-time consent
            // re-check applies the same branch without joining back to workflows.
            messageClass: ctx.messageClass,
            // Quota is metered by the delivery handler after SendGrid accepts the send — a job
            // that exhausts its retries must not consume allowance. The flag marks payloads
            // enqueued under that scheme; legacy jobs without it were already metered here at
            // enqueue time and must not be counted twice.
            meterOnSend: true,
          }),
          run_at: new Date(),
          max_attempts: 5,
        })
        .execute();
      return { runRecorded: true };
    }

    case 'add_tag': {
      if (!person) throw new Error('No contact to tag');
      const tagId = str(config['tag_id']);
      if (!tagId) throw new Error('No tag configured for this step');
      if (!ctx.actorId) throw new Error('Automation has no owner to attribute the tag to');
      const exists = await trx
        .selectFrom('map_peoples_tags')
        .select('person_id')
        .where('tenant_id', '=', ctx.tenantId)
        .where('person_id', '=', person.id)
        .where('tag_id', '=', tagId)
        .executeTakeFirst();
      if (!exists) {
        await trx
          .insertInto('map_peoples_tags')
          .values({
            tenant_id: ctx.tenantId,
            person_id: person.id,
            tag_id: tagId,
            createdby_id: ctx.actorId,
            updatedby_id: ctx.actorId,
          })
          .execute();
      }
      return { runRecorded: false };
    }

    case 'create_task': {
      if (!ctx.actorId) throw new Error('Automation has no owner to assign the task to');
      const title = str(config['task_title']) || 'Follow up';
      const contactName = person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '';
      await trx
        .insertInto('tasks')
        .values({
          tenant_id: ctx.tenantId,
          name: title,
          details: contactName ? `Automation task for ${contactName}` : undefined,
          status: 'todo',
          priority: 'medium',
          position: 0,
          // Link the task to the enrolled contact so the task shows on their record (spec §4).
          person_id: person ? String(person.id) : null,
          // Record which automation made this task. The SLA-breach scan skips marked tasks: an
          // automation triggered by `task_sla_breach` that also creates a task would otherwise
          // feed itself forever (breach → enroll → new task → breach → enroll → …).
          created_by_workflow_id: ctx.workflowId,
          createdby_id: ctx.actorId,
          updatedby_id: ctx.actorId,
        })
        .execute();
      return { runRecorded: false };
    }

    case 'notify_team': {
      const targetUserId = str(config['notify_user_id']) || ctx.actorId;
      if (!targetUserId) throw new Error('No team member configured to notify');
      const contactName = person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : 'a contact';
      const message = str(config['notify_message']) || `Automation update for ${contactName}`;
      await trx
        .insertInto('notifications')
        .values({
          tenant_id: ctx.tenantId,
          user_id: targetUserId,
          title: 'Automation notification',
          message,
          type: 'info',
          read: false,
        })
        .execute();
      return { runRecorded: false };
    }

    case 'wait':
      // Handled by the caller before reaching here.
      return { runRecorded: false };

    default: {
      const _exhaustive: never = step.kind;
      throw new Error(`Unknown step kind: ${String(_exhaustive)}`);
    }
  }
}

/* ── Engagement-reactive primitives ──────────────────────────────────────────── */

export interface SendConditionInput {
  opened_at: Date | string | null;
  clicked_at: Date | string | null;
}

export type SendConditionVerdict = { send: true } | { send: false; reason: string };

function parseSendCondition(value: unknown): WorkflowSendCondition | null {
  return typeof value === 'string' && (WORKFLOW_SEND_CONDITIONS as readonly string[]).includes(value)
    ? (value as WorkflowSendCondition)
    : null;
}

/**
 * Gate a send_email step on what the recipient did with the PREVIOUS email in this sequence.
 * `previous` is the most recent successfully-sent email run for the enrollment, or null when
 * this is the first email — in which case "did engage" conditions can never hold (skip) and
 * "did not engage" conditions trivially hold (send). Pure, for unit tests.
 */
export function evaluateSendCondition(
  condition: WorkflowSendCondition,
  previous: SendConditionInput | null,
): SendConditionVerdict {
  const opened = previous?.opened_at != null;
  const clicked = previous?.clicked_at != null;
  switch (condition) {
    case 'previous_not_opened':
      return opened
        ? { send: false, reason: 'They opened the previous email, so this follow-up was skipped' }
        : { send: true };
    case 'previous_not_clicked':
      return clicked
        ? { send: false, reason: 'They clicked the previous email, so this follow-up was skipped' }
        : { send: true };
    case 'previous_opened':
      if (!previous)
        return { send: false, reason: 'No earlier email in this sequence to check, so this step was skipped' };
      return opened
        ? { send: true }
        : { send: false, reason: 'The previous email was not opened, so this step was skipped' };
    case 'previous_clicked':
      if (!previous)
        return { send: false, reason: 'No earlier email in this sequence to check, so this step was skipped' };
      return clicked
        ? { send: true }
        : { send: false, reason: 'The previous email was not clicked, so this step was skipped' };
    default: {
      const _exhaustive: never = condition;
      throw new Error(`Unknown send condition: ${String(_exhaustive)}`);
    }
  }
}

function parseExitConditions(value: unknown): WorkflowExitCondition[] {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is WorkflowExitCondition =>
    (WORKFLOW_EXIT_CONDITIONS as readonly string[]).includes(String(v)),
  );
}

interface ExitContext {
  tenantId: string;
  enrollmentId: string;
  personId: string;
  enrolledAt: Date;
  exitConditions: unknown;
}

/**
 * The first met sequence goal, as a human-readable narration, or null when none is met.
 * 'donated' looks for a standing (non-refunded) gift recorded after enrollment; the engagement
 * goals read the opens/clicks the event webhook stamped onto this enrollment's email runs.
 */
async function findMetExitCondition(trx: Transaction<Models>, ctx: ExitContext): Promise<string | null> {
  const conditions = parseExitConditions(ctx.exitConditions);
  if (conditions.length === 0) return null;

  if (conditions.includes('donated')) {
    const gift = await trx
      .selectFrom('donations')
      .select('id')
      .where('tenant_id', '=', ctx.tenantId)
      .where('person_id', '=', ctx.personId)
      .where('created_at', '>', ctx.enrolledAt)
      .where('refunded_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (gift) return 'Goal met: they donated. The rest of the sequence was skipped.';
  }

  if (conditions.includes('clicked_any_email')) {
    const clicked = await trx
      .selectFrom('workflow_runs')
      .select('id')
      .where('tenant_id', '=', ctx.tenantId)
      .where('enrollment_id', '=', ctx.enrollmentId)
      .where('clicked_at', 'is not', null)
      .limit(1)
      .executeTakeFirst();
    if (clicked) return 'Goal met: they clicked an email in this sequence. The rest was skipped.';
  }

  if (conditions.includes('opened_any_email')) {
    const opened = await trx
      .selectFrom('workflow_runs')
      .select('id')
      .where('tenant_id', '=', ctx.tenantId)
      .where('enrollment_id', '=', ctx.enrollmentId)
      .where('opened_at', 'is not', null)
      .limit(1)
      .executeTakeFirst();
    if (opened) return 'Goal met: they opened an email in this sequence. The rest was skipped.';
  }

  return null;
}
