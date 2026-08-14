import { Client } from '@microsoft/microsoft-graph-client';
import crypto from 'crypto';
import { z } from 'zod';
import { ALL_FOLDERS } from '../../../../../../../libs/common/src/lib/emails';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { Insertable, Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../../env';
import { BadRequestError } from '../../../errors/app-errors';
import { authenticateRest } from '../../../lib/rest-auth';
import { verifyEmailAttachmentToken } from '../../../lib/signed-download';
import { assertInboxAccess, planGateMessage } from '../../billing/plan-gate';
import { BaseRepository } from '../../../lib/base.repo';
import { attachmentDisposition } from '../../../lib/download-headers';
import { sanitizeHtml } from '../../../lib/mail/sanitize-util';
import { StorageService } from '../../../lib/storage.service';
import { GoogleOAuthService } from '../../google-sync/google-oauth.service';
import { MsOAuthService } from '../../ms-sync/ms-oauth.service';
import { materializeAttachment } from '../services/attachment-materializer';
import { extractBodyText, previewTextFrom } from '../services/email-body-text';

/** Max addresses per header. Well above any real send, low enough to bound the raw MIME. */
const MAX_RECIPIENTS_PER_FIELD = 100;

/**
 * Total-request deadline for one provider call on the send path (Gmail send, Graph draft /
 * attachment upload / send). Generous because the Gmail send is ONE request carrying the whole
 * message — 25 MB of attachments becomes ~33 MB of base64 in a single body, which at two
 * minutes needs ~275 KB/s of sustained upload. The point is that a black-holed provider
 * releases the user's request in minutes instead of undici's ~300s defaults. Applied per
 * request — a signal in Client.init's fetchOptions would be shared by every request and abort
 * them all once fired.
 */
const SEND_REQUEST_TIMEOUT_MS = 120_000;

/** Per-request fetch options giving one Graph call on the send path its own deadline. */
function sendTimeout() {
  return { signal: AbortSignal.timeout(SEND_REQUEST_TIMEOUT_MS) };
}

/**
 * Did this send fail because OUR deadline fired — as opposed to the provider refusing it?
 * The distinction decides what to tell the user: aborting the request does not undo work the
 * provider already started, so a timed-out send may in fact have been delivered, and treating
 * it as a clean failure ("failed — compose it again") invites a duplicate send (REVIEW7 B5).
 * AbortSignal.timeout throws a DOMException named 'TimeoutError'; undici and the Graph client
 * can surface it as 'AbortError' or wrapped one level down in `cause`.
 */
function isDeadlineAbort(err: unknown): boolean {
  const names = (e: unknown): string[] =>
    e instanceof Error ? [e.name, ...(e.cause instanceof Error ? [e.cause.name] : [])] : [];
  return names(err).some((n) => n === 'TimeoutError' || n === 'AbortError');
}

const TIMED_OUT_SEND_MESSAGE =
  'The send timed out. It may still have gone through — check your Sent folder before trying again. The message was kept in Drafts.';

/** Recipient lists arrive as JSON strings in a multipart form, so they get parsed, not bound. */
const recipientListSchema = z.array(z.string().trim().email()).max(MAX_RECIPIENTS_PER_FIELD);

/**
 * Parse one `to`/`cc`/`bcc` multipart field. These are the only values in the send path that
 * reach a mail header unencoded, so a malformed or hostile value has to fail as a 400 here
 * rather than as a 500 (raw `SyntaxError`) or, worse, as an injected header downstream.
 */
export function parseRecipientField(raw: string | undefined, label: 'to' | 'cc' | 'bcc'): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError(`The "${label}" field is not valid JSON.`);
  }
  const result = recipientListSchema.safeParse(parsed);
  if (!result.success) {
    throw new BadRequestError(
      `The "${label}" field must be a list of up to ${MAX_RECIPIENTS_PER_FIELD} email addresses.`,
    );
  }
  return result.data;
}

