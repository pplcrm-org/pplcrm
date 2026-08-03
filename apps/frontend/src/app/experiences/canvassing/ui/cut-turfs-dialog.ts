import { Component, type OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';

import { DOORS_PER_TURF_PRESETS } from '../../../../../../../libs/common/src';
import { ListsService } from '../../lists/services/lists-service';
import { CanvassingService, type CutPreview } from '../services/canvassing-service';

interface UniverseOption {
  id: string;
  name: string;
  count: number;
  is_dynamic: boolean;
}

// Assumed door-knocking pace for the time estimate helper.
const DOORS_PER_HOUR = 25;
const MIN_PER_HOUR = 60;

@Component({
  selector: 'pc-cut-turfs-dialog',
  imports: [Icon, ModalShell, RouterLink],
  templateUrl: './cut-turfs-dialog.html',
})
export class CutTurfsDialog implements OnInit {
  private readonly svc = inject(CanvassingService);
  private readonly listsSvc = inject(ListsService);
  private readonly alerts = inject(AlertService);

  public readonly done = output<number>();

  private readonly _loading = createLoadingGate();
  protected readonly loading = this._loading.visible;
  protected readonly saving = signal(false);

  protected readonly presets = DOORS_PER_TURF_PRESETS;
  protected readonly universes = signal<UniverseOption[]>([]);
  protected readonly selectedListId = signal<string>('');
  protected readonly doorsPerTurf = signal<number>(40);
  protected readonly preview = signal<CutPreview | null>(null);

  /**
   * Whether the workspace holds any boundary map. `null` means the question has not been answered
   * yet, or the read failed.
   *
   * This flag never decides whether a cut will be bounded — the preview's own `bounded` field,
   * resolved by the server for this cut, decides that. It plays two smaller parts: `false` shows
   * the up-front "no map yet" note (provable: with no boundary set on file, these turfs will
   * certainly be unbounded), and `true` lets an unbounded preview say the more useful thing —
   * that the map the workspace holds does not apply to this campaign's office.
   */
  protected readonly hasBoundaryMap = signal<boolean | null>(null);

  ngOnInit(): void {
    void this.loadUniverses();
    void this.loadBoundaryState();
  }

  private async loadBoundaryState(): Promise<void> {
    try {
      this.hasBoundaryMap.set(await this.svc.workspaceHasBoundaryMap());
    } catch {
      // A failed read must not put a claim about the workspace on screen. It stays unknown, the
      // note simply does not appear, and nothing about cutting is blocked.
      this.hasBoundaryMap.set(null);
    }
  }

  protected readonly selectedUniverse = computed<UniverseOption | null>(
    () => this.universes().find((u) => u.id === this.selectedListId()) ?? null,
  );

  /** "About 96 minutes per turf at 25 doors an hour." */
  protected readonly timeHelper = computed<string>(() => {
    const mins = Math.round((this.doorsPerTurf() / DOORS_PER_HOUR) * MIN_PER_HOUR);
    return `About ${mins} minutes per turf at ${DOORS_PER_HOUR} doors an hour.`;
  });

  protected async loadUniverses(): Promise<void> {
    const end = this._loading.begin();
    try {
      const res = await this.listsSvc.getAllWithCounts({ startRow: 0, endRow: 200 });
      const rows = Array.isArray(res) ? res : (res.rows ?? []);
      this.universes.set(
        rows.map((r: Record<string, unknown>) => {
          // lists.getAllWithCounts collapses its people_count/household_count
          // aggregates into a single `list_size` before returning (it picks the
          // one matching lists.object) — reading the raw aggregate names here
          // gave every universe a count of 0. Fallbacks cover the raw shape.
          const object = String(r['object'] ?? 'people');
          const rawCount = object === 'people' ? r['people_count'] : r['household_count'];
          const count = Number(r['list_size'] ?? rawCount ?? 0);
          return {
            id: String(r['id']),
            name: String(r['name'] ?? 'List'),
            count,
            is_dynamic: Boolean(r['is_dynamic']),
          };
        }),
      );
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to load lists.');
    } finally {
      end();
    }
  }

  protected onListChange(id: string): void {
    this.selectedListId.set(id);
    void this.refreshPreview();
  }

  protected setDoors(n: number): void {
    this.doorsPerTurf.set(n);
    void this.refreshPreview();
  }

  protected async refreshPreview(): Promise<void> {
    const listId = this.selectedListId();
    if (!listId) {
      this.preview.set(null);
      return;
    }
    const end = this._loading.begin();
    try {
      this.preview.set(await this.svc.previewCut({ list_id: listId, doors_per_turf: this.doorsPerTurf() }));
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to preview cut.');
      this.preview.set(null);
    } finally {
      end();
    }
  }

  protected async cut(): Promise<void> {
    const listId = this.selectedListId();
    if (!listId) return;
    this.saving.set(true);
    try {
      const res = await this.svc.cutTurfs({ list_id: listId, doors_per_turf: this.doorsPerTurf() });
      this.done.emit(res.created);
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to cut turfs.');
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    this.done.emit(0);
  }
}
