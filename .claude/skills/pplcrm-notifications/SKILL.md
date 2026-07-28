---
name: pplcrm-notifications
description: How user-facing notifications work (in-app bell + email pairs behind per-user preferences) and every file you must touch when adding a new notification type. USE WHEN adding/changing a notification, adding a NotificationPreferencesObj key, or when a notification is sent but not received. EXAMPLES 'notify the assignee when X', 'add a notification preference toggle', 'the bell never shows my notification'.
---

# Notifications (in-app bell + email)

Every user-facing notification comes as a **pair**: an email (via
`TransactionalEmailService.sendMail`, or `enqueueMail` inside a transaction) and an
in-app bell entry (`NotificationsRepo.pushNotification` → `notifications` table →
navbar bell, 60s poll). Each half is gated by its own per-user preference:
`<key>` (email) and `<key>_in_app`, both default **true** (opt-out) via
`notificationEnabled(profile_preferences, key)` from `lib/profile-preferences.ts`.

**One key bends that rule:** `companion_approval_sms` is a standalone **third channel**
(text message) with no `_in_app` twin. It is still opt-out (`default(true)`, read with the
same `notificationEnabled()`), because the failure it prevents — an unapproved volunteer
standing at a door unable to work while nobody notices — is worse than the interruption a
text causes. Its email and bell halves are unconditional (see
`notifyAdminsOfPendingVolunteer`), which is why the matrix leaves those two cells **empty**
rather than showing toggles that would govern nothing. An admin with no `profiles.mobile`
is never texted, so the practical blast radius is people who deliberately added a number.

## Canonical sender pattern

See `modules/tasks/controller.ts` (`task_assigned`) or `modules/emails/controller.ts`
(`email_assigned`): look up the assignee from `authusers` left-joined to
`profiles` (for `preferences`), tenant-scoped, then gate each half independently.
Skip notifying when actor == recipient (self-assignment stays silent). Wrap in
try/catch — a notification failure must never fail the business mutation.

## Adding a new preference key — ALL of these, or the build/tests break

1. `libs/common/src/lib/schemas/auth.schema.ts` — `NotificationPreferencesObj` (the source type).
2. `apps/backend/src/app/modules/auth/controller.ts` → `sanitizeUser()` defaults object (frontend build fails on the missing property otherwise).
3. `apps/frontend/.../settings/personal-settings-dialog/personal-settings-dialog.ts` — `NOTIF_ROWS` entry + `persistNotifications()` payload.
4. `apps/frontend/.../settings/settings.config.ts` — the `notifications` section field pair (`notifications.<key>` + `notifications.<key>_in_app`). A `_sms` suffix gets its own Text column; a `_sms` key with no email twin becomes a standalone row (`getNotificationGroups` in settings-page.ts pairs by suffix, and both matrices render an empty cell for a missing channel).
5. `apps/frontend/.../settings/settings-page.ts` — three spots: `loadUserPrefs` fallback object, the `notifications_<key>` payload mapping, and `saveSection`'s `parseBool` mapping.
6. `apps/frontend/.../settings/settings-page.spec.ts` — the notification-group **count assertion** (`groups.length`).
7. Help Center prose if the feature is user-visible (`libs/common/src/lib/help/articles/*`).

## Traps

- `notifications.user_id` = `authusers.id` (FK, ON DELETE CASCADE); `type` is free
  text; `link` is an app-relative path the bell navigates to on click.
- Integration specs that trigger notifications must clean up `notifications` AND
  `user_activity` rows before deleting `authusers` (FK violations otherwise).
- Companion volunteers are NOT users — the pending-approval flow notifies every
  tenant admin/owner (`companion-access/controller.ts` → `notifyAdminsOfPendingVolunteer`),
  unconditionally (no preference key, deliberate). It also mints a per-admin
  approve-by-text token and, for the **inviter only**, texts them a one-tap approval
  link when `companion_approval_sms` is on and `profiles.mobile` normalizes.
- Staff have no phone on `authusers`. `profiles.mobile` is the only staff number, and
  the approval SMS above is the **only** staff-facing SMS in the notification system;
  everything else on Twilio goes to companion volunteers (verification codes, assignment
  link delivery via `lib/mail/volunteer-link-notify.ts`) or to ops alerts.
