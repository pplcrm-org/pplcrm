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
import type { LegacyImportJobPayload } from '../job-payloads';

const storageService = new StorageService();
const importsRepo = new ImportsRepo();
const mailService = new TransactionalEmailService();

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
            text: `Hi ${user.first_name || 'there'},\n\nYour contact spreadsheet import has completed.\n\nStatistics:\n- Inserted: ${inserted}\n- Errors: ${errors}\n- Skipped: ${skipped}\n\nView imported rows: ${env.appUrl}/imports/${payload.import_id}`,
            html: `<h2>Spreadsheet import complete</h2>
<p>Hi ${user.first_name || 'there'},</p>
<p>Your contact spreadsheet import has completed.</p>
<div class="panel"><p><strong>Inserted:</strong> ${inserted}</p><p><strong>Errors:</strong> ${errors}</p><p><strong>Skipped:</strong> ${skipped}</p></div>
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
