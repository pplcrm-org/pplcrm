import { Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthService } from '../../auth/auth-service';
import { getUserErrorMessage } from '../../services/api/user-message';
import { ConfirmDialogService } from '../../services/shared-dialog.service';
import { DemoService } from './services/demo.service';

/**
 * Demo-mode callout on the dashboard: explains what was seeded and hosts the
 * one place to exit demo mode. Demo mode is the pre-plan test drive — the
 * workspace gates as the top plan tier while the flag is set (effectivePlanKey,
 * 2026-08-10) so every feature can be tried, while the backend blocks everything
 * outward-facing (senders, domains, mailbox sync, newsletter sending,
 * audience-facing transactional mail, drip processing, teammate invites) and every
 * billing mutation. Exiting itself has no prerequisite — it is what produces the
 * clean workspace a plan is then chosen for. Exiting deletes only the rows the
 * seeder tracked in its manifest; the starter forms, the built-in tags and issues, the two
 * undeletable system lists (All Subscribers / All Volunteers), and anything the user created are
 * kept. It then refreshes the session so the shell banner disappears immediately.
 */
@Component({
  selector: 'pc-demo-mode-card',
  imports: [Icon, RouterLink],
  template: `
    @if (visible()) {
      <div class="animate-drop card border border-info/40 bg-info/5 shadow-lg mb-5">
        <div class="card-body gap-3 p-5">
          <div class="pc-eyebrow flex items-center gap-2 text-info">
            <pc-icon name="information-circle" [size]="4"></pc-icon>
            Demo mode
          </div>

          <p class="text-sm text-base-content/80">
            You’re exploring pplCRM with realistic sample data: people and households across Ottawa, companies, tags,
            issues, tasks, lists, volunteer events, an inbox, three demo teammates, and a sent newsletter with a full
            report. Everything here is safe to open, edit, and delete.
          </p>
          <p class="text-sm text-base-content/60">
            While the demo data is in place, every feature is open regardless of plan — try forms, donations,
            automations, canvassing, deliveries, and the rest before deciding what to pay for. What stays locked is
            anything outbound: sending email, inviting teammates, mailbox and Stripe connections. Billing is closed too,
            because there is nothing to buy while everything is already unlocked. When you’re ready, remove the demo
            data — that leaves a clean workspace — and then choose your plan. Your starter forms, the built-in tags and
            issues, your All Subscribers and All Volunteers lists, and anything you created yourself will be kept.
          </p>

          <div class="card-actions items-center gap-3">
            <!-- Two doors, and the difference is real. The wizard walks the whole sequence in the
                 order it has to happen — remove the demo data, choose a plan, organization
                 address, sending identity — while the second button does only the first of those
                 for someone who knows what they want. It no longer refuses: removing the demo
                 data has no prerequisites. -->
            <a routerLink="/go-live" class="btn btn-primary btn-sm">Set up my workspace</a>
            <button type="button" class="btn btn-error btn-outline btn-sm" [disabled]="loading()" (click)="exitDemo()">
              @if (loading()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Just remove the demo data
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class DemoModeCard {
  private readonly auth = inject(AuthService);
  private readonly demoSvc = inject(DemoService);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly _loading = createLoadingGate();

  private readonly user = this.auth.getUserSignal();

  protected readonly visible = computed(() => !!this.user()?.tenant_demo_mode_at);
  protected readonly loading = this._loading.visible;

  /** Fires after the demo data is gone so the dashboard can reload its stats. */
  public readonly exited = output<void>();

  protected async exitDemo(): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Remove all demo data?',
      message:
        'Permanently deleted: the sample people, households, companies, tasks, teams, volunteer events, ' +
        'newsletters and their reports, inbox emails, canvassing turfs and knocks, delivery routes, recorded ' +
        'donations, the three sample lists, and the three demo teammates.\n\n' +
        'Kept: your All Subscribers and All Volunteers lists, your starter forms, the built-in tags and issues, ' +
        'your workspace settings, and everything you created yourself. Anyone you marked as a volunteer stays a ' +
        'volunteer.',
      variant: 'danger',
      confirmText: 'Remove demo data',
    });
    if (!confirmed) return;

    const end = this._loading.begin();
    try {
      await this.demoSvc.exitDemo();
      await this.auth.getCurrentUser();
      this.alerts.showSuccess('Demo data removed. Your workspace is ready for real contacts — Billing is open now.');
      this.exited.emit();
    } catch (err) {
      // The backend's refusal is user-facing copy — show it.
      this.alerts.showError(getUserErrorMessage(err, 'Could not remove the demo data. Please try again.'));
    } finally {
      end();
    }
  }
}
