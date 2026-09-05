import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';

import type { CompanionHousehold } from '@common';
import { Icon } from '@icons/icon';

import type { SideFilter, WalkEntry } from './canvass-derive';
import {
  conversations,
  doorStatus,
  doorStatusLabel,
  entryRemaining,
  hasVoted,
  householdStance,
  isAttempted,
  livingResidents,
  residentSummary,
} from './canvass-derive';
import { CanvassSegmentPicker } from './canvass-segment-picker';
import { CanvassStore } from './canvass-store';
import { scopeLabel, statusBadgeClass, stanceStyle, type StanceStyle } from './canvass-ui';

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
 * The walk list (spec §3.3): the street you are on, its progress, then its doors in walk
 * order. The next open door — lowest walk order not attempted — gets the primary ring and
 * a filled number bubble.
 *
 * Two things a row says before it is tapped, because both change whether it is worth
 * knocking: **who lives here** (full names, with a shared surname said once) and **where
 * they stand** (a coloured left edge and a thumb, from the CRM's prior ID or from a survey
 * logged on this walk). A yard sign already owed and a ballot already cast get their own
 * marks — both mean "the ask at this door is different".
 *
 * Apartments arrive as one household per unit, so a block would otherwise be forty
 * identical-looking rows. They fold into one building row that opens the unit list.
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
        <p class="font-medium">{{ progressLine() }}</p>
        <progress
          class="progress progress-primary mt-2 w-full"
          [value]="scopeAttempted()"
          [max]="scopeTotal()"
          aria-label="Progress on this street"
        ></progress>
        <p class="mt-1 text-xs text-base-content/70">{{ turfLine() }}</p>
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
          <pc-icon name="map-pin" [size]="5" class="shrink-0 text-primary" />
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

      <!-- One side of the street at a time — how streets are actually walked. Only shown
           when the street genuinely splits into two numbered sides; composes with the
           filter row above ("Remaining" + "Odd" = the working set). -->
      @if (store.sideBreakdown().available) {
        <div class="flex gap-2" role="group" aria-label="Side of the street">
          @for (option of sideOptions; track option) {
            <button
              type="button"
              class="btn btn-sm flex-1"
              [class.btn-primary]="store.sideFilter() === option"
              [class.btn-outline]="store.sideFilter() !== option"
              [class.btn-secondary]="store.sideFilter() !== option"
              [attr.aria-pressed]="store.sideFilter() === option"
              (click)="store.sideFilter.set(option)"
            >
              {{ sideLabel(option) }}
            </button>
          }
        </div>
      }

      <div class="flex flex-col gap-2">
        @for (entry of filtered(); track entry.key) {
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border border-l-4 border-base-300 bg-base-100 p-3 text-left"
            [class]="accentClass(entry)"
            [class.ring-2]="entry.key === store.nextEntryKey()"
            [class.ring-primary]="entry.key === store.nextEntryKey()"
            (click)="open(entry)"
          >
            @if (entry.kind === 'building') {
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-base-300 text-base-content"
              >
                <pc-icon name="building-office" [size]="4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ entry.address }}</span>
                <span class="block truncate text-xs text-base-content/70">{{ buildingSubtitle(entry) }}</span>
              </span>
              @if (buildingPeople(entry); as n) {
                <span
                  class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-base-content/60"
                  [title]="peopleTitle(n)"
                >
                  <pc-icon name="user-group" [size]="4" />{{ n }}
                </span>
              }
              <pc-icon name="chevron-right" [size]="5" class="shrink-0 text-base-content/40" />
            } @else {
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold"
                [class.bg-primary]="entry.key === store.nextEntryKey()"
                [class.text-primary-content]="entry.key === store.nextEntryKey()"
                [class.border-primary]="entry.key === store.nextEntryKey()"
                [class.border-base-300]="entry.key !== store.nextEntryKey()"
                [class.text-base-content]="entry.key !== store.nextEntryKey()"
              >
                {{ store.walkSeqByKey().get(entry.key) }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ entry.household.address }}</span>
                @if (residents(entry.household); as names) {
                  <span class="block truncate text-xs text-base-content/70">{{ names }}</span>
                }
              </span>
              <span class="flex shrink-0 items-center gap-1.5">
                <!-- Marks before the status chip: they change what you ASK at the door,
                     which matters before you know whether anyone answered it. -->
                <!-- How many people to expect. The names line truncates on a phone-width
                     row, so past two residents the count is otherwise invisible. One icon
                     plus a number, never a row of figures: five glyphs would crowd out the
                     marks that change the ask. -->
                @if (peopleCount(entry.household); as n) {
                  <span
                    class="flex items-center gap-1 text-xs tabular-nums text-base-content/60"
                    [title]="peopleTitle(n)"
                  >
                    <pc-icon name="user-group" [size]="4" />{{ n }}
                  </span>
                }
                <!-- Only an OWED sign is a mark on the row. A door whose sign is already
                     delivered has nothing left for the walker to do about it, and a mark
                     there would send them looking for a job that is finished. -->
                @if (entry.household.yard_sign?.status === 'requested') {
                  <pc-icon name="yard-sign" [size]="4" class="text-info" title="Owed a yard sign" />
                }
                @if (voted(entry.household)) {
                  <pc-icon name="check-circle" [size]="4" class="text-success" title="Already voted" />
                }
                @if (stance(entry.household); as s) {
                  <pc-icon [name]="s.icon" [size]="4" [class]="s.tone" [title]="s.label" />
                }
                <span [class]="chipClass(entry.household)">{{ chipLabel(entry.household) }}</span>
              </span>
            }
          </button>
        } @empty {
          <div class="flex flex-col items-center gap-2 rounded-lg border border-base-300 bg-base-100 p-6 text-center">
            <p class="text-base-content/70">{{ emptyMessage() }}</p>
            @if (filter() === 'remaining' && store.crossSide(); as other) {
              <button type="button" class="btn btn-primary" (click)="store.sideFilter.set(other)">
                Switch to the {{ other }} side
              </button>
            } @else if (filter() !== 'all') {
              <button type="button" class="btn btn-outline btn-primary" (click)="filter.set('all')">
                Show every door here
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
  /** 'Both sides' first: it is the default, and it names what the other two narrow. */
  protected readonly sideOptions: SideFilter[] = ['both', 'odd', 'even'];

  /**
   * Progress on the street in view, with the turf stated underneath.
   *
   * The bar tracks the scope because the scope is the shift: "3 of 14" on the street you
   * are standing on is something you can finish, where "3 of 143" is a number you can only
   * feel bad about. The turf line keeps the bigger picture one line away.
   */
  protected readonly scopeAttempted = computed(() => this.store.scopedHouseholds().filter(isAttempted).length);
  protected readonly scopeTotal = computed(() => this.store.scopedHouseholds().length);
  protected readonly conversationCount = computed(() => conversations(this.store.scopedHouseholds()));

  protected readonly filtered = computed<WalkEntry[]>(() => {
    const entries = this.store.walkEntries();
    const filter = this.filter();
    switch (filter) {
      case 'remaining':
        return entries.filter(entryRemaining);
      case 'visited':
        return entries.filter((e) => !entryRemaining(e));
      case 'all':
        return entries;
      default: {
        const _exhaustive: never = filter;
        return _exhaustive;
      }
    }
  });

  constructor() {
    const timer = setInterval(() => void this.store.refresh(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /**
   * The coloured left edge. Buildings never carry one — a block of forty flats has no
   * single stance, and averaging one would be a claim nobody made.
   */
  protected accentClass(entry: WalkEntry): string {
    if (entry.kind === 'building') return 'border-l-base-300';
    return stanceStyle(householdStance(entry.household))?.accent ?? 'border-l-base-300';
  }

  /** Everyone on file across the building's units, so a hallway says its size in people too. */
  protected buildingPeople(entry: Extract<WalkEntry, { kind: 'building' }>): number {
    return entry.units.reduce((n, u) => n + livingResidents(u).length, 0);
  }

  protected buildingSubtitle(entry: Extract<WalkEntry, { kind: 'building' }>): string {
    return `${entry.units.length} units · ${entry.attempted} attempted`;
  }

  protected chipClass(h: CompanionHousehold): string {
    return statusBadgeClass(doorStatus(h));
  }

  protected chipLabel(h: CompanionHousehold): string {
    return doorStatusLabel(doorStatus(h));
  }

  protected countFor(filter: ListFilter): number {
    const entries = this.store.walkEntries();
    if (filter === 'remaining') return entries.filter(entryRemaining).length;
    if (filter === 'visited') return entries.filter((e) => !entryRemaining(e)).length;
    return entries.length;
  }

  /** "Odd (7)" — the count is what picking that side would show, unplaceable doors included. */
  protected sideLabel(side: SideFilter): string {
    const breakdown = this.store.sideBreakdown();
    switch (side) {
      case 'both':
        return 'Both sides';
      case 'odd':
        return `Odd (${breakdown.odd})`;
      case 'even':
        return `Even (${breakdown.even})`;
      default: {
        const _exhaustive: never = side;
        return _exhaustive;
      }
    }
  }

  private scopeDescription(): string {
    return scopeLabel(this.store.activeSegment()?.street ?? null, this.store.activeSide());
  }

  protected emptyMessage(): string {
    const filter = this.filter();
    // Say which scope is empty. "Every door is attempted" about one street, read as if it
    // were the whole turf, would send a volunteer home early.
    const where = this.scopeDescription();
    switch (filter) {
      case 'remaining':
        // When the other side of this street still has doors, the button under this
        // message says "switch side" — telling them to leave the street would be wrong.
        return this.store.crossSide()
          ? `Every door on ${where} is attempted.`
          : `Every door on ${where} is attempted. Pick the next street.`;
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

  protected open(entry: WalkEntry): void {
    if (entry.kind === 'building') this.store.view.set({ kind: 'building', building_key: entry.key });
    else this.store.view.set({ kind: 'household', household_id: entry.household.id });
  }

  protected openPicker(): void {
    this.store.view.set({ kind: 'picker' });
  }

  /**
   * The turf's own numbers, one line under the street's.
   *
   * Both are stated because they answer different questions — "can I finish this street"
   * and "how is the turf doing" — and a single unlabelled figure would be read as either.
   */
  protected turfLine(): string {
    const stats = this.store.stats();
    const conversations = this.conversationCount();
    const talks = `${conversations} ${conversations === 1 ? 'conversation' : 'conversations'} here`;
    return `${talks} · ${stats.doors_attempted} of ${stats.doors_total} attempted across the turf`;
  }

  protected progressLine(): string {
    // Named with the side in force ("the odd side of James Street"), because the counts
    // follow the side — an unnarrated narrowing would read as doors going missing.
    return `${this.scopeAttempted()} of ${this.scopeTotal()} doors attempted on ${this.scopeDescription()}`;
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

  protected refreshNow(): void {
    void this.store.refresh();
  }

  protected scopeTitle(): string {
    return this.store.activeSegment()?.street ?? 'Every door in this turf';
  }

  protected scopeSubtitle(): string {
    const streets = this.store.segments().length;
    if (streets <= 1) return 'The only street in this turf · tap to confirm';
    return `Tap to switch street · ${streets} streets in this turf`;
  }

  protected stance(h: CompanionHousehold): StanceStyle | null {
    return stanceStyle(householdStance(h));
  }

  protected voted(h: CompanionHousehold): boolean {
    return hasVoted(h);
  }
}
