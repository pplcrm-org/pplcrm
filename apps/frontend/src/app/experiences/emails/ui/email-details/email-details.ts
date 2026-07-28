import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { SettingsService } from '@experiences/settings/services/settings-service';

import { EmailsStore } from '../../services/store/emailstore';
import { computeEmailSla } from '../../services/email-sla';
import { EmailBody } from '../email-body/email-body';
import { EmailComments } from '../email-comments/email-comments';
import { EmailHeader } from '../email-header/email-header';
import { EmailActivities } from '../email-activities/email-activities';
import { Icon } from '@icons/icon';
import type { EmailType } from '../../../../../../../../libs/common/src/lib/models';

@Component({
  selector: 'pc-email-details',
  imports: [EmailHeader, EmailBody, EmailComments, EmailActivities, Icon],
  templateUrl: 'email-details.html',
})
export class EmailDetails {
  private noEmailMsgDelay = createLoadingGate();

  protected readonly store = inject(EmailsStore);
  private readonly settingsSvc = inject(SettingsService);
  protected readonly isLoading = this.store.emailsLoading;

  protected showNoEmailMsg = this.noEmailMsgDelay.visible;

  /** Honest SLA pill (§5): computed from the received time + workspace SLA config. */
  protected readonly slaPill = computed(() => {
    const e = this.email();
    if (!e) return null;
    this.settingsSvc.snapshotSignal(); // react to settings loading in
    return computeEmailSla({
      status: e.status,
      receivedAt: e.date_sent ? new Date(e.date_sent) : null,
      emailsHours: Number(this.settingsSvc.getValue('sla.emails_hours', 24)),
      workingDays: this.settingsSvc.getValue<string>('sla.working_days', '1,2,3,4,5'),
      workingHoursStart: this.settingsSvc.getValue<string>('sla.working_hours_start', '09:00'),
      workingHoursEnd: this.settingsSvc.getValue<string>('sla.working_hours_end', '17:00'),
      timeZone: this.settingsSvc.getValue<string>('organization.timezone'),
    });
  });

  public readonly forward = output<EmailType>();
  public readonly reply = output<EmailType>();
  public readonly replyAll = output<EmailType>();

  public email = input<EmailType | null>(null);
  public commentCount = computed(() => {
    const e = this.email();
    if (!e) return 0;
    const header = this.store.getEmailHeaderById(e.id)();
    return (header as any)?.comments?.length ?? 0;
  });
  public activityCount = computed(() => {
    const e = this.email();
    if (!e) return 0;
    return this.store.getEmailActivitiesById(e.id)()?.length ?? 0;
  });

  /** Which quiet-tab-row panel is open below the body (§5). */
  public readonly openPanel = signal<'comments' | 'activity' | null>(null);

  constructor() {
    // Only fetch when header value is truly undefined (not when it's null/empty).
    effect(() => {
      const e = this.email();
      if (!e) return;

      const headerVal = untracked(() => this.store.getEmailHeaderById(e.id)());
      if (typeof headerVal === 'undefined') {
        this.store.loadEmailWithHeaders(e.id).catch((err) => console.error('Failed to load email header:', err));
      }
      // Eager-load activities so the tab row's count is honest before opening.
      this.store.loadEmailActivities(e.id).catch(() => undefined);
    });
    // Ensure workspace SLA config is available for the pill (idempotent).
    void this.settingsSvc.load();
    this.noEmailMsgDelay.begin();
  }

  public toggleCommentsTab(): void {
    this.openPanel.update((p) => (p === 'comments' ? null : 'comments'));
  }
  public toggleActivityTab(): void {
    this.openPanel.update((p) => (p === 'activity' ? null : 'activity'));
  }
  public closePanel(): void {
    this.openPanel.set(null);
  }

  protected emitForward() {
    const e = this.email();
    if (e) this.forward.emit(e);
  }

  protected emitReply() {
    const e = this.email();
    if (e) this.reply.emit(e);
  }

  protected emitReplyAll() {
    const e = this.email();
    if (e) this.replyAll.emit(e);
  }
}
