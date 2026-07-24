import { afterNextRender, Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';

import {
  articlesInCategory,
  getHelpArticle,
  getHelpCategory,
  HELP_CATEGORIES,
  POPULAR_ARTICLE_IDS,
  readingMinutes,
  searchHelp,
} from '@common';

import { BugReportDialogService } from '../../../services/bug-report-dialog.service';

import type { ElementRef } from '@angular/core';
import type { HelpArticle, HelpCategory, HelpCategoryId } from '@common';
import type { PcIconNameType } from '@icons/icons.index';

interface HelpCategorySection {
  articles: HelpArticle[];
  category: HelpCategory;
  icon: PcIconNameType;
}

/**
 * Maps each help category to this app's icon. `HelpCategory.icon` is a plain
 * Heroicon name in the shared lib (no `@icons` dependency there); the frontend
 * resolves it to a typed `PcIconNameType` here, keeping the template type-safe.
 */
const HELP_CATEGORY_ICONS: Record<HelpCategoryId, PcIconNameType> = {
  'getting-started': 'map',
  contacts: 'identification',
  grids: 'table-cells',
  segmentation: 'label',
  outreach: 'megaphone',
  engagement: 'currency-dollar',
  productivity: 'task',
  data: 'arrow-up-tray',
  admin: 'cog-6-tooth',
};

/** Help center landing page: search across all articles, or browse by topic. */
@Component({
  selector: 'pc-help-home',
  imports: [Icon, RouterLink],
  templateUrl: './help-home.html',
})
export class HelpHomePage {
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private readonly bugReportDialog = inject(BugReportDialogService);

  protected readonly query = signal('');
  protected readonly searching = computed(() => this.query().trim().length > 0);
  protected readonly results = computed(() => searchHelp(this.query()));

  protected readonly sections: HelpCategorySection[] = HELP_CATEGORIES.map((category) => ({
    articles: articlesInCategory(category.id),
    category,
    icon: HELP_CATEGORY_ICONS[category.id],
  }));

  protected readonly popular: HelpArticle[] = POPULAR_ARTICLE_IDS.map(getHelpArticle).filter(
    (a): a is HelpArticle => a !== undefined,
  );

  constructor() {
    afterNextRender(() => this.searchBox()?.nativeElement.focus());
  }

  protected categoryLabel(article: HelpArticle): string {
    return getHelpCategory(article.category)?.label ?? '';
  }

  protected clearSearch(): void {
    this.query.set('');
    this.searchBox()?.nativeElement.focus();
  }

  protected minutes(article: HelpArticle): number {
    return readingMinutes(article);
  }

  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected openBugReport(): void {
    this.bugReportDialog.open();
  }
}
