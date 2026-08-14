import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEMO_EXCLUDED_FEATURES, GATED_FEATURES, type GatedFeature } from '@common';
import { BaseRepository } from '../../lib/base.repo';
import { ForbiddenError } from '../../errors/app-errors';
import { assertInboxAccess, assertPlanFeature } from './plan-gate';

/**
 * The plan gate is the contract behind FEATURE_MATRIX: below-minimum plans cannot mutate
 * through a gated module. Since 2026-08-10, demo mode is the one deliberate exception —
 * a workspace whose seeded demo data is still in place gates as the top self-serve tier so
 * the test drive covers every feature. Outward-facing actions stay blocked elsewhere (demo
 * guard, transactional send guard, drip worker), so these tests only concern entitlement.
 */
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

type Db = {
  insertInto: (t: string) => { values: (v: unknown) => { execute: () => Promise<void> } };
  updateTable: (t: string) => {
    set: (r: unknown) => { where: (a: string, b: string, c: unknown) => { execute: () => Promise<void> } };
  };
  deleteFrom: (t: string) => { where: (a: string, b: string, c: unknown) => { execute: () => Promise<void> } };
};

describe('assertPlanFeature / assertInboxAccess demo-mode gating', () => {
  const db = (BaseRepository as never as { _db: never })._db as never as Db;
  let tenantId: string;

  beforeEach(async () => {
    tenantId = rand();
    await db
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Plan gate spec', subscription_plan: 'free' })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  const setTenant = async (row: Record<string, unknown>): Promise<void> => {
    await db.updateTable('tenants').set(row).where('id', '=', tenantId).execute();
  };

  it('refuses gated features to a free workspace that is not in demo mode', async () => {
    await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, 'forms')).rejects.toThrow(ForbiddenError);
    await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, 'canvassing')).rejects.toThrow(/Movement/);
    await expect(assertInboxAccess(BaseRepository.dbInstance, tenantId)).rejects.toThrow(/Grassroots/);
  });

  it('lets a demo workspace through every gated feature except the demo-excluded ones', async () => {
    await setTenant({ demo_mode_at: new Date() });
    for (const feature of Object.keys(GATED_FEATURES) as GatedFeature[]) {
      if (DEMO_EXCLUDED_FEATURES.has(feature)) continue;
      await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, feature)).resolves.toBeUndefined();
    }
    await expect(assertInboxAccess(BaseRepository.dbInstance, tenantId)).resolves.toBeUndefined();
  });

  // The scriptable API stays on the STORED plan during the demo: data loaded through a key
  // outlives the demo exit, so elevating it let an unpaid workspace bulk-load a list and keep
  // it on Free (REVIEW7 C2).
  it('keeps the API gated on the stored plan even in demo mode', async () => {
    await setTenant({ demo_mode_at: new Date() });
    await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, 'api')).rejects.toThrow(ForbiddenError);
  });

  it('re-locks gated features the moment demo mode ends', async () => {
    await setTenant({ demo_mode_at: new Date() });
    await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, 'deliveries')).resolves.toBeUndefined();

    await setTenant({ demo_mode_at: null });
    await expect(assertPlanFeature(BaseRepository.dbInstance, tenantId, 'deliveries')).rejects.toThrow(ForbiddenError);
  });
});
