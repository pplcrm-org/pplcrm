import type { Kysely } from 'kysely';
import type { z } from 'zod';
import { env } from '../../../../env';
import {
  CompaniesImportRowObj,
  HouseholdsImportRowObj,
  MAX_IMPORT_ROWS,
  PersonsImportRowObj,
  TasksImportRowObj,
} from '../../../../../../../libs/common/src';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { CompaniesController } from '../../../modules/companies/controller';
import { HouseholdsController } from '../../../modules/households/controller';
import { ImportsRepo } from '../../../modules/imports/repositories/imports.repo';
import { PersonsService } from '../../../modules/persons/services/persons.service';
import { TasksController } from '../../../modules/tasks/controller';
import { StorageService } from '../../storage.service';
import { applyColumnMapping, isSameRecord, openCsvStream, type CsvDelimiter } from '../../csv-import/csv-stream';
import {
  importRowsFromLegacyJsonArray,
  importRowsFromNdjson,
  isLegacyJsonArrayPayload,
  toStoredImportRow,
  type StoredImportRow,
} from '../../ndjson';
import { notificationEnabled } from '../../profile-preferences';
import { sendMailOrDrop } from '../../mail/send-or-drop';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import type { EmailVerificationSummary } from '../../mail/email-verifier.service';
import type { JobPayloadOf, LegacyImportJobPayload } from '../job-payloads';
import { runImportEmailVerification } from './import-verification';

const storageService = new StorageService();
const importsRepo = new ImportsRepo();
const mailService = new TransactionalEmailService({ defaultAudience: 'staff' });

/** How many typo suspects to spell out in the completion email before summarizing the rest. */
const TYPO_SAMPLE_IN_EMAIL = 10;

/** Plain-text email-checkup block appended to the import summary; empty string when unavailable. */
function verificationText(v: EmailVerificationSummary | null): string {
  if (!v || v.checked === 0) return '';
  const lines = [
    '',
    'Email check-up:',
    `- Addresses checked: ${v.checked}`,
    `- Looking good: ${v.valid}`,
    `- Suppressed (dead domain): ${v.dead_domain}`,
    `- Suppressed (disposable): ${v.disposable}`,
    `- Already suppressed: ${v.already_suppressed}`,
    `- Role addresses (info@, admin@ — kept, not suppressed): ${v.role_accounts}`,
    `- Couldn't verify (kept as valid): ${v.unverifiable}`,
  ];
  if (v.typo_suspects.length > 0) {
    lines.push(`- Possible typos: ${v.typo_suspects.length}`);
    for (const t of v.typo_suspects.slice(0, TYPO_SAMPLE_IN_EMAIL)) {
      lines.push(`    ${t.email} — did you mean ${t.suggested_domain}?`);
    }
    if (v.typo_suspects.length > TYPO_SAMPLE_IN_EMAIL) {
      lines.push(`    …and ${v.typo_suspects.length - TYPO_SAMPLE_IN_EMAIL} more`);
    }
  }
  lines.push('');
  lines.push('Suppressed addresses stay on the contact but are excluded from newsletters and automated emails.');
  if (v.tripwire === 'pause') {
    lines.push('');
    lines.push(
      'Heads up: this list had an unusually high rate of undeliverable addresses, so sending is paused pending review. Please contact support to resume.',
    );
  } else if (v.tripwire === 'warn') {
    lines.push('');
    lines.push(
      'Heads up: this list had a high rate of undeliverable addresses, which usually means it was purchased or scraped. Please import only contacts who opted in.',
    );
  }
  return lines.join('\n');
}

