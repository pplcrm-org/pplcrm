import { Service, signal, debounced, effect } from '@angular/core';

@Service()
export class SearchService {
  // Source raw search term
  private readonly _rawSearch = signal<string>('');

  /**
   * How many mounted DataGrids are consuming the term right now. The navbar reads
   * this to decide what ⌘K means on the current page: a grid is listening → the box
   * filters it; no grid → the box would be a dead input, so ⌘K opens the command
   * palette instead. Grids register in ngOnInit and unregister in ngOnDestroy.
   *
   * Tracked by ELEMENT, not by counter: grid pages are kept alive by the route-reuse strategy,
   * which detaches them without ever running ngOnDestroy, so a counter never came back down and
   * ⌘K stayed captured by a grid that was no longer on screen for the rest of the session
   * (REVIEW7 D4). A detached component's element has `isConnected === false`, so checking at
   * ask-time answers for the page actually showing; the Set keeps at most one entry per live
   * grid instance and the reuse cache is capped at five, so the sweep is a handful of elements.
   */
  private readonly gridConsumers = new Set<Element>();

  public hasGridConsumer(): boolean {
    for (const el of this.gridConsumers) {
      if (el.isConnected) return true;
    }
    return false;
  }

  public registerGridConsumer(el: Element): void {
    this.gridConsumers.add(el);
  }

  public unregisterGridConsumer(el: Element): void {
    this.gridConsumers.delete(el);
  }

  // Native debounced signal
  private readonly _debouncedSearch = debounced(() => this._rawSearch(), 300);

  public readonly searchSignal = signal<string>('');

  constructor() {
    // Keep public searchSignal in sync with native debounced signal
    effect(() => {
      const val = this._debouncedSearch.value();
      if (val !== undefined) {
        this.searchSignal.set(val);
      }
    });
  }

  public clearSearch(): void {
    if (this._rawSearch() !== '') {
      this._rawSearch.set('');
      this.searchSignal.set('');
    }
  }

  public doSearch(value: string): void {
    const norm = this.normalize(value);
    if (norm !== this._rawSearch()) {
      this._rawSearch.set(norm);
    }
  }

  public getFilterText(): string {
    return this.searchSignal();
  }

  public doSearchImmediate(value: string): void {
    const norm = this.normalize(value);
    if (norm !== this._rawSearch()) {
      this._rawSearch.set(norm);
    }
    if (norm !== this.searchSignal()) {
      this.searchSignal.set(norm);
    }
  }

  // Simple normalization to avoid redraws caused by cosmetic changes
  private normalize(v: string): string {
    return String(v ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
