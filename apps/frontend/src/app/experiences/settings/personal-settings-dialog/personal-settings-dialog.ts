import { Component, computed, effect, inject, model, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';

import { IAuthUserDetail, UpdateAuthUserType } from '../../../../../../../libs/common/src';
import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { ThemePreference, ThemeService } from '../../../layout/theme/theme-service';
import { PasskeySettingsComponent } from '../security/passkey-settings';

interface NotifRow {
  /** Stable row identity — the email key where there is one, else the channel key. */
  key: string;
  emailKey?: string;
  helper: string;
  inAppKey?: string;
  /** Text message. Only one row has it, and it is the only opt-in preference here. */
  smsKey?: string;
  label: string;
  /** Whether an absent stored value means on. Everything is opt-out except SMS. */
  defaultOn: boolean;
}

const NOTIF_ROWS: NotifRow[] = [
  {
    key: 'mention_in_comment',
    label: 'Mentioned in comment',
    helper: 'When someone mentions you in a thread',
    emailKey: 'mention_in_comment',
    inAppKey: 'mention_in_comment_in_app',
    defaultOn: true,
  },
  {
    key: 'task_assigned',
    label: 'Task assigned',
    helper: 'When a task is assigned to you',
    emailKey: 'task_assigned',
    inAppKey: 'task_assigned_in_app',
    defaultOn: true,
  },
  {
    key: 'task_due',
    label: 'Task due today / overdue',
    helper: 'Daily reminder of active tasks due',
    emailKey: 'task_due',
    inAppKey: 'task_due_in_app',
    defaultOn: true,
  },
  {
    key: 'person_assigned',
    label: 'Person assigned',
    helper: 'When contact ownership is assigned to you',
    emailKey: 'person_assigned',
    inAppKey: 'person_assigned_in_app',
    defaultOn: true,
  },
  {
    key: 'email_assigned',
    label: 'Email assigned',
    helper: 'When an inbox conversation is assigned to you',
    emailKey: 'email_assigned',
    inAppKey: 'email_assigned_in_app',
    defaultOn: true,
  },
  {
    key: 'export_ready',
    label: 'Export ready',
    helper: 'Download link when a CSV export finishes',
    emailKey: 'export_ready',
    inAppKey: 'export_ready_in_app',
    defaultOn: true,
  },
  {
    key: 'import_summary',
    label: 'Import summary',
    helper: 'Completion stats after a spreadsheet import',
    emailKey: 'import_summary',
    defaultOn: true,
  },
  // The only text-message row. Email and in-app alerts for this event always fire, so those
  // two cells stay empty rather than showing a toggle that would do nothing.
  {
    key: 'companion_approval_sms',
    label: 'Volunteer waiting for approval',
    helper: 'Text me when someone I invited is waiting to be approved',
    smsKey: 'companion_approval_sms',
    defaultOn: true,
  },
];

/**
 * Personal Settings popup (§5a) — instant apply, no Save/Reset. Everything here is
 * scoped to the signed-in user: notification matrix, theme, and passkeys. Tenant-wide
 * appearance defaults (theme, date format) live in Workspace → Organization instead.
 */
@Component({
  selector: 'pc-personal-settings-dialog',
  imports: [Icon, PasskeySettingsComponent],
  templateUrl: 'personal-settings-dialog.html',
})
export class PersonalSettingsDialog {
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly alerts = inject(AlertService);
  protected readonly theme = inject(ThemeService);

  protected readonly themeOptions: { label: string; value: ThemePreference }[] = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' },
  ];

  /** Two-way open state, driven by the navbar avatar menu. */
  public readonly open = model<boolean>(false);
  public readonly closed = output<void>();

  protected readonly rows = NOTIF_ROWS;

  private readonly user = signal<IAuthUserDetail | null>(null);
  private loadStarted = false;
  protected readonly prefs = signal<Record<string, boolean>>({});
  protected readonly savedJustNow = signal<boolean>(false);

  protected readonly initial = computed<string>(() => {
    const u = this.user();
    const src = u?.first_name || u?.email || '?';
    return src.charAt(0).toUpperCase();
  });

  constructor() {
    // Load lazily on first open (the dialog is always mounted in the navbar) and
    // reset the footer contract to its resting state each time it opens.
    effect(() => {
      if (!this.open()) return;
      this.savedJustNow.set(false);
      if (!this.loadStarted) {
        this.loadStarted = true;
        void this.load();
      }
    });
  }

  /** `defaultOn` comes from the row, because not every preference here is opt-out. */
  protected isOn(key: string, defaultOn = true): boolean {
    return this.prefs()[key] ?? defaultOn;
  }

  protected toggle(key: string, defaultOn = true): void {
    this.prefs.update((p) => ({ ...p, [key]: !(p[key] ?? defaultOn) }));
    void this.persistNotifications();
  }

  protected setThemePreference(next: ThemePreference): void {
    if (this.theme.getPreference() === next) return;
    this.theme.setPreference(next);
    this.flashSaved();
  }

  protected close(): void {
    this.open.set(false);
    this.closed.emit();
  }

  private async load(): Promise<void> {
    try {
      const current = await this.auth.getCurrentUser();
      if (!current) return;
      const detail = await this.userService.getProfileById(current.id);
      this.user.set(detail);
      const p = detail.notification_preferences ?? {};
      const next: Record<string, boolean> = {};
      const stored = p as Record<string, boolean | undefined>;
      for (const row of NOTIF_ROWS) {
        for (const key of [row.emailKey, row.inAppKey, row.smsKey]) {
          if (key) next[key] = stored[key] ?? row.defaultOn;
        }
      }
      this.prefs.set(next);
    } catch (err) {
      console.error('Failed to load personal settings', err);
    }
  }

  private async persistNotifications(): Promise<void> {
    const user = this.user();
    if (!user) return;
    const p = this.prefs();
    const payload: UpdateAuthUserType = {
      notification_preferences: {
        mention_in_comment: p['mention_in_comment'] ?? true,
        mention_in_comment_in_app: p['mention_in_comment_in_app'] ?? true,
        task_assigned: p['task_assigned'] ?? true,
        task_assigned_in_app: p['task_assigned_in_app'] ?? true,
        task_due: p['task_due'] ?? true,
        task_due_in_app: p['task_due_in_app'] ?? true,
        person_assigned: p['person_assigned'] ?? true,
        person_assigned_in_app: p['person_assigned_in_app'] ?? true,
        email_assigned: p['email_assigned'] ?? true,
        email_assigned_in_app: p['email_assigned_in_app'] ?? true,
        export_ready: p['export_ready'] ?? true,
        export_ready_in_app: p['export_ready_in_app'] ?? true,
        import_summary: p['import_summary'] ?? true,
        companion_approval_sms: p['companion_approval_sms'] ?? true,
      },
    };
    try {
      await this.userService.updateUserProfile(user.id, payload);
      this.flashSaved();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not save your preference.');
    }
  }

  private flashSaved(): void {
    this.savedJustNow.set(true);
  }
}
