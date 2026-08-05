import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import {
  CompaniesImportMappingObj,
  HouseholdsImportMappingObj,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  PersonsImportMappingObj,
  TasksImportMappingObj,
  emailSchema,
} from '@common';
import { Icon } from '@icons/icon';
import { AlertService } from '@uxcommon/components/alerts/alert-service';
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

/** The four steps of the CSV import wizard (spec §17), in order. */
type WizardStep = 'upload' | 'map' | 'review' | 'confirm';

type DuplicateDecision = 'merge' | 'skip' | 'import_new';

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
/** The backend's `checkDuplicateEmails` input cap (persons/trpc.router.ts) — chunk requests to stay under it. */
const DUPLICATE_CHECK_BATCH_SIZE = 2000;
/**
 * Files at or under this size are parsed in full in the browser, exactly as before the upload
 * transport: full row counts, the duplicate pre-check, and per-row email review all still run.
 * Bigger files switch to preview mode (head-only parse, server-side checks).
 */
const FULL_PARSE_MAX_BYTES = 2 * 1024 * 1024;
/** Preview mode reads only this much of the file's head for headers + mapping samples. */
const PREVIEW_HEAD_BYTES = 512 * 1024;
/** Preview mode keeps at most this many parsed rows — plenty for mapping samples. */
const PREVIEW_ROW_LIMIT = 1000;
/** The file-size cap in the unit the error message quotes. */
const MAX_IMPORT_FILE_MB = MAX_IMPORT_FILE_BYTES / (1024 * 1024);

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

  /** The limits the upload step states up front, so nobody maps columns for a file we then refuse. */
  protected readonly maxFileMb = MAX_IMPORT_FILE_MB;
  protected readonly maxRows = MAX_IMPORT_ROWS;

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
  /**
   * The picked file, exactly as picked. On Confirm it is PUT to blob storage whole and the server
   * parses it — the mutation payload is never built from the parsed rows, in either parse mode.
   */
  private sourceFile: File | null = null;
  /**
   * True when the file was too big to parse fully in the browser: only its head was parsed, for
   * headers and mapping samples. Row totals, skips and duplicate handling then happen server-side
   * during the import, and the Review step says so instead of quoting preview-only numbers.
   */
  protected readonly previewMode = signal(false);
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

  /** Every parsed row, with only its mapped, non-blank fields — drives the Review step's numbers. */
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
  protected readonly tagsText = signal('');
  protected readonly listName = signal('');
  protected readonly existingListNames = signal<string[]>([]);
  protected readonly duplicateMatches = signal<DuplicateMatch[]>([]);
  /** Set when a batch of the duplicate check failed — distinct from a genuine "no duplicates" result. */
  protected readonly duplicateCheckFailed = signal(false);

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
    () => !this.duplicateCheckFailed() && this.duplicateMatches().length === 0 && this.badEmailRows().length === 0,
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

  /**
   * The exact row count the Confirm button and working-state sentence quote (spec §17).
   * Full-parse mode only — in preview mode the totals are counted server-side, so the
   * template never quotes this number there.
   */
  protected readonly finalRowCount = computed(() => this.importableRowCount() - this.missingRequiredRowCount());

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
    this.tagsText.set('');
    this.listName.set('');
    this.duplicateMatches.set([]);
    this.duplicateCheckFailed.set(false);
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      this.alerts.showError(
        `That file is larger than the ${MAX_IMPORT_FILE_MB} MB import limit. ` +
          `Split it into smaller files and import them one at a time.`,
      );
      return;
    }
    this.parsing.set(true);
    this.fileName.set(file.name);
    this.sourceFile = file;
    const preview = file.size > FULL_PARSE_MAX_BYTES;
    this.previewMode.set(preview);
    try {
      // UTF-8 and Excel-exported CSVs both decode correctly as text — Excel's
      // CSV export is UTF-8 (sometimes BOM-prefixed), which readAsText handles.
      // Preview mode reads only the head of the file; the server parses the whole
      // file during the import, so nothing is lost by not parsing it here.
      const text = preview ? await this.readPreviewText(file) : await this.readFileAsText(file);
      const { headers, rows } = await this.parseCsv(text);
      if (!preview && rows.length > MAX_IMPORT_ROWS) {
        this.alerts.showError(
          `That file has ${rows.length.toLocaleString()} rows and imports are capped at ` +
            `${MAX_IMPORT_ROWS.toLocaleString()} rows per file. Split it into smaller files and import them one at a time.`,
        );
        this.chooseAnotherFile();
        return;
      }
      this.headers.set(headers);
      this.rawRows.set(preview ? rows.slice(0, PREVIEW_ROW_LIMIT) : rows);
      this.mapping.set(headers.map((h) => this.config().autoMapHeader(h)));
    } catch {
      this.alerts.showError('Failed to read that file. Make sure it is a CSV export.');
      this.fileName.set(null);
      this.sourceFile = null;
    } finally {
      this.parsing.set(false);
    }
  }

  private readFileAsText(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /** The file's head as text, cut at the last complete line so no partial row reaches the parser. */
  private async readPreviewText(file: File): Promise<string> {
    const head = await this.readFileAsText(file.slice(0, PREVIEW_HEAD_BYTES));
    const lastNewline = head.lastIndexOf('\n');
    return lastNewline > 0 ? head.slice(0, lastNewline) : head;
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
    this.sourceFile = null;
    this.previewMode.set(false);
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
    this.duplicateCheckFailed.set(false);
    if (!this.config().supportsEmailReview || this.previewMode()) {
      // Preview mode: the file is too big to scan in the browser, so the pre-check is skipped.
      // The Review step says so; the import itself still applies the duplicate decision.
      this.duplicateMatches.set([]);
      return;
    }
    const end = this._duplicateCheck.begin();
    try {
      const emails = [...new Set(this.validEmailRows().map((r) => r.email.toLowerCase()))];
      const matches: DuplicateMatch[] = [];
      let failed = false;
      // The backend caps checkDuplicateEmails input at 2,000 — chunk so files with more unique
      // emails than that still get checked, instead of guaranteeing the request fails.
      for (let i = 0; i < emails.length; i += DUPLICATE_CHECK_BATCH_SIZE) {
        const batch = emails.slice(i, i + DUPLICATE_CHECK_BATCH_SIZE);
        try {
          matches.push(...(await this.personsService.checkDuplicateEmails(batch)));
        } catch {
          // A partial result would misreport which emails are clean, so on any batch failure
          // the whole check is treated as not having run — see duplicateCheckFailed.
          failed = true;
          break;
        }
      }
      this.duplicateMatches.set(failed ? [] : matches);
      this.duplicateCheckFailed.set(failed);
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
    const file = this.sourceFile;
    if (!file) {
      this.run.set({ status: 'error', message: 'The file is no longer available. Start over and pick it again.' });
      return;
    }
    this.run.set({ status: 'running' });
    try {
      // Both parse modes send the ORIGINAL file: PUT it to blob storage, then hand the
      // server the signed handle plus the column mapping. The server parses, validates,
      // counts and skips — no rows travel in the mutation body.
      const uploadHandle = await this.uploadSourceFile(file);
      const result =
        this.entity() === 'people' ? await this.importPeople(uploadHandle) : await this.importSimple(uploadHandle);

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

  /**
   * PUT the original file to blob storage via a short-lived SAS URL minted by
   * `imports.getUploadUrl`, and return the signed handle the import mutation needs.
   * Same direct-upload pattern as files/boundaries — the bytes never travel through tRPC.
   */
  private async uploadSourceFile(file: File): Promise<string> {
    const contentType = file.type || 'text/csv';
    const { uploadUrl, uploadHandle } = await this.importsService.getUploadUrl(file.name, contentType);
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType },
      body: file,
    });
    if (!response.ok) {
      const message = `Uploading the file failed (status ${response.status}). Check your connection and try again.`;
      this.alerts.showError(message);
      throw new Error(message);
    }
    return uploadHandle;
  }

  /**
   * The wizard's per-column mapping as the payload shape: stringified 0-based column index →
   * field key, only for columns actually mapped to a field. Validated against the entity's
   * shared mapping schema so a drift between the wizard's field lists and the row schemas
   * fails loudly here instead of silently 400ing at the server.
   */
  private mappingPayload<T>(schema: {
    safeParse: (value: unknown) => { success: true; data: T } | { success: false };
  }): T {
    const built: Record<string, string> = {};
    this.mapping().forEach((field, idx) => {
      if (field) built[String(idx)] = field;
    });
    const parsed = schema.safeParse(built);
    if (!parsed.success) {
      throw new Error('The column mapping is not valid. Go back to Map columns and re-check each column.');
    }
    return parsed.data;
  }

  /** People import — duplicate decision, tags and list travel with the upload handle. */
  private async importPeople(uploadHandle: string): Promise<{
    import_id: string | null;
    inserted: number;
    skipped: number;
    errors: number;
    tag: string | null;
  }> {
    const result = await this.personsService.import({
      upload_handle: uploadHandle,
      mapping: this.mappingPayload(PersonsImportMappingObj),
      tags: this.parsedTags(),
      file_name: this.fileName() ?? undefined,
      duplicate_decision: this.duplicateDecision(),
      list_name: this.listName().trim() || undefined,
    });
    return {
      import_id: result?.import_id ?? null,
      inserted: result?.inserted ?? 0,
      skipped: result?.skipped ?? 0,
      errors: result?.errors ?? 0,
      tag: result?.tag ?? null,
    };
  }

  /** Companies / households / tasks import — upload handle + mapping, plus the entity's extras. */
  private async importSimple(uploadHandle: string): Promise<{
    import_id: string | null;
    inserted: number;
    skipped: number;
    errors: number;
    tag: string | null;
  }> {
    const file_name = this.fileName() ?? undefined;
    const entity = this.entity();
    switch (entity) {
      case 'companies': {
        const result = await this.companiesService.import({
          upload_handle: uploadHandle,
          mapping: this.mappingPayload(CompaniesImportMappingObj),
          file_name,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? 0,
          errors: 0,
          tag: null,
        };
      }
      case 'households': {
        const result = await this.householdsService.import({
          upload_handle: uploadHandle,
          mapping: this.mappingPayload(HouseholdsImportMappingObj),
          tags: this.parsedTags(),
          file_name,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? 0,
          errors: 0,
          tag: null,
        };
      }
      case 'tasks': {
        const result = await this.tasksService.import({
          upload_handle: uploadHandle,
          mapping: this.mappingPayload(TasksImportMappingObj),
          file_name,
        });
        return {
          import_id: result?.import_id ?? null,
          inserted: 0,
          skipped: result?.skipped ?? 0,
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
    this.tagsText.set('');
    this.listName.set('');
    this.duplicateMatches.set([]);
    this.duplicateCheckFailed.set(false);
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
