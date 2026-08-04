import type { OnInit } from '@angular/core';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { Icon } from '@icons/icon';

import { debounce } from '../../../../../../../libs/common/src';
import { PersonsService } from '../../persons/services/persons-service';
import { CanvassingService, type TurfCanvasser } from '../services/canvassing-service';

interface PersonOption {
  id: string;
  name: string;
  contact: string;
}

/**
 * The canvasser roster for one turf (COMPANION-APPS-PLAN.md §5 B1).
 *
 * A turf holds as many volunteers as you put on it — a group walking it together is
 * the normal case, not an edge case — so this is add/remove, not a swap. Adding is
 * multi-select because volunteers arrive together.
 *
 * Companion links are personal: the access layer verifies each holder against their
 * own email/mobile on file, which is why membership starts with picking a person.
 */
@Component({
  selector: 'pc-assign-turf-dialog',
  imports: [FormsModule, Icon],
  template: `
    <dialog class="modal" [open]="true">
      <div class="modal-box flex max-w-lg flex-col gap-4">
        <div class="flex flex-col gap-0.5">
          <p class="pc-eyebrow">Canvassers</p>
          <h3 class="text-sm font-semibold">{{ turfName() }}</h3>
          <p class="text-xs text-base-content/60">{{ rosterSentence() }}</p>
        </div>

        @if (loadingRoster()) {
          <progress class="progress w-full"></progress>
        } @else if (rosterError()) {
          <div class="flex flex-col items-center gap-2 rounded-box border border-dashed border-base-300 p-6">
            <pc-icon name="exclamation-triangle" [size]="6" />
            <p class="text-xs text-base-content/60">Could not load the roster — try again</p>
            <button type="button" class="btn btn-outline btn-xs cursor-pointer" (click)="loadRoster()">
              Try again
            </button>
          </div>
        } @else if (roster().length > 0) {
          <ul class="flex flex-col rounded-box border border-base-300">
            @for (c of roster(); track c.person_id) {
              <li
                class="flex items-center justify-between gap-3 border-b border-base-300 p-3 last:border-b-0"
                [class.opacity-50]="busyPersonId() === c.person_id"
              >
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ c.name }}</p>
                  <p class="text-xs text-base-content/50">
                    {{ c.team_name ? c.team_name + ' · ' : '' }}Added {{ addedLabel(c) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-circle cursor-pointer"
                  [attr.aria-label]="'Remove ' + c.name + ' from this turf'"
                  [disabled]="busyPersonId() !== null"
                  (click)="remove(c)"
                >
                  <pc-icon name="x-mark" [size]="4" />
                </button>
              </li>
            }
          </ul>
        } @else {
          <div class="flex flex-col items-center gap-1 rounded-box border border-dashed border-base-300 p-6">
            <pc-icon name="identification" [size]="6" />
            <p class="text-xs text-base-content/60">Nobody is walking this turf yet.</p>
          </div>
        }

        <div class="flex flex-col gap-2">
          <label class="input input-bordered flex w-full items-center gap-2">
            <input
              type="text"
              class="grow"
              placeholder="Add canvassers by name…"
              aria-label="Search people to add"
              [ngModel]="query()"
              (ngModelChange)="onQuery($event)"
            />
          </label>

          @if (searching()) {
            <progress class="progress w-full"></progress>
          } @else if (options().length > 0) {
            <ul class="menu w-full rounded-box border border-base-300 bg-base-100 p-1">
              @for (opt of options(); track opt.id) {
                <li>
                  <button type="button" class="cursor-pointer" (click)="stage(opt)">
                    <span class="font-medium">{{ opt.name }}</span>
                    <span class="text-xs text-base-content/50">{{ opt.contact || 'No email or mobile on file' }}</span>
                  </button>
                </li>
              }
            </ul>
          } @else if (searchError()) {
            <p class="text-xs text-error">Search failed — try again</p>
          } @else if (query().trim().length > 1) {
            <p class="text-xs text-base-content/60">No people match. Check the spelling or add them first.</p>
          }

          @if (staged().length > 0) {
            <div class="flex flex-wrap gap-1">
              @for (s of staged(); track s.id) {
                <span class="badge badge-outline badge-secondary gap-1">
                  {{ s.name }}
                  <button
                    type="button"
                    class="cursor-pointer"
                    [attr.aria-label]="'Do not add ' + s.name"
                    (click)="unstage(s.id)"
                  >
                    <pc-icon name="x-mark" [size]="3" />
                  </button>
                </span>
              }
            </div>
            @if (stagedWithoutContact() > 0) {
              <p class="text-xs text-warning-content">
                {{ stagedWithoutContact() }} of them have no email or mobile on file. Their link will be created, but
                you will have to pass it on yourself.
              </p>
            }
          }
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-outline btn-accent btn-sm cursor-pointer" (click)="close()">Done</button>
          <button
            type="button"
            class="btn btn-primary btn-sm cursor-pointer"
            [disabled]="staged().length === 0 || saving()"
            (click)="save()"
          >
            {{ addLabel() }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" (click)="close()"></div>
    </dialog>
  `,
})
export class AssignTurfDialog implements OnInit {
  public readonly turfId = input.required<string>();
  public readonly turfName = input.required<string>();
  /** Emitted once on close so the page reloads the turf list. */
  public readonly closed = output<void>();
  /**
   * Emits each freshly minted link so the page can copy/announce it. `batchSize` is how
   * many people were staged in this save() call, so a consumer can tell a solo add (safe
   * to copy the link) from a multi-add (copying would only ever hold the last link).
   */
  public readonly assigned = output<{ token: string; sent: { email: boolean; sms: boolean }; batchSize: number }>();

