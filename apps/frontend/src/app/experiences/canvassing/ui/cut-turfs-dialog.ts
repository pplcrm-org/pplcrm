import { Component, type OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { createLoadingGate } from '@uxcommon/loading-gate';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { Icon } from '@icons/icon';
import type { PcIconNameType } from '@icons/icons.index';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';

import type { CanvassUniversePreset, TurfMode, TurfTravel } from '../../../../../../../libs/common/src';
import {
  CANVASS_UNIVERSE_DESCRIPTIONS,
  CANVASS_UNIVERSE_LABELS,
  DEFAULT_NOT_RECENT_DAYS,
  DOORS_PER_TURF_PRESETS,
  TURF_TRAVEL_LABELS,
  TURF_TRAVEL_MODES,
} from '../../../../../../../libs/common/src';
import { ListsService } from '../../lists/services/lists-service';
import { CanvassingService, type CutPreview } from '../services/canvassing-service';

interface UniverseOption {
  id: string;
  name: string;
  count: number;
  is_dynamic: boolean;
}

/** The universe pickers the wizard offers: the named presets, plus "an existing list". */
type UniverseChoice = CanvassUniversePreset | 'list';

/**
 * The mode cards. Delivery is deliberately absent until the delivery-mode door
 * flow exists (Phase 2 of the turfs-absorb-deliveries plan) — a card that cuts
 * turfs no companion screen can walk yet would be a lie.
 */
const MODE_CARDS: { mode: TurfMode; label: string; description: string; icon: PcIconNameType }[] = [
  {
    mode: 'canvass',
    label: 'Every door',
    description: 'Knock every door in the universe — survey, issues, follow-ups.',
    icon: 'map',
  },
  {
    mode: 'gotv',
    label: 'GOTV',
    description: 'Remind identified supporters to vote. Quick taps, not a survey.',
    icon: 'megaphone',
  },
];

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
  protected readonly resolving = signal(false);

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly modeCards = MODE_CARDS;
  protected readonly mode = signal<TurfMode>('canvass');

  /** Step 2 — the named presets shown as cards, in this order. */
  protected readonly presetChoices: readonly CanvassUniversePreset[] = [
    'everyone',
    'supporters',
    'untouched',
    'not_recent',
  ];
  protected readonly presetLabels = CANVASS_UNIVERSE_LABELS;
  protected readonly presetDescriptions = CANVASS_UNIVERSE_DESCRIPTIONS;
  protected readonly universeChoice = signal<UniverseChoice | null>(null);
  protected readonly notRecentDays = signal<number>(DEFAULT_NOT_RECENT_DAYS);
  protected readonly universes = signal<UniverseOption[]>([]);
  protected readonly selectedListId = signal<string>('');

  /**
   * What step 2 resolved to: the smart list behind the chosen preset (created
   * or found by the server), the picked existing list, or null for "Everyone"
   * — which is deliberately not a list at all.
   */
  protected readonly resolvedListId = signal<string | null>(null);
  protected readonly resolvedListName = signal<string | null>(null);

  protected readonly presets = DOORS_PER_TURF_PRESETS;
  protected readonly doorsPerTurf = signal<number>(40);
  protected readonly travelModes = TURF_TRAVEL_MODES;
  protected readonly travelLabels = TURF_TRAVEL_LABELS;
  protected readonly travel = signal<TurfTravel>('walk');
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

  /** The sentence naming what step 2 chose, shown at the top of step 3. */
  protected readonly universeSummary = computed<string>(() => {
    const choice = this.universeChoice();
    if (choice === 'everyone') return 'Everyone — every located household in the workspace';
    const name = this.resolvedListName();
    return name ? `List: ${name}` : '';
  });

  /** "About 96 minutes per turf at 25 doors an hour." Walking pace — a drive is faster. */
  protected readonly timeHelper = computed<string>(() => {
    const mins = Math.round((this.doorsPerTurf() / DOORS_PER_HOUR) * MIN_PER_HOUR);
    return `About ${mins} minutes per turf at ${DOORS_PER_HOUR} doors an hour on foot.`;
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

  protected chooseMode(mode: TurfMode): void {
    this.mode.set(mode);
    // GOTV is by definition a supporters walk — pre-select the matching universe,
    // still changeable on the next step.
    if (mode === 'gotv' && this.universeChoice() == null) this.universeChoice.set('supporters');
    this.step.set(2);
  }

  protected choosePreset(preset: CanvassUniversePreset): void {
    this.universeChoice.set(preset);
  }

  protected chooseList(): void {
    this.universeChoice.set('list');
  }

  protected onListChange(id: string): void {
    this.selectedListId.set(id);
    this.universeChoice.set('list');
  }

  protected setDays(raw: string): void {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 365) this.notRecentDays.set(n);
  }

  /** Step 2 → 3: turn the chosen universe into a list id (or null for Everyone). */
  protected async continueToSize(): Promise<void> {
    const choice = this.universeChoice();
    if (choice == null) return;
    if (choice === 'list' && !this.selectedListId()) return;

    this.resolving.set(true);
    try {
      if (choice === 'everyone') {
        this.resolvedListId.set(null);
        this.resolvedListName.set(null);
      } else if (choice === 'list') {
        this.resolvedListId.set(this.selectedListId());
        this.resolvedListName.set(this.selectedUniverse()?.name ?? null);
      } else {
        const res = await this.svc.ensureUniverseList({
          preset: choice,
          days: choice === 'not_recent' ? this.notRecentDays() : undefined,
        });
        this.resolvedListId.set(res.list_id);
        this.resolvedListName.set(res.name);
      }
      this.step.set(3);
      await this.refreshPreview();
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to prepare that universe.');
    } finally {
      this.resolving.set(false);
    }
  }

  protected back(): void {
    const s = this.step();
    if (s === 3) {
      this.preview.set(null);
      this.step.set(2);
    } else if (s === 2) {
      this.step.set(1);
    }
  }

  protected setDoors(n: number): void {
    this.doorsPerTurf.set(n);
    void this.refreshPreview();
  }

  protected setTravel(travel: TurfTravel): void {
    this.travel.set(travel);
  }

  protected async refreshPreview(): Promise<void> {
    const end = this._loading.begin();
    try {
      this.preview.set(
        await this.svc.previewCut({ list_id: this.resolvedListId(), doors_per_turf: this.doorsPerTurf() }),
      );
    } catch (err) {
      this.alerts.showError(err instanceof Error && err.message ? err.message : 'Failed to preview cut.');
      this.preview.set(null);
    } finally {
      end();
    }
  }

  protected async cut(): Promise<void> {
    this.saving.set(true);
    try {
      const res = await this.svc.cutTurfs({
        list_id: this.resolvedListId(),
        doors_per_turf: this.doorsPerTurf(),
        mode: this.mode(),
        travel: this.travel(),
      });
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
