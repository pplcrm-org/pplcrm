import type { Kysely } from 'kysely';
import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { NotificationsRepo } from '../../../modules/notifications/repositories/notifications.repo';
import { notificationEnabled } from '../../profile-preferences';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { SmsService } from '../../sms/sms.service';
import type { JobPayloadOf } from '../job-payloads';
import { DAY_MS, scheduleNextRun } from '../reschedule';

const mailService = new TransactionalEmailService();
const smsService = new SmsService();

export async function handleSendFormNotifications(
  payload: JobPayloadOf<'send-form-notifications'>,
  db: Kysely<Models>,
): Promise<void> {
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
    .executeTakeFirst();

  if (!event) {
    logger.info(`Skipping volunteer signup notifications: event ${payload.eventId} not found.`);
    return;
  }

  const startFormatted = new Date(event.start_time).toLocaleString();
  const endFormatted = new Date(event.end_time).toLocaleString();

  // 1. Send Confirmation Email to the Constituent (if enabled)
  if (event.send_signup_confirmation !== false) {
    const coordEmailLine = event.contact_email ? `Email: ${event.contact_email}` : '';
    const coordPhoneLine = event.contact_phone ? `Phone: ${event.contact_phone}` : '';
    const coordinatorDetails = [coordEmailLine, coordPhoneLine].filter(Boolean).join('\n');

    const coordEmailHtml = event.contact_email
      ? `Email: <a href="mailto:${event.contact_email}">${event.contact_email}</a>`
      : '';
    const coordPhoneHtml = event.contact_phone ? `Phone: ${event.contact_phone}` : '';
    const coordinatorDetailsHtml = [coordEmailHtml, coordPhoneHtml].filter(Boolean).join('<br>');

    await mailService.sendMail({
      to: payload.email,
      subject: `You're signed up to volunteer: ${event.name}`,
      text: `Hi ${payload.firstName || 'there'},\n\nThank you for signing up to volunteer for "${event.name}"!\n\nDetails:\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}\n\nEvent coordinator:\n${coordinatorDetails || 'N/A'}\n\nWe look forward to seeing you there!`,
      html: `<h2>You're signed up to volunteer</h2>
<p>Hi ${payload.firstName || 'there'},</p>
<p>Thank you for signing up to volunteer for <strong>"${event.name}"</strong>!</p>
<div class="panel"><p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p><p><strong>Location:</strong> ${event.location_address || 'TBD'}</p><p><strong>Event coordinator:</strong><br>${coordinatorDetailsHtml || 'N/A'}</p></div>
<p>We look forward to seeing you there!</p>`,
    });
  }

  // 2. Send Alert Email to the Event Coordinator / Tenant Admin (if enabled)
  if (event.send_volunteer_alert !== false) {
    let alertRecipient = event.contact_email || null;

    if (!alertRecipient) {
      const admin = await db
        .selectFrom('authusers')
        .select('email')
        .where('tenant_id', '=', payload.tenantId)
        .limit(1)
        .executeTakeFirst();
      if (admin && admin.email) {
        alertRecipient = admin.email;
      }
    }

    if (alertRecipient) {
      await mailService.sendMail({
        to: alertRecipient,
        subject: `New volunteer signup: ${event.name}`,
        text: `Hi,\n\nA new constituent has signed up to volunteer for "${event.name}".\n\nName: ${payload.firstName || ''} ${payload.lastName || ''}\nEmail: ${payload.email}\nPhone: ${payload.mobile || 'N/A'}\nNotes: ${payload.notes || 'None'}`,
        html: `<h2>New volunteer signup</h2>
<p>Hi,</p>
<p>A new constituent has signed up to volunteer for <strong>"${event.name}"</strong>.</p>
<div class="panel"><p><strong>Name:</strong> ${payload.firstName || ''} ${payload.lastName || ''}</p><p><strong>Email:</strong> ${payload.email}</p><p><strong>Phone:</strong> ${payload.mobile || 'N/A'}</p><p><strong>Notes:</strong> ${payload.notes || 'None'}</p></div>`,
      });
    }
  }
}

