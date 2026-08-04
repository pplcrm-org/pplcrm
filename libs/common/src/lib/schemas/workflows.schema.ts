import { z } from 'zod';
import { queryBuilderNodeSchema } from './core.schema';

// Spec §16 Automations — the trigger picker's cards. `volunteer_signup` is kept for
// backward compatibility with the pre-rebuild volunteer onboarding trigger (fired from the
// volunteer-events controller) but is not offered as a card. `date_arrives` stays in the
// enum for saved-row back-compat but has no picker card: no backend fires it yet, and a
// dead card is dishonest UI. `task_sla_breach` is fired by the hourly
// detect_task_sla_breaches cron (spec §4 → §16), which enrolls the breached task's linked
// person. `supporter_lapsed` is fired by the daily detect_lapsed_supporters cron; its
// trigger_event_id holds the inactivity threshold in days (default 90).
export const WORKFLOW_TRIGGER_TYPES = [
  'manual',
  'web_form_submitted',
  'contact_created',
  'tag_added',
  'list_joined',
  'donation_recorded',
  'payment_event',
  'volunteer_shift_status',
  'task_sla_breach',
  'new_subscriber',
  'new_unsubscriber',
  'supporter_lapsed',
  'date_arrives',
  'volunteer_signup',
] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

const triggerTypeSchema = z.enum(WORKFLOW_TRIGGER_TYPES);

// Every automation carries a message class that decides which consent rules its send_email
// steps obey (spec: REVIEW3 "two classes of automation email"):
//  - 'relationship': operational mail responding to the recipient's own action (a shift signup,
//    a form submission, a donation). Allowed to reach people with zero newsletter-subscription
//    rows; suppression and do-not-contact still apply.
//  - 'marketing': commercial mail. Requires at least one positively subscribed newsletter row
//    AND the organization's postal address before it can send.
export const WORKFLOW_MESSAGE_CLASSES = ['relationship', 'marketing'] as const;

export type WorkflowMessageClass = (typeof WORKFLOW_MESSAGE_CLASSES)[number];

const messageClassSchema = z.enum(WORKFLOW_MESSAGE_CLASSES);

// Triggers that fire off the recipient's OWN action — operational (relationship) mail, and the
// editor locks the class. `new_unsubscriber` is here because it fires on the person's own
// unsubscribe: classing it as marketing would make the trigger unusable (the recipient just
// revoked the subscription marketing requires).
const RELATIONSHIP_LOCKED_TRIGGERS: ReadonlySet<WorkflowTriggerType> = new Set([
  'web_form_submitted',
  'donation_recorded',
  'payment_event',
  'volunteer_shift_status',
  'task_sla_breach',
  'volunteer_signup',
  'new_unsubscriber',
]);

// Triggers that are re-solicitation by definition — always marketing, not switchable.
// `supporter_lapsed` (the win-back trigger) emails someone precisely because they have NOT
// acted recently, which is the opposite of relationship mail.
const MARKETING_LOCKED_TRIGGERS: ReadonlySet<WorkflowTriggerType> = new Set(['supporter_lapsed']);

/**
 * The class a trigger forces, or null when the author may choose (ambiguous triggers:
 * manual, contact_created, tag_added, list_joined, new_subscriber, date_arrives).
 * Accepts any string so backend rows with unexpected trigger values degrade to "ambiguous".
 */
export function lockedMessageClassForTrigger(trigger: string): WorkflowMessageClass | null {
  if (RELATIONSHIP_LOCKED_TRIGGERS.has(trigger as WorkflowTriggerType)) return 'relationship';
  if (MARKETING_LOCKED_TRIGGERS.has(trigger as WorkflowTriggerType)) return 'marketing';
  return null;
}

/** Default class for a trigger: its locked class, else 'marketing' (the safe side). */
export function defaultMessageClassForTrigger(trigger: string): WorkflowMessageClass {
  return lockedMessageClassForTrigger(trigger) ?? 'marketing';
}

/**
 * Server-side normalization used on every workflow create/save: a locked trigger always wins
 * over whatever the client sent (the win-back trigger cannot be talked into 'relationship'
 * via the API), an ambiguous trigger keeps the requested class, and no class at all falls
 * back to the trigger's default.
 */
export function resolveWorkflowMessageClass(
  trigger: string,
  requested: WorkflowMessageClass | null | undefined,
): WorkflowMessageClass {
  return lockedMessageClassForTrigger(trigger) ?? requested ?? 'marketing';
}

// Spec §16 sequence editor — the five step kinds offered by the ADD A STEP menu.
export const WORKFLOW_STEP_KINDS = ['wait', 'send_email', 'add_tag', 'create_task', 'notify_team'] as const;

export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

const stepKindSchema = z.enum(WORKFLOW_STEP_KINDS);

// Engagement condition on a send_email step: gate the send on what the recipient did with the
// PREVIOUS email in this sequence (the industry-standard delay-then-check drip shape — pair it
// with a wait step so people have time to engage). Absent/null = always send. A click also
// stamps an open, so "not opened" implies "not clicked" was true as well.
export const WORKFLOW_SEND_CONDITIONS = [
  'previous_not_opened',
  'previous_not_clicked',
  'previous_opened',
  'previous_clicked',
] as const;

