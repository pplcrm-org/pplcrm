import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isAuthRole, planDisplayName } from '@common';

import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import type { PcStatusType } from '@uxcommon/components/status-badge/status-badge';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { Table } from '@uxcommon/components/table/table';
import { UserAvatarComponent } from '@uxcommon/components/user-avatar/user-avatar';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { UserService } from '@frontend/services/user.service';
import { AuthService } from 'apps/frontend/src/app/auth/auth-service';
import { authRoleLabel } from '../../../../../../../libs/common/src';
import { CampaignContextService } from '../../../services/campaign-context.service';
import { UserAdminService } from '../services/useradmin-service';
import {
  userIsDeactivated,
  userLastActiveLabel,
  userRoleLockReason,
  userRoleOptions,
  userStatus,
} from '../user-status';
import { InviteUserDialog, type SeatUsage } from './invite-user-dialog';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

export interface UserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string | null;
  campaign_id: string | null;
  verified: boolean;
  two_factor_enabled: boolean;
  deletion_scheduled_at: string | null;
  deactivated_at: string | null;
  last_active_at: string | null;
  created_at: string | null;
  avatar_url: string | null;
}

/**
 * Users admin page — staff logins for this workspace. A bespoke `pc-table` (not the datagrid):
 * inline role select with explained locks, honest status/MFA/last-active columns derived from
 * real session data, and the seat-aware "Invite user" dialog.
 */
