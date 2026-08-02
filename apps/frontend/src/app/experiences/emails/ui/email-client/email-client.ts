import { Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@uxcommon/components/icons/icon';

import { EmailsService } from '../../services/emails-service';
import { EmailsStore } from '../../services/store/emailstore';
import { EmailStateStore } from '../../services/store/email-state.store';
import { EmailBody } from '../email-body/email-body';
import { ComposeEmailComponent, ComposeInitial } from '../email-compose/email-compose';
import { EmailDetails } from '../email-details/email-details';
import { EmailFolderList } from '../email-folder-list/email-folder-list';
import { EmailList } from '../email-list/email-list';
import { EmailPersonRail } from '../email-person-rail/email-person-rail';
import { ALL_FOLDERS } from '../../../../../../../../libs/common/src/lib/emails';
import { planAllowsFeature } from '@common';
import type { EmailFolderType, EmailType } from '../../../../../../../../libs/common/src/lib/models';
import { AuthService } from '@frontend/auth/auth-service';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'pc-email-client',
  imports: [
    EmailFolderList,
    EmailList,
    EmailDetails,
    EmailBody,
    ComposeEmailComponent,
    EmailPersonRail,
    Icon,
    RouterLink,
  ],
  host: {
    class: 'block h-full',
    '(document:keydown)': 'handleDocumentKeydown($event)',
  },
  templateUrl: 'email-client.html',
})
export class EmailClient {
  private readonly composer = viewChild<ComposeEmailComponent>('composer');

  private authService = inject(AuthService);
  private readonly alertSvc = inject(AlertService);

  protected readonly store = inject(EmailsStore);
  private readonly stateStore = inject(EmailStateStore);
  private readonly emailSvc = inject(EmailsService);

  protected composePrefill = signal<ComposeInitial | null>(null);
  protected draftIdToLoad = signal<string | null>(null);
  protected isComposing = signal(false);

  protected mobileView = this.stateStore.mobilePanelView;

  /**
   * The shared inbox is Grassroots+ (demo workspaces exempt — the seeded demo inbox is part of
   * the test drive). Mirrors the server's `inboxAccessGate`, which blocks the emails endpoints
   * outright on Free: rendering the client would only produce a wall of "requires Grassroots"
   * toasts, so the page swaps to an upgrade panel instead. The `g i` chord and the dimmed
   * sidebar entry keep the module discoverable.
   */
  protected readonly inboxPlanLocked = computed(() => {
    const user = this.authService.getUserSignal()();
    return !user?.tenant_demo_mode_at && !planAllowsFeature(user?.tenant_plan, 'inbox');
  });

  protected folderPanelClass = computed(() =>
    this.mobileView() === 'folders' ? 'flex-1 min-w-0 md:flex-none' : 'hidden md:block',
  );

  protected listPanelClass = computed(() =>
    this.mobileView() === 'list'
      ? 'flex flex-col h-full flex-1 min-w-0 md:flex-none'
      : 'hidden md:flex md:flex-col md:h-full',
  );

  protected detailPanelClass = computed(() =>
    this.mobileView() === 'detail'
      ? 'flex flex-col flex-1 min-w-0 h-full p-4 pt-2 relative z-10 bg-base-100'
      : 'hidden md:flex md:flex-col md:flex-1 md:h-full md:min-w-[340px] md:p-4 md:pt-2 md:relative md:z-10 bg-base-100',
  );

  /** The person context rail (§5) shows only for a real selection on desktop. */
  protected showPersonRail = computed(() => !!this.selectedEmail() && !this.isComposing() && !this.isBodyExpanded());

  constructor() {
    effect(() => {
      const id = this.email();
      if (id) {
        void untracked(() => this.loadEmailData(id));
      }
    });
  }

  /** Router query-param input (`?email=<id>`); name matches the binding, no alias. */
  readonly email = input<string | undefined>(undefined);

  private async loadEmailData(emailId: string): Promise<void> {
    try {
      // 1. Fetch the email header/details from backend to know its folder_id
      const res = await this.emailSvc.getEmailHeader(emailId);
      if (res && res.email) {
        const folderId = res.email.folder_id;

        // 2. Ensure folders list is loaded
        let folders = this.store.allFolders();
        if (!folders || folders.length === 0) {
          folders = await this.store.loadAllFoldersWithCounts();
        }

        // 3. Find the folder
        const folder = folders.find((f) => String(f.id) === String(folderId));
        if (folder) {
          const emailObj: EmailType = {
            id: String(res.email.id),
            folder_id: String(res.email.folder_id),
            updated_at: new Date(res.email.updated_at),
            date_sent: res.email.date_sent ? new Date(res.email.date_sent) : undefined,
            is_favourite: !!res.email.is_favourite,
            attachment_count: res.email.attachment_count ?? 0,
            status: res.email.status || 'open',
            from_email: res.email.from_email ?? undefined,
            to_email: res.email.to_email ?? undefined,
            subject: res.email.subject ?? undefined,
            preview: res.email.preview ?? undefined,
            preview_text: res.email.preview_text ?? undefined,
            assigned_to: res.email.assigned_to ?? undefined,
            has_attachment: !!res.email.has_attachment,
            is_read: !!(res.email as any).is_read,
          };

          // Add to store's normalized map so it is available immediately
          this.stateStore.replaceEmail(emailObj.id, emailObj);

          // Select the folder and email
          this.store.selectFolder(folder);
          this.store.selectEmail(emailObj);
        }
      }
    } catch (err) {
      console.error('Failed to pre-select email from notification link', err);
    }
  }

  public readonly emails = this.store.emailsInSelectedFolder;

  public readonly isBodyExpanded = this.store.isBodyExpanded;

