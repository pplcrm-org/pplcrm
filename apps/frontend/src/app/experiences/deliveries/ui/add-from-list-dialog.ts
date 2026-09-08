import { ChangeDetectionStrategy, Component, type OnInit, inject, output, signal } from '@angular/core';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';

import type { DeliveryPurpose } from '../../../../../../../libs/common/src';
import { DELIVERY_PURPOSE_LABELS } from '../../../../../../../libs/common/src';
import { ListsService } from '../../lists/services/lists-service';
import { DeliveriesRequestsService } from '../services/deliveries-requests-service';

interface ListOption {
  id: string;
  name: string;
  count: number;
  is_dynamic: boolean;
}

/**
 * Bulk targeting intake: "flyer this list" as one action. Picks a list and a kind, and the
 * server creates one APPROVED request per eligible household — DNC-only households and
 * households already holding an open request of that kind are skipped, and the batch stops
 * at the server's cap. The result toast reports each of those numbers, because a staff
 * member who asked for 900 doors and got 640 requests deserves the arithmetic.
 */
@Component({
  selector: 'pc-add-from-list-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalShell],
  template: `
    <pc-modal-shell [open]="true" (closed)="cancel()" title="Add requests from a list" icon="map-pin">
      <p class="-mt-3 text-sm text-base-content/60">
        Creates one <strong>approved</strong> request per household in the list, ready to cut into delivery outings.
        Households that asked not to be contacted, and households already owed one of the same kind, are skipped.
      </p>

      <label class="form-control mt-4 w-full">
        <span class="label-text font-medium">Which list</span>
        <select
          class="select select-bordered select-sm mt-2 w-full"
          [value]="selectedListId()"
          (change)="selectedListId.set($any($event.target).value)"
          aria-label="Which list"
        >
          <option value="" disabled>Select a list…</option>
          @for (l of lists(); track l.id) {
            <option [value]="l.id">
              {{ l.name }} — {{ l.count.toLocaleString() }} {{ l.is_dynamic ? '(smart)' : '(static)' }}
            </option>
          }
        </select>
      </label>

      <div class="form-control mt-4">
        <span class="label-text font-medium">What are they owed?</span>
        <div class="mt-2 flex gap-2">
          @for (p of purposes; track p) {
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-primary]="purpose() === p"
              [class.btn-outline]="purpose() !== p"
              [class.btn-accent]="purpose() !== p"
              (click)="purpose.set(p)"
            >
              {{ purposeLabels[p] }}
            </button>
          }
        </div>
      </div>

      <div pc-modal-footer class="flex gap-2">
        <button type="button" class="btn btn-outline btn-accent" (click)="cancel()">Cancel</button>
        <button type="button" class="btn btn-primary" [disabled]="saving() || !selectedListId()" (click)="confirm()">
          @if (saving()) {
            <span class="loading loading-spinner loading-sm"></span>
          }
          Create requests
        </button>
      </div>
    </pc-modal-shell>
  `,
})
export class AddFromListDialog implements OnInit {
  private readonly svc = inject(DeliveriesRequestsService);
  private readonly listsSvc = inject(ListsService);
  private readonly alerts = inject(AlertService);

  /** Emits how many requests were created; 0 covers both "none eligible" and cancel. */
  public readonly done = output<number>();

  protected readonly lists = signal<ListOption[]>([]);
  protected readonly selectedListId = signal<string>('');
  protected readonly purposes: readonly DeliveryPurpose[] = ['yard_sign', 'flyer'];
  protected readonly purposeLabels = DELIVERY_PURPOSE_LABELS;
  protected readonly purpose = signal<DeliveryPurpose>('flyer');
  protected readonly saving = signal(false);

  public ngOnInit(): void {
    void this.loadLists();
  }

  protected cancel(): void {
    this.done.emit(0);
  }

  protected async confirm(): Promise<void> {
    const listId = this.selectedListId();
    if (!listId) return;
    this.saving.set(true);
    try {
      const res = await this.svc.addFromList({ list_id: listId, purpose: this.purpose() });
      this.alerts.showSuccess(this.resultMessage(res));
      this.done.emit(res.created);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Could not create the requests.');
    } finally {
      this.saving.set(false);
    }
  }

  /** The arithmetic, spelled out: created, skipped-already-open, skipped-DNC, and the cap. */
  private resultMessage(res: {
    created: number;
    skipped_open: number;
    skipped_barred: number;
    capped: boolean;
  }): string {
    const noun = this.purposeLabels[this.purpose()].toLowerCase();
    const parts = [`Created ${res.created.toLocaleString()} approved ${noun} request${res.created === 1 ? '' : 's'}`];
    if (res.skipped_open > 0) parts.push(`${res.skipped_open.toLocaleString()} already had one open`);
    if (res.skipped_barred > 0) parts.push(`${res.skipped_barred.toLocaleString()} skipped for do-not-contact`);
    let message = `${parts.join(' · ')}.`;
    if (res.capped) message += ' The list was larger than one batch allows — run this again for the rest.';
    return message;
  }

  private async loadLists(): Promise<void> {
    try {
      const res = await this.listsSvc.getAllWithCounts({ startRow: 0, endRow: 200 });
      const rows = Array.isArray(res) ? res : (res.rows ?? []);
      this.lists.set(
        rows.map((r: Record<string, unknown>) => {
          const object = String(r['object'] ?? 'people');
          const rawCount = object === 'people' ? r['people_count'] : r['household_count'];
          return {
            id: String(r['id']),
            name: String(r['name'] ?? 'List'),
            count: Number(r['list_size'] ?? rawCount ?? 0),
            is_dynamic: Boolean(r['is_dynamic']),
          };
        }),
      );
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load lists.');
    }
  }
}