/** HTML email-checkup block appended to the import summary; empty string when unavailable. */
function verificationHtml(v: EmailVerificationSummary | null): string {
  if (!v || v.checked === 0) return '';
  const typos = v.typo_suspects
    .slice(0, TYPO_SAMPLE_IN_EMAIL)
    .map((t) => `<li>${t.email} — did you mean <strong>${t.suggested_domain}</strong>?</li>`)
    .join('');
  const typoBlock =
    v.typo_suspects.length > 0
      ? `<p><strong>Possible typos:</strong> ${v.typo_suspects.length}</p><ul>${typos}${
          v.typo_suspects.length > TYPO_SAMPLE_IN_EMAIL
            ? `<li>…and ${v.typo_suspects.length - TYPO_SAMPLE_IN_EMAIL} more</li>`
            : ''
        }</ul>`
      : '';
  const tripwireBlock =
    v.tripwire === 'pause'
      ? '<p><strong>Heads up:</strong> this list had an unusually high rate of undeliverable addresses, so sending is paused pending review. Please contact support to resume.</p>'
      : v.tripwire === 'warn'
        ? '<p><strong>Heads up:</strong> this list had a high rate of undeliverable addresses, which usually means it was purchased or scraped. Please import only contacts who opted in.</p>'
        : '';
  return `<h3>Email check-up</h3>
<div class="panel">
  <p><strong>Addresses checked:</strong> ${v.checked}</p>
  <p><strong>Looking good:</strong> ${v.valid}</p>
  <p><strong>Suppressed — dead domain:</strong> ${v.dead_domain}</p>
  <p><strong>Suppressed — disposable:</strong> ${v.disposable}</p>
  <p><strong>Already suppressed:</strong> ${v.already_suppressed}</p>
  <p><strong>Role addresses (kept, not suppressed):</strong> ${v.role_accounts}</p>
  <p><strong>Couldn't verify (kept as valid):</strong> ${v.unverifiable}</p>
  ${typoBlock}
</div>
<p>Suppressed addresses stay on the contact but are excluded from newsletters and automated emails.</p>
${tripwireBlock}`;
}

/**
 * True (with a warning logged) when this import already ran to completion, so a re-delivered
 * job must not write its rows a second time.
 *
 * Inserting the rows is not idempotent for every source: only the persons importer dedupes
 * (its default `duplicate_decision: 'skip'` drops rows whose email already exists), while the
 * companies, households and tasks importers issue plain inserts. So a second run of a job that
 * already finished writes the rows again.
 *
 * Nothing after the insert can fail these jobs any more — the storage cleanup and the summary
 * email are each wrapped in their own catch — but a job can still be re-run by stale-job
 * recovery after a worker crash or an execution timeout. If the previous run got as far as
 * marking the import completed, the rows are in and there is nothing left to do.
 *
 * This does NOT make the import idempotent in general: a crash partway through the insert
 * still leaves the import 'processing', and that retry does re-import. Closing that would need
 * per-chunk resume state, which is a much larger change.
 */
