import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { CRON_JOBS } from '../cron-registry';
import type { JobPayloadOf } from '../job-payloads';
import { scheduleNextRun } from '../reschedule';

export async function handleZapierTrigger(payload: JobPayloadOf<'zapier_trigger'>): Promise<void> {
  const { ZapierService } = await import('../../../modules/zapier/zapier.service');
  const zapierService = new ZapierService();
  await zapierService.fireTrigger(payload.tenant_id, payload.event_type, payload.data);
}

export async function handleCheckUsageLimits(
  payload: JobPayloadOf<'check_usage_limits'>,
  db: Kysely<Models>,
): Promise<void> {
  const { checkTenantUsage } = await import('../../../modules/billing/usage-limits');
  await checkTenantUsage(payload.tenant_id, db);
}

export async function handleCheckAllUsageLimits(db: Kysely<Models>): Promise<void> {
  const { checkAllUsageLimits } = await import('../../../modules/billing/usage-limits');
  await checkAllUsageLimits(db);
  await scheduleNextRun(db, 'check_all_usage_limits', CRON_JOBS.check_all_usage_limits);
}
