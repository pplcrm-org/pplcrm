import { Service, inject } from '@angular/core';
import {
  AddMarketingEmailType,
  AddNewsletterTemplateType,
  CreateClickersListResultType,
  ExportCsvInputType,
  ExportCsvResponseType,
  MarketingEmailTopLinkType,
  NewsletterReportType,
  PreflightResult,
  RunPreflightType,
  UpdateMarketingEmailType,
  getAllOptionsType,
} from '../../../../../../../libs/common/src';

import { AbstractAPIService } from '../../../services/api/abstract-api.service';
import { CampaignContextService } from '../../../services/campaign-context.service';

/** Wizard-facing shape of a user-saved newsletter template. */
export interface SavedNewsletterTemplate {
  id: string;
  name: string;
  html_content: string;
  plain_text_content: string;
  updated_at: Date | null;
}

@Service()
export class NewslettersService extends AbstractAPIService<'newsletters', UpdateMarketingEmailType> {
  protected override readonly endpointName = 'newsletters';

  private readonly campaignContext = inject(CampaignContextService);

  public add(row: AddMarketingEmailType) {
    // A newsletter is created in the context the user is working in (§15);
    // the backend falls back to the office context when none is known.
    const campaignId = this.campaignContext.activeCampaignId();
    return this.api.newsletters.create.mutate(campaignId ? { ...row, campaign_id: campaignId } : row);
  }

  public addMany(_rows: AddMarketingEmailType[]) {
    return Promise.resolve([]);
  }

  public attachTag(_id: string, _tag_name: string) {
    return Promise.resolve();
  }

  public count(): Promise<number> {
    return this.api.newsletters.count.query();
  }

  public detachTag(_id: string, _tag_name: string) {
    return Promise.resolve(false);
  }

  public async getAll(options?: getAllOptionsType) {
    // Campaigns §15 — the newsletters grid shows the active context's sends.
    const campaignId = this.campaignContext.activeCampaignId();
    const scoped = campaignId ? { ...(options ?? {}), campaignId } : options;
    const result = await this.api.newsletters.getAllWithCounts.query(scoped, { signal: this.ac.signal });
    const rows = (result?.rows ?? []).map((row: any) => this.normalize(row));
    const count = result?.count != null ? Number(result.count) : rows.length;
    return { rows, count };
  }

  public getAllArchived(_options?: getAllOptionsType) {
    return Promise.resolve({ rows: [], count: 0 });
  }

  public async getById(id: string) {
    const record = await this.api.newsletters.getById.query(id);
    return this.normalize(record);
  }

  public getReport(id: string): Promise<NewsletterReportType> {
    return this.api.newsletters.getReport.query(id);
  }

  public createClickersList(id: string): Promise<CreateClickersListResultType> {
    return this.api.newsletters.createClickersList.mutate(id);
  }

  public async getTags(_id: string) {
    return [];
  }

  public update(id: string, data: UpdateMarketingEmailType) {
    return this.api.newsletters.update.mutate({ id, data });
  }

  public send(id: string): Promise<any> {
    return this.api.newsletters.send.mutate(id);
  }

  /** Take a scheduled newsletter off the calendar; it moves back to drafts. */
  public cancelSchedule(id: string): Promise<void> {
    return this.api.newsletters.cancelSchedule.mutate(id);
  }

  /** One-shot follow-up to everyone who didn't open or click the sent original (new subject
   * required; the backend enforces one resend per newsletter). */
  public resendToNonOpeners(id: string, subject: string): Promise<{ id: string }> {
    return this.api.newsletters.resendToNonOpeners.mutate({ id, subject });
  }

  /** Monthly newsletter-email allowance at the billed bracket (`cap: null` = unlimited). */
  public getSendQuota(): Promise<{
    cap: number | null;
    used: number;
    remaining: number | null;
    resetsAt: string | null;
    subscriberCapBlock: { emailableCount: number; cap: number; message: string } | null;
  }> {
    return this.api.newsletters.sendQuota.query();
  }

  public sendTest(input: {
    subject: string;
    html: string;
    text?: string;
    to: string;
    fromName?: string;
    fromEmail?: string;
  }): Promise<{ to: string; delivered: number }> {
    return this.api.newsletters.sendTest.mutate(input);
  }

