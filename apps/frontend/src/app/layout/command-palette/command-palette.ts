import type { ElementRef } from '@angular/core';
import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '@icons/icon';

import { searchHelp } from '@common';

import type { CommandAction } from '../../services/command-palette.service';
import { CommandPaletteService } from '../../services/command-palette.service';
import { HouseholdsService } from '../../experiences/households/services/households-service';
import { PersonsService } from '../../experiences/persons/services/persons-service';
import { SearchService } from '../../services/api/search-service';

interface PersonHit {
  id: string;
  name: string;
  email: string | null;
}

interface HouseholdHit {
  id: string;
  address: string;
  city: string | null;
}

interface HelpHit {
  id: string;
  title: string;
  summary: string;
}

type ResultKind = 'Action' | 'Person' | 'Household' | 'Help' | 'Search';

interface PaletteResult {
  kind: ResultKind;
  label: string;
  sublabel?: string | null;
  icon: CommandAction['icon'];
  run: () => void;
}

const PEOPLE_LIMIT = 4;
const HOUSEHOLDS_LIMIT = 4;
const HELP_LIMIT = 3;
const PEOPLE_DEBOUNCE_MS = 180;

/**
 * Command palette (⌘⇧K). Centered overlay: filtered actions always, plus matching people and a
 * "filter People" hand-off when a query is present. Enter runs the first result; esc/backdrop
 * closes. Rendered once in the shell.
 */
@Component({
  selector: 'pc-command-palette',
  imports: [Icon],
  templateUrl: './command-palette.html',
  host: {
    '(window:keydown)': 'onWindowKey($event)',
  },
})
export class CommandPalette {
  private readonly palette = inject(CommandPaletteService);
  private readonly persons = inject(PersonsService);
  private readonly households = inject(HouseholdsService);
  private readonly router = inject(Router);
  private readonly searchSvc = inject(SearchService);

  protected readonly isOpen = this.palette.isOpen;
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  private readonly people = signal<PersonHit[]>([]);
  private readonly householdHits = signal<HouseholdHit[]>([]);

  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('paletteInput');
  private fetchTimer?: ReturnType<typeof setTimeout>;
  private fetchToken = 0;

  protected readonly filteredActions = computed<PaletteResult[]>(() => {
    const q = this.query().trim().toLowerCase();
    const actions = this.palette.actions();
    const matched = q ? actions.filter((a) => `${a.label} ${a.keywords ?? ''}`.toLowerCase().includes(q)) : actions;
    return matched.map((a) => ({ kind: 'Action', label: a.label, icon: a.icon, run: () => this.runAndClose(a.run) }));
  });

  /** Help matches are synchronous — the articles ship with the app. */
  private readonly helpHits = computed<HelpHit[]>(() => {
    const q = this.query().trim();
    if (!q) return [];
    return searchHelp(q)
      .slice(0, HELP_LIMIT)
      .map((r) => ({ id: r.article.id, title: r.article.title, summary: r.article.summary }));
  });

  protected readonly results = computed<PaletteResult[]>(() => {
    const q = this.query().trim();
    const rows: PaletteResult[] = [...this.filteredActions()];
    if (q) {
      for (const p of this.people()) {
        rows.push({
          kind: 'Person',
          label: p.name,
          sublabel: p.email,
          icon: 'user-circle',
          run: () => this.runAndClose(() => void this.router.navigateByUrl(`/people/${p.id}`)),
        });
      }
      for (const h of this.householdHits()) {
        rows.push({
          kind: 'Household',
          label: h.address,
          sublabel: h.city,
          icon: 'house-modern',
          run: () => this.runAndClose(() => void this.router.navigateByUrl(`/households/${h.id}`)),
        });
      }
      for (const a of this.helpHits()) {
        rows.push({
          kind: 'Help',
          label: a.title,
          sublabel: a.summary,
          icon: 'question-mark-circle',
          run: () => this.runAndClose(() => void this.router.navigateByUrl(`/help/${a.id}`)),
        });
      }
      rows.push({
        kind: 'Search',
        label: `Filter People by "${q}"`,
        icon: 'magnifying-glass',
        run: () => this.runAndClose(() => this.filterPeople(q)),
      });
    }
    return rows;
  });

