import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Stepper, type StepperStep } from '@uxcommon/components/stepper/stepper';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthService } from '../../auth/auth-service';
import { getUserErrorMessage } from '../../services/api/user-message';
import { ConfirmDialogService } from '../../services/shared-dialog.service';
import { DemoService } from '../summary/services/demo.service';
import { PhoneVerification } from '../settings/phone/phone-verification';
import { SettingsService } from '../settings/services/settings-service';
import { GoLiveService, type GoLiveStepId } from './go-live.service';

interface DemoSummaryItem {
  label: string;
  count: number;
}

const STEP_ORDER: GoLiveStepId[] = ['plan', 'organization', 'phone', 'sending', 'demo', 'people', 'team'];

const STEP_LABELS: Record<GoLiveStepId, string> = {
  plan: 'Choose a plan',
  organization: 'Your organization',
  phone: 'Verify your mobile',
  sending: 'Sending email',
  demo: 'Remove demo data',
  people: 'Your people',
  team: 'Your team',
};

/**
 * The go-live wizard: the path from a demo workspace to a real one.
 *
 * Deliberately a ROUTE, not a modal. It is resumable, deep-linkable, back-button honest, and the
 * sidebar stays visible so the user never loses the "where am I" answer. A seven-step flow held
 * in a dialog is a dialog pretending to be a page.
 *
 * Equally deliberately, it is dismissible. A tenant that stops at step two still has a working
 * CRM (just no sending), and forcing the flow would mean trapping an admin who signed in to do
 * one urgent thing. Whatever is left lands on the dashboard checklist instead of being lost.
 */
@Component({
  selector: 'pc-go-live-page',
  imports: [Icon, RouterLink, Stepper, PhoneVerification],
  templateUrl: './go-live-page.html',
})
export class GoLivePage implements OnInit {
  private readonly goLive = inject(GoLiveService);
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  private readonly demo = inject(DemoService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly router = inject(Router);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly hasLoaded = signal(false);
  protected readonly busy = signal(false);

  protected readonly state = this.goLive.state;
  protected readonly done = this.goLive.isDone;
  protected readonly contactCount = this.goLive.contactCount;
  protected readonly usingPlatformAddress = this.goLive.usingPlatformAddress;

  protected readonly currentId = computed(() => this.state().step);
  protected readonly demoSummary = signal<DemoSummaryItem[]>([]);

  /** Organization fields are edited locally and saved on continue, so a half-typed address is
   * never persisted as if it were a decision. */
  protected readonly orgName = signal('');
  protected readonly orgEmail = signal('');
  protected readonly orgAddress = signal('');

  protected readonly platformAddress = computed(
    () => (this.settings.snapshotSignal()['communications.platform_from_email'] as string) ?? '',
  );
  protected readonly fromAddress = computed(
    () => (this.settings.snapshotSignal()['communications.default_from_email'] as string) ?? '',
  );
  protected readonly replyTo = computed(
    () => (this.settings.snapshotSignal()['communications.reply_to'] as string) ?? '',
  );

  protected readonly steps = computed<StepperStep[]>(() => {
    const done = this.done();
    const locked = this.goLive.lockedReason();
    const deferred = this.state().deferred;
    const sendsEmail = this.state().sendsEmail;

    return STEP_ORDER.map((id) => ({
      id,
      label: STEP_LABELS[id],
      note: this.noteFor(id),
      locked: !!locked[id],
      lockedReason: locked[id],
      state: deferred.includes(id)
        ? ('deferred' as const)
        : id === 'sending' && sendsEmail === false
          ? ('skipped' as const)
          : done[id]
            ? ('done' as const)
            : undefined,
    }));
  });

  /** Everything still outstanding when the user lands on the final step. */
  protected readonly outstandingLabels = computed(() =>
    this.goLive.outstanding().map((id) => ({ id, label: STEP_LABELS[id] })),
  );

  protected readonly allEssentialsDone = computed(() => this.goLive.outstanding().length === 0);

  public ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    const end = this._loading.begin();
    try {
      await this.goLive.load();
      this.orgName.set(this.settings.getValue<string>('organization.name', '') ?? '');
      this.orgEmail.set(this.settings.getValue<string>('organization.contact_email', '') ?? '');
      this.orgAddress.set(this.settings.getValue<string>('organization.address', '') ?? '');
      if (this.state().step === 'demo' && !this.demoSummary().length) await this.loadDemoSummary();
      this.hasLoaded.set(true);
    } finally {
      end();
    }
  }