  protected readonly busyPersonId = signal<string | null>(null);
  protected readonly options = signal<PersonOption[]>([]);
  protected readonly query = signal('');
  protected readonly roster = signal<TurfCanvasser[]>([]);
  protected readonly rosterError = signal(false);
  protected readonly saving = signal(false);
  protected readonly searchError = signal(false);
  protected readonly staged = signal<PersonOption[]>([]);

  protected readonly loadingRoster = computed(() => this.rosterGate.visible());
  protected readonly searching = computed(() => this.searchGate.visible());
  protected readonly stagedWithoutContact = computed(() => this.staged().filter((s) => !s.contact).length);

  private readonly alerts = inject(AlertService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly personsSvc = inject(PersonsService);
  private readonly rosterGate = createLoadingGate();
  private readonly searchGate = createLoadingGate();
  private readonly svc = inject(CanvassingService);

  private readonly debouncedSearch = debounce(async (term: string) => {
    if (term.trim().length < 2) {
      this.options.set([]);
      this.searchError.set(false);
      return;
    }
    const end = this.searchGate.begin();
    try {
      const res = await this.personsSvc.getAllWithAddress({ searchStr: term.trim(), startRow: 0, endRow: 8 });
      const rows = (res?.rows ?? []) as Record<string, unknown>[];
      const excluded = new Set([...this.roster().map((c) => c.person_id), ...this.staged().map((s) => s.id)]);
      this.options.set(
        rows
          .map((r) => ({
            id: String(r['id']),
            name: [r['first_name'], r['last_name']].filter(Boolean).join(' ') || String(r['name'] ?? 'Unnamed person'),
            contact: [r['email'], r['mobile']].filter(Boolean).join(' · '),
          }))
          .filter((o) => !excluded.has(o.id)),
      );
      this.searchError.set(false);
    } catch {
      this.options.set([]);
      this.searchError.set(true);
    } finally {
      end();
    }
  }, 250);

  /**
   * Init, not the constructor: `turfId` is bound after this component is constructed, so
   * `loadRoster()` used to read it too early, throw NG0950, and hit its own catch — the
   * roster came up empty every time the dialog opened.
   */
  public ngOnInit(): void {
    void this.loadRoster();
  }

  protected addedLabel(c: TurfCanvasser): string {
    if (!c.assigned_at) return 'recently';
    return new Date(c.assigned_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  protected addLabel(): string {
    const count = this.staged().length;
    if (this.saving()) return 'Adding…';
    if (count === 0) return 'Add canvassers';
    return count === 1 ? 'Add 1 canvasser' : `Add ${count} canvassers`;
  }

  protected close(): void {
    this.closed.emit();
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.debouncedSearch(value);
  }

  protected async remove(c: TurfCanvasser): Promise<void> {
    const ok = await this.confirm.confirm({
      confirmText: 'Remove from turf',
      message: `${c.name}'s link stops working right away. Doors they already knocked stay on the turf, credited to them.`,
      title: `Remove ${c.name}?`,
      variant: 'danger',
    });
    if (!ok) return;

    this.busyPersonId.set(c.person_id);
    try {
      await this.svc.removeCanvasser({ turf_id: this.turfId(), volunteer_person_id: c.person_id });
      this.alerts.showSuccess(`Removed ${c.name} from this turf.`);
      await this.loadRoster();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to remove the canvasser.');
    } finally {
      this.busyPersonId.set(null);
    }
  }

  protected rosterSentence(): string {
    const count = this.roster().length;
    if (this.loadingRoster()) return 'Loading the roster…';
    if (this.rosterError()) return 'Could not load the roster.';
    if (count === 0) return 'No canvassers yet. Anyone you add gets their own personal link.';
    return count === 1 ? '1 canvasser walking this turf' : `${count} canvassers walking this turf`;
  }

  /**
   * Add every staged person. Each gets their own link, so one failure must not
   * discard the rest — they are reported individually and the roster still reloads.
   */
  protected async save(): Promise<void> {
    const people = this.staged();
    if (people.length === 0 || this.saving()) return;
    this.saving.set(true);
    const failed: string[] = [];
    try {
      for (const person of people) {
        try {
          const res = await this.svc.assign({
            team_id: null,
            turf_id: this.turfId(),
            volunteer_person_id: person.id,
          });
          this.assigned.emit({ ...res, batchSize: people.length });
        } catch {
          failed.push(person.name);
        }
      }
      if (failed.length > 0) {
        this.alerts.showError(`Could not add ${failed.join(', ')}. Everyone else was added.`);
      }
      this.staged.set([]);
      this.query.set('');
      this.options.set([]);
      await this.loadRoster();
    } finally {
      this.saving.set(false);
    }
  }

  protected stage(opt: PersonOption): void {
    this.staged.update((list) => (list.some((s) => s.id === opt.id) ? list : [...list, opt]));
    this.options.update((list) => list.filter((o) => o.id !== opt.id));
  }

  protected unstage(id: string): void {
    this.staged.update((list) => list.filter((s) => s.id !== id));
  }

  protected async loadRoster(): Promise<void> {
    const end = this.rosterGate.begin();
    try {
      this.roster.set(await this.svc.getCanvassers(this.turfId()));
      this.rosterError.set(false);
    } catch {
      this.roster.set([]);
      this.rosterError.set(true);
    } finally {
      end();
    }
  }
}
