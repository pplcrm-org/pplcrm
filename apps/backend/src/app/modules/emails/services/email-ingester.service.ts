import type { Kysely, Updateable } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { StorageService } from '../../../lib/storage.service';
import {
  EAGER_ATTACHMENT_MAX_BYTES,
  allowsEagerAttachmentFetch,
  allowsInlineImages,
} from '../../../../../../../libs/common/src/lib/emails';
import { env } from '../../../../env';
import crypto from 'crypto';
import { sanitizeHtml } from '../../../lib/mail/sanitize-util';
import { extractBodyText, previewTextFrom, INLINE_BODY_MAX_BYTES } from './email-body-text';
import { purgeUnreferencedFiles } from '../../../lib/file-references';
import { logger } from '../../../logger';

export interface IngestableEmail {
  id: string; // Remote provider's unique message ID
  internetMessageId?: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  dateSent: Date;
  bodyHtml: string;
  recipients: Array<{
    kind: 'to' | 'cc' | 'bcc';
    name: string | null;
    email: string;
  }>;
  attachments: Array<{
    name: string;
    contentType: string;
    size: number;
    contentId: string | null;
    isInline: boolean;
    /** Provider identifier for this attachment, stored so the payload can be fetched on demand. */
    remoteRef: string | null;
    fetchContent: () => Promise<Buffer>;
  }>;
}

/** An attachment whose payload we downloaded and stored during ingestion. */
interface MaterializedAttachment {
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  sha256_hex: string;
  cid: string | null;
  is_inline: boolean;
  remote_ref: string | null;
  /** Set when an identical blob already existed, so we link instead of inserting a new file row. */
  existing_file_id: string | null;
}

/** An attachment we recorded but deliberately did not download. */
interface DeferredAttachment {
  filename: string;
  content_type: string;
  size_bytes: number;
  cid: string | null;
  is_inline: boolean;
  remote_ref: string | null;
}

export class EmailIngesterService {
  private readonly storageService = new StorageService();

  constructor(
    private readonly db: Kysely<Models>,
    private readonly prefix: string, // 'ms' or 'google'
  ) {}

  public async removeAllLocalEmails(tenantId: string, campaignId: string): Promise<void> {
    const matchedEmails = await this.db
      .selectFrom('emails')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .where('preview', 'like', `${this.prefix}:%`)
      .execute();

    if (matchedEmails.length === 0) return;
    const emailIds = matchedEmails.map((e) => String(e.id));

    // Capture attachment file and body blob references before the rows are deleted.
    const fileIds = await this.getAttachmentFileIds(tenantId, emailIds);
    const bodyKeys = await this.getBodyStorageKeys(tenantId, emailIds);

    await this.db.transaction().execute(async (trx) => {
      // Delete from dependent tables sequentially to prevent foreign key constraint issues
      await trx
        .deleteFrom('email_comments')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .execute();
      await trx
        .deleteFrom('email_bodies')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .execute();
      await trx
        .deleteFrom('email_headers')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .execute();
      await trx
        .deleteFrom('email_recipients')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .execute();
      await trx
        .deleteFrom('email_attachments')
        .where('tenant_id', '=', tenantId)
        .where('email_id', 'in', emailIds)
        .execute();
      await trx.deleteFrom('email_trash').where('tenant_id', '=', tenantId).where('email_id', 'in', emailIds).execute();

      // Delete from emails table
      await trx.deleteFrom('emails').where('tenant_id', '=', tenantId).where('id', 'in', emailIds).execute();
    });

    await this.purgeOrphanedFiles(tenantId, fileIds);
    await this.purgeBodyBlobs(bodyKeys);
  }

