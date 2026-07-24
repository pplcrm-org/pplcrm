import { env } from '../../../env';
import { getAllEmailFolders } from '../../config/email-folders.config';
import { AppError, BadRequestError, InternalError, NotFoundError } from '../../errors/app-errors';
import { EmailAttachmentsRepo } from './repositories/email-attachments.repo';
import { EmailBodiesRepo } from './repositories/email-body.repo';
import { EmailCommentsRepo } from './repositories/email-comments.repo';
import { EmailDraftsRepo } from './repositories/email-drafts.repo';
import { EmailRepo } from './repositories/email.repo';
import { BaseController } from '../../lib/base.controller';
import type { EmailStatus } from '../../../../../../libs/common/src/lib/emails';
import { ALL_FOLDERS } from '../../../../../../libs/common/src/lib/emails';
import type { Models, TypeTenantId } from '../../../../../../libs/common/src/lib/kysely.models';
import type { Selectable } from 'kysely';
import type { EmailDraftType } from '../../../../../../libs/common/src/lib/models';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { notificationEnabled } from '../../lib/profile-preferences';
import { UserActivityRepo } from '../../lib/user-activity.repo';
import { processMentions } from '../../lib/mail/mentions-util';
import { sanitizeHtml } from '../../lib/mail/sanitize-util';
import { StorageService } from '../../lib/storage.service';
import { signedEmailAttachmentUrl } from '../../lib/signed-download';
import { sql } from 'kysely';
import { logger } from '../../logger';

export class EmailsController extends BaseController<'emails', EmailRepo> {
  private attachmentsRepo = new EmailAttachmentsRepo();
  private bodiesRepo = new EmailBodiesRepo();
  private commentsRepo = new EmailCommentsRepo();
  private draftsRepo = new EmailDraftsRepo();
  private activityRepo = new UserActivityRepo();
  private mailService = new TransactionalEmailService();
  private storageService = new StorageService();

  constructor() {
    super(new EmailRepo());
  }

  public async addComment(tenant_id: string, email_id: string, author_id: string, comment: string) {
    if (!comment?.trim()) {
      throw new BadRequestError('Comment cannot be empty');
    }
    try {
      const row = await this.commentsRepo.add({
        row: {
          tenant_id,
          email_id,
          author_id,
          comment,
          createdby_id: author_id,
          updatedby_id: author_id,
        },
      });
      if (!row) throw new InternalError('Failed to add comment');

      const commentLink = `${env.appUrl}/emails/${email_id}`;
      processMentions(this.commentsRepo.db, tenant_id, comment, commentLink, author_id).catch((err) =>
        logger.error({ err }, 'Failed to process email comment mentions'),
      );

      return row;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to add comment', undefined, { cause: err });
    }
  }

