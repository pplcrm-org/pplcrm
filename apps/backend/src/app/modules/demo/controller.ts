import { hasSettledPlan, type IAuthKeyPayload } from '../../../../../../libs/common/src';
import { ForbiddenError, InternalError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { logger } from '../../logger';
import { StorageService } from '../../lib/storage.service';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import { DEMO_MANIFEST_SETTINGS_KEY, DemoSeedManifestObj, deleteDemoData } from './demo-seed';
import type { DemoSeedManifest } from './demo-seed';

/**
 * Exit demo mode: delete exactly the rows the signup seeder created (tracked in
 * the demo_seed_manifest settings row), keep everything else — the six starter
 * forms, the system tags, and anything the user created while exploring.
 */
export interface DemoSummaryItem {
  label: string;
  count: number;
}

/**
 * Turn a seed manifest into the deleted-items list the exit confirm shows. Pure, so the
 * "the numbers are real" property is testable without a database — and so it stays honest:
 * anything not in the manifest is not deleted, and therefore cannot appear here. Categories at
 * zero are dropped rather than rendered as "0 companies".
 *
 * Ordered by what a user would miss most, not by table name.
 */
export function summarizeManifest(manifest: DemoSeedManifest): DemoSummaryItem[] {
  const counts: [string, number][] = [
    ['people', manifest.persons.length],
    ['households', manifest.households.length],
    ['companies', manifest.companies.length],
    ['tasks', manifest.tasks.length],
    ['sample lists', manifest.lists.length],
    ['teams', manifest.teams.length],
    ['volunteer events', manifest.volunteer_events.length],
    ['newsletters and their reports', manifest.newsletters.length],
    ['inbox emails', manifest.emails.length],
    ['canvassing turfs', manifest.turfs.length],
    ['delivery requests', manifest.delivery_requests.length],
    ['recorded donations', manifest.donations.length],
    ['demo teammates', manifest.users.length],
  ];
  return counts.filter(([, count]) => count > 0).map(([label, count]) => ({ label, count }));
}

export class DemoController extends BaseController<'settings', SettingsRepo> {
  constructor() {
    super(new SettingsRepo());
  }

  /**
   * What exiting would actually delete, counted from the manifest rather than described in prose.
   *
   * The confirm dialog has to be specific enough to earn the interruption, and hard-coded counts
   * drift the moment the seeder changes. Returns zeros-free entries only, so the caller renders
   * exactly what exists.
   */
  public async getDemoSummary(auth: IAuthKeyPayload): Promise<{ items: DemoSummaryItem[] }> {
    return { items: summarizeManifest(await this.loadManifest(auth.tenant_id)) };
  }

  public async exitDemoMode(auth: IAuthKeyPayload) {
    const manifest = await this.loadManifest(auth.tenant_id);

    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select(['placeholder_household_id', 'subscription_status'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    // Demo mode is the pre-plan test drive: exiting (and the configuration it
    // unlocks) requires a subscription first. Same active-status rule as billing.
    const hasActiveSubscription = hasSettledPlan(tenant?.subscription_status);
    if (!hasActiveSubscription) {
      throw new ForbiddenError(
        'Choose a plan before exiting demo mode. Once you subscribe, you can remove the demo data and set up your workspace.',
      );
    }

    const placeholderHouseholdId = tenant?.placeholder_household_id;
    if (!placeholderHouseholdId) {
      throw new InternalError('This workspace has no placeholder household. Cannot exit demo mode.');
    }

    const blobKeys = await this.getRepo()
      .transaction()
      .execute((trx) =>
        deleteDemoData(
          {
            tenant_id: auth.tenant_id,
            user_id: auth.user_id,
            manifest,
            placeholder_household_id: String(placeholderHouseholdId),
          },
          trx,
        ),
      );

    // After commit, never before: a blob deleted inside the transaction would be gone
    // even if the transaction rolled back and its `files` row came back. Best-effort —
    // a leaked demo blob is a few hundred bytes and must not fail the exit.
    const storage = new StorageService();
    for (const key of blobKeys) {
      try {
        await storage.delete(key);
      } catch (err) {
        logger.error({ err }, `Exit demo: failed to delete attachment blob ${key}`);
      }
    }

    return { success: true };
  }

  private async loadManifest(tenant_id: string): Promise<DemoSeedManifest> {
    const row = await this.getRepo().getByKey({ tenant_id, key: DEMO_MANIFEST_SETTINGS_KEY });
    if (!row) {
      throw new NotFoundError('The demo data has already been removed.');
    }
    const raw: unknown = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const parsed = DemoSeedManifestObj.safeParse(raw);
    if (!parsed.success) {
      throw new InternalError('The demo data record is malformed. Please contact support.');
    }
    return parsed.data;
  }
}
