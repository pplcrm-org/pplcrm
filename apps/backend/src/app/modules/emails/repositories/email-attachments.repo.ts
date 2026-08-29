import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import type { HasRow } from '../../../../../../../libs/common/src/lib/emails';

export class EmailAttachmentsRepo extends BaseRepository<'email_attachments'> {
  constructor() {
    super('email_attachments');
  }

  public getAllAttachments(tenant_id: string, email_id: string, opts?: { includeInline?: boolean }) {
    let q = this.selectBy('email_id', { tenant_id, value: email_id }).orderBy('pos', 'asc');

    if (!opts?.includeInline) q = q.where('is_inline', '=', false);

    return q.execute();
  }

  public getByEmailId(tenant_id: string, email_id: string) {
    return this.getManyBy('email_id', { tenant_id, value: email_id });
  }

  public getCountByEmails(tenant_id: string) {
    return this.getSelect()
      .select(['email_id'])
      .select(({ fn }) => fn.count('id').as('attachment_count'))
      .where('tenant_id', '=', tenant_id)
      .groupBy('email_id')
      .execute();
  }

  // getSelectForCountByEmails was removed: joining that grouped derived table forced Postgres to
  // aggregate the tenant's WHOLE attachments table per inbox page; the inbox list now reads the
  // count with a correlated per-row subselect instead (email.repo.ts).

  public async hasAttachment(tenant_id: string, email_id: string): Promise<boolean> {
    const row = await this.getSelect()
      .select(({ val }) => val(1).as('one'))
      .where('tenant_id', '=', tenant_id)
      .where('email_id', '=', email_id)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  public hasAttachmentByEmailIds(tenant_id: string, ids: string[]): Promise<HasRow[]> {
    if (!ids?.length) return Promise.resolve([]);

    return this.getSelect()
      .select(['email_id'])
      .select(() => sql<boolean>`count(id) > 0`.as('has'))
      .where('tenant_id', '=', tenant_id)
      .where('email_id', 'in', ids)
      .groupBy('email_id')
      .execute() as Promise<HasRow[]>;
  }
}
