import { Client } from '@microsoft/microsoft-graph-client';
import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { allowsAttachmentDownload } from '../../../../../../../libs/common/src/lib/emails';
import { env } from '../../../../env';
import { logger } from '../../../logger';
import { EmailIngesterService } from './email-ingester.service';
import { GoogleOAuthService } from '../../google-sync/google-oauth.service';
import { MsOAuthService } from '../../ms-sync/ms-oauth.service';
import { fetchGraphAttachmentContent } from '../../ms-sync/ms-sync.service';

/**
 * On-demand attachment materialization.
 *
 * Syncing a mailbox records what attachments exist without downloading them — only small files in
 * the folders people work out of are fetched up front. Everything else arrives here, the first time
 * someone actually clicks it, and is then stored permanently so the second click is free and the
 * file survives the message being deleted upstream.
 *
 * Two things this deliberately does NOT do:
 *  - Materialize anything in Spam. Junk-folder payloads never enter our storage account, so they
 *    are refused here regardless of who asks. The row stays visible so a false positive is still
 *    recognisable; retrieving the file means moving the message out of Spam in the mail client.
 *  - Guess. If the provider no longer has the message, the attachment is simply gone; callers get
 *    null and say so, rather than reporting a generic failure.
 */

export type MaterializeResult = { status: 'ok'; fileId: string } | { status: 'forbidden' } | { status: 'unavailable' };

/** Deadline for provider attachment downloads — generous because payloads can be large,
 *  but a hung connection must not stall a worker slot indefinitely. */
const ATTACHMENT_FETCH_TIMEOUT_MS = 60_000;

/** Which provider a synced email came from, read from its dedupe key. */
function parseProviderKey(preview: string | null): { provider: 'google' | 'ms'; messageId: string } | null {
  if (!preview) return null;
  if (preview.startsWith('google:')) return { provider: 'google', messageId: preview.slice('google:'.length) };
  if (preview.startsWith('ms:')) return { provider: 'ms', messageId: preview.slice('ms:'.length) };
  return null;
}

/**
 * Gmail may reissue an attachmentId, so the stored `remote_ref` is only a hint. Re-read the message
 * and locate the part by filename (falling back to the stored id) before fetching.
 */
async function fetchGmailAttachmentContent(
  accessToken: string,
  messageId: string,
  filename: string,
  remoteRef: string | null,
): Promise<Buffer> {
  const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`, {
    signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!msgRes.ok) {
    throw new Error(`Gmail message ${messageId} unavailable: ${msgRes.status}`);
  }

  const data = (await msgRes.json()) as { payload?: unknown };
  let attachmentId: string | null = null;

  const visit = (part: unknown): void => {
    if (attachmentId || typeof part !== 'object' || part === null) return;
    const p = part as { filename?: string; body?: { attachmentId?: string }; parts?: unknown[] };
    if (p.filename === filename && p.body?.attachmentId) {
      attachmentId = p.body.attachmentId;
      return;
    }
    for (const child of p.parts ?? []) visit(child);
  };
  visit(data.payload);

  const idToFetch = attachmentId ?? remoteRef;
  if (!idToFetch) {
    throw new Error(`Attachment ${filename} not found on Gmail message ${messageId}`);
  }

  const attRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${idToFetch}`,
    { signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS), headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!attRes.ok) {
    throw new Error(`Gmail attachment ${idToFetch} unavailable: ${attRes.status}`);
  }

  const attData = (await attRes.json()) as { data?: string };
  if (!attData.data) {
    throw new Error(`Gmail attachment ${idToFetch} returned no data`);
  }
  let base64 = attData.data.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64');
}

/**
 * Ensure an attachment's payload is stored, fetching it from the provider if this is the first ask.
 * Returns the `files` row id to serve from, or why it cannot be served.
 */
export async function materializeAttachment(
  db: Kysely<Models>,
  tenantId: string,
  attachment: {
    id: string;
    email_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    file_id: string | null;
    remote_ref: string | null;
  },
): Promise<MaterializeResult> {
  if (attachment.file_id) return { status: 'ok', fileId: attachment.file_id };

  const email = await db
    .selectFrom('emails')
    .select(['preview', 'folder_id', 'campaign_id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', attachment.email_id)
    .executeTakeFirst();

  if (!email) return { status: 'unavailable' };

  // Spam payloads are never stored, no matter who asks.
  if (!allowsAttachmentDownload(email.folder_id)) return { status: 'forbidden' };

  const parsed = parseProviderKey(email.preview);
  if (!parsed) return { status: 'unavailable' };

  const campaignId = String(email.campaign_id);

  let buffer: Buffer;
  try {
    if (parsed.provider === 'google') {
      const oauthSvc = new GoogleOAuthService(db, {
        clientId: env.googleClientId ?? '',
        clientSecret: env.googleClientSecret ?? '',
        redirectUri: env.googleRedirectUri ?? `${env.apiUrl}/auth/google/callback`,
      });
      const accessToken = await oauthSvc.getValidToken(tenantId, campaignId);
      buffer = await fetchGmailAttachmentContent(
        accessToken,
        parsed.messageId,
        attachment.filename,
        attachment.remote_ref,
      );
    } else {
      const oauthSvc = new MsOAuthService(db, {
        clientId: env.msClientId ?? '',
        clientSecret: env.msClientSecret ?? '',
        tenantId: env.msTenantId ?? 'common',
        redirectUri: env.msRedirectUri ?? `${env.apiUrl}/auth/ms/callback`,
      });
      const accessToken = await oauthSvc.getValidToken(tenantId, campaignId);
      const client = Client.init({ authProvider: (done) => done(null, accessToken) });
      if (!attachment.remote_ref) return { status: 'unavailable' };
      buffer = await fetchGraphAttachmentContent(client, parsed.messageId, attachment.remote_ref);
    }
  } catch (err) {
    // Disconnected mailbox, revoked token, or a message deleted upstream. The file is genuinely
    // gone from our reach — the caller reports that plainly rather than as a server error.
    logger.error({ err }, `Could not materialize attachment ${attachment.id} for email ${attachment.email_id}`);
    return { status: 'unavailable' };
  }

  const ingester = new EmailIngesterService(db, parsed.provider);
  const stored = await ingester.storeAttachmentPayload(tenantId, attachment.filename, attachment.content_type, buffer);

  const fileId =
    stored.existing_file_id ??
    String(
      (
        await db
          .insertInto('files')
          .values({
            tenant_id: tenantId,
            filename: stored.filename,
            mime_type: stored.content_type,
            size_bytes: buffer.length,
            storage_key: stored.storage_key,
            sha256_hex: stored.sha256_hex,
            uploaded_by: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id,
    );

  await db
    .updateTable('email_attachments')
    .set({ file_id: fileId, updated_at: new Date() })
    .where('tenant_id', '=', tenantId)
    .where('id', '=', attachment.id)
    .execute();

  return { status: 'ok', fileId };
}