/**
 * CR/LF in a header value terminates the header and lets the rest of the string be read as
 * new headers (a hidden `Bcc:`, a forged `Reply-To:`). Zod's `.email()` already rejects them
 * on the recipient path; this is the second line of defence that also covers the sender name
 * and address, and it guards every future caller of `buildRawMime`.
 */
function assertHeaderSafe(value: string, label: string): string {
  if (/[\r\n]/.test(value)) {
    throw new BadRequestError(`The ${label} contains a line break, which is not allowed.`);
  }
  return value;
}

/**
 * Same concern as {@link assertHeaderSafe}, but for the `raw_headers` blob we persist as a
 * record of a sent message. A line break there can't reach the wire, but it would make the
 * stored headers parse as forged ones, so it is folded to a space rather than rejected — by
 * the time this runs the message is already composed, and a stray break in a subject is a
 * typo, not an attack.
 */
function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/**
 * Queue a post-send mailbox sync so the Sent copy and any new folders show up.
 *
 * This used to be `syncSvc.syncTenant(...).catch(log)` — a detached promise doing long HTTP work
 * against Gmail/Graph plus database writes, with no job row, no retry, no timeout, and silent
 * death on deploy. When it was killed the user's Sent folder simply never synced. The `ms_sync` /
 * `google_sync` job types already exist and the worker already has permanent-failure recovery for
 * both, so this just hands the work to the outbox like every other background task in the app.
 */
async function queueMailboxSync(
  db: Kysely<Models>,
  type: 'ms_sync' | 'google_sync',
  tenantId: string,
  campaignId: string,
  userId: string,
): Promise<void> {
  await db
    .insertInto('background_jobs')
    .values({
      tenant_id: tenantId,
      queue: 'default',
      status: 'pending',
      payload: JSON.stringify({ type, tenantId, campaignId, requestedBy: userId }),
      run_at: new Date(),
      max_attempts: 3,
    })
    .execute();
}

export function buildRawMime(options: {
  fromName: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}): Buffer {
  const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}_${Date.now()}`;
  const headers: string[] = [];

  for (const [label, list] of [
    ['recipient list', options.to],
    ['Cc list', options.cc],
    ['Bcc list', options.bcc],
  ] as const) {
    for (const address of list) assertHeaderSafe(address, label);
  }

  const safeFromName = assertHeaderSafe(options.fromName, 'sender name').replace(/"/g, '\\"');
  headers.push(`From: "${safeFromName}" <${assertHeaderSafe(options.fromEmail, 'sender address')}>`);
  headers.push(`To: ${options.to.join(', ')}`);
  if (options.cc.length > 0) {
    headers.push(`Cc: ${options.cc.join(', ')}`);
  }
  if (options.bcc.length > 0) {
    headers.push(`Bcc: ${options.bcc.join(', ')}`);
  }

  const base64Subject = Buffer.from(options.subject).toString('base64');
  headers.push(`Subject: =?utf-8?B?${base64Subject}?=`);

  headers.push(`MIME-Version: 1.0`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  headers.push('');

  const bodyParts: string[] = [];

  bodyParts.push(`--${boundary}`);
  bodyParts.push(`Content-Type: text/html; charset="UTF-8"`);
  bodyParts.push(`Content-Transfer-Encoding: base64`);
  bodyParts.push('');
  bodyParts.push(Buffer.from(options.html).toString('base64'));
  bodyParts.push('');

  for (const att of options.attachments) {
    bodyParts.push(`--${boundary}`);
    bodyParts.push(`Content-Type: ${att.contentType}; name="${att.filename.replace(/"/g, '\\"')}"`);
    bodyParts.push(`Content-Disposition: attachment; filename="${att.filename.replace(/"/g, '\\"')}"`);
    bodyParts.push(`Content-Transfer-Encoding: base64`);
    bodyParts.push('');
    bodyParts.push(att.content.toString('base64'));
    bodyParts.push('');
  }

  bodyParts.push(`--${boundary}--`);

  const rawMimeString = headers.join('\r\n') + '\r\n' + bodyParts.join('\r\n');
  return Buffer.from(rawMimeString, 'utf-8');
}

