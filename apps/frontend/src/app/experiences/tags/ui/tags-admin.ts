import { Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { RowActions } from '@uxcommon/components/row-actions/row-actions';
import { Table } from '@uxcommon/components/table/table';
import { TagItem } from '@uxcommon/components/tags/tagitem';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { TagsService } from '@experiences/tags/services/tags-service';
import { AddTagDialog } from './add-tag';
import { TagAdminActions, type TagAdminRow } from './tag-admin-actions';
import { TagsIssuesNav } from './tags-issues-nav';

const UNUSED_DAYS = 90;
const UNUSED_MS = UNUSED_DAYS * 24 * 60 * 60 * 1000;

/**
 * §9.1 Tags admin (spec Fig. 10). Not `pc-datagrid` — the sentence, unused-tags callout, and
 * rename/merge/delete idiom don't fit the grid's generic column model — but rendered through the
 * shared `pc-table` shell so it stays visually identical to the datagrid (see `pplcrm-table`).
 * Reuses `TagAdminActions` (rename/merge/delete) so Issues admin (`issues-admin.ts`) can't drift.
 */
@Component({
  selector: 'pc-tags-admin',
  imports: [Icon, RouterLink, TagItem, AddTagDialog, Table, RowActions, GridHeaderComponent, TagsIssuesNav],
  templateUrl: './tags-admin.html',
})
export class TagsAdmin implements OnInit {
  private readonly tagsSvc = inject(TagsService);
  private readonly alertSvc = inject(AlertService);
  protected readonly actions = inject(TagAdminActions);

  protected readonly addDialog = viewChild.required(AddTagDialog);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly loaded = this._loading.loaded;

  protected readonly rows = signal<TagAdminRow[]>([]);
  protected readonly showUnusedOnly = signal(false);

  protected readonly unusedRows = computed(() => this.rows().filter((r) => this.isUnused(r)));

  protected readonly visibleRows = computed(() => (this.showUnusedOnly() ? this.unusedRows() : this.rows()));

  protected readonly totalApplications = computed(() =>
    this.rows().reduce((sum, r) => sum + r.use_count_people + r.use_count_households, 0),
  );

  protected readonly sentence = computed(() => {
    const tagCount = this.rows().length;
    const unusedCount = this.unusedRows().length;
    const parts = [
      `${tagCount.toLocaleString()} tag${tagCount === 1 ? '' : 's'}`,
      `${this.totalApplications().toLocaleString()} application${this.totalApplications() === 1 ? '' : 's'}`,
    ];
    if (unusedCount > 0) {
      parts.push(`${unusedCount} unused in ${UNUSED_DAYS} days`);
    }
    return parts.join(' · ');
  });

  protected readonly calloutNames = computed(() =>
    this.unusedRows()
      .slice(0, 2)
      .map((r) => `"${r.name}"`)
      .join(' and '),
  );

  public ngOnInit(): void {
    void this.load();
  }

  protected openAddDialog(): void {
    this.addDialog().open();
  }

  protected onTagSaved(): void {
    void this.load();
  }

  protected isUnused(row: TagAdminRow): boolean {
    if (!row.last_applied_at) return true;
    return Date.now() - new Date(row.last_applied_at).getTime() > UNUSED_MS;
  }

  protected relativeLastApplied(row: TagAdminRow): string {
    if (!row.last_applied_at) return 'Never';
    const ms = Date.now() - new Date(row.last_applied_at).getTime();
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }

  protected async rename(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const updated = await this.actions.rename(row, 'tag');
    if (updated) this.rows.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, name: updated.name } : r)));
  }

  protected async merge(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const others = this.rows().filter((r) => r.id !== row.id);
    const target = await this.actions.merge(row, others, 'tag');
    if (target) await this.load();
  }

  protected async delete(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const deleted = await this.actions.delete(row, 'tag');
    if (deleted) this.rows.update((rows) => rows.filter((r) => r.id !== row.id));
  }

  /** DaisyUI's CSS-only dropdown opens/closes on focus — blur the trigger so it closes before
   * the confirm/prompt dialog opens (otherwise both float over each other). */
  private blurActiveElement(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.rows.set(await this.tagsSvc.getAdminList('tag'));
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : "Couldn't load tags.");
    } finally {
      end();
    }
  }
}
