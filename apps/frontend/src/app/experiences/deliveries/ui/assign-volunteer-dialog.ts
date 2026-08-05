import { Component, inject, output, signal, viewChild } from '@angular/core';
import { Icon } from '@icons/icon';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';

import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { PersonsService } from '../../persons/services/persons-service';

type PersonSearchResult = { id: string; first_name: string | null; last_name: string | null; email: string | null };

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 10;

/**
 * Assign (or clear) the volunteer who drives a delivery route (spec §14). Debounced person
 * search mirrors the "Record donation" donor picker. Emits the chosen person — or `null` to
 * unassign — and lets the parent own the mutation, reload, and toast (same as the page's other
 * actions). The volunteer link is personal, so a route needs a volunteer before it can be minted.
 */
@Component({
  selector: 'pc-assign-volunteer-dialog',
  imports: [Icon, ModalShell],
  templateUrl: './assign-volunteer-dialog.html',
})
export class AssignVolunteerDialog {
  private readonly personsSvc = inject(PersonsService);
  private readonly dlgRef = viewChild.required<ModalShell>('dlg');

  /** Emits the picked person, or `null` when the current volunteer is removed. */
  public readonly selected = output<PersonSearchResult | null>();

  protected readonly search = signal('');
  protected readonly results = signal<PersonSearchResult[]>([]);
  protected readonly isSearching = signal(false);
  protected readonly hasCurrent = signal(false);
  /** Non-null when the search request itself failed, which is not the same as finding nobody. */
  protected readonly searchError = signal<string | null>(null);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** @param hasVolunteer whether the route already has a volunteer (enables "Remove volunteer"). */
  public open(hasVolunteer: boolean): void {
    this.reset();
    this.hasCurrent.set(hasVolunteer);
    this.dlgRef().show();
  }

  public close(): void {
    this.dlgRef().close();
  }

  protected initials(p: PersonSearchResult): string {
    return `${(p.first_name ?? '').charAt(0)}${(p.last_name ?? '').charAt(0)}`.toUpperCase() || '?';
  }

  protected onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchError.set(null);
    if (!value.trim()) {
      this.results.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = setTimeout(() => void this.executeSearch(value), SEARCH_DEBOUNCE_MS);
  }

  private async executeSearch(value: string): Promise<void> {
    try {
      const result = await this.personsSvc.getAllWithAddress({
        searchStr: value,
        startRow: 0,
        endRow: SEARCH_PAGE_SIZE,
      });
      const rows = (result as { rows?: unknown[] })?.rows ?? [];
      this.results.set(
        rows.map((raw) => {
          const p = raw as { id: string; first_name: string | null; last_name: string | null; email: string | null };
          return { id: String(p.id), first_name: p.first_name, last_name: p.last_name, email: p.email };
        }),
      );
      this.searchError.set(null);
    } catch (err) {
      this.results.set([]);
      this.searchError.set(getUserErrorMessage(err, 'Could not search your people.'));
    } finally {
      this.isSearching.set(false);
    }
  }

  /** Re-runs the last search after a failure, so the user does not have to retype it. */
  protected retrySearch(): void {
    const value = this.search();
    if (!value.trim()) return;
    this.searchError.set(null);
    this.isSearching.set(true);
    void this.executeSearch(value);
  }

  protected pick(p: PersonSearchResult): void {
    this.selected.emit(p);
    this.close();
  }

  protected removeVolunteer(): void {
    this.selected.emit(null);
    this.close();
  }

  private reset(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.search.set('');
    this.results.set([]);
    this.isSearching.set(false);
    this.searchError.set(null);
  }
}