  protected async selectStep(id: string): Promise<void> {
    await this.goLive.goTo(id as GoLiveStepId);
    if (id === 'demo') await this.loadDemoSummary();
  }

  protected async next(): Promise<void> {
    const index = STEP_ORDER.indexOf(this.currentId());
    const nextId = STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)];
    if (nextId) await this.selectStep(nextId);
  }

  protected async back(): Promise<void> {
    const index = STEP_ORDER.indexOf(this.currentId());
    const prevId = STEP_ORDER[Math.max(index - 1, 0)];
    if (prevId) await this.selectStep(prevId);
  }

  /** Put a step off without losing it: it stays on the dashboard checklist until it is done. */
  protected async deferStep(id: GoLiveStepId): Promise<void> {
    await this.goLive.defer(id);
    this.alerts.showInfo(`Saved for later. "${STEP_LABELS[id]}" is waiting on your dashboard.`);
    await this.next();
  }

  // --- Plan -----------------------------------------------------------------

  protected async continueOnFree(): Promise<void> {
    this.busy.set(true);
    try {
      await this.goLive.selectFreePlan();
      this.alerts.showSuccess('You’re on the Free plan. You can upgrade whenever you need to.');
      await this.next();
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not switch to the Free plan. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  // --- Organization ---------------------------------------------------------

  protected async saveOrganization(): Promise<void> {
    this.busy.set(true);
    try {
      await this.settings.upsert([
        { key: 'organization.name', value: this.orgName().trim() },
        { key: 'organization.contact_email', value: this.orgEmail().trim() },
        { key: 'organization.address', value: this.orgAddress().trim() },
      ]);
      await this.next();
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not save your organization details.'));
    } finally {
      this.busy.set(false);
    }
  }

  // --- Sending --------------------------------------------------------------

  protected async answerSendsEmail(sendsEmail: boolean): Promise<void> {
    await this.goLive.setSendsEmail(sendsEmail);
    if (!sendsEmail) await this.next();
  }

  protected async usePlatformAddress(): Promise<void> {
    const address = this.platformAddress();
    if (!address) return;
    this.busy.set(true);
    try {
      await this.settings.upsert([{ key: 'communications.default_from_email', value: address }]);
      this.alerts.showSuccess(`You’ll send from ${address}.`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not set your sending address.'));
    } finally {
      this.busy.set(false);
    }
  }

  // --- Demo data ------------------------------------------------------------

  private async loadDemoSummary(): Promise<void> {
    if (this.done()['demo']) return;
    try {
      const summary = await this.demo.getSummary();
      this.demoSummary.set(summary.items);
    } catch {
      // The confirm still works without counts; it just falls back to naming categories.
      this.demoSummary.set([]);
    }
  }

  protected async removeDemoData(): Promise<void> {
    const items = this.demoSummary();
    const detail = items.length
      ? items.map((i) => `${i.count.toLocaleString()} ${i.label}`).join(' · ')
      : 'Everything the demo created';

    const confirmed = await this.dialogs.confirm({
      title: 'Remove all demo data?',
      message:
        `Permanently deleted: ${detail}.\n\n` +
        'Kept: your All Subscribers and All Volunteers lists, your starter forms, the built-in tags and ' +
        'issues, your workspace settings, and everything you created yourself. Anyone you marked as a ' +
        'volunteer stays a volunteer.',
      variant: 'danger',
      confirmText: 'Remove demo data',
    });
    if (!confirmed) return;

    this.busy.set(true);
    try {
      await this.demo.exitDemo();
      await this.auth.getCurrentUser();
      await this.goLive.refreshContacts();
      this.alerts.showSuccess('Demo data removed. Your workspace is ready for real contacts.');
      await this.next();
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not remove the demo data. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  // --- Finish ---------------------------------------------------------------

  protected async finish(): Promise<void> {
    await this.goLive.markComplete();
    await this.router.navigate(['/dashboard']);
  }

  protected async close(): Promise<void> {
    await this.router.navigate(['/dashboard']);
  }

  /** Evidence under a rail item — numbers before clicks, and proof the step really landed. */
  private noteFor(id: GoLiveStepId): string | undefined {
    switch (id) {
      case 'people': {
        const count = this.contactCount();
        return count ? `${count.toLocaleString()} in your workspace` : undefined;
      }
      case 'sending':
        return this.state().sendsEmail === false ? 'Not yet' : this.fromAddress() || undefined;
      case 'organization':
        return this.done()['organization'] ? undefined : 'Address required to send';
      default:
        return undefined;
    }
  }
}
