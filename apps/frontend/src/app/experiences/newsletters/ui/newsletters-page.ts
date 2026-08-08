import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { StatusBadge, type PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { Table } from '@uxcommon/components/table/table';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Icon } from '@icons/icon';

import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { AuthService } from '../../../auth/auth-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../../settings/services/settings-service';
import { NewslettersService } from '../services/newsletters-service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

interface NewsletterRow {
  bounce_count: number;
  click_rate: number;
  delivered_count: number;
  has_audience: boolean;
  has_content: boolean;
  id: string;
  name: string;
  open_rate: number;
  send_date: Date | null;
  status: string;
  total_recipients: number;
  unique_clicks: number;
  unique_opens: number;
}

interface NewsletterStats {
  avgClickRate: number;
  avgOpenRate: number;
  bounces: number;
  delivered: number;
  sentCount: number;
}

const STATUS_TONE: Record<string, PcStatusType> = {
  archived: 'ghost',
  draft: 'ghost',
  paused: 'warning',
  queuing: 'info',
  scheduled: 'info',
  sending: 'info',
  sent: 'success',
};

const STATUS_LABEL: Record<string, string> = {
  archived: 'Archived',
  draft: 'Draft',
  paused: 'Paused',
  queuing: 'Sending',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
};

/** Statuses that count as "in progress" for the header sentence. */
const IN_PROGRESS_STATUSES = new Set(['scheduled', 'queuing', 'sending', 'paused']);

/**
 * Newsletters list page: stat tiles summarising all-time engagement, then a bespoke
 * pc-table of campaigns. Drafts get a "Send…" action behind the danger confirm; everything
 * else links to its report (the newsletter detail page).
 */
