import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { emailSchema } from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ELECTORAL_IMPORT_FIELDS } from '@uxcommon/components/csv-import/persons-field-mapping';
import { createLoadingGate } from '@uxcommon/loading-gate';

import { CompaniesService } from '../../companies/services/companies-service';
import { HouseholdsService } from '../../households/services/households-service';
import { ListsService } from '../../lists/services/lists-service';
import { PersonsService } from '../../persons/services/persons-service';
import { TasksService } from '../../tasks/services/tasks-service';
import {
  IMPORT_ENTITY_CONFIGS,
  IMPORT_ENTITY_TYPES,
  isImportEntityType,
  type ImportEntityType,
} from '../import-entity-config';
import { ImportsService } from '../services/imports-service';

/**
 * The district, ward and precinct values a mapped row carries, if any.
 *
 * The people branch sends its rows to the server exactly as mapped, so it needs nothing. The
 * households branch rebuilds each row field by field — which is what silently dropped these columns
 * — so it spreads this in. Absent keys are left out rather than sent as undefined, so a file with
 * no electoral columns sends the same payload it always did.
 */
function electoralFieldsOf(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of ELECTORAL_IMPORT_FIELDS) {
    const value = row[field];
    if (value) out[field] = value;
  }
  return out;
}

/** The four steps of the CSV import wizard (spec §17), in order. */
type WizardStep = 'upload' | 'map' | 'review' | 'confirm';

type DuplicateDecision = 'merge' | 'skip' | 'import_new';
type BadEmailDecision = 'skip' | 'strip';

interface DuplicateMatch {
  email: string;
  person_id: string;
  name: string;
  slug: string | null;
}

/** Confirm & run step state, modeled as a discriminated union (never a bag of optionals). */
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | {
      status: 'done';
      inserted: number;
      merged: number;
      skipped: number;
      errors: number;
      tag: string | null;
      importId: string | null;
    }
  | { status: 'error'; message: string };

/** How long to wait between status polls once an import has been queued. */
const POLL_INTERVAL_MS = 1500;
/** Give up narrating progress (the import itself keeps running server-side) after this long. */
const POLL_TIMEOUT_MS = 120_000;

@Component({
  selector: 'pc-import-wizard',
  imports: [Icon, RouterLink],
  templateUrl: './import-wizard.html',
})
export class ImportWizard {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly alerts = inject(AlertService);
  private readonly personsService = inject(PersonsService);
  private readonly companiesService = inject(CompaniesService);
  private readonly householdsService = inject(HouseholdsService);
  private readonly tasksService = inject(TasksService);
  private readonly importsService = inject(ImportsService);
  private readonly listsService = inject(ListsService);

  private readonly _duplicateCheck = createLoadingGate();
  protected readonly checkingDuplicates = this._duplicateCheck.visible;

  // --- What are you importing? ---
  protected readonly entityTypes = IMPORT_ENTITY_TYPES;
  protected readonly configs = IMPORT_ENTITY_CONFIGS;
  private readonly requestedType = this.route.snapshot.queryParamMap.get('type');
  protected readonly entity = signal<ImportEntityType>(
    isImportEntityType(this.requestedType) ? this.requestedType : 'people',
  );
  protected readonly config = computed(() => IMPORT_ENTITY_CONFIGS[this.entity()]);

  protected readonly step = signal<WizardStep>('upload');
  protected readonly stepOrder: WizardStep[] = ['upload', 'map', 'review', 'confirm'];
  protected readonly stepLabels: Record<WizardStep, string> = {
    upload: 'Upload',
    map: 'Map columns',
    review: 'Review',
    confirm: 'Import',
  };
  protected readonly currentStepIndex = computed(() => this.stepOrder.indexOf(this.step()));

  /** A step is reachable once its prerequisite data exists — never skip ahead of validation. */
  protected canReachStep(target: WizardStep): boolean {
    const targetIdx = this.stepOrder.indexOf(target);
    if (targetIdx <= this.currentStepIndex()) return true;
    if (target === 'map') return this.rowCount() > 0;
    if (target === 'review') return this.canContinueToReview();
    return false;
  }

