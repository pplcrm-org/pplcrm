import { Service, inject } from '@angular/core';
import { EmailStatus, JSend, jsend } from '../../../../../../../libs/common/src';

import { HasRow } from '../../../../../../../libs/common/src/lib/emails';
import { EmailDraftType, EmailType } from '../../../../../../../libs/common/src/lib/models';
import { environment } from '../../../../environments/environment';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { TRPCService } from '../../../services/api/trpc-service';
import { ComposePayload, DraftPayload } from '../ui/email-compose/email-compose';

/** The HTTP status a tRPC client error carries in `data.httpStatus`, or null. Codes are the
 *  reliable channel — production replaces most backend error MESSAGES with a generic string. */
function errorHttpStatus(e: unknown): number | null {
  if (typeof e !== 'object' || e === null) return null;
  const data = (e as Record<string, unknown>)['data'];
  if (typeof data !== 'object' || data === null) return null;
  const status = (data as Record<string, unknown>)['httpStatus'];
  return typeof status === 'number' ? status : null;
}

@Service()
export class EmailsService extends TRPCService<'emails' | 'email_list'> {
  private readonly campaignContext = inject(CampaignContextService);

  /**
   * Campaigns §15 — the Inbox is per-campaign: connections, synced mail and
   * drafts all belong to the active context. Every backend inbox endpoint
   * requires it, so resolve it (ensuring context is loaded) before each call.
   */
  private async campaignId(): Promise<string> {
    await this.campaignContext.ensureLoaded();
    const id = this.campaignContext.activeCampaignId();
    if (!id) throw new Error('No active campaign selected');
    return id;
  }
  /** Open Inbox conversations assigned to the current user — feeds the sidebar Inbox badge. */
  public async countAssignedOpen(): Promise<number> {
    const campaignId = await this.campaignId();
    return this.api.emails.countAssignedOpen.query({ campaignId });
  }

  public addComment(id: string, author_id: string, comment: string) {
    return this.api.emails.addComment.mutate({ id, author_id, comment });
  }

  public assign(id: string, user_id: string | null, assigned_to_name?: string | null) {
    return this.api.emails.assign.mutate({ id, user_id, assigned_to_name: assigned_to_name ?? undefined });
  }

  public delete(id: string) {
    return this.api.emails.delete.mutate(id);
  }

  public deleteComment(email_id: string, comment_id: string) {
    return this.api.emails.deleteComment.mutate({ email_id, comment_id });
  }

  public deleteDraft(id: string) {
    return this.api.emails.deleteDraft.mutate({ id });
  }

  public deleteMany(ids: string[]) {
    return this.api.emails.deleteMany.mutate(ids);
  }

  public getAllAttachments(id: string, options?: { includeInline: boolean }) {
    return this.api.emails.getAllAttachments.query({ email_id: id, options });
  }

  public getAttachmentsByEmailId(id: string) {
    return this.api.emails.getAttachmentsByEmailId.query(id);
  }

  public getDraft(id: string) {
    return this.api.emails.getDraft.query(id) as Promise<EmailDraftType>;
  }

  public getEmailBody(id: string) {
    return this.api.emails.getEmailBody.query(id);
  }

  public getEmailHeader(id: string) {
    return this.api.emails.getEmailHeader.query(id);
  }

  public getEmailWithHeaders(id: string) {
    return this.api.emails.getEmailWithHeaders.query(id);
  }

  public getActivities(emailId: string) {
    return this.api.emails.getActivities.query(emailId);
  }

  public async getEmails(folderId: string, limit?: number, offset?: number) {
    const campaignId = await this.campaignId();
    return this.api.emails.getEmails.query({ campaignId, folderId, limit, offset });
  }

  public getFolders() {
    return this.api.emails.getFolders.query();
  }

  public async getFoldersWithCounts() {
    const campaignId = await this.campaignId();
    return this.api.emails.getFoldersWithCounts.query({ campaignId });
  }

  public hasAttachment(id: string) {
    return this.api.emails.hasAttachment.query(id);
  }

  public async hasAttachmentByEmailIds(ids: string[]): Promise<Partial<Record<string, boolean>>> {
    const rows: HasRow[] = await this.api.emails.hasAttachmentByEmailIds.query(ids);
    const map: Record<string, boolean> = {};
    for (const r of rows) map[String(r.email_id)] = !!r.has;
    return map;
  }

  public restoreFromTrash(ids: string[]): Promise<number> {
    return this.api.emails.restoreFromTrash.mutate(ids);
  }

