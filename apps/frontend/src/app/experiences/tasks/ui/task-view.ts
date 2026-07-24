import { DatePipe, DecimalPipe, SlicePipe } from '@angular/common';
import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { createRequestGuard } from '@uxcommon/request-guard';
import { Router, RouterModule } from '@angular/router';
import { IAuthUser, TASK_BOARD_STATUSES, TASK_STATUS_LABELS, isTaskStatus } from '../../../../../../../libs/common/src';
import { TasksService } from '@experiences/tasks/services/tasks-service';
import { TeamsService } from '../../teams/services/teams-service';
import { ContentChange, QuillModule } from 'ngx-quill';
import type Quill from 'quill';

import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { PcBreadcrumb } from '@uxcommon/components/breadcrumbs/breadcrumbs';
import { DetailLayout } from '@uxcommon/components/detail-layout/detail-layout';
import { injectRecordNavigation } from '@frontend/services/record-navigation.service';
import { Icon } from '@icons/icon';
import { SanitizeHtmlPipe } from '@uxcommon/pipes/sanitize-html.pipe';
import { MentionifyPipe } from '@uxcommon/pipes/mention.pipe';
import { TimeAgoPipe } from '@uxcommon/pipes/timeago.pipe';
import { MentionController, userDisplay } from '@uxcommon/mentions/mention-controller';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { UserService } from '../../../services/user.service';

import { UserAvatarComponent } from '@uxcommon/components/user-avatar/user-avatar';
import { getUserErrorMessage } from '@frontend/services/api/user-message';
import { EmptyState } from '@uxcommon/components/empty-state/empty-state';

