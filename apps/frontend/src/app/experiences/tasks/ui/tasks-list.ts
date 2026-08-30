import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { TabBar, type PcTabOption } from '@uxcommon/components/tabs/tabs';
import { Icon } from '@icons/icon';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { SettingsService } from '@experiences/settings/services/settings-service';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { UpdateTaskType } from '../../../../../../../libs/common/src';

import { AuthService } from '../../../auth/auth-service';
import { UserService } from '../../../services/user.service';
import { TasksService } from '../services/tasks-service';
import { computeTaskSla } from '../services/task-sla';

type ListTab = 'all' | 'mine' | 'unassigned' | 'done';
type DueBucket = 'overdue' | 'today' | 'upcoming' | 'none';

interface ListTask {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  assigned_to: string | null;
  due_at: string | null;
  created_at: string | null;
  details: string | null;
}

const DUE_BUCKET_META: Record<DueBucket, { label: string; tone: 'error' | 'warning' | 'info' | 'neutral' }> = {
  overdue: { label: 'Overdue', tone: 'error' },
  today: { label: 'Due Today', tone: 'warning' },
  upcoming: { label: 'Coming Up', tone: 'info' },
  none: { label: 'No due date', tone: 'neutral' },
};
const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'upcoming', 'none'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

@Component({
  selector: 'pc-tasks-list',
  imports: [Icon, TabBar],
  templateUrl: './tasks-list.html',
})
export class TasksList implements OnInit {
  private readonly router = inject(Router);
  private readonly svc = inject(TasksService);
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly settingsSvc = inject(SettingsService);
  private readonly alerts = inject(AlertService);
  private readonly _loading = createLoadingGate();

  protected readonly loading = this._loading.visible;
  protected readonly loaded = this._loading.loaded;

  /** Placeholder rows for the first-load skeleton (mirrors pc-table's default of 5). */
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly tab = signal<ListTab>('all');
  protected readonly tasks = signal<ListTask[]>([]);
  /** The server's total task count — when it exceeds the loaded rows, the template says so. */
  protected readonly serverTotal = signal(0);
  protected readonly usersById = signal<Map<string, string>>(new Map());
  protected readonly flashedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly counts = signal<{
    assignedToMe: number;
    openTotal: number;
    slaBreaches: number;
    unassigned: number;
  } | null>(null);

  private readonly myId = computed(() => this.auth.getUser()?.id ?? null);

  /** "12 open tasks · 2 breaching SLA · 4 assigned to you" (spec §4). */
  protected readonly countSentence = computed(() => {
    const c = this.counts();
    if (!c) return '';
    return `${c.openTotal} open ${c.openTotal === 1 ? 'task' : 'tasks'} · ${c.slaBreaches} breaching SLA · ${c.assignedToMe} assigned to you`;
  });

  protected readonly tabCounts = computed(() => {
    const all = this.tasks();
    const me = this.myId();
    return {
      all: all.length,
      mine: all.filter((t) => t.assigned_to === me).length,
      unassigned: all.filter((t) => t.assigned_to == null && t.status !== 'done').length,
      done: all.filter((t) => t.status === 'done').length,
    };
  });

  /** The standard pill tab bar with counts (§1 "numbers before clicks"). */
  protected readonly tabs = computed((): PcTabOption[] => {
    const c = this.tabCounts();
    return [
      { id: 'all', label: 'All', badge: c.all },
      { id: 'mine', label: 'Mine', badge: c.mine },
      { id: 'unassigned', label: 'Unassigned', badge: c.unassigned },
      { id: 'done', label: 'Done', badge: c.done },
    ];
  });

  protected readonly filtered = computed(() => {
    const all = this.tasks();
    const me = this.myId();
    const tab = this.tab();
    switch (tab) {
      case 'all':
        return all;
      case 'mine':
        return all.filter((t) => t.assigned_to === me);
      case 'unassigned':
        return all.filter((t) => t.assigned_to == null && t.status !== 'done');
      case 'done':
        return all.filter((t) => t.status === 'done');
      default: {
        const _exhaustive: never = tab;
        return _exhaustive;
      }
    }
  });

  protected readonly groups = computed(() => {
    const buckets = new Map<DueBucket, ListTask[]>(DUE_BUCKET_ORDER.map((b) => [b, []]));
    for (const t of this.filtered()) {
      buckets.get(this.bucketFor(t))?.push(t);
    }
    return DUE_BUCKET_ORDER.map((key) => ({ key, meta: DUE_BUCKET_META[key], rows: buckets.get(key) ?? [] })).filter(
      (g) => g.rows.length > 0,
    );
  });

  public ngOnInit(): void {
    void this.settingsSvc.load();
    void this.loadOnInit();
  }

  private async loadOnInit(): Promise<void> {
    const end = this._loading.begin();
    try {
      const [res, users, counts] = await Promise.all([
        this.svc.getAll({
          limit: 1000,
          columns: ['id', 'name', 'status', 'priority', 'assigned_to', 'due_at', 'created_at', 'details'],
        }),
        this.userService.getUsers(),
        this.svc.getSummaryCounts(),
      ]);
      this.usersById.set(new Map(users.map((u) => [String(u.id), `${u.first_name} ${u.last_name || ''}`.trim()])));
      this.counts.set(counts);

      const rows = (res.rows || []) as unknown as Record<string, unknown>[];
      this.tasks.set(rows.map((r) => this.toListTask(r)));
      this.serverTotal.set(Number(res.count ?? rows.length));

      const flashId = (window.history.state as { flashId?: unknown } | undefined)?.flashId;
      if (typeof flashId === 'string' && flashId) this.flashCard(flashId);
    } catch (err) {
      this.alerts.showError(getUserErrorMessage(err, 'Could not load tasks. Please try again.'));
    } finally {
      end();
    }
  }