  public async assignEmail(
    tenant_id: string,
    id: string,
    user_id: string | null,
    actor_id?: string,
    assigned_to_name?: string | null,
  ) {
    try {
      const updated = await this.getRepo().assignEmail(tenant_id, id, user_id);

      if (!updated) throw new NotFoundError('Email not found');

      // --- Log activity ---
      if (actor_id) {
        const activityType = user_id ? 'assign' : 'unassign';
        const metadata: Record<string, unknown> = {};
        if (user_id) metadata['assigned_to_id'] = user_id;
        if (assigned_to_name) metadata['assigned_to_name'] = assigned_to_name;

        this.activityRepo
          .log({
            tenant_id,
            user_id: actor_id,
            activity: activityType,
            entity: 'email',
            entity_id: id,
            metadata,
          })
          .catch((e) => logger.error({ err: e }, 'Failed to log email assign activity'));
      }

      // Notify the assignee (in-app + email, each behind its own preference).
      // Self-assignment ("I'll take it") stays silent — you already know.
      if (user_id && user_id !== actor_id) {
        try {
          const email = (await this.getRepo().getOneBy('id', { tenant_id, value: id })) as
            | Selectable<Models['emails']>
            | undefined;
          if (email) {
            const subject = email.subject || '(No Subject)';
            const assignee = await this.getRepo()
              .db.selectFrom('authusers')
              .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
              .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
              .where('authusers.tenant_id', '=', tenant_id)
              .where('authusers.id', '=', user_id)
              .executeTakeFirst();
            if (assignee && notificationEnabled(assignee.profile_preferences, 'email_assigned_in_app')) {
              const notificationsRepo = new NotificationsRepo();
              await notificationsRepo.pushNotification({
                tenant_id,
                user_id,
                title: 'Email Assigned',
                message: `You have been assigned the email: "${subject}"`,
                type: 'email',
                link: `/inbox?email=${id}`,
              });
            }
            if (assignee?.email && notificationEnabled(assignee.profile_preferences, 'email_assigned')) {
              await this.mailService.sendMail({
                to: assignee.email,
                subject: `New email assigned: ${subject}`,
                notificationSettingsLink: true,
                text: `Hi ${assignee.first_name},\n\nAn inbox conversation has been assigned to you: "${subject}".\n\nView it: ${env.appUrl}/inbox?email=${id}`,
                html: `<h2>Email assigned to you</h2>
<p>Hi ${assignee.first_name},</p>
<p>An inbox conversation has been assigned to you: <strong>"${subject}"</strong>.</p>
<div class="btn-container">
  <a href="${env.appUrl}/inbox?email=${id}" class="btn">Open in Inbox</a>
</div>`,
                tenant_id,
              });
            }
          }
        } catch (nErr) {
          logger.error({ err: nErr }, 'Failed to notify assignee of email assignment');
        }
      }

      return updated;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to assign email', undefined, { cause: err });
    }
  }

  /** Sidebar Inbox badge: open Inbox conversations assigned to this user. */
  public async countAssignedOpen(user_id: string, tenant_id: string, campaign_id: string) {
    try {
      return await this.getRepo().countAssignedOpen(user_id, tenant_id, campaign_id);
    } catch (err) {
      throw new InternalError('Failed to count assigned open emails', undefined, { cause: err });
    }
  }

  public async getActivitiesForEmail(tenant_id: string, email_id: string) {
    try {
      const res = await this.activityRepo.getForEntity(tenant_id, 'email', email_id);
      return res.rows;
    } catch (err) {
      throw new InternalError('Failed to fetch email activities', undefined, { cause: err });
    }
  }

  public override async delete(tenant_id: TypeTenantId<'emails'>, idToDelete: string) {
    return this.deleteMany(tenant_id, [idToDelete]);
  }

  public async deleteComment(tenant_id: string, _email_id: string, comment_id: string) {
    try {
      const deleted = await this.commentsRepo.delete({ tenant_id, id: comment_id /*, email_id */ });
      if (!deleted) throw new NotFoundError('Comment not found');
      return deleted;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to delete comment', undefined, { cause: err });
    }
  }

  public async deleteDraft(tenant_id: string, _user_id: string, id: string) {
    try {
      const deleted = await this.draftsRepo.delete({ tenant_id, id });
      if (!deleted) throw new NotFoundError('Draft not found');
      return deleted;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to delete draft', undefined, { cause: err });
    }
  }

  public override async deleteMany(tenant_id: TypeTenantId<'emails'>, idsToDelete: string[]) {
    // Go through idsToDelete and check which ones are in the trash folder (hard delete)
    // and which ones are not (soft delete - move to trash)
    const emailsInTrash = await this.getRepo().getByIdsInFolder(tenant_id as string, idsToDelete, ALL_FOLDERS.TRASH);
    const idsInTrash = emailsInTrash.map((e) => String(e.id));
    const idsNotInTrash = idsToDelete.filter((id) => !idsInTrash.includes(id));

    const numTrashed =
      idsNotInTrash.length > 0 ? await this.getRepo().moveToTrash(tenant_id as string, idsNotInTrash) : 0;

    let numDeleted: number | boolean = false;
    if (idsInTrash.length > 0) {
      // Capture the attachment file references BEFORE the cascade removes the
      // email_attachments rows, so we can clean up storage afterwards.
      const fileIds = await this.getAttachmentFileIds(tenant_id as string, idsInTrash);
      numDeleted = await super.deleteMany(tenant_id, idsInTrash);
      // Hard delete is permanent — purge orphaned attachment blobs + file rows.
      await this.purgeOrphanedFiles(tenant_id as string, fileIds);
    }

    return numTrashed !== 0 || numDeleted;
  }

