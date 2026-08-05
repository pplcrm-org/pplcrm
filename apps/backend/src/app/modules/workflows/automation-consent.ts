import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { WorkflowMessageClass, WorkflowTriggerType } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';

type Db = Kysely<Models> | Transaction<Models>;

export type AutomationSendConsent = { ok: true } | { ok: false; reason: string };

/** Which automation step the send belongs to. Either field identifies the enrollment, which is
 * the only thing that can unlock the one-goodbye-email carve-out below — it is keyed on that
 * enrollment's TRIGGER. Callers with neither field get the ordinary consent rules. */
export interface AutomationSendContext {
  /** The drip worker's case: the step has not been recorded as a run yet. */
  enrollmentId?: string | null;
  /** The delivery handler's case: this send already has a `workflow_runs` row, written as
   * 'pending' before the delivery job was queued. The enrollment is read from that row, and the
   * row itself is not counted against the one-goodbye allowance — it IS the goodbye email. */
  workflowRunId?: string | null;
}

/** The trigger that fires when someone unsubscribes from everything — the only trigger whose
 * automation may email a person who has just unsubscribed, and only once. */
const GOODBYE_TRIGGER: WorkflowTriggerType = 'new_unsubscriber';

/**
 * May an automation `send_email` step email this person? Automations aren't campaign-scoped
 * (workflows has no campaign_id), so this is the workflow analogue of the newsletter
 * sendability triad (NewslettersController.buildRecipientQuery). Both classes share the first
 * two checks; the third branches on the automation's message class:
 *  1. Address suppressed (hard bounce / spam complaint) → never.
 *  2. Person is do-not-contact for email → never.
 *  3. 'relationship' (operational mail triggered by the recipient's own action): a person with
 *     subscription rows and NONE subscribed has unsubscribed → skip; a person with NO rows at
 *     all is allowed — they never joined the newsletter and this is not newsletter mail.
 *     'marketing' (commercial mail): requires at least one positively subscribed row — zero
 *     rows, or rows with none subscribed, → skip. This is what stops automations being used
 *     as a consent-free newsletter channel.
 *
 * One deliberate exception to rule 3 exists — see `goodbyeCarveOutApplies`.
 */
export async function resolveAutomationSendConsent(
  db: Db,
  tenantId: string,
  person: { id: string; email: string },
  messageClass: WorkflowMessageClass,
  context?: AutomationSendContext,
): Promise<AutomationSendConsent> {
  const suppressed = await db
    .selectFrom('email_suppressions')
    .select('id')
    .where('tenant_id', '=', tenantId)
    // Case-insensitive: suppressions are stored lowercased but persons keep mixed case.
    .where(sql<boolean>`lower(email) = ${person.email.toLowerCase()}`)
    .executeTakeFirst();
  if (suppressed) return { ok: false, reason: 'Address previously bounced or complained — suppressed' };

  const dnc = await db
    .selectFrom('persons')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', person.id)
    .where(sql<boolean>`do_not_contact AND (do_not_contact_channels IS NULL OR 'email' = ANY(do_not_contact_channels))`)
    .executeTakeFirst();
  if (dnc) return { ok: false, reason: 'Contact is marked do-not-contact for email' };

  const subscriptions = await db
    .selectFrom('campaign_subscriptions')
    .select(['status'])
    .where('tenant_id', '=', tenantId)
    .where('person_id', '=', person.id)
    .execute();
  const hasSubscribedRow = subscriptions.some((s) => s.status === 'subscribed');

  switch (messageClass) {
    case 'relationship':
      if (subscriptions.length > 0 && !hasSubscribedRow) {
        if (await goodbyeCarveOutApplies(db, tenantId, person.id, context)) {
          return { ok: true };
        }
        return { ok: false, reason: 'Contact has unsubscribed from your emails' };
      }
      return { ok: true };
    case 'marketing':
      if (!hasSubscribedRow) {
        return {
          ok: false,
          reason:
            subscriptions.length > 0
              ? 'Contact has unsubscribed from your emails'
              : 'Marketing automations only email subscribed contacts — this contact has never subscribed',
        };
      }
      return { ok: true };
    default: {
      const _exhaustive: never = messageClass;
      return _exhaustive;
    }
  }
}

