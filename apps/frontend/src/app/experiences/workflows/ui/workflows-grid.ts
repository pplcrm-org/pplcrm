import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { GridHeaderComponent } from '@uxcommon/components/grid-header/grid-header';
import { createLoadingGate } from '@uxcommon/loading-gate';
import type { QueryBuilderGroupNode } from '@common';
import { WorkflowsService } from '../services/workflows-service';
import { buildRecipeSentence } from '../models/automations.model';

interface ListStep {
  kind: 'wait' | 'send_email' | 'add_tag' | 'create_task' | 'notify_team';
  config: unknown;
  delay_days: number;
  delay_unit: string;
  subject: string | null;
}

interface ListRow {
  id: string;
  name: string;
  trigger_type: string;
  status: string;
  conditions: unknown;
  steps: ListStep[];
  runs_30d: number;
  last_run_at: string | Date | null;
  // 'pending' = an automation email that is queued for delivery; its outcome is not known yet.
  last_run_status: 'pending' | 'success' | 'failed' | 'skipped' | null;
  last_run_error: string | null;
}

// Spec §16 Automations list (/automations). Not a datagrid — a purpose-built list with a STATUS
// toggle, the one-line recipe sentence, RUNS 30D and a LAST RUN that narrates failures inline.
@Component({
  selector: 'pc-workflows-grid',
  imports: [RouterModule, Icon, GridHeaderComponent],
  templateUrl: './workflows-grid.html',
  providers: [WorkflowsService],
})
export class WorkflowsGridComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly workflowsSvc = inject(WorkflowsService);
  private readonly alertSvc = inject(AlertService);

  private readonly _loading = createLoadingGate();
  protected readonly isLoading = this._loading.visible;

  /** Placeholder rows for the first-load skeleton (mirrors pc-table's default of 5). */
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  protected readonly loaded = signal(false);
  protected readonly rows = signal<ListRow[]>([]);
  protected readonly summary = signal<{ total: number; active: number; runs30d: number }>({
    total: 0,
    active: 0,
    runs30d: 0,
  });

  // Spec copy: "6 automations · 4 active · 1,847 runs in the last 30 days".
  protected readonly summarySentence = computed(() => {
    const s = this.summary();
    const runs = s.runs30d.toLocaleString();
    return `${plural(s.total, 'automation')} · ${s.active} active · ${runs} runs in the last 30 days`;
  });

  public ngOnInit(): void {
    void this.load();
  }

  protected recipe(row: ListRow): string {
    return buildRecipeSentence(row.trigger_type, row.steps, asConditions(row.conditions));
  }

  protected lastRunLabel(row: ListRow): string {
    if (!row.last_run_at) return '—';
    return relativeTime(new Date(row.last_run_at));
  }

  protected openAutomation(row: ListRow): void {
    void this.router.navigate(['/automations', row.id]);
  }

  protected newAutomation(): void {
    void this.router.navigate(['/automations', 'add']);
  }

  // STATUS toggle. Pausing stops new runs immediately; resuming sets it active.
  protected async toggleStatus(row: ListRow, event: Event): Promise<void> {
    event.stopPropagation();
    const next = row.status === 'active' ? 'paused' : 'active';
    // Optimistic flip; revert on failure.
    this.patchRow(row.id, { status: next });
    try {
      await this.workflowsSvc.setStatus(row.id, next);
      this.workflowsSvc.triggerRefresh();
      this.alertSvc.showSuccess(next === 'paused' ? 'Automation paused' : 'Automation resumed');
      this.summary.update((s) => ({
        ...s,
        active: this.rows().filter((r) => r.status === 'active').length,
      }));
    } catch {
      this.patchRow(row.id, { status: row.status });
      this.alertSvc.showError('Could not change the automation status. Please try again.');
    }
  }

  protected statusTooltip(row: ListRow): string {
    return row.status === 'active' ? 'Pause: stop new runs' : 'Resume: start running again';
  }

  private patchRow(id: string, patch: Partial<ListRow>): void {
    this.rows.update((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  private async load(): Promise<void> {
    const end = this._loading.begin();
    try {
      const result = await this.workflowsSvc.list();
      this.rows.set((result?.rows ?? []) as ListRow[]);
      this.summary.set(result?.summary ?? { total: 0, active: 0, runs30d: 0 });
    } catch {
      this.alertSvc.showError('Could not load your automations. Please try again.');
    } finally {
      this.loaded.set(true);
      end();
    }
  }
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function asConditions(value: unknown): QueryBuilderGroupNode | null {
  if (value != null && typeof value === 'object' && (value as { kind?: string }).kind === 'group') {
    return value as QueryBuilderGroupNode;
  }
  return null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < MINUTE) return 'Just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
