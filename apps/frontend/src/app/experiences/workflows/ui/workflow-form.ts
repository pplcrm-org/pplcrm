import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormField, form, submit, validateStandardSchema } from '@angular/forms/signals';
import { CdkDrag, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AddWorkflowObj } from '@common';
import type {
  QueryBuilderGroupNode,
  WorkflowExitCondition,
  WorkflowSendCondition,
  WorkflowStepKind,
  WorkflowTriggerType,
} from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { FormActions } from '@uxcommon/components/form-actions/form-actions';
import { PcTabOption, TabPanel, Tabs } from '@uxcommon/components/tabs/tabs';
import { createLoadingGate } from '@uxcommon/loading-gate';
import { RecordActivities } from '@experiences/activity/ui/record-activities/record-activities';
import { TagsService } from '@experiences/tags/services/tags-service';
import { FormsService } from '@experiences/forms/services/forms-service';
import { ListsService } from '@experiences/lists/services/lists-service';
import { TeamsService } from '@experiences/teams/services/teams-service';
import { QueryBuilderComponent, QueryBuilderField } from '@frontend/shared/components/query-builder/query-builder';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { ShiftsService } from '../../shifts/services/shifts-service';
import { VisualNewsletterEditorComponent } from '../../newsletters/ui/visual-newsletter-editor';
import { WorkflowsService } from '../services/workflows-service';
import { StatusBadge } from '@uxcommon/components/status-badge/status-badge';
import {
  EXIT_CONDITION_OPTIONS,
  SEND_CONDITION_OPTIONS,
  SequenceStep,
  SequenceStepPayload,
  STEP_KINDS,
  StepKindMeta,
  TRIGGER_CARDS,
  newUid,
  sendConditionLabel,
  stepKindMeta,
  triggerCardMeta,
} from '../models/automations.model';
import { AUTOMATION_RECIPES, type AutomationRecipe } from '../models/automation-recipes';

interface OptionRow {
  id: string;
  name: string;
}

interface RunRow {
  id: string;
  status: 'success' | 'failed' | 'skipped';
  step_kind: string | null;
  step_number: number | null;
  error: string | null;
  opened_at: string | Date | null;
  clicked_at: string | Date | null;
  created_at: string | Date;
  person_first_name: string | null;
  person_last_name: string | null;
}

interface EnrollmentRow {
  id: string;
  status: string;
  current_step_number: number;
  enrolled_at: string | Date;
  person_first_name: string | null;
  person_last_name: string | null;
  person_email: string | null;
}

