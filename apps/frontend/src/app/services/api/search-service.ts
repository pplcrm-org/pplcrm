import { Service, signal, debounced, effect, computed } from '@angular/core';

@Service()
export class SearchService {
  // Source raw search term
  private readonly _rawSearch = signal<string>('');

  /**
   * How many mounted DataGrids are consuming the term right now. The navbar reads
   * this to decide what ⌘K means on the current page: a grid is listening → the box
   * filters it; no grid → the box would be a dead input, so ⌘K opens the command
   * palette instead. Grids register in ngOnInit and unregister in ngOnDestroy.
   */
  private readonly _gridConsumers = signal(0);
  public readonly hasGridConsumer = computed(() => this._gridConsumers() > 0);

  public registerGridConsumer(): void {
    this._gridConsumers.update((n) => n + 1);
  }

  public unregisterGridConsumer(): void {
    this._gridConsumers.update((n) => Math.max(0, n - 1));
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