/**
 * THE ONE PLACE THE CONSENT RULE IS DELIBERATELY RELAXED (maintainer decision, REVIEW5
 * operator question 3).
 *
 * The one-click "unsubscribe from everything" link fires the `new_unsubscriber` trigger, and the
 * state it leaves behind — subscription rows with none subscribed — is exactly what the
 * relationship rule above refuses to email. So an automation on that trigger could never send
 * the goodbye message its own trigger card offers; only its tagging/task/notify steps ran.
 * This carve-out lets such an automation send ONE last email.
 *
 * It is narrow on purpose:
 *  - Keyed on the ENROLLMENT'S TRIGGER, not on the message class. The caller must identify the
 *    enrollment, that enrollment must belong to this person, and its workflow must be on the
 *    `new_unsubscriber` trigger. No other automation gains the ability to email an unsubscribed
 *    person, even another relationship-class one.
 *  - Genuinely once PER PERSON, not per enrollment: any OTHER email step of any
 *    `new_unsubscriber` automation that is queued ('pending') or sent ('success') closes it. A
 *    second email step in the same sequence, and a second enrollment from a later unsubscribe,
 *    both find that run and are refused. (A run that ended 'skipped' or 'failed' delivered no
 *    mail, so it does not consume the allowance.)
 *  - It relaxes ONLY the unsubscribe branch. The stronger opt-outs are checked before this is
 *    ever reached and still refuse absolutely: a suppressed address (hard bounce or spam
 *    complaint) and a do-not-contact-for-email person are never emailed.
 */
async function goodbyeCarveOutApplies(
  db: Db,
  tenantId: string,
  personId: string,
  context: AutomationSendContext | undefined,
): Promise<boolean> {
  // The run this send already has, if any: it is the goodbye email itself, so it must not be
  // read as an earlier goodbye that already spent the allowance.
  const currentRunId = context?.workflowRunId ?? null;
  let enrollmentId = context?.enrollmentId ?? null;
  if (!enrollmentId && currentRunId) {
    const run = await db
      .selectFrom('workflow_runs')
      .select('enrollment_id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', currentRunId)
      .executeTakeFirst();
    enrollmentId = run?.enrollment_id ?? null;
  }
  if (!enrollmentId) return false;

  const enrollment = await db
    .selectFrom('workflow_enrollments')
    .innerJoin('workflows', 'workflows.id', 'workflow_enrollments.workflow_id')
    .select('workflows.trigger_type')
    .where('workflow_enrollments.tenant_id', '=', tenantId)
    .where('workflow_enrollments.id', '=', enrollmentId)
    .where('workflow_enrollments.person_id', '=', personId)
    .where('workflows.tenant_id', '=', tenantId)
    .where('workflows.trigger_type', '=', GOODBYE_TRIGGER)
    .executeTakeFirst();
  if (!enrollment) return false;

  let spent = db
    .selectFrom('workflow_runs')
    .innerJoin('workflows', 'workflows.id', 'workflow_runs.workflow_id')
    .select('workflow_runs.id')
    .where('workflow_runs.tenant_id', '=', tenantId)
    .where('workflow_runs.person_id', '=', personId)
    .where('workflow_runs.step_kind', '=', 'send_email')
    .where('workflow_runs.status', 'in', ['pending', 'success'])
    .where('workflows.tenant_id', '=', tenantId)
    .where('workflows.trigger_type', '=', GOODBYE_TRIGGER);
  if (currentRunId) {
    spent = spent.where('workflow_runs.id', '!=', currentRunId);
  }

  return !(await spent.executeTakeFirst());
}
