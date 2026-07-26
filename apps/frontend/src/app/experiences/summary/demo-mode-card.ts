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
 * backend refuses to exit until the tenant has an active subscription, and it
 * blocks outward-facing configuration (senders, domains, mailbox sync,
 * newsletter sending, teammate invites) while the flag is set. Exiting deletes only the rows the
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
            Sending email, inviting teammates, sender setup (verifying sender emails and domains, connecting a mailbox),
            and donation setup (connecting Stripe) stay locked during the demo; everything else, including workspace
            settings, works normally. When you’re ready, choose a plan, then exit demo mode. Your starter forms, the
            built-in tags and issues, your All Subscribers and All Volunteers lists, and anything you created yourself
            will be kept.
          </p>

          <div class="card-actions items-center gap-3">
            <!-- One door, not two. Exiting demo mode needs a plan first, an organization address
                 before anything can send, and a sending identity after that — so the honest
                 primary action is the flow that walks through all of it in order, not a bare
                 destructive button that refuses until the prerequisites happen to be met. -->
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
      this.alerts.showSuccess('Demo data removed. Your workspace is ready for real contacts.');
      this.exited.emit();
    } catch (err) {
      // The backend's refusal ("choose a plan first") is user-facing copy — show it.
      this.alerts.showError(getUserErrorMessage(err, 'Could not remove the demo data. Please try again.'));
    } finally {
      end();
    }
  }
}