  /** Distinct, non-null file_ids referenced by the given emails' attachments. */
  private async getAttachmentFileIds(tenant_id: string, emailIds: string[]): Promise<string[]> {
    if (emailIds.length === 0) return [];
    const rows = await this.attachmentsRepo.db
      .selectFrom('email_attachments')
      .select('file_id')
      .distinct()
      .where('tenant_id', '=', tenant_id)
      .where('email_id', 'in', emailIds)
      .where('file_id', 'is not', null)
      .execute();
    return rows.map((r) => String(r.file_id)).filter((id) => id !== 'null');
  }

  /**
   * Delete file rows + storage blobs for files that are no longer referenced by
   * any remaining email attachment (files are sha256-deduped and can be shared).
   * Storage deletion is best-effort: a failed blob delete must not abort the txn.
   */
  private async purgeOrphanedFiles(tenant_id: string, fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;

    const db = this.attachmentsRepo.db;
    for (const fileId of fileIds) {
      try {
        const stillReferenced = await db
          .selectFrom('email_attachments')
          .select('id')
          .where('tenant_id', '=', tenant_id)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst();

        if (stillReferenced) continue;

        const file = await db
          .selectFrom('files')
          .select(['id', 'storage_key'])
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', fileId)
          .executeTakeFirst();

        if (!file) continue;

        await db.deleteFrom('files').where('tenant_id', '=', tenant_id).where('id', '=', fileId).execute();

        if (file.storage_key) {
          try {
            await this.storageService.delete(file.storage_key);
          } catch (err) {
            logger.error({ err }, `Failed to delete storage blob ${file.storage_key} for file ${fileId}`);
          }
        }
      } catch (err) {
        logger.error({ err }, `Failed to purge orphaned file ${fileId}`);
      }
    }
  }

  public async getAllAttachments(tenant_id: string, email_id: string, options?: { includeInline: boolean }) {
    try {
      return await this.attachmentsRepo.getAllAttachments(tenant_id, email_id, options);
    } catch (err) {
      throw new InternalError('Failed to fetch attachments', undefined, { cause: err });
    }
  }

  public async getAttachmentsByEmailId(tenant_id: string, email_id: string) {
    try {
      return await this.attachmentsRepo.getByEmailId(tenant_id, email_id);
    } catch (err) {
      throw new InternalError('Failed to fetch attachments for email', undefined, { cause: err });
    }
  }

  public async getDraft(tenant_id: string, _user_id: string, value: string) {
    try {
      const draft = await this.draftsRepo.getOneBy('id', { tenant_id, value });
      if (!draft) throw new NotFoundError('Draft not found');
      return draft;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to fetch draft', undefined, { cause: err });
    }
  }

  public async getEmailBody(tenant_id: string, value: string) {
    try {
      const email = (await this.bodiesRepo.getOneBy('email_id', { tenant_id, value })) as
        | Selectable<Models['email_bodies']>
        | undefined;
      if (email) {
        return {
          ...email,
          body_html: sanitizeHtml(email.body_html),
        };
      }

      // If no body exists, attempt to load from drafts table
      const draft = (await this.draftsRepo.getOneBy('id', { tenant_id, value })) as EmailDraftType | undefined;
      if (draft)
        return {
          email_id: value,
          body_html: sanitizeHtml(draft.body_html),
          body_delta: draft.body_delta ?? null,
        } as any;

      throw new NotFoundError('Failed to fetch email body');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to fetch email body', undefined, { cause: err });
    }
  }

