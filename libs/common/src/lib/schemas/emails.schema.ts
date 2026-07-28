import { z } from 'zod';
import { isRegularFolderId, isSpecialFolderId } from '../emails';

/**
 * The six storable folder ids (Sent/Spam/Trash/Drafts/Outbox/Inbox). The only
 * valid write targets for emails.folder_id — enforced here at the tRPC
 * boundary and by the chk_emails_folder_id CHECK constraint in the DB (there
 * is no email_folders table; folders are code-defined in EMAIL_FOLDERS).
 */
export const regularFolderIdSchema = z.string().refine(isRegularFolderId, 'Unknown folder');

/** Any folder id, including the virtual query-filter folders — valid for reads. */
export const folderIdSchema = z.string().refine((v) => isRegularFolderId(v) || isSpecialFolderId(v), 'Unknown folder');

export const EmailCommentObj = z.object({
  id: z.string(),
  email_id: z.string(),
  author_id: z.string(),
  comment: z.string(),
  created_at: z.date(),
});

export const EmailDraftObj = z.object({
  id: z.string(),
  to_list: z.array(z.string()),
  cc_list: z.array(z.string()),
  bcc_list: z.array(z.string()),
  subject: z.string().optional(),
  body_html: z.string().optional(),
  body_delta: z.unknown().optional(),
  updated_at: z.date(),
});

export const EmailFolderObj = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  sort_order: z.number(),
  is_default: z.boolean(),
  is_virtual: z.boolean(),
});

export const EmailObj = z.object({
  id: z.string(),
  folder_id: z.string(),
  from_email: z.string().optional(),
  from_name: z.string().optional(),
  to_email: z.string().optional(),
  subject: z.string().optional(),
  /** Provider dedupe key (`google:<id>` / `ms:<id>`), not a snippet — never render it. */
  preview: z.string().optional(),
  /** The snippet shown under the subject in the inbox list. */
  preview_text: z.string().nullish(),
  assigned_to: z.string().optional(),
  updated_at: z.date(),
  date_sent: z.date().nullable().optional(),
  is_favourite: z.boolean(),
  attachment_count: z.number(),
  has_attachment: z.boolean(),
  status: z.enum(['open', 'closed']).nullable().default('open'),
  is_read: z.boolean().optional(),
  sender_first_name: z.string().nullish(),
  sender_last_name: z.string().nullish(),
});