export async function handleSendShiftReminder(
  payload: JobPayloadOf<'send-shift-reminder'>,
  db: Kysely<Models>,
): Promise<void> {
  const shift = await db
    .selectFrom('volunteer_shifts')
    .select(['id', 'status', 'event_id', 'person_id'])
    .where('id', '=', payload.shiftId)
    .executeTakeFirst();

  if (!shift) {
    logger.info(`Skipping shift reminder: shift ${payload.shiftId} not found.`);
    return;
  }

  // Covers cancelled and no-show shifts as well.
  if (shift.status !== 'signed_up') {
    logger.info(`Skipping shift reminder: shift ${payload.shiftId} status is ${shift.status} instead of signed_up.`);
    return;
  }

  const event = await db.selectFrom('volunteer_events').selectAll().where('id', '=', shift.event_id).executeTakeFirst();

  if (!event) {
    logger.info(`Skipping shift reminder: event ${shift.event_id} not found.`);
    return;
  }

  if (event.send_reminder === false) {
    logger.info(`Skipping shift reminder: reminders disabled for event ${event.id}.`);
    return;
  }

  const person = await db.selectFrom('persons').selectAll().where('id', '=', shift.person_id).executeTakeFirst();

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

  const html = `<h2>Volunteer shift reminder</h2>
<p>Hi ${person.first_name || 'there'},</p>
<p>This is a reminder that you have an upcoming volunteer shift for <strong>"${event.name}"</strong>.</p>
<div class="panel">
  <p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p>
  <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>
  ${mapsUrl ? `<p><a href="${mapsUrl}" target="_blank">Open in Google Maps</a></p>` : ''}
</div>
<p>Thank you for volunteering, and we look forward to seeing you there!</p>`;

  await mailService.sendMail({
    to: person.email,
    subject,
    text,
    html,
  });

  logger.info(`Successfully sent shift reminder email to ${person.email} for shift ${shift.id}`);
}

export async function handleSendWebformNotifications(
  payload: JobPayloadOf<'send-webform-notifications'>,
  db: Kysely<Models>,
): Promise<void> {
  const form = await db
    .selectFrom('web_forms')
    .select(['name', 'send_confirmation', 'send_alert', 'tenant_id'])
    .where('id', '=', payload.formId)
    .executeTakeFirst();

  if (!form) {
    logger.info(`Skipping web form notifications: form ${payload.formId} not found.`);
    return;
  }

  // 1. Send Confirmation Email to the Constituent (if enabled)
  if (form.send_confirmation !== false) {
    await mailService.sendMail({
      to: payload.email,
      subject: `Thank you for your submission to ${form.name}`,
      text: `Hi ${payload.firstName || 'there'},\n\nThank you for submitting our form "${form.name}". We have received your request and our team will follow up with you soon.`,
      html: `<h2>Thank you for your submission</h2>
<p>Hi ${payload.firstName || 'there'},</p>
<p>Thank you for submitting our form <strong>"${form.name}"</strong>. We have received your request and our team will follow up with you soon.</p>`,
    });
  }

  // 2. Send Alert Email to the Tenant Admin (if enabled)
  if (form.send_alert !== false) {
    const admin = await db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('tenant_id', '=', form.tenant_id)
      .limit(1)
      .executeTakeFirst();

    if (admin && admin.email) {
      await mailService.sendMail({
        to: admin.email,
        subject: `New submission on ${form.name}`,
        text: `Hi ${admin.first_name || 'there'},\n\nYou have received a new submission on form "${form.name}" from ${payload.firstName || ''} ${payload.lastName || ''} (${payload.email}).\n\nNotes:\n${payload.notes || 'None'}`,
        html: `<h2>New form submission</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>You have received a new submission on form <strong>"${form.name}"</strong> from <strong>${payload.firstName || ''} ${payload.lastName || ''}</strong> (${payload.email}).</p>
<div class="panel"><p><strong>Notes:</strong><br>${payload.notes || 'None'}</p></div>`,
      });
    }
  }
}

export async function handleSendEventRegistrationConfirmation(
  payload: JobPayloadOf<'send-event-registration-confirmation'>,
  db: Kysely<Models>,
): Promise<void> {
  const registration = await db
    .selectFrom('event_registrations')
    .select(['id', 'status', 'event_id', 'person_id', 'ticket_type_id'])
    .where('id', '=', payload.registrationId)
    .executeTakeFirst();

  if (!registration || registration.status === 'cancelled') {
    logger.info(`Skipping event confirmation: registration ${payload.registrationId} not found or cancelled.`);
    return;
  }

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
    .executeTakeFirst();

  if (!event || event.send_registration_confirmation === false) {
    logger.info(`Skipping event confirmation: event ${registration.event_id} not found or confirmations disabled.`);
    return;
  }

  const person = await db
    .selectFrom('persons')
    .select(['first_name', 'email'])
    .where('id', '=', registration.person_id)
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
  const coordHtml = [
    event.contact_email ? `Email: <a href="mailto:${event.contact_email}">${event.contact_email}</a>` : '',
    event.contact_phone ? `Phone: ${event.contact_phone}` : '',
  ]
    .filter(Boolean)
    .join('<br>');

  await mailService.sendMail({
    to: person.email,
    subject: `Registration confirmed: ${event.name}`,
    text: `Hi ${person.first_name || 'there'},\n\nYou're registered for "${event.name}"!\n\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}${coordLine ? `\n\nContact:\n${coordLine}` : ''}\n\nWe look forward to seeing you there!`,
    html: `<h2>Registration confirmed</h2>
<p>Hi ${person.first_name || 'there'},</p>
<p>You're registered for <strong>"${event.name}"</strong>!</p>
<div class="panel"><p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p><p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>${coordHtml ? `<p><strong>Contact:</strong><br>${coordHtml}</p>` : ''}</div>
<p>We look forward to seeing you there!</p>`,
  });

  logger.info(`Sent registration confirmation to ${person.email} for event ${registration.event_id}`);
}