  public async getEmailHeader(tenant_id: string, id: string, user_id?: string) {
    try {
      const [emailWithHeaders, comments, rawAttachments] = await Promise.all([
        this.getRepo().getEmailWithHeadersAndRecipients(tenant_id, id, user_id),
        this.commentsRepo.getForEmail(tenant_id, id),
        this.attachmentsRepo.getByEmailId(tenant_id, id),
      ]);
      // Attach a short-lived, email-scoped download URL so the client can link to
      // attachments without putting a session token in the URL (SECURITY-REVIEW.md 1.3).
      const attachments = ((rawAttachments ?? []) as Array<Record<string, unknown>>).map((a) => ({
        ...a,
        download_url: signedEmailAttachmentUrl(String(id), String(a['id']), tenant_id),
      }));
      if (emailWithHeaders) {
        let person: Record<string, unknown> | null = null;
        if (emailWithHeaders.from_email) {
          const fromEmail = emailWithHeaders.from_email.trim().toLowerCase();
          const matchedPerson = await this.getRepo()
            .db.selectFrom('persons')
            .leftJoin('companies', 'companies.id', 'persons.company_id')
            .select([
              'persons.id',
              'persons.first_name',
              'persons.last_name',
              'persons.email',
              'persons.mobile',
              'persons.notes',
              'companies.name as company_name',
            ])
            .where('persons.tenant_id', '=', tenant_id)
            .where((eb) =>
              eb.or([eb(sql`lower(persons.email)`, '=', fromEmail), eb(sql`lower(persons.email2)`, '=', fromEmail)]),
            )
            .executeTakeFirst();

          if (matchedPerson) {
            const tagsAndIssues = await this.getRepo()
              .db.selectFrom('map_peoples_tags')
              .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
              .select(['tags.name', 'tags.color', 'tags.type'])
              .where('map_peoples_tags.tenant_id', '=', tenant_id)
              .where('map_peoples_tags.person_id', '=', matchedPerson.id)
              .execute();

            person = {
              ...matchedPerson,
              tags: tagsAndIssues.filter((t) => t.type === 'tag').map((t) => ({ name: t.name, color: t.color })),
              issues: tagsAndIssues.filter((t) => t.type === 'issue').map((t) => ({ name: t.name, color: t.color })),
            };
          }
        }
        return { email: emailWithHeaders, comments, attachments, person };
      }

      // Fallback to draft if regular email not found
      const draft = (await this.draftsRepo.getOneBy('id', { tenant_id, value: id })) as EmailDraftType | undefined;
      if (draft)
        return {
          email: {
            id: draft.id,
            to_list: (draft.to_list || []).map((e: string) => ({ email: e })),
            cc_list: (draft.cc_list || []).map((e: string) => ({ email: e })),
            bcc_list: (draft.bcc_list || []).map((e: string) => ({ email: e })),
            from_email: null,
            subject: draft.subject,
          },
          comments: [],
          attachments: [],
        } as any;

      throw new NotFoundError('Email not found');
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to fetch email header', undefined, { cause: err });
    }
  }

  public async getEmails(
    user_id: string,
    tenant_id: string,
    campaign_id: string,
    folder_id: string,
    limit?: number,
    offset?: number,
  ) {
    try {
      if (folder_id === ALL_FOLDERS.DRAFTS) {
        const drafts = await this.draftsRepo.listByUser(tenant_id, campaign_id, user_id, limit, offset);
        return drafts.map((d) => ({
          id: d.id,
          folder_id,
          from_email: '',
          to_email: Array.isArray(d.to_list) ? d.to_list.join(', ') : '',
          subject: d.subject,
          preview: '',
          assigned_to: undefined,
          updated_at: d.updated_at,
          date_sent: d.updated_at,
          is_favourite: false,
          attachment_count: 0,
          has_attachment: false,
          status: 'open',
        }));
      }
      return await this.getRepo().getByFolderWithAttachmentFlag(
        user_id,
        tenant_id,
        campaign_id,
        folder_id,
        limit,
        offset,
      );
    } catch (err) {
      throw new InternalError('Failed to fetch emails', undefined, { cause: err });
    }
  }

  public getFolders(_tenant_id: string) {
    // Return hardcoded folders configuration (same for all tenants)
    return Promise.resolve(getAllEmailFolders());
  }

  public async getFoldersWithCounts(user_id: string, tenant_id: string, campaign_id: string) {
    try {
      const [folders, emailCounts, draftCount] = await Promise.all([
        this.getFolders(tenant_id),
        this.getRepo().getEmailCountsByFolder(user_id, tenant_id, campaign_id),
        this.draftsRepo.countByUser(tenant_id, campaign_id, user_id),
      ]);

      return folders.map((folder) => ({
        ...folder,
        email_count: folder.id === ALL_FOLDERS.DRAFTS ? draftCount : emailCounts[folder.id] || 0,
      }));
    } catch (err) {
      throw new InternalError('Failed to fetch folder counts', undefined, { cause: err });
    }
  }

