import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { html, joinHtml, trustedHtml } from '../../html-escape';
import { NotificationsRepo } from '../../../modules/notifications/repositories/notifications.repo';
import { notificationEnabled } from '../../profile-preferences';
import { TransactionalEmailService, type SendMailOptions } from '../../mail/transactional-mail.service';
import { sendMailOrDrop } from '../../mail/send-or-drop';
import { processMentions } from '../../mail/mentions-util';
import { SmsService } from '../../sms/sms.service';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

const mailService = new TransactionalEmailService();
const smsService = new SmsService();

// Chunk size for the keyset-paginated due-tasks scan below — bounds each page instead of
// joining every tenant's overdue tasks into memory in one unbounded query.
const CHECK_DUE_TASKS_PAGE_SIZE = 500;

/** Retry budget for one queued email, matching TransactionalEmailService.enqueueMail. */
const MAIL_JOB_MAX_ATTEMPTS = 5;
/** The most restricted audience, so a message that forgot to classify itself is gated, not relayed. */
const DEFAULT_MAIL_AUDIENCE = 'contact';

/**
 * Send one message, dropping it if the anti-abuse gate refuses it.
 *
 * Thin binding of the shared lib/mail/send-or-drop.ts helper to this file's mail service, so the
 * ~8 call sites below don't each have to pass the service in. See that module for why a gate
 * refusal is dropped rather than retried.
 */
function sendOrDrop(message: SendMailOptions, context: string): Promise<boolean> {
  return sendMailOrDrop(mailService, message, context);
}

/**
 * Hand a set of messages to the outbox as one job each, inside a single transaction.
 *
 * The form-submission handlers below produce two messages with different audiences: a
 * confirmation to the member of the public who submitted the form, and an alert to the
 * workspace's own staff. Sending them inline one after the other made them share a fate — a
 * staff-side failure (a mail provider 5xx, a timeout, the 500/hour staff cap) failed the whole
 * job, which then retried and re-sent the confirmation to the member of the public, up to three
 * times, each one consuming another slot in the workspace's 200/hour contact budget.
 *
 * One job per message gives each message its own retry budget and its own durable record of
 * having been delivered, so neither can duplicate the other. Enqueuing them in one transaction
 * keeps this handler all-or-nothing: a partial enqueue never commits, so a retry cannot queue a
 * message twice. (Residual: a crash in the instant between that commit and the worker marking
 * this job done re-runs it. That is the outbox's ordinary at-least-once caveat, and it no longer
 * depends on whether the other message succeeded.)
 */
async function fanOutMessages(db: Kysely<Models>, messages: SendMailOptions[], context: string): Promise<void> {
  if (messages.length === 0) return;

  // One INSERT statement, so the set of messages is queued all-or-nothing without opening a
  // transaction. (A transaction would be wrong here anyway: this handler is sometimes given a
  // transaction handle, and Kysely's db.transaction() on one issues a plain BEGIN on the same
  // connection, whose COMMIT would commit the outer transaction.)
  await db
    .insertInto('background_jobs')
    .values(
      messages.map((message) => ({
        tenant_id: message.tenant_id ?? null,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'send-transactional-email',
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: String(message.html),
          tenant_id: message.tenant_id ?? null,
          audience: message.audience ?? DEFAULT_MAIL_AUDIENCE,
          notificationSettingsLink: message.notificationSettingsLink ?? null,
        }),
        run_at: new Date(),
        max_attempts: MAIL_JOB_MAX_ATTEMPTS,
      })),
    )
    .execute();

  logger.info({ context, queued: messages.length }, 'Queued submission notification emails');
}

/**
 * Pick the staff address that receives a "someone submitted your form" alert.
 *
 * This used to be `select email from authusers where tenant_id = ? limit 1`. With no ORDER BY,
 * Postgres is free to return a different row between runs, so the alert could land on a
 * different person each time. With no soft-delete filter it could also land on a departed user:
 * this codebase tombstones users (identity scrubbed, row retained because ~61 foreign keys
 * reference it) and every other read filters `deleted_at is null`.
 *
 * Now: live, active users only, owners before admins before everyone else, oldest account first
 * as a deterministic tie-break.
 */
