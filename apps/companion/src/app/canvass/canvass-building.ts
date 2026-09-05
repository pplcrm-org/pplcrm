import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { Icon } from '@icons/icon';

import {
  doorStatus,
  doorStatusLabel,
  hasVoted,
  householdStance,
  isAttempted,
  livingResidents,
  residentSummary,
} from './canvass-derive';
import { CanvassStore } from './canvass-store';
import { stanceStyle, statusBadgeClass, type StanceStyle } from './canvass-ui';

/**
 * The units inside one apartment building.
 *
 * Exists because an apartment is an ordinary household that happens to carry a unit, so a
 * 40-unit block arrives as 40 walk-list rows with the same street address on every one.
 * The list folds them into a single building row; this is what that row opens.
 *
 * Deliberately the same row shape as the walk list — number, name, marks, status — with
 * the unit where the address would be. A canvasser working a hallway is doing the same job
 * as one working a street, and making it look like a different job would be the only
 * confusing thing about it.
 */
@Component({
  selector: 'pc-canvass-building',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="flex flex-1 flex-col gap-4 p-4">
      <header class="flex items-start gap-2">
        <button type="button" class="btn btn-ghost btn-circle" aria-label="Back to the walk list" (click)="back()">
          <pc-icon name="chevron-left" [size]="5" />
        </button>
        <div class="min-w-0 flex-1">
          <h1 class="text-lg font-bold">{{ address() }}</h1>
          <p class="text-xs text-base-content/70">{{ subtitle() }}</p>
        </div>
      </header>

      @if (units().length === 0) {
        <div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p class="text-base-content/70">This building isn't in your turf anymore.</p>
          <button type="button" class="btn btn-primary" (click)="back()">Back to the walk list</button>
        </div>
      } @else {
        <div class="flex flex-col gap-2">
          @for (u of units(); track u.id) {
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg border border-l-4 border-base-300 bg-base-100 p-3 text-left"
              [class]="accentClass(u)"
              [class.ring-2]="u.id === store.nextDoorId()"
              [class.ring-primary]="u.id === store.nextDoorId()"
              (click)="open(u.id)"
            >
              <span
                class="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full border px-1.5 text-xs font-semibold"
                [class.bg-primary]="u.id === store.nextDoorId()"
                [class.text-primary-content]="u.id === store.nextDoorId()"
                [class.border-primary]="u.id === store.nextDoorId()"
                [class.border-base-300]="u.id !== store.nextDoorId()"
                [class.text-base-content]="u.id !== store.nextDoorId()"
              >
                {{ u.apt }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ unitLabel(u) }}</span>
                @if (residents(u); as names) {
                  <span class="block truncate text-xs text-base-content/70">{{ names }}</span>
                }
              </span>
              <span class="flex shrink-0 items-center gap-1.5">
                <!-- Same people-count mark as the walk list: how many to expect behind
                     this unit's door, since the names line truncates. -->
                @if (peopleCount(u); as n) {
                  <span
                    class="flex items-center gap-1 text-xs tabular-nums text-base-content/60"
                    [title]="peopleTitle(n)"
                  >
                    <pc-icon name="user-group" [size]="4" />{{ n }}
                  </span>
                }
                @if (u.yard_sign?.status === 'requested') {
                  <pc-icon name="yard-sign" [size]="4" class="text-info" title="Owed a yard sign" />
                }
                @if (voted(u)) {
                  <pc-icon name="check-circle" [size]="4" class="text-success" title="Already voted" />
                }
                @if (stance(u); as s) {
                  <pc-icon [name]="s.icon" [size]="4" [class]="s.tone" [title]="s.label" />
                }
                <span [class]="chipClass(u)">{{ chipLabel(u) }}</span>
              </span>
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class CanvassBuilding {
  protected readonly store = inject(CanvassStore);

  protected readonly units = computed<CompanionHousehold[]>(() => {
    const view = this.store.view();
    return view.kind === 'building' ? this.store.unitsFor(view.building_key) : [];
  });

  /**
   * The building's address, taken from the walk-list row that folded it — so the header
   * reads exactly the way the row the volunteer just tapped did.
   */
  protected readonly address = computed(() => {
    const view = this.store.view();
    if (view.kind !== 'building') return '';
    const entry = this.store.walkEntries().find((e) => e.kind === 'building' && e.key === view.building_key);
    return entry?.kind === 'building' ? entry.address : (this.units()[0]?.address ?? '');
  });

  protected accentClass(h: CompanionHousehold): string {
    return stanceStyle(householdStance(h))?.accent ?? 'border-l-base-300';
  }

  protected back(): void {
    this.store.view.set({ kind: 'list' });
  }

  protected chipClass(h: CompanionHousehold): string {
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    return doorStatusLabel(doorStatus(h));
  }

  protected open(householdId: string): void {
    this.store.view.set({ kind: 'household', household_id: householdId });
  }

  protected peopleCount(h: CompanionHousehold): number {
    return livingResidents(h).length;
  }

  protected peopleTitle(n: number): string {
    return n === 1 ? '1 person on file here' : `${n} people on file here`;
  }

  protected residents(h: CompanionHousehold): string {
    return residentSummary(h);
  }

  protected stance(h: CompanionHousehold): StanceStyle | null {
    return stanceStyle(householdStance(h));
  }

  protected subtitle(): string {
    const units = this.units();
    const attempted = units.filter(isAttempted).length;
    return `${attempted} of ${units.length} units attempted`;
  }

  protected unitLabel(h: CompanionHousehold): string {
    const apt = h.apt?.trim();
    if (!apt) return h.address;
    return /^[\d\s-]+$/.test(apt) ? `Unit ${apt}` : apt;
  }

  protected voted(h: CompanionHousehold): boolean {
    return hasVoted(h);
  }
}
