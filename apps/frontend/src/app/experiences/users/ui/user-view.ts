import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { form, required, email } from '@angular/forms/signals';
import {
  IAuthUserDetail,
  IUserStatsSnapshot,
  UpdateAuthUserType,
  authRoleLabel,
} from '../../../../../../../libs/common/src';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { UserAdminService } from '../services/useradmin-service';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { StatCard } from '@uxcommon/components/stat-card/stat-card';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import type { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailItem } from '@uxcommon/components/detail-item/detail-item';
import { Card as PcCard } from '@uxcommon/components/card/card';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';
import { getUserErrorMessage } from '../../../services/api/user-message';
import {
  userIsDeactivated,
  userLastActiveLabel,
  userRoleLockReason,
  userRoleOptions,
  userShortDate,
  userStatus,
} from '../user-status';

/**
 * The one user page — view and edit in place, no separate edit route (approved design,
 * 2026-07-10 mockup). Rolodex records keep the view/edit split; account-ish pages
 * (Profile, Users) edit in place:
 * - identity fields save explicitly with narrated dirty state (the Profile-page idiom),
 * - role applies instantly with explained locks (the Users-list idiom),
 * - lifecycle actions (password reset, resend invite, deactivate/reactivate, delete)
 *   live where the doctrine puts them (§4).
 */
@Component({
  selector: 'pc-user-view',
  imports: [DatePipe, Icon, RecordActivities, DetailLayout, StatCard, StatusBadge, DetailItem, PcCard, PcInput],
  templateUrl: './user-view.html',
})
export class UserViewComponent {
  readonly id = input.required<string>();

  protected readonly recordNav = injectRecordNavigation('user', this.id);

  private readonly alerts = inject(AlertService);
  private readonly router = inject(Router);
  private readonly users = inject(UserAdminService);
  private readonly auth = inject(AuthService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly campaignContext = inject(CampaignContextService);

  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly loading = this._loading.visible;
  protected readonly initialized = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<IUserStatsSnapshot | null>(null);
  protected readonly detail = signal<IAuthUserDetail | null>(null);

  protected readonly saving = signal(false);
  protected readonly resettingPassword = signal(false);
  protected readonly roleSaving = signal(false);
  /** One-shot saved flash on the role select after an instant-apply role change. */
  protected readonly roleFlash = signal(false);
  /** In-flight resend-invite / deactivate / reactivate action. */
  protected readonly lifecycleBusy = signal(false);

  protected readonly payload = signal({ email: '', first_name: '', last_name: '' });

  protected readonly form = form(this.payload, (p) => {
    required(p.email);
    email(p.email);
    required(p.first_name);
  });

  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);

  protected readonly currentUserRole = computed(() => this.auth.getUser()?.role ?? null);
  protected readonly currentUserId = computed(() => {
    const id = this.auth.getUser()?.id;
    return id != null ? String(id) : null;
  });

  protected readonly isSelf = computed(() => String(this.id()) === this.currentUserId());
  protected readonly isDeactivated = computed(() => {
    const user = this.detail();
    return !!user && userIsDeactivated(user);
  });
  protected readonly isInvited = computed(() => {
    const user = this.detail();
    return !!user && !user.verified && !userIsDeactivated(user);
  });

  /** Admins may not manage owner accounts — only another owner can. */
  protected readonly canManageTarget = computed(
    () => !(this.currentUserRole() === 'admin' && this.detail()?.role === 'owner'),
  );
  protected readonly canDelete = computed(() => !!this.detail() && !this.isSelf() && this.canManageTarget());
  protected readonly showDeactivateAction = computed(
    () => !!this.detail() && !this.isSelf() && this.canManageTarget() && !this.isDeactivated(),
  );

  protected readonly status = computed(() => {
    const user = this.detail();
    return user ? userStatus(user) : null;
  });

  protected readonly roleLabel = computed(() => authRoleLabel(this.detail()?.role));

  protected readonly roleLock = computed(() => {
    const user = this.detail();
    if (!user) return null;
    return userRoleLockReason({
      isSelf: this.isSelf(),
      callerRole: this.currentUserRole(),
      targetRole: user.role,
      deactivated: this.isDeactivated(),
    });
  });

  protected readonly roleChoices = computed(() => userRoleOptions(this.currentUserRole(), this.detail()?.role));

  protected roleLabelFor(role: string): string {
    return authRoleLabel(role);
  }

  // Campaigns §15 — assignment select (instant-apply, same idiom as Role).
  protected readonly campaignSaving = signal(false);
  protected readonly campaignFlash = signal(false);
  protected readonly assignableCampaigns = computed(() =>
    this.campaignContext.campaigns().filter((c) => c.status === 'active'),
  );
  /** Only worth showing once an election campaign exists alongside the office. */
  protected readonly showCampaignControl = computed(() => this.assignableCampaigns().length > 1);
  /** Admins/owners can work in every campaign, so the assignment doesn't scope them. */
  protected readonly targetIsCampaignScoped = computed(() => {
    const role = this.detail()?.role;
    return role !== 'admin' && role !== 'owner';
  });
  protected readonly assignedCampaignName = computed(() => {
    const id = this.detail()?.campaign_id ?? null;
    if (id == null) return 'Office';
    return this.assignableCampaigns().find((c) => String(c.id) === id)?.name ?? 'Office';
  });