async function findStaffAlertRecipient(
  db: Kysely<Models>,
  tenantId: string,
): Promise<{ email: string; first_name: string } | null> {
  const recipient = await db
    .selectFrom('authusers')
    .select(['email', 'first_name'])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where('deactivated_at', 'is', null)
    .orderBy(sql`case authusers.role when 'owner' then 0 when 'admin' then 1 else 2 end`)
    .orderBy('authusers.id', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!recipient || !recipient.email) return null;
  return { email: recipient.email, first_name: recipient.first_name };
}

export async function handleSendFormNotifications(
  payload: JobPayloadOf<'send-form-notifications'>,
  db: Kysely<Models>,
): Promise<void> {
  // tenantId is required on this payload (server-generated), so scope unconditionally.
  const event = await db
    .selectFrom('volunteer_events')
    .select([
      'name',
      'start_time',
      'end_time',
      'location_address',
      'contact_email',
      'contact_phone',
      'send_signup_confirmation',
      'send_volunteer_alert',
    ])
    .where('id', '=', payload.eventId)
    .where('tenant_id', '=', payload.tenantId)
    .executeTakeFirst();

  if (!event) {
    logger.info(`Skipping volunteer signup notifications: event ${payload.eventId} not found.`);
    return;
  }

  const startFormatted = new Date(event.start_time).toLocaleString();
  const endFormatted = new Date(event.end_time).toLocaleString();

  // Both messages are queued as independent jobs so neither can suppress or duplicate the
  // other — see fanOutMessages.
  const messages: SendMailOptions[] = [];

  // 1. Confirmation Email to the Constituent (if enabled)
  if (event.send_signup_confirmation !== false) {
    const coordEmailLine = event.contact_email ? `Email: ${event.contact_email}` : '';
    const coordPhoneLine = event.contact_phone ? `Phone: ${event.contact_phone}` : '';
    const coordinatorDetails = [coordEmailLine, coordPhoneLine].filter(Boolean).join('\n');

    const coordEmailHtml = event.contact_email
      ? html`Email: <a href="mailto:${event.contact_email}">${event.contact_email}</a>`
      : '';
    const coordPhoneHtml = event.contact_phone ? html`Phone: ${event.contact_phone}` : '';
    const coordinatorDetailsHtml = [coordEmailHtml, coordPhoneHtml].filter(Boolean);

    messages.push({
      to: payload.email,
      subject: `You're signed up to volunteer: ${event.name}`,
      text: `Hi ${payload.firstName || 'there'},\n\nThank you for signing up to volunteer for "${event.name}"!\n\nDetails:\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}\n\nEvent coordinator:\n${coordinatorDetails || 'N/A'}\n\nWe look forward to seeing you there!`,
      html: html`<h2>You're signed up to volunteer</h2>
        <p>Hi ${payload.firstName || 'there'},</p>
        <p>Thank you for signing up to volunteer for <strong>"${event.name}"</strong>!</p>
        <div class="panel">
          <p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p>
          <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>
          <p>
            <strong>Event coordinator:</strong><br />${coordinatorDetailsHtml.length
              ? joinHtml(coordinatorDetailsHtml, trustedHtml('<br>'))
              : 'N/A'}
          </p>
        </div>
        <p>We look forward to seeing you there!</p>`.toString(),
      tenant_id: payload.tenantId,
      audience: 'contact',
    });
  }

  // 2. Alert Email to the Event Coordinator / Tenant Admin (if enabled)
  if (event.send_volunteer_alert !== false) {
    let alertRecipient = event.contact_email || null;

    if (!alertRecipient) {
      alertRecipient = (await findStaffAlertRecipient(db, payload.tenantId))?.email ?? null;
    }

    if (alertRecipient) {
      messages.push({
        to: alertRecipient,
        subject: `New volunteer signup: ${event.name}`,
        text: `Hi,\n\nA new constituent has signed up to volunteer for "${event.name}".\n\nName: ${payload.firstName || ''} ${payload.lastName || ''}\nEmail: ${payload.email}\nPhone: ${payload.mobile || 'N/A'}\nNotes: ${payload.notes || 'None'}`,
        html: html`<h2>New volunteer signup</h2>
          <p>Hi,</p>
          <p>A new constituent has signed up to volunteer for <strong>"${event.name}"</strong>.</p>
          <div class="panel">
            <p><strong>Name:</strong> ${payload.firstName || ''} ${payload.lastName || ''}</p>
            <p><strong>Email:</strong> ${payload.email}</p>
            <p><strong>Phone:</strong> ${payload.mobile || 'N/A'}</p>
            <p><strong>Notes:</strong> ${payload.notes || 'None'}</p>
          </div>`,
        tenant_id: payload.tenantId,
        audience: 'staff',
      });
    }
  }

  await fanOutMessages(db, messages, 'volunteer signup');
}

