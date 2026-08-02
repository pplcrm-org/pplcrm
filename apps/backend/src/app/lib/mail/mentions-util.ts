import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';
import { NotificationsRepo } from '../../modules/notifications/repositories/notifications.repo';
import { notificationEnabled } from '../profile-preferences';
import { sendMailOrDrop } from './send-or-drop';
import { TransactionalEmailService } from './transactional-mail.service';

/** In-app notification links are app-relative paths; comment links arrive absolute. */
function toRelativeLink(link: string): string {
  try {
    const url = new URL(link);
    return `${url.pathname}${url.search}`;
  } catch {
    return link;
  }
}

/** The notification list clamps long messages; keep the quoted comment short. */
function truncateComment(text: string, limit = 140): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

export async function processMentions(
  db: Kysely<Models>,
  tenantId: string,
  commentText: string,
  commentLink: string,
  authorId: string,
): Promise<void> {
  if (!commentText || !commentText.trim()) return;

  // Find matches for @username (characters, numbers, dots, dashes, underscores)
  const matches = [...commentText.matchAll(/\B@([a-zA-Z0-9._-]+)/g)].flatMap((m) => (m[1] ? [m[1].toLowerCase()] : []));
  if (matches.length === 0) return;

  try {
    // Retrieve all users in the tenant
    const users = await db
      .selectFrom('authusers')
      .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
      .select([
        'authusers.id',
        'authusers.email',
        'authusers.first_name',
        'profiles.preferences as profile_preferences',
      ])
      .where('authusers.tenant_id', '=', tenantId)
      // Deleted users keep their row for foreign-key integrity, with their identity scrubbed in
      // place. Matching an @mention against a tombstone would address a scrubbed value, so they
      // are excluded here exactly as they are from the users grid and assignee pickers.
      .where('authusers.deleted_at', 'is', null)
      .execute();

    const mailService = new TransactionalEmailService({ defaultAudience: 'staff' });
    const notificationsRepo = new NotificationsRepo();

    // Map over matching users and send them notifications
    for (const user of users) {
      const userIdStr = String(user.id);
      if (userIdStr === String(authorId)) continue; // Don't notify the author

      const emailPrefix = user.email.split('@')[0]?.toLowerCase() || '';
      const firstNameLower = user.first_name?.toLowerCase() || '';

      // Match either @first_name or the email username prefix (e.g. @john)
      const isMentioned = matches.includes(firstNameLower) || matches.includes(emailPrefix);
      if (!isMentioned) continue;

      // One recipient at a time. Everything here used to sit directly under the function-level
      // catch below, so the first failure — a mail provider fault, or the anti-abuse gate
      // refusing to send for this workspace — abandoned every person mentioned after them in the
      // same comment, silently. Notifying four of five people is strictly better than notifying
      // one, so a failure is recorded against that recipient and the loop carries on.
      try {
        if (notificationEnabled(user.profile_preferences, 'mention_in_comment_in_app')) {
          await notificationsRepo.pushNotification({
            tenant_id: tenantId,
            user_id: userIdStr,
            title: 'Mentioned in a Comment',
            message: `You were mentioned in a comment: "${truncateComment(commentText)}"`,
            type: 'mention',
            link: toRelativeLink(commentLink),
          });
        }

        if (user.email && notificationEnabled(user.profile_preferences, 'mention_in_comment')) {
          await sendMailOrDrop(
            mailService,
            {
              to: user.email,
              subject: 'You were mentioned in pplCRM',
              tenant_id: tenantId,
              notificationSettingsLink: true,
              text: `Hi ${user.first_name || 'there'},\n\nYou were mentioned in a comment:\n\n"${commentText}"\n\nView the comment: ${commentLink}`,
              html: `<h2>You were mentioned</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>You were mentioned in a comment:</p>
<div class="panel"><p>"${commentText}"</p></div>
<div class="btn-container">
  <a href="${commentLink}" class="btn">View comment</a>
</div>`,
            },
            'comment mention',
          );
        }
      } catch (perUserError) {
        logger.error(
          { err: perUserError, tenantId, userId: userIdStr },
          'Failed to notify one mentioned user; continuing with the rest',
        );
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to process comment mentions');
  }
}
