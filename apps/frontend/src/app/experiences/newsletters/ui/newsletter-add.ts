import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, email, form, required } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ListsService } from '@experiences/lists/services/lists-service';
import { TagsService } from '@experiences/tags/services/tags-service';
import { Icon } from '@icons/icon';
import type { PcIconNameType } from '@icons/icons.index';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import {
  computeScore,
  lintNewsletterContent,
  preflightBand,
  preflightHashInput,
  type AiReviewStatus,
  type PreflightBand,
  type PreflightFinding,
  type PreflightResult,
  type PreflightSeverity,
} from '@common';

import { EmptyState } from '@uxcommon/components/empty-state/empty-state';
import { ModalShell } from '@uxcommon/components/modal-shell/modal-shell';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { AuthService } from '../../../auth/auth-service';
import { ConfirmDialogService } from '../../../services/shared-dialog.service';
import { SettingsService } from '../../settings/services/settings-service';
import { TemplateThumbComponent } from './template-thumb';
import { VisualNewsletterEditorComponent } from './visual-newsletter-editor';
import { compileTemplateHtml, compileTemplatePlainText } from './newsletter-templates';
import { NewslettersService } from '../services/newsletters-service';
import type { SavedNewsletterTemplate } from '../services/newsletters-service';

/** Sentence-case, heroicon-backed metadata for the four starting templates. */
const TEMPLATE_OPTIONS: ReadonlyArray<{
  id: TemplatePreset;
  name: string;
  description: string;
  icon: PcIconNameType;
}> = [
  {
    id: 'welcome',
    name: 'Welcome email',
    description: 'Warm greeting, hero image & social links.',
    icon: 'envelope',
  },
  {
    id: 'product',
    name: 'Announcement',
    description: 'Hero, list of updates & CTA button.',
    icon: 'megaphone',
  },
  {
    id: 'newsletter',
    name: 'Weekly digest',
    description: 'Heading divider & digest content.',
    icon: 'queue-list',
  },
  {
    id: 'empty',
    name: 'Empty canvas',
    description: 'Start from scratch with a single heading block.',
    icon: 'document',
  },
];

const STEP_LABELS = ['Template', 'Content', 'Audience & details', 'Review & send'] as const;
const LOCKED_STEP_TOOLTIP = 'Complete the current step first';
const DEMO_SEND_TOOLTIP = 'Sending is locked during the demo. Choose a plan, then exit demo mode';
const SUBJECT_COACH = "Add a subject line. It's the one field every recipient sees.";
const FROM_NAME_COACH = 'Add a from name so recipients know who the email is from.';
const FROM_ADDRESS_COACH = 'Choose a verified sender address.';
const SCHEDULE_COACH = 'Pick a send date and time, or switch to "Send now".';
const COMMS_SETTINGS_LINK = '/settings/communications';
const VERIFY_SENDER_LINK = '/settings/communications';

const EMPTY_REGULAR_PAYLOAD: RegularNewsletterPayload = {
  subject: '',
  previewText: '',
  fromName: '',
  fromAddress: '',
  htmlContent: '',
  plainTextContent: '',
  includeLists: [],
  includeTags: [],
  excludeLists: [],
  excludeTags: [],
  timingMode: 'now',
  scheduledDate: '',
  scheduledTime: '',
};