@Component({
  selector: 'pc-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyState,
    RouterLink,
    Icon,
    StatusBadge,
    Table,
    RowActions,
    UserAvatarComponent,
    InviteUserDialog,
    GridHeaderComponent,
  ],
  templateUrl: './users-page.html',
})
export class UsersPageComponent implements OnInit {
  private readonly users = inject(UserAdminService);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertService);
  private readonly userService = inject(UserService);
  private readonly campaignContext = inject(CampaignContextService);

  private readonly inviteDlg = viewChild.required(InviteUserDialog);

  protected readonly loading = createLoadingGate();
  protected readonly loaded = signal(false);
  protected readonly rows = signal<UserRow[]>([]);
  protected readonly seatUsage = signal<SeatUsage | null>(null);

  /** Row that just saved a role change — drives the one-shot saved flash. */
  protected readonly flashedId = signal<string | null>(null);
  /** Rows with an in-flight role change; their select is disabled while saving. */
  protected readonly savingIds = signal<ReadonlySet<string>>(new Set());

  protected readonly currentUserId = computed(() => {
    const id = this.auth.getUser()?.id;
    return id != null ? String(id) : null;
  });
  protected readonly currentUserRole = computed(() => this.auth.getUser()?.role ?? null);

  protected readonly activeCount = computed(
    () => this.rows().filter((r) => r.verified && !userIsDeactivated(r)).length,
  );
  protected readonly invitedCount = computed(
    () => this.rows().filter((r) => !r.verified && !userIsDeactivated(r)).length,
  );
  protected readonly deactivatedCount = computed(() => this.rows().filter((r) => userIsDeactivated(r)).length);
  protected readonly adminCount = computed(
    () => this.rows().filter((r) => (r.role === 'admin' || r.role === 'owner') && !userIsDeactivated(r)).length,
  );

  protected readonly seatsRemaining = computed(() => {
    const usage = this.seatUsage();
    return usage ? Math.max(0, usage.seatLimit - usage.seatsUsed) : null;
  });

  /** Campaigns §15 — active contexts an Editor/Viewer can be assigned to. */
  protected readonly assignableCampaigns = computed(() =>
    this.campaignContext.campaigns().filter((c) => c.status === 'active'),
  );
  /**
   * What the per-row select offers: the active campaigns, plus any ARCHIVED campaign a row is
   * still pinned to, labelled as such. An archived campaign missing from the list made the row
   * read "Office" while the pin kept scoping that user to the archived campaign.
   */
  protected readonly campaignOptions = computed(() => {
    const active = this.assignableCampaigns();
    const activeIds = new Set(active.map((c) => String(c.id)));
    const pinnedIds = new Set(
      this.rows()
        .map((row) => row.campaign_id)
        .filter((id): id is string => !!id),
    );
    const stillPinned = this.campaignContext
      .campaigns()
      .filter((c) => !activeIds.has(String(c.id)) && pinnedIds.has(String(c.id)))
      .map((c) => ({ ...c, name: `${c.name} (archived)` }));
    return stillPinned.length ? [...active, ...stillPinned] : active;
  });
  /** The column only earns its space once an election campaign exists. */
  protected readonly showCampaignColumn = computed(() => this.campaignOptions().length > 1);
  protected readonly columnCount = computed(() => (this.showCampaignColumn() ? 7 : 6));

  private readonly userSignal = this.auth.getUserSignal();
  private readonly isDemo = computed(() => !!this.userSignal()?.tenant_demo_mode_at);

  /** Why inviting is unavailable — null when it isn't. Doubles as the tooltip copy (§2 explained-disabled). */
  protected readonly inviteLockReason = computed<string | null>(() => {
    if (this.isDemo()) {
      return 'Inviting teammates is locked during the demo. Remove the demo data first';
    }
    if (this.seatsRemaining() === 0) {
      return `All ${this.seatUsage()?.seatLimit} seats on the ${this.planLabel()} plan are in use. Upgrade in Settings → Billing`;
    }
    return null;
  });

  protected readonly planLabel = computed(() => {
    const usage = this.seatUsage();
    return usage ? planDisplayName(usage.plan) : '';
  });

  /** Header grain sentence, e.g. "5 users · 3 active, 1 invited · 2 admins · 4 of 10 seats on the Team plan". */
  protected readonly headerSentence = computed(() => {
    const total = this.rows().length;
    const parts = [`${total} user${total === 1 ? '' : 's'}`];
    const statusBits = [`${this.activeCount()} active`];
    if (this.invitedCount() > 0) statusBits.push(`${this.invitedCount()} invited`);
    if (this.deactivatedCount() > 0) statusBits.push(`${this.deactivatedCount()} deactivated`);
    parts.push(statusBits.join(', '));
    parts.push(`${this.adminCount()} admin${this.adminCount() === 1 ? '' : 's'}`);
    const usage = this.seatUsage();
    if (usage) parts.push(`${usage.seatsUsed} of ${usage.seatLimit} seats on the ${this.planLabel()} plan`);
    return parts.join(' · ');
  });

  public ngOnInit(): void {
    void this.load();
  }

  protected openInvite(): void {
    this.inviteDlg().open();
  }

  protected onInvited(): void {
    void this.load();
  }

  protected displayName(row: UserRow): string {
    return `${row.first_name} ${row.last_name}`.trim() || row.email;
  }

  protected avatarUrl(row: UserRow): string | null {
    return row.avatar_url ? (this.userService.resolveAvatarUrl(row.avatar_url) ?? null) : null;
  }

  protected isSelf(row: UserRow): boolean {
    return row.id === this.currentUserId();
  }

  protected roleLabel(role: string | null): string {
    return authRoleLabel(role);
  }

  /** Roles the caller may assign on this row; includes the row's current role so the select never shows blank. */
  protected roleOptions(row: UserRow): string[] {
    return userRoleOptions(this.currentUserRole(), row.role);
  }

  /** Why this row's role can't be changed — null when it can. Doubles as the tooltip copy (§2 explained-disabled). */
  protected roleLockReason(row: UserRow): string | null {
    return userRoleLockReason({
      isSelf: this.isSelf(row),
      callerRole: this.currentUserRole(),
      targetRole: row.role,
      deactivated: userIsDeactivated(row),
    });
  }

  protected isDeactivated(row: UserRow): boolean {
    return userIsDeactivated(row);
  }

  protected status(row: UserRow): { label: string; tone: PcStatusType } {
    return userStatus(row);
  }

  protected lastActiveText(row: UserRow): string {
    return userLastActiveLabel(row);
  }

  /** Admins/owners aren't scoped by an assignment; everyone else shows their campaign. */
  protected isCampaignScoped(row: UserRow): boolean {
    return row.role !== 'admin' && row.role !== 'owner';
  }

  protected campaignName(campaignId: string | null): string {
    if (campaignId == null) return 'Office';
    return this.campaignOptions().find((c) => String(c.id) === campaignId)?.name ?? 'Office';
  }

  protected async changeCampaign(row: UserRow, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const campaignId = select.value || null;
    if (campaignId === row.campaign_id) return;

    this.savingIds.update((ids) => new Set(ids).add(row.id));
    try {
      await this.users.update(row.id, { campaign_id: campaignId });
      this.rows.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, campaign_id: campaignId } : r)));
      this.flashRow(row.id);
      this.alerts.showSuccess(`${this.displayName(row)} now works in ${this.campaignName(campaignId)}`);
    } catch (err) {
      select.value = row.campaign_id ?? '';
      const message = err instanceof Error && err.message ? err.message : 'Unable to update the campaign';
      this.alerts.showError(message);
    } finally {
      this.savingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(row.id);
        return next;
      });
    }
  }

  protected async changeRole(row: UserRow, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const role = select.value;
    // The options come from userRoleOptions(), so this only rejects a tampered DOM — but the
    // server takes AUTH_ROLES only, and an unknown role in authusers.role fails every check.
    if (!isAuthRole(role) || role === row.role) return;

    this.savingIds.update((ids) => new Set(ids).add(row.id));
    try {
      await this.users.update(row.id, { role });
      this.rows.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, role } : r)));
      this.flashRow(row.id);
      this.alerts.showSuccess(`Role updated. ${this.displayName(row)} is now ${this.roleLabel(role)}`);
    } catch (err) {
      select.value = row.role ?? '';
      const message = err instanceof Error && err.message ? err.message : 'Unable to update the role';
      this.alerts.showError(message);
    } finally {
      this.savingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(row.id);
        return next;
      });
    }
  }

  protected async sendPasswordReset(row: UserRow): Promise<void> {
    try {
      await this.users.adminTriggerPasswordReset(row.id);
      this.alerts.showSuccess(`Password reset email sent to ${row.email}`);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Unable to send the reset email';
      this.alerts.showError(message);
    }
  }

  private async load(): Promise<void> {
    const end = this.loading.begin();
    try {
      const [list, seats] = await Promise.all([
        this.users.getAll({ startRow: 0, endRow: 500 }),
        this.users.getSeatUsage(),
        this.campaignContext.ensureLoaded(),
      ]);
      this.rows.set(list.rows.map((raw) => this.toRow(raw)));
      this.seatUsage.set(seats);
      this.loaded.set(true);
    } catch {
      this.alerts.showError('Unable to load users. Try refreshing the page');
    } finally {
      end();
    }
  }

  private toRow(raw: Record<string, unknown>): UserRow {
    return {
      id: raw['id'] != null ? String(raw['id']) : '',
      email: typeof raw['email'] === 'string' ? raw['email'] : '',
      first_name: typeof raw['first_name'] === 'string' ? raw['first_name'] : '',
      last_name: typeof raw['last_name'] === 'string' ? raw['last_name'] : '',
      role: typeof raw['role'] === 'string' ? raw['role'] : null,
      campaign_id: raw['campaign_id'] != null ? String(raw['campaign_id']) : null,
      verified: raw['verified'] === true,
      two_factor_enabled: raw['two_factor_enabled'] === true,
      deletion_scheduled_at: this.toIso(raw['deletion_scheduled_at']),
      deactivated_at: this.toIso(raw['deactivated_at']),
      last_active_at: this.toIso(raw['last_active_at']),
      created_at: this.toIso(raw['created_at']),
      avatar_url: typeof raw['avatar_url'] === 'string' ? raw['avatar_url'] : null,
    };
  }

  private toIso(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value) return value;
    return null;
  }

  private flashRow(id: string): void {
    this.flashedId.set(id);
    const FLASH_MS = 1300;
    setTimeout(() => {
      if (this.flashedId() === id) this.flashedId.set(null);
    }, FLASH_MS);
  }
}
