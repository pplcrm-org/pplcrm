import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CdkDrag, CdkDragPlaceholder, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import {
  TASK_BOARD_STATUSES,
  TASK_STATUS_LABELS,
  TaskBoardStatus,
  UpdateTaskType,
} from '../../../../../../../libs/common/src';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';

import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../services/tasks-service';
import { computeTaskSla } from '../services/task-sla';

interface BoardTask {
  id: string;
  name: string;
  status: TaskBoardStatus;
  priority: string | null;
  assigned_to: string | null;
  due_at: string | null;
  created_at: string | null;
  details: string | null;
  team_name: string | null;
  position: number;
}

const CARD_FLASH_MS = 1200;

/** Prefix for each column's cdkDropList id — connected lists reference these by string. */
const BOARD_COL_PREFIX = 'board-col-';

@Component({
  selector: 'pc-tasks-board',
  imports: [Icon, CdkDropList, CdkDrag, CdkDragPlaceholder],
  templateUrl: './tasks-board.html',
})
export class TasksBoard implements OnInit {
  private readonly router = inject(Router);
  private readonly svc = inject(TasksService);
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly settingsSvc = inject(SettingsService);
  private readonly alerts = inject(AlertService);

  protected readonly columns = TASK_BOARD_STATUSES;
  protected readonly statusLabels = TASK_STATUS_LABELS;

  /** True once the first board fetch has settled — guards the column skeletons. */
  protected readonly loaded = signal(false);

  /** Placeholder cards for the first-load skeleton, per column. */
  protected readonly skeletonCards = Array.from({ length: 3 }, (_, i) => i);

  protected readonly tasks = signal<BoardTask[]>([]);
  protected readonly usersById = signal<Map<string, string>>(new Map());
  protected readonly flashedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly counts = signal<{
    assignedToMe: number;
    openTotal: number;
    slaBreaches: number;
    unassigned: number;
  } | null>(null);