async function shouldSkipCompletedImport(db: Kysely<Models>, tenantId: string, importId: string): Promise<boolean> {
  const priorState = await db
    .selectFrom('data_imports')
    .select('status')
    .where('id', '=', importId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

  if (priorState?.status === 'completed') {
    logger.warn(
      { importId, tenantId },
      'Import job re-ran after it had already completed; skipping so its rows are not written twice',
    );
    return true;
  }
  return false;
}

async function markImportProcessing(tenantId: string, importId: string): Promise<void> {
  await importsRepo.update({
    tenant_id: tenantId,
    id: importId,
    row: {
      status: 'processing',
      updated_at: new Date(),
    },
  });
}

async function markImportCompleted(tenantId: string, importId: string): Promise<void> {
  await importsRepo.update({
    tenant_id: tenantId,
    id: importId,
    row: {
      status: 'completed',
      processed_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/**
 * Send the "import complete" summary to the member who ran it (preference-gated). Best-effort:
 * a mail failure never fails the finished import.
 */
async function sendImportSummaryEmail(
  db: Kysely<Models>,
  payload: { tenant_id: string; import_id: string; user_id: string; file_name?: string | null },
  verification: EmailVerificationSummary | null,
): Promise<void> {
  try {
    const user = await db
      .selectFrom('authusers')
      .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
      .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
      .where('authusers.id', '=', payload.user_id)
      .executeTakeFirst();

    if (user && user.email) {
      if (notificationEnabled(user.profile_preferences, 'import_summary')) {
        const importRecord = await db
          .selectFrom('data_imports')
          .select(['inserted_count', 'error_count', 'skipped_count'])
          .where('id', '=', payload.import_id)
          .where('tenant_id', '=', payload.tenant_id)
          .executeTakeFirst();

        if (importRecord) {
          const inserted = importRecord.inserted_count || 0;
          const errors = importRecord.error_count || 0;
          const skipped = importRecord.skipped_count || 0;

          await sendMailOrDrop(
            mailService,
            {
              to: user.email,
              subject: `Spreadsheet import complete: ${payload.file_name || 'import.csv'}`,
              // Postmark round-trips this to the bounce webhook. Without it a bounce or complaint
              // on this message cannot be attributed to a workspace, and the anti-abuse gate has
              // no tenant to check, so the message was never gated at all.
              tenant_id: payload.tenant_id,
              notificationSettingsLink: true,
              text: `Hi ${user.first_name || 'there'},\n\nYour contact spreadsheet import has completed.\n\nStatistics:\n- Inserted: ${inserted}\n- Errors: ${errors}\n- Skipped: ${skipped}\n${verificationText(verification)}\nView imported rows: ${env.appUrl}/imports/${payload.import_id}`,
              html: `<h2>Spreadsheet import complete</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>Your contact spreadsheet import has completed.</p>
<div class="panel"><p><strong>Inserted:</strong> ${inserted}</p><p><strong>Errors:</strong> ${errors}</p><p><strong>Skipped:</strong> ${skipped}</p></div>
${verificationHtml(verification)}
<div class="btn-container">
  <a href="${env.appUrl}/imports/${payload.import_id}" class="btn">View imported rows</a>
</div>`,
            },
            'import completion summary',
          );
        }
      }
    }
  } catch (mailErr) {
    logger.error({ err: mailErr }, 'Failed to send import completion summary email');
  }
}

export async function handleImportJob(payload: LegacyImportJobPayload, db: Kysely<Models>): Promise<void> {
  // 0. Refuse to re-import rows that already landed (see shouldSkipCompletedImport).
  if (await shouldSkipCompletedImport(db, payload.tenant_id, payload.import_id)) return;

  // 1. Mark import status as 'processing' in data_imports
  await markImportProcessing(payload.tenant_id, payload.import_id);

  // 2. Download the mapping payload and iterate it lazily. The payload is
  // NDJSON (one row object per line): rows are parsed line by line and handed
  // to the processors in chunks, so beyond the downloaded string only the
  // current chunk of row objects is alive — never one array of every row.
  const buffer = await storageService.download(payload.storage_key);
  const text = buffer.toString('utf8');

  let rowSource: Iterable<StoredImportRow>;
  if (isLegacyJsonArrayPayload(text)) {
    // Legacy format: one JSON array holding every row. This branch exists only
    // for jobs enqueued before the NDJSON switch whose payloads are already in
    // storage — it can be removed after one deploy cycle.
    rowSource = importRowsFromLegacyJsonArray(text);
  } else {
    rowSource = importRowsFromNdjson(text);
  }

  // 3. Process the import rows in chunks
  let verification: EmailVerificationSummary | null = null;
  if (payload.source === 'companies') {
    const companiesController = new CompaniesController();
    await companiesController.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      Number(payload.skipped || 0),
      rowSource,
    );
  } else if (payload.source === 'tasks') {
    const tasksController = new TasksController();
    await tasksController.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      Number(payload.skipped || 0),
      rowSource,
    );
  } else if (payload.source === 'households') {
    const householdsController = new HouseholdsController();
    await householdsController.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      Number(payload.skipped || 0),
      rowSource,
    );
  } else {
    // Collect just the email columns while the rows stream past, so the
    // post-import verification doesn't need a second pass over the payload.
    // Worst case this holds two short strings per row — not the full rows.
    const emailRows: Array<{ email?: string; email2?: string }> = [];
    function* collectEmails(source: Iterable<StoredImportRow>): Generator<StoredImportRow, void, undefined> {
      for (const row of source) {
        if (row['email'] || row['email2']) emailRows.push({ email: row['email'], email2: row['email2'] });
        yield row;
      }
    }

    const personsService = new PersonsService();
    await personsService.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      Number(payload.skipped || 0),
      collectEmails(rowSource),
      {
        duplicateDecision: payload.duplicate_decision ?? 'skip',
        listName: payload.list_name ?? undefined,
        clientSkipReasons: payload.client_skip_reasons ?? undefined,
      },
    );

    // 3b. Verify the imported email list (DNS + disposable). Persons only — companies/households
    // have no send-suppression semantics. Fail-open: a thrown/failed check never fails the import.
    verification = await runImportEmailVerification(
      db,
      { tenant_id: payload.tenant_id, import_id: payload.import_id, user_id: payload.user_id },
      emailRows,
    );
  }

  // 4. Update import status to 'completed'
  await markImportCompleted(payload.tenant_id, payload.import_id);

  // Legacy path only: drop the NDJSON payload blob the mutation wrote. The upload-based CSV
  // path never writes one, and its source CSV is deliberately NOT deleted (90-day retention
  // owns it — see pruneExpiredImportSourceFiles in maintenance.handlers.ts).
  try {
    await storageService.delete(payload.storage_key);
  } catch (storageErr) {
    logger.error({ err: storageErr }, `Failed to clean up storage key ${payload.storage_key}`);
  }

  await sendImportSummaryEmail(db, payload, verification);
}

// ── Upload-based CSV imports (`import_csv` jobs) ──────────────────────────────

/** Which shared row schema validates a mapped record, by `data_imports.source`. */
const CSV_IMPORT_ROW_SCHEMAS: Record<JobPayloadOf<'import_csv'>['source'], z.ZodType> = {
  persons: PersonsImportRowObj,
  households: HouseholdsImportRowObj,
  companies: CompaniesImportRowObj,
  tasks: TasksImportRowObj,
};

/** Same cap the entity importers use for their own skip reasons (persons.service SKIP_REASONS_CAP). */
const CSV_SKIP_REASONS_CAP = 500;

/** Longest stored per-row skip reason — matches the legacy client_skip_reasons input cap. */
const CSV_SKIP_REASON_MAX = 200;

type CsvSkipReason = { row: number; email?: string; reason: string };

/** Terminal failure the member can act on: History shows `error_message` inline. */
async function failImport(
  payload: { tenant_id: string; import_id: string; user_id: string },
  message: string,
): Promise<void> {
  await importsRepo.update({
    tenant_id: payload.tenant_id,
    id: payload.import_id,
    row: {
      status: 'failed',
      error_message: message,
      processed_at: new Date(),
      updated_at: new Date(),
      updatedby_id: payload.user_id,
    },
  });
}

/**
 * Why a mapped record cannot be imported, or null when it can. Mirrors what the wizard's legacy
 * path did client-side: rows with no mapped values are skipped, and rows the shared row schema
 * refuses are skipped with the first validation issue as the reason.
 */
function validateMappedCsvRow(
  rowSchema: z.ZodType,
  mapped: Record<string, string>,
  rowNumber: number,
): CsvSkipReason | null {
  if (Object.keys(mapped).length === 0) {
    return { row: rowNumber, reason: 'Blank row: no mapped columns had a value' };
  }
  const parsed = rowSchema.safeParse(mapped);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.join('.') : '';
  const message = issue?.message ?? 'Row is not valid';
  const email = mapped['email'];
  return {
    row: rowNumber,
    ...(email ? { email } : {}),
    reason: `${field ? `${field}: ` : ''}${message}`.slice(0, CSV_SKIP_REASON_MAX),
  };
}

/**
 * Second streaming pass: re-parse the blob with the delimiter the counting pass detected and
 * yield only the rows that survive mapping + schema validation, already in the flat
 * `StoredImportRow` shape the unchanged per-entity processors consume. Which rows are dropped
 * here is exactly the set the counting pass already recorded skip reasons for — same mapping,
 * same schema, same file bytes.
 */
async function* streamValidCsvRows(
  payload: JobPayloadOf<'import_csv'>,
  rowSchema: z.ZodType,
  delimiter: CsvDelimiter,
): AsyncGenerator<StoredImportRow, void, undefined> {
  const { stream } = await storageService.downloadStream(payload.storage_key);
  const opened = await openCsvStream(stream, delimiter);
  let headers: string[] | null = null;
  for await (const record of opened.records) {
    if (headers === null) {
      headers = record;
      continue;
    }
    if (isSameRecord(record, headers)) continue;
    const mapped = applyColumnMapping(record, payload.mapping);
    if (Object.keys(mapped).length === 0) continue;
    const parsed = rowSchema.safeParse(mapped);
    if (!parsed.success) continue;
    yield toStoredImportRow(parsed.data);
  }
}

/**
 * Fold the counting pass's validation skips into `data_imports.skip_reasons` for the sources
 * whose processors do not take a reasons argument. Runs after the processor finished, so it
 * appends to (never races) whatever the processor itself wrote; the persons path instead hands
 * its reasons to processImportRows via clientSkipReasons and needs no merge.
 */
async function mergeCsvSkipReasons(
  db: Kysely<Models>,
  tenantId: string,
  importId: string,
  reasons: readonly CsvSkipReason[],
): Promise<void> {
  const row = await db
    .selectFrom('data_imports')
    .select('skip_reasons')
    .where('id', '=', importId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();
  const existing: unknown = row?.skip_reasons;
  const kept = Array.isArray(existing) ? existing : [];
  const merged = [...reasons, ...kept].slice(0, CSV_SKIP_REASONS_CAP);
  await importsRepo.update({
    tenant_id: tenantId,
    id: importId,
    row: {
      skip_reasons: JSON.stringify(merged),
      updated_at: new Date(),
    },
  });
}

/**
 * Upload-based CSV import: the mutation stored only the file's storage key and the column
 * mapping; this job does everything the client used to — parse, map, validate — then feeds the
 * surviving rows to the same per-entity processors the legacy path uses.
 *
 * Two streaming passes over the blob:
 *  1. Count data rows and pre-compute validation skips. `row_count` is written before anything
 *     else so an over-cap file can fail fast, with the real count on record and zero inserts.
 *  2. Stream the valid rows into the unchanged `processImportRows` chunk pipeline.
 *
 * The source CSV is deliberately never deleted here — it is the retained original the History
 * page re-downloads, and the 90-day retention sweep owns its lifecycle.
 */
export async function handleImportCsvJob(payload: JobPayloadOf<'import_csv'>, db: Kysely<Models>): Promise<void> {
  if (await shouldSkipCompletedImport(db, payload.tenant_id, payload.import_id)) return;

  await markImportProcessing(payload.tenant_id, payload.import_id);

  const rowSchema = CSV_IMPORT_ROW_SCHEMAS[payload.source];

  // PASS 1 — detect the delimiter, count data rows, and record why invalid rows will be skipped.
  let delimiter: CsvDelimiter = ',';
  let rowCount = 0;
  let preSkipped = 0;
  const preSkipReasons: CsvSkipReason[] = [];
  try {
    const { stream } = await storageService.downloadStream(payload.storage_key);
    const opened = await openCsvStream(stream);
    delimiter = opened.delimiter;
    let headers: string[] | null = null;
    for await (const record of opened.records) {
      if (headers === null) {
        headers = record;
        continue;
      }
      if (isSameRecord(record, headers)) continue;
      rowCount += 1;
      const failure = validateMappedCsvRow(rowSchema, applyColumnMapping(record, payload.mapping), rowCount);
      if (failure) {
        preSkipped += 1;
        if (preSkipReasons.length < CSV_SKIP_REASONS_CAP) preSkipReasons.push(failure);
      }
    }
  } catch (err) {
    logger.error(
      { err, importId: payload.import_id, tenantId: payload.tenant_id },
      'Uploaded import file could not be parsed as CSV',
    );
    await failImport(payload, 'This file could not be read as a CSV. Re-export it as CSV (UTF-8) and try again.');
    return;
  }

  // The real count goes on record before the cap decision, so a refused file still shows what
  // was in it.
  await importsRepo.update({
    tenant_id: payload.tenant_id,
    id: payload.import_id,
    row: { row_count: rowCount, updated_at: new Date() },
  });

  if (rowCount > MAX_IMPORT_ROWS) {
    await failImport(
      payload,
      `This file has ${rowCount.toLocaleString('en-US')} data rows; imports are limited to ` +
        `${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows per file. Split the file and import the parts separately.`,
    );
    return;
  }

  // PASS 2 — stream the valid rows into the unchanged per-entity chunk processors.
  const validRows = streamValidCsvRows(payload, rowSchema, delimiter);
  let verification: EmailVerificationSummary | null = null;
  if (payload.source === 'companies') {
    await new CompaniesController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      preSkipped,
      validRows,
    );
  } else if (payload.source === 'tasks') {
    await new TasksController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      preSkipped,
      validRows,
    );
  } else if (payload.source === 'households') {
    await new HouseholdsController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      preSkipped,
      validRows,
    );
  } else {
    // Persons. Collect just the email columns while the rows stream past, so the post-import
    // verification doesn't need a third pass over the file.
    const emailRows: Array<{ email?: string; email2?: string }> = [];
    async function* collectEmails(
      source: AsyncIterable<StoredImportRow>,
    ): AsyncGenerator<StoredImportRow, void, undefined> {
      for await (const row of source) {
        if (row['email'] || row['email2']) emailRows.push({ email: row['email'], email2: row['email2'] });
        yield row;
      }
    }

    await new PersonsService().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      preSkipped,
      collectEmails(validRows),
      {
        duplicateDecision: payload.duplicate_decision ?? 'skip',
        listName: payload.list_name ?? undefined,
        // The counting pass's validation skips ride the same machinery the wizard's
        // client-side skips used, so History's skipped-rows download covers them.
        clientSkipReasons: preSkipReasons,
      },
    );

    verification = await runImportEmailVerification(
      db,
      { tenant_id: payload.tenant_id, import_id: payload.import_id, user_id: payload.user_id },
      emailRows,
    );
  }

  if (payload.source !== 'persons' && preSkipReasons.length > 0) {
    await mergeCsvSkipReasons(db, payload.tenant_id, payload.import_id, preSkipReasons);
  }

  await markImportCompleted(payload.tenant_id, payload.import_id);

  await sendImportSummaryEmail(db, payload, verification);
}
