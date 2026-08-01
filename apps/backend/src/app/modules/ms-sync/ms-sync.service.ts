/* eslint-disable @typescript-eslint/no-explicit-any -- MS Graph sync adapter: the `any` in this file are MS Graph message/attachment payloads; @microsoft/microsoft-graph-types is not installed. File-scoped by design; see the pplcrm-any-exceptions skill. */
import { Client } from '@microsoft/microsoft-graph-client';
import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type { MsOAuthService } from './ms-oauth.service';
import { ALL_FOLDERS } from '../../../../../../libs/common/src/lib/emails';
import type { IngestableEmail } from '../emails/services/email-ingester.service';
import { EmailIngesterService } from '../emails/services/email-ingester.service';
import { logger } from '../../logger';

const MAX_MESSAGES_PER_SYNC = 50;

/**
 * How far back a first sync reaches. See the matching constant in the Gmail adapter — connecting a
 * mailbox used to enumerate and ingest its entire history, which no real account survives inside a
 * job timeout. Everything after the initial window arrives incrementally via the delta link.
 */
const INITIAL_SYNC_WINDOW_HOURS = 48;

const MESSAGE_SELECT =
  '$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,body,receivedDateTime,hasAttachments,parentFolderId,internetMessageId';

/**
 * Build the starting delta URL for a folder, bounded to the initial window.
 *
 * `$filter` support on the message delta endpoint is limited to `receivedDateTime` comparisons, so
 * this is the one filter available. The page loop also re-checks `receivedDateTime` per message,
 * which keeps the bound correct even if Graph declines to apply the filter — enumeration may still
 * be full in that case, but the expensive part (per-message ingest, body storage, attachment
 * fetches) is skipped, and that is where the cost actually lives.
 */
