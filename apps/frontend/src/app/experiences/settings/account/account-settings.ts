import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { Icon } from '@icons/icon';
import { TRPCService } from '../../../services/api/trpc-service';
import { AuthService } from '../../../auth/auth-service';

export interface TenantAccountStatus {
  deletion_scheduled_at: Date | null;
  suspended_at: Date | null;
  paused_at: Date | null;
}

@Component({
  selector: 'pc-account-settings',
  imports: [DatePipe, Icon],
  templateUrl: './account-settings.html',
})
export class AccountSettingsComponent extends TRPCService<any> implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly dialog = inject(ConfirmDialogService);
  private readonly auth = inject(AuthService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly actionPending = signal(false);
  protected readonly status = signal<TenantAccountStatus | null>(null);

  ngOnInit(): void {
    void this.loadStatus();
  }

  protected async loadStatus() {
    const end = this._loading.begin();
    try {
      const data = await this.api.auth.getTenantAccountStatus.query();
      this.status.set({
        deletion_scheduled_at: data.deletion_scheduled_at ? new Date(data.deletion_scheduled_at) : null,
        suspended_at: data.suspended_at ? new Date(data.suspended_at) : null,
        paused_at: data.paused_at ? new Date(data.paused_at) : null,
      });
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load account status.');
    } finally {
      end();
    }
  }

  protected async pauseAccount() {
    const confirmed = await this.dialog.confirm({
      title: 'Pause Account',
      message:
        'Are you sure you want to pause your account? Your data will be preserved and billing paused, but all users will lose access until the account is reactivated.',
      variant: 'warning',
      confirmText: 'Pause',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    this.actionPending.set(true);
    try {
      await this.api.auth.pauseTenant.mutate();
      // A sign-out that could not reach the server leaves the user on this page (it says so in
      // its own dialog), so give them the buttons back instead of a permanently pending page.
      const result = await this.auth.signOut();
      if (result.status === 'still-signed-in') this.actionPending.set(false);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to pause account.');
      this.actionPending.set(false);
    }
  }

  protected async resumeAccount() {
    const confirmed = await this.dialog.confirm({
      title: 'Reactivate Account',
      message: 'Reactivate your account? All users will regain access immediately.',
      variant: 'success',
      confirmText: 'Reactivate',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    this.actionPending.set(true);
    try {
      await this.api.auth.resumeTenant.mutate();
      await this.loadStatus();
      this.alerts.showSuccess('Account reactivated. Welcome back!');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to reactivate account.');
    } finally {
      this.actionPending.set(false);
    }
  }

  protected async deleteAccount() {
    // First confirmation — make scope crystal clear
    const firstConfirm = await this.dialog.confirm({
      title: 'Delete Entire Organization?',
      message:
        'This will permanently delete your entire organization: all users, contacts, emails, campaigns, imports, and every other piece of data. ' +
        'Every user in this account will lose access immediately.\n\n' +
        'If you only want to remove a single user, go to the Users page instead.',
      variant: 'danger',
      confirmText: 'Yes, delete the entire organization',
      cancelText: 'Cancel',
    });
    if (!firstConfirm) return;

    // Second confirmation — require typing "DELETE"
    const typed = await this.dialog.prompt({
      title: 'Type DELETE to confirm',
      message:
        'This cannot be undone. Your account will be queued for deletion and all users will be signed out immediately. ' +
        'You will have 24 hours to cancel via the link sent to your email.\n\nType DELETE to proceed.',
      variant: 'danger',
      inputPlaceholder: 'DELETE',
      confirmText: 'Schedule Deletion',
      cancelText: 'Cancel',
    });
    if (!typed || typed.trim() !== 'DELETE') {
      if (typed !== null) {
        this.alerts.showError('You must type DELETE exactly to confirm. Account deletion was cancelled.');
      }
      return;
    }

    this.actionPending.set(true);
    try {
      await this.api.auth.scheduleTenantDeletion.mutate();
      // All sessions are wiped server-side; this closes the one in this browser and redirects to
      // the sign-in page. If it cannot reach the server it says so and the user stays here, so
      // give them the buttons back.
      const result = await this.auth.signOut();
      if (result.status === 'still-signed-in') this.actionPending.set(false);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to schedule account deletion.');
      this.actionPending.set(false);
    }
  }

  protected async cancelDeletion() {
    const confirmed = await this.dialog.confirm({
      title: 'Cancel Account Deletion',
      message: 'Cancel the scheduled deletion? Your account and all data will remain intact.',
      variant: 'info',
      confirmText: 'Cancel Deletion',
      cancelText: 'Go Back',
    });
    if (!confirmed) return;

    this.actionPending.set(true);
    try {
      await this.api.auth.cancelTenantDeletion.mutate();
      await this.loadStatus();
      this.alerts.showSuccess('Account deletion cancelled. Your data is safe.');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to cancel deletion.');
    } finally {
      this.actionPending.set(false);
    }
  }
}