  // --- Upload ---
  protected readonly parsing = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly fileName = signal<string | null>(null);
  private fileText = '';
  protected readonly headers = signal<string[]>([]);
  protected readonly rawRows = signal<Array<Record<string, string>>>([]);

  protected readonly rowCount = computed(() => this.rawRows().length);
  protected readonly columnCount = computed(() => this.headers().length);

  // --- Map columns ---
  protected readonly mapping = signal<string[]>([]); // index-aligned with headers()

  protected readonly mappedColumnCount = computed(() => this.mapping().filter((m) => !!m).length);
  protected readonly skippedColumnCount = computed(() => this.columnCount() - this.mappedColumnCount());

  /** Required fields (e.g. a company/task name) that no column is mapped to yet. */
  protected readonly missingRequiredFields = computed(() => {
    const mapped = new Set(this.mapping().filter((m) => !!m));
    return this.config().requiredFields.filter((field) => !mapped.has(field));
  });
  protected readonly missingRequiredFieldLabels = computed(() =>
    this.missingRequiredFields()
      .map((field) => this.config().fieldLabels[field] ?? field)
      .join(', '),
  );
  protected readonly canContinueToReview = computed(
    () => this.mappedColumnCount() > 0 && this.missingRequiredFields().length === 0,
  );

  /** Every row, with only its mapped, non-blank fields — the shape the backend import mutation expects. */
  protected readonly mappedRows = computed(() => {
    const headers = this.headers();
    const mapping = this.mapping();
    return this.rawRows().map((row) => {
      const out: Record<string, string> = {};
      headers.forEach((header, idx) => {
        const field = mapping[idx];
        if (!field) return;
        const value = (row[header] ?? '').toString().trim();
        if (value && !(field in out)) out[field] = value;
      });
      return out;
    });
  });

  protected readonly importableRowCount = computed(
    () => this.mappedRows().filter((row) => Object.keys(row).length > 0).length,
  );

  /** Rows that have data but are missing a required field — the backend would skip them anyway. */
  protected readonly missingRequiredRowCount = computed(() => {
    const required = this.config().requiredFields;
    if (required.length === 0) return 0;
    return this.mappedRows().filter((row) => Object.keys(row).length > 0 && required.some((field) => !row[field]))
      .length;
  });

  // --- Review ---
  protected readonly duplicateDecision = signal<DuplicateDecision>('merge');
  protected readonly badEmailDecision = signal<BadEmailDecision>('skip');
  protected readonly tagsText = signal('');
  protected readonly listName = signal('');
  protected readonly existingListNames = signal<string[]>([]);
  protected readonly duplicateMatches = signal<DuplicateMatch[]>([]);

  protected readonly emailRows = computed(() =>
    this.mappedRows()
      .map((row, idx) => ({ idx: idx + 1, email: row['email'] ?? '' }))
      .filter((r) => !!r.email),
  );
  protected readonly validEmailRows = computed(() =>
    this.emailRows().filter((r) => emailSchema.safeParse(r.email).success),
  );
  protected readonly badEmailRows = computed(() => {
    if (!this.config().supportsEmailReview) return [];
    return this.emailRows().filter((r) => !emailSchema.safeParse(r.email).success);
  });
  protected readonly duplicateRowCount = computed(() => {
    const matched = new Set(this.duplicateMatches().map((m) => m.email.toLowerCase()));
    return this.validEmailRows().filter((r) => matched.has(r.email.toLowerCase())).length;
  });
  protected readonly reviewIsClean = computed(
    () => this.duplicateMatches().length === 0 && this.badEmailRows().length === 0,
  );

  protected readonly parsedTags = computed(() =>
    this.tagsText()
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );

  // --- Confirm & run ---
  protected readonly run = signal<RunState>({ status: 'idle' });
  private pollHandle: ReturnType<typeof setTimeout> | undefined;

