import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { CompanionHousehold } from '@common';

import { conversations, doorStatus, doorStatusLabel, isAttempted } from './canvass-derive';
import { CanvassStore } from './canvass-store';
import { firstNameOf, statusBadgeClass } from './canvass-ui';

type ListFilter = 'all' | 'remaining' | 'visited';

/**
 * The walk list (spec §3.3): progress first ("6 of 14 doors attempted"), then
 * doors in walk order. The next open door — lowest walk order not attempted —
 * gets the primary ring and a filled number bubble.
 */
@Component({
  selector: 'pc-canvass-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4 p-4">
      <header class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-base-content/50">
            {{ store.payload()?.campaign_name }}
          </p>
          <h1 class="truncate text-xl font-bold">{{ store.payload()?.turf_name }}</h1>
        </div>
        <button type="button" class="btn btn-ghost btn-sm shrink-0" (click)="openPicker()">Switch turf</button>
      </header>

      <div class="rounded-lg border border-base-300 bg-base-100 p-4">
        <p class="font-medium">{{ attempted() }} of {{ total() }} doors attempted</p>
        <progress
          class="progress progress-primary mt-2 w-full"
          [value]="attempted()"
          [max]="total()"
          aria-label="Turf progress"
        ></progress>
        <p class="mt-1 text-xs text-base-content/70">
          {{ conversationCount() }} {{ conversationCount() === 1 ? 'conversation' : 'conversations' }}
        </p>
      </div>

      <div class="flex gap-2" role="group" aria-label="Filter doors">
        @for (option of filterOptions; track option.id) {
          <button
            type="button"
            class="btn flex-1"
            [class.btn-primary]="filter() === option.id"
            [class.btn-outline]="filter() !== option.id"
            [class.btn-secondary]="filter() !== option.id"
            [attr.aria-pressed]="filter() === option.id"
            (click)="filter.set(option.id)"
          >
            {{ option.label }} ({{ countFor(option.id) }})
          </button>
        }
      </div>

      <div class="flex flex-col gap-2">
        @for (h of filtered(); track h.id) {
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left"
            [class.ring-2]="h.id === store.nextDoorId()"
            [class.ring-primary]="h.id === store.nextDoorId()"
            (click)="open(h.id)"
          >
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
              [class.bg-primary]="h.id === store.nextDoorId()"
              [class.text-primary-content]="h.id === store.nextDoorId()"
              [class.border-primary]="h.id === store.nextDoorId()"
              [class.border-base-300]="h.id !== store.nextDoorId()"
              [class.text-base-content]="h.id !== store.nextDoorId()"
            >
              {{ h.walk_order }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ h.address }}</span>
              @if (residentNames(h)) {
                <span class="block truncate text-xs text-base-content/70">{{ residentNames(h) }}</span>
              }
            </span>
            <span [class]="chipClass(h)">{{ chipLabel(h) }}</span>
          </button>
        } @empty {
          <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
            <p class="text-base-content/70">{{ emptyMessage() }}</p>
            @if (filter() !== 'all') {
              <button type="button" class="btn btn-outline btn-secondary" (click)="filter.set('all')">
                Show all doors
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class CanvassList {
  protected readonly store = inject(CanvassStore);

  protected readonly filter = signal<ListFilter>('all');
  protected readonly filterOptions: { id: ListFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'remaining', label: 'Remaining' },
    { id: 'visited', label: 'Visited' },
  ];

  protected readonly attempted = computed(() => this.store.stats().doors_attempted);
  protected readonly total = computed(() => this.store.stats().doors_total);
  protected readonly conversationCount = computed(() => conversations(this.store.households()));

  protected readonly filtered = computed<CompanionHousehold[]>(() => {
    const households = [...this.store.households()].sort((a, b) => a.walk_order - b.walk_order);
    const filter = this.filter();
    switch (filter) {
      case 'remaining':
        return households.filter((h) => !isAttempted(h));
      case 'visited':
        return households.filter((h) => isAttempted(h));
      case 'all':
        return households;
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  });

  protected chipClass(h: CompanionHousehold): string {
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    return doorStatusLabel(doorStatus(h));
  }

  protected countFor(filter: ListFilter): number {
    const households = this.store.households();
    if (filter === 'remaining') return households.filter((h) => !isAttempted(h)).length;
    if (filter === 'visited') return households.filter((h) => isAttempted(h)).length;
    return households.length;
  }

  protected emptyMessage(): string {
    const filter = this.filter();
    switch (filter) {
      case 'remaining':
        return 'Every door is attempted. Nice work.';
      case 'visited':
        return 'No doors visited yet. Start with door 1.';
      case 'all':
        return 'There are no doors in this turf yet.';
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  }

  protected open(householdId: string): void {
    this.store.view.set({ kind: 'household', household_id: householdId });
  }

  protected openPicker(): void {
    this.store.view.set({ kind: 'picker' });
  }

  protected residentNames(h: CompanionHousehold): string {
    return h.people.map((p) => firstNameOf(p.name)).join(', ');
  }
}