  public moveToFolder(id: string, folderId: string) {
    return this.api.emails.moveToFolder.mutate({ id, folderId });
  }

  public async saveDraft(input: DraftPayload) {
    const campaignId = await this.campaignId();
    return this.api.emails.saveDraft.mutate({ ...input, campaignId });
  }

  // Fetch/FormData fallback
  public async sendEmail(input: ComposePayload): Promise<EmailType> {
    const campaignId = await this.campaignId();
    const fd = new FormData();
    fd.set('campaignId', campaignId);
    fd.set('to', JSON.stringify(input.to));
    fd.set('cc', JSON.stringify(input.cc));
    fd.set('bcc', JSON.stringify(input.bcc));
    fd.set('subject', input.subject);
    fd.set('html', input.html);
    input.attachments.forEach((f) => fd.append('attachments', f, f.name));

    const token = this.tokenService.getAuthToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    const res = await fetch(`${environment.apiUrl}/api/emails/send`, { method: 'POST', body: fd, headers });
    const json = (await res.json()) as JSend<EmailType>;
    return jsend.unwrap(json);
  }

  public setFavourite(id: string, favourite: boolean) {
    return this.api.emails.setFavourite.mutate({ id, favourite });
  }

  public setStatus(id: string, status: EmailStatus) {
    return this.api.emails.setStatus.mutate({ id, status });
  }

  public setEmailReadStatus(id: string, isRead: boolean) {
    return this.api.emails.setEmailReadStatus.mutate({ id, isRead });
  }

  /**
   * Run a manual sync for every connected provider. Per-provider failures are RETURNED, not
   * swallowed: this method used to catch them into console.error and return a success-shaped
   * value, so a user whose only mailbox failed to sync was shown "Inbox synced. No new emails".
   * `needsReconnect` is true when a failure was the backend's 412 (nothing connected / token
   * refresh failed) — the caller offers the Settings page instead of a retry.
   */
  public async syncEmails(): Promise<{ inserted: number; failedProviders: string[]; needsReconnect: boolean }> {
    const campaignId = await this.campaignId();
    let inserted = 0;
    let msConnected = false;
    let googleConnected = false;
    const failedProviders: string[] = [];
    let needsReconnect = false;

    // Check MS connection status
    try {
      const msStatus = await this.api.msSync.getConnectionStatus.query({ campaignId });
      if (msStatus?.connected) {
        msConnected = true;
        const msResult = await (
          this.api.msSync.syncNow.mutate as unknown as (input: any, opts?: any) => Promise<{ inserted: number }>
        )({ campaignId }, { context: { skipErrorHandler: true } });
        inserted += msResult.inserted;
      }
    } catch (e) {
      console.error('MS sync failed:', e);
      // A failed status probe leaves msConnected false — same as "not connected" before.
      if (msConnected) {
        failedProviders.push('Microsoft');
        if (errorHttpStatus(e) === 412) needsReconnect = true;
      }
    }

    // Check Google connection status
    try {
      const googleStatus = await this.api.googleSync.getConnectionStatus.query({ campaignId });
      if (googleStatus?.connected) {
        googleConnected = true;
        const googleResult = await (
          this.api.googleSync.syncNow.mutate as unknown as (input: any, opts?: any) => Promise<{ inserted: number }>
        )({ campaignId }, { context: { skipErrorHandler: true } });
        inserted += googleResult.inserted;
      }
    } catch (e) {
      console.error('Google sync failed:', e);
      if (googleConnected) {
        failedProviders.push('Google');
        if (errorHttpStatus(e) === 412) needsReconnect = true;
      }
    }

    if (!msConnected && !googleConnected) {
      throw new Error('No email accounts connected');
    }

    return { inserted, failedProviders, needsReconnect };
  }

  public async getConnectionStatus() {
    const campaignId = await this.campaignId();
    return this.api.msSync.getConnectionStatus.query({ campaignId });
  }

  public async isAnySyncing(): Promise<boolean> {
    const campaignId = await this.campaignId();
    let isSyncing = false;
    try {
      const msStatus = await this.api.msSync.getConnectionStatus.query({ campaignId });
      if (msStatus?.syncing) isSyncing = true;
    } catch (_e) {
      // ignore
    }
    try {
      const googleStatus = await this.api.googleSync.getConnectionStatus.query({ campaignId });
      if (googleStatus?.syncing) isSyncing = true;
    } catch (_e) {
      // ignore
    }
    return isSyncing;
  }
}
