import { computed, inject, signal, Service } from '@angular/core';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { EmailsService } from '../emails-service';
import { EmailStateStore } from './email-state.store';
import { ServerEmail, SPECIAL_FOLDERS } from '../../../../../../../../libs/common/src/lib/emails';
import type { EmailFolderType } from '../../../../../../../../libs/common/src/lib/models';

/** Rows fetched when a folder is opened or refreshed — the first page. */
const INITIAL_PAGE_SIZE = 50;
/** Rows fetched per infinite-scroll page as the user nears the bottom. */
const NEXT_PAGE_SIZE = 25;

@Service()
export class EmailFoldersStore {
  private readonly emailFolders = signal<(EmailFolderType & { email_count?: number })[]>([]);
  private readonly state = inject(EmailStateStore);
  private readonly svc = inject(EmailsService);

  private _loading = createLoadingGate();

  public readonly allFolders = computed(() => this.emailFolders());

  /** Live "Mine" triage count — open conversations assigned to the current user. Null until
   *  counts have loaded; recomputes on every refreshFolderCounts (assign/close/delete), which
   *  is what keeps the sidebar Inbox badge in step with reassignments. */
  public readonly assignedOpenCount = computed<number | null>(() => {
    const mine = this.emailFolders().find((f) => f.id === SPECIAL_FOLDERS.ASSIGNED_TO_ME);
    return mine?.email_count ?? null;
  });

  public readonly currentSelectedFolderId = signal<string | null>(null);

  public isLoading = this._loading.visible;

  /** Ungated fetch-in-flight flag — drives skeleton-vs-empty in the email list. */
  public isFetching = this._loading.active;

  public async loadAllFolders(): Promise<EmailFolderType[]> {
    const folders = (await this.svc.getFolders()) as EmailFolderType[];
    this.emailFolders.set(folders);
    return folders;
  }

  public async loadAllFoldersWithCounts(): Promise<(EmailFolderType & { email_count: number })[]> {
    const folders = (await this.svc.getFoldersWithCounts()) as (EmailFolderType & { email_count: number })[];
    this.emailFolders.set(folders);

    // Auto-select default folder if none chosen yet
    if (!this.currentSelectedFolderId() && folders.length > 0) {
      const def = folders.find((f) => f.is_default);
      if (def) this.selectFolder(def);
    }
    return folders;
  }

  public hasMore = signal<boolean>(true);

  private readonly _loadingMore = createLoadingGate();

  /**
   * Synchronous re-entrancy guard for {@link loadNextPage}. The gate's `visible`
   * signal is deliberately flicker-delayed (~300ms), so it cannot double as an
   * in-flight check — a fast second scroll event would slip past it.
   */
  private loadingMoreInFlight = false;

  /** Spinner for the load-more row — gated, so sub-300ms pages never flicker it. */
  public readonly isLoadingMore = this._loadingMore.visible;

  public async loadEmailsForFolder(folderId: string): Promise<void> {
    const end = this._loading.begin();
    if (folderId === this.currentSelectedFolderId()) {
      this.hasMore.set(true);
    }
    try {
      const raw = await this.svc.getEmails(folderId, INITIAL_PAGE_SIZE, 0);

      const emailsFromServer: ServerEmail[] = raw.map(normalizeServerEmailRow);

      this.state.setEmailsForFolder(folderId, emailsFromServer, false);
      if (folderId === this.currentSelectedFolderId()) {
        this.hasMore.set(emailsFromServer.length >= INITIAL_PAGE_SIZE);
      }
    } finally {
      end();
    }
  }

  public async loadNextPage(): Promise<void> {
    const folderId = this.currentSelectedFolderId();
    if (!folderId || this.loadingMoreInFlight || !this.hasMore()) return;

    this.loadingMoreInFlight = true;
    const end = this._loadingMore.begin();
    try {
      // Offset = rows already loaded for this folder, so pages append seamlessly.
      const currentIds = this.state.emailIdsByFolderId()[folderId] ?? [];
      const offset = currentIds.length;
      const raw = await this.svc.getEmails(folderId, NEXT_PAGE_SIZE, offset);
      const emailsFromServer: ServerEmail[] = raw.map(normalizeServerEmailRow);

      // Ignore late results if the user switched folders while we were fetching.
      if (folderId === this.currentSelectedFolderId()) {
        this.state.setEmailsForFolder(folderId, emailsFromServer, true);
        if (emailsFromServer.length < NEXT_PAGE_SIZE) {
          // End of the folder — go quiet: no spinner, no banner, scrolling just stops loading.
          this.hasMore.set(false);
        }
      }
    } catch (e) {
      console.error('Failed to load next page of emails', e);
    } finally {
      end();
      this.loadingMoreInFlight = false;
    }
  }

  public async refreshFolderCounts(): Promise<void> {
    await this.loadAllFoldersWithCounts();
  }

  public selectFolder(folder: EmailFolderType | null): void {
    const id = folder ? String(folder.id) : null;
    this.currentSelectedFolderId.set(id);
    this.state.activeFolderId.set(id);
    if (id) void this.loadEmailsForFolder(id);
  }
}

type SqlBool = boolean | 0 | 1 | '0' | '1' | 't' | 'f' | 'true' | 'false' | null | undefined;

function normalizeServerEmailRow(r: any): ServerEmail {
  // prefer explicit flag; otherwise derive from count
  const hasFlag = toBool(r.has_attachment);
  const countNum = toNum(r.attachment_count ?? r.att_count);

  return {
    id: String(r.id),
    folder_id: String(r.folder_id),
    updated_at: r.updated_at, // OK if string or Date per your type
    date_sent: r.date_sent ? new Date(r.date_sent) : null,
    is_favourite: !!r.is_favourite,
    status: r.status ?? undefined,
    from_email: r.from_email ?? null,
    to_email: r.to_email ?? null,
    subject: r.subject ?? null,
    preview: r.preview ?? null,
    preview_text: r.preview_text ?? null,
    assigned_to: r.assigned_to ?? null,

    has_attachment: hasFlag ?? (countNum !== undefined ? countNum > 0 : undefined),
    attachment_count: typeof r.attachment_count === 'boolean' ? undefined : countNum,
    is_read: toBool(r.is_read) ?? false,
    sender_first_name: r.sender_first_name ?? null,
    sender_last_name: r.sender_last_name ?? null,
  };
}

function toBool(v: SqlBool): boolean | undefined {
  if (v === true || v === 1 || v === '1' || v === 't' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'f' || v === 'false') return false;
  return undefined;
}

function toNum(n: unknown): number | undefined {
  if (n == null) return undefined;
  if (typeof n === 'bigint') return Number(n);
  if (typeof n === 'string') return Number(n) || 0;
  if (typeof n === 'number') return n;
  return undefined;
}