export async function handleSendShiftReminder(
  payload: JobPayloadOf<'send-shift-reminder'>,
  db: Kysely<Models>,
): Promise<void> {
  let shiftQuery = db
    .selectFrom('volunteer_shifts')
    .select(['id', 'tenant_id', 'status', 'event_id', 'person_id'])
    .where('id', '=', payload.shiftId);
  if (payload.tenantId != null) {
    shiftQuery = shiftQuery.where('tenant_id', '=', payload.tenantId);
  }
  const shift = await shiftQuery.executeTakeFirst();

  if (!shift) {
    logger.info(`Skipping shift reminder: shift ${payload.shiftId} not found.`);
    return;
  }

  // Covers cancelled and no-show shifts as well.
  if (shift.status !== 'signed_up') {
    logger.info(`Skipping shift reminder: shift ${payload.shiftId} status is ${shift.status} instead of signed_up.`);
    return;
  }

  // Scoped by the shift's own tenant_id — stronger than trusting the payload.
  const event = await db
    .selectFrom('volunteer_events')
    .selectAll()
    .where('id', '=', shift.event_id)
    .where('tenant_id', '=', shift.tenant_id)
    .executeTakeFirst();

  if (!event) {
    logger.info(`Skipping shift reminder: event ${shift.event_id} not found.`);
    return;
  }

  if (event.send_reminder === false) {
    logger.info(`Skipping shift reminder: reminders disabled for event ${event.id}.`);
    return;
  }

  // Scoped by the shift's own tenant_id — stronger than trusting the payload.
  const person = await db
    .selectFrom('persons')
    .selectAll()
    .where('id', '=', shift.person_id)
    .where('tenant_id', '=', shift.tenant_id)
    .executeTakeFirst();

  if (!person) {
    logger.info(`Skipping shift reminder: person ${shift.person_id} not found.`);
    return;
  }

  if (!person.email) {
    logger.info(`Skipping shift reminder: person ${shift.person_id} has no email address.`);
    return;
  }

  const startFormatted = new Date(event.start_time).toLocaleString();
  const endFormatted = new Date(event.end_time).toLocaleString();

  const mapsUrl = event.location_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_address)}`
    : null;

  const mapsLinkText = mapsUrl ? `\nDirections & Maps: View on Google Maps (${mapsUrl})` : '';

  const subject = `Volunteer shift reminder: ${event.name}`;
  const text = `Hi ${person.first_name || 'there'},\n\nThis is a reminder that you have an upcoming volunteer shift for "${event.name}".\n\nDetails:\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}${mapsLinkText}\n\nThank you for volunteering, and we look forward to seeing you there!`;

  const body = html`<h2>Volunteer shift reminder</h2>
    <p>Hi ${person.first_name || 'there'},</p>
    <p>This is a reminder that you have an upcoming volunteer shift for <strong>"${event.name}"</strong>.</p>
    <div class="panel">
      <p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p>
      <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>
      ${mapsUrl ? html`<p><a href="${mapsUrl}" target="_blank">Open in Google Maps</a></p>` : ''}
    </div>
    <p>Thank you for volunteering, and we look forward to seeing you there!</p>`;

  const sent = await sendOrDrop(
    {
      to: person.email,
      subject,
      text,
      html: body,
      tenant_id: shift.tenant_id,
      audience: 'contact',
    },
    'volunteer shift reminder',
  );

  if (sent) {
    logger.info(`Successfully sent shift reminder email to ${person.email} for shift ${shift.id}`);
  }
}

export async function handleSendWebformNotifications(
  payload: JobPayloadOf<'send-webform-notifications'>,
  db: Kysely<Models>,
): Promise<void> {
  let formQuery = db
    .selectFrom('web_forms')
    .select(['name', 'send_confirmation', 'send_alert', 'tenant_id'])
    .where('id', '=', payload.formId);
  if (payload.tenantId != null) {
    formQuery = formQuery.where('tenant_id', '=', payload.tenantId);
  }
  const form = await formQuery.executeTakeFirst();

  if (!form) {
    logger.info(`Skipping web form notifications: form ${payload.formId} not found.`);
    return;
  }

  // Both messages are queued as independent jobs so neither can suppress or duplicate the
  // other — see fanOutMessages.
  const messages: SendMailOptions[] = [];

  // 1. Confirmation Email to the Constituent (if enabled)
  if (form.send_confirmation !== false) {
    messages.push({
      to: payload.email,
      subject: `Thank you for your submission to ${form.name}`,
      text: `Hi ${payload.firstName || 'there'},\n\nThank you for submitting our form "${form.name}". We have received your request and our team will follow up with you soon.`,
      html: html`<h2>Thank you for your submission</h2>
        <p>Hi ${payload.firstName || 'there'},</p>
        <p>
          Thank you for submitting our form <strong>"${form.name}"</strong>. We have received your request and our team
          will follow up with you soon.
        </p>`,
      tenant_id: form.tenant_id,
      audience: 'contact',
    });
  }

  // 2. Alert Email to the Tenant Admin (if enabled)
  if (form.send_alert !== false) {
    const admin = await findStaffAlertRecipient(db, form.tenant_id);

    if (admin) {
      messages.push({
        to: admin.email,
        subject: `New submission on ${form.name}`,
        text: `Hi ${admin.first_name || 'there'},\n\nYou have received a new submission on form "${form.name}" from ${payload.firstName || ''} ${payload.lastName || ''} (${payload.email}).\n\nNotes:\n${payload.notes || 'None'}`,
        html: html`<h2>New form submission</h2>
          <p>Hi ${admin.first_name || 'there'},</p>
          <p>
            You have received a new submission on form <strong>"${form.name}"</strong> from
            <strong>${payload.firstName || ''} ${payload.lastName || ''}</strong> (${payload.email}).
          </p>
          <div class="panel">
            <p><strong>Notes:</strong><br />${payload.notes || 'None'}</p>
          </div>`,
        tenant_id: form.tenant_id,
        audience: 'staff',
      });
    }
  }

  await fanOutMessages(db, messages, 'web form submission');
}

export async function handleSendEventRegistrationConfirmation(
  payload: JobPayloadOf<'send-event-registration-confirmation'>,
  db: Kysely<Models>,
): Promise<void> {
  let registrationQuery = db
    .selectFrom('event_registrations')
    .select(['id', 'tenant_id', 'status', 'event_id', 'person_id', 'ticket_type_id'])
    .where('id', '=', payload.registrationId);
  if (payload.tenantId != null) {
    registrationQuery = registrationQuery.where('tenant_id', '=', payload.tenantId);
  }
  const registration = await registrationQuery.executeTakeFirst();

  if (!registration || registration.status === 'cancelled') {
    logger.info(`Skipping event confirmation: registration ${payload.registrationId} not found or cancelled.`);
    return;
  }

  // Scoped by the registration's own tenant_id — stronger than trusting the payload.
  const event = await db
    .selectFrom('events')
    .select([
      'name',
      'start_time',
      'end_time',
      'location_address',
      'contact_email',
      'contact_phone',
      'send_registration_confirmation',
    ])
    .where('id', '=', registration.event_id)
    .where('tenant_id', '=', registration.tenant_id)
    .executeTakeFirst();

  if (!event || event.send_registration_confirmation === false) {
    logger.info(`Skipping event confirmation: event ${registration.event_id} not found or confirmations disabled.`);
    return;
  }

  // Scoped by the registration's own tenant_id — stronger than trusting the payload.
  const person = await db
    .selectFrom('persons')
    .select(['first_name', 'email'])
    .where('id', '=', registration.person_id)
    .where('tenant_id', '=', registration.tenant_id)
    .executeTakeFirst();

  if (!person || !person.email) {
    logger.info(`Skipping event confirmation: person ${registration.person_id} has no email.`);
    return;
  }

  const startFormatted = new Date(event.start_time).toLocaleString();
  const endFormatted = new Date(event.end_time).toLocaleString();
  const coordLine = [
    event.contact_email ? `Email: ${event.contact_email}` : '',
    event.contact_phone ? `Phone: ${event.contact_phone}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const coordHtml = joinHtml(
    [
      event.contact_email ? html`Email: <a href="mailto:${event.contact_email}">${event.contact_email}</a>` : '',
      event.contact_phone ? html`Phone: ${event.contact_phone}` : '',
    ],
    trustedHtml('<br>'),
  );

  const sent = await sendOrDrop(
    {
      to: person.email,
      subject: `Registration confirmed: ${event.name}`,
      text: `Hi ${person.first_name || 'there'},\n\nYou're registered for "${event.name}"!\n\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}${coordLine ? `\n\nContact:\n${coordLine}` : ''}\n\nWe look forward to seeing you there!`,
      html: html`<h2>Registration confirmed</h2>
        <p>Hi ${person.first_name || 'there'},</p>
        <p>You're registered for <strong>"${event.name}"</strong>!</p>
        <div class="panel">
          <p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p>
          <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>
          ${String(coordHtml) ? html`<p><strong>Contact:</strong><br />${coordHtml}</p>` : ''}
        </div>
        <p>We look forward to seeing you there!</p>`,
      tenant_id: registration.tenant_id,
      audience: 'contact',
    },
    'event registration confirmation',
  );

  if (sent) {
    logger.info(`Sent registration confirmation to ${person.email} for event ${registration.event_id}`);
  }
}

