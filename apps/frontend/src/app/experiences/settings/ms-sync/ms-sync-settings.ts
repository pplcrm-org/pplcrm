import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { TRPCService } from '../../../services/api/trpc-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';

@Component({
  selector: 'pc-ms-sync-settings',
  imports: [Icon],
  templateUrl: './ms-sync-settings.html',
})
export class MsSyncSettings extends TRPCService<unknown> implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly campaignContext = inject(CampaignContextService);

  /** Campaigns §15 — a mailbox connection belongs to the active context. */
  private campaignId(): string {
    const id = this.campaignContext.activeCampaignId();
    if (!id) throw new Error('No active campaign selected');
    return id;
  }

  protected readonly status = signal<{
    /** False when the server has no Microsoft OAuth credentials (sync is optional per deployment). */
    configured?: boolean;
    connected: boolean;
    msEmail: string | null;
    syncedAt: Date | string | null;
    syncing?: boolean;
    lastSyncError?: string | null;
    lastSyncErrorAt?: Date | string | null;
  } | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isConnecting = signal(false);
  protected readonly isSyncing = signal(false);
  protected readonly connectError = signal<string | null>(null);
  protected readonly lastSyncResult = signal<{ inserted: number } | null>(null);
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    // Connections are per-campaign, so the active context must be resolved first.
    await this.campaignContext.ensureLoaded();

    // Handle OAuth redirect result (ms_connected or ms_error query params)
    const params = this.route.snapshot.queryParamMap;
    if (params.has('ms_connected')) {
      this.alertSvc.showSuccess('Office 365 account connected successfully!');
    } else if (params.has('ms_error')) {
      this.connectError.set(params.get('ms_error'));
    }

    await this.loadStatus();
  }

  protected async connect() {
    this.isConnecting.set(true);
    this.connectError.set(null);
    try {
      const returnTo = window.location.pathname + window.location.search;
      const result = await this.api.msSync.getAuthUrl.query({ campaignId: this.campaignId(), returnTo });
      window.location.href = result.url;
    } catch {
      this.connectError.set('Failed to initiate Microsoft sign-in. Please try again.');
      this.isConnecting.set(false);
    }
  }

  protected async syncNow() {
    this.isSyncing.set(true);
    this.lastSyncResult.set(null);
    try {
      await this.api.msSync.syncNow.mutate({ campaignId: this.campaignId() });
      await this.loadStatus();
    } catch {
      this.alertSvc.showError('Sync failed. Please try reconnecting your account.');
      this.isSyncing.set(false);
    }
  }

  protected async forceFullResync() {
    const confirmed = await this.dialogs.confirm({
      title: 'Re-sync recent mail',
      message:
        'This resets the sync position and pulls the last 48 hours again from scratch. Older messages already in your inbox are left alone. Continue?',
      variant: 'warning',
      confirmText: 'Re-sync',
    });
    if (!confirmed) return;

    this.isSyncing.set(true);
    this.lastSyncResult.set(null);
    try {
      const campaignId = this.campaignId();
      await this.api.msSync.resetSync.mutate({ campaignId });
      await this.api.msSync.syncNow.mutate({ campaignId });
      await this.loadStatus();
    } catch {
      this.alertSvc.showError('Failed to start re-sync. Please try again.');
      this.isSyncing.set(false);
    }
  }

  protected async disconnect() {
    const confirmed = await this.dialogs.confirm({
      title: 'Disconnect Office 365',
      message: 'Are you sure you want to disconnect your Office 365 account?',
      variant: 'warning',
      confirmText: 'Disconnect',
    });
    if (!confirmed) return;

    const removeLocal = await this.dialogs.confirm({
      title: 'Delete Synced Emails',
      message: 'Would you also like to delete all locally stored emails that were synced from this account?',
      variant: 'danger',
      confirmText: 'Delete Emails',
      cancelText: 'Keep Emails',
    });
    try {
      await this.api.msSync.disconnect.mutate({ campaignId: this.campaignId(), removeLocalEmails: removeLocal });
      this.status.set({ connected: false, msEmail: null, syncedAt: null });
      this.lastSyncResult.set(null);
      this.alertSvc.showSuccess('Office 365 account disconnected.');
    } catch {
      this.alertSvc.showError('Failed to disconnect. Please try again.');
    }
  }

  protected formatDate(date: Date | string | null) {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  }

  private async loadStatus() {
    try {
      const s = await this.api.msSync.getConnectionStatus.query({ campaignId: this.campaignId() });
      this.status.set(s);
      if (s?.syncing) {
        this.isSyncing.set(true);
        this.startPollingStatus();
      } else {
        this.isSyncing.set(false);
        this.stopPollingStatus();
      }
    } catch (err) {
      console.error('Failed to load connection status:', err);
      this.isSyncing.set(false);
    } finally {
      this.isLoading.set(false);
    }
  }

  private startPollingStatus() {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(() => void this.pollStep(), 4000);
    this.destroyRef.onDestroy(() => this.stopPollingStatus());
  }

  private async pollStep(): Promise<void> {
    try {
      const s = await this.api.msSync.getConnectionStatus.query({ campaignId: this.campaignId() });
      this.status.set(s);
      if (!s?.syncing) {
        this.isSyncing.set(false);
        this.stopPollingStatus();
        if (s?.lastSyncError) {
          this.alertSvc.showError('Office 365 mailbox sync finished with errors.');
        } else {
          this.alertSvc.showSuccess('Office 365 mailbox sync completed.');
        }
      }
    } catch (err) {
      console.error('Error polling sync status:', err);
      this.stopPollingStatus();
    }
  }

  private stopPollingStatus() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}
