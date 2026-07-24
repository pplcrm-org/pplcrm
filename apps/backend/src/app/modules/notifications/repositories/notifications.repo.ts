import { BaseRepository } from '../../../lib/base.repo';
import type { Transaction } from 'kysely';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export class NotificationsRepo extends BaseRepository<'notifications'> {
  constructor() {
    super('notifications');
  }

  public async getUnreadCount(tenant_id: string, user_id: string, trx?: Transaction<Models>): Promise<number> {
    const res = await this.getSelect(trx)
      .select((eb) => eb.fn.count('id').as('count'))
      .where('tenant_id', '=', tenant_id)
      .where('user_id', '=', user_id)
      .where('read', '=', false)
      .executeTakeFirst();
    return Number(res?.count ?? 0);
  }

  public async getLatestForUser(tenant_id: string, user_id: string, limit = 20, offset = 0, trx?: Transaction<Models>) {
    let query = this.getSelect(trx)
      .selectAll()
      .where('tenant_id', '=', tenant_id)
      .where('user_id', '=', user_id)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (offset > 0) {
      query = query.offset(offset);
    }

    return query.execute();
  }

  public async markAllRead(tenant_id: string, user_id: string, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ read: true })
      .where('tenant_id', '=', tenant_id)
      .where('user_id', '=', user_id)
      .where('read', '=', false)
      .execute();
  }

  /**
   * Mark ONE notification read — scoped by user_id as well as tenant_id + id. The id is a global
   * bigserial (enumerable), so scoping by tenant + id alone would let a user mark (and, via a
   * returning-all update, read) another tenant-mate's notification. Returns nothing sensitive.
   */
  public async markRead(tenant_id: string, user_id: string, id: string, trx?: Transaction<Models>): Promise<void> {
    await this.getUpdate(trx)
      .set({ read: true })
      .where('tenant_id', '=', tenant_id)
      .where('user_id', '=', user_id)
      .where('id', '=', id)
      .execute();
  }

  public async pushNotification(
    input: {
      tenant_id: string;
      user_id: string;
      title: string;
      message: string;
      type: string;
      link?: string | null;
    },
    trx?: Transaction<Models>,
  ) {
    const row = {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      title: input.title,
      message: input.message,
      type: input.type,
      read: false,
      link: input.link ?? null,
    } as OperationDataType<'notifications', 'insert'>;
    return this.add({ row }, trx);
  }
}