  private toListTask(r: Record<string, unknown>): ListTask {
    return {
      id: String(r['id']),
      name: String(r['name'] || '(no name)'),
      status: String(r['status'] ?? 'todo'),
      priority: (r['priority'] as string | null) ?? null,
      assigned_to: r['assigned_to'] == null ? null : String(r['assigned_to']),
      due_at: (r['due_at'] as string | null) ?? null,
      created_at: (r['created_at'] as string | null) ?? null,
      details: (r['details'] as string | null) ?? null,
    };
  }

  private bucketFor(t: ListTask): DueBucket {
    if (!t.due_at) return 'none';
    const due = this.dateOnly(t.due_at);
    const today = this.dateOnly(new Date().toISOString());
    if (due < today) return 'overdue';
    if (due === today) return 'today';
    return 'upcoming';
  }

  private dateOnly(v: string): string {
    return v.length > 10 ? v.slice(0, 10) : v;
  }

  protected setTab(tab: string): void {
    if (tab !== 'all' && tab !== 'mine' && tab !== 'unassigned' && tab !== 'done') return;
    this.tab.set(tab);
  }

  protected isFlashed(id: string): boolean {
    return this.flashedIds().has(id);
  }

  protected assigneeName(id: string | null): string | null {
    return id ? (this.usersById().get(id) ?? null) : null;
  }

  protected assigneeInitial(id: string | null): string {
    const name = this.assigneeName(id);
    return name ? name.slice(0, 1).toUpperCase() : '?';
  }

  protected waitingReason(t: ListTask): string | null {
    if (t.status !== 'waiting' || !t.details) return null;
    const oneLine = t.details.trim().split('\n')[0] ?? '';
    return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine || null;
  }

  /** Short scan-friendly badge for the list row; the full honest breakdown still lives on the detail page (task-view). */
  protected slaBadge(t: ListTask): { text: string; tone: 'error' | 'warning' } | null {
    const pill = computeTaskSla({
      status: t.status,
      createdAt: t.created_at ? new Date(t.created_at) : null,
      tasksHours: Number(this.settingsSvc.getValue('sla.tasks_hours', 24)),
      workingDays: this.settingsSvc.getValue<string>('sla.working_days', '1,2,3,4,5'),
      workingHoursStart: this.settingsSvc.getValue<string>('sla.working_hours_start', '09:00'),
      workingHoursEnd: this.settingsSvc.getValue<string>('sla.working_hours_end', '17:00'),
      timeZone: this.settingsSvc.getValue<string>('organization.timezone'),
    });
    if (!pill) return null;
    if (pill.tone === 'error') return { text: 'SLA breached', tone: 'error' };
    if (pill.tone === 'warning') return { text: 'Due soon', tone: 'warning' };
    return null;
  }

  /** "Due 4h ago" / "Due yesterday" / "Due today, 5:00" / "Due tomorrow" / "Due Thursday" (spec §4). */
  protected dateLabel(v?: string | null): string {
    if (!v) return '';
    const due = new Date(v);
    const now = new Date();
    const dueDay = this.dateOnly(v);
    const today = this.dateOnly(now.toISOString());

    if (dueDay < today) {
      const hoursAgo = Math.round((now.getTime() - due.getTime()) / MS_PER_HOUR);
      if (hoursAgo < 24) return `Due ${hoursAgo}h ago`;
      if (hoursAgo < 48) return 'Due yesterday';
      const daysAgo = Math.round((now.getTime() - due.getTime()) / MS_PER_DAY);
      return `Due ${daysAgo}d ago`;
    }

    if (dueDay === today) {
      const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `Due today, ${time}`;
    }

    const daysAhead = Math.round((new Date(dueDay).getTime() - new Date(today).getTime()) / MS_PER_DAY);
    if (daysAhead === 1) return 'Due tomorrow';
    if (daysAhead < 7) return `Due ${WEEKDAY_NAMES[due.getDay()]}`;
    return `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
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

  /** Check-circle toggle: complete (-> done) or reopen (-> todo) a task in place. */
  protected async toggleDone(t: ListTask): Promise<void> {
    const next = t.status === 'done' ? 'todo' : 'done';
    this.tasks.update((list) => list.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try {
      await this.svc.update(t.id, { status: next } as UpdateTaskType);
      this.svc.triggerRefresh();
      this.flashCard(t.id);
    } catch (err) {
      this.tasks.update((list) => list.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
      this.alerts.showError(getUserErrorMessage(err, 'Could not update the task. Please try again.'));
    }
  }

  protected async takeTask(t: ListTask): Promise<void> {
    const me = this.auth.getUser();
    if (!me?.id) return;
    try {
      await this.svc.update(t.id, { assigned_to: me.id } as UpdateTaskType);
      this.svc.triggerRefresh();
      this.tasks.update((list) => list.map((x) => (x.id === t.id ? { ...x, assigned_to: me.id } : x)));
      this.flashCard(t.id);
      this.alerts.showSuccess(`You're now assigned to "${t.name}"`);
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
    }, 1200);
  }

  protected openTask(t: ListTask): void {
    void this.router.navigate(['tasks', t.id]);
  }

  protected openBoard(): void {
    void this.router.navigate(['/tasks/board']);
  }

  protected newTask(): void {
    void this.router.navigate(['/tasks/add']);
  }

  // The CSV import wizard (spec §17) replaced the old in-page import modal —
  // one idiom for the job across every record type.
  protected openImportWizard(): void {
    void this.router.navigate(['/imports/new'], { queryParams: { type: 'tasks' } });
  }
}