export async function handleSendEventReminder(
  payload: JobPayloadOf<'send-event-reminder'>,
  db: Kysely<Models>,
): Promise<void> {
  let registrationQuery = db
    .selectFrom('event_registrations')
    .select(['id', 'tenant_id', 'status', 'event_id', 'person_id'])
    .where('id', '=', payload.registrationId);
  if (payload.tenantId != null) {
    registrationQuery = registrationQuery.where('tenant_id', '=', payload.tenantId);
  }
  const registration = await registrationQuery.executeTakeFirst();

  if (!registration || registration.status !== 'registered') {
    logger.info(
      `Skipping event reminder: registration ${payload.registrationId} not found or not in registered status.`,
    );
    return;
  }

  // Scoped by the registration's own tenant_id — stronger than trusting the payload.
  const event = await db
    .selectFrom('events')
    .selectAll()
    .where('id', '=', registration.event_id)
    .where('tenant_id', '=', registration.tenant_id)
    .executeTakeFirst();

  if (!event || event.send_reminder === false) {
    logger.info(`Skipping event reminder: event ${registration.event_id} not found or reminders disabled.`);
    return;
  }

  // Scoped by the registration's own tenant_id — stronger than trusting the payload.
  const person = await db
    .selectFrom('persons')
    .select(['first_name', 'email'])
    .where('id', '=', registration.person_id)
    .where('tenant_id', '=', registration.tenant_id)
    .executeTakeFirst();

  if (!person || !person.email) {
    logger.info(`Skipping event reminder: person ${registration.person_id} has no email.`);
    return;
  }

  const startFormatted = new Date(event.start_time).toLocaleString();
  const endFormatted = new Date(event.end_time).toLocaleString();
  const mapsUrl = event.location_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_address)}`
    : null;

  const sent = await sendOrDrop(
    {
      to: person.email,
      subject: `Reminder: ${event.name} is tomorrow`,
      text: `Hi ${person.first_name || 'there'},\n\nThis is a reminder that you're registered for "${event.name}" tomorrow.\n\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}${mapsUrl ? `\nDirections: ${mapsUrl}` : ''}\n\nWe look forward to seeing you there!`,
      html: html`<h2>Event reminder</h2>
        <p>Hi ${person.first_name || 'there'},</p>
        <p>This is a reminder that you're registered for <strong>"${event.name}"</strong> tomorrow.</p>
        <div class="panel">
          <p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p>
          <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>
          ${mapsUrl ? html`<p><a href="${mapsUrl}" target="_blank">Open in Google Maps</a></p>` : ''}
        </div>
        <p>We look forward to seeing you there!</p>`,
      tenant_id: registration.tenant_id,
      audience: 'contact',
    },
    'event reminder',
  );

  if (sent) {
    logger.info(`Sent event reminder to ${person.email} for event ${registration.event_id}`);
  }
}