  public readonly selectedEmail = this.store.currentSelectedEmail;

  public readonly selectedFolderId = this.store.currentSelectedFolderId;

  public closeCompose() {
    this.isComposing.set(false);
    this.draftIdToLoad.set(null);
    this.composePrefill.set(null);
  }

  public newEmail() {
    this.openCompose();
  }

  public async onEmail(email: EmailType | null): Promise<void> {
    const folderId = this.store.currentSelectedFolderId();
    if (this.isComposing()) {
      try {
        const c = this.composer();
        if (c?.form().dirty()) {
          await c.saveDraft();
        }
      } catch (e) {
        console.error('Failed to save draft', e);
        this.alertSvc.showError('Failed to save your draft. Please check your connection or copy your work.');
        // Abort the function here.
        // Do not close the composer or navigate to the new email.
        return;
      }
      this.closeCompose();
    }

    // Always update the store selection so the list can reflect it
    this.store.selectEmail(email);
    this.mobileView.set('detail');

    // In the drafts folder, also open the composer for the selected draft
    if (folderId === ALL_FOLDERS.DRAFTS && email) {
      this.draftIdToLoad.set(String(email.id));
      this.isComposing.set(true);
    }
  }

  public onFolder(folder: EmailFolderType): void {
    this.store.selectFolder(folder);
    this.mobileView.set('list');
  }

  public mobileGoBack(): void {
    if (this.isComposing()) {
      this.closeCompose();
    }
    if (this.mobileView() === 'detail') {
      this.mobileView.set('list');
    } else if (this.mobileView() === 'list') {
      this.mobileView.set('folders');
    }
  }

  public onForward(email: EmailType) {
    const subject = email.subject?.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`;
    this.openCompose({ subject });
  }

  public onReply(email: EmailType) {
    const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    this.openCompose({ to: email.from_email || '', subject });
  }

  public async onReplyAll(email: EmailType) {
    const header = this.store.getEmailHeaderById(email.id)();
    const recipients = new Set<string>();

    const currentUser = await this.authService.getCurrentUser();
    const currentUserEmail = currentUser.email.toLowerCase(); // Safe without ?.

    if (email.from_email) recipients.add(email.from_email);

    header?.email?.to_list?.forEach((r: any) => {
      if (r?.email) recipients.add(r.email);
    });
    header?.email?.cc_list?.forEach((r: any) => {
      if (r?.email) recipients.add(r.email);
    });

    const to = Array.from(recipients)
      .filter((e) => e && e.toLowerCase() !== currentUserEmail)
      .join(', ');

    const subject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    this.openCompose({ to, subject });
  }

  public openCompose(prefill?: ComposeInitial | null) {
    this.isBodyExpanded.set(false); // ensure body overlay is closed
    this.draftIdToLoad.set(null);
    this.composePrefill.set(prefill ?? null);
    this.isComposing.set(true);
    this.mobileView.set('detail');
  }

  public toggleExpanded(): void {
    this.store.toggleBodyExpanded();
  }

  protected handleDocumentKeydown(ev: KeyboardEvent): void {
    // Existing behaviour: Escape collapses an expanded body first.
    if (ev.key === 'Escape' && !ev.repeat && this.isBodyExpanded()) {
      this.store.toggleBodyExpanded();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // Stay out of the way while composing, typing into a field, or when a
    // command/ctrl/alt modifier is held (Cmd+K search, the global `g` chord…).
    if (this.isComposing() || this.isTypingTarget(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) {
      return;
    }

    // Shortcuts that work without a selection.
    switch (ev.key) {
      case 'c':
        ev.preventDefault();
        this.openCompose();
        return;
      case 'j':
        ev.preventDefault();
        this.selectRelative(1);
        return;
      case 'k':
        ev.preventDefault();
        this.selectRelative(-1);
        return;
    }

    // Everything below acts on the currently selected email.
    const email = this.selectedEmail();
    if (!email) return;

    switch (ev.key) {
      case 'r':
        ev.preventDefault();
        this.onReply(email);
        return;
      case 'a':
        ev.preventDefault();
        void this.onReplyAll(email);
        return;
      case 'f':
        ev.preventDefault();
        this.onForward(email);
        return;
      case 'e':
        ev.preventDefault();
        void this.store.updateEmailStatus(email.id, 'closed');
        return;
      case 's':
        ev.preventDefault();
        void this.store.toggleEmailFavoriteStatus(email.id, !email.is_favourite);
        return;
      case 'I': // Shift+I — mark as read
        ev.preventDefault();
        void this.store.toggleEmailReadStatus(email.id, true);
        return;
      case 'U': // Shift+U — mark as unread
        ev.preventDefault();
        void this.store.toggleEmailReadStatus(email.id, false);
        return;
      case '#':
        ev.preventDefault();
        void this.store.deleteEmail(email.id);
        return;
      case 'Enter':
      case 'o':
        ev.preventDefault();
        this.toggleExpanded();
        return;
      case 'u':
        ev.preventDefault();
        this.store.selectEmail(null);
        this.mobileView.set('list');
        return;
    }
  }

  /** Move the selection to the next (`delta > 0`) or previous email in the folder. */
  private selectRelative(delta: number): void {
    const list = this.emails();
    if (!list.length) return;
    const current = this.selectedEmail();
    const currentIdx = current ? list.findIndex((e) => String(e.id) === String(current.id)) : -1;
    const nextIdx = currentIdx === -1 ? (delta > 0 ? 0 : list.length - 1) : currentIdx + delta;
    const next = list[nextIdx];
    if (!next) return;
    void this.onEmail(next);
  }

  /** True when the event originates from a field the user is typing into. */
  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return target.getAttribute('role') === 'textbox';
  }
}
