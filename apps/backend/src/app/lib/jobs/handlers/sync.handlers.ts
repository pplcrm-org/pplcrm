import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { env } from '../../../../env';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import { GoogleOAuthService } from '../../../modules/google-sync/google-oauth.service';
import { GoogleSyncService } from '../../../modules/google-sync/google-sync.service';
import { MsOAuthService } from '../../../modules/ms-sync/ms-oauth.service';
import { MsSyncService } from '../../../modules/ms-sync/ms-sync.service';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

export async function handleScheduleSyncJobs(db: Kysely<Models>): Promise<void> {
  await queueUserSyncJobs(db);

  await scheduleNextRun(db, 'schedule_sync_jobs', CRON_JOBS.schedule_sync_jobs);
}

export async function handleGoogleSync(payload: JobPayloadOf<'google_sync'>, db: Kysely<Models>): Promise<void> {
  const oauthSvc = new GoogleOAuthService(db, {
    clientId: env.googleClientId ?? '',
    clientSecret: env.googleClientSecret ?? '',
    redirectUri: env.googleRedirectUri ?? `${env.apiUrl}/auth/google/callback`,
  });
  const syncSvc = new GoogleSyncService(db, oauthSvc);
  await syncSvc.syncTenant(payload.tenantId, payload.campaignId, payload.requestedBy);
}

export async function handleMsSync(payload: JobPayloadOf<'ms_sync'>, db: Kysely<Models>): Promise<void> {
  const oauthSvc = new MsOAuthService(db, {
    clientId: env.msClientId ?? '',
    clientSecret: env.msClientSecret ?? '',
    tenantId: env.msTenantId ?? 'common',
    redirectUri: env.msRedirectUri ?? `${env.apiUrl}/auth/ms/callback`,
  });
  const syncSvc = new MsSyncService(db, oauthSvc);
  await syncSvc.syncTenant(payload.tenantId, payload.campaignId, payload.requestedBy);
}

async function queueUserSyncJobs(db: Kysely<Models>): Promise<void> {
  try {
    // §15 — connections are per-campaign, so schedule one sync job per connected
    // (tenant, campaign) mailbox rather than one per tenant.
    // NOTE: unscoped by design — the cron enumerates every connected mailbox to fan out one sync
    // job per (tenant, campaign). Only the ids are read; the token secrets are never selected.
    // eslint-disable-next-line local/no-unscoped-db-query
    const googleTokens = await db.selectFrom('google_oauth_tokens').select(['tenant_id', 'campaign_id']).execute();

    for (const token of googleTokens) {
      const tenantId = String(token.tenant_id);
      const campaignId = String(token.campaign_id);

      const existing = await db
        .selectFrom('background_jobs')
        .select('id')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql`payload->>'type'`, '=', 'google_sync')
        .where(sql`payload->>'tenantId'`, '=', tenantId)
        .where(sql`payload->>'campaignId'`, '=', campaignId)
        .executeTakeFirst();

      if (!existing) {
        logger.info(`Auto-scheduling Google sync job for tenant ${tenantId} campaign ${campaignId}`);
        await db
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'google_sync',
              tenantId,
              campaignId,
              requestedBy: 'system',
            }),
            run_at: new Date(),
            max_attempts: 3,
          })
          .execute();
      }
    }

    // NOTE: unscoped by design — same cron fan-out as the Google loop above; ids only, no secrets.
    // eslint-disable-next-line local/no-unscoped-db-query
    const msTokens = await db.selectFrom('ms_oauth_tokens').select(['tenant_id', 'campaign_id']).execute();

    for (const token of msTokens) {
      const tenantId = String(token.tenant_id);
      const campaignId = String(token.campaign_id);

      const existing = await db
        .selectFrom('background_jobs')
        .select('id')
        .where('status', 'in', ['pending', 'processing'])
        .where(sql`payload->>'type'`, '=', 'ms_sync')
        .where(sql`payload->>'tenantId'`, '=', tenantId)
        .where(sql`payload->>'campaignId'`, '=', campaignId)
        .executeTakeFirst();

      if (!existing) {
        logger.info(`Auto-scheduling MS sync job for tenant ${tenantId} campaign ${campaignId}`);
        await db
          .insertInto('background_jobs')
          .values({
            tenant_id: tenantId,
            queue: 'default',
            status: 'pending',
            payload: JSON.stringify({
              type: 'ms_sync',
              tenantId,
              campaignId,
              requestedBy: 'system',
            }),
            run_at: new Date(),
            max_attempts: 3,
          })
          .execute();
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to queue tenant sync jobs');
  }
}
