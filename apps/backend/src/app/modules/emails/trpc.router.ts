import { folderIdSchema, idSchema, regularFolderIdSchema } from '../../../../../../libs/common/src';
import { z } from 'zod';

import { authProcedure, router } from '../../../trpc';
import { EmailsController } from './controller';

function addComment() {
  return authProcedure
    .input(
      z.object({
        id: idSchema,
        // Accepted for backward compatibility but IGNORED: the comment author is
        // always the authenticated session user, never a client-supplied id.
        author_id: idSchema.optional(),
        comment: z.string().trim().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
      }),
    )
    .mutation(({ input, ctx }) =>
      emails.addComment(ctx.auth.tenant_id, input.id, ctx.auth.user_id, input.comment, ctx.auth.role),
    );
}

function assign() {
  return authProcedure
    .input(z.object({ id: idSchema, user_id: idSchema.nullable(), assigned_to_name: z.string().optional() }))
    .mutation(({ input, ctx }) =>
      emails.assignEmail(
        ctx.auth.tenant_id,
        input.id,
        input.user_id,
        ctx.auth.user_id,
        input.assigned_to_name ?? null,
        ctx.auth.role,
      ),
    );
}

function deleteComment() {
  return authProcedure
    .input(z.object({ email_id: idSchema, comment_id: idSchema }))
    .mutation(({ input, ctx }) =>
      emails.deleteComment(ctx.auth.tenant_id, input.email_id, input.comment_id, ctx.auth.user_id, ctx.auth.role),
    );
}

function deleteDraft() {
  return authProcedure
    .input(z.object({ id: idSchema }))
    .mutation(({ input, ctx }) => emails.deleteDraft(ctx.auth.tenant_id, ctx.auth.user_id, input.id, ctx.auth.role));
}

function deleteEmail() {
  return authProcedure
    .input(idSchema)
    .mutation(({ input, ctx }) => emails.deleteMany(ctx.auth.tenant_id, [input], ctx.auth.user_id, ctx.auth.role));
}

function deleteEmails() {
  return authProcedure
    .input(z.array(idSchema).min(1, 'At least one ID is required'))
    .mutation(({ input, ctx }) => emails.deleteMany(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role));
}

function getAllAttachments() {
  return authProcedure
    .input(z.object({ email_id: idSchema, options: z.object({ includeInline: z.boolean() }).optional() }))
    .query(({ input, ctx }) =>
      emails.getAllAttachments(ctx.auth.tenant_id, input.email_id, ctx.auth.user_id, ctx.auth.role, input.options),
    );
}

function getAttachmentsByEmailId() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) =>
      emails.getAttachmentsByEmailId(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role),
    );
}

function getDraft() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => emails.getDraft(ctx.auth.tenant_id, ctx.auth.user_id, input, ctx.auth.role));
}

function getEmailBody() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => emails.getEmailBody(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role));
}

function getEmailHeader() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => emails.getEmailHeader(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role));
}

function getEmailWithHeaders() {
  return authProcedure.input(idSchema).query(async ({ input, ctx }) => {
    const tenantId = ctx.auth.tenant_id;

    const [body, header] = await Promise.all([
      emails.getEmailBody(tenantId, input, ctx.auth.user_id, ctx.auth.role),
      emails.getEmailHeader(tenantId, input, ctx.auth.user_id, ctx.auth.role),
    ]);

    return { body, header };
  });
}

