import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BugReportsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  const tenantId = rand();
  const userId = rand();

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant Bug Reports',
    })
    .execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db.deleteFrom('bug_reports').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

async function insertFile(db: any, tenantId: string, overrides: Record<string, unknown> = {}) {
  const row = await db
    .insertInto('files')
    .values({
      tenant_id: tenantId,
      filename: 'screenshot.png',
      mime_type: 'image/png',
      size_bytes: 1234,
      storage_key: `test/${tenantId}/screenshot.png`,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirst();
  return row;
}

describe('BugReportsController Integration', () => {
  const controller = new BugReportsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let auth: any;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    auth = { tenant_id: tenantId, user_id: userId };
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('stores the report and enqueues exactly one send-bug-report-email job', async () => {
    const { id } = await controller.report(auth, {
      description: 'The save button does nothing',
      page_url: '/people/42',
      user_agent: 'TestBrowser/1.0',
      viewport: '1512x982',
    });

    const report = await db
      .selectFrom('bug_reports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    expect(report).toBeTruthy();
    expect(report.description).toBe('The save button does nothing');
    expect(report.page_url).toBe('/people/42');
    expect(String(report.created_by)).toBe(userId);
    expect(report.screenshot_file_id).toBeNull();

    const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(jobs).toHaveLength(1);
    const payload = typeof jobs[0].payload === 'string' ? JSON.parse(jobs[0].payload) : jobs[0].payload;
    expect(payload.type).toBe('send-bug-report-email');
    expect(String(payload.bugReportId)).toBe(String(id));
    expect(String(payload.tenant_id)).toBe(tenantId);
  });

  it('links the screenshot file to the report inside the transaction', async () => {
    const file = await insertFile(db, tenantId);

    const { id } = await controller.report(auth, {
      description: 'Broken layout, see screenshot',
      screenshot_file_id: String(file.id),
    });

    const linked = await db
      .selectFrom('files')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', file.id)
      .executeTakeFirst();
    expect(linked.entity_type).toBe('bug_report');
    expect(String(linked.entity_id)).toBe(String(id));
  });

  it('rejects a screenshot file that belongs to another tenant (cross-tenant probe)', async () => {
    const other = await createTestSeed(db);
    const foreignFile = await insertFile(db, other.tenantId);

    try {
      await expect(
        controller.report(auth, {
          description: 'Sneaky report',
          screenshot_file_id: String(foreignFile.id),
        }),
      ).rejects.toThrow('Screenshot upload not found');

      const reports = await db.selectFrom('bug_reports').selectAll().where('tenant_id', '=', tenantId).execute();
      expect(reports).toHaveLength(0);
    } finally {
      await cleanTenant(db, other.tenantId);
    }
  });

  it('rejects a non-image file as a screenshot', async () => {
    const file = await insertFile(db, tenantId, { filename: 'notes.pdf', mime_type: 'application/pdf' });

    await expect(
      controller.report(auth, {
        description: 'PDF attached',
        screenshot_file_id: String(file.id),
      }),
    ).rejects.toThrow('The screenshot must be an image');
  });

  it('rate-limits the sixth report inside an hour', async () => {
    for (let i = 0; i < 5; i++) {
      await controller.report(auth, { description: `Report ${i}` });
    }

    await expect(controller.report(auth, { description: 'One too many' })).rejects.toThrow('Too many requests');

    const reports = await db.selectFrom('bug_reports').selectAll().where('tenant_id', '=', tenantId).execute();
    expect(reports).toHaveLength(5);
  });
});
