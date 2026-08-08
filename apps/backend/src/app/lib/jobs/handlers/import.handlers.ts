import { sql, type Kysely } from 'kysely';
import type { z } from 'zod';
import { env } from '../../../../env';
import {
  CompaniesImportRowObj,
  HouseholdsImportRowObj,
  PersonsImportRowObj,
  TasksImportRowObj,
  importRowLimitFor,
  PLANS_BY_KEY,
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
import { toStoredImportRow, type StoredImportRow } from '../../import-rows';
import { notificationEnabled } from '../../profile-preferences';
import { sendMailOrDrop } from '../../mail/send-or-drop';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import type { EmailVerificationSummary } from '../../mail/email-verifier.service';
import { IMPORT_CONTINUATION_PRIORITY } from '../job-claim';
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
 * Where a (re-)delivered import job must pick up.
 *
 * Inserting the rows is not idempotent for every source: only the persons importer dedupes
 * (its default `duplicate_decision: 'skip'` drops rows whose email already exists), while the
 * companies, households and tasks importers issue plain inserts. So a job that re-enters
 * execution — stale-job recovery after a worker crash, a shutdown release, an execution
 * timeout, or a continuation job — must never feed a row that was already durably handled.
 *
 * Two fields answer that:
 *  - `completedAlready`: the previous run finished; there is nothing left to do (and a warning
 *    is logged, because a completed import being re-delivered is worth noticing).
 *  - `resumeOffset` (`data_imports.processed_row_offset`): how many of the import's data rows
 *    earlier runs durably consumed. Each entity processor writes it in the SAME transaction as
 *    the chunk's rows, so a crash at ANY point re-enters exactly at the last committed chunk —
 *    the caller stream-skips that many rows and the processors continue their counters from the
 *    persisted values instead of zero. (This closes the old "a crash partway through the insert
 *    re-imports from the start" gap.)
 */
interface ImportRunState {
  completedAlready: boolean;
  resumeOffset: number;
  rowCount: number | null;
}

async function readImportRunState(db: Kysely<Models>, tenantId: string, importId: string): Promise<ImportRunState> {
  const priorState = await db
    .selectFrom('data_imports')
    .select(['status', 'processed_row_offset', 'row_count'])
    .where('id', '=', importId)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

  if (priorState?.status === 'completed') {
    logger.warn(
      { importId, tenantId },
      'Import job re-ran after it had already completed; skipping so its rows are not written twice',
    );
    return { completedAlready: true, resumeOffset: 0, rowCount: null };
  }
  return {
    completedAlready: false,
    resumeOffset: Number(priorState?.processed_row_offset ?? 0),
    rowCount: priorState?.row_count != null ? Number(priorState.row_count) : null,
  };
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
              // `/imports` is the import History page — the app has no per-import route, so a
              // `/imports/<id>` link landed every recipient on the app-wide Not Found page.
              text: `Hi ${user.first_name || 'there'},\n\nYour contact spreadsheet import has completed.\n\nStatistics:\n- Inserted: ${inserted}\n- Errors: ${errors}\n- Skipped: ${skipped}\n${verificationText(verification)}\nView your imports: ${env.appUrl}/imports`,
              html: `<h2>Spreadsheet import complete</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>Your contact spreadsheet import has completed.</p>
<div class="panel"><p><strong>Inserted:</strong> ${inserted}</p><p><strong>Errors:</strong> ${errors}</p><p><strong>Skipped:</strong> ${skipped}</p></div>
${verificationHtml(verification)}
<div class="btn-container">
  <a href="${env.appUrl}/imports" class="btn">View your imports</a>
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

// ── Legacy pre-mapped-payload imports (no `type` discriminator) ───────────────
//
// ONE-RELEASE DRAIN SHIM — delete this whole section together with `legacyImportJobSchema`
// (job-payloads.ts) and its route in job-handlers.ts. See the removal condition documented on
// `legacyImportJobSchema`.
//
// These jobs were queued by the pre-2026-08-05 rows-in-body import mutations. Their
// `storage_key` does NOT point at a CSV: it points at a payload blob of ALREADY-MAPPED rows,
// written as NDJSON (one JSON object per line) or, older still, as one JSON array. That is why
// such a job cannot simply be relabelled as an `import_csv` payload and handed to
// `handleImportCsvJob` — that handler re-parses its blob as CSV and needs a `mapping`, which
// these payloads do not carry. The rows go straight to the per-entity processors instead.

/** True when the payload text is the oldest single-JSON-array format; NDJSON payloads start with `{`. */
function isLegacyJsonArrayPayload(text: string): boolean {
  return /^\s*\[/.test(text);
}

/**
 * Lazily yield the non-blank lines of `text` by scanning indexes — never `String.split('\n')`,
 * which would materialize every line of a large payload at once.
 */
function* iterateLines(text: string): Generator<string, void, undefined> {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    // Tolerate CRLF line endings even though the writer only emitted '\n'.
    const sliceEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    const line = text.slice(start, sliceEnd);
    if (/\S/.test(line)) yield line;
    start = end + 1;
  }
}

/** Parse a stored pre-mapped payload (NDJSON, or the older single JSON array) into rows. */
function* legacyPayloadRows(text: string): Generator<StoredImportRow, void, undefined> {
  if (isLegacyJsonArrayPayload(text)) {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Legacy import payload is not a JSON array');
    for (const value of parsed) yield toStoredImportRow(value);
    return;
  }
  for (const line of iterateLines(text)) {
    yield toStoredImportRow(JSON.parse(line));
  }
}

/** Skip the first `count` rows of a stored-row source — the rows earlier runs already handled. */
function* skipStoredRows(
  source: Iterable<StoredImportRow>,
  count: number,
): Generator<StoredImportRow, void, undefined> {
  let index = 0;
  for (const row of source) {
    if (index++ < count) continue;
    yield row;
  }
}

/**
 * Finish an import queued by the retired rows-in-body path. Same crash-resume contract as the
 * current handler: refuse a completed import, and skip the rows earlier runs durably consumed.
 * There is no per-run row budget and no continuation chain here — these payloads predate both,
 * and the queue can only hold pre-2026-08-05 rows, whose sizes were capped by the old
 * rows-in-body request limit.
 */
export async function handleLegacyImportJob(payload: LegacyImportJobPayload, db: Kysely<Models>): Promise<void> {
  const runState = await readImportRunState(db, payload.tenant_id, payload.import_id);
  if (runState.completedAlready) return;
  const resuming = runState.resumeOffset > 0;

  logger.warn(
    { importId: payload.import_id, tenantId: payload.tenant_id },
    'Draining a legacy import job queued before the upload-based CSV path; this shim is removed next release',
  );

  await markImportProcessing(payload.tenant_id, payload.import_id);

  const buffer = await storageService.download(payload.storage_key);
  const text = buffer.toString('utf8');
  const allRows = legacyPayloadRows(text);
  const rowSource: Iterable<StoredImportRow> = resuming ? skipStoredRows(allRows, runState.resumeOffset) : allRows;
  // On resume the pre-processing skip count and reasons are already inside the persisted
  // counters and skip_reasons, so passing them again would double-count them.
  const skippedBase = resuming ? 0 : Number(payload.skipped || 0);

  let verification: EmailVerificationSummary | null = null;
  if (payload.source === 'companies') {
    await new CompaniesController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      skippedBase,
      rowSource,
    );
  } else if (payload.source === 'tasks') {
    await new TasksController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      skippedBase,
      rowSource,
    );
  } else if (payload.source === 'households') {
    await new HouseholdsController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      skippedBase,
      rowSource,
    );
  } else {
    // Persons. Collect just the email columns while the rows stream past, so the post-import
    // verification does not need a second pass over the payload.
    const emailRows: Array<{ email?: string; email2?: string }> = [];
    function* collectEmails(source: Iterable<StoredImportRow>): Generator<StoredImportRow, void, undefined> {
      for (const row of source) {
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
      skippedBase,
      collectEmails(rowSource),
      {
        duplicateDecision: payload.duplicate_decision ?? 'skip',
        listName: payload.list_name ?? undefined,
        clientSkipReasons: resuming ? undefined : (payload.client_skip_reasons ?? undefined),
      },
    );

    verification = await runImportEmailVerification(
      db,
      { tenant_id: payload.tenant_id, import_id: payload.import_id, user_id: payload.user_id },
      emailRows,
    );
  }

  await markImportCompleted(payload.tenant_id, payload.import_id);

  // Legacy path only: drop the pre-mapped payload blob the retired mutation wrote. The
  // upload-based CSV path never writes one, and its source CSV is deliberately NOT deleted
  // (90-day retention owns it — see pruneExpiredImportSourceFiles in maintenance.handlers.ts).
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

/** Longest stored per-row skip reason — matches the cap the retired client-computed skips used. */
const CSV_SKIP_REASON_MAX = 200;

type CsvSkipReason = { row: number; email?: string; reason: string };

/**
 * The row cap is per plan (5,000 on Free, 100,000 on paid — `importRowsPerFile` on PlanDef), so
 * the counting pass resolves the importing tenant's own limit. An absent tenant/plan fails
 * closed to Free's cap, same as every other plan gate.
 */
async function resolveTenantImportRowLimit(db: Kysely<Models>, tenantId: string): Promise<number> {
  const tenant = await db
    .selectFrom('tenants')
    .select('subscription_plan')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return importRowLimitFor(tenant?.subscription_plan);
}

/**
 * Why an over-cap file was refused. Plan-gate convention ("guide, don't error"): a Free tenant
 * is told which plan raises the limit; a paid tenant already has the top limit, so splitting
 * the file is the only path.
 */
function overCapMessage(rowCount: number, limit: number): string {
  const counted = rowCount.toLocaleString('en-US');
  const capped = limit.toLocaleString('en-US');
  const paidLimit = PLANS_BY_KEY.grassroots.importRowsPerFile;
  if (limit < paidLimit) {
    return (
      `This file has ${counted} data rows; imports on the ${PLANS_BY_KEY.free.name} plan are limited to ` +
      `${capped} rows per file. The ${PLANS_BY_KEY.grassroots.name} plan raises this to ` +
      `${paidLimit.toLocaleString('en-US')} rows per file — or split the file and import the parts separately.`
    );
  }
  return (
    `This file has ${counted} data rows; imports are limited to ${capped} rows per file. ` +
    `Split the file and import the parts separately.`
  );
}

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
 * Why a mapped record cannot be imported, or null when it can. Mirrors what the wizard once did
 * client-side: rows with no mapped values are skipped, and rows the shared row schema refuses
 * are skipped with the first validation issue as the reason.
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
 * same schema, same file bytes. A resumed run skips the counting pass and passes no delimiter;
 * re-detection over the same bytes is deterministic, so both runs parse the file identically.
 */
async function* streamValidCsvRows(
  payload: JobPayloadOf<'import_csv'>,
  rowSchema: z.ZodType,
  delimiter: CsvDelimiter | undefined,
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
 * whose processors do not take a reasons argument. Runs BEFORE the processor starts, so the
 * reasons are durable before any chunk commits — a crash mid-import cannot lose them, and a
 * resumed run (which skips the counting pass) finds them already on file. The households
 * processor seeds its own reason list from the stored column, so its final write keeps these;
 * the companies/tasks processors never touch the column. The persons path instead hands its
 * reasons to processImportRows via clientSkipReasons and needs no merge.
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
 * Valid rows fed to the entity processors in ONE execution of an `import_csv` job. A file with
 * more valid rows than this is handled by a chain of short jobs: each run processes its budget,
 * then enqueues a continuation job and exits well inside the 15-minute job timeout. The cursor
 * is `data_imports.processed_row_offset` (written atomically with each chunk), so the chain —
 * and any crash inside one link of it — always resumes at the last committed chunk. Same idiom
 * as the year-end statement batches (receipts.handlers.ts) and boundary matching
 * (lib/gis/boundary-jobs.ts): short-lived jobs are how this repo survives restarts.
 */
export const IMPORT_ROWS_PER_RUN = 20_000;

interface BoundedImportFeed {
  rows: AsyncGenerator<StoredImportRow, void, undefined>;
  /** True once the budget filled with the source still holding more rows. Valid after `rows` ends. */
  sourceHadMore: () => boolean;
}

/**
 * Skip the first `skip` valid rows (rows earlier runs durably consumed) and feed at most
 * `limit` rows onward. Exiting the inner loop early invokes the source generator's cleanup, so
 * the underlying CSV parser and blob stream are torn down rather than left dangling.
 */
function boundImportFeed(source: AsyncIterable<StoredImportRow>, skip: number, limit: number): BoundedImportFeed {
  let hadMore = false;
  async function* rows(): AsyncGenerator<StoredImportRow, void, undefined> {
    let index = 0;
    let fed = 0;
    for await (const row of source) {
      if (index++ < skip) continue;
      if (fed >= limit) {
        // This row is beyond the run's budget — the continuation run imports it.
        hadMore = true;
        return;
      }
      fed += 1;
      yield row;
    }
  }
  return { rows: rows(), sourceHadMore: () => hadMore };
}

/**
 * Queue the next link of the import chain. A plain insert, not a transactional enqueue: the
 * resume cursor is already durable on `data_imports`, so the worst a crash here costs is the
 * job row — which stale recovery of THIS job then re-delivers (same payload), losing nothing.
 * Precedent: enqueueContinuation in receipts.handlers.ts.
 *
 * Enqueued above the default claim priority so the next segment does not queue behind THIS
 * segment's thousands of geocode/trigger fan-out jobs (they all carry the same enqueue-time
 * run_at, so id order alone put the continuation ~15 minutes out per 25,000-row segment). See
 * IMPORT_CONTINUATION_PRIORITY in job-claim.ts for why this cannot starve other tenants.
 */
async function enqueueImportContinuation(
  db: Kysely<Models>,
  payload: JobPayloadOf<'import_csv'>,
  currentJobId: string | undefined,
): Promise<void> {
  // Belt and braces against a second chain forming. The real protection is the compare-and-set on
  // `processed_row_offset` in the per-entity processors — a duplicate run's chunk transaction
  // rolls back rather than re-inserting. This check just avoids lengthening the queue with a link
  // that has an owner already: if another `import_csv` job for this import is still pending or
  // processing, that job will resume from the durable cursor, so the chain continues without us.
  // Skipped when the caller does not know its own job row's id, because this job is itself
  // 'processing' and would always match.
  if (currentJobId != null) {
    const rival = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('tenant_id', '=', payload.tenant_id)
      .where('status', 'in', ['pending', 'processing'])
      .where('id', '!=', currentJobId)
      .where(sql`payload->>'type'`, '=', 'import_csv')
      .where(sql`payload->>'import_id'`, '=', payload.import_id)
      .limit(1)
      .executeTakeFirst();
    if (rival) {
      logger.warn(
        { importId: payload.import_id, tenantId: payload.tenant_id, rivalJobId: rival.id },
        'Import continuation not enqueued: another job for this import is already queued or running',
      );
      return;
    }
  }

  await db
    .insertInto('background_jobs')
    .values({
      tenant_id: payload.tenant_id,
      queue: 'default',
      status: 'pending',
      priority: IMPORT_CONTINUATION_PRIORITY,
      payload: JSON.stringify(payload),
      run_at: new Date(),
      max_attempts: 3,
    })
    .execute();
}

/**
 * Upload-based CSV import: the mutation stored only the file's storage key and the column
 * mapping; this job does everything the client used to — parse, map, validate — then feeds the
 * surviving rows to the per-entity processors.
 *
 * Two streaming passes over the blob:
 *  1. Count data rows and pre-compute validation skips. `row_count` is written before anything
 *     else so an over-cap file can fail fast, with the real count on record and zero inserts.
 *     Skipped entirely when resuming (processed_row_offset > 0): the count and the pre-skips
 *     are already durable, and re-counting would repeat work.
 *  2. Stream the valid rows into the unchanged `processImportRows` chunk pipeline — at most
 *     IMPORT_ROWS_PER_RUN of them per execution; the remainder goes to a continuation job.
 *
 * The source CSV is deliberately never deleted here — it is the retained original the History
 * page re-downloads, and the 90-day retention sweep owns its lifecycle. (It also must outlive
 * processing for resume/continuation to re-read it, which the 90-day retention guarantees.)
 */
export async function handleImportCsvJob(
  payload: JobPayloadOf<'import_csv'>,
  db: Kysely<Models>,
  options?: { rowsPerRun?: number; jobId?: string },
): Promise<void> {
  const runState = await readImportRunState(db, payload.tenant_id, payload.import_id);
  if (runState.completedAlready) return;
  const resuming = runState.resumeOffset > 0;

  await markImportProcessing(payload.tenant_id, payload.import_id);

  const rowSchema = CSV_IMPORT_ROW_SCHEMAS[payload.source];

  // PASS 1 — detect the delimiter, count data rows, and record why invalid rows will be
  // skipped. Skipped when resuming; `delimiter` then stays undefined and pass 2 re-detects it
  // from the same bytes (deterministic, so both passes parse identically).
  let delimiter: CsvDelimiter | undefined;
  let preSkipped = 0;
  const preSkipReasons: CsvSkipReason[] = [];
  if (!resuming) {
    // Per-plan row cap (5,000 Free / 100,000 paid). Resolved before streaming so the cap the
    // failure message quotes is the tenant's own; a resumed run already passed this gate.
    const rowLimit = await resolveTenantImportRowLimit(db, payload.tenant_id);
    let rowCount = 0;
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

    if (rowCount > rowLimit) {
      await failImport(payload, overCapMessage(rowCount, rowLimit));
      return;
    }

    // Persist the counting pass's skips for the non-persons sources BEFORE any chunk commits,
    // so a crash cannot lose them (the persons path hands them to its processor instead, which
    // persists them with its first chunk).
    if (payload.source !== 'persons' && preSkipReasons.length > 0) {
      await mergeCsvSkipReasons(db, payload.tenant_id, payload.import_id, preSkipReasons);
    }
  }

  // PASS 2 — stream the valid rows into the unchanged per-entity chunk processors: skip what
  // earlier runs durably consumed, feed at most this run's budget. On resume the pre-skips are
  // already inside the persisted counters, so the base contribution must be zero.
  const feed = boundImportFeed(
    streamValidCsvRows(payload, rowSchema, delimiter),
    runState.resumeOffset,
    options?.rowsPerRun ?? IMPORT_ROWS_PER_RUN,
  );
  const skippedBase = resuming ? 0 : preSkipped;
  let verification: EmailVerificationSummary | null = null;
  if (payload.source === 'companies') {
    await new CompaniesController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      skippedBase,
      feed.rows,
    );
  } else if (payload.source === 'tasks') {
    await new TasksController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      skippedBase,
      feed.rows,
    );
  } else if (payload.source === 'households') {
    await new HouseholdsController().processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      skippedBase,
      feed.rows,
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
      skippedBase,
      collectEmails(feed.rows),
      {
        duplicateDecision: payload.duplicate_decision ?? 'skip',
        listName: payload.list_name ?? undefined,
        // The counting pass's validation skips ride the same machinery the wizard's
        // client-side skips used, so History's skipped-rows download covers them. On resume
        // they are already inside the persisted skip_reasons.
        clientSkipReasons: resuming ? undefined : preSkipReasons,
      },
    );

    // Verifies the emails THIS execution fed (suppression inserts are additive + idempotent).
    // On a continued/resumed import each run checks its own segment, and
    // runImportEmailVerification MERGES each segment's numbers into the stored summary —
    // multi-segment runs are normal at the 100,000-row cap, and the completion email must
    // report the whole file, not the last segment.
    verification = await runImportEmailVerification(
      db,
      { tenant_id: payload.tenant_id, import_id: payload.import_id, user_id: payload.user_id },
      emailRows,
    );
  }

  // Budget filled with rows still unread: hand the remainder to a fresh job and exit. The
  // resume cursor is already durable, so the continuation (or a crash re-run) picks up exactly
  // where this run's last committed chunk left off.
  if (feed.sourceHadMore()) {
    await enqueueImportContinuation(db, payload, options?.jobId);
    logger.info(
      { importId: payload.import_id, tenantId: payload.tenant_id },
      'Import run budget reached; continuation job enqueued',
    );
    return;
  }

  await markImportCompleted(payload.tenant_id, payload.import_id);

  await sendImportSummaryEmail(db, payload, verification);
}
