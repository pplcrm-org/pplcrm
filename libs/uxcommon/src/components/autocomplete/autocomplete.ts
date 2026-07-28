import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { debounce } from '../../../../common/src';

@Component({
  selector: 'pc-autocomplete',
  template: ` <div
      class="input w-full flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5 cursor-text"
      (click)="focusInput()"
    >
      <ng-content></ng-content>
      <input
        #inputEl
        type="text"
        class="grow basis-0 min-w-0 border-none bg-transparent p-0 focus:outline-none"
        [placeholder]="placeholder()"
        (keyup)="onKey($event)"
        (keydown)="onKeyDown($event)"
        (input)="onInput($event)"
        (focus)="showAutoCompleteList()"
        (blur)="hideAutoCompleteList()"
      />
    </div>
    @if (matches().length && !hideAutoComplete()) {
      <ul class="w-full rounded-none bordered card shadow-lg text-base-content/60">
        @for (match of matches(); track match) {
          <li class="tet-xs cursor-pointer hover:bg-gray-200 pl-4" (click)="reset(match)">
            {{ match.charAt(0).toUpperCase() + match.slice(1) }}
          </li>
        }
      </ul>
    }`,
})
export class AutoComplete {
  protected readonly matches = signal<string[]>([]);

  protected hideAutoComplete = signal(true);

  public readonly valueChange = output<string>();

  /** Emitted when Backspace is pressed while the text field is empty — lets the host pop the last chip. */
  public readonly backspaceEmpty = output<void>();

  public filterSvc = input<TFILTER | null>(null);
  public readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('inputEl');

  public placeholder = input('');

  private readonly debouncedFilter = debounce(async (key: string) => {
    const filterSvc = this.filterSvc();
    if (!filterSvc || !key?.length) {
      this.matches.set([]);
      return;
    }
    const matches = await filterSvc.filter(key);
    this.matches.set(matches);
  }, 250);

  protected onInput(event: Event) {
    const target = event.target as HTMLInputElement;
    this.debouncedFilter(target.value || '');
  }

  protected hideAutoCompleteList() {
    setTimeout(() => this.hideAutoComplete.set(true), 200);
  }

  protected onKey(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' || event.key === ',') {
      this.reset(target.value);
    }
  }

  protected onKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === 'Backspace' && target.value.length === 0) {
      this.backspaceEmpty.emit();
    }
  }

  protected focusInput() {
    this.inputRef()?.nativeElement.focus();
  }

  protected reset(key: string) {
    this.valueChange.emit(key);
    this.matches.set([]);
    if (this.inputRef()?.nativeElement) {
      this.inputRef().nativeElement.value = '';
    }
  }

  protected showAutoCompleteList() {
    this.hideAutoComplete.set(false);
  }
}

type TFILTER = {
  filter: (arg0: string) => Promise<string[]>;
};
