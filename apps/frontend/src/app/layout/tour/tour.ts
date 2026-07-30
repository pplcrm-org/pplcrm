import { Component, HostListener, computed, inject } from '@angular/core';
import { Icon } from '@icons/icon';

import { TourService } from './tour.service';

/**
 * The tour overlay: a scrim plus one anchored bubble.
 *
 * The scrim is `pointer-events: none`, and the spotlit element is raised above it, so the target
 * stays clickable. When a stop says "try double-clicking a cell", the user can actually do it —
 * a tour that traps you is a modal wearing a costume.
 *
 * Mounted once in the shell alongside the command palette, so it survives route changes and can
 * walk the user between pages.
 */
@Component({
  selector: 'pc-tour',
  imports: [Icon],
  template: `
    @if (tour.active() && stop(); as stop) {
      <div class="pc-tour-scrim" aria-hidden="true"></div>

      <div
        class="pc-tour-bubble animate-drop"
        [class.pc-tour-bubble--anchored]="!!stop.anchor"
        role="dialog"
        aria-modal="false"
        [attr.aria-label]="stop.title"
      >
        <div class="flex items-start justify-between gap-3">
          <p class="pc-eyebrow text-primary">Stop {{ tour.index() + 1 }} of {{ tour.stops().length }}</p>
          @if (stop.planChip) {
            <span class="badge badge-warning badge-sm shrink-0 font-semibold">{{ stop.planChip }}</span>
          }
        </div>

        <h2 class="mt-1.5 text-sm font-bold text-base-content">{{ stop.title }}</h2>
        <p class="mt-1.5 text-xs leading-relaxed text-base-content/70">{{ tour.body() }}</p>

        @if (stop.planChip) {
          <p class="mt-1.5 text-[10.5px] text-base-content/50">
            Included on the {{ stop.planChip }} plan and above. You can explore it fully while in demo mode.
          </p>
        }

        <div class="mt-3.5 flex items-center justify-between gap-3 border-t border-base-200 pt-3">
          <div class="flex items-center gap-1" role="presentation">
            @for (s of tour.stops(); track s.id; let i = $index) {
              <button
                type="button"
                class="pc-tour-pip cursor-pointer"
                [class.pc-tour-pip--on]="i === tour.index()"
                [class.pc-tour-pip--done]="i < tour.index()"
                [attr.aria-label]="'Go to stop ' + (i + 1) + ': ' + s.title"
                (click)="tour.goTo(i)"
              ></button>
            }
          </div>

          <div class="flex items-center gap-1.5">
            <button type="button" class="btn btn-ghost btn-xs" (click)="tour.skip()">Skip</button>
            @if (tour.index() > 0) {
              <button type="button" class="btn btn-outline btn-primary btn-xs" (click)="tour.previous()">Back</button>
            }
            <button type="button" class="btn btn-primary btn-xs" (click)="tour.next()">
              {{ tour.isLast() ? 'Finish' : 'Next' }}
              <pc-icon name="chevron-right" [size]="3"></pc-icon>
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class Tour {
  protected readonly tour = inject(TourService);
  protected readonly stop = computed(() => this.tour.stop());

  /** Escape leaves. No confirm: interrupting someone to ask whether they meant to stop reading is
   * the kind of dialog that trains people to ignore dialogs. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.tour.active()) void this.tour.skip();
  }
}
