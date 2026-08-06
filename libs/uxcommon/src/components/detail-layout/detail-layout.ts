import { Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import type { loadingGate } from '../../loading-gate';
import { PcBreadcrumb } from '../breadcrumbs/breadcrumbs';
import { DetailHeader } from '../detail-header/detail-header';

/**
 * Outer frame for every record view. It owns the page chrome AND the whole
 * loading/error/not-found decision — a page passes the record and its loading gate,
 * never a hand-derived boolean.
 *
 * Body states, in the order they are evaluated:
 *
 * | Situation                                   | What the body shows            |
 * | ------------------------------------------- | ------------------------------ |
 * | first load, past the delay                  | skeleton, held to the gate min |
 * | the load failed                             | error alert                    |
 * | first load, still under the gate's delay    | nothing (page chrome only)     |
 * | load finished and returned nothing          | "not found" alert              |
 * | refetch/next record with a record on screen | that record, dimmed            |
 * | otherwise                                   | the projected body             |
 *
 * The timings come from `createLoadingGate` (300ms before an indicator appears, held
 * 300ms once shown) and are deliberately NOT re-derived here. Industry practice: under
 * ~300ms show no indicator at all (GitHub Primer, NN/g both put the "show nothing"
 * ceiling at ~1s; Vue's async-component default delay is 200ms), and for a whole content
 * area the indicator is a skeleton rather than a spinner.
 *
 * Keeping the previous record on screen while the next one loads (rather than blanking to
 * a skeleton) matches React's transition behaviour and TanStack Query's
 * `keepPreviousData`, both of which hold stale content and dim it instead of unmounting it.
 */
@Component({
  selector: 'pc-detail-layout',
  imports: [Icon, DetailHeader],
  host: {
    '(document:keydown)': 'handleKeydown($event)',
  },
  template: `
    <div class="flex min-h-full flex-col bg-base-200/50 p-6">
      <div class="flex w-full max-w-7xl flex-col gap-6">
        <!-- Header -->
        <pc-detail-header
          [title]="title()"
          [subtitle]="subtitle()"
          [crumbs]="crumbs()"
          [eyebrow]="eyebrow()"
          [statusChip]="statusChip()"
          [icon]="icon()"
          [iconSize]="iconSize()"
          [avatarText]="avatarText()"
          [isLoading]="busy()"
          [disabled]="disabled()"
          [showActions]="showActions()"
          [showDelete]="showDelete()"
          [showCancel]="showCancel()"
          [deleteText]="deleteText()"
          [btn1Text]="btn1Text()"
          [btn1Icon]="btn1Icon()"
          [positionLabel]="positionLabel()"
          [hasPrev]="hasPrev()"
          [hasNext]="hasNext()"
          [prevLabel]="prevLabel()"
          [nextLabel]="nextLabel()"
          (save)="save.emit($event)"
          (delete)="delete.emit()"
          (prevRecord)="prevRecord.emit()"
          (nextRecord)="nextRecord.emit()"
        >
          <ng-content select="[pc-title-suffix]" pc-title-suffix></ng-content>
          <ng-content select="[pc-actions-prefix]" pc-actions-prefix></ng-content>
          <ng-content select="[pc-actions-suffix]" pc-actions-suffix></ng-content>
          <ng-content select="[pc-overflow-extra]" pc-overflow-extra></ng-content>
        </pc-detail-header>

        <!-- Body/Content Area -->
        @if (showSkeleton()) {
          <!-- First load past the gate's delay. Mirrors the shared record-page body:
               a two-column main area beside a one-column sidebar. -->
          <div role="status" class="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <span class="sr-only">Loading</span>
            <div class="flex flex-col gap-6 lg:col-span-2" aria-hidden="true">
              <div class="skeleton h-44 w-full"></div>
              <div class="skeleton h-64 w-full"></div>
            </div>
            <div class="flex flex-col gap-6" aria-hidden="true">
              <div class="skeleton h-72 w-full"></div>
              <div class="skeleton h-40 w-full"></div>
            </div>
          </div>
        } @else if (error()) {
          <div class="alert alert-error shadow-md border-error/20 flex items-center gap-3">
            <pc-icon name="exclamation-triangle" [size]="6"></pc-icon>
            <span>{{ error() }}</span>
          </div>
        } @else if (!settled()) {
          <!-- First load inside the gate's delay: show nothing rather than an indicator
               that would be replaced before it can be read. -->
        } @else if (!hasRecord()) {
          <div class="alert alert-error shadow-md border-error/20 flex items-center gap-3">
            <pc-icon name="exclamation-triangle" [size]="6"></pc-icon>
            <span>{{ notFoundText() }}</span>
          </div>
        } @else {
          <!-- Main Content Slot. Dimmed while a refetch is in flight so the record on
               screen is visibly stale rather than silently so. -->
          <div class="flex flex-col gap-6 transition-opacity duration-200" [class.opacity-60]="busy()">
            <ng-content></ng-content>
          </div>
        }
      </div>
    </div>
  `,
})
export class DetailLayout {
  public title = input.required<string>();
  public subtitle = input<string | null | undefined>();
  public crumbs = input<PcBreadcrumb[]>([]);
  public eyebrow = input<string>('');
  /** Optional success-tinted status chip beside the title (§3). */
  public statusChip = input<string | null>(null);
  public icon = input<PcIconNameType | null | undefined>();
  public iconSize = input<number>(6);
  /** Optional initials for a circular avatar left of the title (forwarded to the header). */
  public avatarText = input<string | null>(null);
  /**
   * The page's `createLoadingGate()`. The layout reads the gate directly — pass the gate
   * itself, never `gate.visible()` or an expression like `visible() && !record()`. That
   * expression cancels the gate's minimum-display timer and reintroduces the flash the
   * timer exists to prevent.
   */
  public gate = input.required<loadingGate>();
  public error = input<string | null | undefined>();
  /** Strictly "is a record on screen right now" — no loading state mixed in. */
  public hasRecord = input<boolean>(true);
  public notFoundText = input<string>('Record not found or failed to load.');

  public showActions = input<boolean>(true);
  public showDelete = input<boolean>(false);
  /** A read/detail view has no edit to cancel — the header action is a navigation
   * "Edit". Off by default; edit forms use pc-detail-header directly and keep it. */
  public showCancel = input<boolean>(false);
  public deleteText = input<string>('Delete');
  public btn1Text = input<string>('Edit');
  public btn1Icon = input<PcIconNameType>('pencil-square');
  public disabled = input<boolean>(false);

  /** Optional "N of M filtered" pager; also drives J/K keyboard navigation while this page is open. */
  public positionLabel = input<string | null>(null);
  public hasPrev = input<boolean>(false);
  public hasNext = input<boolean>(false);
  public prevLabel = input<string>('Previous record');
  public nextLabel = input<string>('Next record');

  public readonly save = output<any>();
  public readonly delete = output<void>();
  public readonly prevRecord = output<void>();
  public readonly nextRecord = output<void>();

  /** Delayed + minimum-held indicator flag straight from the gate. */
  protected readonly busy = computed(() => this.gate().visible());
  /** True once a load has completed at least once, ungated by any timer. */
  protected readonly settled = computed(() => this.gate().loaded());

  /**
   * Latched when the indicator turns on with nothing on screen to keep. It stays latched
   * for as long as the gate holds the indicator, so a record arriving mid-hold does not
   * swap the skeleton out after a few frames — that swap IS the flash.
   */
  private readonly skeletonLatch = signal(false);
  protected readonly showSkeleton = computed(() => this.skeletonLatch());

  constructor() {
    effect(() => {
      const busy = this.busy();
      // hasRecord is read untracked: only a change in `busy` may arm or clear the latch.
      if (!busy) this.skeletonLatch.set(false);
      else if (!untracked(() => this.hasRecord())) this.skeletonLatch.set(true);
    });
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (!this.positionLabel()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === 'j' && this.hasNext()) {
      event.preventDefault();
      this.nextRecord.emit();
    } else if (key === 'k' && this.hasPrev()) {
      event.preventDefault();
      this.prevRecord.emit();
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}
