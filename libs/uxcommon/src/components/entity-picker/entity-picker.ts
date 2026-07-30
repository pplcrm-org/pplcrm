import { Component, computed, input, model, signal } from '@angular/core';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';

/**
 * One option in a `pc-entity-picker`. `hint` is the quiet second line (an email,
 * "Dynamic · people"); `badge` is a trailing chip that says something about the
 * option's role ("Captain").
 */
export interface PcPickerOption {
  badge?: string | null;
  hint?: string | null;
  id: string;
  label: string;
}

/**
 * The one idiom for "pick many records out of a known set" (design §4).
 *
 * A native `<select multiple>` fails every test in the doctrine: it hides the
 * Ctrl/Cmd requirement behind a help sentence, gives no search, truncates long
 * names, and needs a second read-only pane to show what you picked — a pane that
 * drifts out of sync the moment anyone forgets to update it. This is one surface:
 * search, the current selection as removable chips, and the checkbox list, all
 * reading from the same `selectedIds` model, so it cannot disagree with itself.
 */
@Component({
  selector: 'pc-entity-picker',
  imports: [EmptyState, Icon],
  styleUrl: './entity-picker.css',
  template: `
    <div class="space-y-1.5">
      <div class="flex items-baseline justify-between gap-3">
        <span class="pc-eyebrow">{{ label() }}</span>
        <span class="text-[11px] tabular-nums text-base-content/60">{{ summary() }}</span>
      </div>

      <div class="pc-panel overflow-hidden">
        <!-- Search -->
        <div class="relative border-b border-base-200">
          <!-- pc-icon copies its own class onto an inner div, so positioning utilities put
               on it would apply twice. Position the wrapper, colour the icon. -->
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40">
            <pc-icon name="magnifying-glass" [size]="4" />
          </span>
          <input
            type="search"
            class="w-full bg-transparent py-2.5 pl-10 pr-3 text-xs outline-none placeholder:text-base-content/40"
            [attr.aria-label]="'Search ' + plural()"
            [placeholder]="'Search ' + plural() + '…'"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
          />
        </div>

        <!-- Current selection, removable. This IS the "currently assigned" list. -->
        @if (selectedOptions().length) {
          <div class="flex flex-wrap items-center gap-1.5 border-b border-base-200 bg-base-200/40 px-2.5 py-2">
            @for (option of selectedOptions(); track option.id) {
              <button
                type="button"
                class="badge badge-primary badge-sm cursor-pointer gap-1 pr-1.5"
                [attr.aria-label]="'Remove ' + option.label"
                (click)="deselect(option.id)"
              >
                <span class="max-w-40 truncate">{{ option.label }}</span>
                <pc-icon name="x-mark" [size]="3" />
              </button>
            }
            <button type="button" class="btn btn-ghost btn-xs ml-auto" (click)="clearAll()">Clear all</button>
          </div>
        }

        <!-- Options -->
        <div class="max-h-64 overflow-y-auto">
          @for (option of filtered(); track option.id) {
            <label
              class="pc-picker-row flex cursor-pointer select-none items-center gap-2.5 px-3 py-2 transition-colors hover:bg-base-200/60"
              [class.is-selected]="isSelected(option.id)"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-primary checkbox-xs"
                [checked]="isSelected(option.id)"
                (change)="toggle(option.id)"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-medium text-base-content">{{ option.label }}</span>
                @if (option.hint) {
                  <span class="block truncate text-[10px] text-base-content/50">{{ option.hint }}</span>
                }
              </span>
              @if (option.badge) {
                <span class="badge badge-ghost badge-xs shrink-0">{{ option.badge }}</span>
              }
            </label>
          } @empty {
            @if (search()) {
              <pc-empty-state
                icon="magnifying-glass"
                [bordered]="false"
                [title]="'No ' + plural() + ' match “' + search() + '”'"
              >
                <button type="button" class="btn btn-outline btn-secondary btn-xs" (click)="search.set('')">
                  Clear search
                </button>
              </pc-empty-state>
            } @else {
              <pc-empty-state [icon]="emptyIcon()" [bordered]="false" [title]="emptyTitle()" [hint]="emptyHint()">
                <ng-content select="[pc-picker-empty-action]" />
              </pc-empty-state>
            }
          }
        </div>

        <!-- Bulk action, scoped to what the search actually shows -->
        @if (selectableMatches().length > 1) {
          <div class="border-t border-base-200 px-2.5 py-1.5 text-right">
            <button type="button" class="btn btn-ghost btn-xs" (click)="selectAllMatching()">
              Select {{ search() ? 'all ' + selectableMatches().length + ' matching' : 'all ' + plural() }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class EntityPicker {
  protected readonly search = signal('');

  /** Icon for the "there is nothing to pick from" state. */
  public readonly emptyIcon = input<PcIconNameType>('inbox-stack');
  public readonly emptyHint = input<string>();
  public readonly emptyTitle = input<string>('Nothing to choose from yet');

  /** The micro-label above the picker, e.g. "Volunteers". */
  public readonly label = input.required<string>();
  public readonly options = input.required<PcPickerOption[]>();

  /** Plural noun used in copy: "3 of 42 volunteers selected". */
  public readonly plural = input.required<string>();

  public readonly selectedIds = model<string[]>([]);

  protected readonly selectedSet = computed(() => new Set(this.selectedIds()));

  /** Selection order follows the option order, so the chips never shuffle. */
  protected readonly selectedOptions = computed(() => this.options().filter((o) => this.selectedSet().has(o.id)));

  protected readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.options();
    return this.options().filter(
      (o) => o.label.toLowerCase().includes(term) || (o.hint ?? '').toLowerCase().includes(term),
    );
  });

  protected readonly selectableMatches = computed(() => this.filtered().filter((o) => !this.selectedSet().has(o.id)));

  protected readonly summary = computed(() => {
    const total = this.options().length;
    const selected = this.selectedIds().length;
    if (total === 0) return '';
    if (this.search().trim()) {
      return `${selected} selected · ${this.filtered().length} of ${total} shown`;
    }
    return `${selected} of ${total} ${this.plural()} selected`;
  });

  protected clearAll(): void {
    this.selectedIds.set([]);
  }

  protected deselect(id: string): void {
    this.selectedIds.set(this.selectedIds().filter((existing) => existing !== id));
  }

  protected isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  protected selectAllMatching(): void {
    this.selectedIds.set([...this.selectedIds(), ...this.selectableMatches().map((o) => o.id)]);
  }

  protected toggle(id: string): void {
    if (this.selectedSet().has(id)) {
      this.deselect(id);
      return;
    }
    this.selectedIds.set([...this.selectedIds(), id]);
  }
}
