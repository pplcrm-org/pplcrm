import { Component, inject, input, output, signal, computed } from '@angular/core';
import { SideDrawer } from '@uxcommon/components/side-drawer/side-drawer';
import { Icon } from '@uxcommon/components/icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConnectionsService } from '../../../services/api/connections-service';
import { PersonsService } from '../services/persons-service';
import { RELATION_TYPES, RELATION_TYPE_LABELS } from '../../../../../../../libs/common/src';
import type { AddConnectionType } from '../../../../../../../libs/common/src';

type PersonSearchResult = { id: string; first_name: string | null; last_name: string | null; email: string | null };

@Component({
  selector: 'pc-add-connection-drawer',
  imports: [SideDrawer, Icon],
  template: `
    <pc-side-drawer [isOpen]="isOpen()" title="Add Connection" i18n-title size="sm" i18n-size (close)="onClose()">
      <div class="flex flex-col gap-4">
        <!-- Person search -->
        <div class="flex flex-col gap-1.5">
          <label i18n class="text-sm font-semibold text-base-content/80">Search Contact</label>
          @if (selectedPerson()) {
            <div class="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-xl border border-primary/30">
              <div
                class="w-7 h-7 rounded-full bg-primary text-primary-content flex items-center justify-center text-xs font-bold flex-shrink-0"
              >
                {{ initials(selectedPerson()!) }}
              </div>
              <span class="text-sm font-medium flex-1 truncate"
                >{{ selectedPerson()!.first_name }} {{ selectedPerson()!.last_name }}</span
              >
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-circle"
                aria-label="Clear the selected person"
                title="Clear selection"
                (click)="clearSelection()"
              >
                <pc-icon name="x-mark" [size]="3"></pc-icon>
              </button>
            </div>
          } @else {
            <div class="relative">
              <input
                type="text"
                class="input input-bordered w-full pr-10 text-sm"
                placeholder="Type a name or email..."
                i18n-placeholder
                [value]="searchStr()"
                (input)="onSearchInput($event)"
              />
              <pc-icon
                name="magnifying-glass"
                [size]="4"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40 pointer-events-none"
              ></pc-icon>
            </div>
            @if (searchResults().length > 0) {
              <div class="border border-base-300 rounded-xl bg-base-100 shadow-lg max-h-48 overflow-y-auto">
                @for (p of searchResults(); track p.id) {
                  <button
                    type="button"
                    class="w-full text-left px-3 py-2.5 hover:bg-base-200 transition-colors flex items-center gap-2.5 border-b border-base-200 last:border-0"
                    (click)="selectPerson(p)"
                  >
                    <div
                      class="w-7 h-7 rounded-full bg-neutral text-neutral-content flex items-center justify-center text-xs font-bold flex-shrink-0"
                    >
                      {{ initials(p) }}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="text-sm font-medium truncate">{{ p.first_name }} {{ p.last_name }}</span>
                      @if (p.email) {
                        <span class="text-xs text-base-content/50 truncate">{{ p.email }}</span>
                      }
                    </div>
                  </button>
                }
              </div>
            }
            @if (isSearching() && searchStr().length > 0) {
              <span i18n class="text-xs text-base-content/40 italic">Searching...</span>
            }
          }
        </div>

        <!-- Relation type -->
        <div class="flex flex-col gap-1.5">
          <label i18n class="text-sm font-semibold text-base-content/80">Relationship Type</label>
          <select class="select select-bordered w-full text-sm" (change)="onRelationTypeChange($event)">
            <!-- Current value on the option, not on the select: a [value] binding on the
                 select runs before @for has made any options, so the browser falls back to
                 the first one — the drawer would read "Referred by" while it saved
                 "Close friend". -->
            @for (type of relationTypes; track type) {
              <option [value]="type" [selected]="type === relationType()">{{ relationTypeLabels[type] }}</option>
            }
          </select>
        </div>

        <!-- Custom label (shown when type = 'custom') -->
        @if (relationType() === 'custom') {
          <div class="flex flex-col gap-1.5">
            <label i18n class="text-sm font-semibold text-base-content/80">Custom Label</label>
            <input
              type="text"
              class="input input-bordered w-full text-sm"
              placeholder="e.g. Major donor contact, Advisor..."
              i18n-placeholder
              maxlength="100"
              [value]="customLabel()"
              (input)="onCustomLabelInput($event)"
            />
          </div>
        }

        <!-- Mutual toggle -->
        <div class="flex items-center justify-between">
          <div class="flex flex-col gap-0.5">
            <span i18n class="text-sm font-semibold text-base-content/80">Mutual Connection</span>
            <span i18n class="text-xs text-base-content/50">Shows on both profiles with ↔ indicator</span>
          </div>
          <input
            type="checkbox"
            class="toggle toggle-sm toggle-primary"
            [checked]="isMutual()"
            (change)="onMutualChange($event)"
          />
        </div>

        <!-- Notes -->
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-semibold text-base-content/80"
            >Notes <span i18n class="text-base-content/40 font-normal">(optional)</span></label
          >
          <textarea
            class="textarea textarea-bordered w-full text-sm resize-none"
            rows="3"
            placeholder="Add context about this connection..."
            i18n-placeholder
            maxlength="1000"
            [value]="notes()"
            (input)="onNotesInput($event)"
          ></textarea>
        </div>
      </div>

      <!-- Footer -->
      <div pc-drawer-footer class="p-4 border-t border-base-300 flex gap-2">
        <button i18n type="button" class="btn btn-ghost flex-1" (click)="onClose()" [disabled]="isSaving()">
          Cancel
        </button>
        <button i18n type="button" class="btn btn-primary flex-1" [disabled]="!canSave()" (click)="onSave()">
          @if (isSaving()) {
            <span class="loading loading-spinner loading-sm"></span>
          }
          Add Connection
        </button>
      </div>
    </pc-side-drawer>
  `,
})
export class AddConnectionDrawer {
  readonly personId = input.required<string>();
  readonly isOpen = input.required<boolean>();
  readonly closeDrawer = output<void>();
  readonly saved = output<any>();

