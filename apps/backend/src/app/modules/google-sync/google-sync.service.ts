/* eslint-disable @typescript-eslint/no-explicit-any -- Gmail REST sync adapter: the `any` in this file are deeply-nested Gmail message/attachment payloads with no installed type package. File-scoped by design; see the pplcrm-any-exceptions skill. */
import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type { GoogleOAuthService } from './google-oauth.service';
import type { IngestableEmail } from '../emails/services/email-ingester.service';
import { EmailIngesterService } from '../emails/services/email-ingester.service';
import { ALL_FOLDERS } from '../../../../../../libs/common/src/lib/emails';
import { logger } from '../../logger';

const MAX_MESSAGES_PER_SYNC = 50;

/**
 * How far back a first sync reaches.
 *
 * Connecting a mailbox used to pull its entire history — every message, body and attachment, for
 * every folder — which for a real account meant a job that could not finish inside its timeout and
 * restarted from zero on each retry, and a triage queue full of mail the user dealt with months
 * ago. Two days is enough that the inbox has substance immediately, and short enough that connecting
 * completes in seconds. Everything after that arrives incrementally.
 */
const INITIAL_SYNC_WINDOW_HOURS = 48;
const SECONDS_PER_HOUR = 3600;

/** Overlap buffer on incremental syncs, so a message landing mid-run is not missed. */
const INCREMENTAL_OVERLAP_SECONDS = 60;