  public exportCsv(input: ExportCsvInputType): Promise<ExportCsvResponseType> {
    return this.api.newsletters.exportCsv.mutate(input);
  }

  /** Full deliverability check (lint + SpamAssassin + AI content review), cached server-side. */
  public runPreflight(input: RunPreflightType): Promise<PreflightResult> {
    return this.api.newsletters.runPreflight.mutate(input);
  }

  // --- User-saved templates (tenant-wide library; no campaign scoping) -------

  /** Every saved template for the workspace, alphabetized by name. */
  public async getTemplates(): Promise<SavedNewsletterTemplate[]> {
    const rows = await this.api.newsletters.templates.getAll.query(undefined, { signal: this.ac.signal });
    return (rows ?? []).map((row: unknown) => this.normalizeTemplate(row));
  }

  /** Saves the wizard's current html/plain content verbatim as a reusable template. */
  public async saveTemplate(input: AddNewsletterTemplateType): Promise<SavedNewsletterTemplate> {
    const created: unknown = await this.api.newsletters.templates.add.mutate(input);
    return this.normalizeTemplate(created);
  }

  public deleteTemplate(id: string): Promise<boolean> {
    return this.api.newsletters.templates.delete.mutate(id);
  }

  public renameTemplate(id: string, name: string): Promise<unknown> {
    return this.api.newsletters.templates.rename.mutate({ id, data: { name } });
  }

  private normalizeTemplate(raw: unknown): SavedNewsletterTemplate {
    // The wire row is an object; anything else normalizes to an empty template.
    const row: Record<string, unknown> = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const updatedRaw = row['updated_at'];
    let updated_at: Date | null = null;
    if (updatedRaw instanceof Date) {
      updated_at = updatedRaw;
    } else if (typeof updatedRaw === 'string' || typeof updatedRaw === 'number') {
      const parsed = new Date(updatedRaw);
      updated_at = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return {
      id: row['id'] != null ? String(row['id']) : '',
      name: typeof row['name'] === 'string' ? row['name'] : '',
      html_content: typeof row['html_content'] === 'string' ? row['html_content'] : '',
      plain_text_content: typeof row['plain_text_content'] === 'string' ? row['plain_text_content'] : '',
      updated_at,
    };
  }

  private normalize(record: any) {
    if (!record) return record;
    const top_links = this.parseJsonArray<MarketingEmailTopLinkType>(record.top_links);
    const asNumber = (value: unknown) => {
      if (value === null || value === undefined || value === '') return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };
    const asDate = (value: unknown) => {
      if (!value) return null;
      if (value instanceof Date) return value;
      const date = new Date(value as string);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    return {
      ...record,
      status: typeof record.status === 'string' ? record.status.toLowerCase() : record.status,
      tenant_id: record.tenant_id != null ? String(record.tenant_id) : record.tenant_id,
      resend_of_id: record.resend_of_id != null ? String(record.resend_of_id) : null,
      createdby_id: record.createdby_id != null ? String(record.createdby_id) : record.createdby_id,
      updatedby_id: record.updatedby_id != null ? String(record.updatedby_id) : record.updatedby_id,
      total_recipients: asNumber(record.total_recipients) ?? 0,
      delivered_count: asNumber(record.delivered_count) ?? 0,
      bounce_count: asNumber(record.bounce_count) ?? 0,
      open_rate: asNumber(record.open_rate) ?? 0,
      click_rate: asNumber(record.click_rate) ?? 0,
      unique_opens: asNumber(record.unique_opens) ?? 0,
      unique_clicks: asNumber(record.unique_clicks) ?? 0,
      unsubscribe_count: asNumber(record.unsubscribe_count) ?? 0,
      spam_complaint_count: asNumber(record.spam_complaint_count) ?? 0,
      reply_count: asNumber(record.reply_count) ?? 0,
      send_date: asDate(record.send_date),
      last_engagement_at: asDate(record.last_engagement_at),
      created_at: asDate(record.created_at) ?? new Date(),
      updated_at: asDate(record.updated_at) ?? new Date(),
      top_links,
    };
  }

  private parseJsonArray<T>(value: unknown): T[] | null {
    if (!value) return null;
    if (Array.isArray(value)) return value as T[];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }
}
