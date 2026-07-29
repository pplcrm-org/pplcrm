import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DashboardController } from './controller';
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
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('should attribute closed emails to the actual closer user (Dana) instead of the assignee (Priya)', async () => {
    const auth = { tenant_id: tenantId, user_id: user1Id, name: 'Dana' } as any;
    const stats = await controller.getStats(auth);

    // Verify emailsClosed list has Dana (user1Id) credited, and not Priya
    const closerClosed = stats.emailsClosed.find((u: any) => String(u.user_id) === user1Id);
    const assigneeClosed = stats.emailsClosed.find((u: any) => String(u.user_id) === user2Id);

    expect(closerClosed).toBeDefined();
    expect(closerClosed?.count).toBe(1);
    expect(assigneeClosed).toBeUndefined();

    // Verify userStats array has the correct counts
    const closerStats = stats.userStats.find((u: any) => String(u.user_id) === user1Id);
    const assigneeStats = stats.userStats.find((u: any) => String(u.user_id) === user2Id);

    expect(closerStats?.closedCount).toBe(1);
    expect(assigneeStats?.closedCount).toBe(0);
  });
});
