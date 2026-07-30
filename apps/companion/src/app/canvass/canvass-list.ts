import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { Icon } from '@icons/icon';

import { conversations, doorStatus, doorStatusLabel, isAttempted } from './canvass-derive';
import { CanvassSegmentPicker } from './canvass-segment-picker';
import { CanvassStore } from './canvass-store';
import { firstNameOf, statusBadgeClass } from './canvass-ui';

/**
 * How often the turf re-pulls itself while the walk list is open.
 *
 * With a group on one turf, a stale payload means two people knock the same door. A
 * minute is short enough that the duplicate window is small and long enough that a phone
 * in a pocket isn't burning battery on it.
 */
const REFRESH_MS = 60_000;

type ListFilter = 'all' | 'remaining' | 'visited';

/**
 * The walk list (spec §3.3): progress first ("6 of 14 doors attempted"), then
 * doors in walk order. The next open door — lowest walk order not attempted —
 * gets the primary ring and a filled number bubble.
 */
@Component({
  selector: 'pc-canvass-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, CanvassSegmentPicker],
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
        <!-- Several people can be walking this turf, so say how fresh these numbers are
             rather than letting them look authoritative when they're an hour old. -->
        <button
          type="button"
          class="mt-1 text-xs text-base-content/50 underline decoration-dotted underline-offset-2"
          [disabled]="store.refreshing()"
          (click)="refreshNow()"
        >
          {{ freshness() }}
        </button>
      </div>

      <!-- Scope, always narrated (§2). The button is the whole row so it's thumb-sized. -->
      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg border border-base-300 bg-base-100 p-3 text-left"
          [attr.aria-expanded]="pickerOpen()"
          (click)="pickerOpen.set(!pickerOpen())"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ scopeTitle() }}</span>
            <span class="block truncate text-xs text-base-content/70">{{ scopeSubtitle() }}</span>
          </span>
          <pc-icon [name]="pickerOpen() ? 'chevron-up' : 'chevron-down'" [size]="5" />
        </button>
        @if (pickerOpen()) {
          <pc-canvass-segment-picker (closed)="pickerOpen.set(false)" />
        }
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

  protected readonly pickerOpen = signal(false);
  protected readonly filter = signal<ListFilter>('all');
  protected readonly filterOptions: { id: ListFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'remaining', label: 'Remaining' },
    { id: 'visited', label: 'Visited' },
  ];

  // Turf-wide on purpose, even when the list is scoped to one street: the progress bar
  // answers "how is the turf doing", and the scope row right below it answers "what am I
  // looking at". Two different questions, two different numbers, both labelled.
  protected readonly attempted = computed(() => this.store.stats().doors_attempted);
  protected readonly total = computed(() => this.store.stats().doors_total);
  protected readonly conversationCount = computed(() => conversations(this.store.households()));

  protected readonly filtered = computed<CompanionHousehold[]>(() => {
    const households = [...this.store.scopedHouseholds()].sort((a, b) => a.walk_order - b.walk_order);
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

  constructor() {
    const timer = setInterval(() => void this.store.refresh(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected countFor(filter: ListFilter): number {
    const households = this.store.scopedHouseholds();
    if (filter === 'remaining') return households.filter((h) => !isAttempted(h)).length;
    if (filter === 'visited') return households.filter((h) => isAttempted(h)).length;
    return households.length;
  }

  /** "Updated just now" — vague on purpose past the first hour; the exact minute is noise. */
  protected freshness(): string {
    if (this.store.refreshing()) return 'Updating…';
    const at = this.store.lastRefreshedAt();
    if (!at) return 'Tap to update';
    const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
    if (minutes < 1) return 'Updated just now';
    if (minutes === 1) return 'Updated 1 minute ago';
    if (minutes < 60) return `Updated ${minutes} minutes ago`;
    return 'Updated over an hour ago · tap to update';
  }

  protected refreshNow(): void {
    void this.store.refresh();
  }

  protected scopeTitle(): string {
    return this.store.activeSegment()?.street ?? 'All doors in this turf';
  }

  /** Always states the scope against the whole turf, so "20 doors" can't read as "20 left". */
  protected scopeSubtitle(): string {
    const total = this.store.stats().doors_total;
    const segment = this.store.activeSegment();
    if (!segment) return `${total} ${total === 1 ? 'door' : 'doors'} · tap to walk one street at a time`;
    return `${segment.attempted} of ${segment.doors} attempted · ${total} doors in this turf`;
  }

  protected emptyMessage(): string {
    const filter = this.filter();
    // Say which scope is empty. "Every door is attempted" about one street, read as if it
    // were the whole turf, would send a volunteer home early.
    const where = this.store.activeSegment()?.street ?? 'this turf';
    switch (filter) {
      case 'remaining':
        return `Every door on ${where} is attempted. Nice work.`;
      case 'visited':
        return `No doors visited on ${where} yet. Start with the ringed door.`;
      case 'all':
        return `There are no doors on ${where} yet.`;
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