export async function handleSendEventReminder(
  payload: JobPayloadOf<'send-event-reminder'>,
  db: Kysely<Models>,
): Promise<void> {
  const registration = await db
    .selectFrom('event_registrations')
    .select(['id', 'status', 'event_id', 'person_id'])
    .where('id', '=', payload.registrationId)
    .executeTakeFirst();

  if (!registration || registration.status !== 'registered') {
    logger.info(
      `Skipping event reminder: registration ${payload.registrationId} not found or not in registered status.`,
    );
    return;
  }

  const event = await db.selectFrom('events').selectAll().where('id', '=', registration.event_id).executeTakeFirst();

  if (!event || event.send_reminder === false) {
    logger.info(`Skipping event reminder: event ${registration.event_id} not found or reminders disabled.`);
    return;
  }

  const person = await db
    .selectFrom('persons')
    .select(['first_name', 'email'])
    .where('id', '=', registration.person_id)
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

  await mailService.sendMail({
    to: person.email,
    subject: `Reminder: ${event.name} is tomorrow`,
    text: `Hi ${person.first_name || 'there'},\n\nThis is a reminder that you're registered for "${event.name}" tomorrow.\n\nDate & time: ${startFormatted} - ${endFormatted}\nLocation: ${event.location_address || 'TBD'}${mapsUrl ? `\nDirections: ${mapsUrl}` : ''}\n\nWe look forward to seeing you there!`,
    html: `<h2>Event reminder</h2>
<p>Hi ${person.first_name || 'there'},</p>
<p>This is a reminder that you're registered for <strong>"${event.name}"</strong> tomorrow.</p>
<div class="panel"><p><strong>Date &amp; time:</strong> ${startFormatted} - ${endFormatted}</p><p><strong>Location:</strong> ${event.location_address || 'TBD'}</p>${mapsUrl ? `<p><a href="${mapsUrl}" target="_blank">Open in Google Maps</a></p>` : ''}</div>
<p>We look forward to seeing you there!</p>`,
  });

  logger.info(`Sent event reminder to ${person.email} for event ${registration.event_id}`);
}

export async function handleSendTransactionalEmail(payload: JobPayloadOf<'send-transactional-email'>): Promise<void> {
  await mailService.sendMail({
    to: payload.to,
    subject: payload.subject ?? '',
    text: payload.text ?? '',
    html: payload.html ?? '',
    tenant_id: payload.tenant_id ?? null,
    notificationSettingsLink: payload.notificationSettingsLink ?? undefined,
  });
}

export async function handleSendSms(payload: JobPayloadOf<'send-sms'>): Promise<void> {
  await smsService.sendSms({ to: payload.to, body: payload.body });
}

export async function handleSendSubscriptionConfirmation(
  payload: JobPayloadOf<'send-subscription-confirmation'>,
): Promise<void> {
  await mailService.sendMail({
    to: payload.email,
    subject: 'Please confirm your subscription',
    text: `Hi ${payload.firstName || 'there'},\n\nPlease confirm your subscription by visiting the link below:\n\n${payload.confirmUrl}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `<h2>Confirm your subscription</h2>
<p>Hi ${payload.firstName || 'there'},</p>
<p>Please confirm your subscription by clicking the button below:</p>
<div class="btn-container">
  <a href="${payload.confirmUrl}" class="btn">Confirm subscription</a>
</div>
<p class="warning">If you did not request this, you can safely ignore this email.</p>`,
  });
}

export async function handleCheckDueTasks(db: Kysely<Models>): Promise<void> {
  await checkDueTasks(db);

  await scheduleNextRun(db, 'check_due_tasks', DAY_MS);
}

export async function checkDueTasks(db: Kysely<Models>): Promise<void> {
  const now = new Date();
  try {
    const dueTasks = await db
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
      .where('tasks.due_at', '<=', now)
      .orderBy('tasks.due_at', 'asc')
      .execute();

    if (dueTasks.length === 0) return;

    const userTasksMap = new Map<string, typeof dueTasks>();
    for (const row of dueTasks) {
      const userId = String(row.user_id);
      let userTasks = userTasksMap.get(userId);
      if (!userTasks) {
        userTasks = [];
        userTasksMap.set(userId, userTasks);
      }
      userTasks.push(row);
    }

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

        await mailService.sendMail({
          to: userEmail,
          subject: `You have ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} due or overdue`,
          text: textContent,
          html: htmlContent,
          notificationSettingsLink: true,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check and notify due tasks');
  }
}
