import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { Icon } from '@uxcommon/components/icons/icon';
import type { PcIconNameType } from '@uxcommon/components/icons/icons.index';
import { Swap } from '@uxcommon/components/swap/swap';
import { TimeAgoPipe } from '@uxcommon/pipes/timeago.pipe';

import type { EmailFolderType } from '../../../../../../../../libs/common/src/lib/models';
import { EmailsStore } from '../../services/store/emailstore';

const TRIAGE_COLLAPSED_KEY = 'pc-email-triage-collapsed';

/** Absent/corrupt storage means first use — start collapsed. Only an explicit 'false' expands. */
function readStoredCollapsed(): boolean {
  return localStorage.getItem(TRIAGE_COLLAPSED_KEY) !== 'false';
}

@Component({
  selector: 'pc-email-folder-list',
  imports: [Swap, Icon, TimeAgoPipe],
  host: { class: 'block h-full' },
  templateUrl: 'email-folder-list.html',
})
export class EmailFolderList implements OnInit {
  protected readonly store = inject(EmailsStore);

  protected trackByFolderId = (_: number, f: EmailFolderType) => String(f.id);

  public readonly folderSelected = output<EmailFolderType>();

  public readonly folders = this.store.allFolders;

  /**
   * Triage rail starts collapsed so the list and reading pane get the width; hovering it on lg+
   * still reveals the labels, so nothing is hidden — only quieted. The user's own toggle is
   * remembered per browser and wins from then on.
   */
  public readonly foldersCollapsed = signal(readStoredCollapsed());

  public readonly realFoldersCollapsed = signal(false);

  public readonly newEmail = output<void>();

  // Responsive Tailwind class strings — CSS handles breakpoint, signal handles manual toggle
  protected readonly asideClass = computed(
    () =>
      'bg-base-100 border-r border-base-300 group flex flex-col transition-all duration-50 h-full ' +
      'w-full md:w-12 ' +
      (this.foldersCollapsed() ? 'lg:w-12 lg:hover:w-48' : 'lg:w-48'),
  );

  // Labels: visible on small (< md); hidden on md (collapsed); on lg+ hidden unless hovered or not collapsed
  protected readonly labelClass = computed(
    () => 'block md:hidden lg:group-hover:block' + (this.foldersCollapsed() ? '' : ' lg:block'),
  );

  protected readonly countClass = computed(
    () =>
      'text-xs tabular-nums font-normal block md:hidden lg:group-hover:block' +
      (this.foldersCollapsed() ? '' : ' lg:block'),
  );

  protected readonly sectionHeaderClass = computed(
    () =>
      'px-3 py-1.5 flex items-center justify-between text-[10px] font-bold tracking-wider text-neutral-content uppercase cursor-pointer hover:text-primary select-none flex md:hidden lg:group-hover:flex' +
      (this.foldersCollapsed() ? '' : ' lg:flex'),
  );

  protected readonly buttonLabelClass = computed(
    () => 'inline md:hidden lg:group-hover:inline' + (this.foldersCollapsed() ? '' : ' lg:inline'),
  );

  protected readonly separatorClass = computed(
    () => 'h-px bg-base-300 my-2' + (this.foldersCollapsed() ? ' mx-1' : ' mx-1 lg:mx-3'),
  );

  public emitNewEmail() {
    this.newEmail.emit();
  }

  public getEmailCount(folder: EmailFolderType): number {
    return (folder as any).email_count ?? 0;
  }

  public ngOnInit(): void {
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    try {
      await this.store.loadAllFoldersWithCounts();
    } catch (e) {
      console.error('Failed to load folders with counts', e);
    }
  }

  public selectFolder(folder: EmailFolderType): void {
    this.folderSelected.emit(folder);
  }

  public toggleFolders(): void {
    this.foldersCollapsed.update((v) => !v);
    localStorage.setItem(TRIAGE_COLLAPSED_KEY, String(this.foldersCollapsed()));
  }

  public toggleRealFolders(): void {
    this.realFoldersCollapsed.update((v) => !v);
  }

  protected getIcon(folder: EmailFolderType): PcIconNameType {
    return folder.icon as PcIconNameType;
  }

  protected isSelected(folder: EmailFolderType): boolean {
    return String(folder.id) === String(this.store.currentSelectedFolderId());
  }
}