function getEmails() {
  return authProcedure
    .input(
      z.object({
        campaignId: idSchema,
        folderId: folderIdSchema,
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(({ input, ctx }) =>
      emails.getEmails(
        ctx.auth.user_id,
        ctx.auth.tenant_id,
        input.campaignId,
        input.folderId,
        input.limit,
        input.offset,
      ),
    );
}

function countAssignedOpen() {
  return authProcedure
    .input(z.object({ campaignId: idSchema }))
    .query(({ input, ctx }) => emails.countAssignedOpen(ctx.auth.user_id, ctx.auth.tenant_id, input.campaignId));
}

function getFolders() {
  return authProcedure.query(({ ctx }) => emails.getFolders(ctx.auth.tenant_id));
}

function getFoldersWithCounts() {
  return authProcedure
    .input(z.object({ campaignId: idSchema }))
    .query(({ input, ctx }) => emails.getFoldersWithCounts(ctx.auth.user_id, ctx.auth.tenant_id, input.campaignId));
}

function hasAttachment() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => emails.hasAttachment(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role));
}

function hasAttachmentByEmailIds() {
  return authProcedure
    .input(z.array(idSchema))
    .query(({ input, ctx }) =>
      emails.hasAttachmentByEmailIds(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role),
    );
}

function restoreFromTrash() {
  return authProcedure
    .input(z.array(idSchema))
    .mutation(({ input, ctx }) => emails.restoreFromTrash(ctx.auth.tenant_id, input, ctx.auth.user_id, ctx.auth.role));
}

function moveToFolder() {
  return authProcedure
    .input(z.object({ id: idSchema, folderId: regularFolderIdSchema }))
    .mutation(({ input, ctx }) =>
      emails.moveToFolder(ctx.auth.tenant_id, input.id, input.folderId, ctx.auth.user_id, ctx.auth.role),
    );
}

function saveDraft() {
  return authProcedure
    .input(
      z.object({
        campaignId: idSchema,
        id: idSchema.optional(),
        to: z.array(z.string().trim().email('Invalid recipient email address')).optional().default([]),
        cc: z.array(z.string().trim().email('Invalid CC email address')).optional(),
        bcc: z.array(z.string().trim().email('Invalid BCC email address')).optional(),
        subject: z.string().trim().max(500, 'Subject is too long').optional(),
        html: z.string().max(100000, 'HTML body is too long').optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      emails.saveDraft(ctx.auth.tenant_id, input.campaignId, ctx.auth.user_id, {
        id: input.id,
        to_list: input.to,
        cc_list: input.cc ?? [],
        bcc_list: input.bcc ?? [],
        subject: input.subject ?? undefined,
        body_html: input.html ?? undefined,
      }),
    );
}

function setFavourite() {
  return authProcedure
    .input(z.object({ id: idSchema, favourite: z.boolean() }))
    .mutation(({ input, ctx }) =>
      emails.setFavourite(ctx.auth.tenant_id, input.id, input.favourite, ctx.auth.user_id, ctx.auth.role),
    );
}

function setStatus() {
  return authProcedure
    .input(z.object({ id: idSchema, status: z.enum(['open', 'closed']) }))
    .mutation(({ input, ctx }) => emails.setStatus(ctx.auth.tenant_id, input.id, input.status, ctx.auth.user_id));
}

function getActivities() {
  return authProcedure
    .input(idSchema)
    .query(({ input, ctx }) => emails.getActivitiesForEmail(ctx.auth.tenant_id, input));
}

function setEmailReadStatus() {
  return authProcedure
    .input(z.object({ id: idSchema, isRead: z.boolean() }))
    .mutation(({ input, ctx }) =>
      emails.setEmailReadStatus(ctx.auth.tenant_id, ctx.auth.user_id, input.id, input.isRead),
    );
}

const emails = new EmailsController();

export const EmailsRouter = router({
  countAssignedOpen: countAssignedOpen(),
  getFolders: getFolders(),
  getFoldersWithCounts: getFoldersWithCounts(),
  getEmails: getEmails(),
  getEmailBody: getEmailBody(),
  getDraft: getDraft(),
  getEmailHeader: getEmailHeader(),
  getEmailWithHeaders: getEmailWithHeaders(),
  getActivities: getActivities(),
  addComment: addComment(),
  deleteComment: deleteComment(),
  deleteDraft: deleteDraft(),
  delete: deleteEmail(),
  deleteMany: deleteEmails(),
  assign: assign(),
  setFavourite: setFavourite(),
  setStatus: setStatus(),
  setEmailReadStatus: setEmailReadStatus(),
  saveDraft: saveDraft(),
  restoreFromTrash: restoreFromTrash(),
  moveToFolder: moveToFolder(),
  hasAttachment: hasAttachment(),
  getAllAttachments: getAllAttachments(),
  hasAttachmentByEmailIds: hasAttachmentByEmailIds(),
  getAttachmentsByEmailId: getAttachmentsByEmailId(),
});
