import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { form, required, email, disabled, FormField } from '@angular/forms/signals';
import {
  IAuthUserDetail,
  IUserStatsSnapshot,
  UpdateAuthUserType,
  authRoleLabel,
} from '../../../../../../libs/common/src';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { UserAvatarComponent } from '@uxcommon/components/user-avatar/user-avatar';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { AuthService } from '../../auth/auth-service';
import { CampaignContextService } from '../../services/campaign-context.service';
import { UserService } from '../../services/user.service';
import { Input as PcInput } from '@uxcommon/components/input/input';
import { injectUnsavedChanges } from '@frontend/services/unsaved-changes-guard';

@Component({
  selector: 'pc-profile-page',
  imports: [DatePipe, PcInput, FormField, Icon, UserAvatarComponent, DecimalPipe, RouterLink, ModalShell],
  templateUrl: './profile-page.html',
})
export class ProfilePage implements OnInit {
  private readonly alerts = inject(AlertService);
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly campaignContext = inject(CampaignContextService);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly saving = signal(false);
  protected readonly uploadingAvatar = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<IUserStatsSnapshot | null>(null);
  protected readonly detail = signal<IAuthUserDetail | null>(null);
  protected readonly avatarUrl = signal<string | null>(null);

  // Profile picture cropping state
  protected readonly cropImageSrc = signal<string | null>(null);
  protected readonly cropZoom = signal<number>(1.0);
  protected readonly cropX = signal<number>(0);
  protected readonly cropY = signal<number>(0);
  protected readonly displayWidth = signal<number>(0);
  protected readonly displayHeight = signal<number>(0);

  private cropFileName = '';
  private isDragging = false;
  private startX = 0;
  private startY = 0;

  // Deliberate-save card: identity fields only (name/email). Saved on an explicit Save click.
  protected readonly payload = signal({
    email: '',
    first_name: '',
    last_name: '',
  });

  protected readonly form = form(this.payload, (p) => {
    required(p.email);
    email(p.email);
    required(p.first_name);
    disabled(p.email, () => this.isViewer() || this.saving());
    disabled(p.first_name, () => this.isViewer() || this.saving());
    disabled(p.last_name, () => this.isViewer() || this.saving());
  });

  protected readonly isViewer = computed(() => this.detail()?.role === 'viewer');

  /** Product name for the stored role value — 'user' reads as "Editor", same as everywhere else. */
  protected readonly roleLabel = computed(() => authRoleLabel(this.detail()?.role));

  /**
   * Campaigns §15 — which campaign this account works in. Admins/owners see every
   * campaign; everyone else is pinned to their admin-assigned one (the backend
   * returns exactly that campaign as the active context).
   */
  protected readonly campaignLabel = computed(() => {
    const role = this.detail()?.role;
    if (role === 'admin' || role === 'owner') {
      const active = this.campaignContext.activeCampaign();
      return active ? `All campaigns (working in ${active.name})` : 'All campaigns';
    }
    return this.campaignContext.activeCampaign()?.name ?? 'Office';
  });

  protected readonly isCampaignScoped = computed(() => {
    const role = this.detail()?.role;
    return role !== 'admin' && role !== 'owner';
  });

  /** Account-panel variant with the access summary, e.g. "Owner — full access". */
  protected readonly roleWithAccess = computed(() => {
    const role = this.detail()?.role;
    const descriptions: Record<string, string> = {
      owner: 'Owner: full access',
      admin: 'Admin: users & workspace settings',
      user: 'Editor: day-to-day work',
      viewer: 'Viewer: read-only',
    };
    return role ? (descriptions[role] ?? authRoleLabel(role)) : '—';
  });

  // Narrate unsaved identity edits (§2 disclosure) AND guard against losing them. This page
  // used to compute the dirty count by hand and have no canDeactivate at all — it told the user
  // their work was at risk and then let them navigate away and lose it.
  protected readonly unsavedChanges = injectUnsavedChanges(this.form, this.payload);
  protected readonly dirtyFieldCount = this.unsavedChanges.dirtyCount;

