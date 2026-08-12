import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, effect, linkedSignal, resource, untracked } from '@angular/core';
import { Icon } from '@icons/icon';
import { PcIconNameType } from '@icons/icons.index';
import { ActivityService } from '@experiences/activity/services/activity.service';

@Component({
  selector: 'pc-record-activities',
  imports: [DatePipe, Icon],
  templateUrl: './record-activities.html',
  host: {
    // Make the host a flex column that takes up 100% of its parent's height
    class: 'flex flex-col h-full w-full',
  },
})
export class RecordActivities {
  private readonly activitySvc = inject(ActivityService);

  public entity = input.required<string>();
  public entityId = input.required<string>();

  protected readonly activities = signal<any[]>([]);
  protected readonly hasMore = signal(false);
  protected readonly pageSize = 10;

  protected readonly offset = linkedSignal({
    source: () => ({ entity: this.entity(), entityId: this.entityId() }),
    computation: () => 0,
  });

  protected readonly activitiesResource = resource({
    params: () => ({
      entity: this.entity(),
      entityId: this.entityId(),
      offset: this.offset(),
    }),
    loader: async ({ params }) => {
      if (!params.entity || !params.entityId) {
        return { rows: [] } as any;
      }
      return (await this.activitySvc.getActivities(params.entity, params.entityId, {
        startRow: params.offset,
        endRow: params.offset + this.pageSize,
      })) as any;
    },
  });

  protected readonly isLoading = computed(() => this.activitiesResource.isLoading() && this.offset() === 0);
  protected readonly isLoadingMore = computed(() => this.activitiesResource.isLoading() && this.offset() > 0);
  protected readonly activityCount = computed(() => this.activities().length);

  constructor() {
    effect(() => {
      // Clear activities and hasMore immediately when entity or entityId changes
      this.entity();
      this.entityId();
      untracked(() => {
        this.activities.set([]);
        this.hasMore.set(false);
      });
    });

    effect(() => {
      const res = this.activitiesResource.value() as any;
      if (res) {
        const newRows = res.rows || [];
        if (this.offset() === 0) {
          this.activities.set(newRows);
        } else {
          this.activities.update((curr) => {
            const existingIds = new Set(curr.map((r: any) => r.id));
            const filteredNew = newRows.filter((r: any) => !existingIds.has(r.id));
            return [...curr, ...filteredNew];
          });
        }
        this.hasMore.set(newRows.length === this.pageSize);
      }
    });
  }

  public loadActivities(replace = true): void {
    if (replace) {
      this.offset.set(0);
    }
    this.activitiesResource.reload();
  }

  protected loadMore(): void {
    this.offset.update((c) => c + this.pageSize);
  }

  protected getActivityIcon(activity: string): PcIconNameType {
    switch (activity) {
      case 'create':
        return 'plus';
      case 'update':
        return 'pencil-square';
      case 'delete':
        return 'trash';
      case 'merge':
        return 'merge';
      case 'import':
        return 'arrow-up-tray';
      case 'export':
        return 'arrow-down-tray';
      case 'assign':
        return 'user-plus';
      case 'unassign':
        return 'user-circle';
      case 'close':
        return 'check-circle';
      case 'reopen':
        return 'arrow-path';
      // Human-authored interactions (Log an interaction)
      case 'call':
        return 'phone';
      case 'door_knock':
        return 'map-pin';
      case 'note':
        return 'envelope';
      case 'meeting':
        return 'user-group';
      default:
        return 'information-circle';
    }
  }

  /** True for human-authored interaction types (call/door knock/note/meeting). */
  protected isInteraction(activity: string): boolean {
    return activity === 'call' || activity === 'door_knock' || activity === 'note' || activity === 'meeting';
  }

  /** Semantic-token dot tints only (design §5): color appears where it MEANS
   *  something — success/error/warning for outcomes, primary for human-authored
   *  interactions — and everything mechanical stays a neutral base wash. Both
   *  themes resolve through the tokens, so no hand-maintained dark: pairs. */
  protected getActivityDotClass(activity: string): string {
    switch (activity) {
      case 'create':
      case 'close':
        return 'bg-success/10 text-success';
      case 'update':
        return 'bg-info/10 text-info';
      case 'delete':
        return 'bg-error/10 text-error';
      case 'merge':
      case 'reopen':
        return 'bg-warning/15 text-warning';
      // Logged interactions share one soft-primary treatment (semantic, theme-safe).
      case 'call':
      case 'door_knock':
      case 'note':
      case 'meeting':
        return 'bg-primary/10 text-primary';
      // Mechanical events (import/export/assign/unassign) and anything unknown
      // are inert — neutral wash, no decorative hue.
      default:
        return 'bg-base-200 text-base-content/60';
    }
  }

  private formatValue(val: any): string {
    if (val === null || val === undefined || val === '') return 'none';
    if (typeof val === 'boolean') return val ? 'yes' : 'no';
    if (typeof val === 'object') return JSON.stringify(val);
    const str = String(val);
    if (str.length > 40) {
      return `"${str.substring(0, 40)}..."`;
    }
    return `"${str}"`;
  }

  /** Append the free-text note of a logged interaction, if any. */
  private getNoteSuffix(meta: any): string {
    const note = typeof meta?.['note'] === 'string' ? meta['note'].trim() : '';
    return note ? ` — “${note}”` : '';
  }