export async function handleSendTransactionalEmail(payload: JobPayloadOf<'send-transactional-email'>): Promise<void> {
  // This is the per-message job the form-submission handlers fan out into, and the one every
  // enqueueMail() caller lands on. Dropping a gate-blocked message here is what stops a
  // suspended, paused or capped workspace from burning five attempts and dead-lettering.
  await sendOrDrop(
    {
      to: payload.to,
      subject: payload.subject ?? '',
      text: payload.text ?? '',
      html: payload.html ?? '',
      tenant_id: payload.tenant_id ?? null,
      audience: payload.audience ?? undefined,
      notificationSettingsLink: payload.notificationSettingsLink ?? undefined,
    },
    'queued transactional email',
  );
}

export async function handleSendSms(payload: JobPayloadOf<'send-sms'>): Promise<void> {
  await smsService.sendSms({ to: payload.to, body: payload.body });
}

export async function handleSendSubscriptionConfirmation(
  payload: JobPayloadOf<'send-subscription-confirmation'>,
): Promise<void> {
  await sendOrDrop(
    {
      to: payload.email,
      subject: 'Please confirm your subscription',
      text: `Hi ${payload.firstName || 'there'},\n\nPlease confirm your subscription by visiting the link below:\n\n${payload.confirmUrl}\n\nIf you did not request this, you can safely ignore this email.`,
      html: html`<h2>Confirm your subscription</h2>
        <p>Hi ${payload.firstName || 'there'},</p>
        <p>Please confirm your subscription by clicking the button below:</p>
        <div class="btn-container">
          <a href="${payload.confirmUrl}" class="btn">Confirm subscription</a>
        </div>
        <p class="warning">If you did not request this, you can safely ignore this email.</p>`,
      tenant_id: payload.tenantId ?? null,
      audience: 'contact',
    },
    'subscription confirmation',
  );
}

