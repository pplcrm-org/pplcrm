import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthService } from '../../../auth/auth-service';
import { describeUserAgent } from './user-agent-label';

interface SessionRow {
  id: string;
  /** "Chrome on macOS", derived from the stored user agent. */
  device: string;
  ip_address: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  is_current: boolean;
}

/**
 * "Where you're signed in" — this user's own live sessions, with a way to end any of them and a
 * way to end all the others at once.
 *
 * Lives next to Passkeys in the personal settings popup because both answer the same question:
 * what can get into my account, and how do I take that away? Everything here is scoped to the
 * signed-in user; nothing on this screen can see or touch a colleague's session.
 */
@Component({
  selector: 'pc-session-settings',
  imports: [DatePipe, Icon, EmptyState],
  templateUrl: './session-settings.html',
})
export class SessionSettingsComponent implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly pendingId = signal<string | null>(null);
  protected readonly revokingOthers = signal(false);
  protected readonly sessions = signal<SessionRow[]>([]);

  /** Everything except this browser. Drives both the button label and whether it appears at all. */
  protected readonly otherCount = computed(() => this.sessions().filter((s) => !s.is_current).length);

  protected readonly revokeOthersLabel = computed(() => {
    const count = this.otherCount();
    return count === 1 ? 'Sign out 1 other device' : `Sign out ${count} other devices`;
  });

  ngOnInit(): void {
    void this.loadSessions();
  }

  protected async loadSessions(): Promise<void> {
    const end = this._loading.begin();
    try {
      const rows = await this.auth.listSessions();
      this.sessions.set(
        rows.map((row) => ({
          id: row.id,
          device: describeUserAgent(row.user_agent),
          ip_address: row.ip_address,
          created_at: row.created_at,
          last_used_at: row.last_used_at,
          expires_at: row.expires_at,
          is_current: row.is_current,
        })),
      );
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not load your sessions.');
    } finally {
      end();
    }
  }

  protected async revokeSession(session: SessionRow): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'Sign out this device?',
      message: `${session.device} at ${session.ip_address} will be signed out straight away and will need to sign in again. Do this if you do not recognise it, or if it is a device you no longer have.`,
      variant: 'danger',
      confirmText: 'Sign it out',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    this.pendingId.set(session.id);
    try {
      await this.auth.revokeSession(session.id);
      this.sessions.update((list) => list.filter((s) => s.id !== session.id));
      this.alerts.showSuccess('That device has been signed out.');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not sign that device out.');
      // Whatever went wrong, the list on screen may no longer match the server.
      await this.loadSessions();
    } finally {
      this.pendingId.set(null);
    }
  }

  protected async revokeOthers(): Promise<void> {
    const count = this.otherCount();
    const confirmed = await this.dialog.confirm({
      title: 'Sign out everywhere else?',
      message:
        count === 1
          ? 'One other device is signed in. It will be signed out straight away and will need to sign in again. This browser stays signed in.'
          : `${count} other devices are signed in. They will all be signed out straight away and will need to sign in again. This browser stays signed in.`,
      variant: 'danger',
      confirmText: 'Sign them out',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    this.revokingOthers.set(true);
    try {
      const result = await this.auth.revokeOtherSessions();
      this.sessions.update((list) => list.filter((s) => s.is_current));
      this.alerts.showSuccess(
        result.revoked === 1 ? '1 other device was signed out.' : `${result.revoked} other devices were signed out.`,
      );
    } catch (err) {
      this.alerts.showError(
        err instanceof Error && err.message ? err.message : 'Could not sign the other devices out.',
      );
      await this.loadSessions();
    } finally {
      this.revokingOthers.set(false);
    }
  }
}