  public async hasAttachment(tenant_id: string, email_id: string) {
    try {
      return await this.attachmentsRepo.hasAttachment(tenant_id, email_id);
    } catch (err) {
      throw new InternalError('Failed to check attachment flag', undefined, { cause: err });
    }
  }

  public async hasAttachmentByEmailIds(tenant_id: string, email_ids: string[]) {
    if (!email_ids?.length) return Promise.resolve([]);

    try {
      return this.attachmentsRepo.hasAttachmentByEmailIds(tenant_id, email_ids);
    } catch (err) {
      throw new InternalError('Failed to check attachment flags', undefined, { cause: err });
    }
  }

  public restoreFromTrash(tenant_id: string, idsToRestore: string[]) {
    return this.getRepo().restoreFromTrash(tenant_id, idsToRestore);
  }

  public async moveToFolder(tenant_id: string, id: string, folder_id: string, actor_id?: string) {
    try {
      const isTrash = folder_id === ALL_FOLDERS.TRASH;
      const deleted_at = isTrash ? new Date() : null;

      const updated = await this.getRepo()
        .getUpdate()
        .set({ folder_id, deleted_at })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();

      if (!updated) throw new NotFoundError('Email not found');

      // --- Log activity ---
      if (actor_id) {
        this.activityRepo
          .log({
            tenant_id,
            user_id: actor_id,
            activity: isTrash ? 'delete' : 'update',
            entity: 'email',
            entity_id: id,
            metadata: { folder_id },
          })
          .catch((e) => logger.error({ err: e }, 'Failed to log email move activity'));
      }

      return updated;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to move email to folder', undefined, { cause: err });
    }
  }

  public async saveDraft(
    tenant_id: string,
    campaign_id: string,
    user_id: string,
    draft: {
      id?: string;
      to_list: string[];
      cc_list?: string[];
      bcc_list?: string[];
      subject?: string;
      body_html?: string;
    },
  ) {
    try {
      if (draft.body_html) {
        draft.body_html = sanitizeHtml(draft.body_html);
      }
      const saved = await this.draftsRepo.saveDraft(tenant_id, campaign_id, user_id, draft);
      if (!saved) throw new InternalError('Failed to save draft');
      return saved;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to save draft', undefined, { cause: err });
    }
  }

  public async setFavourite(tenant_id: string, id: string, favourite: boolean) {
    try {
      return this.getRepo().setFavourite(tenant_id, id, favourite);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to set favourite', undefined, { cause: err });
    }
  }

  public async setStatus(tenant_id: string, id: string, status: EmailStatus, actor_id?: string) {
    try {
      const updated = await this.getRepo().setStatus(tenant_id, id, status);
      if (!updated) throw new NotFoundError('Email not found');

      // --- Log activity ---
      if (actor_id) {
        const activityType = status === 'closed' ? 'close' : 'reopen';
        this.activityRepo
          .log({
            tenant_id,
            user_id: actor_id,
            activity: activityType,
            entity: 'email',
            entity_id: id,
            metadata: { status },
          })
          .catch((e) => logger.error({ err: e }, 'Failed to log email status activity'));
      }

      return updated;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to set status', undefined, { cause: err });
    }
  }

  public async setEmailReadStatus(tenant_id: string, user_id: string, email_id: string, is_read: boolean) {
    try {
      const email = await this.getRepo().getOneBy('id', { tenant_id, value: email_id });
      if (!email) throw new NotFoundError('Email not found');

      await this.getRepo()
        .db.insertInto('email_read_states')
        .values({
          tenant_id,
          user_id,
          email_id,
          is_read,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'user_id', 'email_id']).doUpdateSet({
            is_read,
          }),
        )
        .execute();

      return { success: true, email_id, is_read };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new InternalError('Failed to set email read status', undefined, { cause: err });
    }
  }
}