export async function handleCheckDueTasks(db: Kysely<Models>): Promise<void> {
  await checkDueTasks(db);

  await scheduleNextRun(db, 'check_due_tasks', CRON_JOBS.check_due_tasks);
}

/** Not executed — only used to derive the row type each keyset page returns. */
function dueTasksBaseQuery(db: Kysely<Models>, now: Date) {
  return db
    .selectFrom('tasks')
    .innerJoin('authusers', 'authusers.id', 'tasks.assigned_to')
    .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
    .select([
      'tasks.id as task_id',
      'tasks.tenant_id as tenant_id',
      'tasks.name as task_name',
      'tasks.due_at',
      'tasks.details',
      'authusers.id as user_id',
      'authusers.email as user_email',
      'authusers.first_name',
      'profiles.preferences as profile_preferences',
    ])
    .where('tasks.status', 'not in', ['done', 'archived'])
    .where('tasks.due_at', '<=', now);
}

type DueTaskRow = Awaited<ReturnType<ReturnType<typeof dueTasksBaseQuery>['execute']>>[number];
type DueTasksCursor = { dueAt: Date; taskId: string };

export async function checkDueTasks(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  try {
    const userTasksMap = new Map<string, DueTaskRow[]>();
    let cursor: DueTasksCursor | null = null;

    // Keyset-paginated (due_at, id) instead of one unbounded cross-tenant query: this join
    // spans every tenant's overdue tasks, and OFFSET-style pagination would re-scan skipped
    // rows on every page. (due_at, id) breaks ties safely since due_at alone isn't unique.
    for (;;) {
      let pageQuery = dueTasksBaseQuery(db, now)
        .orderBy('tasks.due_at', 'asc')
        .orderBy('tasks.id', 'asc')
        .limit(CHECK_DUE_TASKS_PAGE_SIZE);

      if (cursor) {
        const { dueAt, taskId } = cursor;
        pageQuery = pageQuery.where((eb) =>
          eb.or([
            eb('tasks.due_at', '>', dueAt),
            eb.and([eb('tasks.due_at', '=', dueAt), eb('tasks.id', '>', taskId)]),
          ]),
        );
      }

      const page: DueTaskRow[] = await pageQuery.execute();
      if (page.length === 0) break;

      for (const row of page) {
        const userId = String(row.user_id);
        let userTasks = userTasksMap.get(userId);
        if (!userTasks) {
          userTasks = [];
          userTasksMap.set(userId, userTasks);
        }
        userTasks.push(row);
      }

      const lastRow = page[page.length - 1];
      // `due_at <= now` in the WHERE clause already excludes null due_at rows.
      if (lastRow && lastRow.due_at != null) {
        cursor = { dueAt: new Date(lastRow.due_at), taskId: String(lastRow.task_id) };
      }

      if (page.length < CHECK_DUE_TASKS_PAGE_SIZE) break;
    }

    if (userTasksMap.size === 0) return;

    const notificationsRepo = new NotificationsRepo();
    for (const [userId, tasks] of userTasksMap.entries()) {
      const firstRow = tasks[0];
      if (!firstRow) continue;
      const userEmail = firstRow.user_email;
      const firstName = firstRow.first_name;
      const optedIn = notificationEnabled(firstRow.profile_preferences, 'task_due');
      const inAppOptedIn = notificationEnabled(firstRow.profile_preferences, 'task_due_in_app');

      if (inAppOptedIn) {
        await notificationsRepo.pushNotification({
          tenant_id: String(firstRow.tenant_id),
          user_id: userId,
          title: 'Tasks Due',
          message: `You have ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} due or overdue.`,
          type: 'task',
          link: '/tasks',
        });
      }

      if (optedIn && userEmail) {
        let textContent = `Hi ${firstName || 'there'},\n\nHere are your active tasks needing attention today:\n\n`;
        let htmlContent = `<h2>Tasks due today</h2><p>Hi ${firstName || 'there'},</p><p>Here are your active tasks needing attention today:</p><div class="panel"><ul>`;

        for (const t of tasks) {
          const dueDateStr = t.due_at ? new Date(t.due_at).toLocaleDateString() : 'No due date';
          textContent += `- ${t.task_name} (due: ${dueDateStr})\n  Link: ${env.appUrl}/tasks/${t.task_id}\n\n`;
          htmlContent += `<li><strong>${t.task_name}</strong> (due: ${dueDateStr}): <a href="${env.appUrl}/tasks/${t.task_id}">View task</a></li>`;
        }

        htmlContent += `</ul></div>`;

        // Classified and attributed: this is a notice to one of the workspace's own users, and
        // the tenant_id is what lets a bounce or complaint be traced back to a workspace at all.
        // A blocked one is dropped for this user rather than abandoning the remaining users.
        await sendOrDrop(
          {
            to: userEmail,
            subject: `You have ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} due or overdue`,
            text: textContent,
            html: htmlContent,
            tenant_id: String(firstRow.tenant_id),
            audience: 'staff',
            notificationSettingsLink: true,
          },
          'task due reminder',
        );
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check and notify due tasks');
  }
}

/**
 * Deliver @mention notifications for one comment.
 *
 * A thin wrapper over `processMentions` so the work runs on the outbox instead of as a detached
 * promise on the comment request. The comment itself is already committed by the time this runs;
 * this only fans out notifications, so a retry is safe (pushNotification/sendMail are the same
 * per-user, preference-gated calls the inline version made).
 */
export async function handleProcessMentions(
  payload: JobPayloadOf<'process_mentions'>,
  db: Kysely<Models>,
): Promise<void> {
  await processMentions(db, payload.tenant_id, payload.commentText, payload.commentLink, payload.authorId);
}
