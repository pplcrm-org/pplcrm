import type { EmailStatus } from '../../../../../../../libs/common/src';
import type { TypeTenantId } from '../../../../../../../libs/common/src/lib/kysely.models';
import { SPECIAL_FOLDERS } from '../../../../../../../libs/common/src';

import type { UpdateResult } from 'kysely';
import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import { EmailAttachmentsRepo } from './email-attachments.repo';
import { EmailHeadersRepo } from './email-headers.repo';
import { EmailRecipientsRepo } from './email-recipients.repo';
import { EmailTrashRepo } from './email-trash.repo';
import { ALL_FOLDERS } from '../../../../../../../libs/common/src/lib/emails';

export class EmailRepo extends BaseRepository<'emails'> {
  private emailAttachmentsRepo = new EmailAttachmentsRepo();
  private emailHeadersRepo = new EmailHeadersRepo();
  private emailRecipientsRepo = new EmailRecipientsRepo();
  private emailTrashRepo = new EmailTrashRepo();

  constructor() {
    super('emails');
  }

  /** Open Inbox conversations assigned to this user — the "Mine" triage count,
   *  as a single cheap scalar for the sidebar badge. */
  public async countAssignedOpen(user_id: string, tenant_id: string, campaign_id: string): Promise<number> {
    const row = await this.getSelect()
      .select((eb) => eb.fn.countAll().as('count'))
      .where('tenant_id', '=', tenant_id)
      .where('campaign_id', '=', campaign_id)
      .where('assigned_to', '=', user_id)
      .where('status', '=', 'open')
      .where('folder_id', '=', ALL_FOLDERS.INBOX)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  public async emptyTrash(tenantId: string) {
    return this.transaction().execute(async (trx) => {
      const trashId = ALL_FOLDERS.TRASH;

      const res = await this.getDelete(trx)
        .where('tenant_id', '=', tenantId)
        .where('folder_id', '=', trashId)
        .executeTakeFirst();

      // email_trash rows should be cleaned via FK ON DELETE CASCADE
      return Number(res.numDeletedRows ?? 0);
    });
  }

  public async getAttachmentsByEmailId(tenant_id: string, email_id: string) {
    return this.emailAttachmentsRepo.getByEmailId(tenant_id, email_id);
  }

  public async getByFolder(user_id: string, tenant_id: string, folder_id: string) {
    const whereForFolder = this.buildFolderPredicate(folder_id, user_id);

    const query = this.getSelect()
      .selectAll()
      .where('tenant_id', '=', tenant_id)
      .where((eb) => whereForFolder(eb));

    return query.execute();
  }

  public async getByFolderWithAttachmentFlag(
    user_id: string,
    tenant_id: string,
    campaign_id: string,
    folder_id: string,
    limit?: number,
    offset?: number,
  ): Promise<any[]> {
    const whereForFolder = this.buildFolderPredicate(folder_id, user_id);

    // Subquery: SELECT email_id, COUNT(*)::int AS att_count FROM email_attachments ... GROUP BY email_id
    const ea = this.emailAttachmentsRepo.getSelectForCountByEmails(tenant_id); // should be aliased as 'ea'

    let q = this.getSelect()
      .leftJoin(ea, 'ea.email_id', 'emails.id')
      .leftJoin('email_headers as eh', 'eh.email_id', 'emails.id')
      .leftJoin('email_read_states as ers', (join) =>
        join
          .onRef('ers.email_id', '=', 'emails.id')
          .on('ers.user_id', '=', user_id)
          .on('ers.tenant_id', '=', tenant_id),
      )
      .leftJoin('persons as p_sender', (join) =>
        join
          .onRef('p_sender.tenant_id', '=', 'emails.tenant_id')
          .on(
            sql`lower(p_sender.email) = lower(emails.from_email) or lower(p_sender.email2) = lower(emails.from_email)`,
          ),
      )
      // `date_sent` now comes from selectAll('emails') — it is denormalized onto the row and kept
      // in step with the header, so selecting eh.date_sent as well would duplicate the alias.
      .selectAll('emails')
      .select('p_sender.first_name as sender_first_name')
      .select('p_sender.last_name as sender_last_name')
      // numeric count (coalesced to 0)
      .select(sql<number>`COALESCE(ea.att_count, 0)`.as('attachment_count'))
      // boolean has_attachment via EXISTS (fast)
      .select((eb) =>
        eb
          .exists(
            eb
              .selectFrom('email_attachments as a')
              .select('a.id')
              .whereRef('a.tenant_id', '=', 'emails.tenant_id')
              .whereRef('a.email_id', '=', 'emails.id'),
          )
          .as('has_attachment'),
      )
      .select((eb) => eb.fn.coalesce(eb.ref('ers.is_read'), eb.val(false)).as('is_read'))
      .where('emails.tenant_id', '=', tenant_id)
      .where('emails.campaign_id', '=', campaign_id)
      .where((eb) => whereForFolder(eb))
      // One indexed column on one table (idx_emails_inbox_sort, added by the 2026-07-26 sort-indexes migration). This was
      // `coalesce(eh.date_sent, emails.created_at)` — a COALESCE across a join, which no index
      // can serve, so every page load fetched the tenant's whole mailbox and sorted it externally.
      .orderBy('emails.date_sent', 'desc')
      // Paging tiebreaker: timestamps collide (bulk syncs land whole batches with
      // identical date_sent), and without a unique sort key limit/offset pages can
      // repeat or skip rows. `emails.id` makes the order total and stable.
      .orderBy('emails.id', 'desc');

    if (typeof limit === 'number') q = q.limit(limit);
    if (typeof offset === 'number') q = q.offset(offset);

    return q.execute();
  }

  public async getByIdsInFolder(tenant_id: string, emailIds: string[], folder_id: string) {
    if (!emailIds?.length) return [];
    return this.getSelect()
      .selectAll()
      .where('tenant_id', '=', tenant_id)
      .where('folder_id', '=', folder_id)
      .where('id', 'in', emailIds)
      .execute();
  }

  public async getEmailCountsByFolder(
    user_id: string,
    tenant_id: string,
    campaign_id: string,
  ): Promise<Record<string, number>> {
    // 1) Regular per-folder counts
    const regular = await this.getSelect()
      .select(['folder_id'])
      .select((eb) => eb.fn.count('id').as('count'))
      .where('tenant_id', '=', tenant_id)
      .where('campaign_id', '=', campaign_id)
      .groupBy('folder_id')
      .execute();

    // 2) Virtual counts (tenant-wide, not grouped) + Inbox unread count
    const virtual = await this.getSelect()
      .leftJoin('email_read_states as ers', (join) =>
        join
          .onRef('ers.email_id', '=', 'emails.id')
          .on('ers.user_id', '=', user_id)
          .on('ers.tenant_id', '=', tenant_id),
      )
      .select(() => [
        sql<number>`count(*) filter (where status = 'open' and folder_id = ${ALL_FOLDERS.INBOX})`.as('all_open'),
        sql<number>`count(*) filter (where status = 'closed' and folder_id = ${ALL_FOLDERS.INBOX})`.as('closed'),
        sql<number>`count(*) filter (where assigned_to = ${user_id} and status = 'open' and folder_id = ${ALL_FOLDERS.INBOX})`.as(
          'assigned',
        ),
        sql<number>`count(*) filter (where assigned_to is null and status = 'open' and folder_id = ${ALL_FOLDERS.INBOX})`.as(
          'unassigned',
        ),
        sql<number>`count(*) filter (where is_favourite = true and status = 'open' and folder_id = ${ALL_FOLDERS.INBOX})`.as(
          'favourites',
        ),
        sql<number>`count(*) filter (where folder_id = ${ALL_FOLDERS.INBOX} and (ers.is_read is not true))`.as(
          'inbox_unread',
        ),
      ])
      .where('emails.tenant_id', '=', tenant_id)
      .where('emails.campaign_id', '=', campaign_id)
      .executeTakeFirst();

    const counts: Record<string, number> = {};

    // Real folders
    for (const row of regular) {
      counts[row.folder_id] = Number(row.count ?? 0);
    }

    // Override Inbox count with the unread count
    counts[ALL_FOLDERS.INBOX] = Number(virtual?.inbox_unread ?? 0);

    // Virtual folders (COALESCE to 0 if tenant has no emails)
    counts[SPECIAL_FOLDERS.ALL_OPEN] = Number(virtual?.all_open ?? 0);
    counts[SPECIAL_FOLDERS.CLOSED] = Number(virtual?.closed ?? 0);
    counts[SPECIAL_FOLDERS.ASSIGNED_TO_ME] = Number(virtual?.assigned ?? 0);
    counts[SPECIAL_FOLDERS.UNASSIGNED] = Number(virtual?.unassigned ?? 0);
    counts[SPECIAL_FOLDERS.FAVOURITES] = Number(virtual?.favourites ?? 0);

    return counts;
  }

  public async getEmailWithHeadersAndRecipients(tenant_id: string, email_id: string, user_id?: string) {
    let query = this.getSelect()
      .selectAll('emails')
      .where('emails.tenant_id', '=', tenant_id)
      .where('emails.id', '=', email_id);

    if (user_id) {
      query = query
        .leftJoin('email_read_states as ers', (join) =>
          join
            .onRef('ers.email_id', '=', 'emails.id')
            .on('ers.user_id', '=', user_id)
            .on('ers.tenant_id', '=', tenant_id),
        )
        .select((eb) => eb.fn.coalesce(eb.ref('ers.is_read'), eb.val(false)).as('is_read'));
    }

    const email = await query.executeTakeFirst();
    if (!email) return null;

    const emailHeaders = await this.emailHeadersRepo.getByEmailId(tenant_id, email_id);

    const [toRecipients, ccRecipients, bccRecipients] = await Promise.all([
      this.emailRecipientsRepo.getByEmailIdAndKind(tenant_id, email_id, 'to'),
      this.emailRecipientsRepo.getByEmailIdAndKind(tenant_id, email_id, 'cc'),
      this.emailRecipientsRepo.getByEmailIdAndKind(tenant_id, email_id, 'bcc'),
    ]);

    return {
      ...email,
      headers_json: emailHeaders?.headers_json ?? null,
      raw_headers: emailHeaders?.raw_headers ?? null,
      date_sent: emailHeaders?.date_sent ?? null,
      to_list: toRecipients,
      cc_list: ccRecipients,
      bcc_list: bccRecipients,
    };
  }

  public async hasAttachments(tenant_id: string, email_id: string): Promise<boolean> {
    return this.emailAttachmentsRepo.hasAttachment(tenant_id, email_id);
  }

  public async assignEmail(tenant_id: string, id: string, user_id: string | null) {
    return this.getUpdate()
      .set({ assigned_to: user_id })
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  public async getAssignmentStats(input: { tenant_id: string; user_id: string }) {
    const row = await this.getSelect()
      .select(() => [
        sql<number>`count(*)`.as('total'),
        sql<number>`count(*) filter (where status = 'open')`.as('open'),
        sql<number>`count(*) filter (where status = 'closed')`.as('closed'),
      ])
      .where('tenant_id', '=', input.tenant_id)
      .where('assigned_to', '=', input.user_id)
      .executeTakeFirst();

    return {
      total: Number(row?.total ?? 0),
      open: Number(row?.open ?? 0),
      closed: Number(row?.closed ?? 0),
    };
  }

  public async moveToTrash(tenant_id: string, emailIds: string[]) {
    if (!emailIds?.length) return 0;

    return this.transaction().execute(async (trx) => {
      const trashFolderId = ALL_FOLDERS.TRASH;

      // Remember provenance (skip ones already in Trash)
      await this.emailTrashRepo.addFromEmails({ tenant_id, emailIds, folder_id: trashFolderId }, trx);

      const res = (await this.getUpdate(trx)
        .set({ folder_id: trashFolderId, deleted_at: new Date() })
        .where('tenant_id', '=', tenant_id)
        .where('id', 'in', emailIds)
        .executeTakeFirst()) as unknown as UpdateResult;

      return Number(res.numUpdatedRows ?? 0);
    });
  }

  public async restoreFromTrash(tenantId: string, emailIds: string[]): Promise<number> {
    if (!emailIds?.length) return 0;

    return this.transaction().execute(async (trx) => {
      // UPDATE emails e
      // SET folder_id = et.from_folder_id, deleted_at = null
      // FROM email_trash et
      // WHERE e.tenant_id = et.tenant_id AND e.id = et.email_id
      //   AND e.tenant_id = :tenantId AND e.id IN (:emailIds)

      const updated = (await this.getUpdate(trx)
        .set({
          folder_id: sql`et.from_folder_id`,
          deleted_at: null,
        })
        .from('email_trash as et')
        .whereRef('et.tenant_id', '=', 'emails.tenant_id')
        .whereRef('et.email_id', '=', 'emails.id')
        .where('emails.tenant_id', '=', tenantId)
        .where('emails.id', 'in', emailIds)
        .executeTakeFirst()) as unknown as UpdateResult;

      // Clean up only the provenance rows we used
      await this.emailTrashRepo.deleteByEmailIds({ tenant_id: tenantId as TypeTenantId<'email_trash'>, emailIds }, trx);

      return Number(updated?.numUpdatedRows ?? 0);
    });
  }

  public async setFavourite(tenant_id: string, id: string, is_favourite: boolean) {
    await this.getUpdate()
      .set({ is_favourite })
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', id)
      .executeTakeFirst();

    return is_favourite;
  }

  public async setStatus(tenant_id: string, id: string, status: EmailStatus) {
    await this.getUpdate().set({ status }).where('tenant_id', '=', tenant_id).where('id', '=', id).executeTakeFirst();
    return status;
  }

  private buildFolderPredicate(folder_id: string, user_id: string): (eb: any) => any {
    switch (folder_id) {
      case SPECIAL_FOLDERS.ALL_OPEN:
        return (eb) => eb.and([eb('emails.status', '=', 'open'), eb('emails.folder_id', '=', ALL_FOLDERS.INBOX)]);
      case SPECIAL_FOLDERS.CLOSED:
        return (eb) => eb.and([eb('emails.status', '=', 'closed'), eb('emails.folder_id', '=', ALL_FOLDERS.INBOX)]);
      case SPECIAL_FOLDERS.ASSIGNED_TO_ME:
        return (eb) =>
          eb.and([
            eb('emails.assigned_to', '=', user_id),
            eb('emails.status', '=', 'open'),
            eb('emails.folder_id', '=', ALL_FOLDERS.INBOX),
          ]);
      case SPECIAL_FOLDERS.UNASSIGNED:
        return (eb) =>
          eb.and([
            eb('emails.assigned_to', 'is', null),
            eb('emails.status', '=', 'open'),
            eb('emails.folder_id', '=', ALL_FOLDERS.INBOX),
          ]);
      case SPECIAL_FOLDERS.FAVOURITES:
        return (eb) =>
          eb.and([
            eb('emails.is_favourite', '=', true),
            eb('emails.status', '=', 'open'),
            eb('emails.folder_id', '=', ALL_FOLDERS.INBOX),
          ]);
      default:
        // Real folder
        return (eb) => eb('emails.folder_id', '=', folder_id);
    }
  }
}