// Total attachment bytes accepted for one outbound email (see the send route's multipart loop).
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const storageService = new StorageService();

/** A file already uploaded to storage, ready to be persisted as an email attachment. */
interface UploadedEmailFile {
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
  sha256_hex: string;
  cid: string | null;
  is_inline: boolean;
}

let _oauthSvc: MsOAuthService | null = null;

function getOAuthService(db: Kysely<Models>) {
  if (!_oauthSvc) {
    _oauthSvc = new MsOAuthService(db, {
      clientId: env.msClientId ?? '',
      clientSecret: env.msClientSecret ?? '',
      tenantId: env.msTenantId ?? 'common',
      redirectUri: env.msRedirectUri ?? `${env.apiUrl}/auth/ms/callback`,
    });
  }
  return _oauthSvc;
}

export async function saveLocalEmail(
  db: Kysely<Models>,
  tenantId: string,
  campaignId: string,
  userId: string,
  fromEmail: string,
  fromName: string,
  toList: string[],
  ccList: string[],
  bccList: string[],
  subject: string,
  html: string,
  uploadedFiles: UploadedEmailFile[],
  previewKey: string,
) {
  return db.transaction().execute(async (trx: Transaction<Models>) => {
    // 1. Insert into emails table (Outbox)
    const createdEmail = await trx
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: ALL_FOLDERS.OUTBOX,
        from_email: fromEmail,
        to_email: toList.join(', '),
        subject: subject,
        preview: previewKey,
        // Mail we composed gets the same snippet treatment as mail we received, or the Sent
        // folder would be the one place in the inbox with a blank second line.
        preview_text: previewTextFrom(extractBodyText(html)),
        assigned_to: userId,
        is_favourite: false,
        deleted_at: null,
        status: 'open',
        // Denormalized sort key — must mirror the email_headers.date_sent written below, or the
        // message sorts to the wrong place in the inbox (see the sort-indexes-hot-lists migration).
        date_sent: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const emailId = String(createdEmail.id);

    // 2. Insert html into email_bodies.
    //    Locally composed mail stays inline — it is small and already in hand — but it still gets a
    //    text extract so sent mail is searchable alongside everything synced.
    await trx
      .insertInto('email_bodies')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        body_html: html,
        storage_key: null,
        body_text: extractBodyText(html),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 3. Insert files and email_attachments metadata
    for (const [i, uFile] of uploadedFiles.entries()) {
      let fileId: string;

      // Persist (or reuse, via sha256 dedup) the file row, then link the
      // attachment to it so downloads can resolve the stored blob.
      //
      // The join restricts reuse to a `files` row that is ITSELF an email attachment, matching
      // EmailIngesterService.storeAttachmentPayload. Matching any row in the tenant gave this
      // attachment part-ownership of whatever else happened to have the same bytes (an avatar, a
      // newsletter image), which the email delete sweep then destroyed. Storing identical bytes
      // twice in that rare case is the cheaper mistake.
      const existingFile = await trx
        .selectFrom('files')
        .innerJoin('email_attachments', 'email_attachments.file_id', 'files.id')
        .select('files.id as id')
        .where('files.tenant_id', '=', tenantId)
        .where('email_attachments.tenant_id', '=', tenantId)
        .where('files.sha256_hex', '=', uFile.sha256_hex)
        .limit(1)
        .executeTakeFirst();

      if (existingFile) {
        fileId = String(existingFile.id);
      } else {
        const fileResult = await trx
          .insertInto('files')
          .values({
            tenant_id: tenantId,
            filename: uFile.filename,
            mime_type: uFile.content_type,
            size_bytes: uFile.size_bytes,
            storage_key: uFile.storage_key,
            sha256_hex: uFile.sha256_hex,
            uploaded_by: userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        fileId = String(fileResult.id);
      }

      await trx
        .insertInto('email_attachments')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          filename: uFile.filename,
          content_type: uFile.content_type,
          size_bytes: uFile.size_bytes,
          cid: uFile.cid,
          is_inline: uFile.is_inline,
          pos: i + 1,
          file_id: fileId,
          // Composed locally, so there is no provider-side attachment to fetch later.
          remote_ref: null,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    // 4. Insert headers
    const internetMessageId = `<${crypto.randomUUID()}@pplcrm.local>`;
    const rawHeaders = `Message-ID: ${internetMessageId}\r\nSubject: ${stripHeaderBreaks(subject)}\r\nFrom: "${stripHeaderBreaks(fromName)}" <${stripHeaderBreaks(fromEmail)}>\r\nTo: ${toList.join(', ')}\r\nDate: ${new Date().toUTCString()}\r\n`;

    await trx
      .insertInto('email_headers')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        headers_json: JSON.stringify({ internetMessageId }),
        raw_headers: rawHeaders,
        date_sent: new Date(),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 5. Insert recipients
    const recipientRows: Insertable<Models['email_recipients']>[] = [];
    toList.forEach((emailAddr: string, idx: number) => {
      recipientRows.push({
        tenant_id: tenantId,
        email_id: emailId,
        kind: 'to',
        name: null,
        email: emailAddr,
        pos: idx,
        createdby_id: userId,
        updatedby_id: userId,
      });
    });
    ccList.forEach((emailAddr: string, idx: number) => {
      recipientRows.push({
        tenant_id: tenantId,
        email_id: emailId,
        kind: 'cc',
        name: null,
        email: emailAddr,
        pos: idx,
        createdby_id: userId,
        updatedby_id: userId,
      });
    });
    bccList.forEach((emailAddr: string, idx: number) => {
      recipientRows.push({
        tenant_id: tenantId,
        email_id: emailId,
        kind: 'bcc',
        name: null,
        email: emailAddr,
        pos: idx,
        createdby_id: userId,
        updatedby_id: userId,
      });
    });

    if (recipientRows.length > 0) {
      await trx.insertInto('email_recipients').values(recipientRows).execute();
    }

    return createdEmail;
  });
}

const emailsApiRoute: FastifyPluginCallback = (fastify, _, done) => {
  /** REST mirror of the tRPC `inboxAccessGate`: the shared inbox is Grassroots+ (demo exempt). */
  async function inboxLocked(tenantId: string): Promise<boolean> {
    try {
      await assertInboxAccess(BaseRepository.dbInstance, tenantId);
      return false;
    } catch (_err) {
      return true;
    }
  }

  // Send composed email
  fastify.post('/send', async (req: FastifyRequest, reply) => {
    // Mutating endpoint: enforce session revocation and block read-only viewers.
    const authResult = await authenticateRest(req, { requireWrite: true });
    if (!authResult.ok) {
      return reply.status(authResult.status).send({ error: authResult.error });
    }

    const tenantId = authResult.auth.tenant_id;
    const userId = authResult.auth.user_id;
    const db = BaseRepository.dbInstance;
    if (await inboxLocked(tenantId)) {
      return reply.status(403).send({ error: planGateMessage('inbox') });
    }

    // Retrieve sender user details
    const user = await db
      .selectFrom('authusers')
      .select(['email', 'first_name', 'last_name', 'role', 'campaign_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized: User not found' });
    }

    const fromEmail = user.email;
    const fromName = `${user.first_name} ${user.last_name || ''}`.trim();

    // Parse multipart request parts
    const parts = req.parts();
    const fields: Record<string, string> = {};
    const files: Array<{ filename: string; fieldname: string; mimetype: string; buffer: Buffer }> = [];

    // Reject oversized sends while reading parts, before the whole set is buffered. The global
    // multipart config allows 10 × 50 MB, but Gmail rejects raw messages near 35 MB and Graph is
    // similar — and the Gmail path re-encodes the full message as base64 (+33%), so anything
    // above this cap could only fail later at the provider after the memory was already spent.
    let totalAttachmentBytes = 0;
    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        totalAttachmentBytes += buffer.length;
        if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
          return reply.status(413).send({
            status: 'error',
            message: `Attachments exceed the ${Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024))} MB total limit for one email.`,
          });
        }
        files.push({
          filename: part.filename,
          fieldname: part.fieldname,
          mimetype: part.mimetype,
          buffer,
        });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    // §15 — the active campaign context is sent by the client; the outbound
    // mail and the mailbox it is dispatched through both belong to it.
    const campaignId = fields.campaignId ? String(fields.campaignId) : null;
    if (!campaignId) {
      return reply.status(400).send({ status: 'error', message: 'Missing campaign context.' });
    }

    // Campaigns §15 — Editors/Viewers are pinned to their admin-assigned campaign
    // (office when unassigned); only admins/owners may dispatch mail through
    // another campaign's mailbox. Mirrors the tRPC isAuthed campaign-scope check.
    if (user.role !== 'admin' && user.role !== 'owner') {
      let allowed = user.campaign_id != null ? String(user.campaign_id) : null;
      if (allowed === null) {
        const office = await db
          .selectFrom('campaigns')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('kind', '=', 'office')
          .executeTakeFirst();
        allowed = office ? String(office.id) : null;
      }
      if (campaignId !== allowed) {
        return reply.status(403).send({ status: 'error', message: 'You can only send from your assigned campaign.' });
      }
    }

    // Parse recipient lists and content fields. These are the only user-supplied values that
    // reach a mail header unencoded, so they are validated rather than trusted (see
    // parseRecipientField).
    const toList = parseRecipientField(fields.to, 'to');
    const ccList = parseRecipientField(fields.cc, 'cc');
    const bccList = parseRecipientField(fields.bcc, 'bcc');
    const subject = fields.subject || '';
    const html = sanitizeHtml(fields.html || '');

    // Upload attachment files to storage outside transaction
    const uploadedFiles: UploadedEmailFile[] = [];

    for (const file of files) {
      const sha256_hex = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const fileUUID = crypto.randomUUID();
      const storage_key = `emails/attachments/${fileUUID}_${file.filename}`;

      await storageService.upload(storage_key, file.buffer, file.mimetype);

      uploadedFiles.push({
        filename: file.filename,
        content_type: file.mimetype,
        size_bytes: file.buffer.length,
        storage_key,
        sha256_hex,
        cid: null,
        is_inline: false,
      });
    }

    // Check if user has connected Microsoft and/or Google accounts
    const msToken = await db
      .selectFrom('ms_oauth_tokens')
      .select(['user_id', 'ms_email'])
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();

    const googleToken = await db
      .selectFrom('google_oauth_tokens')
      .select(['user_id', 'google_email'])
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();

    const hasMsConnected = !!msToken;
    const hasGoogleConnected = !!googleToken;

    // Fail immediately if no send method is configured
    if (!hasMsConnected && !hasGoogleConnected) {
      return reply.status(400).send({
        status: 'error',
        message: 'No email dispatch method configured. Please connect a Microsoft or Google account.',
      });
    }

    // Save outbound email to database under Outbox folder '10' initially
    const fallbackPreview =
      html
        .replace(/<[^>]*>/g, '')
        .substring(0, 100)
        .trim() || '';
    let emailRow: Awaited<ReturnType<typeof saveLocalEmail>>;
    try {
      emailRow = await saveLocalEmail(
        db,
        tenantId,
        campaignId,
        userId,
        fromEmail,
        fromName,
        toList,
        ccList,
        bccList,
        subject,
        html,
        uploadedFiles,
        fallbackPreview,
      );
    } catch (err) {
      fastify.log.error(err, 'Failed to save outbound email to database');
      return reply.jsendError(err instanceof Error && err.message ? err.message : 'Failed to save email', 500);
    }

    // Determine send method prioritizing matching address
    let sendMethod: 'ms' | 'google' = 'ms';
    if (hasMsConnected && hasGoogleConnected) {
      if (googleToken?.google_email?.toLowerCase() === fromEmail.toLowerCase()) {
        sendMethod = 'google';
      } else {
        sendMethod = 'ms';
      }
    } else if (hasMsConnected) {
      sendMethod = 'ms';
    } else if (hasGoogleConnected) {
      sendMethod = 'google';
    }

    // Dispatch the email synchronously
    try {
      if (sendMethod === 'ms') {
        const oauthSvc = getOAuthService(db);
        let msDraftId: string | null = null;
        try {
          const accessToken = await oauthSvc.getValidToken(tenantId, campaignId);
          const client = Client.init({
            authProvider: (done) => done(null, accessToken),
          });

          const msDraftMessage = {
            subject: subject,
            body: {
              contentType: 'html',
              content: html,
            },
            toRecipients: toList.map((emailAddr: string) => ({
              emailAddress: { address: emailAddr },
            })),
            ccRecipients: ccList.map((emailAddr: string) => ({
              emailAddress: { address: emailAddr },
            })),
            bccRecipients: bccList.map((emailAddr: string) => ({
              emailAddress: { address: emailAddr },
            })),
          };

          const createdDraft = await client.api('/me/messages').options(sendTimeout()).post(msDraftMessage);
          msDraftId = createdDraft.id;
          const graphInternetMessageId = createdDraft.internetMessageId;

          // Update local email preview/dedupe key to `ms:${msDraftId}`
          await db
            .updateTable('emails')
            .set({ preview: `ms:${msDraftId}`, updated_at: new Date() })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .execute();

          if (graphInternetMessageId) {
            const rawHeaders = `Message-ID: ${graphInternetMessageId}\r\nSubject: ${stripHeaderBreaks(subject)}\r\nFrom: "${stripHeaderBreaks(fromName)}" <${stripHeaderBreaks(fromEmail)}>\r\nTo: ${toList.join(', ')}\r\nDate: ${new Date().toUTCString()}\r\n`;
            await db
              .updateTable('email_headers')
              .set({
                headers_json: JSON.stringify({ internetMessageId: graphInternetMessageId }),
                raw_headers: rawHeaders,
                updated_at: new Date(),
              })
              .where('tenant_id', '=', tenantId)
              .where('email_id', '=', String(emailRow.id))
              .execute();
          }

          // Upload attachments
          for (const file of files) {
            await client
              .api(`/me/messages/${msDraftId}/attachments`)
              .options(sendTimeout())
              .post({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: file.filename,
                contentType: file.mimetype,
                contentBytes: file.buffer.toString('base64'),
              });
          }

          // Send draft
          await client.api(`/me/messages/${msDraftId}/send`).options(sendTimeout()).post({});

          // Move local email to Sent on success
          const finalEmail = await db
            .updateTable('emails')
            .set({ folder_id: ALL_FOLDERS.SENT, updated_at: new Date() })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .returningAll()
            .executeTakeFirstOrThrow();

          // Sync folders/Sent items through the outbox so the work survives a deploy.
          try {
            await queueMailboxSync(db, 'ms_sync', tenantId, campaignId, userId);
          } catch (err) {
            fastify.log.error(err, `Failed to queue mailbox sync after sending email ${emailRow.id}`);
          }

          try {
            const { queueUsageLimitCheck } = await import('../../billing/usage-limits');
            await queueUsageLimitCheck(tenantId, db);
          } catch (_err) {
            fastify.log.error(_err, `Failed to trigger usage check after sending MS email ${emailRow.id}`);
          }

          return reply.jsendSuccess(finalEmail);
        } catch (err) {
          fastify.log.error(err, `Failed to send email via Microsoft Graph for email ${emailRow.id}`);
          if (isDeadlineAbort(err)) {
            // Our deadline fired mid-flight: Graph may have already accepted the send. Deleting
            // the local row here told the user "failed", inviting a duplicate — keep the message
            // in Drafts and say the outcome is unknown instead.
            await db
              .updateTable('emails')
              .set({ folder_id: ALL_FOLDERS.DRAFTS, updated_at: new Date() })
              .where('tenant_id', '=', tenantId)
              .where('id', '=', String(emailRow.id))
              .execute();
            return reply.jsendError(TIMED_OUT_SEND_MESSAGE, 400);
          }
          // A definite provider refusal — clean up the local email.
          await db
            .deleteFrom('emails')
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .execute();
          return reply.jsendError(
            err instanceof Error && err.message ? err.message : 'Failed to send email via Microsoft Graph',
            400,
          );
        }
      } else if (sendMethod === 'google') {
        const oauthSvc = new GoogleOAuthService(db, {
          clientId: env.googleClientId ?? '',
          clientSecret: env.googleClientSecret ?? '',
          redirectUri: env.googleRedirectUri ?? `${env.apiUrl}/auth/google/callback`,
        });

        try {
          const accessToken = await oauthSvc.getValidToken(tenantId, campaignId);

          const rawMessageBuffer = buildRawMime({
            fromName,
            fromEmail,
            to: toList,
            cc: ccList,
            bcc: bccList,
            subject,
            html,
            attachments: files.map((file) => ({
              filename: file.filename,
              content: file.buffer,
              contentType: file.mimetype,
            })),
          });

          // base64url is the unpadded URL-safe alphabet Gmail expects; encoding it directly
          // avoids materializing the padded base64 string plus three .replace() copies of the
          // whole message.
          const rawBase64Url = rawMessageBuffer.toString('base64url');

          const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              raw: rawBase64Url,
            }),
            signal: AbortSignal.timeout(SEND_REQUEST_TIMEOUT_MS),
          });

          if (!gmailRes.ok) {
            const errText = await gmailRes.text();
            throw new Error(`Gmail API send failed: ${errText}`);
          }

          const gmailData = (await gmailRes.json()) as { id?: string };
          const googleMsgId = gmailData.id;

          await db
            .updateTable('emails')
            .set({ preview: `google:${googleMsgId}`, updated_at: new Date() })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .execute();

          const finalEmail = await db
            .updateTable('emails')
            .set({ folder_id: ALL_FOLDERS.SENT, updated_at: new Date() })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .returningAll()
            .executeTakeFirstOrThrow();

          try {
            await queueMailboxSync(db, 'google_sync', tenantId, campaignId, userId);
          } catch (err) {
            fastify.log.error(err, `Failed to queue mailbox sync after sending Google email ${emailRow.id}`);
          }

          try {
            const { queueUsageLimitCheck } = await import('../../billing/usage-limits');
            await queueUsageLimitCheck(tenantId, db);
          } catch (_err) {
            fastify.log.error(_err, `Failed to trigger usage check after sending Google email ${emailRow.id}`);
          }

          return reply.jsendSuccess(finalEmail);
        } catch (err) {
          fastify.log.error(err, `Failed to send email via Google for email ${emailRow.id}`);
          await db
            .updateTable('emails')
            .set({
              // Revert to Drafts so the user can retry (was '4' = Spam, a bug)
              folder_id: ALL_FOLDERS.DRAFTS,
              updated_at: new Date(),
            })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', String(emailRow.id))
            .execute();

          return reply.jsendError(
            isDeadlineAbort(err)
              ? TIMED_OUT_SEND_MESSAGE
              : err instanceof Error && err.message
                ? err.message
                : 'Failed to send email via Google. Saved to Drafts.',
            400,
          );
        }
      }
    } catch (err) {
      fastify.log.error(err, `Unexpected error in send task for email ${emailRow.id}`);
      // Clean up local email
      await db.deleteFrom('emails').where('tenant_id', '=', tenantId).where('id', '=', String(emailRow.id)).execute();
      return reply.jsendError(err instanceof Error && err.message ? err.message : 'Unexpected error in send task', 500);
    }
  });

  // Download attachment by ID
  fastify.get<{ Params: { id: string; attachmentId: string }; Querystring: { st?: string } }>(
    '/:id/attachments/:attachmentId',
    async (req, reply) => {
      const { id, attachmentId } = req.params;

      // Auth: a short-lived token scoped to this one email (embeddable link, no
      // session JWT in the URL) or the app's Authorization header (session-gated).
      let tenantId: string;
      if (req.query.st) {
        try {
          tenantId = verifyEmailAttachmentToken(req.query.st, String(id)).tenant_id;
        } catch (_err) {
          return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
        }
      } else {
        const authResult = await authenticateRest(req);
        if (!authResult.ok) {
          return reply.status(authResult.status).send({ error: authResult.error });
        }
        tenantId = authResult.auth.tenant_id;
      }
      const db = BaseRepository.dbInstance;
      if (await inboxLocked(tenantId)) {
        return reply.status(403).send({ error: planGateMessage('inbox') });
      }

      const attachment = await db
        .selectFrom('email_attachments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', attachmentId)
        .where('email_id', '=', id)
        .executeTakeFirst();

      if (!attachment) {
        return reply.status(404).send({ error: 'Attachment not found' });
      }

      // Synced attachments are recorded without their payload; the first download fetches it.
      const materialized = await materializeAttachment(db, tenantId, attachment);
      if (materialized.status === 'forbidden') {
        return reply.status(403).send({
          error: 'Attachments on messages marked as spam cannot be downloaded.',
        });
      }
      if (materialized.status === 'unavailable') {
        return reply.status(404).send({ error: 'This attachment is no longer available from the mailbox.' });
      }

      const file = await db
        .selectFrom('files')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', materialized.fileId)
        .executeTakeFirst();

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      try {
        const buffer = await storageService.download(file.storage_key);
        reply.type(file.mime_type || 'application/octet-stream');
        reply.header('Content-Disposition', attachmentDisposition(file.filename));
        return reply.send(buffer);
      } catch (_err) {
        fastify.log.error(_err);
        return reply.status(500).send({ error: 'Failed to download attachment' });
      }
    },
  );

  // Serve inline attachment by CID
  fastify.get<{ Params: { id: string; cid: string }; Querystring: { st?: string } }>(
    '/:id/attachments/cid/:cid',
    async (req, reply) => {
      const { id, cid } = req.params;

      // Auth: a short-lived token scoped to this one email (for inline <img> in the
      // rendered body) or the app's Authorization header (session-gated).
      let tenantId: string;
      if (req.query.st) {
        try {
          tenantId = verifyEmailAttachmentToken(req.query.st, String(id)).tenant_id;
        } catch (_err) {
          return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
        }
      } else {
        const authResult = await authenticateRest(req);
        if (!authResult.ok) {
          return reply.status(authResult.status).send({ error: authResult.error });
        }
        tenantId = authResult.auth.tenant_id;
      }
      const db = BaseRepository.dbInstance;
      if (await inboxLocked(tenantId)) {
        return reply.status(403).send({ error: planGateMessage('inbox') });
      }

      const attachment = await db
        .selectFrom('email_attachments')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('email_id', '=', id)
        .where('cid', '=', cid)
        .where('is_inline', '=', true)
        .executeTakeFirst();

      if (!attachment) {
        return reply.status(404).send({ error: 'Inline attachment not found' });
      }

      // Inline images are materialized on first view, same as any other attachment — which is why
      // the ingester rewrites `cid:` to point here rather than embedding the bytes. In Spam the
      // rewrite never happens and this path refuses anyway.
      const materialized = await materializeAttachment(db, tenantId, attachment);
      if (materialized.status !== 'ok') {
        return reply.status(materialized.status === 'forbidden' ? 403 : 404).send({ error: 'Image not available' });
      }

      const file = await db
        .selectFrom('files')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', materialized.fileId)
        .executeTakeFirst();

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      try {
        const buffer = await storageService.download(file.storage_key);
        reply.type(file.mime_type || 'application/octet-stream');
        // Private: inline attachments are tenant-scoped and token-gated.
        reply.header('Cache-Control', 'private, max-age=31536000');
        return reply.send(buffer);
      } catch (_err) {
        fastify.log.error(_err);
        return reply.status(500).send({ error: 'Failed to load inline image' });
      }
    },
  );

  done();
};

export default emailsApiRoute;