@Component({
  selector: 'pc-newsletter-add',
  imports: [
    EmptyState,
    FormField,
    RouterLink,
    Icon,
    ModalShell,
    TemplateThumbComponent,
    VisualNewsletterEditorComponent,
  ],
  templateUrl: './newsletter-add.html',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class NewsletterAddComponent implements OnInit {
  private readonly alertSvc = inject(AlertService);
  private readonly authSvc = inject(AuthService);
  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  private readonly listsSvc = inject(ListsService);
  private readonly newslettersSvc = inject(NewslettersService);
  private readonly numberFormatter = new Intl.NumberFormat();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly settingsSvc = inject(SettingsService);
  private readonly tagsSvc = inject(TagsService);
  private readonly timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  private readonly user = this.authSvc.getUserSignal();
  /** Sending is blocked server-side during demo mode; the disabled buttons explain it (§2 explained-disabled). */
  protected readonly isDemo = computed(() => !!this.user()?.tenant_demo_mode_at);
  protected readonly demoSendTooltip = DEMO_SEND_TOOLTIP;

  /** Draft id when opened as newsletters/:id/edit; null when creating a new newsletter. */
  private readonly editId = this.route.snapshot.paramMap.get('id');
  protected readonly isEditing = this.editId !== null;
  /** Edit mode: true once the stored draft has been hydrated into the wizard. */
  protected readonly editLoaded = signal(false);
  /** Edit mode: the stored draft name, shown as the page title (§1 real record name). */
  protected readonly editName = signal('');
  private readonly _editLoading = createLoadingGate();
  protected readonly editLoading = this._editLoading.visible;

  /** Raw wizard payload — the single source of truth the signal-form wraps. */
  protected readonly regularPayload = signal<RegularNewsletterPayload>({ ...EMPTY_REGULAR_PAYLOAD });

  protected readonly regularForm = form(this.regularPayload, (p) => {
    required(p.subject);
    required(p.fromName);
    required(p.fromAddress);
    email(p.fromAddress);
  });

  private readonly requiresScheduleDate = computed(() => {
    const raw = this.regularPayload();
    if (raw.timingMode !== 'schedule') return false;
    return !raw.scheduledDate || !raw.scheduledTime;
  });

  private readonly subjectInput = viewChild<ElementRef<HTMLInputElement>>('subjectInput');
  private readonly fromNameInput = viewChild<ElementRef<HTMLInputElement>>('fromNameInput');
  private readonly fromAddressInput = viewChild<ElementRef<HTMLSelectElement>>('fromAddressInput');

  protected readonly availableLists = signal<Array<{ id: string; name: string; size: number }>>([]);
  protected readonly availableTags = signal<Array<{ id: string; name: string; usage: number }>>([]);
  protected readonly currentStep = signal<StepIndex>(1);
  /**
   * High-water mark: the furthest step the wizard has ever reached. Stepping back must not re-lock
   * a step you already completed — otherwise "Back" silently throws away progress you can see.
   */
  protected readonly furthestStep = signal<StepIndex>(1);
  protected readonly excludeListIds = computed(() => this.regularPayload().excludeLists);
  protected readonly excludeTagsList = computed(() => this.regularPayload().excludeTags);
  protected readonly includeListIds = computed(() => this.regularPayload().includeLists);
  protected readonly includeTagsList = computed(() => this.regularPayload().includeTags);
  protected readonly loadingLists = signal<boolean>(false);
  protected readonly loadingTags = signal<boolean>(false);
  protected readonly saving = signal(false);
  protected readonly selectedTemplate = signal<TemplateSelection>({ kind: 'preset', id: 'welcome' });
  protected readonly showDatePicker = signal(false);
  /** Set true once the user has changed anything in the wizard, so the leave guard only fires on real work. */
  protected readonly dirty = signal(false);
  /** Set true after a blocked Next/Send so inline field errors appear even before the field is touched. */
  protected readonly showFieldErrors = signal(false);

  protected readonly stepIds: readonly WizardStepId[] = ['template', 'content', 'audience', 'review'];
  protected readonly steps: readonly string[] = STEP_LABELS;
  /** What the current step number means — the template switches on this. */
  protected readonly currentStepId = computed<WizardStepId>(() => this.stepIds[this.currentStep() - 1] ?? 'template');
  protected readonly isLastStep = computed(() => this.currentStep() >= this.stepIds.length);

  protected readonly templateOptions = TEMPLATE_OPTIONS;
  protected readonly lockedStepTooltip = LOCKED_STEP_TOOLTIP;
  protected readonly subjectCoach = SUBJECT_COACH;
  protected readonly fromNameCoach = FROM_NAME_COACH;
  protected readonly fromAddressCoach = FROM_ADDRESS_COACH;
  protected readonly scheduleCoach = SCHEDULE_COACH;
  protected readonly commsSettingsLink = COMMS_SETTINGS_LINK;
  protected readonly verifySenderLink = VERIFY_SENDER_LINK;
  /** Rendered literally in the content-step helper; kept as a constant so Angular doesn't parse the braces. */
  protected readonly mergeFieldExample = '{{first_name}}';

  // --- Verified senders / workspace prefill ---------------------------------

  protected readonly verifiedSenders = signal<string[]>([]);
  protected readonly commsDefaultsApplied = signal(false);

  // --- Monthly send allowance (mirror of the server's send-guards math) -----

  /** null until loaded (or when the load failed — the server still enforces the gate). */
  protected readonly sendQuota = signal<{
    cap: number | null;
    used: number;
    remaining: number | null;
    resetsAt: string | null;
  } | null>(null);
  /** True when the selected audience is larger than what's left of the monthly allowance. */
  protected readonly quotaShortfall = computed(() => {
    const quota = this.sendQuota();
    if (!quota || quota.remaining == null) return false;
    return this.estimatedAudienceCount() > quota.remaining;
  });
  protected readonly quotaResetLabel = computed(() => {
    const resetsAt = this.sendQuota()?.resetsAt;
    return resetsAt ? this.dateFormatter.format(new Date(resetsAt)) : '';
  });
  /** Why the Send button is disabled, if it is (§2 explained-disabled): demo mode or allowance.
   * A scheduled send may fire after the allowance resets, so the shortfall only blocks "Send
   * now" — the server re-checks the gate when a scheduled send actually fires either way. */
  protected readonly sendBlockedTooltip = computed<string | null>(() => {
    if (this.isDemo()) return this.demoSendTooltip;
    if (!this.orgAddressSet()) {
      return 'Set your organization’s mailing address under Settings → Organization — it appears in the footer of every newsletter';
    }
    if (this.quotaShortfall() && this.regularPayload().timingMode === 'now') {
      const remaining = this.sendQuota()?.remaining ?? 0;
      return `This audience exceeds the ${this.numberFormatter.format(remaining)} emails left in your monthly allowance`;
    }
    return null;
  });

  // --- Audience math (every line is real; the total is the single source) ---

  protected readonly includedListsTotal = computed(() => this.sumListSizes(this.includeListIds()));
  protected readonly excludedListsTotal = computed(() => this.sumListSizes(this.excludeListIds()));
  protected readonly includedTagsTotal = computed(() => this.sumTagUsage(this.includeTagsList()));
  protected readonly excludedTagsTotal = computed(() => this.sumTagUsage(this.excludeTagsList()));
  protected readonly estimatedAudienceCount = computed(() => {
    const estimate =
      this.includedListsTotal() + this.includedTagsTotal() - this.excludedListsTotal() - this.excludedTagsTotal();
    return estimate > 0 ? Math.round(estimate) : 0;
  });
  protected readonly hasAudienceSelection = computed(
    () =>
      this.includeListIds().length > 0 ||
      this.includeTagsList().length > 0 ||
      this.excludeListIds().length > 0 ||
      this.excludeTagsList().length > 0,
  );
  /** Reads the live workspace setting; ON by default (skip previously bounced addresses). */
  protected readonly skipBounced = computed(() =>
    this.settingsSvc.getValue<boolean>('communications.skip_bounced', true),
  );

  /** The compliance footer needs the org's mailing address, so sending is gated on it being set. */
  protected readonly orgAddressSet = computed(() => {
    const value = this.settingsSvc.snapshotSignal()['organization.address'];
    return typeof value === 'string' && value.trim().length > 0;
  });

  // --- Suggestion chips (a list/tag already used in one bucket isn't offered in it) ---

  protected readonly includeListSuggestions = computed(() =>
    this.availableLists().filter((l) => !this.includeListIds().includes(l.id)),
  );
  protected readonly excludeListSuggestions = computed(() =>
    this.availableLists().filter((l) => !this.excludeListIds().includes(l.id)),
  );
  protected readonly includeTagSuggestions = computed(() =>
    this.availableTags().filter((t) => !this.includeTagsList().includes(t.name)),
  );
  protected readonly excludeTagSuggestions = computed(() =>
    this.availableTags().filter((t) => !this.excludeTagsList().includes(t.name)),
  );

  public ngOnInit(): void {
    void this.loadLists();
    void this.loadTags();
    void this.loadCommsDefaults();
    void this.loadSendQuota();
    void this.loadSavedTemplates();
    if (this.editId) {
      void this.loadDraft(this.editId);
    } else {
      // Land directly in the wizard with the default template applied; not a user edit.
      this.applyTemplate('welcome');
      this.dirty.set(false);
    }
  }

  /**
   * Route-level leave guard (wired via unsavedChangesGuard in dashboard.routes.ts).
   * Offers the way out of the trap, not just the two ways to lose: saving the draft
   * is the emphasized default, discarding is the de-emphasized escape.
   */
  public async canDeactivate(): Promise<boolean> {
    if (!this.dirty()) return true;
    const choice = await this.confirmDlg.choose<LeaveChoice>({
      title: 'Leave without saving?',
      message:
        'Your changes to your draft newsletter (template, audience and copy) are not saved yet. Save it as a draft to keep working on it later.',
      variant: 'warning',
      choices: [
        { label: 'Save draft', value: 'save', variant: 'info' },
        { label: 'Discard draft', value: 'discard', variant: 'warning' },
      ],
      cancelText: 'Keep editing',
    });
    // A failed save keeps the user on the wizard with their work intact (the toast says why).
    if (choice === 'save') return this.persistDraft();
    return choice === 'discard';
  }

  // --- Step navigation ------------------------------------------------------

  protected canReachStep(step: number): boolean {
    return step <= this.furthestStep();
  }

  protected goToStep(targetStep: number): void {
    // Anything already reached is clickable; steps beyond it stay locked (they narrate why via tooltip).
    if (this.canReachStep(targetStep)) {
      this.setStep(targetStep as StepIndex);
    }
  }

  protected handleBack(): void {
    const step = this.currentStep();
    if (step === 1) {
      this.close();
    } else {
      this.setStep((step - 1) as StepIndex);
    }
  }

  protected handleNext(): void {
    const step = this.currentStep();

    if (this.currentStepId() === 'audience' && !this.validateDetails()) return;

    if (step >= this.stepIds.length) return;
    this.showFieldErrors.set(false);
    this.setStep((step + 1) as StepIndex);
  }

  /** Jump to a step by meaning, not number. */
  private goToStepId(id: WizardStepId): void {
    const index = this.stepIds.indexOf(id);
    if (index >= 0) this.setStep((index + 1) as StepIndex);
  }

  /** The single writer for step state, so the high-water mark can never drift from where we've been. */
  private setStep(step: StepIndex): void {
    this.currentStep.set(step);
    if (step > this.furthestStep()) this.furthestStep.set(step);
  }

  // --- Template -------------------------------------------------------------

  protected close(): void {
    void this.router.navigate(['../'], { relativeTo: this.route });
  }

  protected selectTemplate(preset: TemplatePreset): void {
    this.applyTemplate(preset);
    this.markDirty();
  }

  protected selectedTemplateName(): string {
    const selection = this.selectedTemplate();
    if (selection.kind === 'preset') {
      return TEMPLATE_OPTIONS.find((t) => t.id === selection.id)?.name ?? 'Template';
    }
    return this.savedTemplates().find((t) => t.id === selection.id)?.name ?? 'Saved template';
  }

  protected isPresetSelected(preset: TemplatePreset): boolean {
    const selection = this.selectedTemplate();
    return selection.kind === 'preset' && selection.id === preset;
  }

  protected isSavedSelected(id: string): boolean {
    const selection = this.selectedTemplate();
    return selection.kind === 'saved' && selection.id === id;
  }

  /** Compiled preset previews for the template cards — pure functions, compiled once and cached. */
  private readonly presetPreviewCache = new Map<TemplatePreset, string>();

  protected presetPreviewHtml(preset: TemplatePreset): string {
    const cached = this.presetPreviewCache.get(preset);
    if (cached !== undefined) return cached;
    const compiled = compileTemplateHtml(preset);
    this.presetPreviewCache.set(preset, compiled);
    return compiled;
  }

  // --- Saved templates ("Your templates") -----------------------------------

  protected readonly savedTemplates = signal<SavedNewsletterTemplate[]>([]);
  private readonly _templatesLoading = createLoadingGate();
  protected readonly templatesLoading = this._templatesLoading.visible;

  /** Applies a saved template's stored content — same overwrite semantics as the presets. */
  protected selectSavedTemplate(template: SavedNewsletterTemplate): void {
    this.selectedTemplate.set({ kind: 'saved', id: template.id });
    this.regularPayload.update((p) => ({
      ...p,
      htmlContent: template.html_content,
      plainTextContent: template.plain_text_content,
    }));
    this.markDirty();
  }

  protected savedTemplateSubtitle(template: SavedNewsletterTemplate): string {
    return template.updated_at ? `Saved ${this.dateFormatter.format(template.updated_at)}` : 'Saved template';
  }

  protected async deleteSavedTemplate(template: SavedNewsletterTemplate): Promise<void> {
    const confirmed = await this.confirmDlg.confirm({
      title: `Delete template "${template.name}"?`,
      message: `"${template.name}" will be removed from your saved templates for everyone in this workspace. Newsletters already created from it keep their content.`,
      variant: 'danger',
      confirmText: 'Delete template',
      cancelText: 'Keep template',
    });
    if (!confirmed) return;
    try {
      await this.newslettersSvc.deleteTemplate(template.id);
      this.savedTemplates.update((list) => list.filter((t) => t.id !== template.id));
      this.alertSvc.showSuccess(`Deleted template "${template.name}"`);
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not delete this template. Try again.'));
    }
  }

  private async loadSavedTemplates(): Promise<void> {
    const end = this._templatesLoading.begin();
    try {
      this.savedTemplates.set(await this.newslettersSvc.getTemplates());
    } catch {
      // Non-fatal: the presets still serve; the section simply stays hidden.
    } finally {
      end();
    }
  }

  // --- Save as template -----------------------------------------------------

  protected readonly saveTemplateOpen = signal(false);
  protected readonly savingTemplate = signal(false);
  protected readonly templateNamePayload = signal({ name: '' });
  protected readonly templateNameForm = form(this.templateNamePayload, (p) => {
    required(p.name);
  });

  protected openSaveTemplate(): void {
    this.templateNamePayload.set({ name: '' });
    this.templateNameForm().reset();
    this.saveTemplateOpen.set(true);
  }

  protected closeSaveTemplate(): void {
    this.saveTemplateOpen.set(false);
  }

  protected templateNameInvalid(): boolean {
    const state = this.templateNameForm.name();
    return state.invalid() && (state.touched() || state.dirty());
  }

  /** Saves the wizard's current html/plain content verbatim under the chosen name. */
  protected async saveAsTemplate(): Promise<void> {
    if (this.savingTemplate()) return;
    this.templateNameForm().markAsTouched();
    if (this.templateNameForm().invalid()) return;
    const name = this.templateNamePayload().name.trim();
    const raw = this.regularPayload();
    this.savingTemplate.set(true);
    try {
      const created = await this.newslettersSvc.saveTemplate({
        name,
        html_content: raw.htmlContent,
        plain_text_content: raw.plainTextContent,
      });
      this.savedTemplates.update((list) =>
        [...list.filter((t) => t.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      this.saveTemplateOpen.set(false);
      this.alertSvc.showSuccess('Template saved');
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not save this template. Try again.'));
    } finally {
      this.savingTemplate.set(false);
    }
  }

  // --- Audience: add / remove -----------------------------------------------

  protected addIncludeList(listId: string): void {
    if (this.includeListIds().includes(listId)) return;
    // A list can't be both included and excluded.
    this.setExcludeLists(this.excludeListIds().filter((id) => id !== listId));
    this.setIncludeLists([...this.includeListIds(), listId]);
  }

  protected removeIncludeList(listId: string): void {
    this.setIncludeLists(this.includeListIds().filter((id) => id !== listId));
  }

  protected addExcludeList(listId: string): void {
    if (this.excludeListIds().includes(listId)) return;
    this.setIncludeLists(this.includeListIds().filter((id) => id !== listId));
    this.setExcludeLists([...this.excludeListIds(), listId]);
  }

  protected removeExcludeList(listId: string): void {
    this.setExcludeLists(this.excludeListIds().filter((id) => id !== listId));
  }

  protected addIncludeTag(name: string): void {
    if (this.includeTagsList().includes(name)) return;
    this.setExcludeTags(this.excludeTagsList().filter((t) => t !== name));
    this.setIncludeTags([...this.includeTagsList(), name]);
  }

  protected removeIncludeTag(name: string): void {
    this.setIncludeTags(this.includeTagsList().filter((t) => t !== name));
  }

  protected addExcludeTag(name: string): void {
    if (this.excludeTagsList().includes(name)) return;
    this.setIncludeTags(this.includeTagsList().filter((t) => t !== name));
    this.setExcludeTags([...this.excludeTagsList(), name]);
  }

  protected removeExcludeTag(name: string): void {
    this.setExcludeTags(this.excludeTagsList().filter((t) => t !== name));
  }

  protected listName(id: string): string {
    return this.availableLists().find((list) => list.id === id)?.name ?? 'List';
  }

  protected listSize(id: string): number {
    return this.availableLists().find((list) => list.id === id)?.size ?? 0;
  }

  protected tagUsage(name: string): number {
    return this.availableTags().find((tag) => tag.name === name)?.usage ?? 0;
  }

  protected formatCount(value: number): string {
    return this.numberFormatter.format(value);
  }

  /** "1 person" / "1,312 people" — honest scale for buttons and copy. */
  protected peopleLabel(value: number): string {
    return `${this.formatCount(value)} ${value === 1 ? 'person' : 'people'}`;
  }

  // --- Schedule -------------------------------------------------------------

  protected isInvalid(field: 'subject' | 'fromName' | 'fromAddress'): boolean {
    const state = this.regularForm[field]();
    return state.invalid() && (state.dirty() || state.touched() || this.showFieldErrors());
  }

  protected onScheduledDateChange(event: unknown): void {
    const value = this.normalizeCalendarValue(event) ?? '';
    const state = this.regularForm.scheduledDate();
    state.value.set(value);
    state.markAsDirty();
    state.markAsTouched();
    this.markDirty();
    this.showDatePicker.set(false);
  }

  protected scheduledDateDisplay(): string {
    const value = this.scheduledDateValue();
    if (!value) return 'Select a date';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : this.dateFormatter.format(parsed);
  }

  protected scheduledDateValue(): string {
    return this.regularPayload().scheduledDate;
  }

  protected timingNeedsDate(): boolean {
    return this.requiresScheduleDate();
  }

  protected toggleDatePicker(): void {
    this.showDatePicker.update((open) => !open);
  }

  protected onFieldInput(): void {
    this.markDirty();
  }

  protected setTimingMode(mode: TimingMode): void {
    this.regularForm.timingMode().value.set(mode);
    this.markDirty();
  }

  protected onTimingChange(): void {
    this.markDirty();
  }

  protected onEditorHtmlChange(html: string): void {
    this.regularForm.htmlContent().value.set(html);
    this.markDirty();
  }

  protected onEditorTextChange(text: string): void {
    this.regularForm.plainTextContent().value.set(text);
  }

  protected goToVerifySender(): void {
    void this.router.navigateByUrl(this.verifySenderLink);
  }

  // --- Deliverability preflight --------------------------------------------

  /** Full server check (lint + SpamAssassin + AI review) and the content key it was run for. */
  private readonly serverPreflight = signal<{ key: string; result: PreflightResult } | null>(null);
  protected readonly preflightRunning = signal(false);

  /** Canonical key of the current content — a stored server result is stale once this changes. */
  private readonly preflightContentKey = computed(() => {
    const raw = this.regularPayload();
    return preflightHashInput(raw.subject, raw.htmlContent, raw.plainTextContent);
  });

  /** Instant local lint of the current content — shown until a full server check runs. */
  private readonly quickPreflight = computed<PreflightView>(() => {
    const raw = this.regularPayload();
    const findings = lintNewsletterContent({
      subject: raw.subject,
      html: raw.htmlContent,
      plainText: raw.plainTextContent || undefined,
    });
    const score = computeScore(findings);
    return { score, band: preflightBand(score), findings, kind: 'quick', aiStatus: 'not_required' };
  });

  /** What the Review card and the confirm dialog show: the full check while it still matches the
   * content, otherwise the live quick check. */
  protected readonly preflightView = computed<PreflightView>(() => {
    const server = this.serverPreflight();
    if (server && server.key === this.preflightContentKey()) {
      const r = server.result;
      return { score: r.score, band: r.band, findings: r.findings, kind: 'full', aiStatus: r.aiStatus };
    }
    return this.quickPreflight();
  });

  protected async runFullPreflight(): Promise<void> {
    if (this.preflightRunning()) return;
    const raw = this.regularPayload();
    const key = this.preflightContentKey();
    this.preflightRunning.set(true);
    try {
      const result = await this.newslettersSvc.runPreflight({
        subject: raw.subject,
        html: raw.htmlContent,
        plainText: raw.plainTextContent || undefined,
      });
      this.serverPreflight.set({ key, result });
      if (this.currentStepId() !== 'review') {
        this.alertSvc.showInfo(`Deliverability score ${result.score} — details on the review step.`);
      }
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not run the deliverability check. Try again.'));
    } finally {
      this.preflightRunning.set(false);
    }
  }

  protected preflightBandCopy(band: PreflightBand): string {
    switch (band) {
      case 'good':
        return 'Looking good — ready to send';
      case 'fix':
        return 'Fix these before sending';
      default:
        return 'Sending is disabled until you fix the items below';
    }
  }

  protected preflightGaugeClass(band: PreflightBand): string {
    switch (band) {
      case 'good':
        return 'text-success';
      case 'fix':
        return 'text-warning';
      default:
        return 'text-error';
    }
  }

  protected preflightSeverityIcon(severity: PreflightSeverity): PcIconNameType {
    switch (severity) {
      case 'block':
        return 'x-circle';
      case 'warn':
        return 'exclamation-triangle';
      default:
        return 'information-circle';
    }
  }

  protected preflightSeverityClass(severity: PreflightSeverity): string {
    switch (severity) {
      case 'block':
        return 'text-error';
      case 'warn':
        return 'text-warning';
      default:
        return 'text-info';
    }
  }

  // --- Test send ------------------------------------------------------------

  protected async sendTestEmail(): Promise<void> {
    const raw = this.regularPayload();
    const to = this.authSvc.getUser()?.email;
    if (!to) {
      this.alertSvc.showError('We could not find your email address for the test send.');
      return;
    }
    const subject = raw.subject || 'Your newsletter';
    try {
      await this.newslettersSvc.sendTest({
        subject,
        html: raw.htmlContent,
        text: raw.plainTextContent,
        to,
        fromName: raw.fromName,
        fromEmail: raw.fromAddress,
      });
      this.alertSvc.showSuccess(`Sent a test of "${subject}" to ${to}`);
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not send the test email. Try again.'));
    }
  }

  // --- Save draft -----------------------------------------------------------

  protected async saveDraft(): Promise<void> {
    if (await this.persistDraft()) this.close();
  }

  /**
   * Writes the wizard's current state as a draft and reports whether it landed. Kept separate from
   * saveDraft() so the leave guard can save without navigating itself (the router is already
   * navigating), and can keep the user here when the save fails.
   */
  private async persistDraft(): Promise<boolean> {
    if (this.saving()) return false;
    // Edit mode: never write an empty payload over the draft before hydration lands.
    if (this.isEditing && !this.editLoaded()) return false;
    const raw = this.regularPayload();
    const subject = raw.subject || 'Untitled draft';
    this.saving.set(true);
    try {
      if (this.editId) {
        await this.newslettersSvc.update(this.editId, this.buildPayload('draft'));
      } else {
        await this.newslettersSvc.add(this.buildPayload('draft'));
      }
      this.dirty.set(false);
      // Edit mode closes onto the draft's own page; create mode closes onto the list.
      this.alertSvc.showSuccess(
        this.editId ? `Saved draft "${subject}"` : `Saved draft "${subject}". Find it in Newsletters`,
      );
      return true;
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not save your draft. Try again.'));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  // --- Send / schedule (with preflight) -------------------------------------

  protected async sendRegular(): Promise<void> {
    if (this.saving()) return;
    if (this.isEditing && !this.editLoaded()) return;
    if (!this.validateDetails()) {
      this.goToStepId('audience');
      return;
    }
    if (this.requiresScheduleDate()) {
      this.regularForm.scheduledDate().markAsTouched();
      this.regularForm.scheduledTime().markAsTouched();
      this.showFieldErrors.set(true);
      this.alertSvc.showError(this.scheduleCoach);
      return;
    }

    // The server enforces this again at send time; catching it here routes the user to the
    // findings instead of a failed request.
    const check = this.preflightView();
    if (check.band === 'blocked') {
      this.goToStepId('review');
      this.alertSvc.showError(
        `Deliverability score ${check.score} — fix the items flagged in the deliverability check before sending.`,
      );
      return;
    }

    const raw = this.regularPayload();
    const scheduled = raw.timingMode === 'schedule';
    const count = this.estimatedAudienceCount();
    const subject = raw.subject || 'Untitled newsletter';
    const whenLabel = scheduled ? this.scheduleWhenLabel() : 'now';

    const confirmed = await this.confirmDlg.confirm({
      title: scheduled ? `Schedule "${subject}" for ${whenLabel}?` : `Send "${subject}" now?`,
      message: this.preflightMessage(count),
      variant: 'info',
      icon: 'paper-airplane',
      confirmText: scheduled ? `Schedule for ${this.peopleLabel(count)}` : `Send to ${this.peopleLabel(count)}`,
      cancelText: 'Keep editing',
      emphasizeCancel: true,
    });
    if (!confirmed) return;

    this.saving.set(true);
    try {
      let targetId: string | null = this.editId;
      if (this.editId) {
        await this.newslettersSvc.update(this.editId, this.buildPayload(scheduled ? 'scheduled' : 'draft'));
      } else {
        const created = await this.newslettersSvc.add(this.buildPayload(scheduled ? 'scheduled' : 'draft'));
        targetId = this.extractId(created);
      }
      if (!scheduled && targetId) {
        await this.newslettersSvc.send(targetId);
      }
      this.dirty.set(false);
      this.alertSvc.showSuccess(
        scheduled
          ? `Scheduled "${subject}" for ${whenLabel}; it goes out within a few minutes of that time`
          : `Queued "${subject}" to ${this.peopleLabel(count)}, sending now`,
      );
      this.close();
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not send this newsletter. Try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  // --- Internals ------------------------------------------------------------

  private applyTemplate(preset: TemplatePreset): void {
    this.selectedTemplate.set({ kind: 'preset', id: preset });
    this.regularPayload.update((p) => ({
      ...p,
      htmlContent: compileTemplateHtml(preset),
      plainTextContent: compileTemplatePlainText(preset),
    }));
  }

  /** Edit mode: hydrate the wizard from the stored draft, then land on the content step. */
  private async loadDraft(id: string): Promise<void> {
    const end = this._editLoading.begin();
    try {
      const record: unknown = await this.newslettersSvc.getById(id);
      const row = record && typeof record === 'object' ? (record as Record<string, unknown>) : null;
      if (!row) {
        this.alertSvc.showError('We could not find this newsletter.');
        this.close();
        return;
      }
      if (row['status'] !== 'draft') {
        // Only drafts are editable; anything further along opens as its details/report page.
        void this.router.navigate(['/newsletters', id]);
        return;
      }
      const str = (v: unknown): string => (typeof v === 'string' ? v : '');
      const name = str(row['name']);
      const lists = this.parseIdSets(row['target_lists']);
      const tags = this.parseIdSets(row['segments']);
      const rawDate = row['send_date'];
      const sendDate = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : null;
      const pad = (n: number) => String(n).padStart(2, '0');
      this.regularPayload.update((p) => ({
        ...p,
        // Drafts saved without a subject fall back to a placeholder name; don't hydrate that back in.
        subject: str(row['subject']) || (name === 'Unnamed Newsletter' || name === 'Untitled draft' ? '' : name),
        previewText: str(row['preview_text']),
        htmlContent: str(row['html_content']),
        plainTextContent: str(row['plain_text_content']),
        includeLists: lists.include,
        excludeLists: lists.exclude,
        includeTags: tags.include,
        excludeTags: tags.exclude,
        timingMode: sendDate ? 'schedule' : p.timingMode,
        scheduledDate: sendDate
          ? `${sendDate.getFullYear()}-${pad(sendDate.getMonth() + 1)}-${pad(sendDate.getDate())}`
          : p.scheduledDate,
        scheduledTime: sendDate ? `${pad(sendDate.getHours())}:${pad(sendDate.getMinutes())}` : p.scheduledTime,
      }));
      this.editName.set(name);
      // The template step is moot for an existing draft; its saved content is the design.
      this.setStep(2);
      // A saved draft already carries content, audience and details, so nothing is "not yet reached" —
      // reopening one must not re-lock the steps the user had already worked through.
      this.furthestStep.set(this.stepIds.length as StepIndex);
      this.editLoaded.set(true);
      this.dirty.set(false);
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not open this draft. Try again.'));
      this.close();
    } finally {
      end();
    }
  }

  /** Tolerates the shapes drafts have stored: {include, exclude} JSON, a bare array, or null. */
  private parseIdSets(value: unknown): { include: string[]; exclude: string[] } {
    let parsed: unknown = value;
    if (typeof parsed === 'string') {
      if (!parsed.trim()) return { include: [], exclude: [] };
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return { include: [], exclude: [] };
      }
    }
    if (Array.isArray(parsed)) return { include: parsed.map((v) => String(v)), exclude: [] };
    if (parsed && typeof parsed === 'object') {
      const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
      const obj = parsed as Record<string, unknown>;
      return { include: toIds(obj['include']), exclude: toIds(obj['exclude']) };
    }
    return { include: [], exclude: [] };
  }

  private validateDetails(): boolean {
    this.markDetailsTouched();
    this.showFieldErrors.set(true);
    const invalidField = this.firstInvalidDetail();
    if (invalidField) {
      this.focusAndCoach(invalidField);
      return false;
    }
    return true;
  }

  private firstInvalidDetail(): 'subject' | 'fromName' | 'fromAddress' | null {
    if (this.regularForm.subject().invalid()) return 'subject';
    if (this.regularForm.fromName().invalid()) return 'fromName';
    if (this.regularForm.fromAddress().invalid()) return 'fromAddress';
    return null;
  }

  private focusAndCoach(field: 'subject' | 'fromName' | 'fromAddress'): void {
    const map = {
      subject: { ref: this.subjectInput(), coach: this.subjectCoach },
      fromName: { ref: this.fromNameInput(), coach: this.fromNameCoach },
      fromAddress: { ref: this.fromAddressInput(), coach: this.fromAddressCoach },
    } as const;
    const target = map[field];
    target.ref?.nativeElement.focus();
    this.alertSvc.showError(target.coach);
  }

  private preflightMessage(count: number): string {
    const check = this.preflightView();
    const flagged = check.findings.length;
    const scoreLine =
      check.band === 'good'
        ? `Deliverability score ${check.score} — looking good.`
        : `Deliverability score ${check.score} — ${flagged} item${flagged === 1 ? '' : 's'} worth fixing first (see the Review & send step).`;
    const base = `It will go to ${this.peopleLabel(count)}.`;
    if (this.skipBounced()) {
      return `${scoreLine} ${base} Previously bounced addresses are skipped automatically.`;
    }
    return `${scoreLine} ${base} Bounced addresses are NOT being skipped (Workspace setting).`;
  }

  private scheduleWhenLabel(): string {
    const date = this.scheduledDateValue();
    const time = this.regularPayload().scheduledTime;
    if (!date) return 'the scheduled time';
    const parsed = new Date(`${date}T${time || '00:00'}`);
    if (Number.isNaN(parsed.getTime())) return `${date} ${time}`.trim();
    return time
      ? `${this.dateFormatter.format(parsed)} at ${this.timeFormatter.format(parsed)}`
      : this.dateFormatter.format(parsed);
  }

  private buildPayload(status: 'draft' | 'scheduled'): Parameters<NewslettersService['add']>[0] {
    const raw = this.regularPayload();
    const scheduledAt =
      status === 'scheduled' && raw.scheduledDate && raw.scheduledTime
        ? new Date(`${raw.scheduledDate}T${raw.scheduledTime}`)
        : null;

    return {
      name: raw.subject || 'Unnamed Newsletter',
      status,
      subject: raw.subject,
      preview_text: raw.previewText,
      audience_description: this.buildAudienceDescription(),
      target_lists: JSON.stringify({ include: raw.includeLists, exclude: raw.excludeLists }),
      segments: JSON.stringify({ include: raw.includeTags, exclude: raw.excludeTags }),
      html_content: raw.htmlContent,
      plain_text_content: raw.plainTextContent,
      send_date: scheduledAt,
      total_recipients: this.estimatedAudienceCount(),
    };
  }

  private buildAudienceDescription(): string {
    const includeLists = this.includeListIds().map((id) => this.listName(id));
    const includeTags = this.includeTagsList();
    const excludeLists = this.excludeListIds().map((id) => this.listName(id));
    const excludeTags = this.excludeTagsList();

    const parts: string[] = [];
    if (includeLists.length || includeTags.length) {
      parts.push(
        `Targeting lists: [${includeLists.join(', ') || 'None'}], tags: [${includeTags.join(', ') || 'None'}]`,
      );
    }
    if (excludeLists.length || excludeTags.length) {
      parts.push(
        `Excluding lists: [${excludeLists.join(', ') || 'None'}], tags: [${excludeTags.join(', ') || 'None'}]`,
      );
    }
    return parts.length ? parts.join(' ') : 'No target audience configured.';
  }

  private markDetailsTouched(): void {
    this.regularForm.subject().markAsTouched();
    this.regularForm.fromName().markAsTouched();
    this.regularForm.fromAddress().markAsTouched();
  }

  private markDirty(): void {
    if (!this.dirty()) this.dirty.set(true);
  }

  private setIncludeLists(next: string[]): void {
    this.writeAudience('includeLists', next);
  }

  private setExcludeLists(next: string[]): void {
    this.writeAudience('excludeLists', next);
  }

  private setIncludeTags(next: string[]): void {
    this.writeAudience('includeTags', next);
  }

  private setExcludeTags(next: string[]): void {
    this.writeAudience('excludeTags', next);
  }

  private writeAudience(key: 'includeLists' | 'excludeLists' | 'includeTags' | 'excludeTags', next: string[]): void {
    this.regularPayload.update((p) => ({ ...p, [key]: next }));
    this.markDirty();
  }

  private sumListSizes(ids: string[]): number {
    const sizeById = new Map(this.availableLists().map((l) => [l.id, Number(l.size) || 0]));
    return ids.reduce((sum, id) => sum + (sizeById.get(id) ?? 0), 0);
  }

  private sumTagUsage(names: string[]): number {
    const usageByName = new Map(this.availableTags().map((t) => [t.name, Number(t.usage) || 0]));
    return names.reduce((sum, name) => sum + (usageByName.get(name) ?? 0), 0);
  }

  private async loadLists(): Promise<void> {
    this.loadingLists.set(true);
    try {
      const result = await this.listsSvc.getAll({ limit: 100, startRow: 0 });
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      this.availableLists.set(
        rows
          .filter((row: { id?: unknown; name?: unknown }) => row?.id && row?.name)
          .map((row: Record<string, unknown>) => ({
            id: String(row['id']),
            name: String(row['name']),
            size:
              Number(row['list_size'] ?? row['people_count'] ?? row['household_count'] ?? row['member_count'] ?? 0) ||
              0,
          })),
      );
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not load lists. Try again later.'));
    } finally {
      this.loadingLists.set(false);
    }
  }

  private async loadTags(): Promise<void> {
    this.loadingTags.set(true);
    try {
      const result = await this.tagsSvc.getAll({ limit: 100, startRow: 0 });
      const rows = Array.isArray((result as { rows?: unknown })?.rows) ? (result as { rows: unknown[] }).rows : [];
      this.availableTags.set(
        rows
          .filter(
            (row): row is Record<string, unknown> => !!row && typeof row === 'object' && 'id' in row && 'name' in row,
          )
          .filter((row) => row['id'] && row['name'])
          .map((row) => ({
            id: String(row['id']),
            name: String(row['name']),
            usage: Number(row['use_count_people'] ?? 0) + Number(row['use_count_households'] ?? 0),
          })),
      );
    } catch (err) {
      this.alertSvc.showError(this.errorMessage(err, 'We could not load tags. Try again later.'));
    } finally {
      this.loadingTags.set(false);
    }
  }

  private async loadCommsDefaults(): Promise<void> {
    try {
      await this.settingsSvc.load();
    } catch {
      // Non-fatal: the sender fields simply won't prefill.
      return;
    }
    this.verifiedSenders.set(this.settingsSvc.getValue<string[]>('communications.verified_emails', []) ?? []);

    const defaultName = this.settingsSvc.getValue<string>('communications.default_from_name', '');
    const defaultEmail = this.settingsSvc.getValue<string>('communications.default_from_email', '');
    let applied = false;
    if (defaultName && !this.regularPayload().fromName) {
      this.regularForm.fromName().value.set(defaultName);
      applied = true;
    }
    if (defaultEmail && this.verifiedSenders().includes(defaultEmail) && !this.regularPayload().fromAddress) {
      this.regularForm.fromAddress().value.set(defaultEmail);
      applied = true;
    }
    this.commsDefaultsApplied.set(applied);
  }

  private async loadSendQuota(): Promise<void> {
    try {
      this.sendQuota.set(await this.newslettersSvc.getSendQuota());
    } catch {
      // Non-fatal: the Review step just won't show the allowance line — the server still enforces it.
    }
  }

  private normalizeCalendarValue(event: unknown): string | null {
    const raw = this.readCalendarRaw(event);
    if (!raw) return null;
    const text = String(raw).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  private readCalendarRaw(event: unknown): string | null {
    if (typeof event === 'string') return event;
    if (!event || typeof event !== 'object') return null;
    const e = event as Record<string, unknown>;
    const detail = e['detail'];
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && typeof (detail as Record<string, unknown>)['value'] === 'string') {
      return (detail as Record<string, unknown>)['value'] as string;
    }
    const target = e['target'];
    if (target && typeof target === 'object' && typeof (target as Record<string, unknown>)['value'] === 'string') {
      return (target as Record<string, unknown>)['value'] as string;
    }
    if (typeof e['value'] === 'string') return e['value'] as string;
    return null;
  }

  private extractId(created: unknown): string | null {
    if (created && typeof created === 'object' && 'id' in created) {
      const id = (created as Record<string, unknown>)['id'];
      return id != null ? String(id) : null;
    }
    return null;
  }

  private errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
  }
}

/** Deliverability-check view model: a full server run, or the instant local quick check. */
interface PreflightView {
  score: number;
  band: PreflightBand;
  findings: PreflightFinding[];
  kind: 'full' | 'quick';
  aiStatus: AiReviewStatus;
}

type StepIndex = 1 | 2 | 3 | 4;

type WizardStepId = 'template' | 'content' | 'audience' | 'review';

type TemplatePreset = 'welcome' | 'product' | 'newsletter' | 'empty';

/** What the Template step has selected: a built-in preset or a user-saved template. */
type TemplateSelection = { kind: 'preset'; id: TemplatePreset } | { kind: 'saved'; id: string };

type TimingMode = 'now' | 'schedule';

/** The two ways out of the leave guard; cancelling it (Keep editing) resolves to null instead. */
type LeaveChoice = 'save' | 'discard';

interface RegularNewsletterPayload {
  subject: string;
  previewText: string;
  fromName: string;
  fromAddress: string;
  htmlContent: string;
  plainTextContent: string;
  includeLists: string[];
  includeTags: string[];
  excludeLists: string[];
  excludeTags: string[];
  timingMode: TimingMode;
  scheduledDate: string;
  scheduledTime: string;
}