  protected async changeCampaign(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const campaignId = select.value || null;
    const user = this.detail();
    if (!user || campaignId === (user.campaign_id ?? null)) return;

    this.campaignSaving.set(true);
    try {
      await this.users.update(this.id(), { campaign_id: campaignId } as UpdateAuthUserType);
      this.detail.update((d) => (d ? { ...d, campaign_id: campaignId } : d));
      this.users.triggerRefresh();
      this.campaignFlash.set(true);
      const FLASH_MS = 1300;
      setTimeout(() => this.campaignFlash.set(false), FLASH_MS);
      this.alerts.showSuccess(`${this.displayName()} now works in ${this.assignedCampaignName()}`);
    } catch (err) {
      select.value = user.campaign_id ?? '';
      this.alerts.showError(getUserErrorMessage(err, 'Unable to update the campaign'));
    } finally {
      this.campaignSaving.set(false);
    }
  }

  protected readonly lastActiveLabel = computed(() => {
    const user = this.detail();
    return user ? userLastActiveLabel(user) : '—';
  });

  /**
   * Lifecycle context strip in the Access card: names the limbo state and carries its one
   * next step (§3 offer the exit). Null for active accounts.
   */
  protected readonly lifecycleStrip = computed<{
    tone: 'warning' | 'ghost';
    text: string;
    action: 'resend' | 'reactivate' | null;
    actionLabel: string;
  } | null>(() => {
    const user = this.detail();
    if (!user) return null;
    const canAct = this.canManageTarget();
    if (user.deactivated_at) {
      const since = userShortDate(user.deactivated_at);
      return {
        tone: 'ghost',
        text: `Deactivated${since ? ` ${since}` : ''}. Can't sign in`,
        action: canAct ? 'reactivate' : null,
        actionLabel: 'Reactivate user',
      };
    }
    if (user.deletion_scheduled_at) {
      const when = userShortDate(user.deletion_scheduled_at);
      return {
        tone: 'ghost',
        text: `Deletion scheduled${when ? ` for ${when}` : ''}. Signing back in cancels it`,
        action: canAct ? 'reactivate' : null,
        actionLabel: 'Reactivate user',
      };
    }
    if (!user.verified) {
      const sent = userShortDate(user.created_at);
      return {
        tone: 'warning',
        text: `Invite sent${sent ? ` ${sent}` : ''}. Hasn't signed in yet`,
        action: canAct ? 'resend' : null,
        actionLabel: 'Resend invite',
      };
    }
    return null;
  });

  protected readonly displayName = computed(() => {
    const user = this.detail();
    if (!user) return '';
    const tokens = [user.first_name, user.last_name].filter((t) => !!t && t.trim().length > 0);
    const name = tokens.join(' ').trim();
    return name || user.email;
  });

  protected readonly initials = computed(() => {
    const user = this.detail();
    if (!user) return null;
    const letters = [user.first_name, user.last_name]
      .map((t) => (t ?? '').trim().charAt(0))
      .filter(Boolean)
      .join('')
      .toUpperCase();
    return letters || user.email.charAt(0).toUpperCase();
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Users', route: '/users' },
    { label: this.displayName() || 'User' },
  ]);

  protected readonly activityCards = computed(() => {
    const s = this.stats();
    if (!s) return [];
    return [
      {
        key: 'emails',
        title: 'Emails Assigned',
        value: s.emails_assigned.total,
        subtitle: `${s.emails_assigned.open} open · ${s.emails_assigned.closed} closed`,
        asOf: null,
      },
      {
        key: 'contacts',
        title: 'Contacts Added',
        value: s.contacts_added.total,
        subtitle: s.contacts_added.last_created_at ? 'Last new contact' : 'No contacts yet',
        asOf: s.contacts_added.last_created_at,
      },
      {
        key: 'imports',
        title: 'Files Imported',
        value: s.files_imported.count,
        subtitle: `${s.files_imported.total_rows} people imported`,
        asOf: s.files_imported.last_activity_at,
      },
      {
        key: 'exports',
        title: 'Files Exported',
        value: s.files_exported.count,
        subtitle: `${s.files_exported.total_rows} rows exported`,
        asOf: s.files_exported.last_activity_at,
      },
    ];
  });

  constructor() {
    effect(() => {
      const currentId = this.id();
      untracked(() => {
        if (!currentId) {
          this.error.set('Missing user identifier.');
          return;
        }
        void this.load();
      });
    });
  }

  /** Route-level unsaved-changes guard (the edit form lives on this page now). */
  public canDeactivate(): Promise<boolean> {
    return this.unsavedChanges.confirmDiscardIfDirty(this.displayName() || 'this user');
  }

  protected async save(event?: Event) {
    event?.preventDefault();

    this.form().markAsTouched();
    if (this.form().invalid() || !this.id()) {
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.users.update(this.id(), this.buildPayload());
      this.alerts.showSuccess('User updated');
      this.users.triggerRefresh();
      await this.load();
    } catch (err) {
      const message = getUserErrorMessage(err, 'Unable to update user');
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      this.saving.set(false);
    }
  }

