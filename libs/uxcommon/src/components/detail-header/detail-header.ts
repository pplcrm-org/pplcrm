import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

import { PcBreadcrumb } from '../breadcrumbs/breadcrumbs';
import { BreadcrumbsService } from '../breadcrumbs/breadcrumbs.service';
import { FormActions } from '../form-actions/form-actions';

/** Below Tailwind `sm` (640px) the header stacks and has no room for inline action buttons. */
const MOBILE_ACTIONS_QUERY = '(max-width: 639.98px)';

@Component({
  selector: 'pc-detail-header',
  imports: [Icon, FormActions, NgTemplateOutlet],
  template: `
    <div class="flex flex-col gap-2 rounded-xl border border-base-200 bg-base-100 p-5 shadow-sm">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-center gap-3">
          @if (avatarText()) {
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
              aria-hidden="true"
              >{{ avatarText() }}</span
            >
          } @else if (icon()) {
            <pc-icon [name]="icon()!" class="text-primary" [size]="iconSize()"></pc-icon>
          }
          <div class="min-w-0">
            @if (eyebrow()) {
              <p class="pc-eyebrow">{{ eyebrow() }}</p>
            }
            <div class="flex min-w-0 items-center gap-2">
              <h1 class="truncate text-xl font-bold">{{ title() }}</h1>
              @if (statusChip()) {
                <span
                  class="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success whitespace-nowrap"
                  >{{ statusChip() }}</span
                >
              }
              <!-- Tone-colored badges the fixed success statusChip can't express (e.g. pc-status-badge) -->
              <ng-content select="[pc-title-suffix]"></ng-content>
            </div>
            @if (dirtyFieldCount() > 0) {
              <p class="mt-0.5 flex items-center gap-1.5 text-sm text-warning">
                <span class="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true"></span>
                Unsaved changes · {{ dirtyFieldCount() }} field{{ dirtyFieldCount() === 1 ? '' : 's' }}
              </p>
            } @else if (subtitle()) {
              <p class="mt-0.5 text-sm text-base-content/60">{{ subtitle() }}</p>
            }
          </div>
        </div>

        <!-- justify-end below sm keeps the ⋮ trigger on the right so its menu opens on-screen -->
        <div class="flex items-center gap-2 max-sm:justify-end">
          <!-- "N of M filtered" walk-the-list pager — lives in the header card (design source),
               so J/K navigation is visible next to the actions. Self-hides with no grid context. -->
          @if (positionLabel()) {
            <div class="mr-1 flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                class="btn btn-circle btn-ghost btn-xs"
                [attr.aria-label]="prevLabel()"
                [disabled]="!hasPrev()"
                [class.btn-ghost]="!hasPrev()"
                (click)="prevRecord.emit()"
              >
                <pc-icon name="chevron-left" [size]="4"></pc-icon>
              </button>
              <span class="whitespace-nowrap px-1 text-xs tabular-nums text-base-content/50">{{
                positionLabel()
              }}</span>
              <button
                type="button"
                class="btn btn-circle btn-xs"
                [attr.aria-label]="nextLabel()"
                [disabled]="!hasNext()"
                [class.btn-ghost]="!hasNext()"
                (click)="nextRecord.emit()"
              >
                <pc-icon name="chevron-right" [size]="4"></pc-icon>
              </button>
            </div>
          }
          <!-- Single source for the action cluster: stamped inline on ≥sm, or inside
               the overflow menu on mobile where the header has no room for buttons.
               includeForm lets the mobile branch pull pc-form-actions OUT of the menu:
               Save/Cancel must stay visible (§2 — never hide the critical path). -->
          <ng-template #actionCluster let-includeForm="includeForm">
            <ng-content select="[pc-actions-prefix]"></ng-content>
            @if (includeForm && showActions()) {
              <pc-form-actions
                size="sm"
                [isLoading]="isLoading()"
                [signalForm]="form()"
                [disabled]="disabled()"
                [saveAlwaysEnabled]="saveAlwaysEnabled()"
                [buttonsToShow]="formActionsButtons()"
                [btn1Text]="btn1Text()"
                [btn1Icon]="btn1Icon()"
                [showDelete]="false"
                [showCancel]="showCancel()"
                (btn1Clicked)="save.emit($event)"
              ></pc-form-actions>
            }
            <ng-content select="[pc-actions-suffix]"></ng-content>
          </ng-template>

          @if (!isMobile()) {
            <ng-container [ngTemplateOutlet]="actionCluster" [ngTemplateOutletContext]="{ includeForm: true }" />
          } @else if (showActions()) {
            <!-- Mobile: Save/Cancel stay inline — a user must never have to discover
                 the overflow menu to save their edits. -->
            <pc-form-actions
              size="sm"
              [isLoading]="isLoading()"
              [signalForm]="form()"
              [disabled]="disabled()"
              [saveAlwaysEnabled]="saveAlwaysEnabled()"
              [buttonsToShow]="formActionsButtons()"
              [btn1Text]="btn1Text()"
              [btn1Icon]="btn1Icon()"
              [showDelete]="false"
              [showCancel]="showCancel()"
              (btn1Clicked)="save.emit($event)"
            ></pc-form-actions>
          }
          @if (isMobile() || showDelete()) {
            <!-- Self-hides when the menu would be empty (a page with no actions at all). -->
            <div class="dropdown dropdown-end [&:not(:has(.dropdown-content_li,.dropdown-content_.btn))]:hidden">
              @if (isMobile()) {
                <!-- Labeled trigger on phones: a bare ⋮ does not read as a menu. -->
                <button
                  type="button"
                  tabindex="0"
                  class="btn btn-outline btn-primary btn-sm gap-1"
                  aria-label="More actions"
                >
                  <pc-icon name="ellipsis-vertical" [size]="4"></pc-icon>
                  Actions
                </button>
              } @else {
                <button type="button" tabindex="0" class="btn btn-circle btn-ghost btn-sm" aria-label="More actions">
                  <pc-icon name="ellipsis-vertical" [size]="5"></pc-icon>
                </button>
              }
              <div
                tabindex="0"
                class="dropdown-content pc-dropdown-sheet z-30 border border-base-200 bg-base-100 p-2 shadow-lg sm:w-56 sm:rounded-box"
              >
                @if (isMobile()) {
                  <!-- The inline action cluster, restacked as full-width rows. The div[…] rules
                       unroll pages' own row wrappers (e.g. <div pc-actions-suffix class="flex …">).
                       min-h-11 + text-sm match the 44px/14px menu rows below so the sheet reads
                       as one action sheet, not a pile of toolbar buttons. -->
                  <div
                    class="flex flex-col items-stretch gap-2 empty:hidden [&_.btn]:w-full [&_.btn]:justify-start [&_.btn]:min-h-11 [&_.btn]:text-sm [&_.dropdown]:w-full [&_pc-form-actions>div]:flex-col [&_div[pc-actions-prefix]]:flex-col [&_div[pc-actions-prefix]]:items-stretch [&_div[pc-actions-suffix]]:flex-col [&_div[pc-actions-suffix]]:items-stretch"
                  >
                    <ng-container
                      [ngTemplateOutlet]="actionCluster"
                      [ngTemplateOutletContext]="{ includeForm: false }"
                    />
                  </div>
                }
                <ul class="menu w-full p-0 max-sm:mt-1 max-sm:border-t max-sm:border-base-200 max-sm:pt-1">
                  <!-- Page-supplied overflow items (e.g. Export vCard, Merge…) render above Delete (§3) -->
                  <ng-content select="[pc-overflow-extra]"></ng-content>
                  @if (showDelete()) {
                    <li>
                      <button type="button" class="text-error" [disabled]="isLoading()" (click)="delete.emit()">
                        <pc-icon name="trash" [size]="4"></pc-icon>
                        {{ deleteText() }}
                      </button>
                    </li>
                  }
                </ul>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class DetailHeader {
  private readonly breadcrumbs = inject(BreadcrumbsService);

  public readonly delete = output<void>();
  public readonly save = output<any>();
  public readonly prevRecord = output<void>();
  public readonly nextRecord = output<void>();

  public btn1Icon = input<PcIconNameType>('save');
  public btn1Text = input<string>('Save');
  public buttonsToShow = input<'two' | 'three'>('three');
  public crumbs = input<PcBreadcrumb[]>([]);
  public deleteText = input<string>('Delete');
  public disabled = input<boolean>(false);
  /** §4: keep the primary button enabled regardless of validity/dirtiness. */
  public saveAlwaysEnabled = input<boolean>(false);
  public eyebrow = input<string>('');
  /** Optional success-tinted status chip beside the title, e.g. "Monthly donor" (§3). */
  public statusChip = input<string | null>(null);
  public form = input<any>();
  public icon = input<PcIconNameType | null | undefined>();
  public iconSize = input<number>(5);
  /** Optional initials shown in a circular avatar left of the title (e.g. "JB"). Takes precedence over icon(). */
  public avatarText = input<string | null>(null);
  public isLoading = input.required<boolean>();
  public showActions = input<boolean>(true);
  public showDelete = input<boolean>(false);
  /** Forwarded to form-actions. Defaults on for edit forms (used directly);
   * detail-layout overrides it to false for read views. */
  public showCancel = input<boolean>(true);
  public subtitle = input<string | null | undefined>();
  public title = input.required<string>();

  /** Optional "N of M filtered" pager, rendered inline with the breadcrumb trail. */
  public positionLabel = input<string | null>(null);
  public hasPrev = input<boolean>(false);
  public hasNext = input<boolean>(false);
  public prevLabel = input<string>('Previous record');
  public nextLabel = input<string>('Next record');

  /** When > 0, replaces the subtitle with an amber "Unsaved changes · N fields" line. */
  public dirtyFieldCount = input<number>(0);

  // Delete moved to the overflow menu. Suppressing the third button whenever
  // Delete is offered preserves the layout form-actions previously produced
  // when it rendered the Delete button inline.
  protected readonly formActionsButtons = computed<'two' | 'three'>(() =>
    this.showDelete() ? 'two' : this.buttonsToShow(),
  );

  /** True below Tailwind `sm`: the action cluster collapses into the overflow menu. */
  protected readonly isMobile = signal(false);

  constructor() {
    // The breadcrumb trail renders in the navbar; the record pager now lives in
    // this header card (design source), so publish the trail only and leave the
    // navbar pager empty to avoid a duplicate. Clear on destroy so the strip
    // empties when navigating to a page (e.g. a grid) that owns no trail.
    effect(() => {
      this.breadcrumbs.set({
        crumbs: this.crumbs(),
        positionLabel: null,
        hasPrev: false,
        hasNext: false,
        prevLabel: this.prevLabel(),
        nextLabel: this.nextLabel(),
        onPrev: () => this.prevRecord.emit(),
        onNext: () => this.nextRecord.emit(),
      });
    });

    const destroyRef = inject(DestroyRef);

    // matchMedia is guarded for non-browser test environments; without it the
    // header stays in the desktop (inline actions) layout.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia(MOBILE_ACTIONS_QUERY);
      this.isMobile.set(mediaQuery.matches);
      const onChange = (event: MediaQueryListEvent): void => this.isMobile.set(event.matches);
      mediaQuery.addEventListener('change', onChange);
      destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', onChange));
    }

    destroyRef.onDestroy(() => this.breadcrumbs.clear());
  }
}
