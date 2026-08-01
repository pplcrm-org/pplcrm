import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { PERSONINHOUSEHOLDTYPE } from '../../../../../../../libs/common/src';

import { PersonsService } from '../services/persons-service';

type HouseholdMember = PERSONINHOUSEHOLDTYPE & { email?: string | null };

@Component({
  selector: 'pc-people-in-household',
  imports: [RouterModule],
  template: `<div class="flex flex-col">
    @if (isLoading() && !peopleInHousehold().length) {
      @for (row of [0, 1]; track row) {
        <div class="flex items-center gap-3 px-2 py-2.5">
          <div class="skeleton h-9 w-9 shrink-0 rounded-full"></div>
          <div class="flex flex-col gap-1.5">
            <div class="skeleton h-3 w-32"></div>
            <div class="skeleton h-2.5 w-44"></div>
          </div>
        </div>
      }
    }
    @if (!peopleInHousehold().length && !isLoading()) {
      <p i18n class="py-2 text-sm italic text-base-content/40">No one else at this address yet.</p>
    }
    @for (person of peopleInHousehold(); track person.id) {
      <a
        routerLink="/people/{{ person.id }}"
        class="flex items-center gap-3 rounded-lg px-2 py-2.5 no-underline transition-colors hover:bg-base-200/60"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          aria-hidden="true"
          >{{ initials(person) }}</span
        >
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-sm font-semibold text-base-content">{{ person.full_name }}</span>
          @if (person.email) {
            <span class="truncate text-xs text-base-content/50">{{ person.email }}</span>
          }
        </span>
      </a>
    }
    @if (hasMore()) {
      <button
        i18n
        type="button"
        class="mt-1 self-start text-xs text-primary hover:underline"
        (click)="loadMore()"
        [disabled]="isLoading()"
      >
        Show more
      </button>
    }
  </div>`,
})
export class PeopleInHousehold {
  private personsSvc = inject(PersonsService);

  protected peopleInHousehold = signal<HouseholdMember[]>([]);
  protected isLoading = signal(false);
  protected hasMore = signal(false);

  private readonly pageSize = 25;
  private currentOffset = signal(0);
  private requestSequence = 0;
  private lastParams: { id: string; excludeId: string | null } | null = null;

  public excludePersonId = input<string | null>(null);

  public householdId = input.required<string>();

  constructor() {
    // React to input changes
    effect(() => {
      const id = this.householdId();
      const excludeId = this.excludePersonId();

      if (!id) {
        this.resetState();
        this.lastParams = null;
        return;
      }

      if (this.lastParams && this.lastParams.id === id && this.lastParams.excludeId === excludeId) {
        return;
      }

      this.lastParams = { id, excludeId };
      this.resetState();
      void this.fetchPage({ id, excludeId, offset: 0, replace: true });
    });
  }

  protected initials(person: HouseholdMember): string {
    const first = person.first_name?.trim()?.[0] ?? '';
    const last = person.last_name?.trim()?.[0] ?? '';
    return (first + last).toUpperCase() || (person.full_name?.trim()?.[0]?.toUpperCase() ?? '?');
  }

  protected async loadMore() {
    if (this.isLoading() || !this.hasMore()) {
      return;
    }

    const id = this.householdId();
    if (!id) {
      return;
    }

    const excludeId = this.excludePersonId();
    const offset = this.currentOffset();
    await this.fetchPage({ id, excludeId, offset, replace: false });
  }

  private resetState() {
    this.peopleInHousehold.set([]);
    this.currentOffset.set(0);
    this.hasMore.set(false);
    this.isLoading.set(false);
    this.requestSequence++;
  }

  private async fetchPage(params: { id: string; excludeId: string | null; offset: number; replace: boolean }) {
    const { id, excludeId, offset, replace } = params;
    const requestId = ++this.requestSequence;
    this.isLoading.set(true);

    try {
      const people = (await this.personsSvc.getPeopleInHousehold(id, {
        limit: this.pageSize,
        offset,
        columns: ['email'],
      })) as HouseholdMember[];

      if (requestId !== this.requestSequence) {
        return;
      }

      const filtered = excludeId ? people.filter((p) => p.id !== excludeId) : people;

      if (replace) {
        this.peopleInHousehold.set(filtered);
      } else {
        this.peopleInHousehold.update((current) => [...current, ...filtered]);
      }

      this.currentOffset.set(offset + people.length);
      this.hasMore.set(people.length === this.pageSize);
    } finally {
      if (requestId === this.requestSequence) {
        this.isLoading.set(false);
      }
    }
  }
}