  private getChangesSuffix(changes: any): string {
    if (!changes) return '';
    const parts: string[] = [];
    const keys = Object.keys(changes);
    if (keys.length > 0) {
      for (const key of keys) {
        const change = changes[key];
        const fieldName = key.replace(/_/g, ' ');
        const fromVal = this.formatValue(change.from);
        const toVal = this.formatValue(change.to);
        parts.push(`${fieldName} from ${fromVal} to ${toVal}`);
      }
      return ` (changed ${parts.join(', ')})`;
    }
    return '';
  }

  protected getActivityLabel(act: any): string {
    const meta = act.metadata ?? {};
    const qty = act.quantity > 1 ? ` (${act.quantity} records)` : '';
    let ent = act.entity ?? 'record';
    const entLower = ent.toLowerCase();
    if (entLower === 'persons' || entLower === 'people') ent = 'person';
    else if (entLower === 'households') ent = 'household';
    else if (entLower === 'companies') ent = 'company';
    else if (entLower === 'tasks') ent = 'task';
    else if (entLower === 'teams') ent = 'team';
    else if (entLower === 'workflows') ent = 'workflow';
    else if (entLower === 'lists') ent = 'list';
    else if (entLower === 'web_forms') ent = 'web form';
    else if (entLower === 'volunteer_events') ent = 'volunteer event';

    switch (act.activity) {
      case 'create':
        return `created this ${ent} record`;
      case 'update': {
        if (meta['action'] === 'add_comment') {
          return `added a comment to this ${ent}`;
        }
        if (meta['action'] === 'add_subtask') {
          return `added subtask "${meta['subtask_name']}" to this ${ent}`;
        }
        if (meta['action'] === 'toggle_subtask') {
          return `${meta['status'] === 'done' ? 'completed' : 'reopened'} subtask "${meta['subtask_name']}" on this ${ent}`;
        }
        if (meta['action'] === 'add_attachment') {
          return `attached file "${meta['filename']}" to this ${ent}`;
        }
        if (meta['action'] === 'change_due_date') {
          if (meta['due_at']) {
            const parts = String(meta['due_at']).split('-');
            let formattedDate = String(meta['due_at']);
            if (parts.length === 3) {
              const year = parseInt(parts[0]!, 10);
              const month = parseInt(parts[1]!, 10) - 1;
              const day = parseInt(parts[2]!, 10);
              const dateVal = new Date(year, month, day);
              formattedDate = dateVal.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              });
            }
            return `changed the due date to ${formattedDate} on this ${ent}`;
          }
          return `removed the due date on this ${ent}`;
        }
        if (meta['action'] === 'attach_tag' || meta['action'] === 'attach_issue') {
          return `attached tag "${meta['name']}" to this ${ent}`;
        }
        if (meta['action'] === 'detach_tag' || meta['action'] === 'detach_issue') {
          return `detached tag "${meta['name']}" from this ${ent}`;
        }
        if (meta['action'] === 'status_update') {
          return `updated the status of this ${ent}`;
        }
        // A knock synced from the Canvass Companion (canvassing/controller.ts logActivity):
        // metadata carries source/outcome/response. Without this branch it printed the
        // meaningless "updated this person record".
        if (meta['source'] === 'companion' && meta['outcome']) {
          const outcome = String(meta['outcome']);
          const response = meta['response'] ? ` — marked ${String(meta['response']).replace(/_/g, ' ')}` : '';
          const where = ent === 'household' ? ' at this door' : '';
          if (outcome === 'conversation') {
            return `had a doorstep conversation${where}${response} (Canvass Companion)`;
          }
          return `knocked${where} — ${outcome.replace(/_/g, ' ')} (Canvass Companion)`;
        }

        // Household address check
        if (entLower === 'households' || entLower === 'household') {
          const addressFields = [
            'apt',
            'street_num',
            'street1',
            'street2',
            'city',
            'state',
            'zip',
            'country',
            'formatted_address',
          ];
          if (meta.changes && Object.keys(meta.changes).some((k) => addressFields.includes(k))) {
            return `updated the address of this household` + this.getChangesSuffix(meta.changes);
          }
        }
        return `updated this ${ent} record` + this.getChangesSuffix(meta.changes);
      }
      case 'delete':
        return `deleted ${ent} record${qty}`;
      case 'merge':
        return `merged duplicate ${ent} records`;
      case 'import':
        return `imported this ${ent}${qty}`;
      case 'export':
        return `exported ${ent} data${qty}`;
      case 'assign': {
        const assignee = meta['assigned_to_name'] ?? 'someone';
        return `assigned this ${ent} to ${assignee}`;
      }
      case 'unassign':
        return `unassigned this ${ent}`;
      case 'close':
        return `closed this ${ent}`;
      case 'reopen':
        return `reopened this ${ent}`;
      // Human-authored interactions. On households the framing is "at this door".
      case 'call':
        return `logged a call${this.getNoteSuffix(meta)}`;
      case 'door_knock':
        return `logged a door knock${this.getNoteSuffix(meta)}`;
      case 'note':
        return `logged a note${this.getNoteSuffix(meta)}`;
      case 'meeting':
        return `logged a meeting${this.getNoteSuffix(meta)}`;
      default:
        return `performed ${act.activity} on this ${ent}`;
    }
  }
}
