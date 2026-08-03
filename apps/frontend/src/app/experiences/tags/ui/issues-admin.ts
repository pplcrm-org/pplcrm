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
import { CampaignContextService } from '../../../services/campaign-context.service';
import { AddIssueDialog } from './add-issue';
import { TagAdminActions, type TagAdminRow } from './tag-admin-actions';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { TagsIssuesNav } from './tags-issues-nav';

/**
 * §9.2 Issues admin (spec Fig. 11). Ranked table with a proportional interest bar and a trend
 * column. Issues are the same `tags` table as §9.1 with `type: 'issue'` — but the two stay
 * conceptually separate everywhere (see `pplcrm-design-principles` §5) because issues power
 * issue-based filtering/targeting, tags power general categorization. Never merge the two
 * concepts even though the plumbing is shared. Each row's chip uses its own `color`.
 *
 * The two pages share one "Tags & issues" sidebar entry and a `pc-tags-issues-nav` tab row:
 * that is navigation grouping only. The lists, routes, dialogs and vocabularies stay separate.
 */
@Component({
  selector: 'pc-issues-admin',
  imports: [
    EmptyState,
    Icon,
    RouterLink,
    TagItem,
    AddIssueDialog,
    Table,
    RowActions,
    GridHeaderComponent,
    TagsIssuesNav,
  ],
  templateUrl: './issues-admin.html',
})
export class IssuesAdmin implements OnInit {
  private readonly tagsSvc = inject(TagsService);
  private readonly alertSvc = inject(AlertService);
  private readonly campaignCtx = inject(CampaignContextService);
  protected readonly actions = inject(TagAdminActions);

  protected readonly addDialog = viewChild.required(AddIssueDialog);

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly loaded = this._loading.loaded;

  protected readonly rows = signal<TagAdminRow[]>([]);
  protected readonly peopleSharedCount = signal(0);

  /** Ranked by PEOPLE INTERESTED, descending — `getAdminList` already returns this order. */
  protected readonly ranked = computed(() => this.rows().map((row, i) => ({ rank: i + 1, row })));

  protected readonly maxInterested = computed(() => Math.max(1, ...this.rows().map((r) => r.use_count_people)));

  protected readonly sentence = computed(() => {
    const issueCount = this.rows().length;
    return (
      `${issueCount.toLocaleString()} issue${issueCount === 1 ? '' : 's'} · ` +
      `${this.peopleSharedCount().toLocaleString()} people shared what they care about, from forms, surveys and profile edits.`
    );
  });

  /**
   * Heading for the column showing where an issue is most concentrated, in the active campaign's
   * own word: "Top ward" for a municipal race, "Top riding" for a Canadian federal one, "Top
   * congressional district" for a US one. seatLabel() always resolves — "District" via the
   * 'other' jurisdiction spec when the campaign declares none — so there is no local fallback.
   *
   * The row property behind the column is still `top_ward`; that is a wire name, and only the words
   * a person reads have to follow the campaign.
   */
  protected readonly topAreaHeading = computed<string>(() => `Top ${this.campaignCtx.seatLabel().toLowerCase()}`);

  public ngOnInit(): void {
    void this.campaignCtx.ensureLoaded();
    void this.load();
  }

  protected openAddDialog(): void {
    this.addDialog().open();
  }

  protected onIssueSaved(): void {
    void this.load();
  }

  protected interestedPercent(row: TagAdminRow): number {
    return Math.round((row.use_count_people / this.maxInterested()) * 100);
  }

  protected trendLabel(row: TagAdminRow): string {
    const n = row.recent_applications_30d;
    return n > 0 ? `+${n} this month` : 'No new activity this month';
  }

  protected async rename(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const updated = await this.actions.rename(row, 'issue');
    if (updated) this.rows.update((rows) => rows.map((r) => (r.id === row.id ? { ...r, name: updated.name } : r)));
  }

  protected async merge(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const others = this.rows().filter((r) => r.id !== row.id);
    const target = await this.actions.merge(row, others, 'issue');
    if (target) await this.load();
  }

  protected async delete(row: TagAdminRow): Promise<void> {
    this.blurActiveElement();
    const deleted = await this.actions.delete(row, 'issue');
    if (deleted) this.rows.update((rows) => rows.filter((r) => r.id !== row.id));
  }

  private blurActiveElement(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      const [rows, peopleSharedCount] = await Promise.all([
        this.tagsSvc.getAdminList('issue', this.campaignCtx.activeCampaignId()),
        this.tagsSvc.countDistinctPeople('issue'),
      ]);
      this.rows.set(rows);
      this.peopleSharedCount.set(peopleSharedCount);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : "Couldn't load issues.");
    } finally {
      end();
    }
  }
}