  /**
   * Record that a message is no longer in the folder we sync from — WITHOUT destroying it.
   *
   * This used to hard-delete the `emails` row and every child table. That was wrong, because a
   * folder-scoped provider view reports a message as gone when it merely LEAVES the folder:
   * archived in Outlook, dragged to another folder, or filed by a rule. So ordinary mailbox
   * housekeeping destroyed the CRM's copy along with everything the team had added to it — the
   * internal comments, the staff member it was assigned to, the open/closed triage status and the
   * favourite flag — with no activity-log entry and no way to get any of it back.
   *
   * Detaching keeps all of that. `EmailRepo.buildFolderPredicate` hides detached rows from the
   * mailbox folder listings, so a message archived upstream stops sitting in the CRM inbox, while
   * a direct link (an assignment notification, a mention, an activity entry) still opens it, and
   * it stays on the "Assigned to me" and "Favourites" worklists if someone put it there.
   *
   * `deleted_at` is deliberately NOT reused: that column means "the user put this in the CRM's own
   * trash", so setting it here would file an archived message into the user's trash — a different
   * and wrong claim.
   *
   * Idempotent, and deliberately so: `where detached_at is null` means an already-detached row
   * keeps its original detach time, rather than having the retention sweep's age clock reset by
   * every subsequent sync.
   *
   * Genuine destruction still exists and is unchanged — see `removeAllLocalEmails` (mailbox
   * disconnect), the Trash hard-delete in `EmailsController.deleteMany`, and the tenant wipe in
   * `lib/jobs/handlers/deletions.handlers.ts`.
   */
  public async detachMessage(tenantId: string, campaignId: string, remoteId: string): Promise<void> {
    const dedupeKey = `${this.prefix}:${remoteId}`;

    await this.db
      .updateTable('emails')
      .set({ detached_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .where('preview', '=', dedupeKey)
      .where('detached_at', 'is', null)
      .execute();
  }

  /**
   * Apply a reconciliation patch to one email row, or do nothing when the patch is empty.
   *
   * Used by the three "this message is the one we already have" branches, which each need a
   * different subset of columns (dedupe key, folder, detachment). An empty patch is a normal
   * outcome — an unchanged message re-synced — and must not issue a pointless UPDATE that bumps
   * `updated_at` via the row trigger.
   */
  private async applyEmailPatch(tenantId: string, emailId: string, patch: Updateable<Models['emails']>): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    await this.db
      .updateTable('emails')
      .set({ ...patch, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', emailId)
      .execute();
  }

  /** Blob keys for the given emails' bodies, for cleanup after the rows are deleted. */
  private async getBodyStorageKeys(tenantId: string, emailIds: string[]): Promise<string[]> {
    if (emailIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('email_bodies')
      .select('storage_key')
      .where('tenant_id', '=', tenantId)
      .where('email_id', 'in', emailIds)
      .where('storage_key', 'is not', null)
      .execute();
    return rows.map((r) => String(r.storage_key)).filter((k) => k !== 'null');
  }

  /**
   * Delete body blobs. Unlike attachment files these are not deduped — one blob belongs to exactly
   * one email — so deletion is unconditional. Best-effort: a failure here must not fail the delete.
   */
  private async purgeBodyBlobs(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      try {
        await this.storageService.delete(key);
      } catch (err) {
        logger.error({ err }, `Failed to delete email body blob ${key}`);
      }
    }
  }

  /** Distinct, non-null file_ids referenced by the given emails' attachments. */
  private async getAttachmentFileIds(tenantId: string, emailIds: string[]): Promise<string[]> {
    if (emailIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('email_attachments')
      .select('file_id')
      .distinct()
      .where('tenant_id', '=', tenantId)
      .where('email_id', 'in', emailIds)
      .where('file_id', 'is not', null)
      .execute();
    return rows.map((r) => String(r.file_id)).filter((id) => id !== 'null');
  }

  /**
   * Delete file rows + storage blobs for files nothing points at any more.
   *
   * Same rule as EmailsController.purgeOrphanedFiles, and the same shared check: every column
   * in the schema that holds a files.id, plus the entity-ownership tag. Checking only
   * email_attachments here destroyed avatars and newsletter images that shared the row.
   */
  private async purgeOrphanedFiles(tenantId: string, fileIds: string[]): Promise<void> {
    await purgeUnreferencedFiles(this.db, this.storageService, tenantId, fileIds);
  }

  /**
   * Hash a payload, reuse an identical stored blob if one exists, otherwise upload it.
   *
   * The order matters. Uploading before checking for a duplicate strands the freshly-written blob:
   * the dedupe would link the pre-existing `files` row and the new `storage_key` would be recorded
   * nowhere, so nothing could ever find it to delete. Hash first, look up, upload only on a miss.
   *
   * The lookup only reuses a `files` row that is ITSELF an email attachment. It used to match any
   * row in the tenant with the same hash, which quietly gave an incoming attachment part-ownership
   * of somebody's avatar, a person photo or a newsletter image whenever the bytes happened to be
   * identical — and the email delete sweep then deleted it. Storing those bytes twice costs one
   * duplicate blob in a rare case; sharing them cost a permanently destroyed file.
   *
   * Shared with the on-demand materialization path, so both routes store attachments identically.
   */
  public async storeAttachmentPayload(
    tenantId: string,
    filename: string,
    contentType: string,
    buffer: Buffer,
  ): Promise<{
    filename: string;
    content_type: string;
    storage_key: string;
    sha256_hex: string;
    existing_file_id: string | null;
  }> {
    const sha256_hex = crypto.createHash('sha256').update(buffer).digest('hex');

    const existingFile = await this.db
      .selectFrom('files')
      .innerJoin('email_attachments', 'email_attachments.file_id', 'files.id')
      .select(['files.id as id', 'files.storage_key as storage_key'])
      .where('files.tenant_id', '=', tenantId)
      .where('email_attachments.tenant_id', '=', tenantId)
      .where('files.sha256_hex', '=', sha256_hex)
      .limit(1)
      .executeTakeFirst();

    if (existingFile) {
      return {
        filename,
        content_type: contentType,
        storage_key: String(existingFile.storage_key),
        sha256_hex,
        existing_file_id: String(existingFile.id),
      };
    }

    const storage_key = `emails/attachments/${crypto.randomUUID()}_${filename}`;
    await this.storageService.upload(storage_key, buffer, contentType);

    return { filename, content_type: contentType, storage_key, sha256_hex, existing_file_id: null };
  }

  public async ingestEmail(
    email: IngestableEmail,
    tenantId: string,
    campaignId: string,
    requestedBy: string,
    folderId: string,
  ): Promise<boolean> {
    const dedupeKey = `${this.prefix}:${email.id}`;

    // Dedup: use remote message ID stored in email preview field (prefixed).
    // Scoped to the campaign so the same mailbox connected under two contexts
    // ingests into each context's Inbox independently (§15).
    const existing = await this.db
      .selectFrom('emails')
      .select(['id', 'detached_at'])
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .where('preview', '=', dedupeKey)
      .executeTakeFirst();

    if (existing) {
      // The message is present upstream again. A user can move a message out of the inbox and
      // straight back in, so re-attach the existing row — with its comments, assignee, status and
      // favourite flag — instead of leaving a hidden row behind and inserting a second copy.
      if (existing.detached_at != null) {
        await this.applyEmailPatch(tenantId, String(existing.id), { detached_at: null });
      }
      return false;
    }

    // Try finding by internetMessageId in email_headers to match locally composed
    // & sent emails. The provider may reassign a message's ID when it moves
    // between folders (e.g. MS Graph changes the ID on Drafts -> Sent), so the
    // preview-based dedup above can miss the local copy. The Message-ID header is
    // stable across that move, so use it as a folder-aware fallback.
    if (email.internetMessageId) {
      const matches = await this.db
        .selectFrom('emails')
        .innerJoin('email_headers', 'email_headers.email_id', 'emails.id')
        .select([
          'emails.id as id',
          'emails.folder_id as folder_id',
          'emails.preview as preview',
          'emails.detached_at as detached_at',
        ])
        .where('emails.tenant_id', '=', tenantId)
        .where('emails.campaign_id', '=', campaignId)
        .where('email_headers.tenant_id', '=', tenantId)
        .where('email_headers.raw_headers', 'like', `%Message-ID: ${email.internetMessageId}%`)
        .execute();

      // 1. Same message already present in THIS folder. This is the same item
      //    re-synced (possibly under a new provider ID) — refresh the dedupe key
      //    so future syncs match by preview, and skip insertion.
      //
      //    This is also the path a message takes when it is moved OUT of the folder and back in:
      //    the provider issues a new ID on the way back, so the preview-keyed lookup above misses
      //    and only the stable Message-ID finds the detached row. Clearing `detached_at` here is
      //    what makes the round trip re-attach the original row — comments, assignee, status and
      //    all — instead of leaving a hidden row behind and inserting a duplicate beside it.
      const sameFolder = matches.find((m) => String(m.folder_id) === String(folderId));
      if (sameFolder) {
        const patch: Updateable<Models['emails']> = {};
        if (sameFolder.preview !== dedupeKey) patch.preview = dedupeKey;
        if (sameFolder.detached_at != null) patch.detached_at = null;
        await this.applyEmailPatch(tenantId, String(sameFolder.id), patch);
        return false;
      }

      // 2. An untagged (locally composed, not yet provider-tagged) copy exists in
      //    another folder — claim it: tag with the provider ID and align its folder.
      const untagged = matches.find((m) => !(m.preview?.startsWith('ms:') || m.preview?.startsWith('google:')));
      if (untagged) {
        await this.applyEmailPatch(tenantId, String(untagged.id), {
          preview: dedupeKey,
          folder_id: folderId,
          detached_at: null,
        });

        return false; // prevent duplicate insertion
      }

      // 3. Otherwise the message only exists in other folders and is already
      //    provider-tagged — this is a genuine cross-folder copy (e.g.
      //    send-to-self in both Sent and Inbox). Fall through and insert fresh.
    }

    // Decide, per attachment, whether to pull the payload now or record it and wait.
    //
    // Only small attachments in folders people work out of are fetched during sync — enough that a
    // body renders complete on first open, without hoarding every deck and PDF that was ever mailed
    // to the account. Everything else is stored as metadata plus a provider reference, and
    // materialized the first time someone actually asks for it. Spam never materializes at all
    // (see allowsAttachmentDownload), so there is nothing to fetch eagerly there either.
    const eagerAllowed = allowsEagerAttachmentFetch(folderId);

    const materialized: MaterializedAttachment[] = [];
    const deferred: DeferredAttachment[] = [];

    for (const att of email.attachments) {
      const shouldFetchNow = eagerAllowed && att.size <= EAGER_ATTACHMENT_MAX_BYTES;

      if (!shouldFetchNow) {
        deferred.push({
          filename: att.name,
          content_type: att.contentType,
          size_bytes: att.size,
          cid: att.contentId,
          is_inline: att.isInline,
          remote_ref: att.remoteRef,
        });
        continue;
      }

      try {
        const stored = await this.storeAttachmentPayload(tenantId, att.name, att.contentType, await att.fetchContent());
        materialized.push({
          ...stored,
          size_bytes: att.size,
          cid: att.contentId,
          is_inline: att.isInline,
          remote_ref: att.remoteRef,
        });
      } catch (err) {
        // A failed eager fetch is not fatal: record it as deferred so the attachment is still
        // listed and can be materialized later on demand.
        logger.error({ err }, `Failed to store attachment ${att.name} for message ${email.id}; deferring`);
        deferred.push({
          filename: att.name,
          content_type: att.contentType,
          size_bytes: att.size,
          cid: att.contentId,
          is_inline: att.isInline,
          remote_ref: att.remoteRef,
        });
      }
    }

    return this.db.transaction().execute(async (trx) => {
      // Sanitize up front: the email row is inserted before the body (it owns the id the body
      // references), but it now carries the display snippet, which must come from the same
      // extract as `email_bodies.body_text`. The cid rewrite below only edits `src` attributes,
      // and the extractor strips all tags — so extracting here and after the rewrite are
      // identical, and this avoids sanitizing twice.
      const sanitizedHtml = sanitizeHtml(email.bodyHtml);

      // 1. Insert into emails
      const emailRow = await trx
        .insertInto('emails')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          folder_id: folderId,
          from_email: email.fromEmail,
          to_email: email.toEmail,
          subject: email.subject,
          preview: dedupeKey, // the DEDUPE KEY, never displayed — see preview_text
          preview_text: previewTextFrom(extractBodyText(sanitizedHtml)),
          assigned_to: null,
          is_favourite: false,
          deleted_at: null,
          status: 'open',
          // Denormalized sort key — mirrors the email_headers.date_sent written below so the
          // inbox can sort on one indexed column instead of a COALESCE across a join.
          date_sent: email.dateSent,
          createdby_id: requestedBy,
          updatedby_id: requestedBy,
        })
        .returningAll()
        .executeTakeFirst();

      if (!emailRow) return false;

      const emailId = String(emailRow.id);

      // 2. Rewrite inline CID references in body content, then store the body.
      //
      // The rewrite points at our own endpoint rather than embedding the bytes, so it applies to
      // deferred inline images too — the endpoint materializes them on first view. In Spam it is
      // skipped entirely: loading an image in junk mail confirms the address is live, and those
      // payloads are never fetched anyway.
      let bodyHtml = sanitizedHtml;
      if (allowsInlineImages(folderId)) {
        const inlineCids = [...materialized, ...deferred].filter((a) => a.is_inline && a.cid);
        for (const att of inlineCids) {
          const cidEscaped = (att.cid as string).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`src=['"]cid:${cidEscaped}['"]`, 'gi');
          bodyHtml = bodyHtml.replace(regex, `src="${env.apiUrl}/api/emails/${emailId}/attachments/cid/${att.cid}"`);
        }
      }

      // Keep a searchable text extract in Postgres; push the HTML itself to blob storage unless it
      // is small enough that a round-trip would cost more than it saves.
      const bodyText = extractBodyText(bodyHtml);
      const keepInline = Buffer.byteLength(bodyHtml, 'utf8') <= INLINE_BODY_MAX_BYTES;
      let bodyStorageKey: string | null = null;

      if (!keepInline) {
        const key = `emails/bodies/${crypto.randomUUID()}.html`;
        try {
          await this.storageService.upload(key, Buffer.from(bodyHtml, 'utf8'), 'text/html; charset=utf-8');
          bodyStorageKey = key;
        } catch (err) {
          // Storage is unavailable — fall back to inline rather than losing the body entirely.
          logger.error({ err }, `Failed to store body blob for message ${email.id}; keeping it inline`);
        }
      }

      await trx
        .insertInto('email_bodies')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          body_html: bodyStorageKey ? null : bodyHtml,
          storage_key: bodyStorageKey,
          body_text: bodyText,
          createdby_id: requestedBy,
          updatedby_id: requestedBy,
        })
        .execute();

      // 3. Insert attachment rows. Materialized ones link a `files` row; deferred ones carry only
      //    the provider reference, and get their `file_id` on first download.
      let pos = 0;

      for (const att of materialized) {
        pos++;
        const fileId =
          att.existing_file_id ??
          String(
            (
              await trx
                .insertInto('files')
                .values({
                  tenant_id: tenantId,
                  filename: att.filename,
                  mime_type: att.content_type,
                  size_bytes: att.size_bytes,
                  storage_key: att.storage_key,
                  sha256_hex: att.sha256_hex,
                  uploaded_by: requestedBy,
                })
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id,
          );

        await trx
          .insertInto('email_attachments')
          .values({
            tenant_id: tenantId,
            email_id: emailId,
            filename: att.filename,
            content_type: att.content_type,
            size_bytes: att.size_bytes,
            cid: att.cid,
            is_inline: att.is_inline,
            pos,
            file_id: fileId,
            remote_ref: att.remote_ref,
            createdby_id: requestedBy,
            updatedby_id: requestedBy,
          })
          .execute();
      }

      for (const att of deferred) {
        pos++;
        await trx
          .insertInto('email_attachments')
          .values({
            tenant_id: tenantId,
            email_id: emailId,
            filename: att.filename,
            content_type: att.content_type,
            size_bytes: att.size_bytes,
            cid: att.cid,
            is_inline: att.is_inline,
            pos,
            file_id: null,
            remote_ref: att.remote_ref,
            createdby_id: requestedBy,
            updatedby_id: requestedBy,
          })
          .execute();
      }

      // 4. Insert headers
      const internetMessageId = email.internetMessageId ?? '';
      const rawHeaders = `Message-ID: ${internetMessageId}\r\nSubject: ${email.subject ?? ''}\r\nFrom: ${email.fromEmail ?? ''}\r\nTo: ${email.toEmail ?? ''}\r\nDate: ${email.dateSent.toUTCString()}\r\n`;

      await trx
        .insertInto('email_headers')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          headers_json: JSON.stringify({ internetMessageId }),
          raw_headers: rawHeaders,
          date_sent: email.dateSent,
          createdby_id: requestedBy,
          updatedby_id: requestedBy,
        })
        .execute();

      // 5. Insert recipients
      if (email.recipients.length > 0) {
        const recipientRows = email.recipients.map((r, i) => ({
          tenant_id: tenantId,
          email_id: emailId,
          kind: r.kind,
          name: r.name,
          email: r.email,
          pos: i,
          createdby_id: requestedBy,
          updatedby_id: requestedBy,
        }));
        await trx.insertInto('email_recipients').values(recipientRows).execute();
      }

      return true;
    });
  }
}
