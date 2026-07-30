import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '@icons/icon';

@Component({
  selector: 'pc-grid-header',
  imports: [Icon, RouterLink],
  template: `
    <header class="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <!-- The visible page title is the navbar breadcrumb's first crumb; keep an
             sr-only h1 so the page still has an accessible heading. -->
        <h1 class="sr-only">{{ title() }}</h1>
        <div class="flex items-center gap-1.5">
          @if (countText(); as text) {
            <p class="text-xs tabular-nums text-base-content/60" aria-live="polite">{{ text }}</p>
          }
          @if (hasAbout()) {
            <button
              type="button"
              class="btn btn-circle btn-ghost btn-xs text-base-content/40 hover:text-primary"
              aria-label="About this page"
              [attr.aria-expanded]="descriptionOpen()"
              (click)="toggleDescription()"
            >
              <pc-icon name="information-circle" [size]="4"></pc-icon>
            </button>
          }
        </div>
        @if (descriptionOpen() && hasAbout()) {
          <p class="mt-1 max-w-2xl text-xs leading-relaxed text-base-content/60">
            {{ description() }}
            @if (helpArticle(); as article) {
              <a class="link link-primary whitespace-nowrap" [routerLink]="['/help', article]"> Read the full guide </a>
            }
          </p>
        }
      </div>
      <div class="flex items-center gap-2">
        <ng-content></ng-content>
      </div>
    </header>
  `,
})
export class GridHeaderComponent {
  public readonly title = input.required<string>();
  public readonly description = input<string>('');
  public readonly eyebrow = input<string>('');

  /**
   * Help Center article id for this page. When set, the ⓘ panel ends with a link
   * into `/help/:id` — the door from a section to the guide that explains it, so
   * a first-time user is never left guessing what the page's vocabulary means.
   */
  public readonly helpArticle = input<string>('');

  /** Initial expanded state of the description; the ⓘ button toggles it afterwards. */
  public readonly open = input<boolean>(false);

  /** Total row count for the current query; null while unknown (before the first load). */
  public readonly totalCount = input<number | null>(null);

  /** Whether any user-applied filter is narrowing the results. */
  public readonly filtered = input<boolean>(false);

  /**
   * Optional caller-provided sentence for the unfiltered total, e.g. "5,012 people total"
   * or "1,890 households across 8 wards". When filters are active it is appended after the
   * matched count: "43 match your filters · 5,012 people total".
   */
  public readonly totalSentence = input<string | null>(null);

  private readonly descToggled = signal<boolean | null>(null);
  protected readonly descriptionOpen = computed(() => this.descToggled() ?? this.open());

  /** The ⓘ affordance earns its place if there is either a blurb or a guide behind it. */
  protected readonly hasAbout = computed<boolean>(() => this.description() !== '' || this.helpArticle() !== '');

  private readonly countFormatter = new Intl.NumberFormat();

  protected readonly countText = computed<string | null>(() => {
    const count = this.totalCount();
    const sentence = this.totalSentence();
    if (count !== null && this.filtered()) {
      const matched =
        count === 1 ? '1 matches your filters' : `${this.countFormatter.format(count)} match your filters`;
      return sentence ? `${matched} · ${sentence}` : matched;
    }
    if (sentence) return sentence;
    if (count === null) return null;
    return count === 1 ? '1 total' : `${this.countFormatter.format(count)} total`;
  });

  protected toggleDescription(): void {
    this.descToggled.set(!this.descriptionOpen());
  }
}
