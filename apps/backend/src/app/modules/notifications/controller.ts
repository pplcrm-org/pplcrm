import { BaseController } from '../../lib/base.controller';
import { NotificationsRepo } from './repositories/notifications.repo';
import type { IAuthKeyPayload } from '../../../../../../libs/common/src/lib/auth';

export class NotificationsController extends BaseController<'notifications', NotificationsRepo> {
  constructor() {
    super(new NotificationsRepo());
  }

  public async getLatest(auth: IAuthKeyPayload, limit?: number, offset?: number) {
    return this.getRepo().getLatestForUser(auth.tenant_id, auth.user_id, limit, offset);
  }

  public async getUnreadCount(auth: IAuthKeyPayload) {
    return this.getRepo().getUnreadCount(auth.tenant_id, auth.user_id);
  }

  public async markAllAsRead(auth: IAuthKeyPayload) {
    return this.getRepo().markAllRead(auth.tenant_id, auth.user_id);
  }

  public async markRead(id: string, auth: IAuthKeyPayload): Promise<{ id: string }> {
    // Scope by user_id (not just tenant_id + the enumerable global id) so a user can never
    // mark-read — and, via BaseController.update's returningAll, read — another user's notification.
    await this.getRepo().markRead(auth.tenant_id, auth.user_id, id);
    return { id };
  }
}