  /** The exact row count the Confirm button and working-state sentence quote (spec §17). */
  protected readonly finalRowCount = computed(() => {
    let count = this.importableRowCount() - this.missingRequiredRowCount();
    if (this.config().supportsEmailReview && this.badEmailDecision() === 'skip') {
      count -= this.badEmailRows().length;
    }
    return count;
  });

  /** One line of "what the background job is doing" copy while the import runs. */
  protected readonly runningHint = computed(() => {
    const entity = this.entity();
    switch (entity) {
      case 'people':
        return 'Matching by email, merging duplicates and applying tags';
      case 'households':
        return 'Deduplicating by address, applying tags and queueing geocoding';
      case 'companies':
        return 'Creating companies and recording the import in history';
      case 'tasks':
        return 'Creating tasks and recording the import in history';
      default: {
        const _exhaustive: never = entity;
        return _exhaustive;
      }
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearPoll());
    void this.loadExistingListNames();
  }

  /** Switch record type — remaps the already-parsed headers with the new type's heuristic. */
  protected setEntity(type: ImportEntityType): void {
    if (this.entity() === type || this.run().status === 'running') return;
    this.entity.set(type);
    this.mapping.set(this.headers().map((h) => IMPORT_ENTITY_CONFIGS[type].autoMapHeader(h)));
    this.duplicateDecision.set('merge');
    this.badEmailDecision.set('skip');
    this.tagsText.set('');
    this.listName.set('');
    this.duplicateMatches.set([]);
    // Keep the URL shareable/bookmarkable — grids deep-link here with ?type=.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type },
      replaceUrl: true,
    });
  }

  private async loadExistingListNames(): Promise<void> {
    try {
      const result = await this.listsService.getAll({ startRow: 0, endRow: 200 });
      const rows = (result?.rows ?? []) as Array<{ name?: string; is_dynamic?: boolean; object?: string }>;
      this.existingListNames.set(
        rows
          .filter((r) => !r.is_dynamic && r.object === 'people' && typeof r.name === 'string')
          .map((r) => r.name as string),
      );
    } catch {
      // Non-blocking — the list-name field still works as free text without suggestions.
    }
  }

  // --- Upload step ---

  protected onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) void this.readFile(file);
  }

  protected onFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.readFile(file);
    input.value = '';
  }

  private async readFile(file: File): Promise<void> {
    this.parsing.set(true);
    this.fileName.set(file.name);
    try {
      // UTF-8 and Excel-exported CSVs both decode correctly as text — Excel's
      // CSV export is UTF-8 (sometimes BOM-prefixed), which readAsText handles.
      // FileReader (not the newer File.text()) matches the shared csv-import
      // worker's original reading approach.
      const text = await this.readFileAsText(file);
      this.fileText = text;
      const { headers, rows } = await this.parseCsv(text);
      this.headers.set(headers);
      this.rawRows.set(rows);
      this.mapping.set(headers.map((h) => this.config().autoMapHeader(h)));
    } catch {
      this.alerts.showError('Failed to read that file. Make sure it is a CSV export.');
      this.fileName.set(null);
    } finally {
      this.parsing.set(false);
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /** Reuses the shared CSV/TSV parsing worker (libs/uxcommon/components/csv-import) — no second parser. */
  private parseCsv(text: string): Promise<{ headers: string[]; rows: Array<Record<string, string>> }> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('../../../../../../../libs/uxcommon/src/components/csv-import/csv.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (e: MessageEvent) => {
        const data = e.data as {
          type: string;
          headers?: string[];
          rows?: Array<Record<string, string>>;
          message?: string;
        };
        worker.terminate();
        if (data.type === 'result') {
          resolve({ headers: data.headers ?? [], rows: data.rows ?? [] });
        } else {
          reject(new Error(data.message || 'Failed to parse CSV'));
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error('Failed to parse CSV'));
      };
      worker.postMessage({ type: 'parse', text });
    });
  }

  protected chooseAnotherFile(): void {
    this.fileName.set(null);
    this.fileText = '';
    this.headers.set([]);
    this.rawRows.set([]);
    this.mapping.set([]);
  }

  protected sampleValues(headerIdx: number): string {
    const header = this.headers()[headerIdx];
    if (!header) return '';
    return this.rawRows()
      .slice(0, 2)
      .map((row) => row[header])
      .filter((v) => !!v)
      .join(', ');
  }

  // --- Step navigation ---

  protected goToStep(target: WizardStep): void {
    this.step.set(target);
  }

  protected async goToReview(): Promise<void> {
    this.step.set('review');
    if (!this.config().supportsEmailReview) {
      this.duplicateMatches.set([]);
      return;
    }
    const end = this._duplicateCheck.begin();
    try {
      const emails = [...new Set(this.validEmailRows().map((r) => r.email.toLowerCase()))];
      const matches = emails.length ? await this.personsService.checkDuplicateEmails(emails) : [];
      this.duplicateMatches.set(matches);
    } catch {
      // Review still works without the duplicate preview — the backend re-checks authoritatively at import time.
      this.duplicateMatches.set([]);
    } finally {
      end();
    }
  }

  protected setMapping(headerIdx: number, field: string): void {
    const next = [...this.mapping()];
    next[headerIdx] = field;
    this.mapping.set(next);
  }

  // --- Confirm & run ---

  protected async runImport(): Promise<void> {
    if (this.run().status === 'running') return;
    this.run.set({ status: 'running' });
    try {
      const result = this.entity() === 'people' ? await this.importPeople() : await this.importSimple();

      if (result.import_id) {
        await this.pollUntilDone(result.import_id, Date.now());
      } else {
        // Nothing importable — the backend already reported the terminal state synchronously.
        this.run.set({
          status: 'done',
          inserted: result.inserted,
          merged: 0,
          skipped: result.skipped,
          errors: result.errors,
          tag: result.tag,
          importId: null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The import could not be started.';
      this.run.set({ status: 'error', message });
    }
  }

  /** People import — the full duplicate-decision / bad-email / tags / list pipeline. */
  private async importPeople(): Promise<{
    import_id: string | null;
    inserted: number;
    skipped: number;
    errors: number;
    tag: string | null;
  }> {
    const badEmailRows = this.badEmailRows();
    const badEmailIdx = new Set(badEmailRows.map((r) => r.idx - 1));
    const skipBadEmail = this.badEmailDecision() === 'skip';
    const rowsToSend = this.mappedRows()
      .map((row, idx) => {
        if (!badEmailIdx.has(idx)) return row;
        if (skipBadEmail) return null; // dropped below
        const { email: _unused, ...rest } = row; // "Import without an email"
        return rest;
      })
      .filter((row): row is Record<string, string> => row !== null && Object.keys(row).length > 0);
    const skippedCount = this.rawRows().length - rowsToSend.length;
    const clientSkipReasons = skipBadEmail
      ? badEmailRows.map((r) => ({ row: r.idx, email: r.email, reason: 'Email address is not valid' }))
      : [];

    const result = await this.personsService.import({
      rows: rowsToSend,
      tags: this.parsedTags(),
      skipped: skippedCount,
      file_name: this.fileName() ?? undefined,
      duplicate_decision: this.duplicateDecision(),
      list_name: this.listName().trim() || undefined,
      source_csv: this.fileText || undefined,
      client_skip_reasons: clientSkipReasons,
    });
    return {
      import_id: result?.import_id ?? null,
      inserted: result?.inserted ?? 0,
      skipped: result?.skipped ?? skippedCount,
      errors: result?.errors ?? 0,
      tag: result?.tag ?? null,
    };
  }

  /**
   * Companies / households / tasks import — no client-side review pipeline, but
   * rows missing a required field are dropped here (and counted as skipped) so
   * one bad row can't fail the whole mutation's input validation.
   */
  private async importSimple(): Promise<{
    import_id: string | null;
    inserted: number;
    skipped: number;
    errors: number;
    tag: string | null;
  }> {
    const required = this.config().requiredFields;
    const rowsToSend = this.mappedRows().filter(
      (row) => Object.keys(row).length > 0 && required.every((field) => !!row[field]),
    );
    const skippedCount = this.rawRows().length - rowsToSend.length;
    const common = {
      skipped: skippedCount,
      file_name: this.fileName() ?? undefined,
      source_csv: this.fileText || undefined,
    };

    const entity = this.entity();
    switch (entity) {
      case 'companies': {
        const result = await this.companiesService.import({
          rows: rowsToSend.map((row) => ({
            name: row['name'] ?? '',
            description: row['description'],
            website: row['website'],
            email: row['email'],
            phone: row['phone'],
            industry: row['industry'],
            notes: row['notes'],
          })),
          ...common,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? skippedCount,
          errors: 0,
          tag: null,
        };
      }
      case 'households': {
        const result = await this.householdsService.import({
          rows: rowsToSend.map((row) => ({
            street_num: row['street_num'],
            apt: row['apt'],
            street1: row['street1'],
            street2: row['street2'],
            city: row['city'],
            state: row['state'],
            zip: row['zip'],
            country: row['country'],
            home_phone: row['home_phone'],
            notes: row['notes'],
            // District, ward and precinct columns the person mapped. Listed by name like every
            // other field above, because this object is rebuilt field by field and anything not
            // named here never leaves the browser. Each becomes its own boundary map on the
            // backend, with no address lookup and no cost.
            ...electoralFieldsOf(row),
          })),
          tags: this.parsedTags(),
          ...common,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? skippedCount,
          errors: 0,
          tag: null,
        };
      }
      case 'tasks': {
        const result = await this.tasksService.import({
          rows: rowsToSend.map((row) => ({
            name: row['name'] ?? '',
            details: row['details'],
            status: row['status'],
            priority: row['priority'],
            due_at: row['due_at'],
            assigned_to: row['assigned_to'],
          })),
          ...common,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? skippedCount,
          errors: 0,
          tag: null,
        };
      }
      case 'people':
        throw new Error('People imports go through importPeople()');
      default: {
        const _exhaustive: never = entity;
        throw new Error(`Unhandled import type: ${String(_exhaustive)}`);
      }
    }
  }

  private async pollUntilDone(importId: string, startedAt: number): Promise<void> {
    this.clearPoll();
    try {
      const list = await this.importsService.list();
      const record = (list ?? []).find((item) => String(item.id) === String(importId));

      if (record?.status === 'completed') {
        this.run.set({
          status: 'done',
          inserted: record.insertedCount,
          merged: record.mergedCount,
          skipped: record.skippedCount,
          errors: record.errorCount,
          tag: record.tagName,
          importId,
        });
        return;
      }
      if (record?.status === 'failed') {
        this.run.set({ status: 'error', message: record.errorMessage || 'The import failed.' });
        return;
      }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        this.run.set({
          status: 'error',
          message: 'This is taking longer than expected. Check the import history page for its final status.',
        });
        return;
      }
    } catch {
      // Transient — keep polling until the timeout above gives up.
    }
    this.pollHandle = setTimeout(() => void this.pollUntilDone(importId, startedAt), POLL_INTERVAL_MS);
  }

  private clearPoll(): void {
    if (this.pollHandle) {
      clearTimeout(this.pollHandle);
      this.pollHandle = undefined;
    }
  }

  protected startOver(): void {
    this.clearPoll();
    this.chooseAnotherFile();
    this.mapping.set([]);
    this.duplicateDecision.set('merge');
    this.badEmailDecision.set('skip');
    this.tagsText.set('');
    this.listName.set('');
    this.duplicateMatches.set([]);
    this.run.set({ status: 'idle' });
    this.step.set('upload');
  }

  protected viewImported(): void {
    void this.router.navigate([this.config().viewRoute]);
  }

  protected backToHistory(): void {
    void this.router.navigate(['/imports']);
  }
}