// Total-request deadline per attempt (same AbortSignal.timeout idiom as the other providers).
// Without it a black-holed Gmail call holds a worker slot for undici's ~300s defaults.
const GMAIL_REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithRetry(url: string, init?: RequestInit, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    // A fresh signal per attempt — a single AbortSignal.timeout starts ticking at creation and
    // would already be aborted by the time a rate-limited retry runs.
    const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(GMAIL_REQUEST_TIMEOUT_MS) });
    if (res.status === 429 && attempt <= maxRetries) {
      const retryAfterHeader = res.headers.get('Retry-After');
      let delayMs = 5000;
      if (retryAfterHeader) {
        const parsed = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsed)) {
          delayMs = parsed * 1000;
        } else {
          const parsedDate = Date.parse(retryAfterHeader);
          if (!isNaN(parsedDate)) {
            delayMs = Math.max(0, parsedDate - Date.now());
          }
        }
      } else {
        delayMs = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s...
      }
      logger.warn(
        `Google API rate limited (429) on ${url}. Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    return res;
  }
}

export class GoogleSyncService {
  private readonly ingester: EmailIngesterService;

  constructor(
    private readonly db: Kysely<Models>,
    private readonly oauthSvc: GoogleOAuthService,
  ) {
    this.ingester = new EmailIngesterService(db, 'google');
  }

  public async syncTenant(tenantId: string, campaignId: string, requestedBy: string): Promise<{ inserted: number }> {
    const accessToken = await this.oauthSvc.getValidToken(tenantId, campaignId);

    // Map Gmail label names to pplcrm folder IDs
    const syncFolders = [
      { label: 'INBOX', pplcrmId: ALL_FOLDERS.INBOX },
      { label: 'SENT', pplcrmId: ALL_FOLDERS.SENT },
      { label: 'TRASH', pplcrmId: ALL_FOLDERS.TRASH },
      { label: 'SPAM', pplcrmId: ALL_FOLDERS.SPAM },
    ];

    // Stored delta_link is a JSON-encoded map of label -> last_sync_time (epoch seconds).
    // A sentinel value { _needs_full_sync: true } signals that all folders must be fully resynced
    // (set on reconnect or after removeAllLocalEmails). saveDeltaLink overwrites it with real
    // positions after a successful sync, so no explicit clear is needed.
    const dbDeltaLink = await this.oauthSvc.getDeltaLink(tenantId, campaignId);
    let deltaMap: Record<string, number> = {};
    if (dbDeltaLink) {
      try {
        const parsed = JSON.parse(dbDeltaLink);
        if (!parsed._needs_full_sync) {
          deltaMap = parsed;
        }
        // _needs_full_sync → leave deltaMap empty, triggering a full sync for every folder
      } catch {
        deltaMap = {};
      }
    }

    let inserted = 0;
    const nextDeltaMap: Record<string, number> = { ...deltaMap };
    const currentSyncTime = Math.floor(Date.now() / 1000);

    for (const folder of syncFolders) {
      const folderLastSync = deltaMap[folder.label] || 0;

      let pageToken: string | null = null;
      let hasMore = true;
      const allMessageIds: string[] = [];

      // Query Gmail messages: `label:<LABEL>` bounded by `after:<epoch_seconds>`.
      //
      // Incremental runs resume from the stored watermark (minus an overlap buffer). A first sync —
      // or a forced re-sync, which clears the watermark — reaches back only INITIAL_SYNC_WINDOW_HOURS.
      // There is deliberately no unbounded branch: every query carries an `after:` clause.
      const windowStart =
        folderLastSync > 0
          ? folderLastSync - INCREMENTAL_OVERLAP_SECONDS
          : currentSyncTime - INITIAL_SYNC_WINDOW_HOURS * SECONDS_PER_HOUR;
      const q = `label:${folder.label} after:${windowStart}`;

      while (hasMore) {
        const urlParams = new URLSearchParams({
          maxResults: String(MAX_MESSAGES_PER_SYNC),
          q,
        });
        if (pageToken) urlParams.set('pageToken', pageToken);

        const res = await fetchWithRetry(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${urlParams.toString()}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Gmail API error: ${errText}`);
        }

        const data: any = await res.json();
        const messages = data.messages ?? [];
        allMessageIds.push(...messages.map((m: any) => m.id));

        if (data.nextPageToken) {
          pageToken = data.nextPageToken;
        } else {
          hasMore = false;
        }
      }

      // Process all messages fetched
      for (const msgId of allMessageIds) {
        try {
          const wasSaved = await this.syncMessageDetails(
            accessToken,
            msgId,
            tenantId,
            campaignId,
            requestedBy,
            folder.pplcrmId,
          );
          if (wasSaved) inserted++;
        } catch (err) {
          logger.error({ err }, `Failed to sync Gmail message details for ${msgId}`);
        }
      }

      nextDeltaMap[folder.label] = currentSyncTime;

      // Reconcile disappearances. Gmail has no tombstones, so the only way to notice a message that
      // is no longer in this label is to compare against what the server just returned. "No longer
      // in this label" covers archiving and moving as well as deleting, and this comparison is
      // fallible besides (it trusts a sender-supplied `Date:` header against Gmail's own
      // received-time filter), so a message that fails it is DETACHED — hidden from the folder,
      // row and CRM comments/assignment/status kept — never destroyed.
      //
      // The candidate set MUST be scoped to the window we actually fetched. `allMessageIds` only
      // describes mail since `windowStart`, so comparing it against every local row would treat the
      // entire older archive as deleted — and because a forced re-sync clears the watermark, that
      // would wipe an established mailbox's history on the press of a button.
      if (folderLastSync === 0) {
        const serverGoogleIds = new Set(allMessageIds);
        const localEmails = await this.db
          .selectFrom('emails')
          .innerJoin('email_headers', 'email_headers.email_id', 'emails.id')
          .select(['emails.id as id', 'emails.preview as preview'])
          .where('emails.tenant_id', '=', tenantId)
          .where('emails.campaign_id', '=', campaignId)
          .where('emails.folder_id', '=', folder.pplcrmId)
          .where('emails.preview', 'like', 'google:%')
          .where('emails.detached_at', 'is', null)
          .where('email_headers.tenant_id', '=', tenantId)
          .where('email_headers.date_sent', '>=', new Date(windowStart * 1000))
          .execute();

        for (const localEmail of localEmails) {
          const previewKey = localEmail.preview ?? '';
          const googleId = previewKey.replace(/^google:/, '');
          if (!serverGoogleIds.has(googleId)) {
            await this.ingester.detachMessage(tenantId, campaignId, googleId);
          }
        }
      }

      // Checkpoint per folder: a failure in Spam must not discard Inbox's progress, which would
      // otherwise send the next run back to a full re-fetch.
      await this.oauthSvc.saveDeltaLink(tenantId, campaignId, JSON.stringify(nextDeltaMap));
    }

    return { inserted };
  }

  public async removeAllLocalEmails(tenantId: string, campaignId: string): Promise<void> {
    await this.ingester.removeAllLocalEmails(tenantId, campaignId);
  }

  private async syncMessageDetails(
    accessToken: string,
    msgId: string,
    tenantId: string,
    campaignId: string,
    requestedBy: string,
    folderId: string,
  ): Promise<boolean> {
    const res = await fetchWithRetry(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 404) {
        return false; // message deleted in the meantime
      }
      const errText = await res.text();
      throw new Error(`Failed to fetch Gmail message ${msgId} details: ${errText}`);
    }

    const data: any = await res.json();
    const payload = data.payload;
    if (!payload) return false;

    const headers = payload.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;

    const subject = getHeader('subject');
    const fromVal = getHeader('from');
    const toVal = getHeader('to');
    const dateVal = getHeader('date');
    const internetMessageId = getHeader('message-id');

    // Parse email addresses from "Name <email@domain.com>" format
    const extractEmail = (val: string | null): string | null => {
      if (!val) return null;
      const match = val.match(/<([^>]+)>/);
      return match ? (match[1] as string) : val.trim();
    };

    const fromEmail = extractEmail(fromVal);
    const toEmail = extractEmail(toVal);
    let dateSent = dateVal ? new Date(dateVal) : new Date();
    if (isNaN(dateSent.getTime())) {
      dateSent = new Date();
    }

    // Parse body parts recursively
    const parts = payload.parts ? payload.parts : [payload];
    const { html, text, attachments } = this.parseGmailParts(parts);
    const bodyHtml = html || text || '';

    // Map attachments to the generic ingestable structure
    const mappedAttachments = attachments.map((att: any) => ({
      name: att.filename,
      contentType: att.mimeType,
      size: att.size,
      contentId: att.cid,
      isInline: att.isInline,
      // Kept so an attachment we choose not to download now can be fetched later. Gmail may
      // reissue an attachmentId, so the download path re-reads the message to get a fresh one
      // and treats this as a hint rather than a guarantee.
      remoteRef: att.attachmentId ?? null,
      fetchContent: async () => {
        const attRes = await fetchWithRetry(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${att.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!attRes.ok) {
          throw new Error(`Failed to fetch attachment ${att.filename} from Gmail`);
        }
        const attData: any = await attRes.json();
        return this.decodeBase64UrlToBuffer(attData.data);
      },
    }));

    // Parse recipients
    const recipients: Array<{ kind: 'to' | 'cc' | 'bcc'; name: string | null; email: string }> = [];

    const parseRecipientHeader = (val: string | null, kind: 'to' | 'cc' | 'bcc') => {
      if (!val) return;
      // Split by comma, respecting quotes
      const list = val.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      list.forEach((item) => {
        const trimmed = item.trim();
        if (!trimmed) return;
        const emailMatch = trimmed.match(/<([^>]+)>/);
        const email = emailMatch ? (emailMatch[1] as string) : trimmed;
        const nameMatch = trimmed.match(/^([^<]+)/);
        let name = nameMatch ? (nameMatch[1] as string).trim() : null;
        if (name) {
          name = name.replace(/^["']|["']$/g, ''); // strip quotes
        }
        recipients.push({ kind, name, email });
      });
    };

    parseRecipientHeader(getHeader('to'), 'to');
    parseRecipientHeader(getHeader('cc'), 'cc');
    parseRecipientHeader(getHeader('bcc'), 'bcc');

    const ingestable: IngestableEmail = {
      id: msgId,
      internetMessageId,
      fromEmail,
      toEmail,
      subject,
      dateSent,
      bodyHtml,
      recipients,
      attachments: mappedAttachments,
    };

    return this.ingester.ingestEmail(ingestable, tenantId, campaignId, requestedBy, folderId);
  }

  private parseGmailParts(parts: any[]): { html: string; text: string; attachments: any[] } {
    let html = '';
    let text = '';
    const attachments: any[] = [];

    const traverse = (part: any) => {
      const mimeType = part.mimeType?.toLowerCase();
      const filename = part.filename;
      const body = part.body;

      if (filename && body?.attachmentId) {
        const headers = part.headers ?? [];
        const contentDisposition =
          headers.find((h: any) => h.name.toLowerCase() === 'content-disposition')?.value ?? '';
        const isInline = contentDisposition.toLowerCase().includes('inline');
        const contentIdHeader = headers.find((h: any) => h.name.toLowerCase() === 'content-id')?.value ?? '';
        const cid = contentIdHeader ? contentIdHeader.replace(/[<>]/g, '') : null;

        attachments.push({
          filename,
          mimeType: part.mimeType,
          attachmentId: body.attachmentId,
          size: body.size ?? 0,
          cid,
          isInline,
        });
      } else if (mimeType === 'text/html' && body?.data) {
        html += this.decodeBase64Url(body.data);
      } else if (mimeType === 'text/plain' && body?.data) {
        text += this.decodeBase64Url(body.data);
      }

      if (part.parts) {
        for (const p of part.parts) {
          traverse(p);
        }
      }
    };

    for (const part of parts) {
      traverse(part);
    }

    return { html, text, attachments };
  }

  private decodeBase64Url(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  private decodeBase64UrlToBuffer(str: string): Buffer {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64');
  }
}