function initialDeltaUrl(wellKnownName: string, windowStart: Date): string {
  const filter = `&$filter=receivedDateTime ge ${windowStart.toISOString()}`;
  return `/me/mailFolders/${wellKnownName}/messages/delta?$top=${MAX_MESSAGES_PER_SYNC}&${MESSAGE_SELECT}${filter}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStatusCode(err: unknown): number | undefined {
  return isRecord(err) && typeof err['statusCode'] === 'number' ? err['statusCode'] : undefined;
}

function getRetryAfterHeader(err: unknown): string | undefined {
  if (!isRecord(err)) return undefined;
  const headers = err['headers'];
  if (!isRecord(headers)) return undefined;
  const getFn = headers['get'];
  if (typeof getFn === 'function') {
    const value: unknown = (getFn as (name: string) => unknown).call(headers, 'Retry-After');
    if (typeof value === 'string') return value;
  }
  const raw = headers['retry-after'];
  return typeof raw === 'string' ? raw : undefined;
}

async function graphCallWithRetry<T>(callFn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await callFn();
    } catch (err) {
      if (getStatusCode(err) === 429 && attempt <= maxRetries) {
        let delayMs = 5000;
        const retryAfter = getRetryAfterHeader(err);
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delayMs = parsed * 1000;
          }
        } else {
          delayMs = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s...
        }
        logger.warn(`MS Graph API rate limited (429). Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch one attachment's payload from Graph.
 *
 * Reading a single attachment by id returns it with `contentBytes` populated, which is why the
 * listing call deliberately omits that field — the bytes come from here, only for attachments
 * somebody actually wants. Exported so the on-demand download route stores payloads exactly the
 * way the sync path does.
 */
export async function fetchGraphAttachmentContent(client: Client, messageId: string, attachmentId: string) {
  const att: any = await graphCallWithRetry(() =>
    client.api(`/me/messages/${messageId}/attachments/${attachmentId}`).get(),
  );
  if (!att?.contentBytes) {
    throw new Error(`MS Graph attachment ${attachmentId} returned no content`);
  }
  return Buffer.from(att.contentBytes, 'base64');
}

export class MsSyncService {
  private readonly ingester: EmailIngesterService;

  constructor(
    private readonly db: Kysely<Models>,
    private readonly oauthSvc: MsOAuthService,
  ) {
    this.ingester = new EmailIngesterService(db, 'ms');
  }

  public async syncTenant(tenantId: string, campaignId: string, requestedBy: string): Promise<{ inserted: number }> {
    const accessToken = await this.oauthSvc.getValidToken(tenantId, campaignId);
    const client = this.buildGraphClient(accessToken);

    const syncFolders = [
      { wellKnownName: 'inbox', pplcrmId: ALL_FOLDERS.INBOX },
      { wellKnownName: 'sentitems', pplcrmId: ALL_FOLDERS.SENT },
      { wellKnownName: 'deleteditems', pplcrmId: ALL_FOLDERS.TRASH },
      { wellKnownName: 'junkemail', pplcrmId: ALL_FOLDERS.SPAM },
    ];

    // Read stored delta map.
    // A sentinel value { _needs_full_sync: true } signals that all folders must be fully resynced
    // (set on reconnect or after removeAllLocalEmails). saveDeltaLink overwrites it with real
    // positions after a successful sync, so no explicit clear is needed.
    const dbDeltaLink = await this.oauthSvc.getDeltaLink(tenantId, campaignId);
    let deltaMap: Record<string, string> = {};
    if (dbDeltaLink) {
      try {
        const parsed = JSON.parse(dbDeltaLink);
        if (!parsed._needs_full_sync) {
          deltaMap = parsed;
        }
        // _needs_full_sync → leave deltaMap empty, triggering a full sync for every folder
      } catch {
        // If not valid JSON, it's a legacy plain URL string. Clear it.
        deltaMap = {};
      }
    }

    let inserted = 0;
    const nextDeltaMap: Record<string, string> = { ...deltaMap };
    const windowStart = new Date(Date.now() - INITIAL_SYNC_WINDOW_HOURS * 60 * 60 * 1000);

    for (const folder of syncFolders) {
      const folderDeltaLink = deltaMap[folder.wellKnownName] || null;

      let pageUrl: string | null = folderDeltaLink ?? initialDeltaUrl(folder.wellKnownName, windowStart);

      const allMessages: any[] = [];
      let isInitialSync = folderDeltaLink === null;
      let hasMore = true;

      while (pageUrl && hasMore) {
        const url = pageUrl;
        try {
          const response: any = await graphCallWithRetry(() => client.api(url).get());
          const messages = response.value ?? [];
          allMessages.push(...messages);

          const nextLink = response['@odata.nextLink'] ?? null;
          const deltaLink = response['@odata.deltaLink'] ?? null;

          if (deltaLink) {
            nextDeltaMap[folder.wellKnownName] = deltaLink;
            hasMore = false;
          } else if (nextLink) {
            pageUrl = nextLink;
          } else {
            hasMore = false;
          }
        } catch (err) {
          if (getStatusCode(err) === 410) {
            // Delta link expired for this folder, clear it
            delete nextDeltaMap[folder.wellKnownName];
            isInitialSync = true;
            allMessages.length = 0; // clear any partially loaded pages before restarting
            // Restart bounded, exactly like a first sync — an expired delta link must not become a
            // back door to re-enumerating the whole mailbox.
            pageUrl = initialDeltaUrl(folder.wellKnownName, windowStart);
          } else {
            throw err;
          }
        }
      }

      // Process all messages fetched in this sync run
      for (const msg of allMessages) {
        if (msg['@removed']) {
          // `@removed` on a FOLDER-scoped delta means "no longer in this folder", not "deleted".
          // Archiving a message in Outlook, dragging it elsewhere, or an inbox rule filing it all
          // produce this on the very next incremental sync. So this detaches the CRM's copy — hides
          // it from the folder listing, keeps the row and every comment, assignment and status on
          // it. It used to hard-delete all of that.
          const msId = msg.id;
          if (msId) {
            await this.ingester.detachMessage(tenantId, campaignId, msId);
          }
          continue;
        }

        // Belt-and-braces on the initial window: if Graph ignored the $filter, skip anything older
        // rather than ingesting it. Cheap here, and it keeps the bound honest either way.
        if (isInitialSync && msg.receivedDateTime) {
          const received = new Date(msg.receivedDateTime);
          if (!isNaN(received.getTime()) && received < windowStart) continue;
        }

        try {
          const wasSaved = await this.saveMessage(client, msg, tenantId, campaignId, requestedBy, folder.pplcrmId);
          if (wasSaved) inserted++;
        } catch (err) {
          logger.error({ err }, `Failed to ingest MS Graph message ${msg.id}`);
        }
      }

      // Reconcile disappearances on an initial/restarted sync: anything local with an `ms:` key that
      // the server did not return has left this folder — deleted, archived or moved. We cannot tell
      // which, so it is detached (hidden from the folder, row and CRM data kept), never destroyed.
      //
      // The candidate set MUST be scoped to the window we fetched. `allMessages` only covers mail
      // since `windowStart`, so comparing against every local row would read the whole older archive
      // as deleted — and since an expired delta link forces this path, that would silently wipe a
      // long-established mailbox.
      if (isInitialSync) {
        const serverMsIds = new Set(allMessages.filter((m) => !m['@removed']).map((m) => String(m.id)));
        const localEmails = await this.db
          .selectFrom('emails')
          .innerJoin('email_headers', 'email_headers.email_id', 'emails.id')
          .select(['emails.id as id', 'emails.preview as preview'])
          .where('emails.tenant_id', '=', tenantId)
          .where('emails.campaign_id', '=', campaignId)
          .where('emails.folder_id', '=', folder.pplcrmId)
          .where('emails.preview', 'like', 'ms:%')
          .where('emails.detached_at', 'is', null)
          .where('email_headers.tenant_id', '=', tenantId)
          .where('email_headers.date_sent', '>=', windowStart)
          .execute();

        for (const localEmail of localEmails) {
          const previewKey = localEmail.preview ?? '';
          const msId = previewKey.replace(/^ms:/, '');
          if (!serverMsIds.has(msId)) {
            await this.ingester.detachMessage(tenantId, campaignId, msId);
          }
        }
      }

      // Checkpoint per folder, so a later folder failing does not discard earlier progress.
      await this.oauthSvc.saveDeltaLink(tenantId, campaignId, JSON.stringify(nextDeltaMap));
    }

    return { inserted };
  }

  public async removeAllLocalEmails(tenantId: string, campaignId: string): Promise<void> {
    await this.ingester.removeAllLocalEmails(tenantId, campaignId);
  }

  private async saveMessage(
    client: Client,
    msg: any,
    tenantId: string,
    campaignId: string,
    requestedBy: string,
    folderId: string,
  ): Promise<boolean> {
    const msId: string = msg.id ?? '';
    if (!msId) return false;

    const fromEmail = msg.from?.emailAddress?.address ?? null;
    const toEmail = msg.toRecipients?.[0]?.emailAddress?.address ?? null;
    const subject = msg.subject ?? null;
    let dateSent = msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date();
    if (isNaN(dateSent.getTime())) {
      dateSent = new Date();
    }
    const bodyHtml = msg.body?.content ?? '';

    // List Graph attachments as METADATA ONLY.
    //
    // `/attachments` without a $select returns `contentBytes` for every attachment, i.e. it
    // downloads the entire payload set just to find out what is there. Selecting the metadata
    // fields keeps the listing cheap; the ingester then decides which payloads are worth fetching,
    // and `fetchContent` pulls an individual one via /$value only when asked.
    let graphAttachments: any[] = [];
    const hasCid = bodyHtml && bodyHtml.includes('cid:');
    if (msg.hasAttachments || hasCid) {
      try {
        const attRes = await graphCallWithRetry(() =>
          client.api(`/me/messages/${msId}/attachments?$select=id,name,contentType,size,isInline,contentId`).get(),
        );
        graphAttachments = attRes.value ?? [];
      } catch (err) {
        logger.error({ err }, `Failed to list attachments for message ${msId}`);
      }
    }

    // A $select response may omit `@odata.type`, so only exclude an attachment when we positively
    // know it is not a file (an item or reference attachment has no payload to store).
    const fileAttachments = graphAttachments.filter((att: any) => {
      const odataType = att['@odata.type'];
      return !odataType || odataType === '#microsoft.graph.fileAttachment';
    });

    // Map MS Graph attachments to IngestableEmail attachments
    const attachments = fileAttachments.map((att: any) => ({
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      contentId: att.contentId ?? null,
      isInline: att.isInline ?? false,
      remoteRef: att.id ?? null,
      fetchContent: async () => fetchGraphAttachmentContent(client, msId, String(att.id)),
    }));

    // Map recipients
    const recipients: Array<{ kind: 'to' | 'cc' | 'bcc'; name: string | null; email: string }> = [];
    const toList: any[] = msg.toRecipients ?? [];
    const ccList: any[] = msg.ccRecipients ?? [];
    const bccList: any[] = msg.bccRecipients ?? [];

    toList.forEach((r) => {
      recipients.push({ kind: 'to', name: r.emailAddress?.name ?? null, email: r.emailAddress?.address ?? '' });
    });
    ccList.forEach((r) => {
      recipients.push({ kind: 'cc', name: r.emailAddress?.name ?? null, email: r.emailAddress?.address ?? '' });
    });
    bccList.forEach((r) => {
      recipients.push({ kind: 'bcc', name: r.emailAddress?.name ?? null, email: r.emailAddress?.address ?? '' });
    });

    const ingestable: IngestableEmail = {
      id: msId,
      internetMessageId: msg.internetMessageId ?? null,
      fromEmail,
      toEmail,
      subject,
      dateSent,
      bodyHtml,
      recipients,
      attachments,
    };

    return this.ingester.ingestEmail(ingestable, tenantId, campaignId, requestedBy, folderId);
  }

  private buildGraphClient(accessToken: string): Client {
    return Client.init({
      authProvider: (done) => done(null, accessToken),
    });
  }
}