@Component({
  selector: 'pc-newsletters-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, RouterLink, DatePipe, Icon, GridHeaderComponent, StatusBadge, Table],
  templateUrl: './newsletters-page.html',
})
export class NewslettersPage {
  private readonly svc = inject(NewslettersService);
  private readonly auth = inject(AuthService);
  private readonly userSignal = this.auth.getUserSignal();
  /** Sending is blocked server-side during demo mode; sendBlocker() explains it (§2 explained-disabled). */
  private readonly isDemo = computed(() => !!this.userSignal()?.tenant_demo_mode_at);
  private readonly context = inject(CampaignContextService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly settings = inject(SettingsService);

  protected readonly loading = createLoadingGate();
  protected readonly rows = signal<NewsletterRow[]>([]);
  protected readonly loaded = signal(false);

  /** The compliance footer needs the org's mailing address, so sending is gated on it being set. */
  protected readonly orgAddressSet = computed(() => {
    const value = this.settings.snapshotSignal()['organization.address'];
    return typeof value === 'string' && value.trim().length > 0;
  });

  /** The campaign context the current rows were loaded for; undefined = never loaded. */
  private loadedForCampaign: string | null | undefined = undefined;

  private readonly numberFormatter = new Intl.NumberFormat();

  protected readonly stats = computed<NewsletterStats>(() => {
    const sent = this.rows().filter((r) => r.status === 'sent');
    let delivered = 0;
    let opens = 0;
    let clicks = 0;
    let bounces = 0;
    for (const r of sent) {
      delivered += r.delivered_count;
      opens += r.unique_opens;
      clicks += r.unique_clicks;
      bounces += r.bounce_count;
    }
    return {
      sentCount: sent.length,
      delivered,
      avgOpenRate: delivered > 0 ? (opens / delivered) * 100 : 0,
      avgClickRate: delivered > 0 ? (clicks / delivered) * 100 : 0,
      bounces,
    };
  });

  protected readonly headerSentence = computed<string | null>(() => {
    if (!this.loaded()) return null;
    const sent = this.stats().sentCount;
    const inProgress = this.rows().filter((r) => IN_PROGRESS_STATUSES.has(r.status)).length;
    const parts = [`${this.numberFormatter.format(sent)} campaign${sent === 1 ? '' : 's'} sent`];
    if (inProgress > 0) parts.push(`${this.numberFormatter.format(inProgress)} in progress`);
    return parts.join(' · ');
  });

  constructor() {
    // Reload whenever the campaign context switches (§15) — and once on first render.
    effect(() => {
      const campaignId = this.context.activeCampaignId();
      if (campaignId === this.loadedForCampaign) return;
      this.loadedForCampaign = campaignId;
      void untracked(() => this.reload());
    });
  }

  protected statusLabel(status: string): string {
    return STATUS_LABEL[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : '—');
  }

  protected statusTone(status: string): PcStatusType {
    return STATUS_TONE[status] ?? 'ghost';
  }

  protected formatNumber(value: number): string {
    return this.numberFormatter.format(value);
  }

  protected formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  /**
   * The first unmet send condition for a draft, or null when it can go out (§2 explained-disabled:
   * the Send button never greys out silently — the tooltip names exactly what's missing).
   *
   * Sending-identity (a verified domain, or the workspace's own pplCRM address) is deliberately
   * NOT checked here: a workspace can be sendable via a verified domain with no click-verified
   * individual address, or via the pplCRM default, and cheaply re-deriving that whole rule here
   * would duplicate apps/backend/src/app/lib/mail/from-address-policy.ts and drift from it (as the
   * old `verifiedSenders`-only check did). The backend's assertTenantMaySendNewsletter pre-send
   * gate is the single source of truth for that and returns an actionable error message that
   * sendDraft() surfaces as a toast.
   */
  protected sendBlocker(row: NewsletterRow): string | null {
    if (this.isDemo()) {
      return 'Sending is locked during the demo. Choose a plan, then exit demo mode';
    }
    if (!this.orgAddressSet()) {
      return 'Set your organization’s mailing address under Settings → Organization — it appears in the footer of every newsletter';
    }
    if (!row.has_audience) return 'This draft has no audience yet. Pick lists or tags in the newsletter wizard';
    if (!row.has_content) return 'This draft has no subject or content yet. Finish it in the newsletter wizard';
    return null;
  }

  protected async sendDraft(row: NewsletterRow): Promise<void> {
    if (this.sendBlocker(row) !== null) return;
    const name = row.name || 'this newsletter';
    const confirmed = await this.dialogs.confirm({
      title: `Send "${name}"?`,
      message: 'It goes out to everyone in its selected lists and tags right away. Sending cannot be undone.',
      variant: 'danger',
      confirmText: 'Send newsletter',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    const end = this.loading.begin();
    try {
      await this.svc.send(row.id);
      this.alerts.showSuccess(`"${name}" is on its way`);
      await this.reload();
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not send the newsletter'));
    } finally {
      end();
    }
  }

  protected async cancelSchedule(row: NewsletterRow): Promise<void> {
    const name = row.name || 'this newsletter';
    const confirmed = await this.dialogs.confirm({
      title: `Cancel the schedule for "${name}"?`,
      message: 'It will not be sent at the scheduled time. It moves back to drafts; you can reschedule it anytime.',
      confirmText: 'Cancel schedule',
      cancelText: 'Keep schedule',
    });
    if (!confirmed) return;

    const end = this.loading.begin();
    try {
      await this.svc.cancelSchedule(row.id);
      this.alerts.showSuccess(`"${name}" is back in drafts`);
      await this.reload();
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not cancel the schedule'));
    } finally {
      end();
    }
  }

  private async reload(): Promise<void> {
    const end = this.loading.begin();
    try {
      await this.context.ensureLoaded();
      const { rows } = await this.svc.getAll();
      this.rows.set((rows as Record<string, unknown>[]).map((r) => this.toRow(r)));
      this.loaded.set(true);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load newsletters'));
    } finally {
      end();
    }
    await this.loadSettingsSnapshot();
  }

  /** Populates `settings.snapshotSignal`, which `orgAddressSet()` reads. */
  private async loadSettingsSnapshot(): Promise<void> {
    try {
      await this.settings.load();
    } catch {
      // Non-fatal: with no snapshot the Send buttons stay disabled with the mailing-address tooltip.
    }
  }

  private toRow(record: Record<string, unknown>): NewsletterRow {
    const asNumber = (value: unknown): number => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };
    const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    return {
      has_audience: hasIncludedTargets(record['target_lists']) || hasIncludedTargets(record['segments']),
      has_content:
        asText(record['subject']).length > 0 &&
        (asText(record['html_content']).length > 0 || asText(record['plain_text_content']).length > 0),
      id: String(record['id']),
      name: typeof record['name'] === 'string' ? record['name'] : '',
      status: typeof record['status'] === 'string' ? record['status'] : 'draft',
      total_recipients: asNumber(record['total_recipients']),
      delivered_count: asNumber(record['delivered_count']),
      bounce_count: asNumber(record['bounce_count']),
      open_rate: asNumber(record['open_rate']),
      click_rate: asNumber(record['click_rate']),
      unique_opens: asNumber(record['unique_opens']),
      unique_clicks: asNumber(record['unique_clicks']),
      send_date: record['send_date'] instanceof Date ? record['send_date'] : null,
    };
  }
}

/**
 * True when a stored audience document names at least one INCLUDED list or tag.
 *
 * The composer always writes `{"include":[],"exclude":[]}`, so the old test — "the column holds a
 * non-empty string" — was true for every newsletter and the "no audience yet" hint never appeared.
 * Tolerates every shape drafts have stored: the include/exclude object, a bare array of ids, a
 * JSON string of either, or null.
 */
function hasIncludedTargets(value: unknown): boolean {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    if (!parsed.trim()) return false;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return false;
    }
  }
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (parsed && typeof parsed === 'object') {
    // Safe: the object branch of a parsed JSON document, read by key only.
    const include = (parsed as Record<string, unknown>)['include'];
    return Array.isArray(include) && include.length > 0;
  }
  return false;
}