@Component({
  selector: 'pc-task-view',
  imports: [
    EmptyState,
    DatePipe,
    DecimalPipe,
    SlicePipe,
    DetailLayout,
    RouterModule,
    QuillModule,
    Icon,
    SanitizeHtmlPipe,
    MentionifyPipe,
    TimeAgoPipe,
    RecordActivities,
    UserAvatarComponent,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  templateUrl: './task-view.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TaskView {
  readonly id = input.required<string>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tasks = inject(TasksService);
  private readonly dialogs = inject(ConfirmDialogService);
  private readonly alertSvc = inject(AlertService);
  private readonly teams = inject(TeamsService);
  private readonly userService = inject(UserService);

  protected readonly task = signal<any | null>(null);
  protected readonly comments = signal<any[]>([]);
  protected readonly attachments = signal<any[]>([]);
  protected readonly subtasks = signal<any[]>([]);
  private readonly _loading = createLoadingGate();
  private readonly _requestGuard = createRequestGuard();
  protected readonly isLoading = this._loading.visible;
  protected readonly users = signal<IAuthUser[]>([]);
  protected readonly assignedTo = signal<string>('');
  protected readonly teamsList = signal<any[]>([]);
  protected readonly teamId = signal<string>('');

  /** "N of M filtered" pager + J/K keys when the grid handed off a filtered set. */
  protected readonly recordNav = injectRecordNavigation('task', this.id);

  /** Entity noun while loading; the record's real name once loaded. */
  protected readonly pageTitle = computed(() => {
    const task = this.task();
    if (!task) return 'Task';
    return task.name || '(No name)';
  });

  protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
    { label: 'Tasks', route: '/tasks' },
    { label: this.pageTitle() },
  ]);

  // Form Fields & Inline Editing State
  protected isEditingDetails = signal(false);
  protected isEditingDueDate = signal(false);
  protected tempDetails = signal('');
  protected readonly defaultDetails =
    '<p class="italic text-base-content/40">No details or description provided. Click here to add descriptions...</p>';
  private readonly activityHistory = viewChild<RecordActivities>('activityHistory');

  private refreshActivities() {
    const component = this.activityHistory();
    if (component) {
      void component.loadActivities();
    }
  }

  protected newComment = signal('');
  protected attName = signal('');
  protected attUrl = signal('');
  protected subtaskName = signal('');

  // Expand / collapse sections
  protected showComments = signal(true);
  protected showSubtasks = signal(true);
  protected showAttachments = signal(true);

  // Autocomplete mentions (shared controller)
  private readonly taskComposer = viewChild<{ nativeElement: HTMLTextAreaElement }>('taskComposer');
  public mc = new MentionController(() => this.users());

  // Priority classes and options for display/inputs
  protected readonly priorities = ['low', 'medium', 'high', 'urgent'];
  protected readonly statuses = TASK_BOARD_STATUSES;
  protected readonly statusLabels = TASK_STATUS_LABELS;

  constructor() {
    // Track id() so record navigation (prev/next reuses this component) reloads the task.
    effect(() => {
      const currentId = this.id();
      void untracked(() => this.load(currentId));
    });
  }

  // Load task and its children
  private async load(id: string) {
    const isCurrent = this._requestGuard.begin();
    const end = this._loading.begin();
    try {
      const [t, us, ts] = await Promise.all([
        this.tasks.getById(id),
        this.userService.getUsers(),
        this.teams.getAll({ limit: 1000 }),
      ]);
      if (!isCurrent()) return; // superseded — do not land stale data
      if (!t) {
        this.alertSvc.showError('Task not found.');
        return;
      }
      this.task.set(t as any);
      this.users.set(us || []);
      this.teamsList.set(ts?.rows ?? []);
      const assigned = (t as any)?.assigned_to;
      this.assignedTo.set(assigned == null ? '' : String(assigned));
      const team = (t as any)?.team_id;
      this.teamId.set(team == null ? '' : String(team));

      // Load subtasks, comments, attachments
      const [comments, attachments, subtasks] = await Promise.all([
        this.tasks.api.tasks.getComments.query(id),
        this.tasks.api.tasks.getAttachments.query(id),
        this.tasks.api.tasks.getSubtasks.query(id),
      ]);
      if (!isCurrent()) return;
      this.comments.set(comments);
      this.attachments.set(attachments);
      this.subtasks.set(subtasks);
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not load the task. Please try again.'));
    } finally {
      end();
    }
  }

  private async loadComments() {
    const list = await this.tasks.api.tasks.getComments.query(this.id());
    this.comments.set(list);
  }

  private async loadAttachments() {
    const list = await this.tasks.api.tasks.getAttachments.query(this.id());
    this.attachments.set(list);
  }

  private async loadSubtasks() {
    const list = await this.tasks.api.tasks.getSubtasks.query(this.id());
    this.subtasks.set(list);
  }

  protected asDate(v: any) {
    return v ? new Date(v) : null;
  }

  protected dateOnly(v: any) {
    if (!v) return '';
    const s = typeof v === 'string' ? v : new Date(v).toISOString();
    return s.slice(0, 10);
  }

  protected async update(patch: any) {
    if (!this.task()) return;
    const id = this.id();
    try {
      await this.tasks.update(id, patch);
      this.tasks.triggerRefresh();
      this.task.update((t) => ({ ...(t ?? {}), ...patch }));
      if (Object.prototype.hasOwnProperty.call(patch, 'assigned_to')) {
        const v = patch.assigned_to;
        this.assignedTo.set(v == null || v === '' ? '' : String(v));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'team_id')) {
        const v = patch.team_id;
        this.teamId.set(v == null || v === '' ? '' : String(v));
      }
      this.alertSvc.showSuccess('Task updated successfully');
      this.refreshActivities();
    } catch (err) {
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not update the task. Please try again.'));
    }
  }

  protected onTeamChange(event: any) {
    const val = event.target.value;
    void this.update({ team_id: val || null });
  }

  /** Rename via prompt dialog — the header owns the title, so there is no in-body name field. */
  protected async renameTask() {
    const name = await this.dialogs.prompt({
      title: 'Rename task',
      message: 'Enter a new name for this task.',
      defaultValue: this.task()?.name || '',
      inputPlaceholder: 'Task name',
      confirmText: 'Rename',
    });
    const nextName = name?.trim();
    if (!nextName || nextName === this.task()?.name) return;
    await this.update({ name: nextName });
  }

  // Inline details (Quill description) editing trigger & save
  protected startEditingDetails() {
    this.tempDetails.set(this.task()?.details || '');
    this.isEditingDetails.set(true);
  }

  protected async saveDetails() {
    await this.update({ details: this.tempDetails() });
    this.isEditingDetails.set(false);
  }

  /** The editor is created fresh on each edit session; seed it with the buffered details. */
  protected onDetailsEditorCreated(editor: Quill): void {
    editor.setContents(editor.clipboard.convert({ html: this.tempDetails() }), 'silent');
  }

  protected onDetailsContentChanged(event: ContentChange): void {
    this.tempDetails.set(event.html ?? '');
  }

  protected cancelEditingDetails() {
    this.isEditingDetails.set(false);
  }

  // Subtask Actions
  protected async addSubtask() {
    const name = this.subtaskName().trim();
    if (!name) return;
    const end = this._loading.begin();
    try {
      await this.tasks.api.tasks.addSubtask.mutate({ task_id: this.id(), name });
      this.subtaskName.set('');
      await this.loadSubtasks();
      this.refreshActivities();
    } finally {
      end();
    }
  }

  /**
   * Drag-to-reorder subtasks. Optimistically reorders the local list, then persists the
   * full new order in one transaction; rolls back to the snapshot on failure.
   */
  protected async onSubtaskDrop(event: CdkDragDrop<any[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;
    const snapshot = this.subtasks();
    const next = [...snapshot];
    const [moved] = next.splice(event.previousIndex, 1);
    if (!moved) return;
    next.splice(event.currentIndex, 0, moved);
    this.subtasks.set(next);
    try {
      await this.tasks.reorderSubtasks(
        this.id(),
        next.map((s) => String(s.id)),
      );
      this.refreshActivities();
    } catch (err) {
      this.subtasks.set(snapshot);
      this.alertSvc.showError(getUserErrorMessage(err, 'Could not reorder subtasks. Please try again.'));
    }
  }

  protected async toggleSubtask(s: any, isDone: boolean) {
    const end = this._loading.begin();
    try {
      await this.tasks.api.tasks.updateSubtask.mutate({
        id: String(s.id),
        data: { status: isDone ? 'done' : 'todo' },
      });
      await this.loadSubtasks();
      this.refreshActivities();
    } finally {
      end();
    }
  }

  // Comment Actions
  protected async addComment() {
    const plain = this.newComment().trim();
    if (!plain) return;
    const end = this._loading.begin();
    try {
      await this.tasks.api.tasks.addComment.mutate({ task_id: this.id(), comment: plain });
      this.newComment.set('');
      await Promise.all([this.loadComments(), this.loadAttachments(), this.loadSubtasks()]);
      this.refreshActivities();
    } finally {
      end();
    }
  }

  // Attachment Actions
  protected async addAttachment() {
    const name = this.attName().trim();
    const url = this.attUrl().trim();
    if (!name) return;
    const end = this._loading.begin();
    try {
      await this.tasks.api.tasks.addAttachment.mutate({ task_id: this.id(), filename: name, url });
      this.attName.set('');
      this.attUrl.set('');
      await this.loadAttachments();
      this.refreshActivities();
    } finally {
      end();
    }
  }

  // Status and Priority Dropdown Handlers
  protected onStatusChange(event: any) {
    const status = event.target.value;
    void this.update({ status });
  }

  protected onPriorityChange(event: any) {
    const priority = event.target.value;
    void this.update({ priority });
  }

  protected onDueDateChange(event: any) {
    const value = this.normalizeCalendarValue(event);
    void this.update({ due_at: value });
  }

  protected onAssignedChange(v: string) {
    this.assignedTo.set(v);
    void this.update({ assigned_to: v || null });
  }

  protected assignToMe() {
    const me = this.auth.getUser();
    if (!me?.id) return;
    void this.update({ assigned_to: me.id });
  }

  protected isArchived() {
    return (this.task()?.status || '') === 'archived';
  }

  protected async archiveTask() {
    await this.update({ status: 'archived' });
  }

  protected async unarchiveTask() {
    await this.update({ status: 'todo' });
  }

  protected async deleteTask() {
    const confirmed = await this.dialogs.confirm({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (confirmed) {
      const end = this._loading.begin();
      try {
        const deleted = await this.tasks.delete(this.id());
        if (deleted) {
          this.tasks.triggerRefresh();
          this.alertSvc.showSuccess('Task deleted successfully');
          void this.router.navigate(['/tasks']);
        } else {
          this.alertSvc.showError('Failed to delete task.');
        }
      } catch (err) {
        this.alertSvc.showError(getUserErrorMessage(err, 'Could not delete the task. Please try again.'));
      } finally {
        end();
      }
    }
  }

  // User display name helpers
  protected userName(id: string | null | undefined): string {
    if (!id) return 'Unknown';
    const uid = String(id);
    const u = this.users().find((x) => String(x.id) === uid);
    return u ? `${u.first_name} ${u.last_name || ''}`.trim() : 'Unknown';
  }

  protected userAvatar(id: string | null | undefined): string | null {
    if (!id) return null;
    const uid = String(id);
    const u = this.users().find((x) => String(x.id) === uid);
    return u ? this.userService.resolveAvatarUrl(u.avatar_url) : null;
  }

  protected myUserId(): string | null {
    return this.auth.getUser()?.id ?? null;
  }

  // Mention autocomplete text area inputs
  protected onComposerInput(ev: Event) {
    const el = ev.target as HTMLTextAreaElement;
    this.newComment.set(el.value);
    const caret = el.selectionStart ?? this.newComment().length;
    this.mc.updateFromInput(this.newComment(), caret);
  }

  protected onComposerClick(ev: Event) {
    const el = ev.target as HTMLTextAreaElement;
    const caret = el.selectionStart ?? 0;
    this.mc.updateFromInput(this.newComment(), caret);
  }

  protected onComposerKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      void this.addComment();
      return;
    }
    this.mc.handleKeydown(ev, (u) => this.selectMention(u));
  }

  protected selectMention(u: IAuthUser, ev?: Event) {
    ev?.preventDefault();
    const res = this.mc.select(u, this.newComment());
    this.newComment.set(res.text);
    const el = this.taskComposer()?.nativeElement as HTMLTextAreaElement | undefined;
    setTimeout(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(res.caret, res.caret);
      }
    });
  }

  protected userDisplay = userDisplay;

  private normalizeCalendarValue(event: any): string | null {
    const raw =
      (event?.detail != null && typeof event.detail === 'string' && event.detail) ||
      (event?.detail?.value != null && event.detail.value) ||
      (event?.target?.value != null && event.target.value) ||
      (event?.value != null && event.value) ||
      (typeof event === 'string' ? event : null);

    if (!raw) return null;
    const text = String(raw).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  protected statusLabel(status: string): string {
    return isTaskStatus(status) ? TASK_STATUS_LABELS[status] : this.toTitleCase(status);
  }

  // Styling helper classes
  protected getStatusBadgeClass(status: string): string {
    if (!isTaskStatus(status)) return 'badge-ghost'; // unrecognized/corrupt data — neutral, not a crash
    switch (status) {
      case 'done':
        return 'badge-success text-success-content';
      case 'in_progress':
        return 'badge-info text-info-content';
      case 'waiting':
        return 'badge-error text-error-content';
      case 'archived':
        return 'badge-neutral text-neutral-content';
      case 'todo':
        return 'badge-ghost';
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }

  protected getPriorityBadgeClass(priority: string): string {
    const p = String(priority || '').toLowerCase();
    switch (p) {
      case 'urgent':
        return 'badge-error text-error-content';
      case 'high':
        return 'badge-warning text-warning-content';
      case 'medium':
        return 'badge-info text-info-content';
      default:
        return 'badge-ghost';
    }
  }

  protected toTitleCase(s: string): string {
    if (!s) return '';
    return s
      .replace(/[_-]+/g, ' ')
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
}