// Spec §16 Automations editor — trigger picker → vertical sequence flow + WORKFLOW SETTINGS /
// ONLY ENROLL IF / SEQUENCE OVERVIEW / RECENT RUNS rail, plus the Enrolled contacts tab.
@Component({
  selector: 'pc-workflow-form',
  imports: [
    StatusBadge,
    RouterModule,
    FormField,
    Icon,
    RecordActivities,
    VisualNewsletterEditorComponent,
    FormActions,
    Tabs,
    TabPanel,
    QueryBuilderComponent,
    NgTemplateOutlet,
    DatePipe,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  templateUrl: './workflow-form.html',
  providers: [WorkflowsService, ShiftsService, TagsService, FormsService, ListsService, TeamsService],
})
export class WorkflowFormComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly workflowsSvc = inject(WorkflowsService);
  private readonly alertSvc = inject(AlertService);
  private readonly volunteerEventsSvc = inject(ShiftsService);
  private readonly tagsSvc = inject(TagsService);
  private readonly formsSvc = inject(FormsService);
  private readonly listsSvc = inject(ListsService);
  private readonly teamsSvc = inject(TeamsService);
  private readonly dialogs = inject(ConfirmDialogService);

  private readonly _loading = createLoadingGate();
  protected readonly isLoading = this._loading.visible;

  /** Disables Save immediately on click — the loading gate stays false for its first
   *  300ms by design, which would leave a double-click window. */
  protected readonly saving = signal(false);

  protected readonly triggerCards = TRIGGER_CARDS;
  protected readonly stepKinds = STEP_KINDS;

  protected readonly isNew = signal(true);
  protected readonly workflowId = signal<string | null>(null);
  protected readonly activeTab = signal<string>('sequence');
  protected readonly triggerSelected = signal(false);

  // Which insertion point's ADD A STEP menu is open (index into insertion points), or null.
  protected readonly addMenuIndex = signal<number | null>(null);
  protected readonly editingEmailStepIndex = signal<number | null>(null);

  protected readonly steps = signal<SequenceStep[]>([]);
  protected readonly enrollments = signal<EnrollmentRow[]>([]);
  protected readonly runs = signal<RunRow[]>([]);

  // Picker option lists.
  protected readonly tags = signal<OptionRow[]>([]);
  protected readonly webForms = signal<OptionRow[]>([]);
  protected readonly lists = signal<OptionRow[]>([]);
  protected readonly volunteerEvents = signal<OptionRow[]>([]);
  protected readonly teamMembers = signal<OptionRow[]>([]);

  // "End the sequence early when..." — sequence-level goals the drip worker checks per tick.
  protected readonly exitConditionOptions = EXIT_CONDITION_OPTIONS;
  protected readonly exitConditions = signal<WorkflowExitCondition[]>([]);
  protected readonly sendConditionOptions = SEND_CONDITION_OPTIONS;

  // ONLY ENROLL IF — reuses the shared query-builder (person scalar fields the backend evaluates).
  protected readonly conditions = signal<QueryBuilderGroupNode>(emptyConditions());
  protected readonly conditionFields: QueryBuilderField[] = [
    { name: 'first_name', label: 'First name', inputType: 'text', operators: CONDITION_OPS },
    { name: 'last_name', label: 'Last name', inputType: 'text', operators: CONDITION_OPS },
    { name: 'email', label: 'Email', inputType: 'text', operators: CONDITION_OPS },
  ];

  protected readonly payload = signal<{
    name: string;
    description: string;
    trigger_type: WorkflowTriggerType;
    trigger_event_id: string;
    status: 'active' | 'draft' | 'paused';
  }>({
    name: '',
    description: '',
    trigger_type: 'manual',
    trigger_event_id: '',
    status: 'draft',
  });

  protected readonly form = form(this.payload, (p) => {
    validateStandardSchema(p, AddWorkflowObj);
  });

  protected readonly tabs = computed<PcTabOption[]>(() => [
    { id: 'sequence', label: 'Sequence designer' },
    {
      id: 'enrolled',
      label: 'Enrolled contacts',
      badge: this.isNew() ? undefined : this.enrollments().length,
      disabled: this.isNew(),
      tooltip: this.isNew() ? 'Save the automation to enroll contacts' : undefined,
    },
  ]);

  protected readonly triggerMeta = computed(() => triggerCardMeta(this.payload().trigger_type));

  // The trigger needs a specific target (tag / form / list / shift status). Manual and the
  // event-less triggers don't.
  protected readonly triggerNeedsTarget = computed(() => {
    const t = this.payload().trigger_type;
    return t === 'tag_added' || t === 'web_form_submitted' || t === 'list_joined' || t === 'volunteer_shift_status';
  });

  protected readonly triggerTargetOptions = computed<OptionRow[]>(() => {
    switch (this.payload().trigger_type) {
      case 'tag_added':
        return this.tags();
      case 'web_form_submitted':
        return this.webForms();
      case 'list_joined':
        return this.lists();
      case 'volunteer_shift_status':
        return SHIFT_STATUS_OPTIONS;
      default:
        return [];
    }
  });

  public ngOnInit(): void {
    void this.loadPickers();
    const id = this.route.snapshot.paramMap.get('id');
    if (id && id !== 'add') {
      this.isNew.set(false);
      this.workflowId.set(id);
      this.triggerSelected.set(true);
      void this.loadWorkflow();
      void this.loadSteps();
      void this.loadEnrollments();
      void this.loadRuns();
    } else {
      this.isNew.set(true);
      this.triggerSelected.set(false);
    }
  }

  // ── Recipes ────────────────────────────────────────────────────────────────
  protected readonly recipes = AUTOMATION_RECIPES;

  /** Prefill the builder from a recipe: trigger + starter sequence, still a draft to review. */
  protected applyRecipe(recipe: AutomationRecipe): void {
    this.payload.update((p) => ({
      ...p,
      name: recipe.name,
      description: recipe.description,
      trigger_type: recipe.trigger_type,
      trigger_event_id: recipe.trigger_event_id ?? '',
    }));
    this.exitConditions.set([...(recipe.exit_conditions ?? [])]);
    this.steps.set(
      recipe.steps.map((step) => ({
        uid: newUid(),
        kind: step.kind,
        config: step.config ?? {},
        delay_days: step.delay_days,
        delay_unit: step.delay_unit,
        subject: step.subject,
        preview_text: step.preview_text,
        html_content: step.html_content,
        plain_text_content: step.plain_text_content,
      })),
    );
    this.triggerSelected.set(true);
  }

  // ── Trigger picker ─────────────────────────────────────────────────────────
  protected selectTrigger(type: WorkflowTriggerType): void {
    const meta = triggerCardMeta(type);
    this.payload.update((p) => ({
      ...p,
      trigger_type: type,
      // supporter_lapsed stores its inactivity threshold (days) in trigger_event_id.
      trigger_event_id: type === 'supporter_lapsed' ? '90' : '',
      name: p.name || `${meta ? meta.title : 'New'} automation`,
    }));
    if (this.steps().length === 0) {
      // Seed a sensible first step so the sequence isn't blank.
      this.steps.set([this.makeStep('send_email')]);
    }
    this.triggerSelected.set(true);
  }

  protected changeTrigger(): void {
    this.triggerSelected.set(false);
  }

  protected setTriggerTarget(id: string): void {
    this.payload.update((p) => ({ ...p, trigger_event_id: id }));
  }

  protected setStatus(status: 'active' | 'paused'): void {
    this.payload.update((p) => ({ ...p, status }));
  }

  // ── Sequence editing ───────────────────────────────────────────────────────
  protected openAddMenu(index: number): void {
    this.addMenuIndex.set(this.addMenuIndex() === index ? null : index);
  }

  protected closeAddMenu(): void {
    this.addMenuIndex.set(null);
  }

  protected addStepAt(index: number, kind: WorkflowStepKind): void {
    const current = [...this.steps()];
    current.splice(index, 0, this.makeStep(kind));
    this.steps.set(current);
    this.addMenuIndex.set(null);
    if (kind === 'send_email') this.editingEmailStepIndex.set(index);
  }

  protected removeStep(index: number): void {
    this.steps.set(this.steps().filter((_, i) => i !== index));
  }

  /**
   * Reorder steps by drag. step_number is derived from array index on save (saveSteps assigns
   * idx + 1), so moving an item in this signal is all that's needed — the new order is persisted
   * the next time the automation is saved. The sequence stays editable in every status, so no
   * status guard is needed here (add/remove aren't guarded either).
   */
  protected reorderStep(event: CdkDragDrop<SequenceStep[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const steps = [...this.steps()];
    moveItemInArray(steps, event.previousIndex, event.currentIndex);
    this.steps.set(steps);
  }

  protected setStepDelay(index: number, value: string): void {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    this.updateStep(index, { delay_days: n });
  }

  protected setStepDelayUnit(index: number, unit: 'days' | 'hours'): void {
    this.updateStep(index, { delay_unit: unit });
  }

  protected setStepTag(index: number, tagId: string): void {
    const step = this.steps()[index];
    if (!step) return;
    const tag = this.tags().find((t) => t.id === tagId);
    this.updateStep(index, { config: { ...step.config, tag_id: tagId, tag_name: tag?.name ?? null } });
  }

  protected setStepTaskTitle(index: number, title: string): void {
    const step = this.steps()[index];
    if (!step) return;
    this.updateStep(index, { config: { ...step.config, task_title: title } });
  }

  protected setStepNotifyMember(index: number, userId: string): void {
    const step = this.steps()[index];
    if (!step) return;
    const member = this.teamMembers().find((m) => m.id === userId);
    this.updateStep(index, {
      config: { ...step.config, notify_user_id: userId || null, notify_user_name: member?.name ?? null },
    });
  }

  protected setStepEmailSubject(index: number, subject: string): void {
    this.updateStep(index, { subject });
  }

  protected setStepSendCondition(index: number, value: string): void {
    const step = this.steps()[index];
    if (!step) return;
    const condition = value === '' ? null : (value as WorkflowSendCondition);
    this.updateStep(index, { config: { ...step.config, send_condition: condition } });
  }

  /** A send condition only makes sense once an earlier email exists to check against. */
  protected hasEarlierEmailStep(index: number): boolean {
    return this.steps().some((s, i) => i < index && s.kind === 'send_email');
  }

  protected stepConditionLabel(step: SequenceStep): string | null {
    return sendConditionLabel(step.config.send_condition);
  }

  protected toggleExitCondition(value: WorkflowExitCondition): void {
    this.exitConditions.update((current) =>
      current.includes(value) ? current.filter((c) => c !== value) : [...current, value],
    );
  }

  protected exitConditionChecked(value: WorkflowExitCondition): boolean {
    return this.exitConditions().includes(value);
  }

  protected stepMeta(kind: WorkflowStepKind): StepKindMeta {
    return stepKindMeta(kind);
  }

  // ── Email designer modal ───────────────────────────────────────────────────
  protected openEmailDesigner(index: number): void {
    this.editingEmailStepIndex.set(index);
  }

  protected closeEmailDesigner(): void {
    this.editingEmailStepIndex.set(null);
  }

  protected editingEmailHtml(): string {
    const i = this.editingEmailStepIndex();
    return i == null ? '' : this.steps()[i]?.html_content || '';
  }

  protected editingEmailText(): string {
    const i = this.editingEmailStepIndex();
    return i == null ? '' : this.steps()[i]?.plain_text_content || '';
  }

  protected onEmailHtmlChange(html: string): void {
    const i = this.editingEmailStepIndex();
    if (i != null) this.updateStep(i, { html_content: html });
  }

  protected onEmailTextChange(text: string): void {
    const i = this.editingEmailStepIndex();
    if (i != null) this.updateStep(i, { plain_text_content: text });
  }

  // ── ONLY ENROLL IF ─────────────────────────────────────────────────────────
  protected onConditionsChange(): void {
    // The query-builder mutates the group node in place; re-emit to refresh the signal.
    this.conditions.set({ ...this.conditions() });
  }

  protected hasConditions(): boolean {
    return this.conditions().rules.length > 0;
  }

  // ── Save / delete ──────────────────────────────────────────────────────────
  protected async save(done?: (() => void) | Event): Promise<void> {
    if (done instanceof Event) done.preventDefault();
    if (this.saving()) return;
    this.form().markAsTouched();
    if (!this.form().valid()) {
      this.alertSvc.showError('Please give the automation a name.');
      return;
    }

    this.saving.set(true);
    try {
      await submit(this.form, {
        action: async () => {
          const end = this._loading.begin();
          try {
            const raw = this.payload();
            const conditions = this.hasConditions() ? this.conditions() : null;
            const data = {
              ...raw,
              trigger_event_id: raw.trigger_event_id ? raw.trigger_event_id : null,
              conditions,
              exit_conditions: this.exitConditions().length > 0 ? this.exitConditions() : null,
            };
            const stepPayload = this.toStepPayload();

            if (this.isNew()) {
              const result = await this.workflowsSvc.add(data);
              const newId = String(result['id']);
              this.workflowId.set(newId);
              this.isNew.set(false);
              await this.workflowsSvc.saveSteps(newId, stepPayload);
              this.workflowsSvc.triggerRefresh();
              this.alertSvc.showSuccess('Automation created');
              if (typeof done === 'function') done();
              else void this.router.navigate(['/automations', newId]);
            } else {
              const id = this.workflowId();
              if (id) {
                await this.workflowsSvc.update(id, data);
                await this.workflowsSvc.saveSteps(id, stepPayload);
              }
              this.workflowsSvc.triggerRefresh();
              this.alertSvc.showSuccess('Automation saved');
              if (typeof done === 'function') done();
              else void this.loadRuns();
            }
          } catch (err) {
            this.alertSvc.showError(
              err instanceof Error && err.message ? err.message : 'Could not save the automation.',
            );
          } finally {
            end();
          }
          return null;
        },
      });
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteWorkflow(): Promise<void> {
    const id = this.workflowId();
    if (!id) return;
    const confirmed = await this.dialogs.confirm({
      title: 'Delete automation',
      message: 'Delete this automation? Contacts already mid-sequence stop receiving its steps. This cannot be undone.',
      variant: 'danger',
      confirmText: 'Delete',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.workflowsSvc.delete(id);
      this.workflowsSvc.triggerRefresh();
      this.alertSvc.showSuccess('Automation deleted');
      await this.router.navigate(['/automations']);
    } catch (err) {
      this.alertSvc.showError(err instanceof Error && err.message ? err.message : 'Could not delete the automation.');
    } finally {
      end();
    }
  }

  // ── Enrolled tab ───────────────────────────────────────────────────────────
  protected selectTab(tab: string): void {
    this.activeTab.set(tab);
    if (tab === 'enrolled') void this.loadEnrollments();
  }

  protected async cancelEnrollment(enrollmentId: string): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: 'Cancel enrollment',
      message: 'Stop this contact’s progress through the sequence?',
      variant: 'warning',
      confirmText: 'Cancel enrollment',
    });
    if (!confirmed) return;
    const end = this._loading.begin();
    try {
      await this.workflowsSvc.cancelEnrollment(enrollmentId);
      this.alertSvc.showSuccess('Enrollment cancelled');
      void this.loadEnrollments();
    } catch {
      this.alertSvc.showError('Could not cancel the enrollment.');
    } finally {
      end();
    }
  }

  protected contactName(row: { person_first_name: string | null; person_last_name: string | null }): string {
    return `${row.person_first_name || ''} ${row.person_last_name || ''}`.trim() || 'Unknown contact';
  }

  protected stepPositionLabel(row: EnrollmentRow): string {
    const total = this.steps().length;
    if (row.status !== 'active') return row.status;
    return total > 0 ? `Step ${row.current_step_number} of ${total}` : `Step ${row.current_step_number}`;
  }

  protected runContact(run: RunRow): string {
    return `${run.person_first_name || ''} ${run.person_last_name || ''}`.trim() || 'A contact';
  }

  // ── loaders ────────────────────────────────────────────────────────────────
  private async loadPickers(): Promise<void> {
    const [tags, forms, lists, shifts, teams] = await Promise.all([
      this.safeRows(() => this.tagsSvc.getAll({ limit: 1000 })),
      this.safeRows(() => this.formsSvc.getAll({ limit: 1000 })),
      this.safeRows(() => this.listsSvc.getAll({ limit: 1000 })),
      this.safeRows(() => this.volunteerEventsSvc.getAll({ limit: 1000 })),
      this.safeRows(() => this.teamsSvc.getAll({ limit: 1000 })),
    ]);
    this.tags.set(tags);
    this.webForms.set(forms);
    this.lists.set(lists);
    this.volunteerEvents.set(shifts);
    this.teamMembers.set(teams);
  }

  private async safeRows(fn: () => Promise<{ rows?: unknown[] } | undefined>): Promise<OptionRow[]> {
    try {
      const res = await fn();
      return (res?.rows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const name =
          (rec['name'] as string) ||
          `${(rec['first_name'] as string) || ''} ${(rec['last_name'] as string) || ''}`.trim() ||
          String(rec['id']);
        return { id: String(rec['id']), name };
      });
    } catch {
      return [];
    }
  }

  private async loadWorkflow(): Promise<void> {
    const id = this.workflowId();
    if (!id) return;
    const end = this._loading.begin();
    try {
      const record = await this.workflowsSvc.getById(id);
      if (record) {
        this.payload.set({
          name: record.name || '',
          description: record.description || '',
          trigger_type: record.trigger_type || 'manual',
          trigger_event_id: record.trigger_event_id || '',
          status: record.status || 'draft',
        });
        const cond = record.conditions;
        if (cond != null && typeof cond === 'object' && (cond as { kind?: string }).kind === 'group') {
          this.conditions.set(cond as QueryBuilderGroupNode);
        }
        const exits = (record as Record<string, unknown>)['exit_conditions'];
        if (Array.isArray(exits)) {
          const known = EXIT_CONDITION_OPTIONS.map((o) => o.value as string);
          this.exitConditions.set(exits.filter((e): e is WorkflowExitCondition => known.includes(String(e))));
        }
      }
    } catch {
      this.alertSvc.showError('Could not load the automation.');
    } finally {
      end();
    }
  }

  private async loadSteps(): Promise<void> {
    const id = this.workflowId();
    if (!id) return;
    try {
      const records = await this.workflowsSvc.getSteps(id);
      this.steps.set((records ?? []).map((r) => this.fromDbStep(r as Record<string, unknown>)));
    } catch {
      /* non-fatal */
    }
  }

  private async loadEnrollments(): Promise<void> {
    const id = this.workflowId();
    if (!id) return;
    try {
      const records = await this.workflowsSvc.getEnrollments(id);
      this.enrollments.set((records ?? []) as unknown as EnrollmentRow[]);
    } catch {
      /* non-fatal */
    }
  }

  private async loadRuns(): Promise<void> {
    const id = this.workflowId();
    if (!id) return;
    try {
      const records = await this.workflowsSvc.getRuns(id, 20);
      this.runs.set((records ?? []) as unknown as RunRow[]);
    } catch {
      /* non-fatal */
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private makeStep(kind: WorkflowStepKind): SequenceStep {
    return {
      uid: newUid(),
      kind,
      config: {},
      delay_days: kind === 'wait' ? 1 : 0,
      delay_unit: 'days',
      subject: kind === 'send_email' ? 'Your message' : null,
      preview_text: null,
      html_content: kind === 'send_email' ? '<p>Hi there,</p><p>…</p>' : null,
      plain_text_content: kind === 'send_email' ? 'Hi there,\n\n…' : null,
    };
  }

  private updateStep(index: number, patch: Partial<SequenceStep>): void {
    this.steps.update((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  private toStepPayload(): SequenceStepPayload[] {
    return this.steps().map((s) => ({
      kind: s.kind,
      // wait carries no config; send_email keeps only its engagement condition.
      config:
        s.kind === 'wait'
          ? null
          : s.kind === 'send_email'
            ? s.config.send_condition
              ? { send_condition: s.config.send_condition }
              : null
            : s.config,
      delay_days: s.delay_days,
      delay_unit: s.delay_unit,
      subject: s.subject,
      preview_text: s.preview_text,
      html_content: s.html_content,
      plain_text_content: s.plain_text_content,
    }));
  }

  private fromDbStep(r: Record<string, unknown>): SequenceStep {
    const kind = (r['kind'] as WorkflowStepKind) || 'send_email';
    const rawConfig = r['config'];
    const config = rawConfig != null && typeof rawConfig === 'object' ? (rawConfig as SequenceStep['config']) : {};
    return {
      uid: newUid(),
      kind,
      config,
      delay_days: Number(r['delay_days'] ?? 0),
      delay_unit: (r['delay_unit'] as 'days' | 'hours') || 'days',
      subject: (r['subject'] as string) ?? null,
      preview_text: (r['preview_text'] as string) ?? null,
      html_content: (r['html_content'] as string) ?? null,
      plain_text_content: (r['plain_text_content'] as string) ?? null,
    };
  }
}

const CONDITION_OPS = [
  { value: 'is', label: 'is' },
  { value: 'is_not', label: 'is not' },
  { value: 'at_least', label: 'is at least' },
  { value: 'contains', label: 'contains' },
];

const SHIFT_STATUS_OPTIONS: OptionRow[] = [
  { id: 'attended', name: 'Attended' },
  { id: 'no_show', name: 'No-show' },
  { id: 'cancelled', name: 'Cancelled' },
];

function emptyConditions(): QueryBuilderGroupNode {
  return { kind: 'group', id: newUid(), conjunction: 'AND', rules: [] };
}
