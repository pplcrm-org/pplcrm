import { parseDateArrivesConfig, resolveWorkflowMessageClass } from '@common';
import { BaseController } from '../../lib/base.controller';
import { WorkflowsRepo } from './repositories/workflows.repo';
import { WorkflowEnrollmentsRepo } from './repositories/workflow-enrollments.repo';
import { sql } from 'kysely';
import type { Transaction, Kysely } from 'kysely';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import { TRPCError } from '@trpc/server';
import { BadRequestError } from '../../errors/app-errors';
import { logger } from '../../logger';

export class WorkflowsController extends BaseController<'workflows', WorkflowsRepo> {
  private readonly enrollmentsRepo = new WorkflowEnrollmentsRepo();

  constructor() {
    super(new WorkflowsRepo());
  }

  /** node-postgres serializes JS arrays as Postgres array literals, not JSON — a raw
   * exit_conditions array would corrupt the jsonb column. Stringify before the generic path. */
  private static stringifyExitConditions(row: Record<string, unknown>): void {
    if (Array.isArray(row['exit_conditions'])) {
      row['exit_conditions'] = JSON.stringify(row['exit_conditions']);
    }
  }

  /**
   * An ACTIVE date_arrives workflow must carry a valid config (campaign + days-before + list),
   * or the daily cron would sit silently on it — and worse, its NULL trigger_event_id would
   * make it catch every other date workflow's firing through the "Any" match in
   * triggerWorkflow. Draft and paused rows may stay unconfigured while being built.
   */
  private static assertDateArrivesConfig(
    triggerType: string | undefined,
    status: string | null | undefined,
    triggerEventId: string | null | undefined,
  ): void {
    if (triggerType !== 'date_arrives' || status !== 'active') return;
    if (!parseDateArrivesConfig(triggerEventId)) {
      throw new BadRequestError(
        'This automation needs a campaign, a days-before value and a list before it can be turned on.',
      );
    }
  }

  public override async add(row: OperationDataType<'workflows', 'insert'>, trx?: Transaction<Models>) {
    WorkflowsController.stringifyExitConditions(row as Record<string, unknown>);
    WorkflowsController.assertDateArrivesConfig(row.trigger_type, row.status ?? 'draft', row.trigger_event_id);
    // Server-side message-class enforcement (REVIEW3 two-class plan): a trigger that determines
    // the class always wins over whatever the client sent — the win-back trigger cannot be made
    // 'relationship' through the API — and an omitted class falls back to the trigger's default.
    row.message_class = resolveWorkflowMessageClass(row.trigger_type, row.message_class ?? null);
    return super.add(row, trx);
  }

  public override async update(input: {
    tenant_id: string;
    id: string;
    row: OperationDataType<'workflows', 'update'>;
  }) {
    WorkflowsController.stringifyExitConditions(input.row as Record<string, unknown>);
    const { row } = input;
    // Same guard as add(). A partial update (e.g. a bare status flip to 'active') may carry
    // any subset of the three fields, so the missing ones are read from the stored row.
    if (row.trigger_type !== undefined || row.status !== undefined || row.trigger_event_id !== undefined) {
      const stored = await this.getRepo()
        .db.selectFrom('workflows')
        .select(['trigger_type', 'status', 'trigger_event_id'])
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .executeTakeFirst();
      WorkflowsController.assertDateArrivesConfig(
        row.trigger_type ?? stored?.trigger_type,
        row.status ?? stored?.status,
        row.trigger_event_id === undefined ? stored?.trigger_event_id : row.trigger_event_id,
      );
    }
    // Same enforcement as add(). A partial update may carry only one of the pair, so the
    // missing half is read from the stored row before normalizing.
    if (row.trigger_type !== undefined || row.message_class !== undefined) {
      let trigger = row.trigger_type;
      let requested = row.message_class ?? null;
      if (trigger === undefined || row.message_class === undefined) {
        const existing = await this.getRepo()
          .db.selectFrom('workflows')
          .select(['trigger_type', 'message_class'])
          .where('tenant_id', '=', input.tenant_id)
          .where('id', '=', input.id)
          .executeTakeFirst();
        trigger = trigger ?? existing?.trigger_type;
        requested = requested ?? existing?.message_class ?? null;
      }
      if (trigger !== undefined) {
        row.message_class = resolveWorkflowMessageClass(trigger, requested);
      }
    }
    return super.update(input);
  }

