import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { computeDashboardSnapshot, writeDashboardSnapshot } from './dashboard-stats.service';

/**
 * Pins the snapshot computation's two load-bearing semantics against a real Postgres:
 *
 *  1. WINDOWING — closed counts / time-to-close window on the CLOSE date (`updated_at`);
 *     first-response stats window on the ARRIVAL date (`created_at`). A hard-coded FILTER clause
 *     in the SQL that drifted from the 7/30/60/90 contract would fail here.
 *  2. FIRST RESPONSE — earliest of (first internal comment, first Sent-folder email addressed to
 *     the sender AFTER arrival), counted only when strictly after arrival. The outbound match is
 *     case-insensitive on the address.
 */
describe('computeDashboardSnapshot windowing and first-response semantics', () => {
  const db = (BaseRepository as unknown as { _db: any })._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  let tenantId: string;
  let danaId: string; // closer + assignee under test
  let campaignId: string;

  const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

  async function seedEmail(fields: {
    folder: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    fromEmail?: string;
    assignedTo?: string;
  }): Promise<string> {
    const id = rand();
    await db
      .insertInto('emails')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: fields.folder,
        from_email: fields.fromEmail ?? 'someone@example.com',
        to_email: 'support@example.com',
        subject: 'Spec email',
        preview: 'Preview',
        is_favourite: false,
        status: fields.status,
        assigned_to: fields.assignedTo ?? null,
        created_at: fields.createdAt,
        updated_at: fields.updatedAt,
        createdby_id: danaId,
        updatedby_id: danaId,
      })
      .execute();
    return id;
  }

  beforeEach(async () => {
    tenantId = rand();
    danaId = rand();
    campaignId = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Snapshot Spec Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: danaId,
        tenant_id: tenantId,
        email: `dana-${danaId}@example.com`,
        password: 'password',
        first_name: 'Dana',
        last_name: 'Okonkwo',
        verified: true,
        createdby_id: danaId,
        updatedby_id: danaId,
      })
      .execute();
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: danaId,
        name: 'Snapshot Spec Campaign',
        createdby_id: danaId,
        updatedby_id: danaId,
      })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('dashboard_stats_snapshots').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_comments').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_recipients').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('windows closed counts on the close date and drops closes older than 90 days', async () => {
    // Closed 3 days ago (arrived 40 days ago): in every closed window.
    await seedEmail({ folder: '11', status: 'closed', createdAt: daysAgo(40), updatedAt: daysAgo(3) });
    // Closed 45 days ago: in d60/d90 only.
    await seedEmail({ folder: '11', status: 'closed', createdAt: daysAgo(50), updatedAt: daysAgo(45) });
    // Closed 100 days ago: outside the whole scan.
    await seedEmail({ folder: '11', status: 'closed', createdAt: daysAgo(110), updatedAt: daysAgo(100) });

    const snapshot = await computeDashboardSnapshot(db, tenantId);
    expect(snapshot.windows.d7.closedCount).toBe(1);
    expect(snapshot.windows.d30.closedCount).toBe(1);
    expect(snapshot.windows.d60.closedCount).toBe(2);
    expect(snapshot.windows.d90.closedCount).toBe(2);

    // Time-to-close of the d7 email is 37 days; the average must be in hours.
    const d7Avg = snapshot.windows.d7.avgTimeToCloseHours;
    expect(d7Avg).not.toBeNull();
    expect(d7Avg as number).toBeGreaterThan(36 * 24 - 1);
    expect(d7Avg as number).toBeLessThan(38 * 24 + 1);
  });

  it('measures first response from comment or outbound reply, windowed on arrival, case-insensitively', async () => {
    // Comment response: arrived 2 days ago, first comment 1 day ago → 24h, in every window.
    const commented = await seedEmail({
      folder: '11',
      status: 'open',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      assignedTo: danaId,
    });
    await db
      .insertInto('email_comments')
      .values({
        tenant_id: tenantId,
        email_id: commented,
        author_id: danaId,
        comment: 'On it',
        created_at: daysAgo(1),
        updated_at: daysAgo(1),
        createdby_id: danaId,
        updatedby_id: danaId,
      })
      .execute();

    // Outbound response: arrived 10 days ago from Donor@Example.ORG; a Sent email TO that address
    // (different casing) went out 9 days ago → 24h, in d30/d60/d90 but NOT d7.
    await seedEmail({
      folder: '11',
      status: 'open',
      createdAt: daysAgo(10),
      updatedAt: daysAgo(10),
      fromEmail: 'Donor@Example.ORG',
      assignedTo: danaId,
    });
    const sent = await seedEmail({ folder: '3', status: 'open', createdAt: daysAgo(9), updatedAt: daysAgo(9) });
    await db
      .insertInto('email_recipients')
      .values({
        tenant_id: tenantId,
        email_id: sent,
        kind: 'to',
        name: null,
        email: 'donor@example.org',
        pos: 0,
        createdby_id: danaId,
        updatedby_id: danaId,
      })
      .execute();

    // Never-responded email: arrived 5 days ago, no comment, no outbound → counted nowhere.
    await seedEmail({ folder: '11', status: 'open', createdAt: daysAgo(5), updatedAt: daysAgo(5) });

    const snapshot = await computeDashboardSnapshot(db, tenantId);
    expect(snapshot.windows.d7.responseCount).toBe(1);
    expect(snapshot.windows.d30.responseCount).toBe(2);
    expect(snapshot.windows.d90.responseCount).toBe(2);

    // Both measured responses are 24h; averages must say so in every window that holds them.
    expect(snapshot.windows.d7.avgFirstResponseHours as number).toBeCloseTo(24, 0);
    expect(snapshot.windows.d30.avgFirstResponseHours as number).toBeCloseTo(24, 0);

    // Per-user: both responded emails are assigned to Dana.
    const dana30 = snapshot.windows.d30.perUser.find((u) => String(u.user_id) === danaId);
    expect(dana30?.responseCount).toBe(2);
  });

  it('returns empty windows for a tenant with no mail, and writeDashboardSnapshot upserts one row per day', async () => {
    const empty = await computeDashboardSnapshot(db, tenantId);
    expect(empty.windows.d90.closedCount).toBe(0);
    expect(empty.windows.d90.responseCount).toBe(0);
    expect(empty.windows.d90.avgFirstResponseHours).toBeNull();
    expect(empty.windows.d90.avgTimeToCloseHours).toBeNull();
    expect(empty.windows.d90.perUser).toEqual([]);

    await writeDashboardSnapshot(db, tenantId);
    await writeDashboardSnapshot(db, tenantId); // same day again — must update, not duplicate
    const rows = await db
      .selectFrom('dashboard_stats_snapshots')
      .select(['snapshot_date'])
      .where('tenant_id', '=', tenantId)
      .execute();
    expect(rows.length).toBe(1);
  });
});
