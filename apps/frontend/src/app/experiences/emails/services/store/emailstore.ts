import { Service, computed, debounced, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { EmailStatus } from '../../../../../../../../libs/common/src';

import type { EmailFolderType, EmailType } from '../../../../../../../../libs/common/src/lib/models';
import { EmailsService } from '../emails-service';
import { EmailActionsStore } from './email-actions.store';
import { EmailCacheStore } from './email-cache.store';
import { EmailFoldersStore } from './email-folders.store';
import { type EmailId, EmailStateStore } from './email-state.store';

@Service()
export class EmailsStore {
  // ----------------- Lazy per-email fallback -----------------
  //  private readonly _checked = new Set<string>();
  private readonly router = inject(Router);
  private readonly alerts = inject(AlertService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly actions = inject(EmailActionsStore);
  private readonly cache = inject(EmailCacheStore);
  private readonly emailSvc = inject(EmailsService);

  private readonly _isSyncing = signal(false);
  public readonly isSyncing = this._isSyncing.asReadonly();

  /** When the last successful sync completed — powers the "Synced …" evidence line (§2). */
  private readonly _lastSyncedAt = signal<Date | null>(null);
  public readonly lastSyncedAt = this._lastSyncedAt.asReadonly();

  /*
  private readonly ensureHasAttachmentOnOpen = effect(() => {
    const id = this.currentSelectedEmailId();
    if (!id) return;

    // Skip if already known or in-flight
    if (this.state.hasAttachment(id)() !== undefined) return;
    if (this._checked.has(id)) return;
    this._checked.add(id);

    // Ask backend for this one email
    this.emailSvc
      .hasAttachment(id)
      .then((has) => {
        this.state.setHasAttachment(id, !!has);
      })
      .catch(() => {
        // leave as undefined on error; next open can retry
        this._checked.delete(id);
      });
  });
  */
  private readonly folders = inject(EmailFoldersStore);
  private readonly state = inject(EmailStateStore);

  public readonly allFolders = this.folders.allFolders;

  public readonly currentSelectedEmail = this.state.currentSelectedEmail;

  public readonly currentSelectedEmailId = this.state.currentSelectedEmailId;

  public readonly currentSelectedFolderId = this.folders.currentSelectedFolderId;

  public readonly hasMore = this.folders.hasMore;
  public readonly isLoadingMore = this.folders.isLoadingMore;

  public readonly emailsInSelectedFolder = computed(() => {
    const fid = this.folders.currentSelectedFolderId();
    if (!fid) return [] as EmailType[];
    return this.state.emailsInFolderWithFlags(fid)();
  });
  public readonly emailsLoading = this.folders.isLoading;
  public readonly emailsFetching = this.folders.isFetching;

  // ----------------- Cache computed factories -----------------
  public readonly getEmailBodyById = this.cache.getEmailBodyById;
  public readonly getEmailHeaderById = this.cache.getEmailHeaderById;
  public readonly getEmailActivitiesById = this.cache.getEmailActivitiesById;

  public readonly isBodyExpanded = this.state.isBodyExpanded;

  private debouncedSelectedEmailId = debounced(this.state.currentSelectedEmailId, 1000);

  constructor() {
    effect(() => {
      // The effect tracks this because it's OUTSIDE untracked()
      const targetId = this.debouncedSelectedEmailId.value();

      if (targetId) {
        // Run the email lookup and update INSIDE untracked()
        // Now, if the user manually changes 'is_read' to false, this effect will NOT re-run.
        untracked(() => {
          const emailObj = this.state.readEmail(targetId);

          if (emailObj && !emailObj.is_read) {
            void this.actions.toggleEmailReadStatus(targetId, true);
          }
        });
      }
    });
  }

  // ----------------- Mutations (actions) -----------------
  public addComment(emailId: EmailId, authorId: string, commentText: string) {
    return this.actions.addComment(emailId, authorId, commentText);
  }

  public assignEmailToUser(emailId: EmailId, userId: string | null, assigneeName?: string | null) {
    return this.actions.assignEmailToUser(emailId, userId, assigneeName);
  }

  public deleteComment(emailId: EmailId, commentId: string | number) {
    return this.actions.deleteComment(emailId, commentId);
  }

  public deleteEmail(emailId: EmailId) {
    return this.actions.deleteEmail(emailId);
  }

  // ----------------- Loads -----------------
  public loadAllFolders() {
    return this.folders.loadAllFolders();
  }

  public loadAllFoldersWithCounts() {
    return this.folders.loadAllFoldersWithCounts();
  }

  public loadEmailBody(emailId: EmailId) {
    return this.cache.loadEmailBody(emailId);
  }

  public loadEmailWithHeaders(emailId: EmailId) {
    return this.cache.loadEmailWithHeaders(emailId);
  }

  public refreshEmailHeader(emailId: EmailId) {
    return this.cache.refreshEmailHeader(emailId);
  }

  public loadEmailActivities(emailId: EmailId) {
    return this.cache.loadEmailActivities(emailId);
  }

  public async loadEmailsForFolder(folderId: EmailId) {
    const rows = await this.folders.loadEmailsForFolder(String(folderId));

    // Prefer IDs from the response; fallback to state if needed
    const ids =
      (Array.isArray(rows) ? rows.map((e: any) => String(e.id)) : []) ||
      this.state.emailIdsByFolderId()[String(folderId)] ||
      [];

    if (!ids.length) return rows;

    try {
      const partial: Partial<Record<string, boolean>> = await this.emailSvc.hasAttachmentByEmailIds(ids as string[]);

      const merged: Record<string, boolean> = {};
      for (const id of ids) {
        const key = String(id); // <- normalize the key
        merged[key] = !!partial[key];
      }
      this.state.setManyHasAttachment(merged);
    } catch {
      // ignore failures; UI can lazily resolve per-email elsewhere
    }

    return rows;
  }

  public refreshFolderCounts() {
    return this.folders.refreshFolderCounts();
  }

  public restoreFromTrash(emailId: EmailId) {
    return this.actions.restoreFromTrash(emailId);
  }

  public selectEmail(email: EmailType | { id: EmailId } | null): void {
    this.state.selectEmail(email);
  }

  public selectFolder(folder: EmailFolderType | null): void {
    this.folders.selectFolder(folder);
  }

  public toggleBodyExpanded(): void {
    this.state.toggleBodyExpanded();
  }

  public toggleEmailFavoriteStatus(emailId: EmailId, isFavorite: boolean) {
    return this.actions.toggleEmailFavoriteStatus(emailId, isFavorite);
  }

  public toggleEmailReadStatus(emailId: EmailId, isRead: boolean) {
    return this.actions.toggleEmailReadStatus(emailId, isRead);
  }

  public moveToFolder(emailId: EmailId, folderId: string) {
    return this.actions.moveToFolder(emailId, folderId);
  }

  public loadNextPage() {
    return this.folders.loadNextPage();
  }

  public updateEmailStatus(emailId: EmailId, status: EmailStatus) {
    return this.actions.updateEmailStatus(emailId, status);
  }

  // ----------------- Syncing -----------------
  public async syncEmails() {
    this._isSyncing.set(true);
    try {
      const result = await this.emailSvc.syncEmails();

      // Poll status every 3 seconds for up to 5 minutes (100 attempts)
      let attempts = 0;
      while (attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const active = await this.emailSvc.isAnySyncing();
        if (!active) {
          break;
        }
        attempts++;
      }

      // Reload current folder emails and counts
      const currentFolderId = this.currentSelectedFolderId();
      if (currentFolderId) {
        await this.loadEmailsForFolder(currentFolderId);
      }
      await this.refreshFolderCounts();
      const inserted = result?.inserted ?? 0;
      const failedProviders = result?.failedProviders ?? [];
      if (failedProviders.length > 0) {
        // A provider that was connected failed to sync — never show the success toast for
        // that (this store used to say "Inbox synced. No new emails" over a failed sync).
        this.alerts.showError(
          `${failedProviders.join(' and ')} sync failed. ` +
            (result?.needsReconnect ? 'Reconnect the account under Settings → Email sync.' : 'Please try again.'),
        );
      } else {
        this._lastSyncedAt.set(new Date());
        this.alerts.showSuccess(
          inserted > 0
            ? `Inbox synced. ${inserted} new ${inserted === 1 ? 'email' : 'emails'}`
            : 'Inbox synced. No new emails',
        );
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only the client-side "nothing connected" error is matched by message — it is thrown
      // locally by emails-service, so it survives verbatim. The backend-message matches that
      // used to sit here ('No Microsoft account connected', 'Token refresh failed', …) were
      // dead in production, where those messages are replaced by a generic string; provider
      // failures now come back as `failedProviders` above, not as exceptions.
      if (msg.includes('No email accounts connected')) {
        const confirmed = await this.dialogs.confirm({
          title: 'Email Account Connection Required',
          message:
            'No email account is connected. Would you like to connect a Microsoft or Google account now in Settings?',
          variant: 'info',
          confirmText: 'Go to Settings',
          cancelText: 'Cancel',
        });
        if (confirmed) {
          // The section is a route segment, not a query param — `?tab=email-sync` was read by
          // nothing, so "Go to Settings" landed on Organization instead of the page that
          // connects a mailbox. Bare /workspace is now the section index, which would be an
          // even less useful place to drop someone who just asked to connect an account.
          void this.router.navigate(['/workspace', 'email-sync']);
        }
      } else {
        this.alerts.showError(getUserErrorMessage(e, 'Sync failed. Please try again.'));
      }
      throw e;
    } finally {
      this._isSyncing.set(false);
    }
  }
}
