import type { Kysely } from 'kysely';
import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { CompaniesController } from '../../../modules/companies/controller';
import { HouseholdsController } from '../../../modules/households/controller';
import { ImportsRepo } from '../../../modules/imports/repositories/imports.repo';
import { PersonsService } from '../../../modules/persons/services/persons.service';
import { TasksController } from '../../../modules/tasks/controller';
import { StorageService } from '../../storage.service';
import { notificationEnabled } from '../../profile-preferences';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import type { EmailVerificationSummary } from '../../mail/email-verifier.service';
import type { LegacyImportJobPayload } from '../job-payloads';
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

export async function handleImportJob(payload: LegacyImportJobPayload, db: Kysely<Models>): Promise<void> {
  // 1. Mark import status as 'processing' in data_imports
  await importsRepo.update({
    tenant_id: payload.tenant_id,
    id: payload.import_id,
    row: {
      status: 'processing',
      updated_at: new Date(),
    },
  });

  // 2. Download mapping payload from storage
  const buffer = await storageService.download(payload.storage_key);
  const rows = JSON.parse(buffer.toString('utf8'));

  // 3. Process the import rows in chunks
  let verification: EmailVerificationSummary | null = null;
  if (payload.source === 'companies') {
    const companiesController = new CompaniesController();
    await companiesController.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      Number(payload.skipped || 0),
      rows,
    );
  } else if (payload.source === 'tasks') {
    const tasksController = new TasksController();
    await tasksController.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      Number(payload.skipped || 0),
      rows,
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
      rows,
    );
  } else {
    const personsService = new PersonsService();
    await personsService.processImportRows(
      payload.import_id,
      payload.tenant_id,
      payload.user_id,
      payload.campaign_id ?? '',
      payload.tags ?? [],
      Number(payload.skipped || 0),
      rows,
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
      rows,
    );
  }

  // 4. Update import status to 'completed'
  await importsRepo.update({
    tenant_id: payload.tenant_id,
    id: payload.import_id,
    row: {
      status: 'completed',
      processed_at: new Date(),
      updated_at: new Date(),
    },
  });

  try {
    await storageService.delete(payload.storage_key);
  } catch (storageErr) {
    logger.error({ err: storageErr }, `Failed to clean up storage key ${payload.storage_key}`);
  }

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

          await mailService.sendMail({
            to: user.email,
            subject: `Spreadsheet import complete: ${payload.file_name || 'import.csv'}`,
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
          });
        }
      }
    }
  } catch (mailErr) {
    logger.error({ err: mailErr }, 'Failed to send import completion summary email');
  }
}
