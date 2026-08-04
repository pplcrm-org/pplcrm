import { inject, signal, computed, Directive } from '@angular/core';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ConfirmDialogService } from '@uxcommon/components/confirm-dialog.service';
import { DuplicatesService } from './services/duplicates-service';

export interface DuplicateGroup<T> {
  reason: string;
  /** `potential_duplicates.group_key` — the identity a "Not duplicates" verdict is remembered
   * against (spec §9.3), and what the nightly sweep re-checks before re-flagging a pair. */
  groupKey: string;
  items: T[]; // Normalized array (replaces specific persons/households/companies arrays)
  selectedTargetId?: string;
  selectedSourceId?: string;
}

/** Spec §9.3: "Matched on same mobile number" / exact identifiers = high confidence; a
 * name-based heuristic match = possible. Derived from the sweep's own `reason` string rather
 * than a stored column — see `DuplicateMaintenanceService.recomputeAllDuplicates` for the
 * reason strings this matches against. */
export function confidenceFor(reason: string): 'high' | 'possible' {
  return /matching (email|address|company name)/i.test(reason) ? 'high' : 'possible';
}

/** "Matching Email: "x@y.com"" → "same email address". Keeps the why-flagged sentence honest
 * about what the sweep actually checked instead of inventing spec-mockup wording (mobile/ward
 * matching) that isn't implemented — see the Track D report for that deferral. */
export function whyFlaggedFor(reason: string): string {
  const cleaned = reason.replace(/^Matching\s+/i, '').replace(/:\s*".*"$/, '');
  return `Matched on: ${cleaned.toLowerCase()}`;
}

@Directive() // Needed for abstract classes using dependency injection in Angular
export abstract class BaseDuplicateManager<T extends { id: string; created_at: string | Date }> {
  protected readonly alertSvc = inject(AlertService);
  protected readonly dialogs = inject(ConfirmDialogService);
  protected readonly duplicatesSvc = inject(DuplicatesService);

  public readonly isLoading = signal(false);
  public readonly groups = signal<DuplicateGroup<T>[]>([]);

  public readonly currentPage = signal(1);
  public readonly pageSize = signal(10);
  public readonly totalGroups = signal(0);
  public readonly totalPages = computed(() => Math.ceil(this.totalGroups() / this.pageSize()));

  /** When the nightly sweep last ran — spec §9.3's "last sweep 3:04 AM" and the empty state's
   * "The sweep runs nightly at 3:00 AM." both want this. */
  public readonly lastSweepAt = signal<string | null>(null);