export type WorkflowSendCondition = (typeof WORKFLOW_SEND_CONDITIONS)[number];

// Sequence-level goals: an enrollment ends early ('exited') the moment one is met. Evaluated
// each time the enrollment comes due, before any step runs.
export const WORKFLOW_EXIT_CONDITIONS = ['donated', 'opened_any_email', 'clicked_any_email'] as const;

export type WorkflowExitCondition = (typeof WORKFLOW_EXIT_CONDITIONS)[number];

// Per-kind config payload (persisted to workflow_steps.config as jsonb). Every field is optional
// at the schema boundary; the controller maps each kind's meaningful fields when executing.
export const WorkflowStepConfigObj = z
  .object({
    // add_tag
    tag_id: z.string().nullable().optional(),
    tag_name: z.string().nullable().optional(),
    // create_task
    task_title: z.string().nullable().optional(),
    // notify_team
    notify_user_id: z.string().nullable().optional(),
    notify_user_name: z.string().nullable().optional(),
    notify_message: z.string().nullable().optional(),
    // send_email
    send_condition: z.enum(WORKFLOW_SEND_CONDITIONS).nullable().optional(),
  })
  .strict();

export type WorkflowStepConfigType = z.infer<typeof WorkflowStepConfigObj>;

export const WorkflowObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  trigger_type: triggerTypeSchema.default('manual'),
  trigger_event_id: z.string().nullable().optional(),
  message_class: messageClassSchema.default('marketing'),
  status: z.enum(['draft', 'active', 'paused']).default('draft'),
  conditions: queryBuilderNodeSchema.nullable().optional(),
  exit_conditions: z.array(z.enum(WORKFLOW_EXIT_CONDITIONS)).nullable().optional(),
  createdby_id: z.string(),
  updatedby_id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const AddWorkflowObj = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().nullable().optional(),
  trigger_type: triggerTypeSchema.default('manual'),
  trigger_event_id: z.string().nullable().optional(),
  // Optional at the boundary: the controller derives/normalizes it from the trigger
  // (resolveWorkflowMessageClass), so a client that omits it still gets the right class.
  message_class: messageClassSchema.optional(),
  status: z.enum(['draft', 'active', 'paused']).default('draft').optional(),
  conditions: queryBuilderNodeSchema.nullable().optional(),
  exit_conditions: z.array(z.enum(WORKFLOW_EXIT_CONDITIONS)).nullable().optional(),
});

export const UpdateWorkflowObj = AddWorkflowObj.partial();

export type AddWorkflowType = z.infer<typeof AddWorkflowObj>;
export type UpdateWorkflowType = z.infer<typeof UpdateWorkflowObj>;

export const WorkflowStepObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  step_number: z.number().int().positive(),
  kind: stepKindSchema,
  config: WorkflowStepConfigObj.nullable().optional(),
  delay_days: z.number().int().nonnegative(),
  delay_unit: z.enum(['days', 'hours']).default('days'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

// Input shape for saveSteps — order is implied by array position, so no step_number here.
export const AddWorkflowStepObj = z.object({
  kind: stepKindSchema,
  config: WorkflowStepConfigObj.nullable().optional(),
  delay_days: z.number().int().nonnegative().default(0),
  delay_unit: z.enum(['days', 'hours']).default('days'),
  subject: z.string().nullable().optional(),
  preview_text: z.string().nullable().optional(),
  html_content: z.string().nullable().optional(),
  plain_text_content: z.string().nullable().optional(),
});

export const UpdateWorkflowStepObj = AddWorkflowStepObj.partial();

export type AddWorkflowStepType = z.infer<typeof AddWorkflowStepObj>;
export type UpdateWorkflowStepType = z.infer<typeof UpdateWorkflowStepObj>;

export const WorkflowEnrollmentObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  person_id: z.string(),
  status: z.enum(['active', 'completed', 'cancelled', 'exited']).default('active'),
  current_step_number: z.number().int().nonnegative(),
  next_run_at: z.coerce.date().nullable().optional(),
  enrolled_at: z.coerce.date(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const WorkflowRunObj = z.object({
  id: z.string(),
  tenant_id: z.string(),
  workflow_id: z.string(),
  enrollment_id: z.string().nullable().optional(),
  person_id: z.string().nullable().optional(),
  step_number: z.number().int().nullable().optional(),
  step_kind: z.string().nullable().optional(),
  // 'pending' = an automation email that is queued for delivery but has not been handed to the
  // mail provider yet; the delivery handler settles it to success/skipped/failed.
  status: z.enum(['pending', 'success', 'failed', 'skipped']),
  error: z.string().nullable().optional(),
  opened_at: z.coerce.date().nullable().optional(),
  clicked_at: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date(),
});

export type WorkflowRunType = z.infer<typeof WorkflowRunObj>;