  protected readonly grouped = computed(() => {
    const map = new Map<TaskBoardStatus, BoardTask[]>(this.columns.map((c) => [c, []]));
    for (const t of this.tasks()) {
      map.get(t.status)?.push(t);
    }
    // Deterministic within-column order: manual position first, oldest-first tiebreak.
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position || this.createdAtCompare(a, b));
    }
    return map;
  });

  private createdAtCompare(a: BoardTask, b: BoardTask): number {
    const av = a.created_at ?? '';
    const bv = b.created_at ?? '';
    return av < bv ? -1 : av > bv ? 1 : 0;
  }

  /** The four cdkDropList ids — every column is connected to all of them (CDK ignores self). */
  protected readonly dropListIds = this.columns.map((c) => BOARD_COL_PREFIX + c);

  protected dropListId(status: TaskBoardStatus): string {
    return BOARD_COL_PREFIX + status;
  }

  /** "12 open tasks · 2 breaching SLA · 4 assigned to you · 3 waiting for an owner" (spec §4). */
  protected readonly countSentence = computed(() => {
    const c = this.counts();
    if (!c) return '';
    return (
      `${c.openTotal} open ${c.openTotal === 1 ? 'task' : 'tasks'} · ${c.slaBreaches} breaching SLA · ` +
      `${c.assignedToMe} assigned to you · ${c.unassigned} waiting for an owner`
    );
  });

  public ngOnInit(): void {
    void this.settingsSvc.load();
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    try {
      const [res, users, counts] = await Promise.all([
        this.svc.getAll({
          limit: 1000,
          columns: [
            'id',
            'name',
            'status',
            'priority',
            'assigned_to',
            'due_at',
            'created_at',
            'details',
            'team_name',
            'position',
          ],
          // Deterministic board order: manual drag order first, oldest-first tiebreak.
          sortModel: [
            { colId: 'position', sort: 'asc' },
            { colId: 'created_at', sort: 'asc' },
          ],
        }),
        this.userService.getUsers(),
        this.svc.getSummaryCounts(),
      ]);
      this.usersById.set(new Map(users.map((u) => [String(u.id), `${u.first_name} ${u.last_name || ''}`.trim()])));
      this.counts.set(counts);

      const rows = (res.rows || []) as unknown as Record<string, unknown>[];
      const items: BoardTask[] = rows.map((r) => this.toBoardTask(r)).filter((t): t is BoardTask => t !== null);
      this.tasks.set(items);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load the task board. Please try again.'));
    } finally {
      this.loaded.set(true);
    }
  }

  private toBoardTask(r: Record<string, unknown>): BoardTask | null {
    const status = String(r['status'] ?? 'todo');
    if (!(this.columns as readonly string[]).includes(status)) return null; // done/archived-excluded rows never reach the board
    return {
      id: String(r['id']),
      name: String(r['name'] || '(no name)'),
      status: status as TaskBoardStatus,
      priority: (r['priority'] as string | null) ?? null,
      assigned_to: r['assigned_to'] == null ? null : String(r['assigned_to']),
      due_at: (r['due_at'] as string | null) ?? null,
      created_at: (r['created_at'] as string | null) ?? null,
      details: (r['details'] as string | null) ?? null,
      team_name: (r['team_name'] as string | null) ?? null,
      position: r['position'] == null ? 0 : Number(r['position']),
    };
  }

  protected columnLabel(status: TaskBoardStatus): string {
    return this.statusLabels[status];
  }

  protected cardsFor(status: TaskBoardStatus): BoardTask[] {
    return this.grouped().get(status) ?? [];
  }

  protected assigneeName(id: string | null): string | null {
    if (!id) return null;
    return this.usersById().get(id) ?? null;
  }

  protected assigneeInitial(id: string | null): string {
    const name = this.assigneeName(id);
    return name ? name.slice(0, 1).toUpperCase() : '?';
  }

  protected isFlashed(id: string): boolean {
    return this.flashedIds().has(id);
  }

  protected slaPill(task: BoardTask) {
    return computeTaskSla({
      status: task.status,
      createdAt: task.created_at ? new Date(task.created_at) : null,
      tasksHours: Number(this.settingsSvc.getValue('sla.tasks_hours', 24)),
      workingDays: this.settingsSvc.getValue<string>('sla.working_days', '1,2,3,4,5'),
      workingHoursStart: this.settingsSvc.getValue<string>('sla.working_hours_start', '09:00'),
      workingHoursEnd: this.settingsSvc.getValue<string>('sla.working_hours_end', '17:00'),
      timeZone: this.settingsSvc.getValue<string>('organization.timezone'),
    });
  }

  protected waitingReason(task: BoardTask): string | null {
    if (task.status !== 'waiting' || !task.details) return null;
    const oneLine = task.details.trim().split('\n')[0] ?? '';
    return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine || null;
  }

  protected dateLabel(v?: string | null): string {
    if (!v) return '';
    const s = typeof v === 'string' ? v : String(v);
    return s.length > 10 ? s.slice(0, 10) : s;
  }

  protected priorityBadgeClass(p?: string | null): string {
    const v = (p || '').toLowerCase();
    return v === 'urgent'
      ? 'badge-error'
      : v === 'high'
        ? 'badge-warning'
        : v === 'medium'
          ? 'badge-info'
          : 'badge-neutral';
  }

  /** ‹ › move: one column at a time. Disabled (dimmed) at either end — see `moveDisabledReason`. */
  protected canMove(status: TaskBoardStatus, direction: -1 | 1): boolean {
    const idx = this.columns.indexOf(status);
    const nextIdx = idx + direction;
    return nextIdx >= 0 && nextIdx < this.columns.length;
  }

  protected moveDisabledReason(direction: -1 | 1): string {
    const edge = direction < 0 ? this.columns[0] : this.columns[this.columns.length - 1];
    return edge ? `Already in ${this.statusLabels[edge]}` : '';
  }

  protected async moveCard(task: BoardTask, direction: -1 | 1): Promise<void> {
    if (!this.canMove(task.status, direction)) return;
    const idx = this.columns.indexOf(task.status);
    const next = this.columns[idx + direction];
    if (!next) return;
    await this.setStatus(task, next);
  }

  private async setStatus(task: BoardTask, next: TaskBoardStatus): Promise<void> {
    const prevStatus = task.status;
    this.tasks.update((list) => list.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      await this.svc.update(task.id, { status: next } as UpdateTaskType);
      this.svc.triggerRefresh();
      this.flashCard(task.id);
    } catch (err) {
      this.tasks.update((list) => list.map((t) => (t.id === task.id ? { ...t, status: prevStatus } : t)));
      this.alerts.showError(getUserErrorMessage(err, 'Could not move the task. Please try again.'));
    }
  }

  /**
   * Drag-and-drop persistence. Same-column drag re-seats that one column; cross-column
   * drag re-seats the source and target and changes the card's status. Optimistic:
   * regroup/reorder locally, then persist; roll back to the snapshot on failure.
   */
  protected async onCardDrop(event: CdkDragDrop<BoardTask[]>, targetCol: TaskBoardStatus): Promise<void> {
    const moved = event.item.data;
    const sameColumn = event.previousContainer === event.container;
    if (sameColumn && event.previousIndex === event.currentIndex) return; // dropped in place

    const sourceCol = moved.status;
    const snapshot = this.tasks();
    const columnsPayload: Array<{ status: TaskBoardStatus; ids: string[] }> = [];

    if (sameColumn) {
      const ids = this.cardsFor(targetCol).map((c) => c.id);
      const [id] = ids.splice(event.previousIndex, 1);
      if (id === undefined) return;
      ids.splice(event.currentIndex, 0, id);
      columnsPayload.push({ status: targetCol, ids });
    } else {
      const targetIds = this.cardsFor(targetCol).map((c) => c.id);
      targetIds.splice(event.currentIndex, 0, moved.id);
      const sourceIds = this.cardsFor(sourceCol)
        .map((c) => c.id)
        .filter((id) => id !== moved.id);
      columnsPayload.push({ status: targetCol, ids: targetIds });
      if (sourceIds.length > 0) columnsPayload.push({ status: sourceCol, ids: sourceIds });
    }

    this.applyReorder(columnsPayload);

    try {
      await this.svc.reorder(columnsPayload);
      this.svc.triggerRefresh();
      this.flashCard(moved.id);
    } catch (err) {
      this.tasks.set(snapshot);
      this.alerts.showError(getUserErrorMessage(err, 'Could not move the task. Please try again.'));
    }
  }

  /** Apply a reorder payload to the local model: position = index, status = its column. */
  private applyReorder(columnsPayload: Array<{ status: TaskBoardStatus; ids: string[] }>): void {
    const next = new Map<string, { position: number; status: TaskBoardStatus }>();
    for (const col of columnsPayload) {
      col.ids.forEach((id, index) => next.set(id, { position: index, status: col.status }));
    }
    this.tasks.update((list) =>
      list.map((t) => {
        const u = next.get(t.id);
        return u ? { ...t, position: u.position, status: u.status } : t;
      }),
    );
  }

  /** One-click "take" for an unassigned task — assigns it to the current user. */
  protected async takeTask(task: BoardTask): Promise<void> {
    const me = this.auth.getUser();
    if (!me?.id) return;
    try {
      await this.svc.update(task.id, { assigned_to: me.id } as UpdateTaskType);
      this.svc.triggerRefresh();
      this.tasks.update((list) => list.map((t) => (t.id === task.id ? { ...t, assigned_to: me.id } : t)));
      this.flashCard(task.id);
      this.alerts.showSuccess(`You're now assigned to "${task.name}"`);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not take the task. Please try again.'));
    }
  }

  private flashCard(id: string): void {
    this.flashedIds.update((s) => new Set([...s, id]));
    setTimeout(() => {
      this.flashedIds.update((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, CARD_FLASH_MS);
  }

  protected openTask(t: BoardTask): void {
    void this.router.navigate(['tasks', t.id]);
  }

  protected openList(): void {
    void this.router.navigate(['/tasks']);
  }
}