  protected resetForm() {
    const user = this.detail();
    if (!user) return;
    this.setForm(user);
    this.form().reset();
  }

  /**
   * Role is instant-apply (same idiom as the Users list) so a role change never gets
   * tangled with unsaved identity edits. The detail signal is patched in place rather
   * than reloaded, to keep any in-progress form edits intact.
   */
  protected async changeRole(eventTarget: Event) {
    const select = eventTarget.target as HTMLSelectElement;
    const role = select.value;
    const user = this.detail();
    if (!role || !user || role === user.role) return;

    this.roleSaving.set(true);
    try {
      await this.users.update(this.id(), { role } as UpdateAuthUserType);
      this.detail.update((d) => (d ? { ...d, role } : d));
      this.users.triggerRefresh();
      this.flashRole();
      this.alerts.showSuccess(`Role updated. ${this.displayName()} is now ${authRoleLabel(role)}`);
    } catch (err) {
      select.value = user.role ?? '';
      this.alerts.showError(getUserErrorMessage(err, 'Unable to update the role'));
    } finally {
      this.roleSaving.set(false);
    }
  }

  protected async triggerPasswordReset() {
    if (!this.id()) return;
    this.resettingPassword.set(true);
    try {
      await this.users.adminTriggerPasswordReset(this.id());
      this.alerts.showSuccess(`Password reset email sent to ${this.detail()?.email ?? 'the user'}`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to trigger password reset'));
    } finally {
      this.resettingPassword.set(false);
    }
  }

  protected async resendInvite() {
    if (!this.id() || this.lifecycleBusy()) return;
    this.lifecycleBusy.set(true);
    try {
      await this.users.resendInvite(this.id());
      this.alerts.showSuccess(`Invitation email sent to ${this.detail()?.email ?? 'the user'}`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to resend the invitation'));
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  protected async deactivateUser() {
    const user = this.detail();
    if (!user || this.lifecycleBusy()) return;

    const confirmed = await this.dialogs.confirm({
      title: 'Deactivate user',
      message: `${this.displayName()} won't be able to sign in until an admin or owner reactivates them. Their role and history are kept.`,
      variant: 'warning',
      confirmText: 'Deactivate user',
    });
    if (!confirmed) return;

    this.lifecycleBusy.set(true);
    try {
      await this.users.deactivate(this.id());
      this.detail.update((d) => (d ? { ...d, deactivated_at: new Date() } : d));
      this.users.triggerRefresh();
      this.alerts.showSuccess(`${this.displayName()} deactivated. They can no longer sign in`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to deactivate user'));
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  protected async reactivateUser() {
    if (!this.id() || this.lifecycleBusy()) return;
    this.lifecycleBusy.set(true);
    try {
      await this.users.reactivate(this.id());
      this.detail.update((d) => (d ? { ...d, deactivated_at: null, deletion_scheduled_at: null } : d));
      this.users.triggerRefresh();
      this.alerts.showSuccess(`${this.displayName()} reactivated. They can sign in again`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to reactivate user'));
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  protected async deleteUser() {
    if (!this.id() || !this.canDelete()) return;

    const confirmed = await this.dialogs.confirm({
      title: 'Delete user',
      message: `Delete ${this.displayName()}? Their sign-in is removed permanently. This cannot be undone. To keep their history but block access, deactivate instead.`,
      variant: 'danger',
      confirmText: 'Delete user',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      const success = await this.users.delete(this.id());
      if (!success) {
        throw new Error('User deletion is not supported');
      }
      this.alerts.showSuccess('User deleted');
      await this.router.navigate(['/users']);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Unable to delete user'));
    } finally {
      end();
    }
  }

  protected formatAsOf(date: Date | null): string {
    if (!date) return '—';
    try {
      const d = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d);
    } catch {
      return date.toString();
    }
  }

  private async load() {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    this.error.set(null);
    try {
      const [user] = await Promise.all([this.users.getById(this.id()), this.campaignContext.ensureLoaded()]);
      if (!isCurrent()) return; // superseded — do not land stale data
      this.detail.set(user);
      this.stats.set(user.stats);
      this.setForm(user);
      this.form().reset();
    } catch (err) {
      const message = getUserErrorMessage(err, 'Failed to load user');
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      end();
      this.initialized.set(true);
    }
  }

  private setForm(user: IAuthUserDetail) {
    this.payload.set({
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name ?? '',
    });
  }

  private buildPayload(): UpdateAuthUserType {
    const raw = this.payload();
    const lastName = raw.last_name?.trim() ?? '';
    return {
      email: raw.email?.trim() ?? '',
      first_name: raw.first_name?.trim() ?? '',
      last_name: lastName.length ? lastName : null,
    } as UpdateAuthUserType;
  }

  private flashRole(): void {
    this.roleFlash.set(true);
    const FLASH_MS = 1300;
    setTimeout(() => this.roleFlash.set(false), FLASH_MS);
  }
}