  protected readonly displayName = computed(() => {
    const user = this.detail();
    if (!user) return '';
    const tokens = [user.first_name, user.last_name].filter((t) => !!t && t.trim().length > 0);
    const name = tokens.join(' ').trim();
    return name || user.email;
  });

  protected readonly initials = computed(() => {
    const first = this.payload().first_name?.trim();
    const last = this.payload().last_name?.trim();
    if (first && last) {
      return (first[0]! + last[0]!).toUpperCase();
    }
    if (first) {
      return first[0]!.toUpperCase();
    }
    const emailStr = this.payload().email?.trim();
    if (emailStr) {
      return emailStr[0]!.toUpperCase();
    }
    return '?';
  });

  /** "Your activity" sentences (approved design) — counts are all-time, so no invented time windows. */
  protected readonly activityRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const emails = s.emails_assigned;
    const emailRest =
      emails.total === 0
        ? 'assigned to you'
        : emails.open === emails.total
          ? 'assigned to you, all open'
          : emails.open === 0
            ? 'assigned to you, all closed'
            : `assigned to you, ${emails.open} open · ${emails.closed} closed`;
    return [
      {
        key: 'emails',
        icon: 'inbox-stack' as const,
        link: '/inbox',
        count: plural(emails.total, 'conversation'),
        rest: emailRest,
      },
      {
        key: 'contacts',
        icon: 'user-group' as const,
        link: '/people',
        count: plural(s.contacts_added.total, 'contact'),
        rest: 'added by you',
      },
      {
        key: 'files',
        icon: 'arrows-up-down-tray' as const,
        link: null,
        count: `${plural(s.files_imported.count, 'import')} · ${plural(s.files_exported.count, 'export')}`,
        rest: 'all time',
      },
    ];
  });

  public ngOnInit(): void {
    void this.load();
  }

  /**
   * @returns whether the write landed — the leave guard needs this to decide between keeping the
   * user on the form and letting the navigation through.
   */
  protected async save(event?: Event): Promise<boolean> {
    if (event) {
      event.preventDefault();
    }

    this.form().markAsTouched();
    if (this.form().invalid()) {
      return false;
    }

    const user = this.detail();
    if (!user) return false;

    const payload = this.buildPayload();

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.userService.updateUserProfile(user.id, payload);
      this.alerts.showSuccess('Profile updated successfully');
      await this.load();
      this.form().reset();
      return true;
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to update profile';
      this.error.set(message);
      this.alerts.showError(message);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  protected async cancelEmailChange() {
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.auth.cancelEmailChange();
      this.alerts.showSuccess('Email change canceled and reverted');
      await this.load();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Unable to cancel email change';
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

  protected onAvatarFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.cropFileName = file.name;
    input.value = '';

    // Read the file as a DataURL to display in the crop modal
    const reader = new FileReader();
    reader.onload = () => {
      const imgUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const containerSize = 256;
        const minDimension = Math.min(img.width, img.height);
        const displayScale = containerSize / minDimension;

        this.displayWidth.set(img.width * displayScale);
        this.displayHeight.set(img.height * displayScale);
        this.cropImageSrc.set(imgUrl);
        this.cropZoom.set(1.0);
        this.cropX.set(0);
        this.cropY.set(0);
      };
      img.src = imgUrl;
    };
    reader.readAsDataURL(file);
  }

  protected cancelCrop() {
    this.cropImageSrc.set(null);
  }

  protected onCropZoomInput(event: Event) {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!Number.isNaN(value)) this.cropZoom.set(value);
  }

  protected onCropDragStart(event: MouseEvent) {
    event.preventDefault();
    this.isDragging = true;
    this.startX = event.clientX - this.cropX();
    this.startY = event.clientY - this.cropY();
  }

  protected onCropDragMove(event: MouseEvent) {
    if (!this.isDragging) return;
    this.cropX.set(event.clientX - this.startX);
    this.cropY.set(event.clientY - this.startY);
  }

  protected onCropDragEnd() {
    this.isDragging = false;
  }

  protected getCropTransformStyle() {
    return `translate(-50%, -50%) translate(${this.cropX()}px, ${this.cropY()}px) scale(${this.cropZoom()})`;
  }

  protected async cropAndUpload() {
    const imgUrl = this.cropImageSrc();
    if (!imgUrl) return;

    this.cropImageSrc.set(null);
    this.uploadingAvatar.set(true);

    try {
      const img = new Image();
      img.src = imgUrl;
      await new Promise((resolve) => (img.onload = resolve));

      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      const containerSize = 256;
      const targetSize = 128;

      // Real scale factor between loaded image dimensions and container dimensions
      const minDimension = Math.min(img.width, img.height);
      const displayScale = containerSize / minDimension;

      const w = img.width * displayScale;
      const h = img.height * displayScale;

      ctx.clearRect(0, 0, targetSize, targetSize);

      ctx.save();
      ctx.translate(targetSize / 2, targetSize / 2);
      ctx.scale(targetSize / containerSize, targetSize / containerSize);
      ctx.translate(this.cropX(), this.cropY());
      ctx.scale(this.cropZoom(), this.cropZoom());
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();

      // Convert canvas to WebP blob (gives optimal compression and small file size)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.85));
      if (!blob) throw new Error('Failed to create WebP image blob');

      const fileExt = this.cropFileName.split('.').pop() ?? 'png';
      const webpFileName = this.cropFileName.replace(new RegExp(`\\.${fileExt}$`), '') + '.webp';
      const webpFile = new File([blob], webpFileName, { type: 'image/webp' });

      const data = await this.auth.uploadAvatar(webpFile);
      this.avatarUrl.set(this.userService.resolveAvatarUrl(data.avatar_url));
      this.alerts.showSuccess('Profile picture updated successfully');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to crop/upload avatar');
    } finally {
      this.uploadingAvatar.set(false);
    }
  }

  protected async removeAvatar() {
    this.uploadingAvatar.set(true);
    try {
      await this.auth.deleteAvatar();
      this.avatarUrl.set(null);
      this.alerts.showSuccess('Profile picture removed');
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to remove avatar');
    } finally {
      this.uploadingAvatar.set(false);
    }
  }

  private async load() {
    const end = this._loading.begin();
    this.error.set(null);
    try {
      // First ensure we have/refresh current user
      const currentUser = await this.auth.getCurrentUser();
      if (!currentUser) {
        throw new Error('Not logged in');
      }

      const user = await this.userService.getProfileById(currentUser.id);
      await this.campaignContext.ensureLoaded();
      this.detail.set(user);
      this.stats.set(user.stats as any);
      this.avatarUrl.set(this.userService.resolveAvatarUrl((user as any).avatar_url));
      this.setForm(user);
      this.form().reset();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : isRecord(err) &&
              isRecord(err['data']) &&
              typeof err['data']['message'] === 'string' &&
              err['data']['message']
            ? err['data']['message']
            : 'Failed to load profile';
      this.error.set(message);
      this.alerts.showError(message);
    } finally {
      end();
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
    const normalize = (value: string | null | undefined) => {
      const trimmed = value?.trim() ?? '';
      return trimmed.length ? trimmed : null;
    };
    // Identity only — notification preferences live in Settings (avatar menu), not here.
    return {
      email: raw.email?.trim() ?? '',
      first_name: raw.first_name?.trim() ?? '',
      last_name: normalize(raw.last_name),
    } as UpdateAuthUserType;
  }

  public canDeactivate(): Promise<boolean> {
    // stayPut is implicit: save() never navigates, and the router is already mid-navigation.
    return this.unsavedChanges.confirmDiscardIfDirty('your profile', () => this.save());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