  private readonly connectionsSvc = inject(ConnectionsService);
  private readonly personsSvc = inject(PersonsService);
  private readonly alertSvc = inject(AlertService);

  protected readonly searchStr = signal('');
  protected readonly searchResults = signal<PersonSearchResult[]>([]);
  protected readonly selectedPerson = signal<PersonSearchResult | null>(null);
  protected readonly relationType = signal<(typeof RELATION_TYPES)[number]>('close_friend');
  protected readonly customLabel = signal('');
  protected readonly isMutual = signal(false);
  protected readonly notes = signal('');
  protected readonly isSaving = signal(false);
  protected readonly isSearching = signal(false);

  protected readonly relationTypes = RELATION_TYPES;
  protected readonly relationTypeLabels = RELATION_TYPE_LABELS;

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly canSave = computed(() => {
    if (!this.selectedPerson() || this.isSaving()) return false;
    if (this.relationType() === 'custom' && !this.customLabel().trim()) return false;
    return true;
  });

  protected initials(p: PersonSearchResult) {
    return `${(p.first_name ?? '').charAt(0)}${(p.last_name ?? '').charAt(0)}`.toUpperCase() || '?';
  }

  protected onSearchInput(event: Event) {
    this.onSearchChange((event.target as HTMLInputElement).value);
  }

  protected onRelationTypeChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const match = RELATION_TYPES.find((t) => t === value);
    if (match) this.relationType.set(match);
  }

  protected onCustomLabelInput(event: Event) {
    this.customLabel.set((event.target as HTMLInputElement).value);
  }

  protected onMutualChange(event: Event) {
    this.isMutual.set((event.target as HTMLInputElement).checked);
  }

  protected onNotesInput(event: Event) {
    this.notes.set((event.target as HTMLTextAreaElement).value);
  }

  protected onSearchChange(value: string) {
    this.searchStr.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.isSearching.set(true);
    this.searchTimer = setTimeout(() => void this.executeSearch(value), 250);
  }

  private async executeSearch(value: string): Promise<void> {
    try {
      const result = await this.personsSvc.getAllWithAddress({ searchStr: value, startRow: 0, endRow: 10 });
      const currentPersonId = this.personId();
      this.searchResults.set(
        ((result as any).rows ?? [])
          .filter((p: any) => String(p.id) !== String(currentPersonId))
          .map((p: any) => ({ id: String(p.id), first_name: p.first_name, last_name: p.last_name, email: p.email })),
      );
    } catch {
      this.searchResults.set([]);
    } finally {
      this.isSearching.set(false);
    }
  }

  protected selectPerson(p: PersonSearchResult) {
    this.selectedPerson.set(p);
    this.searchStr.set('');
    this.searchResults.set([]);
  }

  protected clearSelection() {
    this.selectedPerson.set(null);
    this.searchStr.set('');
    this.searchResults.set([]);
  }

  protected async onSave() {
    const person = this.selectedPerson();
    if (!person) return;
    this.isSaving.set(true);
    try {
      const data: AddConnectionType = {
        to_person_id: person.id,
        relation_type: this.relationType(),
        custom_label: this.relationType() === 'custom' ? this.customLabel().trim() : null,
        is_mutual: this.isMutual(),
        notes: this.notes().trim() || null,
      };
      const result = await this.connectionsSvc.add(this.personId(), data);
      this.alertSvc.showSuccess('Connection added');
      this.saved.emit(result);
      this.resetForm();
      this.closeDrawer.emit();
    } catch (err) {
      if (err instanceof Error && err.message.includes('already exists')) {
        this.alertSvc.showError('A connection of this type already exists between these contacts.');
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  protected onClose() {
    this.resetForm();
    this.closeDrawer.emit();
  }

  private resetForm() {
    this.selectedPerson.set(null);
    this.searchStr.set('');
    this.searchResults.set([]);
    this.relationType.set('close_friend');
    this.customLabel.set('');
    this.isMutual.set(false);
    this.notes.set('');
  }
}