  constructor() {
    // Focus the input on open; reset everything on close.
    effect(() => {
      if (this.isOpen()) {
        queueMicrotask(() => this.inputRef()?.nativeElement?.focus());
      } else {
        this.query.set('');
        this.people.set([]);
        this.householdHits.set([]);
        this.activeIndex.set(0);
      }
    });

    // Debounced people search while the palette is open and a query is present.
    effect(() => {
      const open = this.isOpen();
      const q = this.query().trim();
      if (this.fetchTimer) {
        clearTimeout(this.fetchTimer);
      }
      if (!open || !q) {
        this.people.set([]);
        this.householdHits.set([]);
        return;
      }
      const token = ++this.fetchToken;
      this.fetchTimer = setTimeout(() => {
        void this.fetchPeople(q, token);
        void this.fetchHouseholds(q, token);
      }, PEOPLE_DEBOUNCE_MS);
    });
  }

  protected onWindowKey(event: KeyboardEvent): void {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isK = event.key?.toLowerCase() === 'k';
    if (isCtrlOrCmd && event.shiftKey && isK) {
      event.preventDefault();
      this.palette.toggle();
    }
  }

  protected onInputKey(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.activeIndex.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter': {
        event.preventDefault();
        const results = this.results();
        const active = results[Math.min(this.activeIndex(), results.length - 1)];
        active?.run();
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.palette.close();
        break;
      default:
        break;
    }
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  protected select(index: number): void {
    this.results()[index]?.run();
  }

  protected close(): void {
    this.palette.close();
  }

  private async fetchPeople(q: string, token: number): Promise<void> {
    try {
      const res = await this.persons.getAll({
        searchStr: q,
        limit: PEOPLE_LIMIT,
        columns: ['id', 'first_name', 'last_name', 'email'],
      });
      if (token !== this.fetchToken) return; // a newer query superseded this one
      // Rows are plain objects from tRPC; treat them as records to read the fields we asked for.
      const raw = (res?.rows ?? []) as ReadonlyArray<Record<string, unknown>>;
      const rows = raw.slice(0, PEOPLE_LIMIT).map((r) => ({
        id: String(r['id']),
        name: [r['first_name'], r['last_name']].filter(Boolean).join(' ').trim() || 'Unnamed',
        email: typeof r['email'] === 'string' ? r['email'] : null,
      }));
      this.people.set(rows);
    } catch {
      if (token === this.fetchToken) this.people.set([]);
    }
  }

  private async fetchHouseholds(q: string, token: number): Promise<void> {
    try {
      const res = await this.households.getAll({
        searchStr: q,
        limit: HOUSEHOLDS_LIMIT,
        columns: ['id', 'street_num', 'street1', 'city'],
      });
      if (token !== this.fetchToken) return; // a newer query superseded this one
      const raw = (res?.rows ?? []) as ReadonlyArray<Record<string, unknown>>;
      const rows = raw.slice(0, HOUSEHOLDS_LIMIT).map((r) => ({
        id: String(r['id']),
        address: [r['street_num'], r['street1']].filter(Boolean).join(' ').trim() || 'No address',
        city: typeof r['city'] === 'string' && r['city'] ? r['city'] : null,
      }));
      this.householdHits.set(rows);
    } catch {
      if (token === this.fetchToken) this.householdHits.set([]);
    }
  }

  private filterPeople(q: string): void {
    void this.router.navigateByUrl('/people').then(() => this.searchSvc.doSearchImmediate(q));
  }

  private runAndClose(run: () => void): void {
    run();
    this.palette.close();
  }
}