  public override async getOneById(input: { tenant_id: string; id: string }) {
    const workflow = await super.getOneById(input);
    if (!workflow) return workflow;
    return this.resolveCreatorAndUpdater(input.tenant_id, workflow);
  }

  public async getSteps(tenantId: string, workflowId: string, trx?: Transaction<Models>) {
    const db = trx || this.getRepo().db;
    const steps = await db
      .selectFrom('workflow_steps')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', '=', workflowId)
      .orderBy('step_number', 'asc')
      .execute();
    return steps.map((s) => ({
      ...s,
      id: String(s.id),
      workflow_id: String(s.workflow_id),
    }));
  }

  public async saveSteps(tenantId: string, workflowId: string, steps: SequenceStepInput[], userId: string) {
    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        // 1. Verify workflow exists and belongs to tenant
        const workflow = await trx
          .selectFrom('workflows')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', workflowId)
          .executeTakeFirst();

        if (!workflow) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Workflow not found.',
          });
        }

        // 2. Snapshot the outgoing steps, then delete them. The snapshot feeds the
        // enrollment remap below (REVIEW4 T1-3): active enrollments store only a
        // step NUMBER, and the delete-and-reinsert renumbers by array position.
        const oldSteps = await trx
          .selectFrom('workflow_steps')
          .select([
            'step_number',
            'kind',
            'config',
            'subject',
            'preview_text',
            'html_content',
            'plain_text_content',
            'delay_days',
            'delay_unit',
          ])
          .where('tenant_id', '=', tenantId)
          .where('workflow_id', '=', workflowId)
          .orderBy('step_number', 'asc')
          .execute();

        await trx
          .deleteFrom('workflow_steps')
          .where('tenant_id', '=', tenantId)
          .where('workflow_id', '=', workflowId)
          .execute();

        // 3. Insert new steps. Spec §16: steps are polymorphic — only `wait` carries a delay,
        // only `send_email` carries subject/body; every other kind stashes its value in `config`.
        if (steps.length > 0) {
          const insertRows = steps.map((step, idx) => {
            const isWait = step.kind === 'wait';
            const isEmail = step.kind === 'send_email';
            return {
              tenant_id: tenantId,
              workflow_id: workflowId,
              step_number: idx + 1,
              kind: step.kind,
              config: step.config ? JSON.stringify(step.config) : null,
              delay_days: isWait ? Number(step.delay_days || 0) : 0,
              delay_unit: isWait ? step.delay_unit || 'days' : 'days',
              subject: isEmail ? step.subject || 'Automated message' : null,
              preview_text: isEmail ? step.preview_text || null : null,
              html_content: isEmail ? step.html_content || null : null,
              plain_text_content: isEmail ? step.plain_text_content || null : null,
            } satisfies OperationDataType<'workflow_steps', 'insert'>;
          });

          await trx.insertInto('workflow_steps').values(insertRows).execute();
        }

        // 4. Remap active enrollments onto the renumbered steps (REVIEW4 T1-3). Without this,
        // inserting a step re-sends someone the step they just got, deleting one skips a step,
        // and shortening the sequence silently completes people. The incoming payload carries no
        // step ids (AddWorkflowStepObj), so matching runs in two passes: first by content
        // signature (kind + every content-bearing column, first unmatched wins in order —
        // handles inserts, deletes and pure reorders), then the leftovers are paired by
        // position, so a step whose subject/body/delay was edited in place reads as "same step,
        // new content" rather than delete-plus-add. Only old steps unmatched by BOTH passes
        // count as deleted.
        const newSignatures = steps.map((step, idx) => ({
          signature: stepContentSignature(step),
          step_number: idx + 1,
          claimed: false,
        }));
        const stepNumberMap = new Map<number, number>(); // old step_number → new step_number
        for (const old of oldSteps) {
          const sig = stepContentSignature(old);
          const match = newSignatures.find((n) => !n.claimed && n.signature === sig);
          if (match) {
            match.claimed = true;
            stepNumberMap.set(old.step_number, match.step_number);
          }
        }
        // Second pass: edited-in-place steps. Pair remaining old and new steps in order.
        const leftoverOld = oldSteps.filter((o) => !stepNumberMap.has(o.step_number));
        const leftoverNew = newSignatures.filter((n) => !n.claimed);
        for (let i = 0; i < leftoverOld.length; i++) {
          const oldStep = leftoverOld[i];
          const newStep = leftoverNew[i];
          if (oldStep === undefined || newStep === undefined) break;
          newStep.claimed = true;
          stepNumberMap.set(oldStep.step_number, newStep.step_number);
        }

        const activeEnrollments = await trx
          .selectFrom('workflow_enrollments')
          .select(['id', 'current_step_number'])
          .where('tenant_id', '=', tenantId)
          .where('workflow_id', '=', workflowId)
          .where('status', '=', 'active')
          .execute();

        let remapped = 0;
        let advanced = 0;
        let completedCount = 0;
        for (const enrollment of activeEnrollments) {
          const direct = stepNumberMap.get(enrollment.current_step_number);
          if (direct !== undefined) {
            if (direct !== enrollment.current_step_number) {
              await trx
                .updateTable('workflow_enrollments')
                .set({ current_step_number: direct, updated_at: new Date() })
                .where('tenant_id', '=', tenantId)
                .where('id', '=', enrollment.id)
                .execute();
              remapped++;
            }
            continue;
          }
          // Their current step was deleted: advance to the next surviving step by OLD ordering.
          let fallback: number | undefined;
          for (const old of oldSteps) {
            if (old.step_number <= enrollment.current_step_number) continue;
            const mapped = stepNumberMap.get(old.step_number);
            if (mapped !== undefined) {
              fallback = mapped;
              break;
            }
          }
          if (fallback !== undefined) {
            await trx
              .updateTable('workflow_enrollments')
              .set({ current_step_number: fallback, updated_at: new Date() })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', enrollment.id)
              .execute();
            advanced++;
          } else {
            // No surviving later step — complete them (same fields the worker's
            // completeEnrollment sets; previously this happened implicitly on next tick).
            await trx
              .updateTable('workflow_enrollments')
              .set({ status: 'completed', next_run_at: null, updated_at: new Date() })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', enrollment.id)
              .execute();
            completedCount++;
          }
        }

        if (activeEnrollments.length > 0) {
          logger.info(
            `saveSteps remap for workflow ${workflowId}: ${activeEnrollments.length} active enrollment(s) — ` +
              `${remapped} renumbered, ${advanced} advanced past a deleted step, ${completedCount} completed (no surviving next step).`,
          );
        }

        // Log update activity
        await this.userActivity.log(
          {
            tenant_id: tenantId,
            user_id: userId,
            activity: 'update',
            entity: 'workflows',
            entity_id: workflowId,
            quantity: 1,
            metadata: { id: workflowId, action: 'save_steps', stepsCount: steps.length },
          },
          trx,
        );
      });

    return { success: true };
  }

  public async getEnrollments(tenantId: string, workflowId: string, options?: any) {
    return this.enrollmentsRepo.getEnrollmentsWithPersonDetails({
      tenant_id: tenantId,
      workflow_id: workflowId,
      options,
    });
  }

  public async enrollPerson(
    tenantId: string,
    personId: string,
    workflowId: string,
    userId: string,
    trx?: Transaction<Models> | Kysely<Models>,
  ) {
    const executeLogic = async (t: Transaction<Models> | Kysely<Models>) => {
      // 1. Verify person exists
      const person = await t
        .selectFrom('persons')
        .select(['id', 'first_name', 'last_name', 'email'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', personId)
        .executeTakeFirst();

      if (!person) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Person not found.',
        });
      }

      // 2. Verify workflow exists and is active
      const workflow = await t
        .selectFrom('workflows')
        .select(['id', 'status', 'name'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', workflowId)
        .executeTakeFirst();

      if (!workflow) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workflow not found.',
        });
      }

      // REVIEW4 T2-16: existence alone is not enough — a draft or paused automation must not
      // gain enrollments (a draft would start sending the moment it has an enroll surface).
      if (workflow.status !== 'active') {
        throw new BadRequestError('This automation is not active. Activate it before enrolling anyone.');
      }

      // 3. Check if already enrolled in an active state
      const existing = await t
        .selectFrom('workflow_enrollments')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('workflow_id', '=', workflowId)
        .where('person_id', '=', personId)
        .where('status', '=', 'active')
        .executeTakeFirst();

      if (existing) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This person is already enrolled in this workflow.',
        });
      }

      // 4. Find the first step of this workflow
      const firstStep = await t
        .selectFrom('workflow_steps')
        .select(['step_number'])
        .where('tenant_id', '=', tenantId)
        .where('workflow_id', '=', workflowId)
        .orderBy('step_number', 'asc')
        .executeTakeFirst();

      if (!firstStep) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This workflow does not have any steps yet.',
        });
      }

      // 5. Process immediately — the worker interprets a leading `wait` step by rescheduling,
      // and runs action steps in a chain until it reaches a wait or the end (spec §16).
      const nextRunAt = new Date();

      // 6. Insert enrollment
      const insertRow = {
        tenant_id: tenantId,
        workflow_id: workflowId,
        person_id: personId,
        status: 'active',
        current_step_number: firstStep.step_number,
        next_run_at: nextRunAt,
      } as OperationDataType<'workflow_enrollments', 'insert'>;

      const result = await t
        .insertInto('workflow_enrollments')
        .values(insertRow)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Log user activity
      await this.userActivity.log(
        {
          tenant_id: tenantId,
          user_id: userId,
          activity: 'assign',
          entity: 'workflows',
          entity_id: workflowId,
          quantity: 1,
          metadata: {
            id: workflowId,
            person_id: personId,
            person_name: `${person.first_name || ''} ${person.last_name || ''}`.trim(),
            next_run_at: nextRunAt.toISOString(),
          },
        },
        typeof (t as { transaction?: unknown }).transaction === 'undefined' ? (t as Transaction<Models>) : undefined,
      );

      return {
        ...result,
        id: String(result.id),
        workflow_id: String(result.workflow_id),
        person_id: String(result.person_id),
      };
    };

    if (trx) {
      // REVIEW4 T2-14: a failed enrollment attempt on the CALLER's transaction would otherwise
      // poison it ("current transaction is aborted") even when the caller swallows the error —
      // e.g. failing an entire public form submission. A savepoint confines the damage to this
      // attempt. A plain (non-transaction) Kysely handle can't hold a savepoint; run bare as before.
      if (!trx.isTransaction) {
        return executeLogic(trx);
      }
      await sql`SAVEPOINT workflow_enroll_attempt`.execute(trx);
      try {
        const result = await executeLogic(trx);
        await sql`RELEASE SAVEPOINT workflow_enroll_attempt`.execute(trx);
        return result;
      } catch (err) {
        await sql`ROLLBACK TO SAVEPOINT workflow_enroll_attempt`.execute(trx);
        throw err;
      }
    } else {
      return this.getRepo()
        .transaction()
        .execute(async (t) => executeLogic(t));
    }
  }

  public async cancelEnrollment(tenantId: string, enrollmentId: string, userId: string) {
    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const enrollment = await trx
          .selectFrom('workflow_enrollments')
          .select(['id', 'workflow_id', 'person_id', 'status'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', enrollmentId)
          .executeTakeFirst();

        if (!enrollment) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Enrollment not found.',
          });
        }

        if (enrollment.status !== 'active') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only active enrollments can be cancelled.',
          });
        }

        await trx
          .updateTable('workflow_enrollments')
          .set({
            status: 'cancelled',
            next_run_at: null,
            updated_at: new Date(),
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', enrollmentId)
          .execute();

        // Look up person's name for log
        const person = await trx
          .selectFrom('persons')
          .select(['first_name', 'last_name'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', enrollment.person_id)
          .executeTakeFirst();

        // Log activity
        await this.userActivity.log(
          {
            tenant_id: tenantId,
            user_id: userId,
            activity: 'unassign',
            entity: 'workflows',
            entity_id: String(enrollment.workflow_id),
            quantity: 1,
            metadata: {
              id: String(enrollment.workflow_id),
              person_id: String(enrollment.person_id),
              person_name: person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : 'Unknown Contact',
            },
          },
          trx,
        );

        return { success: true };
      });
  }

  public async triggerWorkflow(
    tenantId: string,
    personId: string,
    triggerType: string,
    triggerEventId: string | null | undefined,
    trx?: Transaction<Models> | Kysely<Models>,
  ) {
    const db = trx || this.getRepo().db;
    let query = db
      .selectFrom('workflows')
      .select(['id', 'name', 'conditions'])
      .where('tenant_id', '=', tenantId)
      .where('trigger_type', '=', triggerType)
      .where('status', '=', 'active');

    if (triggerEventId) {
      query = query.where((eb) =>
        eb.or([eb('trigger_event_id', 'is', null), eb('trigger_event_id', '=', triggerEventId)]),
      );
    } else {
      query = query.where('trigger_event_id', 'is', null);
    }

    const activeWorkflows = await query.execute();
    if (activeWorkflows.length === 0) return;

    // Load the person once so we can evaluate each workflow's "ONLY ENROLL IF" conditions
    // (spec §16) before enrolling. Trigger-based enrollment respects conditions; manual
    // enrollment (the enrollPerson path from the UI) intentionally does not.
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', personId)
      .executeTakeFirst();
    if (!person) return;

    // Look up the default tenant admin actor ID
    const tenantRow = await db.selectFrom('tenants').select('admin_id').where('id', '=', tenantId).executeTakeFirst();
    if (!tenantRow?.admin_id) {
      logger.warn(`triggerWorkflow: skipping automation for tenant ${tenantId} — admin_id not configured.`);
      return;
    }
    const creatorId = String(tenantRow.admin_id);

    for (const wf of activeWorkflows) {
      if (!passesConditions(wf.conditions, person)) {
        logger.info(`Person ${personId} does not meet conditions for workflow ${wf.id}. Skipping enrollment.`);
        continue;
      }
      try {
        await this.enrollPerson(tenantId, personId, String(wf.id), creatorId, trx);
      } catch (err) {
        // Safe check in case they're already enrolled
        if (err instanceof Error && err.message.includes('already enrolled')) {
          logger.info(`Person ${personId} is already enrolled in workflow ${wf.id}. Skipping.`);
        } else {
          logger.error({ err }, `Failed to enroll person ${personId} in workflow ${wf.id}`);
        }
      }
    }
  }

  public async triggerVolunteerSignup(
    tenantId: string,
    personId: string,
    eventId: string | null | undefined,
    trx: Transaction<Models>,
  ) {
    return this.triggerWorkflow(tenantId, personId, 'volunteer_signup', eventId, trx);
  }

  public async triggerTagAdded(
    tenantId: string,
    personId: string,
    tagId: string,
    _tagName: string,
    trx?: Transaction<Models> | Kysely<Models>,
  ) {
    // General tag_added trigger (filtered by tagId, or any tag if no filter).
    // The legacy subscriber/unsubscribed tag special-cases moved to
    // triggerSubscriptionChanged — consent is a campaign_subscriptions write
    // now (§15), not a tag attach.
    await this.triggerWorkflow(tenantId, personId, 'tag_added', tagId, trx);
  }

  /** New consent state → the same automations the legacy subscriber tags fired. */
  public async triggerSubscriptionChanged(
    tenantId: string,
    personId: string,
    status: 'subscribed' | 'unsubscribed',
    trx?: Transaction<Models> | Kysely<Models>,
  ) {
    const trigger = status === 'subscribed' ? 'new_subscriber' : 'new_unsubscriber';
    await this.triggerWorkflow(tenantId, personId, trigger, null, trx);
  }

  // Spec §16 list — the STATUS toggle. "Pausing stops new runs immediately — nothing queues
  // while paused." Setting `paused` only gates new enrollment (see triggerWorkflow's
  // status='active' filter) and the worker (which skips paused workflows); it does not touch
  // enrollments already mid-sequence.
  public async setStatus(tenantId: string, workflowId: string, status: 'active' | 'paused', userId: string) {
    return this.getRepo()
      .transaction()
      .execute(async (trx) => {
        const workflow = await trx
          .selectFrom('workflows')
          .select(['id', 'name'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', workflowId)
          .executeTakeFirst();
        if (!workflow) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Automation not found.' });
        }

        await trx
          .updateTable('workflows')
          .set({ status, updatedby_id: userId, updated_at: new Date() })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', workflowId)
          .execute();

        await this.userActivity.log(
          {
            tenant_id: tenantId,
            user_id: userId,
            activity: 'update',
            entity: 'workflows',
            entity_id: workflowId,
            quantity: 1,
            metadata: { id: workflowId, action: status === 'paused' ? 'pause' : 'resume' },
          },
          trx,
        );

        return { success: true, status };
      });
  }

  // Spec §16 right rail RECENT RUNS + the editor's failure narration: the last N executed steps.
  public async getRuns(tenantId: string, workflowId: string, limit = 20) {
    const rows = await this.getRepo()
      .db.selectFrom('workflow_runs')
      .leftJoin('persons', 'persons.id', 'workflow_runs.person_id')
      .select([
        'workflow_runs.id',
        'workflow_runs.workflow_id',
        'workflow_runs.person_id',
        'workflow_runs.step_number',
        'workflow_runs.step_kind',
        'workflow_runs.status',
        'workflow_runs.error',
        'workflow_runs.opened_at',
        'workflow_runs.clicked_at',
        'workflow_runs.created_at',
        'persons.first_name as person_first_name',
        'persons.last_name as person_last_name',
      ])
      .where('workflow_runs.tenant_id', '=', tenantId)
      .where('workflow_runs.workflow_id', '=', workflowId)
      .orderBy('workflow_runs.created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ ...r, id: String(r.id), workflow_id: String(r.workflow_id) }));
  }

  // Spec §16 list (/automations): every automation with the data the row needs — the recipe
  // sentence (built client-side from trigger + steps + conditions), the RUNS 30D count, and the
  // LAST RUN (status + failing step for the inline error line).
  public async getWorkflowsList(tenantId: string) {
    const db = this.getRepo().db;
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

    const workflows = await db
      .selectFrom('workflows')
      .select(['id', 'name', 'description', 'trigger_type', 'trigger_event_id', 'status', 'conditions'])
      .where('tenant_id', '=', tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    if (workflows.length === 0) {
      return { rows: [] as WorkflowListRow[], summary: { total: 0, active: 0, runs30d: 0 } };
    }

    const workflowIds = workflows.map((w) => String(w.id));

    const steps = await db
      .selectFrom('workflow_steps')
      .select(['workflow_id', 'step_number', 'kind', 'config', 'delay_days', 'delay_unit', 'subject'])
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', 'in', workflowIds)
      .orderBy('step_number', 'asc')
      .execute();

    // The page needs only the 30-day count per workflow, so count in SQL rather than loading
    // every run row from the window just to add them up in JS (REVIEW6 T1-2).
    const runCounts = await db
      .selectFrom('workflow_runs')
      .select((eb) => ['workflow_id', eb.fn.countAll<string>().as('runs')])
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', 'in', workflowIds)
      .where('created_at', '>=', thirtyDaysAgo)
      .groupBy('workflow_id')
      .execute();

    // DISTINCT ON with the newest-first index (idx_workflow_runs_tenant_workflow_created). The
    // previous shape read every run row the workspace ever produced and kept the first per
    // workflow in JS (REVIEW6 T1-2). DISTINCT ON alone still walks every index entry (Postgres
    // below 18 has no skip-scan), so the date bound is what makes it genuinely bounded — 90
    // days, matching the retention sweep (WORKFLOW_RUN_RETENTION_DAYS): older rows are deleted
    // nightly anyway, so the bound can only hide a run the sweep is about to remove
    // (REVIEW7 B7).
    const lastRunWindowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const lastRuns = await db
      .selectFrom('workflow_runs')
      .distinctOn('workflow_id')
      .select(['workflow_id', 'status', 'step_number', 'step_kind', 'error', 'created_at'])
      .where('tenant_id', '=', tenantId)
      .where('workflow_id', 'in', workflowIds)
      .where('created_at', '>=', lastRunWindowStart)
      .orderBy('workflow_id')
      .orderBy('created_at', 'desc')
      .execute();

    const stepsByWorkflow = new Map<string, WorkflowListStep[]>();
    for (const s of steps) {
      const key = String(s.workflow_id);
      const list = stepsByWorkflow.get(key) ?? [];
      list.push({
        step_number: s.step_number,
        kind: s.kind,
        config: s.config,
        delay_days: s.delay_days,
        delay_unit: s.delay_unit,
        subject: s.subject,
      });
      stepsByWorkflow.set(key, list);
    }

    const runs30dByWorkflow = new Map<string, number>();
    for (const r of runCounts) {
      runs30dByWorkflow.set(String(r.workflow_id), Number(r.runs));
    }

    const lastRunByWorkflow = new Map<string, (typeof lastRuns)[number]>();
    for (const r of lastRuns) {
      // DISTINCT ON already reduced this to one newest row per workflow.
      lastRunByWorkflow.set(String(r.workflow_id), r);
    }

    const rows: WorkflowListRow[] = workflows.map((w) => {
      const key = String(w.id);
      const last = lastRunByWorkflow.get(key);
      return {
        id: key,
        name: w.name,
        description: w.description,
        trigger_type: w.trigger_type,
        trigger_event_id: w.trigger_event_id,
        status: w.status,
        conditions: w.conditions,
        steps: stepsByWorkflow.get(key) ?? [],
        runs_30d: runs30dByWorkflow.get(key) ?? 0,
        last_run_at: last ? last.created_at : null,
        last_run_status: last ? last.status : null,
        // Failure AND consent-skip narration surface inline on the list row.
        last_run_error: last && (last.status === 'failed' || last.status === 'skipped') ? last.error : null,
      };
    });

    const summary = {
      total: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      runs30d: rows.reduce((sum, r) => sum + r.runs_30d, 0),
    };

    return { rows, summary };
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// REVIEW4 T1-3 — content identity of a step for the saveSteps enrollment remap's FIRST pass.
// An in-place subject/body/delay edit changes this signature, which is why the remap runs a
// second, position-based pass over the leftovers — without it, editing an email's text would
// read as delete-plus-add and bump everyone mid-sequence off that step.
//
// REVIEW5 T1-6 — every content-bearing column has to be in here, not just `kind` and `config`.
// An email's text lives in subject/preview_text/html_content/plain_text_content and a wait's
// delay in delay_days/delay_unit, while the editor sends `config: null` for waits and for
// emails with no engagement condition. On `kind` + `config` alone every email in a sequence had
// the identical signature, so the first pass paired the k-th old email with the k-th new one
// and inserts/deletes silently shifted people onto the wrong step.
//
// The normalization below must stay identical to the one the insert in saveSteps applies
// (email columns nulled for non-email kinds, delay columns zeroed for non-wait kinds, empty
// subject defaulted) — the incoming payload and the row read back from Postgres are compared
// against each other, so a difference on either side means nothing ever matches.
function stepContentSignature(step: StepContentFields): string {
  const isWait = step.kind === 'wait';
  const isEmail = step.kind === 'send_email';
  return canonicalJson({
    kind: step.kind,
    config: step.config ?? null,
    delay_days: isWait ? Number(step.delay_days || 0) : 0,
    delay_unit: isWait ? step.delay_unit || 'days' : 'days',
    subject: isEmail ? step.subject || 'Automated message' : null,
    preview_text: isEmail ? step.preview_text || null : null,
    html_content: isEmail ? step.html_content || null : null,
    plain_text_content: isEmail ? step.plain_text_content || null : null,
  });
}

/** The columns `stepContentSignature` reads — satisfied both by an incoming `SequenceStepInput`
 * and by a `workflow_steps` row read back from Postgres. */
interface StepContentFields {
  kind: string;
  config?: unknown;
  delay_days?: number | null;
  delay_unit?: string | null;
  subject?: string | null;
  preview_text?: string | null;
  html_content?: string | null;
  plain_text_content?: string | null;
}

// JSON with recursively sorted object keys, so `{a:1,b:2}` from the client equals the same
// document read back from a jsonb column (Postgres does not preserve key order).
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries: [string, unknown][] = Object.entries(value);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export interface SequenceStepInput {
  kind: 'wait' | 'send_email' | 'add_tag' | 'create_task' | 'notify_team' | 'add_to_list';
  config?: Record<string, unknown> | null;
  delay_days?: number;
  delay_unit?: 'days' | 'hours';
  subject?: string | null;
  preview_text?: string | null;
  html_content?: string | null;
  plain_text_content?: string | null;
}

interface WorkflowListStep {
  step_number: number;
  kind: string;
  config: unknown;
  delay_days: number;
  delay_unit: string;
  subject: string | null;
}

interface WorkflowListRow {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_event_id: string | null;
  status: string;
  conditions: unknown;
  steps: WorkflowListStep[];
  runs_30d: number;
  last_run_at: Date | null;
  // 'pending' = an automation email queued for delivery whose outcome is not known yet.
  last_run_status: 'pending' | 'success' | 'failed' | 'skipped' | null;
  last_run_error: string | null;
}

// Spec §16 "ONLY ENROLL IF" — best-effort evaluation of a QueryBuilder group against a person
// row. We resolve scalar person columns only; a rule that names a field we can't read is skipped
// (permissive) rather than silently blocking enrollment. Supported ops: is / is_not / contains /
// at_least (>=, numeric). TODO(§16): richer field sources (tags, lists, donation totals) once the
// enrollment context carries them — evaluating those needs joins this person-row check doesn't do.
function passesConditions(conditions: unknown, person: Record<string, unknown>): boolean {
  if (conditions == null || typeof conditions !== 'object') return true;
  const group = conditions as { conjunction?: string; rules?: unknown[] };
  if (!Array.isArray(group.rules) || group.rules.length === 0) return true;

  const results = group.rules.map((node) => {
    if (node != null && typeof node === 'object' && (node as { kind?: string }).kind === 'group') {
      return passesConditions(node, person);
    }
    return evaluateRule(node, person);
  });

  const conjunction = group.conjunction === 'OR' ? 'OR' : 'AND';
  return conjunction === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function evaluateRule(node: unknown, person: Record<string, unknown>): boolean {
  if (node == null || typeof node !== 'object') return true;
  const rule = node as { field?: string; op?: string; value?: unknown };
  if (!rule.field || !rule.op) return true;
  if (!(rule.field in person)) return true; // unresolvable field — don't block.

  const actual = person[rule.field];
  const actualStr = actual == null ? '' : String(actual).toLowerCase();
  const expected = rule.value == null ? '' : String(rule.value).toLowerCase();

  switch (rule.op) {
    case 'is':
    case 'equals':
      return actualStr === expected;
    case 'is_not':
    case 'notEquals':
      return actualStr !== expected;
    case 'contains':
      return actualStr.includes(expected);
    case 'at_least':
    case 'gte': {
      const a = Number(actual);
      const b = Number(rule.value);
      return Number.isFinite(a) && Number.isFinite(b) ? a >= b : true;
    }
    default:
      return true; // unknown op — don't block.
  }
}