  /** "N possible duplicates waiting · found by the nightly sweep — ... · last sweep TIME".
   * The methodology clause names what `DuplicateMaintenanceService` actually checks (email, or
   * shared name at the same household/address) rather than the spec mockup's illustrative
   * phone/ward example — see the Track D report for why that substitution was made. */
  public readonly sweepSentence = computed(() => {
    const n = this.totalGroups();
    const noun = n === 1 ? 'duplicate' : 'duplicates';
    const lead = `${n.toLocaleString()} possible ${noun} waiting`;
    const method = 'found by the nightly sweep: email match, or shared name at the same household or address';
    const sweptAt = this.lastSweepAt();
    const time = sweptAt
      ? new Date(sweptAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
      : null;
    return time ? `${lead} · ${method} · last sweep ${time}` : `${lead} · ${method}`;
  });

  // Abstract methods the child components must implement
  protected abstract getEntityName(): string;
  protected abstract getItemDisplayName(item: T): string;
  protected abstract fetchFromService(options: {
    page: number;
    pageSize: number;
  }): Promise<{ groups: any[]; total: number }>;
  protected abstract getItemsFromRawGroup(rawGroup: any): T[];
  protected abstract mergeInService(targetId: string, sourceId: string): Promise<void>;

  /**
   * A consequence of THIS pair's merge that the confirmation must state, or null when there is
   * none. Override where merging can cost something the record comparison does not show; people
   * override it because merging two volunteer records revokes one person's companion access.
   * A warning shown on every merge would be noise, so this is asked per pair.
   */
  protected mergeWarning(
    _targetId: string,
    _sourceId: string,
    _names: { target: string; source: string },
  ): Promise<string | null> {
    return Promise.resolve(null);
  }

  public async loadDuplicates() {
    this.isLoading.set(true);
    try {
      const [response, sweepInfo] = await Promise.all([
        this.fetchFromService({
          page: this.currentPage(),
          pageSize: this.pageSize(),
        }),
        this.duplicatesSvc.getSweepInfo().catch(() => null),
      ]);

      if (sweepInfo) this.lastSweepAt.set(sweepInfo.lastSweepAt);
      this.totalGroups.set(response.total);

      const mappedGroups: DuplicateGroup<T>[] = response.groups.map((g) => {
        let selectedTargetId: string | undefined = undefined;
        let selectedSourceId: string | undefined = undefined;
        const items = this.getItemsFromRawGroup(g);

        const [firstItem, secondItem] = items;
        if (items.length === 2 && firstItem && secondItem) {
          const date0 = new Date(firstItem.created_at).getTime();
          const date1 = new Date(secondItem.created_at).getTime();
          if (date0 <= date1) {
            selectedTargetId = firstItem.id;
            selectedSourceId = secondItem.id;
          } else {
            selectedTargetId = secondItem.id;
            selectedSourceId = firstItem.id;
          }
        }
        return { reason: g.reason, groupKey: g.group_key, items, selectedTargetId, selectedSourceId };
      });
      this.groups.set(mappedGroups);
    } catch (_err) {
      this.alertSvc.showError(`Failed to fetch ${this.getEntityName()} duplicates`);
    } finally {
      this.isLoading.set(false);
    }
  }

  public selectRole(groupIndex: number, itemId: string, role: 'target' | 'source') {
    this.groups.update((current) => {
      const updated = [...current];

      // 1. Create a shallow copy of the group to avoid mutating the original reference
      const existingGroup = updated[groupIndex];
      if (!existingGroup) return current;
      const updatedGroup = { ...existingGroup };

      // 2. Apply your logic to the NEW object
      if (role === 'target') {
        updatedGroup.selectedTargetId = itemId;
        if (updatedGroup.selectedSourceId === itemId) updatedGroup.selectedSourceId = undefined;
      } else {
        updatedGroup.selectedSourceId = itemId;
        if (updatedGroup.selectedTargetId === itemId) updatedGroup.selectedTargetId = undefined;
      }

      // 3. Assign the new object back to the array
      updated[groupIndex] = updatedGroup;

      return updated;
    });
  }

  public async mergeGroup(groupIndex: number) {
    const group = this.groups()[groupIndex];
    if (!group) return;
    const targetId = group.selectedTargetId;
    const sourceId = group.selectedSourceId;
    if (!targetId || !sourceId) return;

    const targetItem = group.items.find((i) => i.id === targetId);
    const sourceItem = group.items.find((i) => i.id === sourceId);
    if (!targetItem || !sourceItem) return;

    const primaryName = this.getItemDisplayName(targetItem);
    const dupName = this.getItemDisplayName(sourceItem);

    const base = `Are you sure you want to merge "${dupName}" into "${primaryName}"? This action will permanently delete this duplicate ${this.getEntityName()} and cannot be undone.`;
    const extra = await this.mergeWarning(targetId, sourceId, { target: primaryName, source: dupName });

    const confirmed = await this.dialogs.confirm({
      title: 'Confirm Merge',
      message: extra ? `${base}\n\n${extra}` : base,
      variant: 'warning',
      confirmText: 'Merge',
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    try {
      await this.mergeInService(targetId, sourceId);
      this.alertSvc.showSuccess(`Successfully merged into "${primaryName}"`);

      let updatedGroups = this.groups().filter((_, idx) => idx !== groupIndex);
      updatedGroups = updatedGroups.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.id !== sourceId),
      }));

      const initialLength = updatedGroups.length;
      updatedGroups = updatedGroups.filter((g) => g.items.length > 1);
      const groupsRemovedCount = 1 + (initialLength - updatedGroups.length);

      this.groups.set(updatedGroups);
      this.totalGroups.update((t) => Math.max(0, t - groupsRemovedCount));

      if (updatedGroups.length === 0 && this.currentPage() > 1) {
        this.currentPage.update((p) => p - 1);
        void this.loadDuplicates();
      } else if (updatedGroups.length === 0 && this.totalGroups() > 0) {
        void this.loadDuplicates();
      }
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Merge failed');
    }
  }

  /** Quiet "Not duplicates" verdict (spec §9.3) — remembered server-side (`dismissed_duplicate_groups`)
   * so the nightly sweep never re-flags this exact group_key again. */
  public async dismissGroup(groupIndex: number) {
    const group = this.groups()[groupIndex];
    if (!group) return;

    try {
      await this.duplicatesSvc.dismissGroup(group.groupKey);
      this.alertSvc.showSuccess('Marked as not duplicates.');

      const updatedGroups = this.groups().filter((_, idx) => idx !== groupIndex);
      this.groups.set(updatedGroups);
      this.totalGroups.update((t) => Math.max(0, t - 1));

      if (updatedGroups.length === 0 && this.currentPage() > 1) {
        this.currentPage.update((p) => p - 1);
        void this.loadDuplicates();
      } else if (updatedGroups.length === 0 && this.totalGroups() > 0) {
        void this.loadDuplicates();
      }
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : "Couldn't dismiss this pair.");
    }
  }

  public nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((p) => p + 1);
      void this.loadDuplicates();
    }
  }

  public prevPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update((p) => p - 1);
      void this.loadDuplicates();
    }
  }
}
