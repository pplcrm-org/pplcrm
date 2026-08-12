import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DashboardController } from './controller';
import { computeDashboardSnapshot } from './dashboard-stats.service';
import { BaseRepository } from '../../lib/base.repo';

describe('DashboardController Closed Emails Attribution', () => {
  const controller = new DashboardController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let user1Id: string; // Dana (closer)
  let user2Id: string; // Priya (assignee)
  let campaignId: string;
  let emailId: string;

  beforeEach(async () => {
    tenantId = rand();
    user1Id = rand();
    user2Id = rand();
    campaignId = rand();
    emailId = rand();

    // 1. Tenant
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: 'Stats Test Tenant',
      })
      .execute();

    // 2. Users
    await db
      .insertInto('authusers')
      .values([
        {
          id: user1Id,
          tenant_id: tenantId,
          email: `dana-${user1Id}@example.com`,
          password: 'password',
          first_name: 'Dana',
          last_name: 'Okonkwo',
          verified: true,
          createdby_id: user1Id,
          updatedby_id: user1Id,
        },
        {
          id: user2Id,
          tenant_id: tenantId,
          email: `priya-${user2Id}@example.com`,
          password: 'password',
          first_name: 'Priya',
          last_name: 'Ali',
          verified: true,
          createdby_id: user2Id,
          updatedby_id: user2Id,
        },
      ])
      .execute();

    // 3. Campaign (emails are campaign-scoped, §15)
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: user1Id,
        name: 'Stats Test Campaign',
        createdby_id: user1Id,
        updatedby_id: user1Id,
      })
      .execute();

    // 4. Email in Inbox (folder_id '11'), assigned to Priya (user2Id), but closed
    await db
      .insertInto('emails')
      .values({
        id: emailId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: '11',
        from_email: 'customer@example.com',
        to_email: 'support@example.com',
        subject: 'Issue Inquiry',
        preview: 'Preview',
        is_favourite: false,
        status: 'closed',
        assigned_to: user2Id,
        createdby_id: user2Id,
        updatedby_id: user2Id,
      })
      .execute();

    // 5. Activity log recording that Dana (user1Id) closed the email
    await db
      .insertInto('user_activity')
      .values({
        tenant_id: tenantId,
        user_id: user1Id,
        activity: 'close',
        entity: 'email',
        entity_id: emailId,
        createdby_id: user1Id,
        updatedby_id: user1Id,
      })
      .execute();
  });

  afterEach(async () => {
    // getStats' first-view bootstrap enqueues a refresh job and the snapshot writer may land a
    // row — both must not leak into other specs (the shared test DB runs worker specs too).
    await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('dashboard_stats_snapshots').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('attributes closed emails to the actual closer (Dana), not the assignee (Priya), in every snapshot window', async () => {
    // Closed-email attribution moved off the request path into the snapshot computation
    // (REVIEW6 T1-3); the semantic under test is unchanged.
    const snapshot = await computeDashboardSnapshot(db, tenantId);

    for (const key of ['d7', 'd30', 'd60', 'd90'] as const) {
      const window = snapshot.windows[key];
      expect(window.closedCount).toBe(1);
      const closer = window.perUser.find((u) => String(u.user_id) === user1Id);
      const assignee = window.perUser.find((u) => String(u.user_id) === user2Id);
      expect(closer?.closedCount).toBe(1);
      // Priya neither closed nor responded to anything, so she has no per-user row at all.
      expect(assignee).toBeUndefined();
    }
  });

  it('getStats serves live open counts, reports no snapshot yet, and queues the one-time bootstrap refresh', async () => {
    const auth = { tenant_id: tenantId, user_id: user1Id, name: 'Dana' } as any;
    const stats = await controller.getStats(auth);

    // The only seeded email is closed: nothing open, nothing unassigned.
    expect(stats.totalOpenCount).toBe(0);
    expect(stats.unassignedCount).toBe(0);
    // The field-operations counts ride the same response; an empty workspace reads all zeros.
    expect(stats.field).toEqual({ doorsKnocked7d: 0, conversations7d: 0, turfsKnockingNow: 0 });

    // No snapshot exists yet — the read reports that honestly and queues the coalesced bootstrap.
    expect(stats.snapshot.windows).toBeNull();
    expect(stats.snapshot.computedAt).toBeNull();
    expect(stats.snapshot.refreshPending).toBe(true);

    const job = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    expect(job).toBeDefined();

    // A second read must coalesce, not stack a second job.
    await controller.getStats(auth);
    const jobs = await db.selectFrom('background_jobs').select('id').where('tenant_id', '=', tenantId).execute();
    expect(jobs.length).toBe(1);
  });
});
